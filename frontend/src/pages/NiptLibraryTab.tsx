import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber } from "antd";
import dayjs from "dayjs";
import api from "../api/client";

// ── Library prep methods ──
const LIBRARY_METHODS = [
  { value: "SINGLE_CHANNEL", label: "单枪建库" },
  { value: "MULTI_CHANNEL", label: "排枪建库" },
  { value: "AUTOMATED", label: "自动化移液工作站建库" },
];

const REGIONS = [
  { value: "THAILAND", label: "泰国" },
  { value: "XIAMEN", label: "厦门" },
  { value: "HONGKONG", label: "香港" },
  { value: "BRAZIL", label: "巴西" },
];

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

const STEPS = [
  { key: "uv_prep", label: "设备准备（紫外 30min）" },
  { key: "reagent_prep", label: "试剂准备（混匀、离心）" },
  { key: "sample_prep", label: "样本准备" },
  { key: "on_machine", label: "上机" },
  { key: "cleanup", label: "实验结束（清洁台面、紫外 30min）" },
];

const ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COL_COUNT = 12;

// ── Get VG ID from sample ──
function getVgId(s: any): string {
  return s?.sample_vg_id || s?.vg_id || s?.sample_id || s?.sample_barcode || "-";
}

interface PlateCell {
  vgId: string;
  index: string;
}

interface Props {
  batch: any;
  samples: any[];
  onRefresh: () => void;
}

export default function NiptLibraryTab({ batch, samples, onRefresh }: Props) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState(batch.library_method || "MULTI_CHANNEL");
  const [region, setRegion] = useState(batch.region || "");
  const edata = useMemo(() => batch.library_data || {}, [batch.library_data]);

  // ── Plate state: 8×12 cells, each with {vgId, index} ──
  const [plate, setPlate] = useState<PlateCell[][]>([]);

  // ── Build 96-well plate based on extraction method ──
  const buildPlate = useMemo(() => {
    const p: PlateCell[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: COL_COUNT }, () => ({ vgId: "", index: "" }))
    );
    if (!samples || samples.length === 0) return p;

    const extMethod = batch.extraction_method || "MANUAL";

    if (extMethod === "AUTOMATED") {
      // Automated: center-out fill, same as extraction table
      // colOrder: 6,7,5,8,4,9,3,10,2,11,1,12 (0-based: 5,6,4,7,3,8,2,9,1,10,0,11)
      const colOrder = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10, 0, 11];
      let idx = 0;
      for (const c of colOrder) {
        for (let r = 0; r < 8; r++) {
          if (idx < samples.length) {
            p[r][c] = { vgId: getVgId(samples[idx]), index: "" };
            idx++;
          }
        }
      }
    } else {
      // MANUAL / MAGNETIC_ROD: sequential fill top→bottom then right (column-major)
      const maxSamples = Math.min(samples.length, 96);
      for (let i = 0; i < maxSamples; i++) {
        const col = Math.floor(i / 8);
        const row = i % 8;
        p[row][col] = { vgId: getVgId(samples[i]), index: "" };
      }
    }
    return p;
  }, [samples, batch.extraction_method]);

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

  // Load saved form data
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
      lib_kit_expiry: edata.lib_kit_expiry || "",
      index_kit_lot: edata.index_kit_lot || "",
      index_kit_expiry: edata.index_kit_expiry || "",
      quant_kit_lot: edata.quant_kit_lot || "",
      quant_kit_expiry: edata.quant_kit_expiry || "",
      bead_kit_lot: edata.bead_kit_lot || "",
      bead_kit_expiry: edata.bead_kit_expiry || "",
      cfDNA_volume: edata.cfDNA_volume ?? undefined,
      pcr_cycles: edata.pcr_cycles ?? 8,
      elution_volume: edata.elution_volume ?? 30,
      temperature: edata.temperature ?? undefined,
      humidity: edata.humidity ?? undefined,
    });
    setSteps(edata.step_confirmations || {});
    if (batch.library_method) setMethod(batch.library_method);
    if (batch.region) setRegion(batch.region);
  }, [edata, batch, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));
  const kits = KITS_BY_REGION[region] || KITS_BY_REGION.XIAMEN;

  // ── Update index for a specific cell ──
  const updateIndex = (row: number, col: number, value: string) => {
    setPlate(prev => {
      const next = prev.map(r => [...r]);
      next[row] = [...next[row]];
      next[row][col] = { ...next[row][col], index: value };
      return next;
    });
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
          lib_kit_expiry: vals.lib_kit_expiry,
          index_kit: vals.index_kit,
          index_kit_lot: vals.index_kit_lot,
          index_kit_expiry: vals.index_kit_expiry,
          quant_kit: vals.quant_kit,
          quant_kit_lot: vals.quant_kit_lot,
          quant_kit_expiry: vals.quant_kit_expiry,
          bead_kit: vals.bead_kit,
          bead_kit_lot: vals.bead_kit_lot,
          bead_kit_expiry: vals.bead_kit_expiry,
          cfDNA_volume: vals.cfDNA_volume,
          pcr_cycles: vals.pcr_cycles,
          elution_volume: vals.elution_volume,
          temperature: vals.temperature,
          humidity: vals.humidity,
          step_confirmations: steps,
          library_plate: plateData,
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
      <Col span={8}>
        <Form.Item name={name} label={label} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Select options={kitOptions} placeholder={`选择${label}`} showSearch optionFilterProp="label" />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name={lotName} label="批次" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <Input placeholder="批次号" />
        </Form.Item>
      </Col>
      <Col span={6}>
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
    padding: "2px 4px", fontSize: 11, background: "transparent",
    borderRight: "1px solid #e0e0e0",
  };
  const vgIdStyle: React.CSSProperties = {
    fontSize: 11, padding: "2px 4px", textAlign: "center",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    maxWidth: 80,
  };

  const getCellBg = (vgId: string) => vgId && vgId !== "-"
    ? "#e8f5e9"   // filled: light green
    : "#fafafa";   // empty

  const getExtractionLabel = (): string => {
    const m = batch.extraction_method || "MANUAL";
    if (m === "MANUAL") return "手动提取 → 顺序填充（列优先）";
    if (m === "MAGNETIC_ROD") return "磁棒法提取 → 顺序填充（列优先）";
    return "自动化工作站提取 → 直接复制";
  };

  return (
    <div>
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

      {/* ── 96-Well Library Plate ── */}
      <Card
        size="small"
        title={`建库样本排布 — 96孔板（${samples.length} samples）`}
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
              {ROW_LABELS.map((label, row) => (
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

      {/* Step Confirmations */}
      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map(step => {
            const manualHide = method === "SINGLE_CHANNEL" && (step.key === "uv_prep" || step.key === "on_machine");
            return (
              <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)} style={manualHide ? { opacity: 0.4 } : undefined}>
                {step.label}{manualHide ? " (手动跳过)" : ""}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {/* Save */}
      <div style={{ textAlign: "right", marginBottom: 16 }}>
        <Button type="primary" onClick={save} loading={saving}>保存文库构建记录</Button>
      </div>
    </div>
  );
}
