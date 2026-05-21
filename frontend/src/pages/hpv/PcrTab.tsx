import { useEffect, useState } from "react";
import { Form, Input, DatePicker, TimePicker, Select, Button, Card, Row, Col, Checkbox, Descriptions, Space, Tag, message } from "antd";
import dayjs from "dayjs";
import api from "../../api/client";
import SignerModal from "./SignerModal";
import { PCR_STEPS, HPV_KIT_TYPES } from "./constants";


const SIGNER_IMAGES: Record<string, string> = {
  "陈菊玲": "/signatures/陈菊玲.png",
  "李彩娟": "/signatures/李彩娟.png",
  "杨思婷": "/signatures/杨思婷.jpg",
};
const get_signer_image = (name: string) => SIGNER_IMAGES[name] || "";

export default function PcrTab({ batch, onRefresh }: { batch: any; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [qcWeak, setQcWeak] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const pdata = batch.pcr_data || {};

  useEffect(() => {
    form.setFieldsValue({
      pcr_date: pdata.pcr_date ? dayjs(pdata.pcr_date) : null,
      pcr_time: pdata.pcr_time ? dayjs(pdata.pcr_time, "HH:mm") : dayjs(),
      biosafety_cabinet: pdata.biosafety_cabinet || "",
      pcr_instrument: pdata.pcr_instrument || "",
      kit_type: pdata.kit_type || undefined,
      reagent_lot: pdata.reagent_lot || "",
      reagent_expiry: pdata.reagent_expiry || "",
      pcr_program: pdata.pcr_program || "",
    });
    setSteps(pdata.step_confirmations || {});
    setQcWeak(pdata.weak_positive_control);
  }, [pdata, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));
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
      if (e?.errorFields) return;
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const opSig = pdata.operator_signature;
  const revSig = pdata.reviewer_signature;
  const operatorSigned = !!(opSig && typeof opSig === "object" && opSig.username);
  const reviewerSigned = !!(revSig && typeof revSig === "object" && revSig.username);
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
            <Form.Item name="biosafety_cabinet" label="生物安全柜编号" rules={[{ required: true }]}>
              <Input placeholder="例：BSC-A2-01" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="pcr_instrument" label="PCR 仪编号" rules={[{ required: true }]}>
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
        <Row gutter={16}>

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
        {operatorSigned ? (
          <Button type="default" style={{ color: "#52c41a", borderColor: "#52c41a" }}
            onClick={() => setOperatorModalOpen(true)}>
            <img src={get_signer_image(opSig.username)} alt="" style={{ height: 16, marginRight: 4, verticalAlign: "middle" }} />
            操作人: {opSig.username} ✓
          </Button>
        ) : (
          <Button type="primary" onClick={() => setOperatorModalOpen(true)}>操作人签名</Button>
        )}
        {reviewerSigned ? (
          <Button type="default" style={{ color: "#52c41a", borderColor: "#52c41a" }}
            onClick={() => setReviewerModalOpen(true)}>
            <img src={get_signer_image(revSig.username)} alt="" style={{ height: 16, marginRight: 4, verticalAlign: "middle" }} />
            复核人: {revSig.username} ✓
          </Button>
        ) : (
          <Button type="primary" onClick={() => setReviewerModalOpen(true)}>复核人签名</Button>
        )}
      </Space>
    
      <SignerModal
        open={operatorModalOpen} role="operator" roleLabel="操作人"
        batchId={batch.id} stage="pcr"
        currentSigner={opSig?.username || null}
        onDone={() => { setOperatorModalOpen(false); onRefresh(); }}
        onCancel={() => setOperatorModalOpen(false)}
      />
      <SignerModal
        open={reviewerModalOpen} role="reviewer" roleLabel="复核人"
        batchId={batch.id} stage="pcr"
        currentSigner={revSig?.username || null}
        onDone={() => { setReviewerModalOpen(false); onRefresh(); }}
        onCancel={() => setReviewerModalOpen(false)}
      />
</div>
  );
}
