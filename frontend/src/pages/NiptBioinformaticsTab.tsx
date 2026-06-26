import { useState, useEffect, useCallback, useRef } from "react";
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
}

function EditableCell({ value, onChange, type, options, placeholder, min, max, step }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState<any>(value);

  useEffect(() => { setLocalValue(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (localValue !== value) onChange(localValue);
  };

  if (!editing) {
    const display = value !== null && value !== undefined && value !== ""
      ? (type === "select" && options
          ? options.find(o => o.value === value)?.label || value
          : String(value))
      : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
    return (
      <div
        onClick={() => setEditing(true)}
        style={{ cursor: "pointer", minWidth: 40, minHeight: 22, padding: "1px 4px", borderRadius: 3 }}
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
        onChange={v => { setLocalValue(v); commit(); }}
        onBlur={commit}
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

  // Excel import: parse file, match by VG ID, fill bioData
  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (rows.length < 2) { message.warning("Empty file"); return; }

        // Header row maps column names to BioData fields
        const header = rows[0].map((h: any) => String(h || "").trim());
        const fieldMap: Record<string, string> = {
          "raw reads": "raw_reads", "raw_reads": "raw_reads",
          "unique reads": "uniq_reads", "uniq_reads": "uniq_reads",
          "gc%": "gc", "gc": "gc",
          "dup%": "dup", "dup": "dup",
          "result": "result",
          "z21": "z21", "z18": "z18", "z13": "z13",
          "t21": "t21", "t18": "t18", "t13": "t13",
          "xo": "xo", "xxx": "xxx", "xxy": "xxy", "xyy": "xyy",
          "all chrom": "all_chrom", "all_chrom": "all_chrom",
          "plus result": "plus_result", "plus_result": "plus_result",
          "plus highrisk": "plus_highrisk_items", "plus_highrisk_items": "plus_highrisk_items",
          "ff%": "ff_percent", "ff_percent": "ff_percent",
          "sex": "sex",
        };

        // Build VG ID → runSampleId map
        const vgMap = new Map<string, string>();
        for (const s of samples) {
          if (s.sample_vg_id) vgMap.set(s.sample_vg_id.trim(), s.id);
        }

        const newBio = { ...bioData };
        let matched = 0, skipped = 0;
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const vgId = String(row[0] || "").trim();
          const rsId = vgMap.get(vgId);
          if (!rsId) { skipped++; continue; }
          matched++;
          const entry: BioData = { ...(newBio[rsId] || {}) };
          for (let c = 1; c < header.length; c++) {
            const colName = header[c].toLowerCase().replace(/[\s_-]+/g, " ").trim();
            const field = fieldMap[colName];
            if (field && row[c] !== undefined && row[c] !== null && row[c] !== "") {
              const val = row[c];
              if (["raw_reads", "uniq_reads", "gc", "dup", "z21", "z18", "z13", "ff_percent"].includes(field)) {
                (entry as any)[field] = Number(val);
              } else {
                (entry as any)[field] = String(val).trim();
              }
            }
          }
          newBio[rsId] = entry;
        }
        setBioData(newBio);
        message.success(`Imported ${matched} sample(s)${skipped > 0 ? `, ${skipped} skipped (VG ID not found)` : ""}`);
      } catch (err: any) {
        message.error("Failed to parse Excel: " + (err?.message || err));
      }
    };
    reader.readAsBinaryString(file);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Columns ───────────────────────────────────────────────
  const formatWeeks = (v: number | null) => v != null ? `${v}w` : "—";

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
      title: "raw-reads", key: "raw_reads", width: 90, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.raw_reads}
          onChange={v => updateCell(record.id, "raw_reads", v)}
          type="number" min={0} step={1} placeholder="Raw reads"
        />
      ),
    },
    {
      title: "uniq-reads", key: "uniq_reads", width: 90, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.uniq_reads}
          onChange={v => updateCell(record.id, "uniq_reads", v)}
          type="number" min={0} step={1} placeholder="Uniq reads"
        />
      ),
    },
    {
      title: "GC (%)", key: "gc", width: 70, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.gc}
          onChange={v => updateCell(record.id, "gc", v)}
          type="number" min={0} max={100} step={0.1} placeholder="GC%"
        />
      ),
    },
    {
      title: "Dup (%)", key: "dup", width: 70, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.dup}
          onChange={v => updateCell(record.id, "dup", v)}
          type="number" min={0} max={100} step={0.1} placeholder="Dup%"
        />
      ),
    },
    {
      title: "Result", key: "result", width: 120,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.result}
          onChange={v => updateCell(record.id, "result", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Low Risk / High Risk / No Call / 自定义..."
        />
      ),
    },
    {
      title: "Z21", key: "z21", width: 65, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z21}
          onChange={v => updateCell(record.id, "z21", v)}
          type="number" step={0.01} placeholder="Z21"
        />
      ),
    },
    {
      title: "Z18", key: "z18", width: 65, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z18}
          onChange={v => updateCell(record.id, "z18", v)}
          type="number" step={0.01} placeholder="Z18"
        />
      ),
    },
    {
      title: "Z13", key: "z13", width: 65, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.z13}
          onChange={v => updateCell(record.id, "z13", v)}
          type="number" step={0.01} placeholder="Z13"
        />
      ),
    },
    {
      title: "T21", key: "t21", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t21}
          onChange={v => updateCell(record.id, "t21", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T21"
        />
      ),
    },
    {
      title: "T18", key: "t18", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t18}
          onChange={v => updateCell(record.id, "t18", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T18"
        />
      ),
    },
    {
      title: "T13", key: "t13", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.t13}
          onChange={v => updateCell(record.id, "t13", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="T13"
        />
      ),
    },
    {
      title: "XO", key: "xo", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xo}
          onChange={v => updateCell(record.id, "xo", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XO"
        />
      ),
    },
    {
      title: "XXX", key: "xxx", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xxx}
          onChange={v => updateCell(record.id, "xxx", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XXX"
        />
      ),
    },
    {
      title: "XXY", key: "xxy", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xxy}
          onChange={v => updateCell(record.id, "xxy", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XXY"
        />
      ),
    },
    {
      title: "XYY", key: "xyy", width: 90,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.xyy}
          onChange={v => updateCell(record.id, "xyy", v)}
          type="select" options={CHROM_RESULT_OPTIONS} placeholder="XYY"
        />
      ),
    },
    {
      title: "All Chrom", key: "all_chrom", width: 120,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.all_chrom}
          onChange={v => updateCell(record.id, "all_chrom", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="All Chrom ..."
        />
      ),
    },
    {
      title: "Plus Result", key: "plus_result", width: 120,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.plus_result}
          onChange={v => updateCell(record.id, "plus_result", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Plus Result ..."
        />
      ),
    },
    {
      title: "Plus HighRisk", key: "plus_highrisk_items", width: 140,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.plus_highrisk_items}
          onChange={v => updateCell(record.id, "plus_highrisk_items", v)}
          type="combo" options={RESULT_OPTIONS} placeholder="Plus HighRisk ..."
        />
      ),
    },
    {
      title: "FF (%)", key: "ff_percent", width: 70, align: "center" as const,
      render: (_: any, record: RunSample) => (
        <EditableCell
          value={bioData[record.id]?.ff_percent}
          onChange={v => updateCell(record.id, "ff_percent", v)}
          type="number" min={0} max={100} step={0.01} placeholder="FF%"
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
            {t("nipt.bioinformatics.sampleCount")}: {samples.length}
          </Text>
          {samples.length > 0 && (
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
          dataSource={samples}
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
