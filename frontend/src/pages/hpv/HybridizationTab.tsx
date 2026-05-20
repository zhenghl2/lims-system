import { useEffect, useState } from "react";
import { Form, Input, DatePicker, Button, Card, Row, Col, Descriptions, Space, Typography, Upload, message } from "antd";
import { CameraOutlined, CheckCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api/client";
import { ROWS_48, COLS_48, wellLabel } from "./constants";

const { Text } = Typography;
const { TextArea } = Input;

export default function HybridizationTab({ batch, wells, photos, onRefresh }: { batch: any; wells: any[]; photos: any[]; onRefresh: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const hdata = batch.hybridization_data || {};

  useEffect(() => {
    form.setFieldsValue({
      hybridization_date: hdata.hybridization_date ? dayjs(hdata.hybridization_date) : null,
      hybridization_time: hdata.hybridization_time || "",
      hybridization_instrument: hdata.hybridization_instrument || "",
      ssc_20x: hdata.reagents?.ssc_20x || "",
      sds_1pct: hdata.reagents?.sds_1pct || "",
      sodium_citrate: hdata.reagents?.sodium_citrate || "",
      tmb: hdata.reagents?.tmb || "",
      pod: hdata.reagents?.pod || "",
      h2o2_3pct: hdata.reagents?.h2o2_3pct || "",
      purified_water: hdata.reagents?.purified_water || "",
      strip_placement_order: hdata.strip_placement_order || "",
      denatured_product_added: hdata.denatured_product_added || false,
      post_experiment_notes: hdata.post_experiment_notes || "",
      operator: hdata.operator_signature || "",
      reviewer: hdata.reviewer_signature || "",
    });
  }, [hdata, form]);

  const saveHyb = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      await api.post(`/hpv/batches/${batch.id}/save_hybridization/`, {
        hybridization_date: vals.hybridization_date?.format("YYYY-MM-DD"),
        hybridization_time: vals.hybridization_time,
        hybridization_instrument: vals.hybridization_instrument,
        ssc_20x: vals.ssc_20x, sds_1pct: vals.sds_1pct,
        sodium_citrate: vals.sodium_citrate, tmb: vals.tmb,
        pod: vals.pod, h2o2_3pct: vals.h2o2_3pct,
        purified_water: vals.purified_water,
        strip_placement_order: vals.strip_placement_order,
        denatured_product_added: vals.denatured_product_added,
        post_experiment_notes: vals.post_experiment_notes,
        operator: vals.operator, reviewer: vals.reviewer,
      });
      message.success("杂交记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  const signHyb = async (role: "operator" | "reviewer") => {
    try {
      await api.post(`/hpv/batches/${batch.id}/sign/`, { stage: "hybridization", role });
      message.success("签名完成"); onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "签名失败"); }
  };

  const uploadPhoto = async (wellLabel: string, file: File) => {
    const well = wells.find((w: any) => w.well_label === wellLabel);
    if (!well) { message.error("找不到对应孔位"); return; }
    const fd = new FormData();
    fd.append("batch", batch.id);
    fd.append("sample", well.sample);
    fd.append("well_position", wellLabel);
    fd.append("image", file);
    try {
      await api.post("/hpv/photos/", fd, { headers: { "Content-Type": "multipart/form-data" } });
      message.success(`${wellLabel} 照片上传成功`);
      onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "照片上传失败"); }
  };

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
            <Form.Item name="hybridization_instrument" label="杂交仪编号" rules={[{ required: true }]}>
              <Input placeholder="例：YSFH-EI-055" />
            </Form.Item>
          </Col>
        </Row>

        <Card title="试剂" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}><Form.Item name="ssc_20x" label="20×SSC"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="sds_1pct" label="1% SDS"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="sodium_citrate" label="1M 柠檬酸钠"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="tmb" label="TMB"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="pod" label="POD"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="h2o2_3pct" label="3% H2O2"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="purified_water" label="纯化水"><Input /></Form.Item></Col>
          </Row>
        </Card>

        <Card title="杂交参数" size="small" style={{ marginBottom: 16 }}>
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="温度">51℃</Descriptions.Item>
            <Descriptions.Item label="摇摆混匀">2min</Descriptions.Item>
            <Descriptions.Item label="膜条放置顺序">
              <Form.Item name="strip_placement_order" noStyle><Input placeholder="例：A1-H6" /></Form.Item>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Form.Item name="denatured_product_added" valuePropName="checked" label="变性产物已加入杂交液" />

        <Card title={`膜条照片 (${photos.length}/${wells.length})`} size="small" style={{ marginBottom: 16 }}
          extra={<Text type="secondary">必须上传所有照片才能进入结果录入</Text>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
            {ROWS_48.map(r =>
              COLS_48.map(c => {
                const wl = wellLabel(r, c);
                const well = wells.find((w: any) => w.well_label === wl);
                const photo = photos.find((p: any) => p.well_position === wl);
                return (
                  <div key={wl} style={{
                    border: `1px solid ${photo ? "#52c41a" : "#ff4d4f"}`,
                    borderRadius: 4, padding: 4, textAlign: "center", minHeight: 60,
                    background: photo ? "#f6ffed" : "#fff1f0",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 11 }}>{wl}</div>
                    {!well ? <Text type="secondary" style={{ fontSize: 10 }}>—</Text> :
                      photo ? <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 18 }} /> :
                      <Upload showUploadList={false} customRequest={({ file }: any) => uploadPhoto(wl, file)}>
                        <Button size="small" icon={<CameraOutlined />} type="link">拍照</Button>
                      </Upload>
                    }
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Form.Item name="post_experiment_notes" label="实验后处理记录">
          <TextArea rows={2} />
        </Form.Item>
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
      <Space>
        <Button type="primary" onClick={saveHyb} loading={saving}>保存杂交记录</Button>
        <Button onClick={() => signHyb("operator")}>操作人签名</Button>
        <Button onClick={() => signHyb("reviewer")}>复核人签名</Button>
      </Space>
    </div>
  );
}
