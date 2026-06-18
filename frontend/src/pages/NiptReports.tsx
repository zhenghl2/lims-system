import { useState, useEffect } from "react";
import {
  Table, Card, Typography, Tag, Button, Modal, Select, Input,
  Space, message, Descriptions, Dropdown
} from "antd";
import { ReloadOutlined, CheckCircleOutlined, SafetyCertificateOutlined, DownloadOutlined, FileWordOutlined, FilePdfOutlined } from "@ant-design/icons";
import { reportsApi } from "../api";

const { Title, Text } = Typography;

const REVIEWERS = [
  { value: "叶秀清", label: "叶秀清" },
  { value: "张云红", label: "张云红" },
  { value: "吴梦婷", label: "吴梦婷" },
  { value: "陈宇佳", label: "陈宇佳" },
];

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", REVIEWED: "blue", VERIFIED: "purple",
  SIGNED: "orange", RELEASED: "green",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", REVIEWED: "已复核", VERIFIED: "已验证",
  SIGNED: "已签名", RELEASED: "已发布",
};

export default function NiptReports() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ open: boolean; reportId: string }>({ open: false, reportId: "" });
  const [verifyModal, setVerifyModal] = useState<{ open: boolean; reportId: string }>({ open: false, reportId: "" });
  const [reviewer, setReviewer] = useState("");
  const [verifier, setVerifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await reportsApi.list({
        panel_code: "NIPT,NIPT_PLUS,NIPT_FULL",
        page_size: 200,
        ordering: "-created_at",
      });
      const data = (res.data as any)?.results || res.data || [];
      setReports(data);
    } catch { message.error("Failed to load reports"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchReports(); }, []);

  const handleDownload = (reportId: string, format?: string) => {
    const fmt = format || "docx";
    reportsApi.download(reportId, { type: fmt }).then((res: any) => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      const d = res.headers?.["content-disposition"] || "";
      const m = d.match(/filename="?(.+?)"?$/);
      const ext = fmt === "pdf" ? ".pdf" : ".docx";
      a.download = m ? m[1] : "report" + ext;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }).catch(() => message.error("Download failed"));
  };

  const handleReview = async () => {
    if (!reviewer) { message.warning("请选择审核人员"); return; }
    if (!password) { message.warning("请输入密码"); return; }
    setSubmitting(true);
    try {
      await reportsApi.review(reviewModal.reportId, {
        reviewer_name: reviewer,
        password,
      });
      message.success({ content: `已复核 - ${reviewer}`, duration: 5 });
      setReviewModal({ open: false, reportId: "" });
      setReviewer(""); setPassword("");
      fetchReports();
      setTimeout(() => handleDownload(reviewModal.reportId), 500);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "复核失败");
    } finally { setSubmitting(false); }
  };

  const handleVerify = async () => {
    if (!verifier) { message.warning("请选择验证人员"); return; }
    if (!password) { message.warning("请输入密码"); return; }
    setSubmitting(true);
    try {
      await reportsApi.verify(verifyModal.reportId, {
        verifier_name: verifier,
        password,
      });
      message.success(`已发布 — ${verifier}`);
      setVerifyModal({ open: false, reportId: "" });
      setVerifier(""); setPassword("");
      fetchReports();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "验证失败");
    } finally { setSubmitting(false); }
  };

  // Bio data column helpers
  const formatNum = (v: any) => v != null ? (typeof v === 'number' ? v.toLocaleString() : String(v)) : "—";
  const formatFloat = (v: any, decimals = 2) => v != null ? Number(v).toFixed(decimals) : "—";

  const getBio = (record: any, field: string) => record.bio_data?.[field];

  const makeBioCol = (title: string, field: string, width: number, fmt?: (v: any) => string) => ({
    title, key: field, width, align: "center" as const,
    render: (_: any, r: any) => {
      const v = getBio(r, field);
      return fmt ? fmt(v) : (v != null && v !== "" ? String(v) : "—");
    },
  });

  const columns = [
    { title: "Report #", dataIndex: "report_number", width: 150, fixed: "left" as const,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: "VG ID", dataIndex: "sample_vg_id", width: 85, fixed: "left" as const,
      render: (v: string) => v || "—" },
    { title: "Name", dataIndex: "patient_name", width: 110, ellipsis: true },
    { title: "Sample Source",dataIndex: "sample_source", width: 110, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Test Option", dataIndex: "test_option", width: 85, render: (v: any) => { if (!v) return "—"; const colors: Record<string, string> = { "basic": "blue", "plus": "purple", "basic_all": "green" }; const key = (v || "").toLowerCase().replace(/ /g, "_"); return <Tag color={colors[key] || "default"} style={{ fontSize: 10 }}>{v}</Tag>; } },
    { title: "Accessioning ID", dataIndex: "external_id", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Collection Date", dataIndex: "collection_date", width: 90, render: (v: any) => v || "—" },
    { title: "Acceptance Date", dataIndex: "acceptance_date", width: 90, render: (v: any) => v || "—" },
    { title: "Physician", dataIndex: "physician", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Patient ID", dataIndex: "id_card", width: 130, ellipsis: true, render: (v: any) => v || "—" },
    { title: "DOB", dataIndex: "patient_dob", width: 85, render: (v: any) => v || "—" },
    { title: "LMP", dataIndex: "last_menstrual_period", width: 90, render: (v: any) => v || "—" },
    { title: "Hospital/Clinic", dataIndex: "ordering_facility", width: 130, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Gest. Weeks", dataIndex: "gestational_weeks", width: 75, align: "center" as const, render: (v: any) => v != null ? `${v}w` : "—" },
    { title: "Report Code", dataIndex: "report_code", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Send Report ID", dataIndex: "send_report_id", width: 90, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Age", dataIndex: "age", width: 50, align: "center" as const, render: (v: any) => v != null ? String(v) : "—" },
    { title: "Twin", dataIndex: "multiple_gestation", width: 50, align: "center" as const, render: (v: any) => v ? "👶👶" : "—" },
    { title: "IVF", dataIndex: "ivf_status", width: 50, align: "center" as const, render: (v: any) => v ? <Tag color="orange" style={{ fontSize: 10 }}>IVF</Tag> : "—" },
    { title: "Preg. History", dataIndex: "pregnancy_history", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: "Diagnosis", dataIndex: "clinical_diagnosis", width: 120, ellipsis: true, render: (v: any) => v || "—" },
    makeBioCol("All Chrom", "all_chrom", 80),
    makeBioCol("Plus Result", "plus_result", 90),
    makeBioCol("Plus HighRisk", "plus_highrisk_items", 110),
    makeBioCol("raw-reads", "raw_reads", 90, (v: any) => v != null ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(v)) : "—"),
    makeBioCol("uniq-reads", "uniq_reads", 90, formatNum),
    makeBioCol("GC (%)", "gc", 70, formatFloat),
    makeBioCol("Dup (%)", "dup", 70, formatFloat),
    makeBioCol("Result", "result", 100),
    makeBioCol("Z21", "z21", 65, formatFloat),
    makeBioCol("Z18", "z18", 65, formatFloat),
    makeBioCol("Z13", "z13", 65, formatFloat),
    makeBioCol("T21", "t21", 70),
    makeBioCol("T18", "t18", 70),
    makeBioCol("T13", "t13", 70),
    makeBioCol("XO", "xo", 60),
    makeBioCol("XXX", "xxx", 60),
    makeBioCol("XXY", "xxy", 60),
    makeBioCol("XYY", "xyy", 60),
    makeBioCol("FF (%)", "ff_percent", 65, formatFloat),
    makeBioCol("Sex", "sex", 55),
    {
      title: "", key: "download", width: 60, align: "center" as const,
      render: (_: any, r: any) => {
        if (r.pdf_file_path) {
          const items = [
            { key: 'docx', icon: <FileWordOutlined />, label: 'Word' },
            { key: 'pdf', icon: <FilePdfOutlined />, label: 'PDF' },
          ];
          return (
            <Dropdown menu={{
              items: items.map(it => ({ ...it, onClick: () => handleDownload(r.id, it.key) })),
            }} trigger={['click']}>
              <Button size="small" type="link" icon={<DownloadOutlined />} />
            </Dropdown>
          );
        }
        return null;
      },
    },
    {
      title: "Reviewed By", key: "review", width: 160,
      render: (_: any, r: any) => {
        if (r.reviewed_by_name) {
          return (
            <Space size={4} direction="vertical" style={{ gap: 0 }}>
              <Text style={{ color: "#52c41a", fontSize: 12 }}>✓ {r.reviewed_by_name}</Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : ""}
              </Text>
            </Space>
          );
        }
        // Allow review for DRAFT or REVIEWED status
        const canReview = r.status === "DRAFT" || r.status === "REVIEWED";
        return (
          <Button
            size="small"
            type="primary"
            ghost
            icon={<CheckCircleOutlined />}
            disabled={!canReview && r.status !== "DRAFT"}
            onClick={() => setReviewModal({ open: true, reportId: r.id })}
          >
            结果复核
          </Button>
        );
      },
    },
    {
      title: "Verified By", key: "verify", width: 160,
      render: (_: any, r: any) => {
        if (r.verified_by_name) {
          return (
            <Space size={4} direction="vertical" style={{ gap: 0 }}>
              <Text style={{ color: "#1677ff", fontSize: 12 }}>✓ {r.verified_by_name}</Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {r.verified_at ? new Date(r.verified_at).toLocaleDateString() : ""}
              </Text>
            </Space>
          );
        }
        // Allow verify only after reviewed
        const canVerify = r.status === "REVIEWED";
        return canVerify ? (
          <Button
            size="small"
            type="primary"
            ghost
            icon={<SafetyCertificateOutlined />}
            onClick={() => setVerifyModal({ open: true, reportId: r.id })}
          >
            报告验证
          </Button>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>待复核</Text>
        );
      },
    },
    {
      title: "Status", dataIndex: "status", width: 80, fixed: "right" as const,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{STATUS_LABEL[v] || v}</Tag>,
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>NIPT Reports</Title>
        <Space>
          <Text type="secondary">
            {reports.length} reports | 已复核: {reports.filter(r => r.status === "REVIEWED" || r.status === "RELEASED").length}
            {" "}| 已发布: {reports.filter(r => r.status === "RELEASED").length}
          </Text>
          <Button icon={<ReloadOutlined />} onClick={fetchReports} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {/* Workflow guide */}
      <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="① 结果复核 (Reviewed By)">
            <Tag color="blue">审核生信分析结果 → 报告 DRAFT</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="② 报告验证 (Verified By)">
            <Tag color="purple">检查报告内容 → 报告 RELEASED</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="审核人员">
            <Text code>叶秀清 / 张云红 / 吴梦婷 / 陈宇佳</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Table
        rowKey="id"
        dataSource={reports}
        columns={columns}
        loading={loading}
        size="small"
        scroll={{ x: 5100 }}
        pagination={{ pageSize: 30, showTotal: t => `Total ${t}` }}
        bordered
        components={{
          header: {
            cell: (props: any) => (
              <th {...props} style={{ ...props.style, background: "#fafafa", fontWeight: 600, fontSize: 11, padding: "4px 6px", whiteSpace: "nowrap" }} />
            ),
          },
        }}
      />

      {/* Review Modal */}
      <Modal
        title="结果复核 — Reviewed By"
        open={reviewModal.open}
        onOk={handleReview}
        onCancel={() => { setReviewModal({ open: false, reportId: "" }); setReviewer(""); setPassword(""); }}
        confirmLoading={submitting}
        okText="确认复核"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>审核人员</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder="选择审核人员"
              options={REVIEWERS}
              value={reviewer || undefined}
              onChange={setReviewer}
            />
          </div>
          <div>
            <Text strong>密码</Text>
            <Input.Password
              style={{ marginTop: 4 }}
              placeholder="输入密码确认"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleReview}
            />
          </div>
        </Space>
      </Modal>

      {/* Verify Modal */}
      <Modal
        title="报告验证 — Verified By"
        open={verifyModal.open}
        onOk={handleVerify}
        onCancel={() => { setVerifyModal({ open: false, reportId: "" }); setVerifier(""); setPassword(""); }}
        confirmLoading={submitting}
        okText="确认验证并发布"
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>验证人员</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder="选择验证人员"
              options={REVIEWERS}
              value={verifier || undefined}
              onChange={setVerifier}
            />
          </div>
          <div>
            <Text strong>密码</Text>
            <Input.Password
              style={{ marginTop: 4 }}
              placeholder="输入密码确认"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleVerify}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
