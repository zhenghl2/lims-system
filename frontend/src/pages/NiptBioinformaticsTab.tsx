import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Table, Button, Space, Tag, Typography, Input, InputNumber,
  Select, AutoComplete, message, Tooltip
} from "antd";
import {
  SaveOutlined, UploadOutlined
} from "@ant-design/icons";
import api from "../api/client";
import { useTranslation } from "../i18n/useTranslation";
import * as XLSX from "xlsx";

const { Text } = Typography;

// ── Types ──────────────────────────────────────────────────
interface RunSample {
  id: string;
  sample: string;
  sample_vg_id: string;
  sample_barcode: string;
  sample_patient_name: string;
  sample_source: string;
  sample_test_option: string;
  sample_gestational_weeks: number | null;
  sample_multiple_gestation: boolean;
  sample_ivf: boolean;
  sample_pregnancy_history: string;
  sample_diagnosis: string;
  sample_fetal_fraction: number | null;
  result_summary: Record<string, unknown>;
  status: string;
}

interface BioData {
  raw_reads?: number;
  uniq_reads?: number;
  gc?: number;
  dup?: number;
  qc_status?: string;  // QC: PASS / 低浓度 / 高GC / 数据量不足 / 多条染色体临界 / 其他
  result?: string;
  z21?: number;
  z18?: number;
  z13?: number;
  t21?: string;
  t18?: string;
  t13?: string;
  xo?: string;
  xxx?: string;
  xxy?: string;
  xyy?: string;
  all_chrom?: string;
  plus_result?: string;
  plus_highrisk_items?: string;
  ff_percent?: number;
  sex?: string;
}

interface Props {
  batch: any;
  samples: RunSample[];
  onRefresh: () => void;
}

// ── Result options ─────────────────────────────────────────
const RESULT_OPTIONS = [
  { value: "Low Risk", label: "低风险" },
  { value: "High Risk", label: "高风险" },
  { value: "No Call", label: "无法判定" },
];

const CHROM_RESULT_OPTIONS = [
  { value: "Low Risk", label: "低风险" },
  { value: "High Risk", label: "高风险" },
  { value: "No Call", label: "无法判定" },
  { value: "Normal", label: "正常" },
  { value: "Abnormal", label: "异常" },
];

const SEX_OPTIONS = [
  { value: "Female", label: "女" },
  { value: "Male", label: "男" },
  { value: "N/A", label: "无法判定" },
];

// ── Editable Cell ──────────────────────────────────────────
interface EditableCellProps {
  value: any;
  onChange: (v: any) => void;
  type: "text" | "number" | "select" | "combo";
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  danger?: boolean; // QC highlight: red text
}

function EditableCell({ value, onChange, type, options, placeholder, min, max, step, danger }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState<any>(value);

  useEffect(() => { setLocalValue(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (localValue !== value) onChange(localValue);
  };

  const dangerStyle = danger ? { color: "#ff4d4f", fontWeight: 700 } : {};

  if (!editing) {
    const display = value !== null && value !== undefined && value !== ""
      ? (type === "select" && options
          ? options.find(o => o.value === value)?.label || value
          : String(value))
      : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
    return (
      <div
        onClick={() => setEditing(true)}
        style={{ cursor: "pointer", minWidth: 40, minHeight: 22, padding: "1px 4px", borderRadius: 3, ...dangerStyle }}
        onMouseEnter={e => (e.currentTarget.style.background = "#f0f5ff")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        {display}
      </div>
    );
  }

  if (type === "combo" && options) {
    return (
      <AutoComplete
        autoFocus size="small" value={localValue || ""}
        style={{ width: "100%", minWidth: 110 }}
        options={options.map(o => ({ value: o.label || o.value, label: o.label }))}
        onChange={v => setLocalValue(v)}
        onBlur={commit}
        placeholder={placeholder}
        open
      >
        <Input onPressEnter={commit} />
      </AutoComplete>
    );
  }

  if (type === "select" && options) {
    return (
      <Select
        autoFocus size="small" value={localValue}
        style={{ width: "100%", minWidth: 100 }}
        options={options}
        onChange={v => { setLocalValue(v); setEditing(false); onChange(v); }}
        onBlur={() => setEditing(false)}
        open
      />
    );
  }

  if (type === "number") {
    return (
      <InputNumber
        autoFocus size="small" value={localValue}
        style={{ width: "100%", minWidth: 70 }}
        min={min} max={max} step={step || 0.01}
        placeholder={placeholder}
        onChange={v => setLocalValue(v)}
        onBlur={commit}
        onPressEnter={commit}
      />
    );
  }

  return (
    <Input
      autoFocus size="small" value={localValue || ""}
      style={{ width: "100%", minWidth: 80 }}
      placeholder={placeholder}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

// ── Main Component ─────────────────────────────────────────
export default function NiptBioinformaticsTab({ batch, samples, onRefresh }: Props) {
  const { t } = useTranslation();
  // Exclude samples that failed in previous steps from bioinformatics
  const activeSamples = useMemo(() => {
    const extFails = batch.extraction_data?.sample_results || {};
    const libFails = batch.library_data?.sample_results || {};
    const poolSamples = batch.pooling_data?.samples || [];
    const runSamples = batch.run_samples || [];
    // Build index→vgId map
    const idxToVgId: Record<number, string> = {};
    runSamples.forEach((rs: any, i: number) => {
      if (rs.sample_vg_id) idxToVgId[i] = rs.sample_vg_id;
    });
    // Build fail vgId set from all 3 steps
    const failVgIds = new Set<string>();
    for (const [idxStr, r] of Object.entries(extFails)) {
      if ((r as any).status === "fail") {
        const vg = idxToVgId[parseInt(idxStr)];
        if (vg) failVgIds.add(vg);
      }
    }
    for (const [idxStr, r] of Object.entries(libFails)) {
      if ((r as any).status === "fail") {
        const vg = idxToVgId[parseInt(idxStr)];
        if (vg) failVgIds.add(vg);
      }
    }
    for (const s of poolSamples) {
      if (s.qc === "FAIL" && s.vgId) failVgIds.add(s.vgId);
    }
    return samples.filter((s: any) => !failVgIds.has(s.sample_vg_id));
  }, [samples, batch.extraction_data, batch.library_data, batch.pooling_data]);
  const [bioData, setBioData] = useState<Record<string, BioData>>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing bioinformatics data from batch (only on batch change)
  useEffect(() => {
    if (batch?.bioinformatics_data) {
      setBioData(batch.bioinformatics_data);
      initialized.current = true;
    }
  }, [batch?.id]);

  const updateCell = useCallback((runSampleId: string, field: string, value: any) => {
    setBioData(prev => ({
      ...prev,
      [runSampleId]: {
        ...(prev[runSampleId] || {}),
        [field]: value,
      },
    }));
  }, []);

  const handleSave = async () => {
    if (!batch?.id) return;
    setSaving(true);
    try {
      await api.post(`/runs/${batch.id}/save_bioinformatics/`, {
        bioinformatics_data: bioData,
      });
      message.success(t("nipt.bioinformatics.saved"));
      onRefresh();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t("nipt.bioinformatics.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Excel/CSV import: parse CHIP6972-style merged results file
  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        console.log("[import] rows count:", rows.length);
        console.log("[import] first row keys:", rows.length > 0 ? Object.keys(rows[0]) : "none");
        if (rows.length === 0) { message.warning("Empty file"); return; }

        // Build VG ID → runSampleId map
        const vgMap = new Map<string, string>();
        for (const s of activeSamples) {
          if (s.sample_vg_id) vgMap.set(s.sample_vg_id.trim(), s.id);
        }
        console.log("[import] vgMap:", [...vgMap.entries()]);

        const r3 = (v: number) => Math.round(v * 1000) / 1000;

        // Helper: translate normal/high risk CSV values
        const toRisk = (csvVal: string): string => {
          const v = (csvVal || "").trim().toLowerCase();
          if (v === "high risk" || v === "高风险") return "High Risk";
          if (v === "normal" || v === "正常") return "Low Risk";
          return v || "Low Risk";
        };

        const newBio: Record<string, BioData> = { ...bioData };
        let matched = 0, skipped = 0;

        for (const row of rows) {
          const sampleField = String(row["sample"] || row["Sample"] || "");
          const vgId = sampleField.includes("_") ? sampleField.split("_").pop()!.trim() : sampleField.trim();
          const rsId = vgMap.get(vgId);
          if (!rsId) { console.log("[import] skip unmatched:", vgId); skipped++; continue; }

          console.log(`[import] match: ${vgId} → rsId=${rsId}`);

          const entry: BioData = {};
          const winOut = String(row["win_out_of_range"] || "");
          const sexGroup = String(row["sex_group"] || "").toLowerCase();

          // ── Numeric fields (3 decimal places) ──
          const rawReads = Number(row["raw_reads"]);
          if (!isNaN(rawReads)) entry.raw_reads = r3(rawReads);

          const uniqReads = Number(row["unique_reads"]);
          if (!isNaN(uniqReads)) entry.uniq_reads = r3(uniqReads);

          // GC is already percentage (38.99), keep as-is
          const gc = Number(row["gc"]);
          if (!isNaN(gc)) entry.gc = r3(gc);

          // Duplication: CSV decimal (0.0366) → % (×100)
          const dup = Number(row["duplication"]);
          if (!isNaN(dup)) entry.dup = r3(dup * 100);

          // Z scores
          const z21 = Number(row["chr21_z"]);
          if (!isNaN(z21)) entry.z21 = r3(z21);
          const z18 = Number(row["chr18_z"]);
          if (!isNaN(z18)) entry.z18 = r3(z18);
          const z13 = Number(row["chr13_z"]);
          if (!isNaN(z13)) entry.z13 = r3(z13);

          // ── FF%: male → FFY, female → Seqff; both ×100 ──
          const ffRaw = sexGroup === "male" ? Number(row["FFY"]) : Number(row["Seqff"]);
          if (!isNaN(ffRaw)) entry.ff_percent = r3(ffRaw * 100);

          // ── Sex ──
          if (sexGroup) entry.sex = sexGroup.charAt(0).toUpperCase() + sexGroup.slice(1);

          // ── T21/T18/T13 from win_out_of_range ──
          if (winOut) {
            const parts = winOut.split(",").map((s: string) => s.trim());
            entry.t21 = parts.includes("chr21") ? "High Risk" : "Low Risk";
            entry.t18 = parts.includes("chr18") ? "High Risk" : "Low Risk";
            entry.t13 = parts.includes("chr13") ? "High Risk" : "Low Risk";
          }

          // ── Result: vgresult ──
          const vgr = String(row["vgresult"] || "");
          if (vgr) entry.result = vgr;

          // ── XO / XXX / XXY / XYY ──
          // Always read from CSV; default "Low Risk" if column is empty
          entry.xo = toRisk(row["XO"]);
          entry.xxx = toRisk(row["XXX"]);
          entry.xxy = toRisk(row["XXY"]);
          entry.xyy = toRisk(row["XYY"]);
          console.log(`[import] ${vgId} XO=${entry.xo} XXX=${entry.xxx} XXY=${entry.xxy} XYY=${entry.xyy}`);

          // ── All Chrom ──
          const ac = String(row["All Chrom"] || "");
          if (ac) entry.all_chrom = ac;

          // ── Plus fields ──
          const pr = String(row["Plus_Result"] || "");
          if (pr) entry.plus_result = pr;
          const ph = String(row["Plus_HighRisk"] || "");
          if (ph) entry.plus_highrisk_items = ph;

          console.log("[import] entry:", JSON.stringify(entry));
          newBio[rsId] = entry;
          matched++;
        }

        console.log("[import] newBio keys:", Object.keys(newBio));
        console.log("[import] newBio:", JSON.stringify(newBio));
        setBioData(newBio);
        message.success(`Imported ${matched} sample(s)${skipped > 0 ? `, ${skipped} skipped (VG ID not found)` : ""}`);
      } catch (err: any) {
        console.error("[import] error:", err);
        message.error("Failed to parse file: " + (err?.message || err));
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Columns ───────────────────────────────────────────────
  const formatWeeks = (v: number | null) => v != null ? `${v}w` : "—";

  const qcOptions = [
    { value: "PASS", label: t("nipt.bioinformatics.qcPass") },
    { value: "浓度低", label: t("nipt.bioinformatics.qcLowFF") },
    { value: "高GC", label: t("nipt.bioinformatics.qcHighGC") },
    { value: "数据量不足", label: t("nipt.bioinformatics.qcLowData") },
    { value: "多条染色体临界", label: t("nipt.bioinformatics.qcMultiChromBorderline") },
    { value: "其他", label: t("nipt.bioinformatics.qcOther") },
  ];

  const columns = [
    {
      title: "VG ID", dataIndex: "sample_vg_id", key: "vg_id",
      width: 90,
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v || "—"}</Text>,
    },
    {
      title: "Name", dataIndex: "sample_patient_name", key: "name",
      width: 100, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "Report Code", dataIndex: "sample_report_code", key: "report_code",
      width: 160, ellipsis: true,
      render: (v: string) => v ? <Text code style={{fontSize:11}}>{v}</Text> : "—",
    },
    {
      title: "Sample Source",dataIndex: "sample_source", key: "source",
      width: 90, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "Test Option", dataIndex: "sample_test_option", key: "test_option",
      width: 80,
      render: (v: string) => {
        if (!v) return "—";
        const colors: Record<string, string> = { "Basic": "blue", "Plus": "purple", "Basic All": "green" };
        return <Tag color={colors[v] || "default"} style={{ fontSize: 11 }}>{v}</Tag>;
      },
    },
    {
      title: "Gest. Weeks", dataIndex: "sample_gestational_weeks", key: "gest_weeks",
      width: 75, align: "center" as const,
      render: formatWeeks,
    },
    {
      title: "Twin", dataIndex: "sample_multiple_gestation", key: "twin",
      width: 55, align: "center" as const,
      render: (v: boolean) => v ? "👶👶" : "—",
    },
    {
      title: "IVF", dataIndex: "sample_ivf", key: "ivf",
      width: 50, align: "center" as const,
      render: (v: boolean) => v ? <Tag color="orange" style={{ fontSize: 11 }}>IVF</Tag> : "—",
    },
    {
      title: "Preg. History", dataIndex: "sample_pregnancy_history", key: "preg_history",
      width: 95, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "Diagnosis", dataIndex: "sample_diagnosis", key: "diagnosis",
      width: 120, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: t("nipt.bioinformatics.qc"), key: "qc_status", width: 150,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.qc_status}
          onChange={v => updateCell(record.id, "qc_status", v)}
          type="select"
          options={qcOptions}
          placeholder="QC"
        />
      ),
    },
    {
      title: "raw-reads", key: "raw_reads", width: 110, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.raw_reads}
          onChange={v => updateCell(record.id, "raw_reads", v)}
          type="number" min={0} step={1} placeholder="Raw reads"
        />
      ),
    },
    {
      title: "uniq-reads", key: "uniq_reads", width: 110, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.uniq_reads}
          onChange={v => updateCell(record.id, "uniq_reads", v)}
          type="number" min={0} step={1} placeholder="Uniq reads"
        />
      ),
    },
    {
      title: "GC (%)", key: "gc", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.gc}
          onChange={v => updateCell(record.id, "gc", v)}
          type="number" min={0} max={100} step={0.1} placeholder="GC%"
        />
      ),
    },
    {
      title: "Dup (%)", key: "dup", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.dup}
          onChange={v => updateCell(record.id, "dup", v)}
          type="number" min={0} max={100} step={0.1} placeholder="Dup%"
        />
      ),
    },
    {
      title: "Result", key: "result", width: 130,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.result}
          onChange={v => updateCell(record.id, "result", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Low Risk / High Risk / No Call / 自定义..."
        />
      ),
    },
    {
      title: "Z21", key: "z21", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z21}
          onChange={v => updateCell(record.id, "z21", v)}
          type="number" step={0.01} placeholder="Z21"
          danger={bioData[record.id]?.z21 != null && (bioData[record.id]!.z21! < -2.8 || bioData[record.id]!.z21! > 2.8)}
        />
      ),
    },
    {
      title: "Z18", key: "z18", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z18}
          onChange={v => updateCell(record.id, "z18", v)}
          type="number" step={0.01} placeholder="Z18"
          danger={bioData[record.id]?.z18 != null && (bioData[record.id]!.z18! < -2.8 || bioData[record.id]!.z18! > 2.8)}
        />
      ),
    },
    {
      title: "Z13", key: "z13", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z13}
          onChange={v => updateCell(record.id, "z13", v)}
          type="number" step={0.01} placeholder="Z13"
          danger={bioData[record.id]?.z13 != null && (bioData[record.id]!.z13! < -2.8 || bioData[record.id]!.z13! > 2.8)}
        />
      ),
    },
    {
      title: "T21", key: "t21", width: 100,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t21}
          onChange={v => updateCell(record.id, "t21", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T21"
          danger={bioData[record.id]?.t21 === "High Risk"}
        />
      ),
    },
    {
      title: "T18", key: "t18", width: 100,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t18}
          onChange={v => updateCell(record.id, "t18", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T18"
          danger={bioData[record.id]?.t18 === "High Risk"}
        />
      ),
    },
    {
      title: "T13", key: "t13", width: 100,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t13}
          onChange={v => updateCell(record.id, "t13", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T13"
          danger={bioData[record.id]?.t13 === "High Risk"}
        />
      ),
    },
    {
      title: "XO", key: "xo", width: 95,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xo}
          onChange={v => updateCell(record.id, "xo", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XO"
          danger={bioData[record.id]?.xo === "High Risk"}
        />
      ),
    },
    {
      title: "XXX", key: "xxx", width: 95,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xxx}
          onChange={v => updateCell(record.id, "xxx", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XXX"
          danger={bioData[record.id]?.xxx === "High Risk"}
        />
      ),
    },
    {
      title: "XXY", key: "xxy", width: 95,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xxy}
          onChange={v => updateCell(record.id, "xxy", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XXY"
          danger={bioData[record.id]?.xxy === "High Risk"}
        />
      ),
    },
    {
      title: "XYY", key: "xyy", width: 95,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xyy}
          onChange={v => updateCell(record.id, "xyy", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XYY"
          danger={bioData[record.id]?.xyy === "High Risk"}
        />
      ),
    },
    {
      title: "All Chrom", key: "all_chrom", width: 140,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.all_chrom}
          onChange={v => updateCell(record.id, "all_chrom", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="All Chrom ..."
        />
      ),
    },
    {
      title: "Plus Result", key: "plus_result", width: 140,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.plus_result}
          onChange={v => updateCell(record.id, "plus_result", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Plus Result ..."
        />
      ),
    },
    {
      title: "Plus HighRisk", key: "plus_highrisk_items", width: 160,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.plus_highrisk_items}
          onChange={v => updateCell(record.id, "plus_highrisk_items", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Plus HighRisk ..."
        />
      ),
    },
    {
      title: "FF (%)", key: "ff_percent", width: 75, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.ff_percent}
          onChange={v => updateCell(record.id, "ff_percent", v)}
          type="number" min={0} max={100} step={0.01} placeholder="FF%"
          danger={bioData[record.id]?.ff_percent != null && bioData[record.id]!.ff_percent! < 4}
        />
      ),
    },
    {
      title: "Sex", key: "sex", width: 80,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.sex}
          onChange={v => updateCell(record.id, "sex", v)}
          type="select" options={SEX_OPTIONS} placeholder="性别"
        />
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────
  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Space>
          <Text strong style={{ fontSize: 13 }}>
            {t("nipt.bioinformatics.sampleCount")}: {activeSamples.length}
          </Text>
          {activeSamples.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              | {t("nipt.bioinformatics.filledCount")}: {Object.keys(bioData).filter(k => bioData[k] && Object.keys(bioData[k]).length > 0).length}
            </Text>
          )}
        </Space>
        <Space>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".xlsx,.xls,.csv"
            onChange={handleImportExcel}
          />
          <Tooltip title={t("nipt.bioinformatics.importExcelHint")}>
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
              {t("nipt.bioinformatics.importExcel")}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            disabled={!batch?.id}
          >
            {t("nipt.bioinformatics.save")}
          </Button>
        </Space>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <Table
          rowKey="id"
          dataSource={activeSamples}
          columns={columns}
          size="small"
          pagination={false}
          bordered
          locale={{ emptyText: t("nipt.bioinformatics.noSampleData") }}
          components={{
            header: {
              cell: (props: any) => (
                <th {...props} style={{ ...props.style, background: "#fafafa", fontWeight: 600, fontSize: 11, padding: "4px 6px", whiteSpace: "nowrap" }} />
              ),
            },
          }}
          onRow={() => ({
            style: { height: 32 },
          })}
        />
      </div>

      {/* Bottom save */}
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          disabled={!batch?.id}
        >
            {t("nipt.bioinformatics.saveResult")}
        </Button>
      </div>
    </div>
  );
}
