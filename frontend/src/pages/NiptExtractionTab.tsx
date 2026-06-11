import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Typography } from "antd";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";

// Extraction method options
const EXTRACTION_METHODS = [
  { value: "MANUAL", label: "Manual (手动提取)" },
  { value: "MAGNETIC_ROD", label: "Magnetic Rod (磁棒法)" },
  { value: "AUTOMATED", label: "Automated Workstation (自动化工作站)" },
];

const REGIONS = [
  { value: "THAILAND", label: "泰国" },
  { value: "XIAMEN", label: "厦门" },
  { value: "HONGKONG", label: "香港" },
  { value: "BRAZIL", label: "巴西" },
];

// Reagent kits by region
const KITS_BY_REGION: Record<string, { value: string; label: string }[]> = {
  THAILAND: [
    { value: "ZEC601-T96", label: "MagPure Circulating DNA TL Kit (1.2ml, 48ch) - ZEC601-T96" },
    { value: "ZEC601", label: "MagPure Circulating DNA Kit (0.4ml) - ZEC601" },
  ],
  XIAMEN: [
    { value: "MD5432-TL-06C", label: "磁珠法游离DNA提取试剂盒 - MD5432-TL-06C" },
    { value: "12919w-480", label: "磁珠法游离DNA提取试剂盒 - 12919w-480" },
  ],
  HONGKONG: [
    { value: "MD5432-RB", label: "磁珠法游离DNA提取试剂盒 (圆底) - MD5432-TL-06C" },
    { value: "MD5432-CB", label: "磁珠法游离DNA提取试剂盒 (锥底) - MD5432-TL-06C" },
  ],
  BRAZIL: [
    { value: "TBD", label: "待定" },
  ],
};

const STEPS = [
  { key: "uv_prep", label: "设备准备（紫外 30min）" },
  { key: "reagent_prep", label: "试剂准备（混匀、离心）" },
  { key: "sample_prep", label: "样本准备" },
  { key: "on_machine", label: "上机" },
  { key: "cleanup", label: "实验结束（清洁台面、紫外 30min）" },
];

const ROWS_8 = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function getSignStatus(edata: any, role: "operator" | "reviewer") {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = edata?.[key];
  if (!sig || typeof sig !== "object" || !sig.username) return { signed: false, name: "", time: "" };
  return { signed: true, name: sig.username, time: sig.signed_at || "" };
}

interface Props {
  batch: any;
  samples: any[];
  onRefresh: () => void;
}

const { Text } = Typography;

export default function NiptExtractionTab({ batch, samples, onRefresh }: Props) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState(batch.extraction_method || "");
  const [manualNotes, setManualNotes] = useState("");
  const [region, setRegion] = useState(batch.region || "");
  const edata = useMemo(() => batch.extraction_data || {}, [batch.extraction_data]);

  // Load saved data
  useEffect(() => {
    form.setFieldsValue({
      extraction_date: edata.extraction_date ? dayjs(edata.extraction_date) : dayjs(),
      extraction_time: edata.extraction_time || dayjs().format("HH:mm"),
      equipment: edata.equipment || "",
      kit_type: edata.kit_type || undefined,
      reagent_lot: edata.reagent_lot || "",
      reagent_expiry: edata.reagent_expiry || "",
      plasma_volume: edata.plasma_volume ?? undefined,
      elution_volume: edata.elution_volume ?? undefined,
      temperature: edata.temperature ?? undefined,
      humidity: edata.humidity ?? undefined,
    });
    setSteps(edata.step_confirmations || {});
    setManualNotes(edata.manual_notes || "");
    if (batch.extraction_method) setMethod(batch.extraction_method);
    if (batch.region) setRegion(batch.region);
  }, [edata, batch, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      const payload = {
        extraction_method: method,
        region,
        extraction_data: {
          extraction_date: vals.extraction_date?.format("YYYY-MM-DD"),
          extraction_time: vals.extraction_time,
          equipment: vals.equipment || "",
          kit_type: vals.kit_type || "",
          reagent_lot: vals.reagent_lot || "",
          reagent_expiry: vals.reagent_expiry || "",
          plasma_volume: vals.plasma_volume,
          elution_volume: vals.elution_volume,
          temperature: vals.temperature,
          humidity: vals.humidity,
          step_confirmations: steps,
          manual_notes: manualNotes,
        },
      };
      await api.post(`/runs/${batch.id}/save_extraction/`, payload);
      message.success("核酸提取记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      message.error(e?.response?.data?.error || "保存失败");
    } finally { setSaving(false); }
  };

  const { signed: opSigned, name: opSigner } = getSignStatus(edata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(edata, "reviewer");
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);

  const kits = KITS_BY_REGION[region] || [];

  // Sample-to-well assignment
  const sampleWells = useMemo(() => {
    const map: Record<string, string> = {};
    if (edata.well_assignments) {
      Object.entries(edata.well_assignments as Record<string, string>).forEach(([k, v]) => { map[k] = v; });
    }
    return map;
  }, [edata.well_assignments]);

  const getWellSample = (well: string) => {
    const sid = sampleWells[well];
    return sid ? samples.find((s: any) => s.id === sid || s.sample_id === sid) : null;
  };

  return (
    <div>
      {/* Method & Region */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Form.Item label="Extraction Method" required>
            <Select options={EXTRACTION_METHODS} value={method || undefined} onChange={setMethod} placeholder="Select method" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Region" required>
            <Select options={REGIONS} value={region || undefined} onChange={setRegion} placeholder="Select region" />
          </Form.Item>
        </Col>
      </Row>

      {/* Common Form Fields */}
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="extraction_date" label="实验日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="extraction_time" label="实验时间">
              <Input placeholder="例：09:00" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="equipment" label="设备类型">
              <Input placeholder="预留" disabled />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="kit_type" label="提取试剂盒" rules={[{ required: true }]}>
              <Select options={kits} placeholder="选择试剂盒" showSearch optionFilterProp="label" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="reagent_lot" label="试剂批次" rules={[{ required: true }]}>
              <Input placeholder="批次号" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="reagent_expiry" label="有效期">
              <Input placeholder="YYYY-MM" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="plasma_volume" label="血浆投入体积 (mL)" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 4.0" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="elution_volume" label="CfDNA洗脱体积 (μL)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 60" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="temperature" label="环境温度 (℃)">
              <InputNumber min={0} max={50} step={0.1} style={{ width: "100%" }} placeholder="e.g. 25" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="humidity" label="环境湿度 (%)">
              <InputNumber min={0} max={100} style={{ width: "100%" }} placeholder="e.g. 55" />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {/* Step Confirmations */}
      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map(step => {
            const manualHide = method === "MANUAL" && (step.key === "uv_prep" || step.key === "on_machine");
            return (
              <Checkbox
                key={step.key}
                checked={!!steps[step.key]}
                onChange={() => toggleStep(step.key)}
                style={manualHide ? { opacity: 0.4 } : undefined}
              >
                {step.label}{manualHide ? " (手动跳过)" : ""}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {/* Sample Layout — varies by method */}
      {method === "MANUAL" && (() => {
        const TH = {
          border: "1px solid #bbb", padding: "4px 6px", textAlign: "center" as const,
          fontWeight: 700, background: "#e8e8e8", fontSize: 12,
        };
        const TD_NUM = {
          border: "1px solid #d9d9d9", padding: "3px 6px", textAlign: "center" as const,
          fontWeight: 600, color: "#595959", fontSize: 12, minWidth: 36,
        };
        const TD_SAMPLE = {
          border: "1px solid #d9d9d9", padding: "3px 6px",
          fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
          minWidth: 90, color: "#1d1d1d",
        };
        const totalSamples = samples.length;
        const getLabel = (idx: number) => {
          const s = samples[idx];
          return s ? (s.sample_vg_id || s.sample_barcode || s.vg_id || s.sample_id || "-") : "-";
        };
        return (
          <Card
            title={`手动提取登记 (${totalSamples} samples，共 48 个样本位)`}
            extra={
              <Input.TextArea
                placeholder="备注（试剂批号差异、操作异常等）"
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 3 }}
                style={{ width: 320, fontSize: 12 }}
                allowClear
              />
            }
            size="small"
            style={{ marginBottom: 8 }}
            bodyStyle={{ padding: 0 }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <colgroup>
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#e8e8e8" }}>
                  <th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th>
                  <th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th>
                  <th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(row => {
                  const bg = row % 2 === 0 ? "#fff" : "#f5f5f5";
                  const c0 = row;        // 序号 1-16
                  const c1 = 16 + row;   // 序号 17-32
                  const c2 = 32 + row;   // 序号 33-48
                  return (
                    <tr key={`r${row}`} style={{ background: bg }}>
                      <td style={TD_NUM}>{c0 + 1}</td>
                      <td style={{ ...TD_SAMPLE, background: bg }}>{getLabel(c0)}</td>
                      <td style={TD_NUM}>{c1 + 1}</td>
                      <td style={{ ...TD_SAMPLE, background: bg }}>{getLabel(c1)}</td>
                      <td style={TD_NUM}>{c2 + 1}</td>
                      <td style={{ ...TD_SAMPLE, background: bg }}>{getLabel(c2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ textAlign: "center", padding: "4px 0" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                按列从上到下排列（左列 1→16，中列 17→32，右列 33→48），序号方便一眼确认提取数量
              </Text>
            </div>
          </Card>
        );
      })()}

      {(method === "MAGNETIC_ROD" || method === "AUTOMATED") && (
        <Card
          title={`${method === "MAGNETIC_ROD" ? "磁棒法" : "自动化工作站"} Plate (${samples.length} samples)`}
          size="small"
          style={{ marginBottom: 16 }}
        >
          {method === "MAGNETIC_ROD" && (
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">产物在第 6 和 12 列</Text>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(13, 1fr)", gap: 1, fontSize: 11 }}>
            <div style={{ fontWeight: 600, color: "#8c8c8c", textAlign: "center" }}></div>
            {COLS_12.map(c => (
              <div key={c} style={{
                fontWeight: 600, textAlign: "center", background: "#f0f0f0", padding: "2px 0",
                ...(method === "MAGNETIC_ROD" && (c === 6 || c === 12) ? { background: "#fff1f0", color: "#cf1322" } : {}),
              }}>
                {c}
              </div>
            ))}
            {ROWS_8.map(r => (
              <>
                <div key={r} style={{ fontWeight: 600, textAlign: "center", background: "#f0f0f0", padding: "4px 0" }}>{r}</div>
                {COLS_12.map(c => {
                  const wl = `${r}${c}`;
                  const sample = getWellSample(wl);
                  const isProduct = method === "MAGNETIC_ROD" && (c === 6 || c === 12);
                  const colBg = isProduct ? "#fff1f0" : "#fff";
                  return (
                    <div key={wl} style={{
                      border: "1px solid #d9d9d9", padding: "2px", minHeight: 36,
                      background: sample ? "#f6ffed" : colBg, textAlign: "center",
                      overflow: "hidden",
                    }}>
                      {sample ? (
                        <div style={{ fontSize: 9, color: "#52c41a" }}>{sample.sample_id?.slice(-6)}</div>
                      ) : isProduct ? (
                        <div style={{ fontSize: 9, color: "#cf1322" }}>产物</div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </Card>
      )}

      {/* Actions & Signatures */}
      <Space>
        <Button type="primary" onClick={save} loading={saving}>保存提取记录</Button>
        {opSigned ? (
          <Button style={{ color: "#52c41a", borderColor: "#52c41a" }} onClick={() => setOpModal(true)}>
            操作人: {opSigner} ✓
          </Button>
        ) : (
          <Button onClick={() => setOpModal(true)}>操作人签名</Button>
        )}
        {rvSigned ? (
          <Button style={{ color: "#52c41a", borderColor: "#52c41a" }} onClick={() => setRvModal(true)}>
            复核人: {rvSigner} ✓
          </Button>
        ) : (
          <Button onClick={() => setRvModal(true)}>复核人签名</Button>
        )}
      </Space>

      <NiptSignerModal
        open={opModal} role="operator" roleLabel="操作人"
        batchId={batch.id} currentSigner={opSigner || null}
        onDone={() => { setOpModal(false); onRefresh(); }}
        onCancel={() => setOpModal(false)}
      />
      <NiptSignerModal
        open={rvModal} role="reviewer" roleLabel="复核人"
        batchId={batch.id} currentSigner={rvSigner || null}
        onDone={() => { setRvModal(false); onRefresh(); }}
        onCancel={() => setRvModal(false)}
      />
    </div>
  );
}
