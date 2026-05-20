import { useEffect, useState } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message } from "antd";
import dayjs from "dayjs";
import api from "../../api/client";
import { EXTRACTION_STEPS, KIT_TYPES, ROWS_48, COLS_48, wellLabel } from "./constants";

export default function ExtractionTab({ batch, wells, onRefresh }: { batch: any; wells: any[]; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const edata = batch.extraction_data || {};

  useEffect(() => {
    form.setFieldsValue({
      extraction_date: edata.extraction_date ? dayjs(edata.extraction_date) : dayjs(),
      extraction_time: edata.extraction_time || dayjs().format("HH:mm"),
      biosafety_cabinet: edata.biosafety_cabinet || "",
      extraction_instrument: edata.extraction_instrument || "",
      kit_type: edata.kit_type || undefined,
      reagent_lot: edata.reagent_lot || "",
      reagent_expiry: edata.reagent_expiry || "",
      operator: edata.operator_signature || "",
      reviewer: edata.reviewer_signature || "",
    });
    setSteps(edata.step_confirmations || {});
  }, [edata, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));

  const saveExtraction = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      await api.post(`/hpv/batches/${batch.id}/save_extraction/`, {
        extraction_date: vals.extraction_date?.format("YYYY-MM-DD"),
        extraction_time: vals.extraction_time,
        biosafety_cabinet: vals.biosafety_cabinet,
        extraction_instrument: vals.extraction_instrument,
        kit_type: vals.kit_type,
        reagent_lot: vals.reagent_lot,
        reagent_expiry: vals.reagent_expiry,
        step_confirmations: steps,
        operator: vals.operator,
        reviewer: vals.reviewer,
      });
      message.success("核酸提取记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const signStage = async (role: "operator" | "reviewer") => {
    try {
      await api.post(`/hpv/batches/${batch.id}/sign/`, { stage: "extraction", role });
      message.success(`${role === "operator" ? "操作人" : "复核人"}签名完成`);
      onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "签名失败"); }
  };

  return (
    <div>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="extraction_date" label="实验日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="extraction_time" label="实验时间">
              <Input placeholder="例：09:00" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="biosafety_cabinet" label="生物安全柜编号" rules={[{ required: true }]}>
              <Input placeholder="例：BSC-A2-01" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="extraction_instrument" label="核酸提取仪编号" rules={[{ required: true }]}>
              <Input placeholder="例：YSFH-EI-010-01" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="kit_type" label="试剂盒类型" rules={[{ required: true }]}>
              <Select options={KIT_TYPES} placeholder="选择" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="reagent_lot" label="试剂批次" rules={[{ required: true }]}>
              <Input placeholder="批次号" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="reagent_expiry" label="有效期">
              <Input placeholder="YYYY-MM" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="operator" label="操作人签名" rules={[{ required: true }]}>
              <Input placeholder="输入姓名或工号" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="reviewer" label="复核人签名" rules={[{ required: true }]}>
              <Input placeholder="输入姓名或工号" />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {EXTRACTION_STEPS.map(step => (
            <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)}>
              {step.label}
            </Checkbox>
          ))}
        </Space>
      </Card>

      <Card title={`48 孔板 (${wells.length}/48)`} size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
          {ROWS_48.map(r =>
            COLS_48.map(c => {
              const wl = wellLabel(r, c);
              const well = wells.find((w: any) => w.well_label === wl);
              return (
                <div key={wl} style={{
                  border: "1px solid #d9d9d9", borderRadius: 4, padding: "4px 6px",
                  minHeight: 48, fontSize: 11, background: well ? "#f6ffed" : "#fafafa",
                }}>
                  <div style={{ fontWeight: 600, color: "#8c8c8c" }}>{wl}</div>
                  {well ? (
                    <>
                      <div style={{ color: "#52c41a", fontSize: 10 }}>{well.sample_id_display || well.barcode || "\u2014"}</div>
                      {well.internal_number && <div style={{ fontSize: 10 }}>#{well.internal_number}</div>}
                    </>
                  ) : (
                    <div style={{ color: "#ccc", fontSize: 10 }}>空</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Space>
        <Button type="primary" onClick={saveExtraction} loading={saving}>保存提取记录</Button>
        <Button onClick={() => signStage("operator")}>操作人签名</Button>
        <Button onClick={() => signStage("reviewer")}>复核人签名</Button>
      </Space>
    </div>
  );
}
