import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, TimePicker, Select, Button, Card, Row, Col, Checkbox, Descriptions, Space, Tag, message } from "antd";
import dayjs from "dayjs";
import api from "../../api/client";
import SignerModal from "./SignerModal";
import { getSignStatus, PCR_STEPS, HPV_KIT_TYPES, getSignerImage } from "./constants";



export default function PcrTab({ batch, onRefresh }: { batch: any; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [qcWeak, setQcWeak] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const pdata = useMemo(() => batch.pcr_data || {}, [batch.pcr_data]);

  useEffect(() => {
    form.setFieldsValue({
      pcr_date: pdata.pcr_date ? dayjs(pdata.pcr_date) : null,
      pcr_time: pdata.pcr_time ? dayjs(pdata.pcr_time, "HH:mm") : dayjs(),
      biosafety_cabinet: pdata.biosafety_cabinet || "YSFH-EI-004-01",
      pcr_instrument: pdata.pcr_instrument || "YSFH-EI-024-07",
      kit_type: pdata.kit_type || undefined,
      reagent_lot: pdata.reagent_lot || "",
      reagent_expiry: pdata.reagent_expiry || "",
      pcr_program: pdata.pcr_program || "",
    });
    setSteps(pdata.step_confirmations || {});
    setQcWeak(pdata.weak_positive_control);
  }, [pdata, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));

  const savePdf = async () => {
    try {
      const { data } = await api.get(`/hpv/batches/${batch.id}/experiment_record/?stage=pcr`);
      const w = window.open("", "_blank");
      if (w) { w.document.write(data.html); w.document.close(); setTimeout(() => w.print(), 500); }
    } catch (e) { message.error("生成PDF失败"); }
  };

  const savePcr = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      await api.post(`/hpv/batches/${batch.id}/save_pcr/`, {
        pcr_date: vals.pcr_date?.format("YYYY-MM-DD"),
        pcr_time: vals.pcr_time?.format("HH:mm"),
        biosafety_cabinet: vals.biosafety_cabinet,
        pcr_instrument: vals.pcr_instrument,
        kit_type: vals.kit_type,
        reagent_lot: vals.reagent_lot,
        reagent_expiry: vals.reagent_expiry,
        pcr_program: vals.pcr_program,
        negative_control: { count: 1 },
        positive_control: { count: 1 },
        weak_positive_control: qcWeak,
        step_confirmations: steps,
      });
      message.success("PCR 记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const { signed: operatorSigned, name: operatorSigner } = getSignStatus(pdata, "operator");
  const { signed: reviewerSigned, name: reviewerSigner } = getSignStatus(pdata, "reviewer");
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [reviewerModalOpen, setReviewerModalOpen] = useState(false);



  return (
    <div>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="pcr_date" label="实验日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="pcr_time" label="实验时间">
              <TimePicker style={{ width: "100%" }} format="HH:mm" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="biosafety_cabinet" label="生物安全柜编号">
              <Input placeholder="例：BSC-A2-01" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="pcr_instrument" label="PCR 仪编号">
              <Input placeholder="例：YSFH-EI-024-07" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="kit_type" label="检测试剂盒" rules={[{ required: true }]}>
              <Select options={HPV_KIT_TYPES} placeholder="选择" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="reagent_lot" label="试剂批次" rules={[{ required: true }]}>
              <Input placeholder="批次号" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="reagent_expiry" label="有效期">
              <Input placeholder="YYYY-MM" />
            </Form.Item>
          </Col>
        </Row>

        <Card title="质控品" size="small" style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="阴性质控"><Tag color="green">1 份（必须）</Tag></Descriptions.Item>
            <Descriptions.Item label="阳性质控"><Tag color="red">1 份（必须）</Tag></Descriptions.Item>
            <Descriptions.Item label="弱阳性质控">
              <Select allowClear placeholder="可选 1-5" style={{ width: 100 }} value={qcWeak} onChange={setQcWeak}
                options={["1","2","3","4","5"].map(v => ({ value: v, label: v }))} />
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="pcr_program" label="PCR 程序（自动关联）">
              <Input placeholder="根据试剂盒类型自动设定" readOnly />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {PCR_STEPS.map(step => (
            <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)}>
              {step.label}
            </Checkbox>
          ))}
        </Space>
      </Card>

      <Space>
        <Button type="primary" onClick={savePcr} loading={saving}>保存 PCR 记录</Button>
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
        batchId={batch.id} stage="pcr"
        currentSigner={operatorSigner || null}
        onDone={() => { setOperatorModalOpen(false); onRefresh(); }}
        onCancel={() => setOperatorModalOpen(false)}
      />
      <SignerModal
        open={reviewerModalOpen} role="reviewer" roleLabel="复核人"
        batchId={batch.id} stage="pcr"
        currentSigner={reviewerSigner || null}
        onDone={() => { setReviewerModalOpen(false); onRefresh(); }}
        onCancel={() => setReviewerModalOpen(false)}
      />
</div>
  );
}
