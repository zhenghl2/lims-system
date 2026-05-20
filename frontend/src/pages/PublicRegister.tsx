import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Card, Form, Input, Button, Select, message, Typography,
  Space, Divider, Result, Spin, InputNumber,
} from "antd";
import { UserOutlined, WomanOutlined } from "@ant-design/icons";
import { publicRegisterApi } from "../api";

const { Title, Text } = Typography;
const { Option } = Select;

export default function PublicRegister() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [caseInfo, setCaseInfo] = useState<{case_number: string; panel: string; panel_name: string} | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{case_number: string; sample_count: number} | null>(null);
  const [form] = Form.useForm();
  const [fatherCount, setFatherCount] = useState(1);

  useEffect(() => {
    if (!token) {
      setError("No registration token provided");
      setLoading(false);
      return;
    }
    (publicRegisterApi as any).info(token)
      .then((res: any) => {
        setCaseInfo(res.data);
        setLoading(false);
      })
      .catch((e: any) => {
        setError(e?.response?.data?.detail || "Invalid or expired registration link");
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const res = await (publicRegisterApi as any).submit(token!, values);
      setSuccess({ case_number: res.data.case_number, sample_count: res.data.sample_count });
    } catch (e: any) {
      message.error(e?.response?.data?.detail || JSON.stringify(e?.response?.data) || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" tip="Loading..." /></div>;

  if (error) {
    return (
      <div style={{ maxWidth: 500, margin: "80px auto" }}>
        <Result status="error" title="Invalid Link" subTitle={error} />
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ maxWidth: 500, margin: "80px auto" }}>
        <Result
          status="success"
          title="Registration Submitted"
          subTitle={`Case Number: ${success.case_number}. ${success.sample_count} samples registered.`}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 16px" }}>
      <Card>
        <Title level={3} style={{ textAlign: "center" }}>
          <WomanOutlined /> NIPPT Sample Registration
        </Title>
        <Text type="secondary" style={{ display: "block", textAlign: "center", marginBottom: 24 }}>
          Case: {caseInfo?.case_number} ({caseInfo?.panel_name})
        </Text>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Divider orientation="left"><UserOutlined /> Mother Information</Divider>
          <Form.Item name="mother_name" label="Full Name" rules={[{ required: true }]}>
            <Input placeholder="Mother full name" />
          </Form.Item>
          <Space size="middle">
            <Form.Item name="mother_dob" label="Date of Birth">
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="mother_ethnicity" label="Ethnicity">
              <Select style={{ width: 160 }} allowClear placeholder="Select">
                <Option value="Asian">Asian</Option>
                <Option value="Caucasian">Caucasian</Option>
                <Option value="African">African</Option>
                <Option value="Hispanic">Hispanic</Option>
                <Option value="Mixed">Mixed</Option>
                <Option value="Other">Other</Option>
              </Select>
            </Form.Item>
            <Form.Item name="gestational_age_weeks" label="Gestational Age">
              <InputNumber min={0} max={45} placeholder="Weeks" style={{ width: 100 }} />
            </Form.Item>
          </Space>

          <Divider orientation="left">Alleged Father(s)</Divider>
          <Form.Item label="Number of Alleged Fathers">
            <Select value={fatherCount} onChange={setFatherCount} style={{ width: 100 }}>
              {[1, 2, 3, 4, 5].map(n => <Option key={n} value={n}>{n}</Option>)}
            </Select>
          </Form.Item>

          {Array.from({ length: fatherCount }, (_, i) => (
            <Card key={i} size="small" title={`Alleged Father ${i + 1}`} style={{ marginBottom: 12 }}>
              <Form.Item
                name={["father_names", i]}
                label="Full Name"
                rules={[{ required: true, message: "Required" }]}
              >
                <Input placeholder="Father full name" />
              </Form.Item>
              <Space size="middle" wrap>
                <Form.Item name={["father_ethnicities", i]} label="Ethnicity">
                  <Select style={{ width: 140 }} allowClear placeholder="Select">
                    <Option value="Asian">Asian</Option>
                    <Option value="Caucasian">Caucasian</Option>
                    <Option value="African">African</Option>
                    <Option value="Hispanic">Hispanic</Option>
                    <Option value="Mixed">Mixed</Option>
                    <Option value="Other">Other</Option>
                  </Select>
                </Form.Item>
                <Form.Item name={["father_relationships", i]} label="Relationship">
                  <Select style={{ width: 140 }} allowClear placeholder="Select">
                    <Option value="Spouse">Spouse</Option>
                    <Option value="Partner">Partner</Option>
                    <Option value="Boyfriend">Boyfriend</Option>
                    <Option value="Other">Other</Option>
                  </Select>
                </Form.Item>
                <Form.Item name={["father_sample_sources", i]} label="Sample Type">
                  <Select style={{ width: 140 }} placeholder="Blood" allowClear>
                    <Option value="BLOOD">Blood</Option>
                    <Option value="SWAB">Buccal Swab</Option>
                    <Option value="HAIR">Hair Follicle</Option>
                    <Option value="DBS">Dried Blood Spot</Option>
                  </Select>
                </Form.Item>
              </Space>
            </Card>
          ))}

          <Divider orientation="left">Additional Info</Divider>
          <Space size="middle" wrap>
            <Form.Item name="clinic_name" label="Clinic Name">
              <Input placeholder="Clinic / hospital" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="clinic_contact" label="Contact">
              <Input placeholder="Phone / email" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="sales_person" label="Sales Rep">
              <Input placeholder="Your name" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item name="collection_date" label="Collection Date">
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="is_urgent" label="Urgent">
            <Select style={{ width: 100 }} allowClear>
              <Option value={true}>Yes</Option>
              <Option value={false}>No</Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Additional notes..." />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={submitting} block size="large" style={{ marginTop: 16 }}>
            Submit Registration
          </Button>
        </Form>
      </Card>
    </div>
  );
}
