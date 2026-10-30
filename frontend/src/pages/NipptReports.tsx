// NipptReports.tsx — NIPPT 报告模块：按生信批次组织，配对级报告管理
import { useState, useEffect, useRef } from "react";
import { Table, Tag, Spin, Typography, Space, Button, Card, Empty, Select, Input, DatePicker, AutoComplete, message, Tooltip, Modal, Popover, Alert, Switch, Dropdown } from "antd";
import {
  FileTextOutlined, DownloadOutlined, EyeOutlined, UploadOutlined,
  CheckCircleOutlined, ReloadOutlined, HistoryOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, FileAddOutlined,
} from "@ant-design/icons";
import api from "../api/client";
import dayjs from "dayjs";

const { Text, Title } = Typography;

interface UserItem { id: string; username: string; }

export default function NipptReports() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 批次级复核/审核（底部统一填，不需要每份报告都填）
  const [batRev, setBatRev] = useState<string | undefined>(undefined);
  const [batAud, setBatAud] = useState<string | undefined>(undefined);
  const [detailLoading, setDetailLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [revSel, setRevSel] = useState<Record<string, string>>({});
  // 报告版本 / 报告日期 行内编辑（案例级字段）
  const [rvEdit, setRvEdit] = useState<Record<string, string>>({});
  const [rvOptions, setRvOptions] = useState<string[]>([]);
  const [audSel, setAudSel] = useState<Record<string, string>>({});
  const [noteEdit, setNoteEdit] = useState<Record<string, string>>({});
  // 报告上传
  const singleFileRef = useRef<HTMLInputElement>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const pendingPair = useRef<any>(null);
  // 2026-10-21：额外报告（性别报告）PDF 上传
  const sexFileRef = useRef<HTMLInputElement>(null);
  const pendingSexPair = useRef<any>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // ── 生成报告（2026-10-12）──
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genPicked, setGenPicked] = useState<string[]>([]);
  const [genResult, setGenResult] = useState<any>(null);
  const [genRowBusy, setGenRowBusy] = useState<Record<string, boolean>>({});
  // ── 报告在线预览（2026-10-13，mammoth 把 .docx 转 HTML 弹窗显示）──
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewName, setPreviewName] = useState("");
  const [previewFull, setPreviewFull] = useState(false);          // false=快速（跳过附表/图片）
  const [previewKind, setPreviewKind] = useState<"docx" | "pdf">("docx");   // PDF 走 iframe
  const [previewUrl, setPreviewUrl] = useState("");
  // ── 是否代孕（可编辑：防止登记时漏写；口径=勾选 或 备注以代孕开头）──
  const [surBusy, setSurBusy] = useState<Record<string, boolean>>({});
  const [giBusy, setGiBusy] = useState<Record<string, boolean>>({});   // 额外信息列
  const previewBufRef = useRef<ArrayBuffer | null>(null);         // 缓存 docx，切换模式不重新下载
  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  /** 附表 520 行 + 内嵌图片会让弹窗很卡：快速模式把它们换成提示 */
  const stripHeavyParts = (html: string) =>
    html.replace(/<table[\s\S]*?<\/table>/g, (t) =>
      (t.match(/<tr/g) || []).length > 50
        ? '<p style="color:#999">（附表已跳过 · 打开右上角开关可显示）</p>' : t);

  const renderPreviewHtml = async (buf: ArrayBuffer, full: boolean) => {
    // @ts-ignore mammoth 无 TS 类型声明（动态导入，避免拖累首屏）
    const mammoth: any = await import("mammoth");
    // 快速模式：不把图片转成 base64（省掉大头），再跳过超大表格
    const opts = full ? {} : { convertImage: mammoth.images.imgElement(() => ({ src: "" })) };
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buf }, opts);
    let html = value || "";
    if (!full) html = stripHeavyParts(html);
    return html || "<p>（文档内容为空）</p>";
  };

  /** 小眼睛 → 拉 docx 用 mammoth 转 HTML 弹窗预览（默认快速模式）；失败提示改用下载 */
  const previewReport = async (url: string, name: string) => {
    if (!url) return;
    setPreviewName(name || "报告预览");
    setPreviewOpen(true);
    // PDF：浏览器原生阅读器内嵌（mammoth 只认 docx）
    const isPdf = /\.pdf(\?|$)/i.test(url) || /\.pdf$/i.test(name || "");
    if (isPdf) {
      setPreviewKind("pdf");
      setPreviewUrl(url);
      setPreviewHtml("");
      setPreviewFull(false);
      setPreviewLoading(false);
      previewBufRef.current = null;
      return;
    }
    setPreviewKind("docx");
    setPreviewUrl("");
    setPreviewHtml("");
    setPreviewFull(false);
    setPreviewLoading(true);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const buf = await resp.arrayBuffer();
      previewBufRef.current = buf;
      setPreviewHtml(await renderPreviewHtml(buf, false));
    } catch (e: any) {
      setPreviewHtml(
        '<p style="color:#ff4d4f">在线预览失败：' + (e?.message || String(e)) +
        '</p><p>请改用「下载」按钮用 Word 打开。</p>'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  /** 切换到完整模式：用缓存的 docx 重新转换（含图片与附表），不重新下载 */
  const togglePreviewFull = async (v: boolean) => {
    setPreviewFull(v);
    if (!previewBufRef.current) return;
    setPreviewLoading(true);
    try {
      setPreviewHtml(await renderPreviewHtml(previewBufRef.current, v));
    } catch (e: any) {
      setPreviewHtml('<p style="color:#ff4d4f">转换失败：' + (e?.message || String(e)) + '</p>');
    } finally {
      setPreviewLoading(false);
    }
  };

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

  /** 设置/取消「代孕」标记（写案例 risk_warnings，与报告引擎同一口径） */
  const setSurrogacy = async (row: any, val: boolean) => {
    setSurBusy((p) => ({ ...p, [row.id]: true }));
    try {
      await api.post(`/cases/bioinfo/${row.batch}/set-surrogacy/`, {
        pair_ids: [row.id], is_surrogacy: val,
      });
      message.success(val ? "已标记为代孕（该案例全部配对生效）" : "已取消代孕标记");
      await refreshDetail();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.response?.data?.error || "设置失败");
    } finally {
      setSurBusy((p) => { const n = { ...p }; delete n[row.id]; return n; });
    }
  };

  /** 额外信息（2026-10-13）：= 案例管理基本信息里的 gender 项；案例级 → 全部配对生效 */
  const setGenderInfo = async (row: any, val: string) => {
    setGiBusy((p) => ({ ...p, [row.id]: true }));
    try {
      await api.post(`/cases/bioinfo/${row.batch}/set-gender-info/`, {
        pair_ids: [row.id], gender_info: val,
      });
      message.success(val ? `额外信息已设为「${val === "Yes" ? "是" : "否"}」（该案例全部配对生效）`
                          : "额外信息已清空（未填 → 不出性别报告）");
      await refreshDetail();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.response?.data?.error || "设置失败");
    } finally {
      setGiBusy((p) => { const n = { ...p }; delete n[row.id]; return n; });
    }
  };

  // 报告版本候选项（预设 + 库内历史值），来源与登记表单同一接口
  useEffect(() => {
    api.get("/cases/report-versions/")
      .then((r) => setRvOptions(r.data?.options || []))
      .catch(() => {});
  }, []);

  const refreshDetail = async () => {
    if (!selectedBatch) return;
    try {
      const r = await api.get(`/cases/bioinfo/${selectedBatch.id}/`);
      setSelectedBatch(r.data);
    } catch {}
  };

  /** 时间统一北京时间（2026-10-16 修正）：接口返回 UTC(ISO, 带 Z)，
   *  原实现直接切字符串 → 显示 UTC，比北京时间少 8 小时。输出格式保持 MM-DD HH:mm。 */
  const fmtDT = (v: string | null | undefined) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return `${v.slice(5, 10)} ${v.slice(11, 16)}`;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // 未达标：结果未填 或 QC 有异常标记
  const notQualified = (p: any) => !p.result || (p.qc_flag || "") !== "";

  /** 打开「生成报告」：默认全选本批次所有可出报告的配对 */
  const openGenerate = () => {
    const ok = (selectedBatch?.pairs || []).filter((p: any) => !notQualified(p)).map((p: any) => p.id);
    setGenPicked(ok); setGenResult(null);
    if (ok.length === 0) { message.warning("本批次没有可出报告的配对（无结果或 QC 异常）"); return; }
    setGenOpen(true);
  };

  const doGenerate = async () => {
    if (!selectedBatch) return;
    setGenBusy(true);
    try {
      const r = await api.post(`/cases/bioinfo/${selectedBatch.id}/generate-reports/`, { pair_ids: genPicked }, { timeout: 600000 });
      setGenResult(r.data || null);
      const n = r.data?.count || 0, sk = r.data?.skipped_count || 0;
      if (n) message.success(`已生成 ${n} 份报告${sk ? `（${sk} 个跳过）` : ""}`);
      else message.warning(`没有生成报告${sk ? `（${sk} 个跳过）` : ""}`);
      refreshDetail();
    } catch (e: any) {
      message.error("生成失败：" + (e?.response?.data?.detail || e?.message || ""));
    } finally { setGenBusy(false); }
  };

  /** 单个配对生成 */
  const genOne = async (pairId: string) => {
    if (!selectedBatch) return;
    setGenRowBusy((p) => ({ ...p, [pairId]: true }));
    try {
      const r = await api.post(`/cases/bioinfo/${selectedBatch.id}/generate-reports/`, { pair_ids: [pairId] }, { timeout: 600000 });
      const g = (r.data?.generated || []).length, why = r.data?.skipped?.[0]?.reason;
      if (g) { message.success("报告已生成"); refreshDetail(); }
      else message.warning("未生成：" + (why || "未知原因"));
    } catch (e: any) {
      message.error("生成失败：" + (e?.response?.data?.detail || e?.message || ""));
    } finally { setGenRowBusy((p) => ({ ...p, [pairId]: false })); }
  };

  const downloadReportZip = async () => {
    if (!selectedBatch) return;
    try {
      const ids = genResult?.generated?.map((x: any) => x.pair_id) || [];
      const r = await api.get(`/cases/bioinfo/${selectedBatch.id}/report-zip/`, {
        params: { pair_ids: ids.join(",") }, responseType: "blob", timeout: 600000 });
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url; a.download = `nippt_reports_${selectedBatch.batch_number}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e: any) {
      message.error("打包下载失败：" + (e?.response?.data?.detail || e?.message || ""));
    }
  };
  // M.Conc 百分比显示（2026-10-13 用户要求）：库里存小数比例，0.084 → 8.40%
  const fmtPct = (v: any) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : String(v);
  };

  // M.Het / M.Conc 两位小数（2026-10-13 用户要求）；空值仍显示 —
  const fmt2 = (v: any) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : String(v);
  };

  const badReason = (p: any) => !p.result ? "无结果" : `QC异常：${p.qc_flag_display || p.qc_flag}`;

  // ── 复核人/审核人下拉（2026-10-13 用户确认）：只列有中文名的用户，且只显示中文名 ──
  const cnName = (u: any) => `${u?.first_name || ""}${u?.last_name || ""}`.trim();
  const isCnUser = (u: any) => /[\u4e00-\u9fff]/.test(cnName(u));
  const cnUserOptions = (users || [])
    .filter(isCnUser)
    .map((u: any) => ({ label: cnName(u), value: u.id }));

  /** 下拉选项 = 有中文名的用户；**若「当前值」不在名单里**（历史/测试值，如 TestUser 没有汉字被过滤掉），
   *  把它按真实姓名补进选项。
   *  ⚠️ 2026-10-14：antd 对不在 options 里的值会「回退显示原始值」——我们的值是 UUID（36 字符），
   *  在 ~84px 的方框里必然显示不全（用户反馈"审核人/复核人列点开看不全名字"的真因）。 */
  const cnOptionsWith = (users: any[], curId: any, curName: any) => {
    if (!curId || cnUserOptions.some((o: any) => o.value === curId)) return cnUserOptions;
    const u = (users || []).find((x: any) => x.id === curId);
    // 只放姓名本身：方框只有一列宽，加后缀（如「（历史值）」）会被截断得更厉害
    const label = String(curName || "").trim() || cnName(u) || u?.username || "（原用户已删除）";
    return [{ label, value: curId }, ...cnUserOptions];
  };

  // 文件名解析 PT 编号（不区分大小写）：HK_report_TC_PT71739-Y.pdf → "71739"
  const parsePtFromName = (name: string) => {
    const m = String(name || "").match(/PT\s*0*(\d+)/i);
    return m ? String(parseInt(m[1], 10)) : "";
  };
  /** 文件名里的角色后缀（2026-10-13 修 HA/HB 无法区分）
   *  PT71694a → HA、PT71694b → HB、PT72123W → W、PT72033H → H */
  const parseRoleFromName = (name: string) => {
    const m = String(name || "").match(/PT\s*0*(\d+)\s*([A-Za-z]{1,2})?(?!\d)/i);
    const t = (m?.[2] || "").toUpperCase();
    if (!t) return "";
    if (t === "A") return "HA";
    if (t === "B") return "HB";
    return t;
  };
  const pairOptionLabel = (p: any) =>
    `${p.pt_number || ""} ${p.father_label || ""}${p.father_name ? " · " + p.father_name : ""}`.trim();

  const normPt = (v: any) => {
    const m = String(v || "").match(/(\d+)/);
    return m ? String(parseInt(m[1], 10)) : "";
  };
  const lastHist = (r: any) => (Array.isArray(r?.report_history) && r.report_history.length)
    ? r.report_history[r.report_history.length - 1] : null;
  const STATE_LABEL: Record<string, string> = { no_pt: "无PT编号", unmatched: "未匹配", unqualified: "未达标", dup: "重复", bad_type: "格式不支持", too_big: "超过20MB" };

  // ── 报告文件校验（2026-10-13：PDF 或 Word(.docx)，单文件 ≤20MB）──
  const MAX_REPORT_MB = 20;
  const checkReportFile = (f: File): string => {
    if (!/\.(pdf|docx)$/i.test(f.name || "")) return "只支持 PDF 或 Word（.docx）文件";
    if (f.size > MAX_REPORT_MB * 1024 * 1024) return `文件超过 ${MAX_REPORT_MB}MB 上限，请压缩后上传`;
    return "";
  };
  const histLine = (h: any) => h
    ? `${h.action === "keep" ? "保留" : h.action === "replace" ? "替换" : "上传"} · ${h.filename}${h.prev_filename ? `（原 ${h.prev_filename}）` : ""} · ${h.by || "-"} · ${fmtDT(h.at)}`
    : "";

  const doUpload = async (pair: any, file: File, mode: "overwrite" | "keep", kind: "main" | "sex" = "main") => {
    const fd = new FormData();
    fd.append("pair_id", pair.id);
    fd.append("mode", mode);
    if (kind === "sex") fd.append("kind", "sex");
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
    const _bad = checkReportFile(f);
    if (_bad) { message.warning(_bad); return; }
    const h = lastHist(pair);
    const _isPdf = /\.pdf$/i.test(f.name || "");
    const _fmt = _isPdf ? "PDF" : "Word";
    if (_isPdf ? pair.report_file_pdf_url : pair.report_file_url) {
      Modal.confirm({
        title: `该配对的 ${_fmt} 报告已存在`,
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

  // ── 额外报告（性别报告）PDF 上传（Word 由生成器产出）──
  const pickSexPdf = (pair: any) => {
    pendingSexPair.current = pair;
    if (sexFileRef.current) { sexFileRef.current.value = ""; sexFileRef.current.click(); }
  };

  const onSexFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const pair = pendingSexPair.current;
    pendingSexPair.current = null;
    if (!f || !pair) return;
    const _bad = checkReportFile(f);
    if (_bad) { message.warning(_bad); return; }
    if (pair.report_file_sex_pdf_url) {
      Modal.confirm({
        title: "该配对的性别报告 PDF 已存在",
        okText: "覆盖", cancelText: "保留现有",
        content: <div style={{ fontSize: 12 }}>本次文件：<Text code>{f.name}</Text></div>,
        onOk: async () => { const r = await doUpload(pair, f, "overwrite", "sex"); r.ok ? message.success(r.msg) : message.error(r.msg); refreshDetail(); },
        onCancel: async () => { const r = await doUpload(pair, f, "keep", "sex"); r.ok ? message.success(r.msg) : message.error(r.msg); refreshDetail(); },
      });
    } else {
      const r = await doUpload(pair, f, "overwrite", "sex");
      r.ok ? message.success(r.msg) : message.error(r.msg);
      refreshDetail();
    }
  };

  // ── 批量上传：按文件名 PT 匹配本批次配对 ──
  const onBulkFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (!files.length) return;
    const pairs = selectedBatch?.pairs || [];
    const rows = files.map((f: File) => {
      const pt = parsePtFromName(f.name);
      const role = parseRoleFromName(f.name);
      const found = pt ? pairs.filter((p: any) => normPt(p.pt_number) === pt) : [];
      let cand: any = null, reason = "";
      if (found.length === 1) cand = found[0];
      else if (found.length > 1) {
        // 同 PT 多配对（一个 case 多个疑父 HA/HB）→ 用文件名角色后缀区分（2026-10-13）
        const hit = role ? found.filter((p: any) => String(p.father_label || "").toUpperCase() === role) : [];
        if (hit.length === 1) cand = hit[0];
        else reason = `该 PT 下有 ${found.length} 个配对（${found.map((p: any) => p.father_label || "?").join("/")}），`
          + (role ? `文件名后缀「${role}」对不上，` : "文件名没有角色后缀，") + "请在「匹配到」里手工选择";
      }
      let state = "ok";
      if (!pt) { state = "no_pt"; reason = "文件名里没有 PT 编号"; }
      else if (!found.length) { state = "unmatched"; reason = `本批次没有 PT${pt} 的配对（库内编号可能不同）`; }
      else if (!cand) { state = "unmatched"; }
      else if (notQualified(cand)) { state = "unqualified"; reason = `该配对未达标（${badReason(cand)}）`; }
      else if (checkReportFile(f)) {
        const why = checkReportFile(f);
        state = /MB/.test(why) ? "too_big" : "bad_type";
        reason = why;
      }
      return { key: `${f.name}-${Math.random()}`, file: f, pt, role,
               cands: (pt && found.length) ? found : pairs, pair: cand, state, reason, mode: "overwrite" };
    });
    // 判重：同 PT + 同角色 才算重复（HA/HB 两个文件不再互判重复）
    // 判重：同 PT + 同角色 + 同格式 才算重复（Word/PDF 两份不算，2026-10-13）
    const _fmtOf = (f: File) => (/\.pdf$/i.test(f.name || "") ? "pdf" : "word");
    const cnt: Record<string, number> = {};
    rows.forEach((r: any) => {
      if (r.pt) { const k = `${r.pt}|${r.role}|${_fmtOf(r.file)}`; cnt[k] = (cnt[k] || 0) + 1; }
    });
    rows.forEach((r: any) => {
      const k = `${r.pt}|${r.role}|${_fmtOf(r.file)}`;
      if (r.pt && r.state === "ok" && cnt[k] > 1) {
        r.state = "dup"; r.reason = "与另一个文件解析到同一个 PT、同一角色和同一格式";
      }
    });
    setBulkRows(rows);
    setBulkOpen(true);
  };

  /** 手工指定某个文件匹配的配对（HA/HB 同 PT 时的兜底，2026-10-13） */
  const pickBulkPair = (key: string, pairId: string) => {
    setBulkRows((rows) => rows.map((r: any) => {
      if (r.key !== key) return r;
      const pair = (r.cands || []).find((c: any) => c.id === pairId) || null;
      let state = "ok", reason = "";
      if (!r.pt) { state = "no_pt"; reason = "文件名里没有 PT 编号"; }
      else if (!pair) { state = "unmatched"; reason = "未选择配对"; }
      else if (notQualified(pair)) { state = "unqualified"; reason = `该配对未达标（${badReason(pair)}）`; }
      else {
        const why = checkReportFile(r.file);
        if (why) { state = /MB/.test(why) ? "too_big" : "bad_type"; reason = why; }
      }
      return { ...r, pair, state, reason };
    }));
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
    { title: "批次号", dataIndex: "batch_number", key: "bn", width: 138,
      render: (v: string, r: any) => (
        <div style={{ lineHeight: 1.35 }}>
          <Text code style={{ fontSize: 12 }}>{v}</Text>
          <div style={{ fontSize: 11, color: "#888" }}>
            配对 {r.pair_count ?? 0} · 可出报告 {r.reportable_pair_count ?? 0}
          </div>
        </div>
      ) },
    { title: "Chip", dataIndex: "hybseq_chip", key: "chip", width: 62, align: "center" as const,
      render: (v: string) => v
        ? <Tooltip title={`测序 Chip ${v}`}><Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{v}</Tag></Tooltip>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text> },
    { title: "状态", dataIndex: "report_status", key: "rs", width: 76, render: (v: string) => reportTag(v) },
    { title: "进度", key: "rp", width: 62, align: "center" as const,
      render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.report_uploaded_count ?? 0}/{r.reportable_pair_count ?? 0}</Text> },
    { title: "完成时间", dataIndex: "updated_at", key: "ut", width: 92, render: fmtDT },
  ];

  // ── 完成批次准入 ──
  const rp = selectedBatch ? (selectedBatch.pairs || []) : [];
  const reportable = rp.filter((p: any) => !notQualified(p));
  // 2026-10-13：Word/PDF 任一格式即算已上传
  const hasAnyReport = (p: any) => !!(p?.report_file_url || p?.report_file_pdf_url);
  const reportMissing = reportable.filter((p: any) => !hasAnyReport(p));
  const revVal = batRev ?? (selectedBatch?.report_reviewer || undefined);
  const audVal = batAud ?? (selectedBatch?.report_auditor || undefined);
  const uname = (id?: string) => users.find((u: UserItem) => u.id === id)?.username || "—";
  const doneReport = selectedBatch?.report_status === "COMPLETED";
  /** 报告版本/报告日期锁定：报告批次已完成，或该配对已审核 */
  const reportLocked = (r: any) => !!doneReport || !!r?.report_audited_at;
  /** 报告版本 / 报告日期 行内保存（案例级 → 该案例全部配对生效） */
  const saveReportInfo = async (row: any, field: "report_version" | "report_date", dateVal?: string) => {
    const cur = field === "report_version"
      ? (row.report_version || "")
      : (row.report_date ? String(row.report_date).slice(0, 10) : "");
    const val = field === "report_version" ? (rvEdit[row.id] ?? cur) : (dateVal ?? "");
    if (String(val ?? "").trim() === String(cur ?? "").trim()) return;
    try {
      await api.post(`/cases/bioinfo/${row.batch}/set-report-info/`, { pair_ids: [row.id], [field]: val });
      message.success(field === "report_version"
        ? "报告版本已保存（该案例全部配对生效）"
        : "报告日期已保存（该案例全部配对生效）");
      setRvEdit((p) => { const n = { ...p }; delete n[row.id]; return n; });
      await refreshDetail();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    }
  };
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
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 110, ellipsis: true, fixed: "left" as const,
      // 19 字符在 110px 下必然截断 → 补 hover Tooltip 看全（2026-10-13 用户要求缩短本列）
      render: (v: string) => v ? <Tooltip title={v}>{v}</Tooltip> : "—" },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 90, fixed: "left" as const },
    // 2026-10-28：来源 / 报告版本 移到 PT# 之后，并跟前两列一样左锁定
    { title: "来源", dataIndex: "case_source", key: "src", width: 86, fixed: "left" as const,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ whiteSpace: "nowrap" }}>{v}</span></Tooltip>
        : "—" },
    { title: "报告版本", dataIndex: "report_version", key: "rvs", width: 118, fixed: "left" as const,
      render: (v: string, r: any) => {
        if (reportLocked(r)) return <Text style={{ fontSize: 12 }}>{v || "—"}</Text>;
        return (
          <Tooltip title="可搜索 / 直接输入新版本；保存后该案例全部配对生效">
            <AutoComplete size="small" style={{ width: "100%" }} allowClear
              value={rvEdit[r.id] ?? (v || "")}
              placeholder="选择/输入"
              options={rvOptions.map((o: string) => ({ value: o }))}
              filterOption={(input: string, opt: any) =>
                String(opt?.value || "").toLowerCase().includes(String(input).toLowerCase())}
              onChange={(val: string) => setRvEdit((p) => ({ ...p, [r.id]: val }))}
              onBlur={() => saveReportInfo(r, "report_version")} />
          </Tooltip>
        );
      } },
    { title: "标签", dataIndex: "father_label", key: "lb", width: 52, render: (v: string) => <Tag style={{ margin: 0 }}>{v}</Tag> },
    { title: "外部编号", key: "extid", width: 180, ellipsis: true,
      render: (_: any, r: any) => {
        const v = r.sample_dates?.external_id || r.sample_dates?.mother?.external_id;
        return v ? <Tooltip title={v}>{v}</Tooltip> : "—";
      } },
    { title: "到样日期", key: "arrv", width: 104,
      render: (_: any, r: any) => {
        const m = r.sample_dates?.mother?.receipt_date, f = r.sample_dates?.father?.receipt_date;
        if (!m && !f) return "—";
        return <div style={{ fontSize: 12, lineHeight: "16px" }}>
          <div>母 {m ? String(m).slice(0, 10) : "—"}</div>
          <div>父 {f ? String(f).slice(0, 10) : "—"}</div>
        </div>;
      } },
    { title: "采样日期", key: "coll", width: 104,
      render: (_: any, r: any) => {
        const m = r.sample_dates?.mother?.collection_date, f = r.sample_dates?.father?.collection_date;
        if (!m && !f) return "—";
        return <div style={{ fontSize: 12, lineHeight: "16px" }}>
          <div>母 {m ? String(m).slice(0, 10) : "—"}</div>
          <div>父 {f ? String(f).slice(0, 10) : "—"}</div>
        </div>;
      } },
    { title: "报告日期", dataIndex: "report_date", key: "rpd", width: 132,
      render: (v: string, r: any) => {
        if (reportLocked(r)) return <Text style={{ fontSize: 12 }}>{v ? String(v).slice(0, 10) : "—"}</Text>;
        return (
          <Tooltip title="预计出报告日期（报告模板的「检测日期/预计出报告时间」也取它）；该案例全部配对生效">
            <DatePicker size="small" style={{ width: "100%" }} format="YYYY-MM-DD" allowClear
              value={v ? dayjs(String(v).slice(0, 10)) : null}
              onChange={(d: any) => saveReportInfo(r, "report_date", d ? d.format("YYYY-MM-DD") : "")} />
          </Tooltip>
        );
      } },
    { title: "孕妇 证件/管号", dataIndex: "mother_display", key: "mdisp", width: 170, ellipsis: true,
      render: (v: string) => v || "—" },
    { title: "疑父 证件/管号", dataIndex: "father_display", key: "fdisp", width: 170, ellipsis: true,
      render: (v: string) => v || "—" },
    { title: "Mother", dataIndex: "mother_name", key: "mn", width: 110, ellipsis: true },
    { title: "Father", dataIndex: "father_name", key: "fn", width: 120, ellipsis: true },
    { title: "M.Het", dataIndex: "mother_het_ratio", key: "mh", width: 68, render: (v: any) => fmt2(v) },
    { title: "M.Conc", dataIndex: "mother_concentration", key: "mc", width: 76, render: (v: any) => fmtPct(v) },
    { title: "Result", dataIndex: "result_display", key: "rd", width: 100,
      render: (v: string) => {
        if (!v) return <Tag color="red">未填</Tag>;
        const color = v === "支持" ? "green" : v === "不支持" ? "red" : "orange";
        return <Tag color={color}>{v}</Tag>;
      } },
    { title: "男性样本类型", dataIndex: "father_sample_type", key: "fst", width: 104,
      render: (v: string) => v ? <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> : "—" },
    { title: "是否代孕", dataIndex: "is_surrogacy", key: "sur", width: 92,
      render: (v: boolean, r: any) => (
        <Select size="small" style={{ width: 70 }} value={v ? "Y" : "N"} loading={!!surBusy[r.id]}
          onChange={(nv: string) => setSurrogacy(r, nv === "Y")}
          options={[{ value: "N", label: "否" }, { value: "Y", label: "是" }]} />
      ) },
    { title: "额外信息", dataIndex: "gender_info", key: "gi", width: 92,
      render: (v: string, r: any) => (
        <Select size="small" style={{ width: "100%" }} value={v || ""} loading={!!giBusy[r.id]}
          onChange={(nv: string) => setGenderInfo(r, nv)}
          options={[{ value: "", label: "未填" }, { value: "Yes", label: "是" }, { value: "No", label: "否" }]} />
      ) },
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
        if (!hasAnyReport(r)) return <Tag color="orange" style={{ margin: 0 }}>⏳ 待上传</Tag>;
        const h = lastHist(r);
        const fmts = [r.report_file_url ? "Word" : "", r.report_file_pdf_url ? "PDF" : ""].filter(Boolean).join(" + ");
        return <Tooltip title={`${fmts}${r.report_pdf_stale && r.report_file_pdf_url ? "（PDF 可能过期）" : ""}
${histLine(h)}`}>
          <Tag color="green" style={{ margin: 0 }}>✅ 已上传</Tag></Tooltip>;
      } },
    // ── 报告文件 + 上传 ──
    { title: "报告", key: "rf", width: 150,
      render: (_: any, r: any) => {
        if (notQualified(r)) return <Text type="secondary" style={{ fontSize: 11 }}>不可出报告</Text>;
        const hist = Array.isArray(r.report_history) ? r.report_history.slice().reverse() : [];
        return (
          <Space size={4}>
            <Tooltip title="生成该样本报告">
              <Button size="small" icon={<FileAddOutlined />} loading={!!genRowBusy[r.id]}
                onClick={() => genOne(r.id)} />
            </Tooltip>
            {hasAnyReport(r) && (
              <Dropdown menu={{ items: [
                { key: "word", label: <a href={r.report_file_url || undefined}>下载 Word</a>, disabled: !r.report_file_url },
                { key: "pdf", label: <a href={r.report_file_pdf_url || undefined}>下载 PDF</a>, disabled: !r.report_file_pdf_url },
                { type: "divider" as const },
                { key: "zip", label: "打包下载两个", disabled: !(r.report_file_url && r.report_file_pdf_url),
                  onClick: () => window.open(`/api/v1/cases/bioinfo/${r.batch}/report-zip/?pair_ids=${r.id}`, "_blank") },
              ] }}>
                <Tooltip title="下载（可选格式）"><Button size="small" icon={<DownloadOutlined />} /></Tooltip>
              </Dropdown>
            )}
            {hasAnyReport(r) && (
              <Tooltip title="在线预览">
                <Button size="small" icon={<EyeOutlined />}
                  onClick={() => r.report_file_url
                    ? previewReport(r.report_file_url, String(r.report_file || "").split("/").pop() || "报告预览")
                    : previewReport(r.report_file_pdf_url, String(r.report_file_pdf || "").split("/").pop() || "报告预览")} />
              </Tooltip>
            )}
            <Tooltip title={hasAnyReport(r) ? "上传报告（按扩展名存入 Word / PDF 槽，同格式可选覆盖/保留）" : "上传报告"}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => pickSingle(r)} />
            </Tooltip>
            {r.report_pdf_stale && r.report_file_pdf_url && (
              <Tooltip title="Word 报告已重新生成，这份 PDF 可能是旧版（可重新上传覆盖）">
                <Tag color="orange" style={{ margin: 0 }}>PDF 可能过期</Tag>
              </Tooltip>
            )}
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
    // 2026-10-21：额外报告（胎儿性别报告）—— Word 随主报告生成，PDF 人工上传
    { title: "额外报告", key: "sexr", width: 128,
      render: (_: any, r: any) => {
        const enabled = String(r.gender_info || "").trim() === "Yes";
        if (!enabled) {
          return <Tooltip title="「额外信息」不是「是」→ 不出性别报告"><Text type="secondary" style={{ fontSize: 11 }}>未开启</Text></Tooltip>;
        }
        if (notQualified(r)) return <Text type="secondary" style={{ fontSize: 11 }}>不可出报告</Text>;
        return (
          <Space size={4}>
            <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>性别</Tag>
            <Tooltip title={r.report_file_sex_url ? "下载性别报告 Word" : "还没有生成：点主报告列的生成按钮，会一起生成"}>
              <Button size="small" disabled={!r.report_file_sex_url}
                onClick={() => r.report_file_sex_url && window.open(r.report_file_sex_url, "_blank")}>W</Button>
            </Tooltip>
            {r.report_file_sex_pdf_url ? (
              <Tooltip title="下载性别报告 PDF">
                <Button size="small" onClick={() => window.open(r.report_file_sex_pdf_url, "_blank")}>PDF</Button>
              </Tooltip>
            ) : (
              <Tooltip title="上传性别报告 PDF">
                <Button size="small" icon={<UploadOutlined />} onClick={() => pickSexPdf(r)} />
              </Tooltip>
            )}
          </Space>
        );
      } },
    { title: "复核人", key: "rv", width: 120,
      render: (_: any, r: any) => notQualified(r) ? (
        <Select size="small" style={{ width: "100%" }} disabled placeholder="未达标" title="未达标（无结果/QC异常），无需复核" />
      ) : (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Select size="small" style={{ width: "100%" }} placeholder="选择" popupMatchSelectWidth={180}
            value={revSel[r.id] ?? (r.report_reviewer || undefined)}
            onChange={(v) => setRevSel(prev => ({ ...prev, [r.id]: v }))}
            options={cnOptionsWith(users, revSel[r.id] ?? r.report_reviewer, r.report_reviewer_name)} showSearch optionFilterProp="label" />
          {r.report_reviewer_name && <Text type="success" style={{ fontSize: 11 }}>✓ {r.report_reviewer_name}</Text>}
        </Space>
      ) },
    { title: "复核日期", dataIndex: "report_reviewed_at", key: "rvd", width: 100, render: fmtDT },
    { title: "审核人", key: "ad", width: 120,
      render: (_: any, r: any) => notQualified(r) ? (
        <Select size="small" style={{ width: "100%" }} disabled placeholder="未达标" title="未达标（无结果/QC异常），无需审核" />
      ) : (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Select size="small" style={{ width: "100%" }} placeholder="选择" popupMatchSelectWidth={180}
            value={audSel[r.id] ?? (r.report_auditor || undefined)}
            onChange={(v) => setAudSel(prev => ({ ...prev, [r.id]: v }))}
            options={cnOptionsWith(users, audSel[r.id] ?? r.report_auditor, r.report_auditor_name)} showSearch optionFilterProp="label" />
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
        <Button icon={<ReloadOutlined />} onClick={loadBatches}>刷新批次列表</Button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* 左：批次一列 */}
        <Card size="small"
          title={sidebarCollapsed ? undefined : `报告批次（${batches.length}）`}
          extra={<Button type="text" size="small"
            title={sidebarCollapsed ? "展开批次列表" : "收起批次列表"}
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}
          style={{
            width: sidebarCollapsed ? 48 : 470, flexShrink: 0,
            transition: "width 0.25s", overflow: "hidden",
          }}
          bodyStyle={{ padding: 0, maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
          {!sidebarCollapsed && (
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
          )}
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
            {/* 2026-10-30：窄面板下按钮会把统计文字挤成竖排 → 允许换行 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <Space>
                <Text>配对: <b>{rp.length}</b></Text>
                <Text>可出报告: <b>{reportable.length}</b></Text>
                <Text>已上传报告: <b>{reportable.length - reportMissing.length}</b>/{reportable.length}</Text>
                {rp.length > reportable.length && (
                  <Text type="warning">未达标（不出报告）: <b>{rp.length - reportable.length}</b></Text>
                )}
              </Space>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={refreshDetail}>刷新报告列表</Button>
                <Button type="primary" icon={<UploadOutlined />}
                  onClick={() => { if (bulkFileRef.current) { bulkFileRef.current.value = ""; bulkFileRef.current.click(); } }}>批量上传报告</Button>
                <Button type="primary" icon={<FileAddOutlined />} ghost onClick={openGenerate}>生成报告</Button>
              </Space>
            </div>
            <Table
              size="small"
              rowKey="id"
              columns={pairColumns}
              dataSource={selectedBatch.pairs || []}
              pagination={false}
              scroll={{ x: 2500, y: "calc(100vh - 430px)" }}
              onRow={(r: any) => ({
                style: notQualified(r) ? { background: "#fff2f0" } : {},
              })}
            />
            <Modal
              open={previewOpen}
              title={
                <Space>
                  <span>{previewName}</span>
                  {previewKind === "docx" && (
                    <Switch size="small" checked={previewFull} onChange={togglePreviewFull}
                      checkedChildren="含附表/图片" unCheckedChildren="快速预览" />
                  )}
                </Space>
              }
              onCancel={() => setPreviewOpen(false)}
              footer={null}
              width={900}
              styles={{ body: { maxHeight: "72vh", overflow: "auto", background: "#fff", padding: 20 } }}
            >
              {previewLoading
                ? <div style={{ textAlign: "center", padding: 48 }}><Spin /></div>
                : previewKind === "pdf"
                  ? <iframe src={previewUrl} title={previewName}
                      style={{ width: "100%", height: "72vh", border: 0 }} />
                  : <div className="nippt-report-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
            </Modal>
            <Modal
              title={<Space><FileAddOutlined /> 生成报告 — <Text code>{selectedBatch.batch_number}</Text></Space>}
              open={genOpen}
              width={900}
              onCancel={() => setGenOpen(false)}
              footer={
                <Space>
                  <Button onClick={() => setGenOpen(false)}>关闭</Button>
                  {genResult && (genResult.generated || []).length > 0 && (
                    <Button icon={<DownloadOutlined />} onClick={downloadReportZip}>打包下载</Button>
                  )}
                  <Button type="primary" icon={<FileAddOutlined />} loading={genBusy}
                    disabled={genPicked.length === 0} onClick={doGenerate}>
                    生成选中的 {genPicked.length} 个
                  </Button>
                </Space>
              }
            >
              <Alert type="info" showIcon style={{ marginBottom: 10 }}
                message={<span style={{ fontSize: 12 }}>报告按「案例的报告版本」自动选模板；结果为空/亲缘临界、或缺少位点附表(.last) 的配对会跳过并给出原因。默认全选。</span>} />
              <Table
                size="small" rowKey="id" pagination={false}
                scroll={{ y: 320 }}
                dataSource={(selectedBatch?.pairs || []).filter((p: any) => !notQualified(p))}
                rowSelection={{
                  selectedRowKeys: genPicked,
                  onChange: (keys: any) => setGenPicked(keys as string[]),
                }}
                columns={[
                  { title: "PT编号", dataIndex: "pt_number", width: 130 },
                  { title: "案例", dataIndex: "case_number", width: 170 },
                  { title: "孕妇", dataIndex: "mother_name", ellipsis: true },
                  { title: "结果", dataIndex: "result", width: 90,
                    render: (v: string) => v === "INCLUSION" ? "支持" : v === "EXCLUSION" ? "不支持" : v },
                  { title: "附表", key: "ap", width: 80,
                    render: (_: any, r: any) => r.has_appendix ? "✓" : <Text type="danger">缺</Text> },
                ]}
              />
              {genResult && (
                <div style={{ marginTop: 12 }}>
                  <Space>
                    <Text type="success">已生成 {genResult.count} 份</Text>
                    {genResult.skipped_count > 0 && <Text type="warning">跳过 {genResult.skipped_count} 个</Text>}
                  </Space>
                  {(genResult.skipped || []).length > 0 && (
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 12, color: "#a8071a" }}>
                      {genResult.skipped.map((x: any, i: number) => (
                        <li key={i}>{x.pt || x.case}：{x.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Modal>
            <input ref={singleFileRef} type="file" accept=".pdf,.docx" style={{ display: "none" }} onChange={onSingleFile} />
            <input ref={bulkFileRef} type="file" accept=".pdf,.docx" multiple style={{ display: "none" }} onChange={onBulkFiles} />
            <input ref={sexFileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={onSexFile} />

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
                  { title: "解析 PT", dataIndex: "pt", key: "pt", width: 118,
                    render: (v: string, r: any) => v
                      ? <Space size={4}><Text code>PT{v}</Text>{r.role ? <Tag style={{ margin: 0 }}>{r.role}</Tag> : null}</Space>
                      : <Text type="secondary">—</Text> },
                  { title: "匹配到", key: "mt", width: 290,
                    render: (_: any, r: any) => (
                      <Select size="small" style={{ width: "100%" }} value={r.pair?.id}
                        placeholder="请选择配对" showSearch optionFilterProp="label"
                        onChange={(v: string) => pickBulkPair(r.key, v)}
                        options={(r.cands || []).map((c: any) => ({ value: c.id, label: pairOptionLabel(c) }))} />
                    ) },
                  { title: "该配对现状", key: "st2", width: 160,
                    render: (_: any, r: any) => {
                      if (!r.pair) return "—";
                      const isPdf = /\.pdf$/i.test(r.file?.name || "");
                      const has = isPdf ? !!r.pair.report_file_pdf_url : !!r.pair.report_file_url;
                      const other = isPdf ? !!r.pair.report_file_url : !!r.pair.report_file_pdf_url;
                      const fmt = isPdf ? "PDF" : "Word";
                      return <Space size={4}>
                        <Tag color={has ? "blue" : "orange"} style={{ margin: 0 }}>{has ? `已有 ${fmt}` : `${fmt} 首次上传`}</Tag>
                        {other && <Tag style={{ margin: 0 }}>{isPdf ? "另有 Word" : "另有 PDF"}</Tag>}
                      </Space>;
                    } },
                  { title: "有报告时", key: "md", width: 150,
                    render: (_: any, r: any) => {
                      const isPdf = /\.pdf$/i.test(r.file?.name || "");
                      const has = r.pair && (isPdf ? r.pair.report_file_pdf_url : r.pair.report_file_url);
                      return (r.state === "ok" && has) ? (
                        <Select size="small" style={{ width: 120 }} value={r.mode}
                          onChange={(v) => setBulkRows((prev) => prev.map((x: any) => x.key === r.key ? { ...x, mode: v } : x))}
                          options={[{ value: "overwrite", label: "覆盖" }, { value: "keep", label: "保留现有" }]} />
                      ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
                    } },
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
            <div style={{ marginTop: 12, paddingTop: 12, paddingBottom: 4, borderTop: "1px solid #f0f0f0",
              display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
              position: "sticky", bottom: 0, background: "#fff", zIndex: 5 }}>
              <Space>
                <Text>复核人：</Text>
                <Select size="small" style={{ width: 150 }} placeholder="选择复核人" showSearch optionFilterProp="label"
                  popupMatchSelectWidth={180}
                  value={batRev ?? (selectedBatch.report_reviewer || undefined)}
                  onChange={(v: string) => setBatRev(v)}
                  options={cnOptionsWith(users, batRev ?? selectedBatch.report_reviewer, (selectedBatch as any).report_reviewer_name)} />
                {selectedBatch.report_reviewed_at && <Text type="success" style={{ fontSize: 11 }}>✓ {fmtDT(selectedBatch.report_reviewed_at)}</Text>}
              </Space>
              <Space>
                <Text>审核人：</Text>
                <Select size="small" style={{ width: 150 }} placeholder="选择审核人" showSearch optionFilterProp="label"
                  popupMatchSelectWidth={180}
                  value={batAud ?? (selectedBatch.report_auditor || undefined)}
                  onChange={(v: string) => setBatAud(v)}
                  options={cnOptionsWith(users, batAud ?? selectedBatch.report_auditor, (selectedBatch as any).report_auditor_name)} />
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
