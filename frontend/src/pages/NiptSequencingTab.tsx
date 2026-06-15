import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";

// ── Platform options grouped by region ──
const PLATFORM_OPTIONS = [
  {
    label: "泰国",
    options: [
      { value: "ILLUMINA_500", label: "illumina500" },
      { value: "SIKUN_2000", label: "Sikun2000（未来投放）" },
    ],
  },
  {
    label: "厦门",
    options: [
      { value: "ILLUMINA_550DX", label: "illumina550dx" },
      { value: "SALUS_PRO", label: "Salus Pro" },
    ],
  },
  {
    label: "巴西",
    options: [
      { value: "MGI_G99", label: "MGI G99" },
    ],
  },
];

// ── Equipment (sequencers + PCR only) ──
const EQUIPMENT_OPTIONS = [
  { value: "ILLUMINA_500", label: "illumina500" },
  { value: "ILLUMINA_550DX", label: "illumina550dx" },
  { value: "SALUS_PRO", label: "Salus Pro" },
  { value: "SIKUN_2000", label: "Sikun2000" },
  { value: "MGI_G99", label: "MGI G99" },
  { value: "PCR_ABI_9700", label: "PCR仪 - ABI 9700" },
  { value: "PCR_ABI_Veriti", label: "PCR仪 - ABI Veriti" },
  { value: "PCR_BioRad_T100", label: "PCR仪 - Bio-Rad T100" },
];

// ── Chip / Flow Cell by platform ──
const CHIP_OPTIONS_BY_PLATFORM: Record<string, { value: string; label: string }[]> = {
  ILLUMINA_500: [
    { value: "S1", label: "S1 Flow Cell" },
    { value: "S2", label: "S2 Flow Cell" },
    { value: "S4", label: "S4 Flow Cell" },
  ],
  ILLUMINA_550DX: [
    { value: "S1", label: "S1 Flow Cell" },
    { value: "S2", label: "S2 Flow Cell" },
  ],
  SALUS_PRO: [
    { value: "FCL", label: "FCL Chip" },
    { value: "FCS", label: "FCS Chip" },
  ],
  SIKUN_2000: [
    { value: "FCL", label: "FCL Chip" },
    { value: "FCS", label: "FCS Chip" },
  ],
  MGI_G99: [
    { value: "FCL", label: "FCL Chip" },
    { value: "FCS", label: "FCS Chip" },
  ],
};

const READ_TYPE_OPTIONS = [
  { value: "SE75", label: "SE75" },
  { value: "SE100", label: "SE100" },
  { value: "PE150", label: "PE150" },
];

const QC_OPTIONS = [
  { value: "PASS", label: "✅ 合格" },
  { value: "FAIL", label: "❌ 不合格" },
];

// ── Default reagent types ──
const DEFAULT_REAGENT_TYPES = ["测序试剂", "芯片/Flow Cell", "清洗液"];

// ── Reagent kits by platform ──
const REAGENT_KITS_BY_PLATFORM: Record<string, Record<string, { value: string; label: string }[]>> = {
  ILLUMINA_500: {
    "测序试剂": [{ value: "NextSeq500_High_v2.5", label: "NextSeq 500 High Output v2.5" }],
    "芯片/Flow Cell": [{ value: "S1_FlowCell", label: "S1 Flow Cell" }, { value: "S2_FlowCell", label: "S2 Flow Cell" }],
    "清洗液": [{ value: "Wash_Buffer_A", label: "Wash Buffer A" }],
  },
  ILLUMINA_550DX: {
    "测序试剂": [{ value: "NextSeq550_High_v2.5", label: "NextSeq 550 High Output v2.5" }],
    "芯片/Flow Cell": [{ value: "S1_FlowCell", label: "S1 Flow Cell" }, { value: "S2_FlowCell", label: "S2 Flow Cell" }],
    "清洗液": [{ value: "Wash_Buffer_A", label: "Wash Buffer A" }],
  },
  SALUS_PRO: {
    "测序试剂": [{ value: "Salus_Seq_Kit_v1", label: "Salus Pro Sequencing Kit v1" }],
    "芯片/Flow Cell": [{ value: "FCL_Chip", label: "FCL Chip" }, { value: "FCS_Chip", label: "FCS Chip" }],
    "清洗液": [{ value: "Salus_Wash", label: "Salus Wash Buffer" }],
  },
  SIKUN_2000: {
    "测序试剂": [{ value: "Sikun_Seq_Kit", label: "Sikun2000 Sequencing Kit" }],
    "芯片/Flow Cell": [{ value: "FCL_Chip", label: "FCL Chip" }, { value: "FCS_Chip", label: "FCS Chip" }],
    "清洗液": [{ value: "Sikun_Wash", label: "Sikun Wash Buffer" }],
  },
  MGI_G99: {
    "测序试剂": [{ value: "MGI_G99_Standard", label: "MGI G99 Standard Kit" }],
    "芯片/Flow Cell": [{ value: "FCL_Chip", label: "FCL Chip" }, { value: "FCS_Chip", label: "FCS Chip" }],
    "清洗液": [{ value: "MGI_Wash", label: "MGI Wash Buffer" }],
  },
};

const STEPS = [
  { key: "clean_equip", label: "设备准备（清洗）" },
  { key: "reagent_prep", label: "试剂准备（解冻、混匀、离心）" },
  { key: "sample_prep", label: "样本准备" },
  { key: "on_machine", label: "上机测序" },
  { key: "cleanup", label: "实验结束（清洁台面、紫外 30min）" },
];

interface ReagentRow {
  id: number;
  type: string;
  kit: string;
  lot: string;
  expiry: string;
}

interface Props {
  batch: any;
  onRefresh: () => void;
}

function getSignStatus(edata: any, role: "operator" | "reviewer") {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = edata?.[key];
  if (!sig || typeof sig !== "object" || !sig.username) return { signed: false, name: "", time: "" };
  return { signed: true, name: sig.username, time: sig.signed_at || "" };
}

let reagentIdCounter = 100;

export default function NiptSequencingTab({ batch, onRefresh }: Props) {
  const [form] = Form.useForm();
  const edata = useMemo(() => batch.sequencing_data || {}, [batch.sequencing_data]);
  const [platform, setPlatform] = useState(edata.platform || "");
  const [steps, setSteps] = useState<Record<string, boolean>>(edata.step_confirmations || {});
  const [saving, setSaving] = useState(false);
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);

  const { signed: opSigned, name: opSigner } = getSignStatus(edata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(edata, "reviewer");

  // Reagent rows
  const [reagents, setReagents] = useState<ReagentRow[]>(() => {
    if (edata.reagents && Array.isArray(edata.reagents)) {
      return edata.reagents.map((r: any, i: number) => ({
        id: i + 1,
        type: r.type || "",
        kit: r.kit || "",
        lot: r.lot || "",
        expiry: r.expiry || "",
      }));
    }
    return DEFAULT_REAGENT_TYPES.map((t, i) => ({
      id: i + 1,
      type: t,
      kit: "",
      lot: "",
      expiry: "",
    }));
  });

  // Chip options based on platform
  const chipOptions = useMemo(() => CHIP_OPTIONS_BY_PLATFORM[platform] || [], [platform]);
  // Reagent kits based on platform
  const reagentKits = useMemo(() => REAGENT_KITS_BY_PLATFORM[platform] || {}, [platform]);

  // Load saved form data
  useEffect(() => {
    form.setFieldsValue({
      seq_date: edata.seq_date ? dayjs(edata.seq_date) : undefined,
      seq_time: edata.seq_time || "",
      equipment: edata.equipment || [],
      chip: edata.chip || undefined,
      conc_pM: edata.conc_pM ?? undefined,
      read_type: edata.read_type || undefined,
      target_reads: edata.target_reads ?? undefined,
      actual_reads: edata.actual_reads ?? undefined,
      q30: edata.q30 ?? undefined,
      qc_result: edata.qc_result || undefined,
      temperature: edata.temperature ?? undefined,
      humidity: edata.humidity ?? undefined,
    });
    setSteps(edata.step_confirmations || {});
    if (edata.platform) setPlatform(edata.platform);
  }, [edata, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));

  const addReagent = () => {
    const id = ++reagentIdCounter;
    setReagents(prev => [...prev, { id, type: "", kit: "", lot: "", expiry: "" }]);
  };

  const removeReagent = (id: number) => {
    setReagents(prev => prev.filter(r => r.id !== id));
  };

  const updateReagent = (id: number, field: keyof ReagentRow, value: string) => {
    setReagents(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const save = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      const seqData = {
        platform,
        seq_date: vals.seq_date?.format("YYYY-MM-DD"),
        seq_time: vals.seq_time,
        equipment: vals.equipment,
        chip: vals.chip,
        reagents: reagents.filter(r => r.type),
        conc_pM: vals.conc_pM,
        read_type: vals.read_type,
        target_reads: vals.target_reads,
        actual_reads: vals.actual_reads,
        q30: vals.q30,
        qc_result: vals.qc_result,
        temperature: vals.temperature,
        humidity: vals.humidity,
        step_confirmations: steps,
      };
      await api.post(`/runs/${batch.id}/save_sequencing/`, {
        sequencing_data: seqData,
      });
      message.success("上机测序记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      message.error(e?.response?.data?.error || "保存失败");
    } finally { setSaving(false); }
  };

  return (
    <div>
      {/* Platform */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Form.Item label="测序平台" required>
            <Select
              options={PLATFORM_OPTIONS}
              value={platform || undefined}
              onChange={setPlatform}
              placeholder="选择测序平台"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Col>
        <Col span={8} style={{ display: "flex", alignItems: "center", paddingTop: 6 }}>
          <span style={{ fontSize: 12, color: "#888" }}>
            {platform ? `${PLATFORM_OPTIONS.flatMap(g => g.options).find(o => o.value === platform)?.label || platform}` : ""}
          </span>
        </Col>
      </Row>

      <Form form={form} layout="vertical">
        {/* Basic info */}
        <Card size="small" title="基本信息" style={{ marginBottom: 12 }}>
          <Row gutter={[16, 8]}>
            <Col span={6}>
              <Form.Item name="seq_date" label="实验日期" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="seq_time" label="实验时间" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Input placeholder="例：09:00" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="equipment" label="设备类型" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Select mode="multiple" options={EQUIPMENT_OPTIONS} placeholder="测序仪 / PCR仪" maxTagCount={2} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="chip" label="芯片/Flow Cell" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Select options={chipOptions} placeholder="选择芯片" disabled={!platform} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="conc_pM" label="上样浓度 (pM)" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 12" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="read_type" label="Reads 类型" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Select options={READ_TYPE_OPTIONS} placeholder="选择" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="target_reads" label="目标数据量 (M reads)" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 25" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="actual_reads" label="实际数据量 (M reads)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 25.3" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="q30" label="Q30 (%)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 92.5" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="qc_result" label="质控结果" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                <Select options={QC_OPTIONS} placeholder="Pass / Fail" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="temperature" label="环境温度 (℃)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={50} step={0.1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="humidity" label="环境湿度 (%)" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Form>

      {/* Reagents */}
      <Card
        size="small"
        title="试剂"
        extra={<Button size="small" icon={<PlusOutlined />} onClick={addReagent}>添加试剂</Button>}
        style={{ marginBottom: 12 }}
      >
        {reagents.length === 0 ? (
          <div style={{ textAlign: "center", padding: 16, color: "#999", fontSize: 12 }}>
            暂无试剂，点击「添加试剂」添加
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thStyle}>试剂名称</th>
                  <th style={thStyle}>试剂盒</th>
                  <th style={thStyle}>批次号</th>
                  <th style={thStyle}>有效期</th>
                  <th style={{ ...thStyle, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {reagents.map(r => {
                  const kits = reagentKits[r.type] || [];
                  return (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        <Select
                          size="small"
                          value={r.type || undefined}
                          onChange={v => { updateReagent(r.id, "type", v); updateReagent(r.id, "kit", ""); }}
                          options={["测序试剂", "芯片/Flow Cell", "清洗液", "NaOH变性液", "其他"].map(t => ({ value: t, label: t }))}
                          placeholder="类型"
                          style={{ width: "100%" }}
                          bordered={false}
                        />
                      </td>
                      <td style={tdStyle}>
                        <Select
                          size="small"
                          value={r.kit || undefined}
                          onChange={v => updateReagent(r.id, "kit", v)}
                          options={kits}
                          placeholder="选择试剂盒"
                          style={{ width: "100%", minWidth: 120 }}
                          bordered={false}
                          showSearch
                          optionFilterProp="label"
                          popupMatchSelectWidth={false}
                        />
                      </td>
                      <td style={tdStyle}>
                        <Input
                          size="small"
                          value={r.lot}
                          onChange={e => updateReagent(r.id, "lot", e.target.value)}
                          placeholder="批次号"
                          bordered={false}
                          style={{ textAlign: "center" }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <DatePicker
                          size="small"
                          picker="month"
                          value={r.expiry ? dayjs(r.expiry) : null}
                          onChange={d => updateReagent(r.id, "expiry", d?.format("YYYY-MM") || "")}
                          placeholder="YYYY-MM"
                          style={{ width: "100%" }}
                          bordered={false}
                          format="YYYY-MM"
                        />
                      </td>
                      <td style={tdStyle}>
                        <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => removeReagent(r.id)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Step Confirmations */}
      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map(step => (
            <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)}>
              {step.label}
            </Checkbox>
          ))}
        </Space>
      </Card>

      {/* Signature */}
      <Card title="电子签名" size="small" style={{ marginBottom: 16 }}>
        <Space>
          {opSigned
            ? <Button style={{ color: "#52c41a", borderColor: "#52c41a" }} onClick={() => setOpModal(true)}>操作人: {opSigner} ✓</Button>
            : <Button onClick={() => setOpModal(true)}>操作人签名</Button>
          }
          {rvSigned
            ? <Button style={{ color: "#52c41a", borderColor: "#52c41a" }} onClick={() => setRvModal(true)}>复核人: {rvSigner} ✓</Button>
            : <Button onClick={() => setRvModal(true)}>复核人签名</Button>
          }
        </Space>
      </Card>

      {/* Save */}
      <div style={{ textAlign: "right", marginBottom: 16 }}>
        <Button type="primary" onClick={save} loading={saving}>保存上机测序记录</Button>
      </div>

      <NiptSignerModal
        open={opModal} role="operator" roleLabel="操作人" batchId={batch.id}
        currentSigner={opSigner || null}
        signUrl={`/runs/${batch.id}/sequencing/sign/`}
        onDone={() => { setOpModal(false); onRefresh(); }} onCancel={() => setOpModal(false)}
      />
      <NiptSignerModal
        open={rvModal} role="reviewer" roleLabel="复核人" batchId={batch.id}
        currentSigner={rvSigner || null}
        signUrl={`/runs/${batch.id}/sequencing/sign/`}
        onDone={() => { setRvModal(false); onRefresh(); }} onCancel={() => setRvModal(false)}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  border: "1px solid #bbb", padding: "6px 8px", textAlign: "center",
  fontWeight: 700, background: "#d5e8d4", fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #d9d9d9", padding: 0, minHeight: 32,
};
