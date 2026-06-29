import { useState, useEffect } from "react";
import {
  Table, Card, Typography, Tag, Button, Modal, Select, Input,
  Space, message, Descriptions, Dropdown
} from "antd";
import { ReloadOutlined, CheckCircleOutlined, SafetyCertificateOutlined, DownloadOutlined, FileWordOutlined, FilePdfOutlined, EditOutlined } from "@ant-design/icons";
import { reportsApi } from "../api";
import api from "../api/client";
import { useTranslation } from "../i18n/useTranslation";

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

const TEST_OPTION_LETTER: Record<string, string> = {
  "Basic": "B",
  "Plus": "P",
  "Basic All": "A",
};

export default function NiptReports() {
  const { t } = useTranslation();
  const STATUS_LABEL_TL: Record<string, string> = {
    DRAFT: t("nipt.dashboard.draft"), REVIEWED: t("nipt.reports.reviewedStatus"),
    VERIFIED: t("nipt.reports.verifiedStatus"), SIGNED: t("nipt.reports.signedStatus"),
    RELEASED: t("nipt.reports.publishedStatus"),
  };
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ open: boolean; reportId: string }>({ open: false, reportId: "" });
  const [verifyModal, setVerifyModal] = useState<{ open: boolean; reportId: string }>({ open: false, reportId: "" });
  const [reviewer, setReviewer] = useState("");
  const [verifier, setVerifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Batch fill state
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchFillOpen, setBatchFillOpen] = useState(false);
  const [batchFillSuffix, setBatchFillSuffix] = useState("");
  // Inline edit state
  const [editingCell, setEditingCell] = useState<string>("");

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
      const m = d.match(/filename=\"?(.+?)\"?\$/);
      const ext = fmt === "pdf" ? ".pdf" : ".docx";
      a.download = m ? m[1] : "report" + ext;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }).catch(() => message.error("Download failed"));
  };

  const handleReview = async () => {
    if (!reviewer) { message.warning(t("nipt.reports.selectReviewer")); return; }
    if (!password) { message.warning(t("nipt.signer.passwordRequired")); return; }
    setSubmitting(true);
    try {
      await reportsApi.review(reviewModal.reportId, {
        reviewer_name: reviewer,
        password,
      });
      message.success({ content: `${t("nipt.reports.reviewed")} - ${reviewer}`, duration: 5 });
      setReviewModal({ open: false, reportId: "" });
      setReviewer(""); setPassword("");
      fetchReports();
      setTimeout(() => handleDownload(reviewModal.reportId), 500);
    } catch (e: any) {
      message.error(e?.response?.data?.error || t("nipt.reports.reviewFailed"));
    } finally { setSubmitting(false); }
  };

  const handleVerify = async () => {
    if (!verifier) { message.warning(t("nipt.reports.selectVerifier")); return; }
    if (!password) { message.warning(t("nipt.signer.passwordRequired")); return; }
    setSubmitting(true);
    try {
      await reportsApi.verify(verifyModal.reportId, {
        verifier_name: verifier,
        password,
      });
      message.success(`${t("nipt.reports.published")} — ${verifier}`);
      setVerifyModal({ open: false, reportId: "" });
      setVerifier(""); setPassword("");
      fetchReports();
    } catch (e: any) {
      message.error(e?.response?.data?.error || t("nipt.reports.verifyFailed"));
    } finally { setSubmitting(false); }
  };

  // Save single send_report_id inline edit
  const handleSaveSendId = async (reportId: string, sampleId: string, value: string) => {
    setEditingCell("");
    const trimmed = value.trim();
    try {
      await api.post("/reports/batch-update-send-report-id/", {
        updates: [{ sample_id: sampleId, send_report_id: trimmed }]
      });
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, send_report_id: trimmed } : r));
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Update failed");
    }
  };

  // Batch fill handler
  const handleBatchFill = async () => {
    if (!batchFillSuffix || selectedRowKeys.length === 0) return;

    const selected = reports.filter(r => selectedRowKeys.includes(r.id));
    // Only BCC
    const bcc = selected.filter(r => r.sample_source === "BCC");
    if (bcc.length === 0) {
      message.warning("No BCC samples selected");
      return;
    }

    // Parse suffix: letter + number, e.g. A250 or B008
    const match = batchFillSuffix.trim().match(/^([A-Z])(\d+)$/);
    if (!match) {
      message.warning("Invalid suffix format. Use e.g. A250 or B008");
      return;
    }
    const suffixLetter = match[1];
    let suffixNum = parseInt(match[2]);

    // Generate IDs, sorted by acceptance_date then external_id
    const sorted = [...bcc].sort((a, b) => {
      const da = a.acceptance_date || "";
      const db = b.acceptance_date || "";
      if (da !== db) return da.localeCompare(db);
      return (a.external_id || "").localeCompare(b.external_id || "");
    });

    const updates = sorted.map(r => {
      const dateStr = r.acceptance_date ? r.acceptance_date.replace(/-/g, "").slice(2) : "000000";
      const letter = TEST_OPTION_LETTER[r.test_option] || "X";
      const sid = `VGNPT${letter}TLBCC${dateStr}${suffixLetter}${suffixNum++}`;
      return { sample_id: r.sample, send_report_id: sid };
    });

    try {
      const res = await api.post("/reports/batch-update-send-report-id/", { updates });
      message.success(`Updated ${res.data.updated_count} samples`);
      // Update local state
      const updateMap = new Map(updates.map(u => [u.sample_id, u.send_report_id]));
      setReports(prev => prev.map(r => updateMap.has(r.sample) ? { ...r, send_report_id: updateMap.get(r.sample) } : r));
      setBatchFillOpen(false);
      setBatchFillSuffix("");
      setSelectedRowKeys([]);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Batch update failed");
    }
  };

  // Brazil fill: copy external_id -> send_report_id for 巴西万基/巴西 samples
  const handleBrazilFill = async () => {
    const selected = reports.filter(r => selectedRowKeys.includes(r.id));
    const brazil = selected.filter(r => r.sample_source === "巴西万基" || r.sample_source === "巴西");
    if (brazil.length === 0) { message.warning("No 巴西万基 samples selected"); return; }

    const updates = brazil.map(r => ({
      sample_id: r.sample,
      send_report_id: r.external_id || "",
    }));

    try {
      const res = await api.post("/reports/batch-update-send-report-id/", { updates });
      message.success(`Updated ${res.data.updated_count} samples`);
      const updateMap = new Map(updates.map(u => [u.sample_id, u.send_report_id]));
      setReports(prev => prev.map(r => updateMap.has(r.sample) ? { ...r, send_report_id: updateMap.get(r.sample) } : r));
      setSelectedRowKeys([]);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Batch update failed");
    }
  };

  // Selected BCC count for button display
  const selectedBcc = reports.filter(r => selectedRowKeys.includes(r.id) && r.sample_source === "BCC");
  const selectedBrazil = reports.filter(r => selectedRowKeys.includes(r.id) && (r.sample_source === "巴西万基" || r.sample_source === "巴西"));
  const selectedNonBcc = selectedRowKeys.filter(id => {
    const r = reports.find(r => r.id === id);
    return r && r.sample_source !== "BCC";
  });

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
    { title: t("nipt.reports.reportNumber"), dataIndex: "report_number", width: 150, fixed: "left" as const,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: t("nipt.samples.vgId"), dataIndex: "sample_vg_id", width: 85, fixed: "left" as const,
      render: (v: string) => v || "—" },
    { title: t("nipt.samples.name"), dataIndex: "patient_name", width: 110, ellipsis: true },
    { title: t("nipt.samples.sampleSource"),dataIndex: "sample_source", width: 110, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.testOption"), dataIndex: "test_option", width: 85, render: (v: any) => { if (!v) return "—"; const colors: Record<string, string> = { "basic": "blue", "plus": "purple", "basic_all": "green" }; const key = (v || "").toLowerCase().replace(/ /g, "_"); return <Tag color={colors[key] || "default"} style={{ fontSize: 10 }}>{v}</Tag>; } },
    { title: t("nipt.reports.accessioningId"), dataIndex: "external_id", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    // ── send_report_id: inline editable, right after accessioningId ──
    {
      title: t("nipt.samples.sendReportId"), dataIndex: "send_report_id", width: 200,
      render: (v: any, r: any) => {
        if (editingCell === r.id) {
          return (
            <Input
              size="small"
              autoFocus
              defaultValue={v || ""}
              onPressEnter={(e: any) => handleSaveSendId(r.id, r.sample, e.target.value)}
              onBlur={(e: any) => handleSaveSendId(r.id, r.sample, e.target.value)}
              style={{ width: 185 }}
              onKeyDown={(e: any) => { if (e.key === "Escape") setEditingCell(""); }}
            />
          );
        }
        return (
          <span onClick={() => setEditingCell(r.id)} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
            {v || <Text type="secondary">—</Text>}
            <EditOutlined style={{ marginLeft: 4, fontSize: 10, color: "#999" }} />
          </span>
        );
      }
    },
    { title: t("nipt.samples.collectionDate"), dataIndex: "collection_date", width: 90, render: (v: any) => v || "—" },
    { title: t("nipt.samples.acceptanceDate"), dataIndex: "acceptance_date", width: 90, render: (v: any) => v || "—" },
    { title: t("nipt.samples.physician"), dataIndex: "physician", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.patientId"), dataIndex: "id_card", width: 130, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.dob"), dataIndex: "patient_dob", width: 85, render: (v: any) => v || "—" },
    { title: t("nipt.samples.lastMenstrualPeriod"), dataIndex: "last_menstrual_period", width: 90, render: (v: any) => v || "—" },
    { title: t("nipt.samples.hospital"), dataIndex: "ordering_facility", width: 130, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.gestWeeks"), dataIndex: "gestational_weeks", width: 75, align: "center" as const, render: (v: any) => v != null ? `${v}w` : "—" },
    { title: t("nipt.samples.reportCode"), dataIndex: "report_code", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.age"), dataIndex: "age", width: 50, align: "center" as const, render: (v: any) => v != null ? String(v) : "—" },
    { title: t("nipt.samples.twin"), dataIndex: "multiple_gestation", width: 50, align: "center" as const, render: (v: any) => v ? "👶👶" : "—" },
    { title: t("nipt.samples.ivf"), dataIndex: "ivf_status", width: 50, align: "center" as const, render: (v: any) => v ? <Tag color="orange" style={{ fontSize: 10 }}>{t("nipt.samples.ivf")}</Tag> : "—" },
    { title: t("nipt.samples.pregHistory"), dataIndex: "pregnancy_history", width: 100, ellipsis: true, render: (v: any) => v || "—" },
    { title: t("nipt.samples.diagnosis"), dataIndex: "clinical_diagnosis", width: 120, ellipsis: true, render: (v: any) => v || "—" },
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
      title: t("nipt.reports.reviewedBy"), key: "review", width: 160,
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
              {t("nipt.reports.review")}
          </Button>
        );
      },
    },
    {
      title: t("nipt.reports.verifiedBy"), key: "verify", width: 160,
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
        const canVerify = r.status === "REVIEWED";
        return canVerify ? (
          <Button
            size="small"
            type="primary"
            ghost
            icon={<SafetyCertificateOutlined />}
            onClick={() => setVerifyModal({ open: true, reportId: r.id })}
          >
              {t("nipt.reports.verify")}
          </Button>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>{t("nipt.reports.pendingReview")}</Text>
        );
      },
    },
    {
      title: t("nipt.samples.status"), dataIndex: "status", width: 80, fixed: "right" as const,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{STATUS_LABEL_TL[v] || v}</Tag>,
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>{t("nipt.reports.title")}</Title>
        <Space>
          <Text type="secondary">
            {reports.length} reports | {t("nipt.reports.reviewedCount")}: {reports.filter(r => r.status === "REVIEWED" || r.status === "RELEASED").length}
            {" "}| {t("nipt.reports.publishedCount")}: {reports.filter(r => r.status === "RELEASED").length}
          </Text>
          {selectedRowKeys.length > 0 && (
            <Button
              type="primary"
              size="small"
              onClick={() => setBatchFillOpen(true)}
              disabled={selectedBcc.length === 0}
            >
              {t("nipt.reports.batchFillSendId")} ({selectedBcc.length} BCC)
            </Button>
          )}
          {selectedRowKeys.length > 0 && selectedBrazil.length > 0 && (
            <Button
              type="primary"
              size="small"
              onClick={handleBrazilFill}
            >
              填充巴西发送ID ({selectedBrazil.length} 巴西万基)
            </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchReports} loading={loading}>{t("nipt.reports.refresh")}</Button>
        </Space>
      </div>

      {/* Workflow guide */}
      <Card size="small" style={{ marginBottom: 12, background: "#fafafa" }}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label={t("nipt.reports.workflowGuide")}>
            <Tag color="blue">{t("nipt.reports.reviewGuide1")}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t("nipt.reports.verifyGuide")}>
            <Tag color="purple">{t("nipt.reports.reviewGuide2")}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t("nipt.reports.reviewer")}>
            <Text code>{t("nipt.reports.reviewerList")}</Text>
          </Descriptions.Item>
        </Descriptions>
        {selectedNonBcc.length > 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {selectedNonBcc.length} non-BCC sample(s) selected, will be skipped during batch fill.
          </Text>
        )}
      </Card>

      <Table
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys: any) => setSelectedRowKeys(keys as string[]),
        }}
        dataSource={reports}
        columns={columns}
        loading={loading}
        size="small"
        scroll={{ x: 5200 }}
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
        title={t("nipt.reports.reviewTitle")}
        open={reviewModal.open}
        onOk={handleReview}
        onCancel={() => { setReviewModal({ open: false, reportId: "" }); setReviewer(""); setPassword(""); }}
        confirmLoading={submitting}
        okText={t("nipt.reports.confirmReview")}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>{t("nipt.reports.reviewer")}</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder={t("nipt.reports.selectReviewer")}
              options={REVIEWERS}
              value={reviewer || undefined}
              onChange={setReviewer}
            />
          </div>
          <div>
            <Text strong>{t("nipt.reports.password")}</Text>
            <Input.Password
              style={{ marginTop: 4 }}
              placeholder={t("nipt.reports.enterPassword")}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleReview}
            />
          </div>
        </Space>
      </Modal>

      {/* Verify Modal */}
      <Modal
        title={t("nipt.reports.verifyTitle")}
        open={verifyModal.open}
        onOk={handleVerify}
        onCancel={() => { setVerifyModal({ open: false, reportId: "" }); setVerifier(""); setPassword(""); }}
        confirmLoading={submitting}
        okText={t("nipt.reports.confirmVerify")}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>{t("nipt.reports.verifier")}</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder={t("nipt.reports.selectVerifier")}
              options={REVIEWERS}
              value={verifier || undefined}
              onChange={setVerifier}
            />
          </div>
          <div>
            <Text strong>{t("nipt.reports.password")}</Text>
            <Input.Password
              style={{ marginTop: 4 }}
              placeholder={t("nipt.reports.enterPassword")}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onPressEnter={handleVerify}
            />
          </div>
        </Space>
      </Modal>

      {/* Batch Fill Modal */}
      <Modal
        title={t("nipt.reports.batchFillSendId")}
        open={batchFillOpen}
        onOk={handleBatchFill}
        onCancel={() => { setBatchFillOpen(false); setBatchFillSuffix(""); }}
        okText={t("nipt.reports.fillGenerate")}
        width={650}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>{t("nipt.reports.selectedBccSamples")}: {selectedBcc.length}</Text>
        </div>
        {/* Preview list */}
        <div style={{ maxHeight: 260, overflow: "auto", marginBottom: 16, background: "#fafafa", padding: 8, borderRadius: 4 }}>
          <table style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "2px 6px" }}>VG ID</th>
                <th style={{ textAlign: "left", padding: "2px 6px" }}>{t("nipt.samples.name")}</th>
              </tr>
            </thead>
            <tbody>
              {selectedBcc.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: "2px 6px" }}><Text code style={{ fontSize: 11 }}>{r.sample_vg_id || "—"}</Text></td>
                  <td style={{ padding: "2px 6px" }}>{r.patient_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Text strong>{t("nipt.reports.suffixFormat")}</Text>
          <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 11 }}>
            VGNPT&#123;A/B/P&#125;TLBCC&#123;YYMMDD&#125;<b>[suffix]</b> {" "}
            e.g. A250 → A250, A251, A252...
          </Text>
        </div>
        <Input
          placeholder="e.g. A250 or B008"
          value={batchFillSuffix}
          onChange={e => setBatchFillSuffix(e.target.value)}
          onPressEnter={handleBatchFill}
          style={{ width: 280 }}
          autoFocus
        />
      </Modal>
    </div>
  );
}
