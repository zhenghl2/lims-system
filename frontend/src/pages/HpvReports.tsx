import { useEffect, useState } from "react";
import { Table, Tag, Typography } from "antd";
import api from "../api/client";

const { Title } = Typography;

const STATUS_MAP: Record<string, string> = {
  DRAFT: "default", PENDING_REVIEW: "processing", VERIFIED: "blue",
  RELEASED: "green", REJECTED: "red",
};

export default function HpvReports() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/reports/", { params: { panel: "HPV" } })
      .then(r => setData(r.data.results || r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: "Report #", dataIndex: "report_number", key: "report_number", width: 120 },
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 150 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    {
      title: "Overall Result", dataIndex: "overall_result", key: "overall_result", width: 120,
      render: (r: string) => <Tag color={r === "POSITIVE" ? "red" : "green"}>{r || "\u2014"}</Tag>,
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 120,
      render: (s: string) => <Tag color={STATUS_MAP[s] || "default"}>{s}</Tag>,
    },
    { title: "Created At", dataIndex: "created_at", key: "created_at", width: 120, render: (d: string) => d?.slice(0, 10) },
  ];

  return (
    <div>
      <Title level={4}>HPV Reports</Title>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={{ pageSize: 20 }} />
    </div>
  );
}
