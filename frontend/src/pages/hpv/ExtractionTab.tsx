import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message } from "antd";
import dayjs from "dayjs";
import api from "../../api/client";
import SignerModal from "./SignerModal";
import { getSignStatus, EXTRACTION_STEPS, KIT_TYPES, ROWS_48, COLS_48, wellLabel, getSignerImage } from "./constants";



export default function ExtractionTab({ batch, wells, onRefresh }: { batch: any; wells: any[]; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const edata = useMemo(() => batch.extraction_data || {}, [batch.extraction_data]);

  useEffect(() => {
    form.setFieldsValue({
      extraction_date: edata.extraction_date ? dayjs(edata.extraction_date) : dayjs(),
      extraction_time: edata.extraction_time || dayjs().format("HH:mm"),
      biosafety_cabinet: edata.biosafety_cabinet || "YSFH-EI-004-01",
      extraction_instrument: edata.extraction_instrument || "YSFH-EI-056",
      kit_type: edata.kit_type || undefined,
      reagent_lot: edata.reagent_lot || "",
      reagent_expiry: edata.reagent_expiry ? dayjs(edata.reagent_expiry) : undefined,
    });
    setSteps(edata.step_confirmations || {});
  }, [edata, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));


  const savePdf = async () => {
    try {
      const { data } = await api.get(`/hpv/batches/${batch.id}/experiment_record/?stage=extraction`);
      const w = window.open("", "_blank");
      if (w) { w.document.write(data.html); w.document.close(); setTimeout(() => w.print(), 500); }
    } catch (e) { message.error("生成PDF失败"); }
  };

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
        reagent_expiry: vals.reagent_expiry?.format("YYYY-MM") || "",
        step_confirmations: steps,
      });
      message.success("核酸提取记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const { signed: operatorSigned, name: operatorSigner } = getSignStatus(edata, "operator");
  const { signed: reviewerSigned, name: reviewerSigner } = getSignStatus(edata, "reviewer");
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [reviewerModalOpen, setReviewerModalOpen] = useState(false);


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
            <Form.Item name="biosafety_cabinet" label="生物安全柜编号">
              <Input placeholder="例：BSC-A2-01" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="extraction_instrument" label="核酸提取仪编号">
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
        <Button onClick={savePdf}>保存PDF</Button>
        {operatorSigned ? (
          <Button type="default" style={{ color: "#52c41a", borderColor: "#52c41a" }}
            onClick={() => setOperatorModalOpen(true)}>
            <img src={getSignerImage(operatorSigner)} alt="" style={{ height: 16, marginRight: 4, verticalAlign: "middle" }} />
            操作人: {operatorSigner} ✓
          </Button>
        ) : (
          <Button type="primary" onClick={() => setOperatorModalOpen(true)}>操作人签名</Button>
        )}
        {reviewerSigned ? (
          <Button type="default" style={{ color: "#52c41a", borderColor: "#52c41a" }}
            onClick={() => setReviewerModalOpen(true)}>
            <img src={getSignerImage(reviewerSigner)} alt="" style={{ height: 16, marginRight: 4, verticalAlign: "middle" }} />
            复核人: {reviewerSigner} ✓
          </Button>
        ) : (
          <Button type="primary" onClick={() => setReviewerModalOpen(true)}>复核人签名</Button>
        )}
      </Space>
    
      <SignerModal
        open={operatorModalOpen} role="operator" roleLabel="操作人"
        batchId={batch.id} stage="extraction"
        currentSigner={operatorSigner || null}
        onDone={() => { setOperatorModalOpen(false); onRefresh(); }}
        onCancel={() => setOperatorModalOpen(false)}
      />
      <SignerModal
        open={reviewerModalOpen} role="reviewer" roleLabel="复核人"
        batchId={batch.id} stage="extraction"
        currentSigner={reviewerSigner || null}
        onDone={() => { setReviewerModalOpen(false); onRefresh(); }}
        onCancel={() => setReviewerModalOpen(false)}
      />
</div>
  );
}
