import { SIGNER_IMAGES } from "./hpv/constants";
import { useEffect, useState } from "react";
import { Table, Tag, Typography, Button, Modal, Spin, Space, Card, Row, Col, Input, message } from "antd";
import { EyeOutlined, DownloadOutlined, CheckOutlined } from "@ant-design/icons";
import api from "../api/client";
const { Title, Text } = Typography;
const REVIEWERS = Object.entries(SIGNER_IMAGES).map(([name, image]) => ({ name, image }));
const STATUS_MAP: Record<string, string> = {
DRAFT: "default", REVIEWED: "blue", VERIFIED: "geekblue",
SIGNED: "purple", RELEASED: "green", AMENDED: "orange",
};
export default function HpvReports() {
const [data, setData] = useState<any[]>([]);
const [loading, setLoading] = useState(false);
const [reportHtml, setReportHtml] = useState("");
const [htmlLoading, setHtmlLoading] = useState(false);
const [modalOpen, setModalOpen] = useState(false);
const [genModalOpen, setGenModalOpen] = useState(false);
const [genRecord, setGenRecord] = useState<any>(null);
const [selectedReviewer, setSelectedReviewer] = useState("");
const [reviewerPassword, setReviewerPassword] = useState("");
const [genLoading, setGenLoading] = useState(false);
useEffect(() => {
setLoading(true);
api.get("/reports/", { params: { panel: "HPV" } })
.then(r => setData(r.data.results || r.data))
.catch(() => {})
.finally(() => setLoading(false));
}, []);
const viewReport = async (record: any) => {
const resultId = record.content?.hpv_result_id;
if (!resultId) {
  message.warning("报告尚未关联检测结果，请重新标记");
  return;
}
setHtmlLoading(true);
setModalOpen(true);
try {
const { data } = await api.get(`/hpv/results/${resultId}/report_html/`);
setReportHtml(data.html || "");
} catch (e: any) {
setReportHtml("<p style='color:red'>报告加载失败</p>");
} finally { setHtmlLoading(false); }
};
const openGenerate = (record: any) => {
setGenRecord(record);
setSelectedReviewer("");
setReviewerPassword("");
setGenModalOpen(true);
};
const confirmGenerate = async () => {
if (!selectedReviewer) { message.warning("请选择审核者"); return; }
if (!reviewerPassword) { message.warning("请输入审核者密码"); return; }
setGenLoading(true);
try {
await api.post("/hpv/results/verify_reviewer/", {
  reviewer: selectedReviewer,
  password: reviewerPassword,
});
// Advance report through review -> sign -> release
if (genRecord?.id) {
  await api.post(`/reports/${genRecord.id}/review/`);
  await api.post(`/reports/${genRecord.id}/sign/`, { password: reviewerPassword });
  await api.post(`/reports/${genRecord.id}/release/`);
}
// Trigger PDF print
const resultId = genRecord?.content?.hpv_result_id;
if (resultId) {
const { data } = await api.get(`/hpv/results/${resultId}/report_html/`);
const printWin = window.open('', '_blank');
if (printWin) {
printWin.document.write(data.html);
printWin.document.close();
setTimeout(() => printWin.print(), 500);
}
}
// Refresh list to show updated status
setGenModalOpen(false);
message.success("报告已生成并发送至打印机");
setLoading(true);
api.get("/reports/", { params: { panel: "HPV" } })
  .then(r => setData(r.data.results || r.data))
  .catch(() => {})
  .finally(() => setLoading(false));
} catch (e: any) {
const d = e?.response?.data;
const msg = d?.error || d?.detail || "验证失败";
message.error(msg);
} finally { setGenLoading(false); }
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
title: "Actions", key: "actions", width: 180,
render: (_: any, record: any) => (
record.content?.hpv_result_id ? (
<Space>
<Button size="small" icon={<EyeOutlined />} onClick={() => viewReport(record)}>View</Button>
<Button size="small" icon={<DownloadOutlined />} onClick={() => downloadReport(record)}>PDF</Button>
<Button size="small" type="primary" onClick={() => openGenerate(record)}>Generate</Button>
</Space>
) : <Button size="small" disabled>—</Button>
),
},
];
return (
<div>
<Title level={4}>HPV Reports</Title>
<Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={{ pageSize: 20 }} />
{/* Preview Modal */}
<Modal title="HPV Report Preview" open={modalOpen} onCancel={() => setModalOpen(false)}
width={800} footer={null} style={{ top: 20 }}>
<Spin spinning={htmlLoading}>
{reportHtml ? (
<iframe srcDoc={reportHtml} style={{ width: "100%", height: "70vh", border: "none" }} />
) : null}
</Spin>
</Modal>
{/* Generate Report Modal */}
<Modal title="生成报告" open={genModalOpen} onCancel={() => setGenModalOpen(false)}
footer={[
<Button key="cancel" onClick={() => setGenModalOpen(false)}>取消</Button>,
<Button key="confirm" type="primary" loading={genLoading} onClick={confirmGenerate}
disabled={!selectedReviewer || !reviewerPassword}>确认生成</Button>,
]}
width={560}>
<Text strong style={{ display: "block", marginBottom: 16 }}>选择审核者</Text>
<Row gutter={[12, 12]}>
{REVIEWERS.map(r => (
<Col span={8} key={r.name}>
<Card
hoverable
size="small"
onClick={() => setSelectedReviewer(r.name)}
style={{
border: selectedReviewer === r.name ? "2px solid #1890ff" : "1px solid #d9d9d9",
textAlign: "center", cursor: "pointer",
}}
bodyStyle={{ padding: 8 }}>
<img src={r.image} alt={r.name} style={{ width: "100%", height: 70, objectFit: "contain", marginBottom: 4 }} />
<div>
<Text strong style={{ fontSize: 12 }}>{r.name}</Text>
{selectedReviewer === r.name && <CheckOutlined style={{ color: "#1890ff", marginLeft: 4 }} />}
</div>
</Card>
</Col>
))}
</Row>
<div style={{ marginTop: 16, textAlign: "center" }}>
<Input.Password
placeholder="请输入审核者密码"
value={reviewerPassword}
onChange={e => setReviewerPassword(e.target.value)}
style={{ maxWidth: 240 }}
onPressEnter={confirmGenerate}
/>
</div>
</Modal>
</div>
);
}
