import { useState, useEffect } from "react";
import {
  Card, Form, Input, Select, Button, message, Typography,
  Divider, Table, Tag, Modal, InputNumber, Row, Col, Switch,
} from "antd";
import {
  PlusOutlined, CopyOutlined, ReloadOutlined,
  ClockCircleOutlined, SendOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text } = Typography;
// Option unused - panel select is fixed to NIPPT
const { TextArea } = Input;

export default function NipptRegistration() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [recentCases, setRecentCases] = useState<any[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [tokenModal, setTokenModal] = useState<{ open: boolean; url: string; expires: string; caseNumber: string } | null>(null);

  // Load recent cases
  useEffect(() => {
    refreshCases();
  }, []);

  const refreshCases = () => {
    setCasesLoading(true);
    (casesApi as any).list({ limit: 20, ordering: "-created_at" })
      .then((r: any) => { setRecentCases(r.data?.results || []); setCasesLoading(false); })
      .catch(() => setCasesLoading(false));
  };

  // Create case
  const handleSubmit = async () => {
    const values = await form.validateFields();
    // Remove hidden panel_id marker
    delete values.panel_id;
    setLoading(true);
    try {
      const res = await (casesApi as any).create(values);
      message.success(`Case ${res.data.case_number} created`);
      form.resetFields();
      refreshCases();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || JSON.stringify(e?.response?.data) || "Failed to create case");
    } finally {
      setLoading(false);
    }
  };

  // Generate token
  const handleGenerateToken = async (id: string, caseNumber: string) => {
    try {
      const res = await (casesApi as any).generateToken(id);
      setTokenModal({
        open: true,
        url: res.data.url,
        expires: res.data.expires,
        caseNumber,
      });
    } catch (e: any) {
      message.error("Failed to generate token");
    }
  };

  // Copy to clipboard
  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => message.success("Link copied!"));
  };

  const caseColumns = [
    {
      title: "Case #", dataIndex: "case_number", key: "cn", width: 180,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: "Panel", dataIndex: "panel_name", key: "panel", width: 150,
    },
    {
      title: "Samples", dataIndex: "sample_count", key: "sc", width: 80,
    },
    {
      title: "Status", dataIndex: "status", key: "st", width: 120,
      render: (s: string) => {
        const m: Record<string, string> = { REGISTERED: "blue", DRAFT: "default", RECEIVED: "cyan", IN_PROCESS: "orange" };
        return <Tag color={m[s] || "default"}>{s}</Tag>;
      },
    },
    {
      title: "Created", dataIndex: "created_at", key: "ca", width: 140,
      render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-",
    },
    {
      title: "Action", key: "act", width: 160,
      render: (_: any, r: any) => (
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          onClick={() => handleGenerateToken(r.id, r.case_number)}
        >
          Generate Link
        </Button>
      ),
    },
  ];

  return (
    <>
      <Row gutter={16}>
        {/* Left: Create Case Form */}
        <Col xs={24} lg={12}>
          <Card
            title={<><PlusOutlined /> New NIPPT Case</>}
            size="small"
          >
            <Form form={form} layout="vertical" size="small">
              <Form.Item name="panel_id" hidden initialValue="__auto__">
                <Input />
              </Form.Item>

              <Form.Item name="sample_id" label="Sample ID (Mother)">
                <Input placeholder="Optional, auto-generated if empty" />
              </Form.Item>

              <Form.Item name="father_sample_type" label="Male Sample Type" initialValue="BLOOD">
                <Select options={[
                  { value: "BLOOD", label: "Peripheral Blood" },
                  { value: "SWAB", label: "Buccal Swab" },
                  { value: "HAIR", label: "Hair Follicle" },
                  { value: "DBS", label: "Dried Blood Spot" },
                ]} />
              </Form.Item>

              <Divider plain style={{ fontSize: 12 }}>Subject Info</Divider>

              <Row gutter={12}>
                <Col span={16}>
                  <Form.Item name="mother_name" label="Mother Name" rules={[{ required: true }]}>
                    <Input placeholder="Full name" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="mother_dob" label="DOB">
                    <Input placeholder="YYYY-MM-DD" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="father_names" label="Alleged Father(s)">
                <Select mode="tags" placeholder="Type name and press Enter (add multiple)" />
              </Form.Item>

              <Divider plain style={{ fontSize: 12 }}>Pregnancy</Divider>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="gestational_age_weeks" label="Gestational Weeks">
                    <InputNumber min={1} max={45} placeholder="Weeks" style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="gestational_age_days" label="Days">
                    <InputNumber min={0} max={6} placeholder="Days" style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Divider plain style={{ fontSize: 12 }}>Administrative</Divider>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="clinic_name" label="Clinic">
                    <Input placeholder="Clinic name" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="sales_person" label="Sales Person">
                    <Input placeholder="Sales rep" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="is_urgent" label="Urgent" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="notes" label="Notes">
                <TextArea rows={2} placeholder="Internal notes" />
              </Form.Item>

              <Form.Item>
                <Button type="primary" icon={<PlusOutlined />} loading={loading} onClick={handleSubmit} block>
                  Create Case
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* Right: Recent Cases + Token Generation */}
        <Col xs={24} lg={12}>
          <Card
            title={<><ClockCircleOutlined /> Recent Cases</>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={refreshCases}>Refresh</Button>}
            size="small"
          >
            <Table
              dataSource={recentCases}
              columns={caseColumns}
              rowKey="id"
              loading={casesLoading}
              size="small"
              pagination={{ pageSize: 8, size: "small" }}
              scroll={{ x: 800 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Token Modal */}
      <Modal
        title="Registration Link"
        open={tokenModal?.open || false}
        onCancel={() => setTokenModal(null)}
        footer={[
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={() => copyLink(tokenModal?.url || "")}>
            Copy Link
          </Button>,
          <Button key="close" onClick={() => setTokenModal(null)}>Close</Button>,
        ]}
        width={560}
      >
        {tokenModal && (
          <div>
            <p><Text strong>Case:</Text> {tokenModal.caseNumber}</p>
            <Card size="small" style={{ background: "#f6ffed", marginBottom: 12 }}>
              <Text copyable style={{ wordBreak: "break-all", fontSize: 14 }}>
                {tokenModal.url}
              </Text>
            </Card>
            <p>
              <Text type="secondary">
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                Expires: {tokenModal.expires ? dayjs(tokenModal.expires).format("YYYY-MM-DD HH:mm") : "N/A"}
              </Text>
            </p>
            <Divider />
            <Text type="secondary">
              Share this link with the family. They can register sample information without logging in.
            </Text>
          </div>
        )}
      </Modal>
    </>
  );
}
