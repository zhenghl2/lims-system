// NipptBioinformatics.tsx — NIPPT Bioinformatics (Pair-based CPI Analysis + QC + Metrics)
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, InputNumber,
  Space, Popconfirm, Select, Alert, Input, Upload, Tooltip } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, DeleteOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, SwapOutlined, LinkOutlined,
  DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import api from "../api/client";
import { REJECTION_REASONS } from "../api/types";
const { Text, Title } = Typography;

// ── 案例备注（只读，与案例管理「备注」列渲染逻辑完全一致）──
/** 时间显示统一北京时间（2026-10-16 修正）：接口返回 UTC(ISO, 带 Z)，
 *  原实现直接切字符串 → 显示的是 UTC，比北京时间少 8 小时。
 *  现按浏览器本地时区换算，输出格式保持 MM-DD HH:mm 不变。 */
const fmtDT = (v: string | null | undefined) => {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d.getTime())) return `${v.slice(5, 10)} ${v.slice(11, 16)}`;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 「最后保存」：接口返回 UTC(ISO, 带 Z) → 按浏览器本地时区换算成北京时间，到分（2026-10-16） */
const fmtSavedAt = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v.slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const rejectionLabel = (reason: string) =>
  reason === "REJECTED" ? "拒收" : (REJECTION_REASONS[reason || ""] || reason || "");

const renderCaseNoteTags = (r: { case_notes?: string; case_note_samples?: any[] }) => {
  const evts: { label: string; color: string; tip: string }[] = [];
  if (r.case_notes) {
    evts.push({ label: "登记备注", color: "purple", tip: r.case_notes });
  }
  for (const cs of r.case_note_samples || []) {
    const who = cs.patient_name ? `${cs.patient_name} · ` : "";
    if (cs.sample_status === "REJECTED") {
      const reason = rejectionLabel(cs.rejection_reason);
      const note = cs.rejection_note ? `: ${cs.rejection_note}` : "";
      evts.push({ label: "拒收", color: "red", tip: `${reason}${note} · ${who}${fmtDT(cs.received_at)}` });
    }
    if (cs.resample_of) {
      evts.push({ label: `重采R${cs.resample_number || ""}`, color: "orange", tip: `重采样本 · ${who}${fmtDT(cs.created_at)}` });
    }
    if (cs.redo_count) {
      evts.push({ label: `重做T${cs.redo_count}`, color: "cyan", tip: `重做样本 · ${who}${fmtDT(cs.created_at)}` });
    }
    if (cs.collection_notes) {
      evts.push({ label: "备注", color: "gold", tip: cs.collection_notes });
    }
    if (cs.receipt_note) {
      evts.push({ label: "签收备注", color: "volcano", tip: cs.receipt_note });
    }
  }
  if (!evts.length) return <Text type="secondary">-</Text>;
  return (
    <Space size={2} wrap>
      {evts.map((e, i) => (
        <Tooltip key={i} title={e.tip}>
          <Tag color={e.color} style={{ fontSize: 11, margin: 0 }}>{e.label}</Tag>
        </Tooltip>
      ))}
    </Space>
  );
};

interface BatchItem {
  id: string; batch_number: string; status: string; status_display: string;
  pair_count: number; completed_pair_count: number; sample_count: number; created_at: string;
  updated_at?: string;
  /** 来源杂交及测序批次的 Chip 号（新建生信批次时选的那个批次） */
  hybseq_chip?: string;
}
interface PairItem {
  id: string; case_number: string; pt_number: string;
  mother_name: string; mother_index: string;
  father_name: string; father_index: string; father_sample_type: string;
  father_label: string; is_cross_batch: boolean;
  mother_source_batch: string; father_source_batch: string;
  cpi: number | null; result: string; note: string;
  qc_flag: string; qc_flag_display: string;
  mother_layers: number | null; mother_concentration: number | null;
  mother_het_ratio: number | null; mother_y_ratio: number | null;
  father_layers: number | null; father_concentration: number | null;
  father_het_ratio: number | null; father_y_ratio: number | null;
  case_notes?: string; case_note_samples?: any[];
}
interface SampleItem {
  id: string; patient_name: string; test_sample_id: string | null;
  index: string; sample_type: string; role: string;
  case_number: string; pt_number: string;
  case_notes?: string; case_note_samples?: any[];
  qc_flag?: string; qc_note?: string;
}

const QC_FLAG_OPTIONS = [
  { label: "", value: "" },
  { label: "男性层数低", value: "MALE_LOW_LAYERS" },
  { label: "女性层数低", value: "FEMALE_LOW_LAYERS" },
  { label: "男性污染", value: "MALE_CONTAM" },
  { label: "女性污染", value: "FEMALE_CONTAM" },
  { label: "胎儿浓度低", value: "FETAL_LOW_CONC" },
  { label: "其他异常", value: "OTHER" },
];

export default function NipptBioinformatics() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingInfo, setPendingInfo] = useState<any>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedHsBatch, setSelectedHsBatch] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [editingPairs, setEditingPairs] = useState<Record<string, any>>({});
  const [editingSamples, setEditingSamples] = useState<Record<string, any>>({});
  const [manualPairMother, setManualPairMother] = useState<Record<string, string>>({});
  const [manualPairFather, setManualPairFather] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<any>(null);
  // 未配对样本的 QC 标记/备注（独立于指标编辑：批次完成后仍可改，2026-10-16）
  const [sampQc, setSampQc] = useState<Record<string, any>>({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [appendixModalOpen, setAppendixModalOpen] = useState(false);
  const [appendixErrors, setAppendixErrors] = useState<any[]>([]);
  const appendixFileRef = useRef<HTMLInputElement>(null);
const PERSONS = ["郑海灵","祝兴强","吴书凌","叶丽婷","何家宇","胡煜敏","付慧珠","杜兴琼","龙雨青","张斯栋","郭爽洁","林琦","林洋鸿","杨思婷","李彩娟"];
// 生信模块默认操作人/审核人（后端建批次时也会写入，这里兜底显示空批次）
const DEFAULT_OPERATOR = "郑海灵";
const DEFAULT_REVIEWER = "祝兴强";
const [operators, setOperators] = useState<Record<string,string>>({});
const [reviewers, setReviewers] = useState<Record<string,string>>({});

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get("/cases/bioinfo/"); setBatches(res.data?.results || []); } catch (_e) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchDetail = async (id: string) => {
    setBatchLoading(true);
    try {
      const res = await api.get(`/cases/bioinfo/${id}/`);
      setSelectedBatch(res.data); setEditingPairs({}); setEditingSamples({});
      setManualPairMother({}); setManualPairFather({});
    } catch (_e) { message.error("Failed to load detail"); }
    setBatchLoading(false);
  };

  const openCreate = async () => {
    setCreateModalOpen(true); setPendingLoading(true);
    try { const res = await api.get("/cases/bioinfo/pending_info/"); setPendingInfo(res.data); if (res.data.available) setSelectedHsBatch(res.data.primary_batch.id); } catch (_e) { message.error("Failed"); }
    setPendingLoading(false);
  };

  const handleCreate = async () => {
    try {
      const payload: any = {}; if (selectedHsBatch) payload.hybseq_batch_id = selectedHsBatch;
      await api.post("/cases/bioinfo/", payload); message.success("Batch created"); setCreateModalOpen(false); fetchBatches();
    } catch (e: any) { message.error(e.response?.data?.hybseq_batch_id || "Create failed"); }
  };

  /** 未配对样本列显示值：优先本地编辑值，否则回退服务器值。
   *  修复：此前只读 editingSamples[...]，导入进来的指标在页面显示为空。 */
  const sampleField = (s: any, field: string) =>
    editingSamples[s.id]?.[field] !== undefined ? editingSamples[s.id][field] : s[field];

  const handleSampleEdit = (sampleId: string, field: string, value: any) => {
    setEditingSamples(prev => ({ ...prev, [sampleId]: { ...(prev[sampleId] || {}), [field]: value } }));
  };

  /** 未配对样本 QC/备注：优先本地乐观值，否则服务器值 */
  const sampQcVal = (sid: string, field: string, serverVal: any) => {
    const local = sampQc[sid]?.[field];
    return local !== undefined ? local : (serverVal ?? "");
  };

  /** 未配对样本 QC/备注：直接存服务器（批次 COMPLETED 后也可改；已配对样本后端会拒绝） */
  const handleSampleQcSave = async (sampleId: string, field: string, value: any) => {
    if (!selectedBatch) return;
    setSampQc(prev => ({ ...prev, [sampleId]: { ...(prev[sampleId] || {}), [field]: value } }));
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/set-sample-qc/`, { sample_id: sampleId, [field]: value });
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
      setSampQc(prev => {
        const n = { ...prev };
        if (n[sampleId]) { delete n[sampleId][field]; if (!Object.keys(n[sampleId]).length) delete n[sampleId]; }
        return n;
      });
      fetchDetail(selectedBatch.id);
    }
  };

  const handlePairEdit = (pairId: string, field: string, value: any) => {
    setEditingPairs(prev => ({ ...prev, [pairId]: { ...(prev[pairId] || {}), [field]: value } }));
  };

  const handleSave = async () => {
    if (!selectedBatch) return;
    const pairIds = Object.keys(editingPairs);
    if (pairIds.length === 0) { message.info("No changes"); return; }
    setSaving(true);
    try {
      const pairs = pairIds.map(id => ({ id, ...editingPairs[id] }));
      const sampleIds = Object.keys(editingSamples);
      const samples = sampleIds.map(id => ({ id, ...editingSamples[id] }));
      await api.post(`/cases/bioinfo/${selectedBatch.id}/save_processing/`, { pairs, samples });
      message.success("Saved"); setEditingPairs({}); fetchDetail(selectedBatch.id);
    } catch (e: any) { message.error(e.response?.data?.error || "Save failed"); }
    setSaving(false);
  };

  const handleComplete = async () => {
    if (!selectedBatch) return;
    try {
      const res = await api.post(`/cases/bioinfo/${selectedBatch.id}/complete/`);
      const d = res.data || {};
      message.success(d.message || `Completed ${(selectedBatch.pairs || []).length} pairs`);
      if (d.bad_pairs?.length) {
        // 未进报告的已按 QC 判侧退回：一侧需重做/重采，另一侧在生信等待对方结果
        const pts = d.bad_pairs.slice(0, 6).map((x: any) => x.pt_number).filter(Boolean).join("、");
        message.warning(`${d.bad_pairs.length} 个 pair 未进报告（需重做/重采）：${pts}${d.bad_pairs.length > 6 ? " 等" : ""}`, 6);
      }
      setSelectedBatch(null); fetchBatches();
    } catch (e: any) { message.error(e.response?.data?.error || "Complete failed"); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/cases/bioinfo/${id}/`); message.success("Deleted"); if (selectedBatch?.id === id) setSelectedBatch(null); fetchBatches(); }
    catch (e: any) { message.error(e.response?.data?.detail || "Delete failed"); }
  };

  const handleManualPair = async (motherId: string | null, fatherId: string | null) => {
    if (!selectedBatch || (!motherId && !fatherId)) return;
    const mid = motherId || manualPairMother[fatherId || ""];
    const fid = fatherId || manualPairFather[motherId || ""];
    if (!mid || !fid) { message.warning("Select both"); return; }
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/add_manual_pair/`, { mother_sample_id: mid, father_sample_id: fid });
      message.success("Pair added");
      if (motherId) { const m = { ...manualPairFather }; delete m[motherId]; setManualPairFather(m); }
      else { const m = { ...manualPairMother }; delete m[fatherId || ""]; setManualPairMother(m); }
      fetchDetail(selectedBatch.id);
    } catch (e: any) { message.error(e.response?.data?.error || "Failed"); }
  };

  /** 附表(.last)上传：按 PT 号匹配本批次配对（与 CSV/xlsx 导入同一入口，按扩展名自动分流） */
  const uploadAppendices = async (files: File[]) => {
    if (!selectedBatch) return;
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const r = await api.post(`/cases/bioinfo/${selectedBatch.id}/upload-appendices/`, fd, { timeout: 600000 });
      const d = r.data || {};
      if (d.matched && !d.failed) message.success(`附表上传成功：已匹配并保存 ${d.matched} 个`);
      else if (d.matched && d.failed) message.warning(`附表：成功 ${d.matched} 个，未匹配 ${d.failed} 个`);
      else if (!d.matched && d.failed) message.error(`附表：${d.failed} 个全部未匹配上，请核对文件名里的 PT 号`);
      else message.info("没有可处理的文件");
      if (d.failed) { setAppendixErrors(d.errors || []); setAppendixModalOpen(true); }
      await fetchDetail(selectedBatch.id);
    } catch (e: any) {
      message.error("附表上传失败：" + (e?.response?.data?.detail || e?.message || ""));
    }
  };

  const handleImport = async (file: File) => {
    if (/\.last$/i.test(file.name)) {          // ← 附表分流
      await uploadAppendices([file]);
      return;
    }
    if (!selectedBatch) return false;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api.post(`/cases/bioinfo/${selectedBatch.id}/import_cpi/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(res.data); setImportModalOpen(true); fetchDetail(selectedBatch.id);
    } catch (e: any) {
      const d = e.response?.data;
      if (d?.aborted) { setImportResult(d); setImportModalOpen(true); }   // 不一致 → 整批中止，展示清单
      else message.error(d?.error || "Import failed");
    }
    return false; // Prevent default upload
  };

  const downloadTemplate = async () => {
    if (!selectedBatch) return;
    try {
      // 必须走带 JWT 的 api 客户端：接口需鉴权，window.open 直连会 401（下载失败）
      const res = await api.get(`/cases/bioinfo/${selectedBatch.id}/export_template/`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `bioinfo_${selectedBatch.batch_number || "batch"}_template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error("Template 下载失败，请重试");
    }
  };

  // Compact metric input renderer
  // Layers 列一律显示整数（precision=0，四舍五入）；其余指标保留小数
  const metricInput = (pairId: string, field: string, v: any) => (
    <InputNumber size="small" style={{ width: 60 }}
      precision={field.endsWith("layers") ? 0 : undefined}
      value={editingPairs[pairId]?.[field] !== undefined ? editingPairs[pairId][field] : v}
      onChange={(val) => handlePairEdit(pairId, field, val)} />
  );

  const batchColumns = [
    { title: "Batch #", dataIndex: "batch_number", key: "bn", ellipsis: true },
    { title: "批次", dataIndex: "hybseq_chip", key: "hc", width: 62, align: "center" as const,
      render: (v: string) => v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text> },
    { title: "状态", dataIndex: "status", key: "st", width: 86,
      // 2026-10-14：原来是「无表头 + 无文字」的纯色小横杠（绿=已完成 蓝=未完成），
      // 实验员看不出来是什么 → 改为「表头 + 文字」，宽度 55→100px（三个汉字实测 42px + antd 开销）
      render: (_: string, r: BatchItem) => {
        const done = r?.status === "COMPLETED";
        return <Tag color={done ? "green" : "blue"} style={{ margin: 0 }}>
          {r?.status_display || (done ? "已完成" : "处理中")}
        </Tag>;
      } },
    { title: "Pairs", dataIndex: "pair_count", key: "pc", width: 52, align: "center" as const },
    { title: "Unpaired", dataIndex: "unpaired_count", key: "upc", width: 84, align: "center" as const,
      render: (v: number) => (v ? <Text type="warning" strong>{v}</Text> : <Text type="secondary">0</Text>) },
  ];

  const pairColumns = [
    { title: "Case#", dataIndex: "case_number", key: "c", width: 180, ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
        : emptyText },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 85 },
    { title: "附表", key: "apx", width: 90, render: (_: any, r: PairItem) => {
        const anyR = r as any;
        if (anyR.has_appendix) {
          return anyR.appendix_file_url
            ? <Tooltip title="查看 .last"><a href={anyR.appendix_file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>✓ 已传</a></Tooltip>
            : <Text type="success" style={{ fontSize: 12 }}>✓ 已传</Text>;
        }
        return <Text type="danger" style={{ fontSize: 12 }}>缺</Text>;
      } },
    { title: "来源", dataIndex: "case_source", key: "src2", width: 70, render: (v: string) => <Text style={{fontSize:12}}>{v || "—"}</Text> },
    { title: "备注", key: "cnotes", width: 180, render: (_: any, r: PairItem) => renderCaseNoteTags(r) },
    { title: "Mother", key: "m", width: 130,
      render: (_: any, r: PairItem) => <Text>{r.mother_name}{r.mother_index ? <Text type="secondary" style={{fontSize:11}}> ({r.mother_index})</Text> : ""}</Text> },
    { title: "Father", key: "f", width: 145,
      render: (_: any, r: PairItem) => {
        const parts: string[] = [];
        if (r.father_index) parts.push(r.father_index);
        if (r.father_sample_type) parts.push(r.father_sample_type);
        return <Text>{r.father_name}{parts.length ? <Text type="secondary" style={{fontSize:11}}> ({parts.join(", ")})</Text> : ""}</Text>;
      }},
    { title: "", dataIndex: "father_label", key: "lbl", width: 42, render: (v: string) => <Tag style={{margin:0}}>{v}</Tag> },
    { title: "", key: "src", width: 55,
      render: (_: any, r: PairItem) => r.is_cross_batch
        ? <Tooltip title="跨批次配对"><Tag icon={<SwapOutlined />} color="orange" style={{margin:0}} /></Tooltip>
        : <Tooltip title={`来源批次: ${r.mother_source_batch || "—"}`}><Tag icon={<LinkOutlined />} color="green" style={{margin:0}}>{r.mother_source_batch?.slice(-6)}</Tag></Tooltip> },
    // Mother metrics（顺序：Layers → Het → Y → Conc）
    { title: "M.Layers", key: "ml", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "mother_layers", r.mother_layers) },
    { title: "M.Het", key: "mh", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "mother_het_ratio", r.mother_het_ratio) },
    { title: "M.Y", key: "my", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "mother_y_ratio", r.mother_y_ratio) },
    { title: "M.Conc", key: "mc", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "mother_concentration", r.mother_concentration) },
    // Father metrics（顺序同上）
    { title: "F.Layers", key: "fl", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "father_layers", r.father_layers) },
    { title: "F.Het", key: "fh", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "father_het_ratio", r.father_het_ratio) },
    { title: "F.Y", key: "fy", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "father_y_ratio", r.father_y_ratio) },
    { title: "F.Conc", key: "fc", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "father_concentration", r.father_concentration) },
    // CPI（只读）：由 result 自动派生 —— 支持=10000 / 不支持=0.0001 / 临界与空=空
    { title: "CPI", dataIndex: "cpi", key: "cpi", width: 110,
      render: (_: any, r: PairItem) => {
        const rv = editingPairs[r.id]?.result !== undefined ? editingPairs[r.id].result : r.result;
        const derived = rv === "INCLUSION" ? 10000 : rv === "EXCLUSION" ? 0.0001 : null;
        return derived != null
          ? <Text strong>{derived}</Text>
          : <Text type="secondary">—</Text>;
      } },
    { title: "Result", dataIndex: "result", key: "res", width: 135,
      render: (v: string, r: PairItem) => {
        const val = editingPairs[r.id]?.result !== undefined ? editingPairs[r.id].result : (v ?? "");
        // 值可为空串：低浓度样本可能没有结果，此时结果就为空（显式「空」选项，与未选择区分开）
        return <Select size="small" style={{width:125}} value={val}
          onChange={(val) => handlePairEdit(r.id, "result", val ?? "")} placeholder="Select..."
          options={[
            { label: <Text type="success">支持</Text>, value: "INCLUSION" },
            { label: <Text type="danger">不支持</Text>, value: "EXCLUSION" },
            { label: <Text type="warning">临界</Text>, value: "INCONCLUSIVE" },
            { label: <Text type="secondary">无结果</Text>, value: "" },
          ]} />; }},
    { title: "Note", dataIndex: "note", key: "nt", width: 120,
      render: (v: string, r: PairItem) => <Input size="small"
        value={editingPairs[r.id]?.note !== undefined ? editingPairs[r.id].note : v || ""}
        onChange={(e) => handlePairEdit(r.id, "note", e.target.value)} placeholder="Note" /> },
    { title: "QC", dataIndex: "qc_flag", key: "qc", width: 120,
      render: (v: string, r: PairItem) => {
        // 显示值优先本地编辑态，否则回退服务器值（此前只读 v，选完会弹回原值）
        const val = editingPairs[r.id]?.qc_flag !== undefined ? editingPairs[r.id].qc_flag : (v || "");
        return (
          <Select size="small" style={{width:110}} value={val || undefined} allowClear placeholder="Normal"
            onChange={(val) => handlePairEdit(r.id, "qc_flag", val || "")}
            options={QC_FLAG_OPTIONS.map(o => ({ label: o.label || "Normal", value: o.value }))} />
        );
      }},
  ];

  const unpairedMothers: SampleItem[] = selectedBatch?.unpaired_mothers || [];
  const unpairedFathers: SampleItem[] = selectedBatch?.unpaired_fathers || [];
  const maxUnpaired = Math.max(unpairedMothers.length, unpairedFathers.length);
  const unpairedRows: any[] = [];
  for (let i = 0; i < maxUnpaired; i++) unpairedRows.push({ key: `up-${i}`, mother: unpairedMothers[i] || null, father: unpairedFathers[i] || null });
  const hasUnpaired = unpairedRows.length > 0;
  // 2026-10-16：批次完成后仍显示未配对样本，但为只读（已完成批次保持锁定）
  const isCompleted = selectedBatch?.status === "COMPLETED";

  const emptyText = <Text type="secondary" style={{fontSize:12}}>—</Text>;

  const unpairedColumns = [
    { title: "Case#", key: "uc", width: 180, ellipsis: true, render: (_:any,r:any)=>{const s=r.mother||r.father;return s && s.case_number?<Tooltip title={s.case_number}><span style={{ cursor: "default" }}>{s.case_number}</span></Tooltip>:emptyText}},
    { title: "PT#", key: "upt", width: 85, render: (_:any,r:any)=>{const s=r.mother||r.father;return s?<Text>{s.pt_number||"—"}</Text>:emptyText}},
    // 与配对表等宽对齐：配对表有「附表」列(90px)，未配对样本无附表 → 占位（2026-10-16）
    { title: "附表", key: "uapx", width: 90, render: () => emptyText },
    { title: "来源", key: "usrc", width: 70, render: () => emptyText },
    { title: "备注", key: "unotes", width: 180, render: (_: any, r: any) => renderCaseNoteTags(r.mother || r.father || {}) },
    { title: "Mother", key: "um", width: 130,
      render: (_: any, r: any) => r.mother ? <Text>{r.mother.patient_name}<Text type="secondary" style={{fontSize:11}}>{r.mother.index ? ` (${r.mother.index})` : ""}</Text></Text> : emptyText },
    { title: "Father", key: "uf", width: 145,
      render: (_: any, r: any) => r.father ? <Text>{r.father.patient_name}<Text type="secondary" style={{fontSize:11}}>{r.father.index ? ` (${r.father.index}` : ""}{r.father.sample_type ? `, ${r.father.sample_type})` : r.father.index ? ")" : ""}</Text></Text> : emptyText },
    { title: "", key: "ul", width: 42, render: () => emptyText },
    { title: "", key: "us", width: 55, render: () => emptyText },
    { title: "M.Layers", key: "uml", width: 70, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} precision={0} value={sampleField(r.mother, "layers")} onChange={(v) => handleSampleEdit(r.mother.id, "layers", v)} disabled={isCompleted} /> : emptyText },
    { title: "M.Het", key: "umh", width: 65, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={sampleField(r.mother, "het_ratio")} onChange={(v) => handleSampleEdit(r.mother.id, "het_ratio", v)} disabled={isCompleted} /> : emptyText },
    { title: "M.Y", key: "umy", width: 65, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={sampleField(r.mother, "y_ratio")} onChange={(v) => handleSampleEdit(r.mother.id, "y_ratio", v)} disabled={isCompleted} /> : emptyText },
    { title: "M.Conc", key: "umc", width: 70, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={sampleField(r.mother, "concentration")} onChange={(v) => handleSampleEdit(r.mother.id, "concentration", v)} disabled={isCompleted} /> : emptyText },
    { title: "F.Layers", key: "ufl", width: 70, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} precision={0} value={sampleField(r.father, "layers")} onChange={(v) => handleSampleEdit(r.father.id, "layers", v)} disabled={isCompleted} /> : emptyText },
    { title: "F.Het", key: "ufh", width: 65, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={sampleField(r.father, "het_ratio")} onChange={(v) => handleSampleEdit(r.father.id, "het_ratio", v)} disabled={isCompleted} /> : emptyText },
    { title: "F.Y", key: "ufy", width: 65, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={sampleField(r.father, "y_ratio")} onChange={(v) => handleSampleEdit(r.father.id, "y_ratio", v)} disabled={isCompleted} /> : emptyText },
    { title: "F.Conc", key: "ufc", width: 70, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={sampleField(r.father, "concentration")} onChange={(v) => handleSampleEdit(r.father.id, "concentration", v)} disabled={isCompleted} /> : emptyText },
    { title: "CPI", key: "ucpi", width: 110, render: () => emptyText },
    { title: "Result", key: "ures", width: 135, render: () => emptyText },
    { title: "Note", key: "unt", width: 120, render: (_: any, r: any) => {
      const s = r.mother || r.father;
      if (!s) return emptyText;
      return <Input size="small" placeholder="Note"
        value={sampQcVal(s.id, "qc_note", s.qc_note || "")}
        onChange={(e) => setSampQc(prev => ({ ...prev, [s.id]: { ...(prev[s.id] || {}), qc_note: e.target.value } }))}
        onBlur={(e) => handleSampleQcSave(s.id, "qc_note", e.target.value)}
        onPressEnter={(e: any) => handleSampleQcSave(s.id, "qc_note", e.target.value)} />;
    }},
    { title: "QC", key: "uqc", width: 120, render: (_: any, r: any) => {
      const sid = r.mother?.id || r.father?.id;
      if (!sid) return emptyText;
      const srv = r.mother?.qc_flag ?? r.father?.qc_flag ?? "";
      const val = sampQcVal(sid, "qc_flag", srv);
      return <Select size="small" style={{width:110}} value={val || undefined} allowClear placeholder="Normal"
        onChange={(v) => handleSampleQcSave(sid, "qc_flag", v || "")}
        options={QC_FLAG_OPTIONS.map(o => ({ label: o.label || "Normal", value: o.value }))} />;
    }},
    { title: "", key: "ua", width: 260,
      render: (_: any, r: any) => {
        if (isCompleted) return emptyText;   // 已完成批次锁定
        if (r.mother && !r.father) {
          const fatherOpts = unpairedFathers.map((f: SampleItem) => ({ label: `${f.patient_name}${f.index ? ` (${f.index})` : ""}${f.sample_type ? `, ${f.sample_type}` : ""}`, value: f.id }));
          return <Space><Select size="small" style={{width:160}} placeholder="Select Father" value={manualPairFather[r.mother.id] || undefined}
            onChange={(v) => setManualPairFather({ ...manualPairFather, [r.mother.id]: v })} options={fatherOpts} />
            <Button size="small" type="primary" onClick={() => handleManualPair(r.mother.id, null)}>Pair</Button></Space>; }
        if (r.father && !r.mother) {
          const motherOpts = unpairedMothers.map((m: SampleItem) => ({ label: `${m.patient_name}${m.index ? ` (${m.index})` : ""}`, value: m.id }));
          return <Space><Select size="small" style={{width:160}} placeholder="Select Mother" value={manualPairMother[r.father.id] || undefined}
            onChange={(v) => setManualPairMother({ ...manualPairMother, [r.father.id]: v })} options={motherOpts} />
            <Button size="small" type="primary" onClick={() => handleManualPair(null, r.father.id)}>Pair</Button></Space>; }
        return null; }},
  ].filter((c: any) => !(isCompleted && c.key === "ua"));   // 完成后无配对操作 → 去掉 260px 空列，与配对表等宽

  const totalPairs = selectedBatch?.pair_count || 0;

  return (
    <div style={{ display: "flex", gap: 16, padding: 16, height: "calc(100vh - 80px)" }}>
      {/* LEFT: Batch List */}
      <Card size="small"
        style={{ width: sidebarCollapsed ? 48 : 460, flexShrink: 0, transition: "width 0.25s", overflow: "hidden", display: "flex", flexDirection: "column" }}
        title={sidebarCollapsed ? undefined : <Title level={5} style={{margin:0}}>Bioinformatics</Title>}
        extra={<Button type="text" size="small" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}
        bodyStyle={{ padding: sidebarCollapsed ? 4 : 16, flex: 1, overflow: "auto" }}>
        {!sidebarCollapsed && (<>
          <Space style={{ marginBottom: 12 }}><Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>New Batch</Button><Button size="small" icon={<ReloadOutlined />} onClick={fetchBatches} /></Space>
          <Table dataSource={batches} columns={batchColumns} rowKey="id" loading={loading} size="small" pagination={{ pageSize: 20, size: "small" }}
            onRow={(r: BatchItem) => ({ onClick: () => fetchDetail(r.id), style: { background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined, cursor: "pointer" } })} />
        </>)}
      </Card>

      {/* RIGHT: Detail */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedBatch ? (
          <Card size="small"
            title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status === "COMPLETED" ? "green" : "blue"}>{selectedBatch.status_display}</Tag><Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>最后保存：{fmtSavedAt((selectedBatch as any).updated_at)}</Text>
              <Text type="secondary" style={{fontSize:12}}>Pairs: {totalPairs} | CPI: {selectedBatch.pairs?.filter((p:any)=>p.result).length}/{totalPairs}
                {selectedBatch.bioinfo_data?.cross_batch_count > 0 && ` | Cross: ${selectedBatch.bioinfo_data.cross_batch_count}`}</Text></Space>}
            extra={<Space>
              <Tooltip title="来源杂交及测序批次（新建本生信批次时选的那个）">
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                  批次 {(selectedBatch as any).hybseq_chip || "-"}
                </Tag>
              </Tooltip>
              <Button icon={<ReloadOutlined />} size="small" loading={batchLoading} onClick={() => fetchDetail(selectedBatch.id)}>Refresh</Button>
              <Button icon={<DownloadOutlined />} size="small" onClick={downloadTemplate}>Template</Button>
              <Upload accept=".csv,.xlsx,.last" multiple showUploadList={false}
                beforeUpload={(f) => { handleImport(f as File); return false; }}>
                <Button icon={<UploadOutlined />} size="small">Import</Button>
              </Upload>
              <Tooltip title="上传报告附表（.last）。按文件名里的 PT 号 + HA/HB 后缀自动匹配本批次配对；一次可选多个文件。">
                <Button icon={<UploadOutlined />} size="small" type="primary" ghost
                  onClick={() => { if (appendixFileRef.current) { appendixFileRef.current.value = ""; appendixFileRef.current.click(); } }}>
                  上传附表(.last)
                </Button>
              </Tooltip>
              {(() => {
                const list = (selectedBatch.pairs || []) as any[];
                const done = list.filter((p) => p.has_appendix).length;
                return (
                  <Tooltip title="已上传附表的配对 / 全部配对">
                    <Tag color={done === list.length && list.length > 0 ? "green" : done ? "orange" : "red"}
                      style={{ marginInlineEnd: 0 }}>
                      附表 {done}/{list.length}
                    </Tag>
                  </Tooltip>
                );
              })()}
              <input ref={appendixFileRef} type="file" multiple accept=".last" style={{ display: "none" }}
                onChange={(e) => {
                  const fs = Array.from(e.target.files || []);
                  if (fs.length) uploadAppendices(fs);
                }} />
              {selectedBatch.status !== "COMPLETED" && <Popconfirm title="Delete?" onConfirm={() => handleDelete(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
            </Space>}>
            <Table dataSource={selectedBatch.pairs || []} columns={pairColumns} rowKey="id" size="small" pagination={false} loading={batchLoading} scroll={{ x: 1910 }} style={{ marginBottom: hasUnpaired ? 12 : 0 }} />

            {hasUnpaired && (
              <Card size="small" title={<Text type="warning">Unpaired Samples ({unpairedRows.length})</Text>} style={{ marginBottom: 12 }}>
                <Table dataSource={unpairedRows} columns={unpairedColumns} rowKey="key" size="small" pagination={false} scroll={{ x: 1910 }} />
              </Card>)}

            {selectedBatch.status !== "COMPLETED" && (
              <Space style={{ marginTop: 16 }}>
                <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={handleSave}>Save</Button>
                <Button icon={<CheckOutlined />} onClick={handleComplete}>Complete Batch</Button>
              </Space>)}
            {selectedBatch.status === "COMPLETED" && <Alert type="success" message="Batch completed" showIcon style={{ marginTop: 16 }} />}
            <div style={{ marginTop: 12, padding: 8, background: "#fafafa", borderRadius: 4, fontSize: 12 }}>
              <Text type="secondary">操作人: </Text>
              <Select size="small" placeholder="选择" style={{ width: 100 }}
                value={operators[selectedBatch.id] || (selectedBatch as any).operator_name || DEFAULT_OPERATOR}
                onChange={v => setOperators(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
                {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
              </Select>
              <Text type="secondary" style={{ marginLeft: 16 }}>审核人: </Text>
              <Select size="small" placeholder="选择" style={{ width: 100 }}
                value={reviewers[selectedBatch.id] || (selectedBatch as any).reviewer || DEFAULT_REVIEWER}
                onChange={v => setReviewers(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
                {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
              </Select>

              <Button size="small" type="primary" style={{ marginLeft: 16 }}
                onClick={async () => {
                  // 提交"显示值"（含默认），避免空状态把已存的默认人写成空串
                  const data = {
                    operator_name: operators[selectedBatch.id] || (selectedBatch as any).operator_name || DEFAULT_OPERATOR,
                    reviewer: reviewers[selectedBatch.id] || (selectedBatch as any).reviewer || DEFAULT_REVIEWER,
                  };
                  const url = "/api/v1/cases/bioinfo/" + selectedBatch.id + "/";
                  const r = await fetch(url, { method: "PATCH",
                    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + localStorage.getItem("access_token") },
                    body: JSON.stringify(data)
                  });
                  if (r.ok) { message.success("已保存"); fetchDetail(selectedBatch.id); }
                  else message.error("保存失败");
                }}>保存</Button>
            </div>
          </Card>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}><Title level={5} type="secondary">Select a batch</Title><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Batch</Button></div>)}
      </div>

      {/* Create Modal */}
      <Modal title="New Bioinformatics Batch" open={createModalOpen} onOk={handleCreate} onCancel={() => setCreateModalOpen(false)} okText="Create" confirmLoading={pendingLoading}>
        {pendingLoading ? <Text type="secondary">Loading...</Text> : pendingInfo?.available ? (<>
          <Text strong>Primary HybSeq Batch: </Text><Tag color="blue">{pendingInfo.primary_batch.batch_number}</Tag><Text type="secondary"> ({pendingInfo.primary_batch.sample_count} samples)</Text><br /><br />
          <Text>In-batch: {pendingInfo.pairing_summary.batch_internal_pairs} pairs ({pendingInfo.pairing_summary.batch_internal_cases} cases)</Text><br /><br />
          <Text strong>Or select another:</Text>
          <Select style={{ width: "100%", marginTop: 8 }} value={selectedHsBatch} onChange={setSelectedHsBatch} options={(pendingInfo.all_hybseq_batches || []).map((b: any) => ({ label: b.batch_number, value: b.id }))} /></>) : <Alert type="warning" message="No completed HybSeq batches." />}
      </Modal>

      {/* 附表未匹配清单 */}
      <Modal title="附表未匹配清单" open={appendixModalOpen} width={760}
        onOk={() => setAppendixModalOpen(false)} onCancel={() => setAppendixModalOpen(false)}
        footer={<Button type="primary" onClick={() => setAppendixModalOpen(false)}>知道了</Button>}>
        <Alert type="warning" showIcon style={{ marginBottom: 10 }}
          message={<span style={{ fontSize: 12 }}>文件名里的 PT 号必须能在<b>本批次</b>找到对应配对。请检查：文件名是否含 PT 号、HA/HB 后缀是否与配对一致。</span>} />
        <Table size="small" pagination={false} rowKey="file" dataSource={appendixErrors}
          columns={[
            { title: "文件名", dataIndex: "file", ellipsis: true },
            { title: "原因", dataIndex: "reason", width: 300 },
          ]} />
      </Modal>

      {/* Import Result Modal */}
      <Modal title="Import Result" open={importModalOpen} onOk={() => setImportModalOpen(false)} onCancel={() => setImportModalOpen(false)} footer={<Button type="primary" onClick={() => setImportModalOpen(false)}>OK</Button>}>
        {importResult && (<>
          {importResult.aborted ? (
            <Alert type="error" showIcon message={importResult.error || "导入已中止"}
              description={<span>共 <b>{importResult.mismatch_count}</b> 行 auto_result 与 result 不一致，<b>未写入任何数据</b>。请核对后再上传。</span>} />
          ) : (
            <>
              <Text>
                {importResult.mode === "pipeline" ? "管线格式自动匹配：" : "Updated: "}
                <Text strong style={{color:"#52c41a"}}>{importResult.updated}</Text>
                {importResult.samples_updated ? <> + 未配对样本 <Text strong style={{color:"#52c41a"}}>{importResult.samples_updated}</Text></> : null}
                {" "}| Skipped: <Text strong style={{color:"#faad14"}}>{importResult.skipped}</Text> | Total: {importResult.total_rows}
              </Text>
              {importResult.mode === "pipeline" && importResult.matched?.length > 0 && (<>
                <Alert type="success" showIcon style={{marginTop:12}}
                  message={`按 PT 号自动匹配到本批次 ${importResult.matched.length} 个样本`}
                  description="管线原始格式（W/H 文件名）无需 case_number/father_label，系统按文件名里的 PT 号在本批次内匹配。" />
                <ul style={{maxHeight:200,overflow:"auto",marginTop:8}}>
                  {importResult.matched.map((m:any,i:number) => <li key={i} style={{fontSize:12}}>
                    行 {m.row}: <b>{m.pt_number}</b> → <b>{m.case_number}</b>（疑父标签 {m.father_label}{m.mother_only ? "，仅孕妇数据→只写母侧" : ""}）
                  </li>)}
                </ul>
              </>)}
              {importResult.sample_matched?.length > 0 && (<>
                <Alert type="success" showIcon style={{marginTop:12}}
                  message={`匹配到本批次 ${importResult.sample_matched.length} 个未配对样本（写入样本行指标）`}
                  description="只有孕妇/只有疑父的行：层数·浓度·杂纯比·Y比例 写到该样本自己，不写 result。" />
                <ul style={{maxHeight:200,overflow:"auto",marginTop:8}}>
                  {importResult.sample_matched.map((m:any,i:number) => <li key={i} style={{fontSize:12}}>
                    行 {m.row}: <b>{m.pt_number}</b> → {m.case_number} · {m.name}（{m.kind}）
                  </li>)}
                </ul>
              </>)}
            </>
          )}
          {importResult.mismatches?.length > 0 && (<>
            <Alert type="error" message={`${importResult.mismatches.length} 行结果不一致`} style={{marginTop:12}} />
            <ul style={{maxHeight:200,overflow:"auto",marginTop:8}}>
              {importResult.mismatches.map((m:any,i:number) => <li key={i} style={{fontSize:12}}>
                Row {m.row}: {m.case_number} / {m.pt_number} / {m.father_label} —— auto_result=<b>{m.auto_result}</b>，result=<b>{m.result}</b>
              </li>)}
            </ul></>)}
          {importResult.errors?.length > 0 && (<>
            <Alert type="warning" message={`${importResult.errors.length} error(s)`} style={{marginTop:12}} />
            <ul style={{maxHeight:200,overflow:"auto",marginTop:8}}>{importResult.errors.map((e:string,i:number) => <li key={i} style={{fontSize:12}}>{e}</li>)}</ul></>)}
          {importResult.warnings?.length > 0 && (<>
            <Alert type="warning" showIcon message={`${importResult.warnings.length} 条提示`} style={{marginTop:12}} />
            <ul style={{maxHeight:160,overflow:"auto",marginTop:8}}>{importResult.warnings.map((w:string,i:number) => <li key={i} style={{fontSize:12}}>{w}</li>)}</ul></>)}
        </>)}
      </Modal>

    </div>
  );
}
