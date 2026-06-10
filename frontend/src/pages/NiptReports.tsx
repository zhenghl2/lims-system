import { useState, useEffect } from "react";
import { Table, Card, Typography, Tag, Button, Descriptions, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { reportsApi } from "../api";

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", REVIEWED: "blue", VERIFIED: "purple",
  SIGNED: "orange", RELEASED: "green",
};

export default function NiptReports() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await reportsApi.list({ page_size: 50 });
      setReports((res.data as any)?.results || res.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchReports(); }, []);

  const columns = [
    { title: "Report #", dataIndex: "report_number", width: 160, render: (v: string) => <Text code>{v}</Text> },
    { title: "Sample", dataIndex: "sample_barcode", width: 150 },
    { title: "Patient", dataIndex: "patient_name", width: 130 },
    { title: "Panel", dataIndex: "panel_code", width: 100, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: "Status", dataIndex: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: "Reviewed By", dataIndex: "reviewed_by_name", width: 120, render: (v: string) => v || "-" },
    { title: "Verified By", dataIndex: "verified_by_name", width: 120, render: (v: string) => v || "-" },
    { title: "Released", dataIndex: "released_at", width: 110, render: (v: string) => v ? new Date(v).toLocaleDateString() : "-" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>NIPT Reports</Title>
        <Button icon={<ReloadOutlined />} onClick={fetchReports} loading={loading}>Refresh</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="T21 (Chr21)"><Text style={{ color: "#1677ff", fontWeight: 700 }}>NIPT Reports</Text></Descriptions.Item>
          <Descriptions.Item label="T18 (Chr18)"><Text type="secondary">Risk scores calculated from z-score analysis</Text></Descriptions.Item>
          <Descriptions.Item label="T13 (Chr13)"><Text type="secondary">Fetal fraction, GC correction, and bioinformatics pipeline results</Text></Descriptions.Item>
          <Descriptions.Item label="FF Threshold"><Tag color="blue">≥ 4%</Tag></Descriptions.Item>
        </Descriptions>
      </Card>

      {reports.length > 0 ? (
        <Table rowKey="id" dataSource={reports} columns={columns} loading={loading}
          pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }} size="middle" />
      ) : (
        <Empty description="No reports yet. Reports are generated after workflow completion." />
      )}
    </div>
  );
}