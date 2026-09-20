// NipptReports.tsx — NIPPT 报告模块：按生信批次组织，配对级报告管理
import { useState, useEffect } from "react";
import { Table, Tag, Spin, Typography, Space, Button, Drawer, Select, Input, message, Tooltip } from "antd";
import {
  FileTextOutlined, DownloadOutlined, EyeOutlined, UploadOutlined,
  CheckCircleOutlined, ReloadOutlined,
} from "@ant-design/icons";
import api from "../api/client";

const { Text, Title } = Typography;

interface UserItem { id: string; username: string; }

export default function NipptReports() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [revSel, setRevSel] = useState<Record<string, string>>({});
  const [audSel, setAudSel] = useState<Record<string, string>>({});
  const [noteEdit, setNoteEdit] = useState<Record<string, string>>({});

  const loadBatches = async () => {
    try {
      const r = await api.get("/cases/bioinfo/");
      const all = r.data?.results || [];
      setBatches(all.filter((b: any) => b.status === "COMPLETED"));
    } catch { message.error("加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadBatches();
    api.get("/users/").then((r: any) => setUsers((r.data?.results || r.data || []).filter((u: any) => u.username !== "AnonymousUser"))).catch(() => {});
  }, []);

  const openBatch = async (b: any) => {
    setDrawerOpen(true); setDetailLoading(true);
    setRevSel({}); setAudSel({}); setNoteEdit({});
    try {
      const r = await api.get(`/cases/bioinfo/${b.id}/`);
      setSelectedBatch(r.data);
    } catch { message.error("加载失败"); }
    finally { setDetailLoading(false); }
  };

  const refreshDetail = async () => {
    if (!selectedBatch) return;
    try {
      const r = await api.get(`/cases/bioinfo/${selectedBatch.id}/`);
      setSelectedBatch(r.data);
    } catch {}
  };

  const fmtDT = (v: string | null | undefined) => v ? `${v.slice(5, 10)} ${v.slice(11, 16)}` : "—";

  // 未达标：结果未填 或 QC 有异常标记
  const notQualified = (p: any) => !p.result || (p.qc_flag || "") !== "";

  const doSetReview = async (pair: any, type: "review" | "audit") => {
    const sel = type === "review" ? (revSel[pair.id] || pair.report_reviewer) : (audSel[pair.id] || pair.report_auditor);
    if (!sel) { message.warning(`请先选择${type === "review" ? "复核人" : "审核人"}`); return; }
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/set-review/`, {
        pair_id: pair.id,
        action_type: type,
        ...(type === "review" ? { reviewer_id: sel } : { auditor_id: sel }),
      });
      message.success(`${type === "review" ? "复核" : "审核"}已记录`);
      refreshDetail();
    } catch { message.error("操作失败"); }
  };

  const saveNote = async (pair: any) => {
    const val = noteEdit[pair.id];
    if (val === undefined) return;
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/set-review/`, {
        pair_id: pair.id, action_type: "note", report_note: val,
      });
      message.success("备注已保存");
      refreshDetail();
    } catch { message.error("保存失败"); }
  };

  const batchColumns = [
    { title: "批次号", dataIndex: "batch_number", key: "bn", width: 180, render: (v: string) => <Text code>{v}</Text> },
    { title: "状态", dataIndex: "status", key: "st", width: 90, render: () => <Tag color="green">已完成</Tag> },
    { title: "配对数", dataIndex: "pair_count", key: "pc", width: 80, align: "center" as const },
    { title: "结果已填", key: "cc", width: 90, align: "center" as const,
      render: (_: any, r: any) => `${r.completed_pair_count ?? 0}/${r.pair_count ?? 0}` },
    { title: "报告进度", key: "rp", width: 110, align: "center" as const,
      render: (_: any, r: any) => {
        const n = r.reported_pair_count || 0;
        const t = r.pair_count || 0;
        return <Tag color={t > 0 && n >= t ? "green" : n > 0 ? "orange" : "default"}>{n}/{t}</Tag>;
      } },
    { title: "完成时间", dataIndex: "updated_at", key: "ut", width: 130, render: fmtDT },
    { title: "操作", key: "op", width: 90,
      render: (_: any, r: any) => <Button size="small" type="primary" ghost onClick={() => openBatch(r)}>查看</Button> },
  ];

  const pairColumns = [
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 150, ellipsis: true, fixed: "left" as const },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 90 },
    { title: "来源", dataIndex: "case_source", key: "src", width: 66, render: (v: string) => v || "—" },
    { title: "Mother", dataIndex: "mother_name", key: "mn", width: 110, ellipsis: true },
    { title: "Father", dataIndex: "father_name", key: "fn", width: 120, ellipsis: true },
    { title: "标签", dataIndex: "father_label", key: "lb", width: 52, render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag> },
    { title: "M.Layers", dataIndex: "mother_layers", key: "ml", width: 76, render: (v: any) => v ?? "—" },
    { title: "M.Conc", dataIndex: "mother_concentration", key: "mc", width: 72, render: (v: any) => v ?? "—" },
    { title: "M.Het", dataIndex: "mother_het_ratio", key: "mh", width: 68, render: (v: any) => v ?? "—" },
    { title: "M.Y", dataIndex: "mother_y_ratio", key: "my", width: 64, render: (v: any) => v ?? "—" },
    { title: "F.Layers", dataIndex: "father_layers", key: "fl", width: 76, render: (v: any) => v ?? "—" },
    { title: "F.Conc", dataIndex: "father_concentration", key: "fc", width: 72, render: (v: any) => v ?? "—" },
    { title: "F.Het", dataIndex: "father_het_ratio", key: "fh", width: 68, render: (v: any) => v ?? "—" },
    { title: "F.Y", dataIndex: "father_y_ratio", key: "fy", width: 64, render: (v: any) => v ?? "—" },
    { title: "CPI", dataIndex: "cpi", key: "cp", width: 96,
      render: (v: any, r: any) => v != null ? <Text strong>{v}{r.cpi_combined != null ? ` / ${r.cpi_combined}` : ""}</Text> : "—" },
    { title: "Result", dataIndex: "result_display", key: "rd", width: 100,
      render: (v: string) => {
        if (!v) return <Tag color="red">未填</Tag>;
        const color = v === "支持" ? "green" : v === "不支持" ? "red" : "orange";
        return <Tag color={color}>{v}</Tag>;
      } },
    { title: "Note", dataIndex: "note", key: "nt", width: 100, ellipsis: true, render: (v: string) => v || "—" },
    { title: "QC", dataIndex: "qc_flag_display", key: "qc", width: 100,
      render: (v: string) => v ? <Tag color="red">{v}</Tag> : <Tag color="green">✓</Tag> },
    // ── 报告新列 ──
    { title: "报告", key: "rf", width: 110,
      render: (_: any, r: any) => r.report_file_url ? (
        <Space size={4}>
          <Tooltip title="下载"><a href={r.report_file_url} download><Button size="small" icon={<DownloadOutlined />} /></a></Tooltip>
          <Tooltip title="预览"><a href={r.report_file_url} target="_blank" rel="noreferrer"><Button size="small" icon={<EyeOutlined />} /></a></Tooltip>
        </Space>
      ) : <Text type="secondary" style={{ fontSize: 11 }}>未上传</Text> },
    { title: "复核人", key: "rv", width: 145,
      render: (_: any, r: any) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Select size="small" style={{ width: 125 }} placeholder="选择"
            value={revSel[r.id] ?? (r.report_reviewer || undefined)}
            onChange={(v) => setRevSel(prev => ({ ...prev, [r.id]: v }))}
            options={users.map(u => ({ label: u.username, value: u.id }))} showSearch optionFilterProp="label" />
          {r.report_reviewer_name && <Text type="success" style={{ fontSize: 11 }}>✓ {r.report_reviewer_name}</Text>}
        </Space>
      ) },
    { title: "复核日期", dataIndex: "report_reviewed_at", key: "rvd", width: 100, render: fmtDT },
    { title: "审核人", key: "ad", width: 145,
      render: (_: any, r: any) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Select size="small" style={{ width: 125 }} placeholder="选择"
            value={audSel[r.id] ?? (r.report_auditor || undefined)}
            onChange={(v) => setAudSel(prev => ({ ...prev, [r.id]: v }))}
            options={users.map(u => ({ label: u.username, value: u.id }))} showSearch optionFilterProp="label" />
          {r.report_auditor_name && <Text type="success" style={{ fontSize: 11 }}>✓ {r.report_auditor_name}</Text>}
        </Space>
      ) },
    { title: "审核日期", dataIndex: "report_audited_at", key: "aud", width: 100, render: fmtDT },
    { title: "备注", key: "rn", width: 160,
      render: (_: any, r: any) => (
        <Input size="small" placeholder="报告备注" value={noteEdit[r.id] ?? r.report_note ?? ""}
          onChange={(e) => setNoteEdit(prev => ({ ...prev, [r.id]: e.target.value }))}
          onBlur={() => saveNote(r)} style={{ width: 150 }} />
      ) },
    { title: "操作", key: "act", width: 135, fixed: "right" as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />}
            onClick={() => doSetReview(r, "review")}>复核</Button>
          <Button size="small" icon={<CheckCircleOutlined />}
            onClick={() => doSetReview(r, "audit")}>审核</Button>
        </Space>
      ) },
  ];

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" tip="加载中..." /></div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Space>
          <FileTextOutlined style={{ fontSize: 18, color: "#1677ff" }} />
          <Title level={4} style={{ margin: 0 }}>报告管理</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>按生信批次组织 · 共 {batches.length} 个已完成批次</Text>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={loadBatches}>刷新</Button>
      </div>

      <Table
        size="small"
        rowKey="id"
        columns={batchColumns}
        dataSource={batches}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        locale={{ emptyText: "暂无已完成的生信批次" }}
      />

      <Drawer
        title={<Space><FileTextOutlined /> 报告批次 — <Text code>{selectedBatch?.batch_number || ""}</Text></Space>}
        width={1560}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); loadBatches(); }}
        destroyOnClose
      >
        {detailLoading ? <div style={{ textAlign: "center", padding: 60 }}><Spin /></div> : selectedBatch && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Space>
                <Text>配对数: <b>{selectedBatch.pairs?.length ?? 0}</b></Text>
                <Text>已上传报告: <b>{(selectedBatch.pairs || []).filter((p: any) => p.report_file_url).length}</b>/{(selectedBatch.pairs || []).length}</Text>
              </Space>
              <Button type="primary" icon={<UploadOutlined />}
                onClick={() => message.info("批量上传报告：功能开发中，敬请期待")}>批量上传报告</Button>
            </div>
            <Table
              size="small"
              rowKey="id"
              columns={pairColumns}
              dataSource={selectedBatch.pairs || []}
              pagination={false}
              scroll={{ x: 2100 }}
              onRow={(r: any) => ({
                style: notQualified(r) ? { background: "#fff2f0" } : {},
              })}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
