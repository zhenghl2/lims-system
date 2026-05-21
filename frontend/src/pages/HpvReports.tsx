import { useEffect, useState } from "react";
import { Table, Tag, Typography, Button, Modal, Spin, Space } from "antd";
import { EyeOutlined, DownloadOutlined } from "@ant-design/icons";
import api from "../api/client";
const { Title } = Typography;
const STATUS_MAP: Record<string, string> = {
  DRAFT: "default", PENDING_REVIEW: "processing", VERIFIED: "blue",
  RELEASED: "green", REJECTED: "red",
};
export default function HpvReports() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportHtml, setReportHtml] = useState("");
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/reports/", { params: { panel: "HPV" } })
      .then(r => setData(r.data.results || r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const viewReport = async (record: any) => {
    const resultId = record.content?.hpv_result_id;
    if (!resultId) return;
    setHtmlLoading(true);
    setModalOpen(true);
    try {
      const { data } = await api.get(`/hpv/results/${resultId}/report_html/`);
      setReportHtml(data.html || "");
    } catch (e: any) {
      setReportHtml("<p style='color:red'>Failed to load report</p>");
    } finally { setHtmlLoading(false); }
  };

  const downloadReport = (record: any) => {
    const resultId = record.content?.hpv_result_id;
    if (!resultId) return;
    setHtmlLoading(true);
    api.get(`/hpv/results/${resultId}/report_html/`).then(({ data }) => {
      const printWin = window.open('', '_blank');
      if (printWin) {
        printWin.document.write(data.html);
        printWin.document.close();
        printWin.onload = () => printWin.print();
        // Fallback: print after short delay
        setTimeout(() => printWin.print(), 500);
      }
    }).catch(() => {}).finally(() => setHtmlLoading(false));
  };

  const columns = [
    { title: "Report #", dataIndex: "report_number", key: "report_number", width: 140 },
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 130 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 120 },
    {
      title: "Overall Result", dataIndex: "overall_result", key: "overall_result", width: 110,
      render: (r: string) => <Tag color={r === "POSITIVE" ? "red" : "green"}>{r || "\u2014"}</Tag>,
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (s: string) => <Tag color={STATUS_MAP[s] || "default"}>{s}</Tag>,
    },
    { title: "Created", dataIndex: "created_at", key: "created_at", width: 100, render: (d: string) => d?.slice(0, 10) },
    {
      title: "Actions", key: "actions", width: 100,
      render: (_: any, record: any) => (
        record.content?.hpv_result_id ? (
          <Space>
            <Button size="small" icon={<EyeOutlined />} onClick={() => viewReport(record)}>View</Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadReport(record)}>PDF</Button>
          </Space>
        ) : <Button size="small" disabled>—</Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>HPV Reports</Title>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={{ pageSize: 20 }} />
      <Modal title="HPV Report" open={modalOpen} onCancel={() => setModalOpen(false)}
        width={800} footer={null} style={{ top: 20 }}>
        <Spin spinning={htmlLoading}>
          {reportHtml ? (
            <iframe srcDoc={reportHtml} style={{ width: "100%", height: "70vh", border: "none" }} />
          ) : null}
        </Spin>
      </Modal>
    </div>
  );
}
