import { useState, useEffect } from "react";
import { Table, Card, Tag, Spin, Alert, Typography, Space } from "antd";
import {
  FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, ExperimentOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";

const { Title } = Typography;

const STATUS_TAG: Record<string, { color: string; icon: React.ReactNode }> = {
  DRAFT:       { color: "default",    icon: <FileTextOutlined /> },
  REGISTERED:  { color: "blue",       icon: <FileTextOutlined /> },
  RECEIVED:    { color: "processing", icon: <ClockCircleOutlined /> },
  IN_PROCESS:  { color: "orange",     icon: <ExperimentOutlined /> },
  REPORTED:    { color: "green",      icon: <CheckCircleOutlined /> },
  CLOSED:      { color: "purple",     icon: <CheckCircleOutlined /> },
  CANCELLED:   { color: "red",        icon: <CloseCircleOutlined /> },
};

export default function NipptReports() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (casesApi as any).list({ limit: 200, ordering: "-created_at" })
      .then((r: any) => { setCases(r.data?.results || []); setLoading(false); })
      .catch((e: any) => { setError(e.message); setLoading(false); });
  }, []);

  const columns = [
    {
      title: "Case #", dataIndex: "case_number", key: "case_number",
      render: (v: string) => <a href={`/nippt/cases/${v}`} style={{ fontWeight: 600 }}>{v}</a>,
    },
    {
      title: "Panel", dataIndex: "panel_name", key: "panel_name",
      render: (_: string, r: any) => r.panel_object?.name || r.panel_name || r.panel || "-",
    },
    {
      title: "Samples", dataIndex: "sample_count", key: "sample_count",
    },
    {
      title: "Status", dataIndex: "status", key: "status",
      render: (s: string) => {
        const cfg = STATUS_TAG[s] || { color: "default" };
        return <Tag color={cfg.color} icon={cfg.icon as any}>{s}</Tag>;
      },
    },
    {
      title: "Created", dataIndex: "created_at", key: "created_at",
      render: (v: string) => v ? new Date(v).toLocaleDateString() : "-",
    },
  ];

  const reportedCount = cases.filter((c: any) => c.status === "REPORTED").length;
  const inProcessCount = cases.filter((c: any) => c.status === "IN_PROCESS").length;

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" tip="Loading reports..." /></div>;
  if (error) return <Alert type="error" message={error} showIcon />;

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Card size="small">
          <Title level={5} style={{ margin: 0 }}>
            <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
            Reported: {reportedCount}
          </Title>
        </Card>
        <Card size="small">
          <Title level={5} style={{ margin: 0 }}>
            <ExperimentOutlined style={{ color: "#faad14", marginRight: 8 }} />
            In Process: {inProcessCount}
          </Title>
        </Card>
      </Space>
      <Table
        dataSource={cases}
        columns={columns}
        rowKey={(r: any) => r.id || r.case_number}
        size="middle"
        pagination={{ pageSize: 20 }}
      />
    </>
  );
}
