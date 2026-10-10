// NipptReports.tsx — NIPPT 报告模块：按生信批次组织，配对级报告管理
import { useState, useEffect, useRef } from "react";
import { Table, Tag, Spin, Typography, Space, Button, Card, Empty, Select, Input, message, Tooltip, Modal, Popover, Alert } from "antd";
import {
  FileTextOutlined, DownloadOutlined, EyeOutlined, UploadOutlined,
  CheckCircleOutlined, ReloadOutlined, HistoryOutlined,
} from "@ant-design/icons";
import api from "../api/client";

const { Text, Title } = Typography;

interface UserItem { id: string; username: string; }

export default function NipptReports() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  // 批次级复核/审核（底部统一填，不需要每份报告都填）
  const [batRev, setBatRev] = useState<string | undefined>(undefined);
  const [batAud, setBatAud] = useState<string | undefined>(undefined);
  const [detailLoading, setDetailLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [revSel, setRevSel] = useState<Record<string, string>>({});
  const [audSel, setAudSel] = useState<Record<string, string>>({});
  const [noteEdit, setNoteEdit] = useState<Record<string, string>>({});
  // 报告上传
  const singleFileRef = useRef<HTMLInputElement>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const pendingPair = useRef<any>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

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
    setDetailLoading(true);
    setBatRev(undefined); setBatAud(undefined);
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
  const badReason = (p: any) => !p.result ? "无结果" : `QC异常：${p.qc_flag_display || p.qc_flag}`;

  // 文件名解析 PT 编号（不区分大小写）：HK_report_TC_PT71739-Y.pdf → "71739"
  const parsePtFromName = (name: string) => {
    const m = String(name || "").match(/PT\s*0*(\d+)/i);
    return m ? String(parseInt(m[1], 10)) : "";
  };
  const normPt = (v: any) => {
    const m = String(v || "").match(/(\d+)/);
    return m ? String(parseInt(m[1], 10)) : "";
  };
  const lastHist = (r: any) => (Array.isArray(r?.report_history) && r.report_history.length)
    ? r.report_history[r.report_history.length - 1] : null;
  const STATE_LABEL: Record<string, string> = { no_pt: "无PT编号", unmatched: "未匹配", unqualified: "未达标", dup: "重复", bad_type: "非PDF" };
  const histLine = (h: any) => h
    ? `${h.action === "keep" ? "保留" : h.action === "replace" ? "替换" : "上传"} · ${h.filename}${h.prev_filename ? `（原 ${h.prev_filename}）` : ""} · ${h.by || "-"} · ${fmtDT(h.at)}`
    : "";

  const doUpload = async (pair: any, file: File, mode: "overwrite" | "keep") => {
    const fd = new FormData();
    fd.append("pair_id", pair.id);
    fd.append("mode", mode);
    fd.append("file", file);
    try {
      const r = await api.post(`/cases/bioinfo/${selectedBatch.id}/upload-report/`, fd, { timeout: 180000 });
      return { ok: true, msg: r.data?.message || "已上传" };
    } catch (e: any) {
      return { ok: false, msg: e?.response?.data?.error || "上传失败" };
    }
  };

  const pickSingle = (pair: any) => {
    pendingPair.current = pair;
    if (singleFileRef.current) { singleFileRef.current.value = ""; singleFileRef.current.click(); }
  };

  const onSingleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const pair = pendingPair.current;
    pendingPair.current = null;
    if (!f || !pair) return;
    if (!/\.pdf$/i.test(f.name)) { message.warning("只支持 PDF 文件"); return; }
    const h = lastHist(pair);
    if (pair.report_file_url) {
      Modal.confirm({
        title: "该配对已有报告",
        okText: "覆盖", cancelText: "保留现有",
        content: (
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>现有报告：<Text code>{h?.filename || "（历史报告）"}</Text></div>
            <div>本次文件：<Text code>{f.name}</Text></div>
            <div style={{ color: "#8c8c8c" }}>覆盖＝替换为新文件；保留现有＝不替换，只记录本次上传。</div>
          </div>
        ),
        onOk: async () => { const r = await doUpload(pair, f, "overwrite"); r.ok ? message.success(r.msg) : message.error(r.msg); refreshDetail(); },
        onCancel: async () => { const r = await doUpload(pair, f, "keep"); r.ok ? message.success(r.msg) : message.error(r.msg); refreshDetail(); },
      });
    } else {
      const r = await doUpload(pair, f, "overwrite");
      r.ok ? message.success(r.msg) : message.error(r.msg);
      refreshDetail();
    }
  };

  // ── 批量上传：按文件名 PT 匹配本批次配对 ──
  const onBulkFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (!files.length) return;
    const pairs = selectedBatch?.pairs || [];
    const seen: Record<string, number> = {};
    const rows = files.map((f: File) => {
      const pt = parsePtFromName(f.name);
      const cand = pt ? pairs.find((p: any) => normPt(p.pt_number) === pt) : null;
      let state = "ok", reason = "";
      if (!pt) { state = "no_pt"; reason = "文件名里没有 PT 编号"; }
      else if (!cand) { state = "unmatched"; reason = `本批次没有 PT${pt} 的配对（库内编号可能不同）`; }
      else if ((seen[pt] || 0) > 0) { state = "dup"; reason = "与另一个文件解析到同一个 PT"; }
      else if (notQualified(cand)) { state = "unqualified"; reason = `该配对未达标（${badReason(cand)}）`; }
      else if (!/\.pdf$/i.test(f.name)) { state = "bad_type"; reason = "只支持 PDF 文件"; }
      if (pt) seen[pt] = (seen[pt] || 0) + 1;
      return { key: `${f.name}-${Math.random()}`, file: f, pt, pair: cand, state, reason,
               mode: cand?.report_file_url ? "overwrite" : "overwrite" };
    });
    setBulkRows(rows);
    setBulkOpen(true);
  };

  const doBulk = async () => {
    const oks = bulkRows.filter((r) => r.state === "ok");
    if (!oks.length) { message.warning("没有可上传的文件（见下方状态）"); return; }
    setBulkBusy(true);
    let n = 0, kept = 0, fail = 0;
    for (const r of oks) {
      const res = await doUpload(r.pair, r.file, r.mode || "overwrite");
      if (res.ok) { n++; if ((r.mode || "overwrite") === "keep") kept++; } else { fail++; message.error(`${r.file.name}：${res.msg}`); }
    }
    setBulkBusy(false); setBulkOpen(false);
    const skip = bulkRows.length - oks.length;
    message.success(`批量上传：成功 ${n} 个${kept ? `（保留原报告 ${kept}）` : ""}${fail ? `，失败 ${fail}` : ""}${skip ? `，跳过 ${skip}` : ""}`);
    setBulkRows([]);
    refreshDetail();
  };

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

  // 报告批次状态：待上传 → 待复核 → 已完成
  const reportTag = (v: string) => {
    const mp: Record<string, { color: string; text: string }> = {
      PENDING: { color: "orange", text: "待上传" },
      TO_REVIEW: { color: "blue", text: "待复核" },
      COMPLETED: { color: "green", text: "已完成" },
    };
    const x = mp[v] || { color: "default", text: v || "—" };
    return <Tag color={x.color} style={{ margin: 0 }}>{x.text}</Tag>;
  };

  const batchColumns = [
    { title: "批次号", dataIndex: "batch_number", key: "bn", width: 150,
      render: (v: string, r: any) => (
        <div style={{ lineHeight: 1.35 }}>
          <Text code style={{ fontSize: 12 }}>{v}</Text>
          <div style={{ fontSize: 11, color: "#888" }}>
            配对 {r.pair_count ?? 0} · 可出报告 {r.reportable_pair_count ?? 0}
          </div>
        </div>
      ) },
    { title: "状态", dataIndex: "report_status", key: "rs", width: 76, render: (v: string) => reportTag(v) },
    { title: "进度", key: "rp", width: 62, align: "center" as const,
      render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.report_uploaded_count ?? 0}/{r.reportable_pair_count ?? 0}</Text> },
    { title: "完成时间", dataIndex: "updated_at", key: "ut", width: 92, render: fmtDT },
  ];

  // ── 完成批次准入 ──
  const rp = selectedBatch ? (selectedBatch.pairs || []) : [];
  const reportable = rp.filter((p: any) => !notQualified(p));
  const reportMissing = reportable.filter((p: any) => !p.report_file_url);
  const revVal = batRev ?? (selectedBatch?.report_reviewer || undefined);
  const audVal = batAud ?? (selectedBatch?.report_auditor || undefined);
  const uname = (id?: string) => users.find((u: UserItem) => u.id === id)?.username || "—";
  const doneReport = selectedBatch?.report_status === "COMPLETED";
  const canComplete = !!selectedBatch && !doneReport && reportMissing.length === 0 && !!revVal && !!audVal;
  const completeHint = !selectedBatch || doneReport ? ""
    : reportMissing.length > 0
      ? `还有 ${reportMissing.length} 个可出报告的配对未上传：${reportMissing.map((p: any) => p.pt_number || p.case_number).join("、")}`
      : !revVal ? "请选择复核人" : !audVal ? "请选择审核人" : "可完成";

  const doComplete = () => {
    if (!selectedBatch) return;
    Modal.confirm({
      title: "确认完成报告批次",
      content: (
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div>批次：<Text code>{selectedBatch.batch_number}</Text></div>
          <div>可出报告配对：<b>{reportable.length}</b>（已全部上传） · 未达标配对：<b>{rp.length - reportable.length}</b>（不参与，保持「有失败」）</div>
          <div>复核人：<b>{uname(revVal)}</b> · 审核人：<b>{uname(audVal)}</b></div>
          <div style={{ color: "#8c8c8c" }}>完成后：这些配对对应的 case 在案例管理里变为「已完成」；未达标的 case 保持「有失败」。</div>
        </div>
      ),
      onOk: async () => {
        try {
          const res = await api.post(`/cases/bioinfo/${selectedBatch.id}/complete-report/`,
            { reviewer_id: revVal, auditor_id: audVal });
          message.success(res.data?.message || "报告批次已完成");
          await refreshDetail();
          loadBatches();
        } catch (e: any) { message.error(e?.response?.data?.error || "完成失败"); }
      },
    });
  };

  const pairColumns = [
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 150, ellipsis: true, fixed: "left" as const },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 90 },
    { title: "来源", dataIndex: "case_source", key: "src", width: 66, render: (v: string) => v || "—" },
    { title: "报告版本", dataIndex: "report_version", key: "rvs", width: 84, render: (v: string) => v || "—" },
    { title: "Mother", dataIndex: "mother_name", key: "mn", width: 110, ellipsis: true },
    { title: "Father", dataIndex: "father_name", key: "fn", width: 120, ellipsis: true },
    { title: "标签", dataIndex: "father_label", key: "lb", width: 52, render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag> },
    { title: "M.Layers", dataIndex: "mother_layers", key: "ml", width: 76, render: (v: any) => v != null ? Math.round(v) : "—" },
    { title: "M.Het", dataIndex: "mother_het_ratio", key: "mh", width: 68, render: (v: any) => v ?? "—" },
    { title: "M.Y", dataIndex: "mother_y_ratio", key: "my", width: 64, render: (v: any) => v ?? "—" },
    { title: "M.Conc", dataIndex: "mother_concentration", key: "mc", width: 72, render: (v: any) => v ?? "—" },
    { title: "F.Layers", dataIndex: "father_layers", key: "fl", width: 76, render: (v: any) => v != null ? Math.round(v) : "—" },
    { title: "F.Het", dataIndex: "father_het_ratio", key: "fh", width: 68, render: (v: any) => v ?? "—" },
    { title: "F.Y", dataIndex: "father_y_ratio", key: "fy", width: 64, render: (v: any) => v ?? "—" },
    { title: "F.Conc", dataIndex: "father_concentration", key: "fc", width: 72, render: (v: any) => v ?? "—" },
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
    // ── 报告状态：未达标 → 不会出报告 ──
    { title: "报告状态", key: "rst", width: 132,
      render: (_: any, r: any) => {
        if (notQualified(r)) {
          return (
            <Tooltip title={`${badReason(r)} —— 该配对不会生成报告，也不允许上传`}>
              <Tag color="red" style={{ margin: 0 }}>⛔ 未达标</Tag>
            </Tooltip>
          );
        }
        if (!r.report_file_url) return <Tag color="orange" style={{ margin: 0 }}>⏳ 待上传</Tag>;
        const h = lastHist(r);
        return <Tooltip title={histLine(h)}><Tag color="green" style={{ margin: 0 }}>✅ 已上传</Tag></Tooltip>;
      } },
    // ── 报告文件 + 上传 ──
    { title: "报告", key: "rf", width: 150,
      render: (_: any, r: any) => {
        if (notQualified(r)) return <Text type="secondary" style={{ fontSize: 11 }}>不可出报告</Text>;
        const hist = Array.isArray(r.report_history) ? r.report_history.slice().reverse() : [];
        return (
          <Space size={4}>
            {r.report_file_url && (<>
              <Tooltip title="下载"><a href={r.report_file_url} download><Button size="small" icon={<DownloadOutlined />} /></a></Tooltip>
              <Tooltip title="预览"><a href={r.report_file_url} target="_blank" rel="noreferrer"><Button size="small" icon={<EyeOutlined />} /></a></Tooltip>
            </>)}
            <Tooltip title={r.report_file_url ? "重新上传（可选覆盖/保留）" : "上传报告"}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => pickSingle(r)} />
            </Tooltip>
            {hist.length > 0 && (
              <Popover trigger="click" title="报告更新记录" content={
                <div style={{ maxWidth: 420, fontSize: 12, lineHeight: 1.9 }}>
                  {hist.map((h: any, i: number) => <div key={i}>{histLine(h)}</div>)}
                </div>
              }>
                <Button size="small" icon={<HistoryOutlined />} />
              </Popover>
            )}
          </Space>
        );
      } },
    { title: "复核人", key: "rv", width: 145,
      render: (_: any, r: any) => notQualified(r) ? (
        <Select size="small" style={{ width: 125 }} disabled placeholder="未达标·无需复核" />
      ) : (
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
      render: (_: any, r: any) => notQualified(r) ? (
        <Select size="small" style={{ width: 125 }} disabled placeholder="未达标·无需审核" />
      ) : (
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
      render: (_: any, r: any) => {
        const bad = notQualified(r);
        return (
          <Space size={4}>
            <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} disabled={bad}
              onClick={() => doSetReview(r, "review")}>复核</Button>
            <Button size="small" icon={<CheckCircleOutlined />} disabled={bad}
              onClick={() => doSetReview(r, "audit")}>审核</Button>
          </Space>
        );
      } },
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

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* 左：批次一列 */}
        <Card size="small" title={`报告批次（${batches.length}）`} style={{ width: 400, flexShrink: 0 }}
          bodyStyle={{ padding: 0, maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
          <Table
            size="small"
            rowKey="id"
            columns={batchColumns}
            dataSource={batches}
            pagination={false}
            locale={{ emptyText: "暂无已完成的生信批次" }}
            onRow={(r: any) => ({
              onClick: () => openBatch(r),
              style: { cursor: "pointer", background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined },
            })}
          />
        </Card>

        {/* 右：批次详情 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card size="small"
            title={<Space><FileTextOutlined /> 报告批次 <Text code>{selectedBatch?.batch_number || ""}</Text>
              {selectedBatch ? reportTag(selectedBatch.report_status) : null}</Space>}>
            {!selectedBatch
              ? <Empty description="请选择左侧批次" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              : detailLoading
                ? <div style={{ textAlign: "center", padding: 60 }}><Spin /></div>
                : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Space>
                <Text>配对: <b>{rp.length}</b></Text>
                <Text>可出报告: <b>{reportable.length}</b></Text>
                <Text>已上传报告: <b>{reportable.length - reportMissing.length}</b>/{reportable.length}</Text>
                {rp.length > reportable.length && (
                  <Text type="warning">未达标（不出报告）: <b>{rp.length - reportable.length}</b></Text>
                )}
              </Space>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={refreshDetail}>刷新</Button>
                <Button type="primary" icon={<UploadOutlined />}
                  onClick={() => { if (bulkFileRef.current) { bulkFileRef.current.value = ""; bulkFileRef.current.click(); } }}>批量上传报告</Button>
              </Space>
            </div>
            <Table
              size="small"
              rowKey="id"
              columns={pairColumns}
              dataSource={selectedBatch.pairs || []}
              pagination={false}
              scroll={{ x: 2280 }}
              onRow={(r: any) => ({
                style: notQualified(r) ? { background: "#fff2f0" } : {},
              })}
            />
            <input ref={singleFileRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={onSingleFile} />
            <input ref={bulkFileRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }} onChange={onBulkFiles} />

            <Modal
              title={<Space><UploadOutlined /> 批量上传报告 — <Text code>{selectedBatch.batch_number}</Text></Space>}
              open={bulkOpen}
              width={1000}
              onCancel={() => setBulkOpen(false)}
              onOk={doBulk}
              okText={`上传可匹配的 ${bulkRows.filter((r) => r.state === "ok").length} 个`}
              okButtonProps={{ disabled: bulkBusy || bulkRows.filter((r) => r.state === "ok").length === 0, loading: bulkBusy }}
              cancelText="取消"
            >
              {(() => {
                const badPairs = (selectedBatch?.pairs || []).filter((p: any) => notQualified(p));
                return badPairs.length > 0 ? (
                  <Alert type="warning" showIcon style={{ marginBottom: 10 }}
                    message={<span style={{ fontSize: 12 }}>本批次有 <b>{badPairs.length}</b> 个配对未达标（无结果/QC异常），不会出报告、也不会接受上传：{badPairs.map((p: any) => p.pt_number || p.case_number).join("、")}</span>} />
                ) : null;
              })()}
              <Table
                size="small" rowKey="key" pagination={false} dataSource={bulkRows}
                columns={[
                  { title: "文件名", dataIndex: "file", key: "fn", ellipsis: true,
                    render: (f: File) => <Text style={{ fontSize: 12 }}>{f.name}</Text> },
                  { title: "解析 PT", dataIndex: "pt", key: "pt", width: 90,
                    render: (v: string) => v ? <Text code>PT{v}</Text> : <Text type="secondary">—</Text> },
                  { title: "匹配到", key: "mt", width: 210,
                    render: (_: any, r: any) => r.pair
                      ? <span style={{ fontSize: 12 }}>{r.pair.case_number} <Text type="secondary">（{r.pair.pt_number}）</Text></span>
                      : <Text type="secondary" style={{ fontSize: 12 }}>—</Text> },
                  { title: "该配对现状", key: "st2", width: 130,
                    render: (_: any, r: any) => r.pair
                      ? (r.pair.report_file_url ? <Tag color="blue">已有报告</Tag> : <Tag color="orange">首次上传</Tag>)
                      : "—" },
                  { title: "有报告时", key: "md", width: 150,
                    render: (_: any, r: any) => (r.state === "ok" && r.pair?.report_file_url) ? (
                      <Select size="small" style={{ width: 120 }} value={r.mode}
                        onChange={(v) => setBulkRows((prev) => prev.map((x: any) => x.key === r.key ? { ...x, mode: v } : x))}
                        options={[{ value: "overwrite", label: "覆盖" }, { value: "keep", label: "保留现有" }]} />
                    ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                  { title: "是否上传", key: "ok", width: 190,
                    render: (_: any, r: any) => r.state === "ok"
                      ? <Tag color="green">将上传</Tag>
                      : <Tooltip title={r.reason}><Tag color="red">不上传：{STATE_LABEL[r.state] || "跳过"}</Tag></Tooltip> },
                ]}
                expandable={{ expandedRowRender: (r: any) => r.reason ? <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text> : null,
                  rowExpandable: (r: any) => !!r.reason }}
              />
            </Modal>

            {/* 底部：批次级复核/审核 + 完成批次（不需要每份报告都填） */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f0f0",
              display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <Space>
                <Text>复核人：</Text>
                <Select size="small" style={{ width: 150 }} placeholder="选择复核人" showSearch optionFilterProp="label"
                  value={batRev ?? (selectedBatch.report_reviewer || undefined)}
                  onChange={(v: string) => setBatRev(v)}
                  options={users.map((u: UserItem) => ({ label: u.username, value: u.id }))} />
                {selectedBatch.report_reviewed_at && <Text type="success" style={{ fontSize: 11 }}>✓ {fmtDT(selectedBatch.report_reviewed_at)}</Text>}
              </Space>
              <Space>
                <Text>审核人：</Text>
                <Select size="small" style={{ width: 150 }} placeholder="选择审核人" showSearch optionFilterProp="label"
                  value={batAud ?? (selectedBatch.report_auditor || undefined)}
                  onChange={(v: string) => setBatAud(v)}
                  options={users.map((u: UserItem) => ({ label: u.username, value: u.id }))} />
                {selectedBatch.report_audited_at && <Text type="success" style={{ fontSize: 11 }}>✓ {fmtDT(selectedBatch.report_audited_at)}</Text>}
              </Space>
              <Button type="primary" icon={<CheckCircleOutlined />} disabled={!canComplete} onClick={doComplete}>完成批次</Button>
              {doneReport
                ? <Text type="success" style={{ fontSize: 12 }}>该批次报告已完成（复核 {selectedBatch.report_reviewer_name || "—"} / 审核 {selectedBatch.report_auditor_name || "—"}）</Text>
                : <Text type="secondary" style={{ fontSize: 11 }}>{completeHint}</Text>}
            </div>
          </>
                )}
          </Card>
        </div>
      </div>
    </div>
  );
}
