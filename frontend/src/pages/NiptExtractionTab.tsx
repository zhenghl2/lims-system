import { useEffect, useState, useMemo, useRef } from "react";
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
  const magneticNotesRef = useRef<Record<number, string>>({});
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
          magnetic_notes: magneticNotesRef.current,
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

      {method === "MAGNETIC_ROD" && (() => {
        const SAMPLES_PER_PLATE = 16;
        const totalPlates = Math.ceil(samples.length / SAMPLES_PER_PLATE);
        const getLabel = (idx: number) => {
          const s = samples[idx];
          return s ? (s.sample_vg_id || s.sample_barcode || s.vg_id || s.sample_id || "-") : "-";
        };
        return (
          <>
            {Array.from({ length: totalPlates }, (_, plateIdx) => {
              const base = plateIdx * SAMPLES_PER_PLATE;
              const plateSamples = samples.slice(base, base + SAMPLES_PER_PLATE);
              const plateNo = `P${plateIdx + 1}`;
              return (
                <Card
                  key={plateIdx}
                  title={`${plateNo} 磁棒法 Plate ${plateIdx + 1} / ${totalPlates} (${plateSamples.length} samples)`}
                  size="small"
                  style={{ marginBottom: 8 }}
                  bodyStyle={{ padding: "4px 8px" }}
                  extra={
                    <Input.TextArea
                      placeholder={`${plateNo} 备注`}
                      defaultValue={magneticNotesRef.current[plateIdx] || ""}
                      onChange={e => { magneticNotesRef.current[plateIdx] = e.target.value; }}
                      autoSize={{ minRows: 1, maxRows: 2 }}
                      style={{ width: 240, fontSize: 11 }}
                      allowClear
                    />
                  }
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <colgroup>
                      <col style={{ width: "3%" }} />
                      {COLS_12.map(c => (
                        <col key={c} style={{ width: c === 6 || c === 12 ? "10%" : "7.5%" }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr style={{ background: "#e8e8e8" }}>
                        <th style={{ border: "1px solid #bbb", padding: "2px 4px", fontSize: 11 }}></th>
                        {COLS_12.map(c => (
                          <th key={c} style={{
                            border: "1px solid #bbb", padding: "2px 4px", textAlign: "center",
                            fontSize: 11, fontWeight: 700,
                            background: (c === 6 || c === 12) ? "#fff1f0" : "#e8e8e8",
                            color: (c === 6 || c === 12) ? "#cf1322" : "#333",
                          }}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ROWS_8.map((r, rowIdx) => {
                        const bg = rowIdx % 2 === 0 ? "#fff" : "#f5f5f5";
                        const col1Idx = base + rowIdx;
                        const col7Idx = base + 8 + rowIdx;
                        const s1 = col1Idx < samples.length ? getLabel(col1Idx) : "";
                        const s7 = col7Idx < samples.length ? getLabel(col7Idx) : "";
                        return (
                          <tr key={r} style={{ background: bg }}>
                            <td style={{
                              border: "1px solid #d9d9d9", padding: "3px 4px",
                              textAlign: "center", fontWeight: 600, color: "#595959", fontSize: 11,
                            }}>{r}</td>
                            {COLS_12.map(c => {
                              const isProductCol = c === 6 || c === 12;
                              let cellContent: any = null;
                              let cellBg = bg;
                              if (isProductCol) {
                                cellContent = <span style={{ color: "#cf1322", fontWeight: 600 }}>产物</span>;
                                cellBg = "#fff1f0";
                              } else if (c === 1 && s1) {
                                cellContent = <span style={{ color: "#52c41a", fontWeight: 500 }}>{s1}</span>;
                                cellBg = "#f6ffed";
                              } else if (c === 7 && s7) {
                                cellContent = <span style={{ color: "#52c41a", fontWeight: 500 }}>{s7}</span>;
                                cellBg = "#f6ffed";
                              }
                              return (
                                <td key={c} style={{
                                  border: "1px solid #d9d9d9", padding: "2px 3px",
                                  textAlign: "center", fontSize: 10,
                                  background: cellBg,
                                  minHeight: 28, verticalAlign: "middle",
                                }}>
                                  {cellContent}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </>
        );
      })()}

      {method === "AUTOMATED" && (() => {
        const totalCells = 96; // 8 rows × 12 cols
        const getLabel = (idx: number) => {
          const s = samples[idx];
          return s ? (s.sample_vg_id || s.sample_barcode || s.vg_id || s.sample_id || "-") : "-";
        };
        // Build column-major index: [col][row] → sample index
        // For <96 samples: fill center-out (6,7,5,8,4,9,3,10,2,11,1,12)
        // For exactly 96: standard left-to-right
        const ROWS = 8;
        const isFull = samples.length >= totalCells;
        const colOrder = isFull
          ? COLS_12 // 1,2,3,...,12
          : [6, 7, 5, 8, 4, 9, 3, 10, 2, 11, 1, 12];
        // Build lookup: well "A1" → sample index (0-based)
        const cellMap: Record<string, number> = {};
        let sampleIdx = 0;
        for (const col of colOrder) {
          for (let row = 0; row < ROWS; row++) {
            const r = ROWS_8[row];
            const wl = `${r}${col}`;
            cellMap[wl] = sampleIdx;
            sampleIdx++;
          }
        }
        return (
          <Card
            title={`自动化工作站 (${samples.length} samples，共 ${totalCells} 孔)`}
            size="small"
            style={{ marginBottom: 8 }}
            bodyStyle={{ padding: "4px 8px" }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <colgroup>
                <col style={{ width: "3%" }} />
                {COLS_12.map(c => (
                  <col key={c} style={{ width: "8.08%" }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: "#e8e8e8" }}>
                  <th style={{ border: "1px solid #bbb", padding: "2px 4px", fontSize: 11 }}></th>
                  {COLS_12.map(c => (
                    <th key={c} style={{
                      border: "1px solid #bbb", padding: "2px 4px", textAlign: "center",
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS_8.map((r, rowIdx) => {
                  const bg = rowIdx % 2 === 0 ? "#fff" : "#f5f5f5";
                  return (
                    <tr key={r} style={{ background: bg }}>
                      <td style={{
                        border: "1px solid #d9d9d9", padding: "3px 4px",
                        textAlign: "center", fontWeight: 600, color: "#595959", fontSize: 11,
                      }}>{r}</td>
                      {COLS_12.map(c => {
                        const wl = `${r}${c}`;
                        const idx = cellMap[wl];
                        const label = idx !== undefined && idx < samples.length ? getLabel(idx) : "";
                        return (
                          <td key={c} style={{
                            border: "1px solid #d9d9d9", padding: "2px 3px",
                            textAlign: "center", fontSize: 10,
                            background: label ? "#f6ffed" : bg,
                            minHeight: 28, verticalAlign: "middle",
                          }}>
                            {label ? (
                              <span style={{ color: "#52c41a", fontWeight: 500 }}>{label}</span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ textAlign: "center", padding: "4px 0" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {isFull
                  ? "96 孔满板，从左到右从上到下依次填充"
                  : `从中间向两边填充（${colOrder.slice(0, 4).join("→")}→...），每列从上到下`}
              </Text>
            </div>
          </Card>
        );
      })()}

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
