import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber } from "antd";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { getSignStatus } from "../utils/sign";
import { ROW_LABELS, COL_COUNT, REGIONS, STEPS, getVgId } from "../utils/constants";

// ── Library prep methods ──
const LIBRARY_METHODS = [
  { value: "SINGLE_CHANNEL", label: "单枪建库" },
  { value: "MULTI_CHANNEL", label: "排枪建库" },
  { value: "AUTOMATED", label: "自动化移液工作站建库" },
];

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
      { value: "N34201-01", label: "VAHTS Maxi UDI Adapters Set1 - Cat#N34201-01" },
      { value: "N34202-01", label: "VAHTS Maxi UDI Adapters Set2 - Cat#N34202-01" },
      { value: "N34203-01", label: "VAHTS Maxi UDI Adapters Set3 - Cat#N34203-01" },
      { value: "N34204-01", label: "VAHTS Maxi UDI Adapters Set4 - Cat#N34204-01" },
    ],
    quantKit: [{ value: "EQ121-02", label: "Equalbit 1×dsDNA HS Assay Kit - Cat#EQ121-02" }],
    beadKit: [{ value: "ZB401", label: "ZHIXUAN DNA Clean Beads - Cat#ZB401" }],
  },
  HONGKONG: {
    libKit: [{ value: "ND607-02", label: "VAHTS Universal DNA Library Prep Kit - Cat#ND607-02" }],
    indexKit: [
      { value: "N34201-01", label: "VAHTS Maxi UDI Adapters Set1 - Cat#N34201-01" },
      { value: "N34202-01", label: "VAHTS Maxi UDI Adapters Set2 - Cat#N34202-01" },
      { value: "N34203-01", label: "VAHTS Maxi UDI Adapters Set3 - Cat#N34203-01" },
      { value: "N34204-01", label: "VAHTS Maxi UDI Adapters Set4 - Cat#N34204-01" },
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
}

// getSignStatus imported from ../utils/sign

interface Props {
  batch: any;
  samples: any[];
  onRefresh: () => void;
}

export default function NiptLibraryTab({ batch, samples, onRefresh }: Props) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);
  const [positiveControl, setPositiveControl] = useState("");
  const [negativeControl, setNegativeControl] = useState("");
  const [method, setMethod] = useState(batch.library_method || "MULTI_CHANNEL");
  const [region, setRegion] = useState(batch.region || "");

  // Sync region when batch is updated (e.g. after extraction tab saves a different region)
  useEffect(() => {
    if (batch.region) setRegion(batch.region);
  }, [batch.region]);
  const edata = useMemo(() => batch.library_data || {}, [batch.library_data]);
  const defaultsFetchedRef = useRef(false);
  const { signed: opSigned, name: opSigner } = getSignStatus(edata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(edata, "reviewer");

  // ── Plate state: 8×12 cells, each with {vgId, index} ──
  const [plate, setPlate] = useState<PlateCell[][]>([]);

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

    if (extMethod === "AUTOMATED") {
      // Automated: center-aligned, same as extraction table
      const numCols = Math.min(Math.ceil(sortedSamples.length / 8), COL_COUNT);
      const startCol = Math.floor((COL_COUNT - numCols) / 2);
      let idx = 0;
      for (let c = startCol; c < startCol + numCols; c++) {
        for (let r = 0; r < 8; r++) {
          if (idx < sortedSamples.length) {
            p[r][c] = { vgId: getVgId(sortedSamples[idx]), index: "" };
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
            p[r][c] = { vgId: getVgId(sortedSamples[idx]), index: "" };
            idx++;
          }
        }
      }
    }
    return p;
  }, [samples, batch.extraction_method, batch.extraction_data]);

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

  // Load saved form data + pre-fill from last batch
  useEffect(() => {
    form.setFieldsValue({
      lib_date: edata.lib_date ? dayjs(edata.lib_date) : dayjs(),
      lib_time: edata.lib_time || dayjs().format("HH:mm"),
      equipment: edata.equipment || [],
      lib_kit: edata.lib_kit || undefined,
      index_kit: edata.index_kit || undefined,
      quant_kit: edata.quant_kit || undefined,
      bead_kit: edata.bead_kit || undefined,
      lib_kit_lot: edata.lib_kit_lot || "",
      lib_kit_expiry: edata.lib_kit_expiry ? dayjs(edata.lib_kit_expiry) : undefined,
      index_kit_lot: edata.index_kit_lot || "",
      index_kit_expiry: edata.index_kit_expiry ? dayjs(edata.index_kit_expiry) : undefined,
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
    if (batch.library_method) setMethod(batch.library_method);
    if (batch.region) setRegion(batch.region);
    setPositiveControl(edata.positive_control || "");
    setNegativeControl(edata.negative_control || "");

    // 🆕 Pre-fill reagent & equipment from last batch for new batches
    if (batch.id && !edata.lib_kit && !(edata.equipment || []).length && !defaultsFetchedRef.current) {
      defaultsFetchedRef.current = true;
      api.get("/runs/last_batch_defaults/?panel=NIPT").then((res: any) => {
        const lib = res?.library;
        if (lib) {
          form.setFieldsValue({
            equipment: lib.equipment || [],
            lib_kit: lib.lib_kit || undefined,
            lib_kit_lot: lib.lib_kit_lot || "",
            lib_kit_expiry: lib.lib_kit_expiry ? dayjs(lib.lib_kit_expiry) : undefined,
            index_kit: lib.index_kit || undefined,
            index_kit_lot: lib.index_kit_lot || "",
            index_kit_expiry: lib.index_kit_expiry ? dayjs(lib.index_kit_expiry) : undefined,
            quant_kit: lib.quant_kit || undefined,
            quant_kit_lot: lib.quant_kit_lot || "",
            quant_kit_expiry: lib.quant_kit_expiry ? dayjs(lib.quant_kit_expiry) : undefined,
            bead_kit: lib.bead_kit || undefined,
            bead_kit_lot: lib.bead_kit_lot || "",
            bead_kit_expiry: lib.bead_kit_expiry ? dayjs(lib.bead_kit_expiry) : undefined,
          });
        }
      }).catch(() => {});
    }
  }, [edata, batch, form]);

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
      if (row === 0 && /^\d+$/.test(value.trim())) {
        const base = parseInt(value, 10);
        for (let r = 1; r < 8; r++) {
          next[r] = [...next[r]];
          next[r][col] = { ...next[r][col], index: String(base + r) };
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

  const save = async () => {
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
          index_kit: vals.index_kit,
          index_kit_lot: vals.index_kit_lot,
          index_kit_expiry: vals.index_kit_expiry?.format("YYYY-MM") || "",
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
          library_plate: plateData,
          positive_control: positiveControl,
          negative_control: negativeControl,
        },
      };
      await api.post(`/runs/${batch.id}/save_library/`, payload);
      message.success("文库构建记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      message.error(e?.response?.data?.error || "保存失败");
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
          <Select options={kitOptions} placeholder={`选择${label}`} showSearch optionFilterProp="label" />
        </Form.Item>
      </Col>
      <Col span={4}>
        <Form.Item name={lotName} label="批次" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Input placeholder="批次号" />
        </Form.Item>
      </Col>
      <Col span={5}>
        <Form.Item name={expiryName} label="有效期" style={{ marginBottom: 0 }}>
          <DatePicker picker="month" placeholder="YYYY-MM" style={{ width: "100%" }} format="YYYY-MM" />
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
    if (m === "MANUAL") return `手动提取 → 居中${numCols}列(${colRange})，奇数列开头，${validCount}/${totalSamples}样本`;
    if (m === "MAGNETIC_ROD") return `磁棒法提取 → 居中${numCols}列(${colRange})，奇数列开头，${validCount}/${totalSamples}样本`;
    return `自动化工作站提取 → 居中${numCols}列，${validCount}/${totalSamples}样本`;
  };

  return (
    <div id="lib-print-area">
      {/* Method & Region */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Form.Item label="建库方式" required>
            <Select options={LIBRARY_METHODS} value={method} onChange={setMethod} placeholder="选择建库方式" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Region" required>
            <Select options={REGIONS} value={region || undefined} onChange={setRegion} placeholder="Select region" />
          </Form.Item>
        </Col>
        <Col span={8} style={{ display: "flex", alignItems: "center", paddingTop: 6 }}>
          <span style={{ fontSize: 12, color: "#888" }}>
            填充规则：{getExtractionLabel()}
          </span>
        </Col>
      </Row>

      {/* QC Controls */}
      <Card size="small" title="质控品" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>阳性质控品</span>
              <Input
                placeholder="批次号/编号"
                value={positiveControl}
                onChange={e => setPositiveControl(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </Col>
          <Col span={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>阴性质控品</span>
              <Input
                placeholder="批次号/编号"
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
          <Col span={6}><Form.Item name="lib_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="lib_time" label="实验时间" rules={[{ required: true }]}><Input placeholder="例：09:00" /></Form.Item></Col>
          <Col span={6}>
            <Form.Item name="equipment" label="设备类型" rules={[{ required: true }]}>
              <Select mode="multiple" options={EQUIPMENT_OPTIONS} placeholder="选择设备" maxTagCount={2} />
            </Form.Item>
          </Col>
        </Row>

        {/* Reagent kits - 4 rows */}
        <Card size="small" title="建库试剂盒及配套试剂" style={{ marginBottom: 12 }}>
          <ReagentRow name="lib_kit" label="建库试剂" kitOptions={kits.libKit} lotName="lib_kit_lot" expiryName="lib_kit_expiry" />
          <ReagentRow name="index_kit" label="Index" kitOptions={kits.indexKit} lotName="index_kit_lot" expiryName="index_kit_expiry" />
          <ReagentRow name="quant_kit" label="定量试剂" kitOptions={kits.quantKit} lotName="quant_kit_lot" expiryName="quant_kit_expiry" />
          <ReagentRow name="bead_kit" label="纯化磁珠" kitOptions={kits.beadKit} lotName="bead_kit_lot" expiryName="bead_kit_expiry" />
        </Card>

        {/* Volumes & cycles */}
        <Row gutter={16}>
          <Col span={6}><Form.Item name="cfDNA_volume" label="cfDNA投入体积 (μL)" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="pcr_cycles" label="扩增循环数" rules={[{ required: true }]}><InputNumber min={0} max={20} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="elution_volume" label="文库洗脱体积 (μL)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="temperature" label="环境温度 (℃)"><InputNumber min={0} max={50} step={0.1} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="humidity" label="环境湿度 (%)"><InputNumber min={0} max={100} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
      </Form>

      {/* ── 96-Well Library Plate ── */}
      <Card
        size="small"
        className="no-print-break"
        title={<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}><span>建库样本排布 — 96孔板（{samples.length} samples）</span><Button size="small" onClick={handlePrint} >打印</Button></div>}
        style={{ marginBottom: 16 }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
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
                    const bg = getCellBg(cell.vgId);
                    return (
                      <td key={col} style={{ ...cellStyle, background: bg }}>
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
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      
      {/* Step Confirmations */}
      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map((step: { key: string; label: string }) => {
            const manualHide = method === "SINGLE_CHANNEL" && (step.key === "uv_prep" || step.key === "on_machine");
            return (
              <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)} style={manualHide ? { opacity: 0.4 } : undefined}>
                {step.label}{manualHide ? " (手动跳过)" : ""}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {/* Signature */}
      <Card title="电子签名" size="small" style={{ marginBottom: 16 }}>
        <Space>
          {opSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setOpModal(true)}>操作人: {opSigner} ✓</Button> : <Button onClick={()=>setOpModal(true)}>操作人签名</Button>}
          {rvSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setRvModal(true)}>复核人: {rvSigner} ✓</Button> : <Button onClick={()=>setRvModal(true)}>复核人签名</Button>}
        </Space>
      </Card>

      {/* Save */}
      <div style={{ textAlign: "right", marginBottom: 16 }}>
        <Button type="primary" onClick={save} loading={saving}>保存文库构建记录</Button>
      </div>

      <NiptSignerModal open={opModal} role="operator" roleLabel="操作人" batchId={batch.id} currentSigner={opSigner||null} signUrl={`/runs/${batch.id}/library/sign/`} onDone={()=>{setOpModal(false);onRefresh()}} onCancel={()=>setOpModal(false)} />
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel="复核人" batchId={batch.id} currentSigner={rvSigner||null} signUrl={`/runs/${batch.id}/library/sign/`} onDone={()=>{setRvModal(false);onRefresh()}} onCancel={()=>setRvModal(false)} />
    </div>
  );
}

