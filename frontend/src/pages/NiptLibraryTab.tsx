import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, Upload, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Popover, Radio } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { getSignStatus } from "../utils/sign";
import { useTranslation } from "../i18n/useTranslation";
import { ROW_LABELS, COL_COUNT, REGIONS, STEPS, getVgId } from "../utils/constants";

// ── Library prep methods ──
// REGIONS imported from ../utils/constants

const EQUIPMENT_OPTIONS = [
  { value: "PCR_ABI_9700", label: "PCR仪 - ABI 9700" },
  { value: "PCR_ABI_Veriti", label: "PCR仪 - ABI Veriti" },
  { value: "PCR_BioRad_T100", label: "PCR仪 - Bio-Rad T100" },
  { value: "BSC_Thermo_1300", label: "生物安全柜 - Thermo 1300" },
  { value: "BSC_HealForce", label: "生物安全柜 - Heal Force" },
  { value: "LIQUID_HANDLER", label: "自动化移液工作站" },
];

// ── Reagent kits by region ──
interface ReagentKit { value: string; label: string; }
interface RegionKits {
  libKit: ReagentKit[];
  indexKit: ReagentKit[];
  quantKit: ReagentKit[];
  beadKit: ReagentKit[];
}
const KITS_BY_REGION: Record<string, RegionKits> = {
  THAILAND: {
    libKit: [{ value: "ZD101-02", label: "ZHIXUAN Universal DNA Library Prep Kit - Cat#ZD101-02" }],
    indexKit: [{ value: "ZA201", label: "ZHIXUAN Maxi Unique Dual Index DNA Adapters Set 1 - Cat#ZA201" }],
    quantKit: [{ value: "ZQ501", label: "ZHIXUAN 1×dsDNA HS Assay Kit - Cat#ZQ501" }],
    beadKit: [{ value: "ZB401", label: "ZHIXUAN DNA Clean Beads - Cat#ZB401" }],
  },
  XIAMEN: {
    libKit: [{ value: "ND607-02", label: "VAHTS Universal DNA Library Prep Kit - Cat#ND607-02" }],
    indexKit: [
      { value: "N34201-01", label: "VAHTS Maxi UDI Adapters Set1 (1-96) - Cat#N34201-01" },
      { value: "N34202-01", label: "VAHTS Maxi UDI Adapters Set2 (97-192) - Cat#N34202-01" },
      { value: "N34203-01", label: "VAHTS Maxi UDI Adapters Set3 (193-288) - Cat#N34203-01" },
      { value: "N34204-01", label: "VAHTS Maxi UDI Adapters Set4 (289-384) - Cat#N34204-01" },
    ],
    quantKit: [{ value: "EQ121-02", label: "Equalbit 1×dsDNA HS Assay Kit - Cat#EQ121-02" }],
    beadKit: [{ value: "ZB401", label: "ZHIXUAN DNA Clean Beads - Cat#ZB401" }],
  },
  HONGKONG: {
    libKit: [{ value: "ND607-02", label: "VAHTS Universal DNA Library Prep Kit - Cat#ND607-02" }],
    indexKit: [
      { value: "N34201-01", label: "VAHTS Maxi UDI Adapters Set1 (1-96) - Cat#N34201-01" },
      { value: "N34202-01", label: "VAHTS Maxi UDI Adapters Set2 (97-192) - Cat#N34202-01" },
      { value: "N34203-01", label: "VAHTS Maxi UDI Adapters Set3 (193-288) - Cat#N34203-01" },
      { value: "N34204-01", label: "VAHTS Maxi UDI Adapters Set4 (289-384) - Cat#N34204-01" },
    ],
    quantKit: [{ value: "EQ121-02", label: "Equalbit 1×dsDNA HS Assay Kit - Cat#EQ121-02" }],
    beadKit: [{ value: "ZB401", label: "ZHIXUAN DNA Clean Beads - Cat#ZB401" }],
  },
  BRAZIL: {
    libKit: [{ value: "TBD", label: "待定" }],
    indexKit: [{ value: "TBD", label: "待定" }],
    quantKit: [{ value: "TBD", label: "待定" }],
    beadKit: [{ value: "TBD", label: "待定" }],
  },
};

// STEPS imported from ../utils/constants

// ROW_LABELS imported from ../utils/constants
// COL_COUNT imported from ../utils/constants

// getVgId imported from ../utils/constants

interface PlateCell {
  vgId: string;
  index: string;
  sampleIdx?: number;
}

// getSignStatus imported from ../utils/sign

interface Props {
  batch: any;
  samples: any[];
  onRefresh: () => void;
  lastBatchLibData?: any;
}

export default function NiptLibraryTab({ batch, samples, onRefresh, lastBatchLibData }: Props) {
  const { t } = useTranslation();
  const libraryMethods = [
    { value: "SINGLE_CHANNEL", label: t("nipt.library.singleChannel") },
    { value: "MULTI_CHANNEL", label: t("nipt.library.multiChannel") },
    { value: "AUTOMATED", label: t("nipt.library.automated") },
  ];
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);
  const [positiveControl, setPositiveControl] = useState("");
  const [negativeControl, setNegativeControl] = useState("");
  const [method, setMethod] = useState(batch.library_method || "MULTI_CHANNEL");
  const [region, setRegion] = useState(batch.region || "");
  const [photos, setPhotos] = useState<string[]>((batch.library_data?.photos as string[]) || []);
  const [startCoord, setStartCoord] = useState(batch.library_data?.start_coord || "");
  const [selectedKits, setSelectedKits] = useState<string[]>([]);
  const [kitDetails, setKitDetails] = useState<Record<string, {lot: string, expiry: string}>>({});

  // Sync region when batch is updated (e.g. after extraction tab saves a different region)
  useEffect(() => {
    if (batch.region) setRegion(batch.region);
  }, [batch.region]);
  const edata = useMemo(() => batch.library_data || {}, [batch.library_data]);
  // Initialize index kits from saved data
  useEffect(() => {
    initIndexKits(edata);
  }, [batch.id]);
  // Reload sampleResults when batch changes
  const sampleResultsKey = JSON.stringify(batch.library_data?.sample_results || {});
  useEffect(() => {
    setSampleResults((batch.library_data?.sample_results as any) || {});
  }, [sampleResultsKey]);
  const defaultsFetchedRef = useRef(false);
  // Reset prefetch flag when batch changes
  useEffect(() => { defaultsFetchedRef.current = false; }, [batch.id]);
  const { signed: opSigned, name: opSigner } = getSignStatus(edata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(edata, "reviewer");

  // ── Plate state: 8×12 cells, each with {vgId, index} ──
  const [plate, setPlate] = useState<PlateCell[][]>([]);

  // ── Sample pass/fail results ──
  const [sampleResults, setSampleResults] = useState<Record<string, { status: string; note: string }>>(
    () => (batch.library_data?.sample_results as any) || {}
  );

  // Parse coordinate like "D2" -> { row: 3, col: 1 }
  const parseCoord = (coord: string): { row: number; col: number } | null => {
    if (!coord || !coord.trim()) return null;
    const match = coord.trim().toUpperCase().match(/^([A-H])(\d{1,2})$/);
    if (!match) return null;
    const row = ROW_LABELS.indexOf(match[1]);
    const col = parseInt(match[2], 10) - 1;
    if (row === -1 || col < 0 || col >= COL_COUNT) return null;
    return { row, col };
  };

  // ── Build 96-well plate based on extraction method ──
  const buildPlate = useMemo(() => {
    const p: PlateCell[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: COL_COUNT }, () => ({ vgId: "", index: "" }))
    );
    if (!samples || samples.length === 0) return p;

    const extMethod = batch.extraction_method || "MANUAL";

    // Filter out samples that failed during extraction
    const extractionResults = batch.extraction_data?.sample_results || {};
    const validSamples = samples.filter((_s: any, idx: number) => {
      const result = extractionResults[String(idx)];
      return !result || result.status !== "fail";
    });

    if (validSamples.length === 0) return p;

    // Sort by VG ID ascending (uniform across all methods)
    const sortedSamples = [...validSamples].sort((a: any, b: any) => {
      const aId = (getVgId(a) || '').toString();
      const bId = (getVgId(b) || '').toString();
      return aId.localeCompare(bId, undefined, { numeric: true });
    });

    const coord = parseCoord(startCoord);

    if (coord) {
      // Custom start coordinate: fill from cell, top->bottom, left->right, stop at col 12
      let idx = 0;
      for (let c = coord.col; c < COL_COUNT; c++) {
        const rowStart = (c === coord.col) ? coord.row : 0;
        for (let r = rowStart; r < 8; r++) {
          if (idx < sortedSamples.length) {
            const s = sortedSamples[idx];
            p[r][c] = { vgId: getVgId(s) + (s.is_qc ? "QC" : ""), index: "", sampleIdx: samples.indexOf(s) };
            idx++;
          }
        }
      }
    } else if (extMethod === "AUTOMATED") {
      // Automated: center-aligned, same as extraction table
      const numCols = Math.min(Math.ceil(sortedSamples.length / 8), COL_COUNT);
      const startCol = Math.floor((COL_COUNT - numCols) / 2);
      let idx = 0;
      for (let c = startCol; c < startCol + numCols; c++) {
        for (let r = 0; r < 8; r++) {
          if (idx < sortedSamples.length) {
            const s = sortedSamples[idx];
            p[r][c] = { vgId: getVgId(s) + (s.is_qc ? "QC" : ""), index: "", sampleIdx: samples.indexOf(s) };
            idx++;
          }
        }
      }
    } else {
      // MANUAL / MAGNETIC_ROD: centered columns, odd-numbered start, top→bottom left→right
      const numCols = Math.min(Math.ceil(sortedSamples.length / 8), COL_COUNT);
      let startCol = Math.floor((COL_COUNT - numCols) / 2);
      // Ensure start column is odd-numbered (1-indexed: col 1,3,5,7,9,11 → 0-indexed: 0,2,4,6,8,10)
      if (startCol % 2 === 1) {
        startCol -= 1;
      }
      let idx = 0;
      for (let c = startCol; c < startCol + numCols; c++) {
        for (let r = 0; r < 8; r++) {
          if (idx < sortedSamples.length) {
            const s = sortedSamples[idx];
            p[r][c] = { vgId: getVgId(s) + (s.is_qc ? "QC" : ""), index: "", sampleIdx: samples.indexOf(s) };
            idx++;
          }
        }
      }
    }
    return p;
  }, [samples, batch.extraction_method, batch.extraction_data, startCoord]);

  // ── Load saved plate indices ──
  useEffect(() => {
    const saved = edata.library_plate;
    if (saved && Array.isArray(saved) && saved.length === 8) {
      // Restore indices from saved data, keep VG IDs from buildPlate
      const restored = buildPlate.map((row, r) =>
        row.map((cell, c) => ({
          ...cell,
          index: (saved[r]?.[c]?.index) || "",
        }))
      );
      setPlate(restored);
    } else {
      setPlate(buildPlate);
    }
  }, [buildPlate, edata.library_plate]);

  // Initialize index kit selections from saved data (supports both old string and new array format)
  const initIndexKits = (data: any) => {
    if (Array.isArray(data.index_kits) && data.index_kits.length > 0) {
      setSelectedKits(data.index_kits.map((k: any) => k.kit));
      const details: Record<string, {lot: string, expiry: string}> = {};
      data.index_kits.forEach((k: any) => {
        details[k.kit] = { lot: k.lot || "", expiry: k.expiry || "" };
      });
      setKitDetails(details);
    } else if (typeof data.index_kit === "string" && data.index_kit) {
      // Old format: convert to new
      setSelectedKits([data.index_kit]);
      setKitDetails({
        [data.index_kit]: {
          lot: data.index_kit_lot || "",
          expiry: data.index_kit_expiry || "",
        }
      });
    }
  };
  // Load saved form data (only when batch has existing library_data)
  useEffect(() => {
    if (!edata.lib_kit && !(edata.equipment || []).length) {
      // No saved data → just set basic defaults
      form.setFieldsValue({
        lib_date: dayjs(),
        lib_time: dayjs().format("HH:mm"),
        cfDNA_volume: edata.cfDNA_volume ?? undefined,
        pcr_cycles: edata.pcr_cycles ?? 8,
        elution_volume: edata.elution_volume ?? 30,
      });
      setSteps(edata.step_confirmations || {});
      setPositiveControl(edata.positive_control || "");
      setNegativeControl(edata.negative_control || "");
      return;
    }
    // Has saved data → restore all fields
    form.setFieldsValue({
      lib_date: edata.lib_date ? dayjs(edata.lib_date) : dayjs(),
      lib_time: edata.lib_time || dayjs().format("HH:mm"),
      equipment: edata.equipment || [],
      lib_kit: edata.lib_kit || undefined,
      quant_kit: edata.quant_kit || undefined,
      bead_kit: edata.bead_kit || undefined,
      lib_kit_lot: edata.lib_kit_lot || "",
      lib_kit_expiry: edata.lib_kit_expiry ? dayjs(edata.lib_kit_expiry) : undefined,
      quant_kit_lot: edata.quant_kit_lot || "",
      quant_kit_expiry: edata.quant_kit_expiry ? dayjs(edata.quant_kit_expiry) : undefined,
      bead_kit_lot: edata.bead_kit_lot || "",
      bead_kit_expiry: edata.bead_kit_expiry ? dayjs(edata.bead_kit_expiry) : undefined,
      cfDNA_volume: edata.cfDNA_volume ?? undefined,
      pcr_cycles: edata.pcr_cycles ?? 8,
      elution_volume: edata.elution_volume ?? 30,
      temperature: edata.temperature ?? undefined,
      humidity: edata.humidity ?? undefined,
    });
    setSteps(edata.step_confirmations || {});
    setPositiveControl(edata.positive_control || "");
    setNegativeControl(edata.negative_control || "");
    if (edata.start_coord) setStartCoord(edata.start_coord);
    if (batch.library_method) setMethod(batch.library_method);
  }, [edata, form]);

  // Pre-fill reagents/equipment from last batch (runs once per batch.id)
  useEffect(() => {
    if (!batch.id || !lastBatchLibData) return;
    const hasData = !!(edata.lib_kit || (edata.equipment || []).length);
    if (hasData) return;
    if (defaultsFetchedRef.current) return;

    defaultsFetchedRef.current = true;
    const lib = lastBatchLibData;
    form.setFieldsValue({
      equipment: lib.equipment || [],
      lib_kit: lib.lib_kit || undefined,
      lib_kit_lot: lib.lib_kit_lot || "",
      lib_kit_expiry: lib.lib_kit_expiry ? dayjs(lib.lib_kit_expiry) : undefined,
      quant_kit: lib.quant_kit || undefined,
      quant_kit_lot: lib.quant_kit_lot || "",
      quant_kit_expiry: lib.quant_kit_expiry ? dayjs(lib.quant_kit_expiry) : undefined,
      bead_kit: lib.bead_kit || undefined,
      bead_kit_lot: lib.bead_kit_lot || "",
      bead_kit_expiry: lib.bead_kit_expiry ? dayjs(lib.bead_kit_expiry) : undefined,
    });
    // Initialize index kits from last batch
    initIndexKits(lib);
  }, [batch.id, lastBatchLibData]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));
  const kits = KITS_BY_REGION[region] || KITS_BY_REGION.XIAMEN;

  // ── Update index for a specific cell ──
  // Row 0 is the top row (A); entering a number there auto-fills the column
  const updateIndex = (row: number, col: number, value: string) => {
    setPlate(prev => {
      const next = prev.map(r => [...r]);
      next[row] = [...next[row]];
      next[row][col] = { ...next[row][col], index: value };
      // Auto-fill: if editing row 0 with a pure number, increment down the column
      const isFirstInCol = prev.slice(0, row).every(r => !r[col]?.vgId);
      if (isFirstInCol && /^\d+$/.test(value.trim())) {
        const base = parseInt(value, 10);
        let offset = 1;
        for (let r = row + 1; r < 8; r++) {
          if (!prev[r]?.[col]?.vgId) continue;
          next[r] = [...next[r]];
          next[r][col] = { ...next[r][col], index: String(base + offset++) };
        }
      }
      return next;
    });
  };

  // ── Print library plate ──
  const handlePrint = () => {
    // Print only the library construction content — hide sidebar and batch panel
    const style = document.createElement("style");
    style.id = "print-fix";
    style.textContent = "@media print {"
      + " * { overflow: visible !important; }"
      + " html, body, #root, .ant-layout, .ant-layout-content { height: auto !important; max-height: none !important; }"
      + " .ant-layout-sider, .ant-layout-sider *, #nipt-batch-panel, #nipt-batch-panel * { display: none !important; }"
      + " }";
    document.head.appendChild(style);
    window.print();
    setTimeout(() => { const s = document.getElementById("print-fix"); if (s) s.remove(); }, 100);
  };

  // Print only the plate table
  const handlePrintTable = () => {
    const tableEl = document.getElementById("library-plate-table");
    if (!tableEl) return;
    const w = window.open("", "_blank", "width=1200,height=800");
    if (!w) return;
    w.document.write("<!DOCTYPE html><html><head><title>Library Plate</title><style>body{margin:20px;font-family:sans-serif}table{border-collapse:collapse;margin:0 auto}@media print{body{margin:0}}</style></head><body>" + tableEl.outerHTML + "</body></html>");
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  // Photo upload handlers
  const beforeUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setPhotos(prev => [...prev, e.target?.result as string]);
    reader.readAsDataURL(file);
    return false;
  };
  const removePhoto = (uid: string) => setPhotos(prev => prev.filter((_, i) => String(i) !== uid));

  const save = async () => {
    const missingIndex = plate.some(row => row.some(cell => cell.vgId && !cell.index));
    if (missingIndex) { message.warning("Please fill index"); return; }
    if (selectedKits.length === 0) { message.warning(t("nipt.library.selectReagent") + " " + t("nipt.library.indexKit")); return; }
    const missingKitDetail = selectedKits.some(k => !kitDetails[k]?.lot?.trim());
    if (missingKitDetail) { message.warning("Please fill lot number for each Index kit"); return; }
    try {
      const vals = await form.validateFields();
      setSaving(true);
      // Convert plate to pure data (no functions)
      const plateData = plate.map(row =>
        row.map(cell => ({ index: cell.index, vgId: cell.vgId }))
      );
      const payload = {
        library_method: method,
        library_data: {
          lib_date: vals.lib_date?.format("YYYY-MM-DD"),
          lib_time: vals.lib_time,
          equipment: vals.equipment,
          lib_kit: vals.lib_kit,
          lib_kit_lot: vals.lib_kit_lot,
          lib_kit_expiry: vals.lib_kit_expiry?.format("YYYY-MM") || "",
          index_kits: selectedKits.map(kit => ({
            kit,
            lot: kitDetails[kit]?.lot || "",
            expiry: kitDetails[kit]?.expiry || "",
          })),
          quant_kit: vals.quant_kit,
          quant_kit_lot: vals.quant_kit_lot,
          quant_kit_expiry: vals.quant_kit_expiry?.format("YYYY-MM") || "",
          bead_kit: vals.bead_kit,
          bead_kit_lot: vals.bead_kit_lot,
          bead_kit_expiry: vals.bead_kit_expiry?.format("YYYY-MM") || "",
          cfDNA_volume: vals.cfDNA_volume,
          pcr_cycles: vals.pcr_cycles,
          elution_volume: vals.elution_volume,
          temperature: vals.temperature,
          humidity: vals.humidity,
          step_confirmations: steps,
          photos,
          library_plate: plateData,
          sample_results: sampleResults,
          start_coord: startCoord,
          positive_control: positiveControl,
          negative_control: negativeControl,
        },
      };
      await api.post(`/runs/${batch.id}/save_library/`, payload);
      message.success(t("nipt.library.saved"));
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning(t("nipt.extraction.fillRequired")); return; }
      message.error(e?.response?.data?.error || t("nipt.common.saveFailed"));
    } finally { setSaving(false); }
  };

  // Reagent row helper
  const ReagentRow = ({ name, label, kitOptions, lotName, expiryName }: {
    name: string; label: string; kitOptions: ReagentKit[];
    lotName: string; expiryName: string;
  }) => (
    <Row gutter={12} style={{ marginBottom: 8 }}>
      <Col span={13}>
        <Form.Item name={name} label={label} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Select options={kitOptions} placeholder={`${t("nipt.library.selectReagent")} ${label}`} showSearch optionFilterProp="label" />
        </Form.Item>
      </Col>
      <Col span={4}>
        <Form.Item name={lotName} label={t("nipt.library.reagentLot")} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Input placeholder={t("nipt.library.lotPlaceholder")} />
        </Form.Item>
      </Col>
      <Col span={5}>
        <Form.Item name={expiryName} label={t("nipt.extraction.expiry")} style={{ marginBottom: 0 }}>
          <DatePicker picker="month" placeholder={t("nipt.extraction.expiryPlaceholder")} style={{ width: "100%" }} format="YYYY-MM" />
        </Form.Item>
      </Col>
    </Row>
  );

  // ── 96-well plate table styles ──
  const thStyle: React.CSSProperties = {
    border: "1px solid #bbb", padding: "4px 6px", textAlign: "center",
    fontWeight: 700, background: "#d5e8d4", fontSize: 12, minWidth: 80,
  };
  const rowLabelStyle: React.CSSProperties = {
    border: "1px solid #bbb", padding: "4px 6px", textAlign: "center",
    fontWeight: 700, background: "#d5e8d4", fontSize: 12, minWidth: 32,
  };
  const cellStyle: React.CSSProperties = {
    border: "1px solid #d9d9d9", padding: 0, verticalAlign: "middle",
  };
  const inputStyle: React.CSSProperties = {
    width: 50, border: "none", borderRadius: 0, textAlign: "center",
    padding: "2px 4px", fontSize: 11, background: "#fffbe6",
    borderRight: "1px solid #e0e0e0",
  };
  const vgIdStyle: React.CSSProperties = {
    fontSize: 11, padding: "2px 4px", textAlign: "center",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    maxWidth: 80, background: "#fafafa",
  };

  const getCellBg = (vgId: string) => vgId && vgId !== "-"
    ? "#e8f5e9"   // filled: light green
    : "#fafafa";   // empty

  const getExtractionLabel = (): string => {
    const m = batch.extraction_method || "MANUAL";
    const totalSamples = samples?.length || 0;
    const failedCount = Object.values(batch.extraction_data?.sample_results || {}).filter((r: any) => r?.status === "fail").length;
    const validCount = totalSamples - failedCount;
    const numCols = Math.min(Math.ceil(validCount / 8), COL_COUNT);
    let startCol = Math.floor((COL_COUNT - numCols) / 2);
    if (m !== "AUTOMATED" && startCol % 2 === 1) startCol -= 1;
    const colRange = `${startCol + 1}-${startCol + numCols}`;
    if (m === "MANUAL") return `${t("nipt.extraction.manual")} → ${t("nipt.library.centerCols").replace("{cols}", String(numCols)).replace("{range}", colRange)}, ${validCount}/${totalSamples} ${t("nipt.common.samples")}`;
    if (m === "MAGNETIC_ROD") return `${t("nipt.extraction.magneticRod")} → ${t("nipt.library.centerCols").replace("{cols}", String(numCols)).replace("{range}", colRange)}, ${validCount}/${totalSamples} ${t("nipt.common.samples")}`;
    return `${t("nipt.extraction.automated")} → ${t("nipt.library.centerCols").replace("{cols}", String(numCols)).replace("{range}", "")}, ${validCount}/${totalSamples} ${t("nipt.common.samples")}`;
  };

  return (
    <div id="lib-print-area">
      {/* Method & Region */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Form.Item label={t("nipt.library.method")} required>
            <Select options={libraryMethods} value={method} onChange={setMethod} placeholder={t("nipt.library.method")} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Region" required>
            <Select options={REGIONS} value={region || undefined} onChange={setRegion} placeholder={t("nipt.library.selectRegion")} />
          </Form.Item>
        </Col>
        <Col span={8} style={{ display: "flex", alignItems: "center", paddingTop: 6 }}>
          <span style={{ fontSize: 12, color: "#888" }}>
            {t("nipt.library.fillRule")}: {getExtractionLabel()}
          </span>
        </Col>
      </Row>

      {/* QC Controls */}
      <Card size="small" title={t("nipt.library.controls")} style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t("nipt.library.positiveControl")}</span>
              <Input
                placeholder={t("nipt.library.lotOrSerial")}
                value={positiveControl}
                onChange={e => setPositiveControl(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t("nipt.library.negativeControl")}</span>
              <Input
                placeholder={t("nipt.library.lotOrSerial")}
                value={negativeControl}
                onChange={e => setNegativeControl(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </Col>
        </Row>
      </Card>

      <Form form={form} layout="vertical">
        {/* Basic info */}
        <Row gutter={16}>
          <Col span={6}><Form.Item name="lib_date" label={t("nipt.extraction.experimentDate")} rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="lib_time" label={t("nipt.extraction.experimentTime")} rules={[{ required: true }]}><Input placeholder={t("nipt.extraction.timePlaceholder")} /></Form.Item></Col>
          <Col span={6}>
            <Form.Item name="equipment" label={t("nipt.library.equipment")} rules={[{ required: true }]}>
              <Select mode="multiple" options={EQUIPMENT_OPTIONS} placeholder={t("nipt.library.selectEquipment")} maxTagCount={2} />
            </Form.Item>
          </Col>
        </Row>

        {/* Reagent kits - 4 rows */}
        <Card size="small" title={t("nipt.library.buildKit")} style={{ marginBottom: 12 }}>
          <ReagentRow name="lib_kit" label={t("nipt.library.libraryKit")} kitOptions={kits.libKit} lotName="lib_kit_lot" expiryName="lib_kit_expiry" />
          {/* Index 接头: multi-select + dynamic rows */}
          <div style={{ marginBottom: 8 }}>
            {/* Column labels — matches ReagentRow column layout */}
            <Row gutter={12} style={{ marginBottom: 4 }}>
              <Col span={13}>
                <span style={{ fontSize: 14, color: "rgba(0,0,0,0.88)" }}>
                  {t("nipt.library.indexKit")}
                </span>
              </Col>
              <Col span={4}>
                <span style={{ fontSize: 14, color: "rgba(0,0,0,0.88)" }}>
                  {t("nipt.library.reagentLot")}
                </span>
              </Col>
              <Col span={5}>
                <span style={{ fontSize: 14, color: "rgba(0,0,0,0.88)" }}>
                  {t("nipt.extraction.expiry")}
                </span>
              </Col>
            </Row>
            {/* Multi-select row */}
            <Row gutter={12} style={{ marginBottom: selectedKits.length > 0 ? 4 : 0 }}>
              <Col span={13}>
                <Select
                  mode="multiple"
                  options={kits.indexKit}
                  value={selectedKits}
                  onChange={(values: string[]) => {
                    setSelectedKits(values);
                    setKitDetails(prev => {
                      const next = { ...prev };
                      Object.keys(next).forEach(k => {
                        if (!values.includes(k)) delete next[k];
                      });
                      values.forEach(v => {
                        if (!next[v]) next[v] = { lot: "", expiry: "" };
                      });
                      return next;
                    });
                  }}
                  placeholder={t("nipt.library.selectReagent") + " " + t("nipt.library.indexKit")}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: "100%" }}
                  maxTagCount={2}
                />
              </Col>
              <Col span={4} />
              <Col span={5} />
            </Row>
            {/* Per-set rows — inputs only, no repeated labels */}
            {selectedKits.map(kitValue => {
              const kitLabel = kits.indexKit.find((k: any) => k.value === kitValue)?.label || kitValue;
              return (
                <Row key={kitValue} gutter={12} style={{ marginBottom: 8 }}>
                  <Col span={13}>
                    <div style={{
                      padding: "4px 11px", lineHeight: "30px",
                      border: "1px solid #d9d9d9", borderRadius: 6,
                      background: "#f5f5f5", color: "#1677ff", fontWeight: 500,
                      fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }}>
                      {kitLabel}
                    </div>
                  </Col>
                  <Col span={4}>
                    <Input
                      placeholder={t("nipt.library.lotPlaceholder")}
                      value={kitDetails[kitValue]?.lot || ""}
                      onChange={e => setKitDetails(prev => ({
                        ...prev,
                        [kitValue]: { ...prev[kitValue], lot: e.target.value }
                      }))}
                    />
                  </Col>
                  <Col span={5}>
                    <DatePicker
                      picker="month"
                      placeholder={t("nipt.extraction.expiryPlaceholder")}
                      style={{ width: "100%" }}
                      format="YYYY-MM"
                      value={kitDetails[kitValue]?.expiry ? dayjs(kitDetails[kitValue].expiry) : null}
                      onChange={(d: any) => setKitDetails(prev => ({
                        ...prev,
                        [kitValue]: { ...prev[kitValue], expiry: d ? d.format("YYYY-MM") : "" }
                      }))}
                    />
                  </Col>
                </Row>
              );
            })}
          </div>
          <ReagentRow name="quant_kit" label={t("nipt.library.quantKit")} kitOptions={kits.quantKit} lotName="quant_kit_lot" expiryName="quant_kit_expiry" />
          <ReagentRow name="bead_kit" label={t("nipt.library.beadKit")} kitOptions={kits.beadKit} lotName="bead_kit_lot" expiryName="bead_kit_expiry" />
        </Card>

        {/* Volumes & cycles */}
        <Row gutter={16}>
          <Col span={6}><Form.Item name="cfDNA_volume" label={t("nipt.library.cfDnaVolume")} rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="pcr_cycles" label={t("nipt.library.pcrCycles")} rules={[{ required: true }]}><InputNumber min={0} max={20} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="elution_volume" label={t("nipt.library.elutionVolume")} rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="temperature" label={t("nipt.extraction.temperature")}><InputNumber min={0} max={50} step={0.1} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="humidity" label={t("nipt.extraction.humidity")}><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
      </Form>

      {/* ── 96-Well Library Plate ── */}
      <Card
        size="small"
        className="no-print-break"
        title={<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}><span>{t("nipt.library.plateLayout")} — 96-{t("nipt.library.wellPlate")}（{samples.length} samples）<Input size="small" placeholder="起始坐标如 D2" value={startCoord} onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-H0-9]/g, ""); setStartCoord(v.length <= 3 ? v : v.slice(0,3)); }} style={{ width: 85, marginLeft: 10 }} maxLength={3} /></span><Space><Button size="small" onClick={handlePrintTable}>{t("nipt.library.printTable")}</Button><Button size="small" onClick={handlePrint}>{t("nipt.library.printFullPage")}</Button></Space></div>}
        style={{ marginBottom: 16 }}
      >
        <div style={{ overflowX: "auto" }}>
          <table id="library-plate-table" style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={rowLabelStyle}></th>
                {Array.from({ length: COL_COUNT }, (_, i) => i + 1).map(c => (
                  <th key={c} style={thStyle}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_LABELS.map((label: string, row: number) => (
                <tr key={row}>
                  <td style={rowLabelStyle}>{label}</td>
                  {Array.from({ length: COL_COUNT }, (_, col) => {
                    const cell = plate[row]?.[col] || { vgId: "", index: "" };
                    const sr = cell.sampleIdx !== undefined ? sampleResults[String(cell.sampleIdx)] : undefined;
                    const failBg = sr?.status === "fail" ? "#fff1f0" : undefined;
                    const passBg = sr?.status === "pass" ? "#f6ffed" : undefined;
                    const resultBg = failBg || passBg;
                    const baseBg = getCellBg(cell.vgId);
                    const bg = resultBg || baseBg;
                    return (
                      <td key={col} style={{ ...cellStyle, background: bg, cursor: cell.vgId ? "pointer" : "default" }}>
                        <Popover
                          trigger="click"
                          content={
                            <div style={{ minWidth: 180 }}>
                              <Radio.Group
                                value={sr?.status || ""}
                                onChange={e => {
                                  const v = e.target.value;
                                  setSampleResults(prev => ({
                                    ...prev,
                                    [String(cell.sampleIdx)]: { status: v, note: v === "fail" ? (prev[String(cell.sampleIdx)]?.note || "") : "" }
                                  }));
                                }}
                              >
                                <Radio value="pass" style={{ color: "#52c41a" }}>Pass</Radio>
                                <Radio value="fail" style={{ color: "#ff4d4f" }}>Fail</Radio>
                              </Radio.Group>
                              {sr?.status === "fail" && (
                                <Input.TextArea
                                  size="small"
                                  rows={2}
                                  placeholder="失败原因..."
                                  value={sr?.note || ""}
                                  onChange={e => setSampleResults(prev => ({
                                    ...prev,
                                    [String(cell.sampleIdx)]: { status: "fail", note: e.target.value }
                                  }))}
                                  style={{ marginTop: 8 }}
                                />
                              )}
                            </div>
                          }
                        >
                          <div style={{ display: "flex", alignItems: "stretch", minHeight: 30 }}>
                            <input
                              type="text"
                              value={cell.index}
                              onChange={e => updateIndex(row, col, e.target.value)}
                              style={inputStyle}
                              placeholder="ix"
                            />
                            <div style={{ ...vgIdStyle, flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {cell.vgId || ""}
                              {cell.sampleIdx !== undefined && (samples[cell.sampleIdx] as any)?.is_qc && <span style={{ color: "#13c2c2", fontWeight: 600, marginLeft: 1 }}>QC</span>}
                            </div>
                          </div>
                        </Popover>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      

      {/* ── Failed Samples Summary ── */}
      {Object.values(sampleResults).some((r: any) => r?.status === "fail") && (
        <Card size="small" title="失败样本" style={{ marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid #ddd", padding: "4px 8px", textAlign: "left" }}>#</th>
                <th style={{ border: "1px solid #ddd", padding: "4px 8px", textAlign: "left" }}>VG ID</th>
                <th style={{ border: "1px solid #ddd", padding: "4px 8px", textAlign: "left" }}>失败原因</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(sampleResults).filter(([_, r]: any) => r?.status === "fail").map(([idx, r]: any) => {
                const s = samples[parseInt(idx)];
                return (
                  <tr key={idx} style={{ background: "#fff1f0" }}>
                    <td style={{ border: "1px solid #ddd", padding: "4px 8px" }}>{parseInt(idx) + 1}</td>
                    <td style={{ border: "1px solid #ddd", padding: "4px 8px" }}>{s ? (s.sample_vg_id || s.vg_id || "-") : "-"}</td>
                    <td style={{ border: "1px solid #ddd", padding: "4px 8px" }}>{r.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Photos ── */}
      <Card size="small" title="实验照片" style={{ marginBottom: 16 }}>
        <Upload
          listType="picture-card"
          fileList={photos.map((url, i) => ({ uid: String(i), name: `photo-${i}.jpg`, status: "done" as const, url }))}
          beforeUpload={beforeUpload}
          onRemove={(f) => removePhoto(f.uid)}
          accept="image/*"
          maxCount={6}
        >
          {photos.length < 6 && <div><PlusOutlined /><div style={{ marginTop: 8, fontSize: 12 }}>拍照/上传</div></div>}
        </Upload>
      </Card>

      {/* Step Confirmations */}
      <Card title={t("nipt.library.stepConfirm")} size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map((step: { key: string; label: string }) => {
            const stepLabelMap: Record<string, string> = {
              uv_prep: t("nipt.extraction.stepUvPrep"),
              reagent_prep: t("nipt.extraction.stepReagentPrep"),
              sample_prep: t("nipt.extraction.stepSamplePrep"),
              on_machine: t("nipt.extraction.stepOnMachine"),
              cleanup: t("nipt.extraction.stepCleanup"),
            };
            const manualHide = method === "SINGLE_CHANNEL" && (step.key === "uv_prep" || step.key === "on_machine");
            return (
              <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)} style={manualHide ? { opacity: 0.4 } : undefined}>
                {stepLabelMap[step.key] || step.label}{manualHide ? " " + t("nipt.extraction.manualSkip") : ""}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {/* Signature */}
      <Card title={t("nipt.library.signature")} size="small" style={{ marginBottom: 16 }}>
        <Space>
          {opSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setOpModal(true)}>{t("nipt.extraction.operatorLabel")}: {opSigner} ✓</Button> : <Button onClick={()=>setOpModal(true)}>{t("nipt.extraction.operatorSign")}</Button>}
          {rvSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setRvModal(true)}>{t("nipt.extraction.reviewerLabel")}: {rvSigner} ✓</Button> : <Button onClick={()=>setRvModal(true)}>{t("nipt.extraction.reviewerSign")}</Button>}
        </Space>
      </Card>

      {/* Save */}
      <div style={{ textAlign: "right", marginBottom: 16 }}>
        <Button type="primary" onClick={save} loading={saving}>{t("nipt.library.saveRecord")}</Button>
      </div>

      <NiptSignerModal open={opModal} role="operator" roleLabel={t("nipt.extraction.operatorLabel")} batchId={batch.id} currentSigner={opSigner||null} signUrl={`/runs/${batch.id}/library/sign/`} onDone={()=>{setOpModal(false);onRefresh()}} onCancel={()=>setOpModal(false)} />
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel={t("nipt.extraction.reviewerLabel")} batchId={batch.id} currentSigner={rvSigner||null} signUrl={`/runs/${batch.id}/library/sign/`} onDone={()=>{setRvModal(false);onRefresh()}} onCancel={()=>setRvModal(false)} />
    </div>
  );
}

