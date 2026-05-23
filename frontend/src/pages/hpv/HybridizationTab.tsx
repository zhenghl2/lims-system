import { useEffect, useState, useMemo } from "react";
import { Form, Input, DatePicker, Button, Card, Row, Col, Space, Typography, message, Checkbox } from "antd";
import dayjs from "dayjs";
import api from "../../api/client";
import SignerModal from "./SignerModal";
import { getSignStatus, getSignerImage } from "./constants";

const { Text } = Typography;

const HYB_ROWS = ["A", "B", "C"];
const HYB_COLS = Array.from({ length: 16 }, (_, i) => i + 1);
const HYB_WELL_LABELS = HYB_COLS.flatMap(c => HYB_ROWS.map(r => `${r}${c}`));



export default function HybridizationTab({ batch, wells, onRefresh }: { batch: any; wells: any[]; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [wellAssignments, setWellAssignments] = useState<Record<string, string>>({});
  const hdata = useMemo(() => batch.hybridization_data || {}, [batch.hybridization_data]);

  useEffect(() => {
    form.setFieldsValue({
      hybridization_date: hdata.hybridization_date ? dayjs(hdata.hybridization_date) : null,
      hybridization_time: hdata.hybridization_time || "",
      hybridization_instrument: hdata.hybridization_instrument || "YSFH-EI-055",
      sds_1pct_date: hdata.reagents?.sds_1pct_date ? dayjs(hdata.reagents.sds_1pct_date) : null,
      h2o2_3pct_date: hdata.reagents?.h2o2_3pct_date ? dayjs(hdata.reagents.h2o2_3pct_date) : null,
      denatured_product_added: hdata.denatured_product_added || false,
      post_experiment_notes: hdata.post_experiment_notes || "",
    });
    setWellAssignments(hdata.well_assignments || {});
  }, [hdata, form]);

  const autoFill = () => {
    const assigned = wells
      .filter((w: any) => w.sample)
      .map((w: any) => w.sample_id_display || w.barcode || w.internal_number || "");
    const assignments: Record<string, string> = {};
    HYB_WELL_LABELS.forEach((label, idx) => {
      if (idx < assigned.length) assignments[label] = assigned[idx];
    });
    const start = assigned.length;
    assignments[HYB_WELL_LABELS[start]] = "阴性对照";
    assignments[HYB_WELL_LABELS[start + 1]] = "阳性对照";
    assignments[HYB_WELL_LABELS[start + 2]] = "弱阳性对照";
    setWellAssignments(assignments);
  };

  const updateWell = (label: string, value: string) => {
    setWellAssignments(prev => ({ ...prev, [label]: value }));
  };


  const savePdf = async () => {
    try {
      const { data } = await api.get(`/hpv/batches/${batch.id}/experiment_record/?stage=hybridization`);
      const w = window.open("", "_blank");
      if (w) { w.document.write(data.html); w.document.close(); setTimeout(() => w.print(), 500); }
    } catch (e) { message.error("生成PDF失败"); }
  };

  const saveHyb = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      await api.post(`/hpv/batches/${batch.id}/save_hybridization/`, {
        hybridization_date: vals.hybridization_date?.format("YYYY-MM-DD"),
        hybridization_time: vals.hybridization_time,
        hybridization_instrument: vals.hybridization_instrument,
        sds_1pct_date: vals.sds_1pct_date?.format("YYYY-MM-DD"),
        h2o2_3pct_date: vals.h2o2_3pct_date?.format("YYYY-MM-DD"),
        denatured_product_added: vals.denatured_product_added,
        post_experiment_notes: vals.post_experiment_notes,
        well_assignments: wellAssignments,
      });
      message.success("杂交记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const { signed: operatorSigned, name: operatorSigner } = getSignStatus(hdata, "operator");
  const { signed: reviewerSigned, name: reviewerSigner } = getSignStatus(hdata, "reviewer");
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [reviewerModalOpen, setReviewerModalOpen] = useState(false);



  return (
    <div>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="hybridization_date" label="实验日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="hybridization_time" label="实验时间">
              <Input placeholder="例：14:00" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="hybridization_instrument" label="杂交仪编号">
              <Input placeholder="例：YSFH-EI-055" />
            </Form.Item>
          </Col>
        </Row>

        <Card title="自配试剂配置日期" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sds_1pct_date" label="1% SDS 配置日期" rules={[{ required: true, message: "请选择1% SDS配置日期" }]}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="h2o2_3pct_date" label="3% H2O2 配置日期" rules={[{ required: true, message: "请选择3% H2O2配置日期" }]}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="杂交参数" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}><Text><strong>温度：</strong>51℃</Text></Col>
            <Col span={8}><Text><strong>摇摆混匀：</strong>2min</Text></Col>
            <Col span={8}>
              <Form.Item name="denatured_product_added" valuePropName="checked" noStyle>
                  <Checkbox>已加入变性产物</Checkbox>
                </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card
          title={`杂交仪孔位 (3×16) — 共 ${Object.keys(wellAssignments).filter(k => wellAssignments[k]).length}/48`}
          size="small"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Button size="small" onClick={autoFill}>自动填入样本</Button>
              <Button size="small" danger onClick={() => setWellAssignments({})}>清空</Button>
            </Space>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 2 }}>
            {HYB_ROWS.map(r =>
              HYB_COLS.map(c => {
                const label = `${r}${c}`;
                return (
                  <div key={label} style={{
                    border: "1px solid #d9d9d9", borderRadius: 2, padding: "2px 1px", textAlign: "center",
                    background: wellAssignments[label]?.includes("对照") ? "#fff7e6" : "#fff",
                  }}>
                    <div style={{ fontSize: 9, color: "#888", lineHeight: 1.2 }}>{label}</div>
                    <Input
                      size="small"
                      value={wellAssignments[label] || ""}
                      onChange={e => updateWell(label, e.target.value)}
                      style={{ fontSize: 10, padding: "0 2px", textAlign: "center", height: 22 }}
                      placeholder="-"
                    />
                  </div>
                );
              })
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
            提示：点击「自动填入样本」将按本批次核酸提取样本顺序填充，最后3孔为对照。可手动修改或清空任意孔位。
          </div>
        </Card>

        <Form.Item name="post_experiment_notes" label="实验后处理记录">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" onClick={saveHyb} loading={saving}>保存杂交记录</Button>
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
        batchId={batch.id} stage="hybridization"
        currentSigner={operatorSigner || null}
        onDone={() => { setOperatorModalOpen(false); onRefresh(); }}
        onCancel={() => setOperatorModalOpen(false)}
      />
      <SignerModal
        open={reviewerModalOpen} role="reviewer" roleLabel="复核人"
        batchId={batch.id} stage="hybridization"
        currentSigner={reviewerSigner || null}
        onDone={() => { setReviewerModalOpen(false); onRefresh(); }}
        onCancel={() => setReviewerModalOpen(false)}
      />
</div>
  );
}
