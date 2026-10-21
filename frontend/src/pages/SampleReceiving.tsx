// SampleReceiving.tsx — NIPPT Sample Receiving (TABLE layout restored)
// Table-based, PT auto-suffix, batch operations, filters
// Features: YYYY-MM-DD dates, 签收人 column, reject Modal, 已拒收 tab

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Table, Button, Tag, Input, Select, Space, Typography, message,
  Modal, Tabs, Row, Col, Image, Tooltip, Segmented, Alert,
} from "antd";
import {
  CheckOutlined, CloseOutlined, CameraOutlined, PlusOutlined,
  ReloadOutlined, NumberOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text } = Typography;

// PT 警告关闭状态（按案例记住：「已核对，不再提示这些案例」；新出现的案例仍会提醒）
const PT_WARN_DISMISS_KEY = "nippt_pt_warn_dismissed_v1";
const loadPtWarnDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(PT_WARN_DISMISS_KEY) || "[]"); } catch { return []; }
};
const savePtWarnDismissed = (ids: string[]) => {
  try { localStorage.setItem(PT_WARN_DISMISS_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
};

const SAMPLE_TYPE_OPTIONS = [
  { value: "BLOOD",      label: "血液" },
  { value: "DBS",        label: "血痕" },
  { value: "HAIR",       label: "毛发" },
  { value: "NAIL",       label: "指甲" },
  { value: "SWAB",       label: "口拭子" },
  { value: "SEMEN",      label: "精液" },
  { value: "TOOTHBRUSH", label: "牙刷" },
  { value: "CIGARETTE",  label: "烟头" },
  { value: "BOTTLE",     label: "水瓶" },
  { value: "BEARD",     label: "胡须" },
  { value: "FLOSS",     label: "牙线" },
  { value: "SEMSTAIN",  label: "精斑" },
  { value: "GUM",       label: "口香糖" },
];

const PRESERVATION_OPTIONS = [
  { value: "", label: "无" },
  { value: "冰袋", label: "冰袋" },
  { value: "暖宝宝", label: "暖宝宝" },
];

const PRESERVATION_COLORS: Record<string, string> = {
  "": "default", "无": "default", "冰袋": "blue", "暖宝宝": "orange",
};

const STATUS_TAGS: Record<string, { color: string; label: string }> = {
  REGISTERED: { color: "default", label: "待签收" },
  RECEIVED: { color: "blue", label: "已签收" },
  REJECTED: { color: "red", label: "已拒收" },
  IN_PROCESS: { color: "orange", label: "处理中" },
  COMPLETED: { color: "green", label: "已完成" },
};

const RECEIPT_PERSONS = [
  "吴书凌", "叶丽婷", "何家宇", "胡煜敏", "付慧珠",
  "杜兴琼", "龙雨青", "张斯栋", "郭爽洁", "林琦",
  "林洋鸿", "杨思婷", "李彩娟",
];

// 签收地（必填）：厦门 / 香港 —— code 与 workflows 既有枚举一致
const RECEIPT_LOCATIONS = [
  { label: "厦门", value: "XIAMEN" },
  { label: "香港", value: "HONGKONG" },
];
const LOCATION_LABEL: Record<string, string> = { XIAMEN: "厦门", HONGKONG: "香港" };

const REJECT_REASONS = ["采血管破裂", "女性采血管不对", "其他"];

interface CaseSampleRow {
  key: string;
  caseId: string;
  caseNumber: string;
  registrationType: string;
  sampleUuid: string;
  csId: string;
  testSampleId: string;
  patientName: string;
  role: string;
  gestationalWeeks: number | null;
  sampleType: string;
  actualSampleType: string;
  collectionDate: string;
  sampleSource: string;
  salesPerson: string;
  fedexNo: string;
  externalId: string;
  phone: string;
  preservationMethod: string;
  receiptNote: string;
  collectionNotes: string;
  status: string;
  image: string | null;
  ptBase: string;
  ptBaseOriginal: string;   // 载入时的原始值：用于「只校验本次改动」
  received: boolean;
  receivedAt: string;
  receivedByName: string;
  receiptLocation: string;
  workflowStage: string;
  personTypes: string[];        // 该人（同案例+同角色+同姓名）已存在的样本类型集合
  caseHasPhoto?: boolean;
  idCard?: string;
  tubeNo?: string;
}

// ===== 待签收编辑草稿（sessionStorage：路由切换保留，F5 清空）=====
const RECEIVING_DRAFT_KEY = "nippt_receiving_draft_v1";

interface ReceivingDraft {
  ptByCase: Record<string, string>;   // caseId -> PT 数字部分
  persons: Record<string, string>;    // rowKey -> 签收人
  locations: Record<string, string>;  // rowKey -> 签收地 code
}

function loadReceivingDraft(): ReceivingDraft | null {
  try {
    const raw = sessionStorage.getItem(RECEIVING_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ptByCase: d?.ptByCase || {}, persons: d?.persons || {}, locations: d?.locations || {} };
  } catch {
    return null;
  }
}

function persistReceivingDraft(d: ReceivingDraft) {
  try {
    sessionStorage.setItem(RECEIVING_DRAFT_KEY, JSON.stringify({ ...d, savedAt: new Date().toISOString() }));
  } catch { /* ignore */ }
}

/** 模块级：角色后缀（母亲W / 父亲H/HA..）— 提升供恢复逻辑复用 */
function generateSuffix(role: string, allFathers: CaseSampleRow[], fatherName?: string): string {
  if (role === "MOTHER") return "W";
  const uniqueFathers: string[] = [];
  for (const f of allFathers) {
    if (f.role === "ALLEGED_FATHER" && f.patientName && !uniqueFathers.includes(f.patientName)) {
      uniqueFathers.push(f.patientName);
    }
  }
  if (uniqueFathers.length === 0) return "H";
  if (uniqueFathers.length === 1) return "H";
  const idx = fatherName ? uniqueFathers.indexOf(fatherName) : 0;
  return `H${String.fromCharCode(65 + Math.max(0, idx))}`;
}

export default function SampleReceiving() {
  const [data, setData] = useState<CaseSampleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  /** 排序口径（2026-10-15 用户口径）：默认「最新登记」在最上，方便一眼看到刚登记的；
   *  「送检单顺序」保留原升序（与巴西送检单表格一致，便于从上往下批量填 PT 编号）。*/
  const [sortMode, setSortMode] = useState<"newest" | "form">("newest");
  const [tabCounts, setTabCounts] = useState({ pending: 0, received: 0, rejected: 0 });
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [latestPt, setLatestPt] = useState<{ pt: string; next: number | null; existing: number[] } | null>(null);
  const [ptWarnDismissed, setPtWarnDismissed] = useState<string[]>(() => loadPtWarnDismissed());
  const [regTypeFilter, setRegTypeFilter] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Batch PT modal
  const [batchPtOpen, setBatchPtOpen] = useState(false);
  const [batchPtStart, setBatchPtStart] = useState("");
  const [batchPerson, setBatchPerson] = useState<string | undefined>(undefined);
  const [batchLocation, setBatchLocation] = useState<string | undefined>(undefined);

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPhoto = useRef<{ caseId: string; csId: string } | null>(null);
  const [, setUploadingPhoto] = useState<string | null>(null);

  // Inline editing
  const [editingField, setEditingField] = useState<{ key: string; field: string } | null>(null);

  // Receipt person per row: key = rowKey, value = person name
  const [receiptPersons, setReceiptPersons] = useState<Record<string, string>>({});
  // Receipt location per row: key = rowKey, value = location code (XIAMEN/HONGKONG)
  const [receiptLocations, setReceiptLocations] = useState<Record<string, string>>({});

  // 签收补录（实收比登记多出的样本类型）
  const [supTarget, setSupTarget] = useState<CaseSampleRow | null>(null);
  const [supTypes, setSupTypes] = useState<string[]>([]);
  const [supLoading, setSupLoading] = useState(false);

  // Reject Modal
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<CaseSampleRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  // --- Data fetching ---
  const flatCases = useCallback((cases: any[]): CaseSampleRow[] => {
    const rows: CaseSampleRow[] = [];
    for (const c of cases) {
      const caseSamples = c.case_samples || [];
      const caseExtId = caseSamples.find((s: any) => s.role === "MOTHER")?.external_id || "";
      // 该人（同案例 + 同角色 + 同姓名）已存在的样本类型集合 → 补录弹窗只列未登记的类型
      const personTypes: Record<string, string[]> = {};
      for (const cs of caseSamples) {
        const pname = cs.role === "MOTHER" ? (c.mother_name || cs.patient_name || "") : (cs.patient_name || "");
        const k = `${cs.role}|${pname}`;
        const set = personTypes[k] || (personTypes[k] = []);
        for (const t of [cs.sample_source, cs.actual_sample_type]) {
          if (t && !set.includes(t)) set.push(t);
        }
      }
      for (const cs of caseSamples) {
        const isMother = cs.role === "MOTHER";
        const rowPname = isMother ? (c.mother_name || cs.patient_name || "") : (cs.patient_name || "");
        rows.push({
          key: `${c.id}:${cs.id}`,
          caseId: c.id,
          caseNumber: c.case_number,
          registrationType: c.registration_type || "FIRST",
          sampleUuid: cs.sample,
          csId: cs.id,
          testSampleId: cs.test_sample_id || "",
          patientName: isMother ? (c.mother_name || cs.patient_name) : (cs.patient_name || ""),
          role: cs.role,
          gestationalWeeks: isMother ? c.gestational_age_weeks : null,
          sampleType: cs.sample_source || "BLOOD",
          actualSampleType: cs.actual_sample_type || cs.sample_source || "BLOOD",
          collectionDate: cs.collection_date || "",
          sampleSource: cs.case_source || "",
          salesPerson: c.sales_person || "",
          fedexNo: cs.fedex_no || "",
          externalId: cs.external_id || caseExtId || "",
          idCard: cs.id_card || "",
          tubeNo: cs.tube_no || "",
          phone: c.phone || "",
          preservationMethod: cs.preservation_method || "",
          receiptNote: cs.receipt_note || "",
          collectionNotes: c.notes || cs.collection_notes || "",
          status: cs.sample_status || "REGISTERED",
          workflowStage: cs.workflow_stage || "",
          image: cs.receipt_photo_url || null,
          ptBase: c.pt_number ? c.pt_number.replace(/^PT/i, "") : "",
          ptBaseOriginal: c.pt_number ? c.pt_number.replace(/^PT/i, "") : "",
          received: cs.received_at != null,
          receivedAt: cs.received_at || "",
          receivedByName: cs.received_by_name || "",
          receiptLocation: cs.receipt_location || "",
          personTypes: personTypes[`${cs.role}|${rowPname}`] || [],
        });
      }
    }
    return rows;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 全量拉取一次 → 本地分类（Tab 计数与列表同源，永不失配）
      // 排序：默认「最新登记在最上」；「送检单顺序」= 原升序（与巴西送检单表格一致，便于从上往下批量填 PT）
      // receiving=1：只取含签收相关样本的 case（服务端筛选，载荷约降 75%）
      const params: any = {
        page_size: 500,
        ordering: sortMode === "form" ? "created_at,case_number" : "-created_at,-case_number",
        receiving: "1",
      };
      if (search.trim().length >= 2) params.search = search.trim();
      const _r = await (casesApi as any).list(params);
      const cases = _r.data?.results || [];
      // 最新 PT 编号（手编参考，独立轻接口）
      (casesApi as any).latestPt().then((lr: any) => {
        setLatestPt({
          pt: lr.data?.latest_pt || "",
          next: lr.data?.next_number ?? null,
          existing: Array.isArray(lr.data?.existing) ? lr.data.existing : [],
        });
      }).catch(() => {});
      let filtered = cases;
      if (sourceFilter) {
        filtered = filtered.filter((c: any) => c.case_source === sourceFilter);
      }
      if (regTypeFilter) {
        filtered = filtered.filter((c: any) => c.registration_type === regTypeFilter);
      }
      const allRows = flatCases(filtered);
      // Tab 计数（跟随筛选，样本级）
      setTabCounts({
        pending: allRows.filter((r) => r.status === "REGISTERED").length,
        rejected: allRows.filter((r) => r.status === "REJECTED").length,
        received: allRows.filter((r) => r.workflowStage === "RECEIVED" && r.status !== "REJECTED").length,
      });
      // 行级状态过滤：拒绝样本绝不出现于待签收/已签收 tab
      const rows = allRows.filter((r) => {
        if (activeTab === "pending") return r.status === "REGISTERED";
        if (activeTab === "rejected") return r.status === "REJECTED";
        // 已签收 = 仅待前处理（进前处理批次即隐藏，删批次回退后自动重现）；拒收样本绝不出现
        return r.workflowStage === "RECEIVED" && r.status !== "REJECTED";
      });

      // ── 恢复会话草稿（仅待签收 tab 的 REGISTERED 未签收行）──
      if (activeTab === "pending") {
        const draft = loadReceivingDraft();
        if (draft && (Object.keys(draft.ptByCase).length || Object.keys(draft.persons).length)) {
          // 1) PT（Case 级：同 case 行联动，与手输逻辑一致）
          const ptEntries = Object.entries(draft.ptByCase);
          if (ptEntries.length) {
            for (const [caseId, ptBase] of ptEntries) {
              const caseRows = rows.filter((r) => r.caseId === caseId);
              if (!caseRows.length) continue;
              const fathers = caseRows.filter((x) => x.role === "ALLEGED_FATHER");
              for (const r of caseRows) {
                if (r.received || r.status !== "REGISTERED") continue;
                r.ptBase = ptBase;
                r.testSampleId = ptBase ? `PT${ptBase}${generateSuffix(r.role, fathers, r.patientName)}` : "";
              }
            }
          }
          // 2) 签收人（行级）
          const personEntries = Object.entries(draft.persons);
          if (personEntries.length) {
            setReceiptPersons((prev) => {
              const next = { ...prev };
              for (const [key, name] of personEntries) {
                const r = rows.find((x) => x.key === key);
                if (r && !r.received && r.status === "REGISTERED") next[key] = name;
              }
              return next;
            });
          }
        }
      }
      setData(rows);
      // 回填历史签收人（已签收/拒收行展示用）
      setReceiptPersons((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (r.receivedByName && (r.received || r.status === "REJECTED")) {
            next[r.key] = r.receivedByName;
          }
        }
        return next;
      });
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, sourceFilter, regTypeFilter, sortMode, flatCases]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- PT number handling ---
  const handlePtChange = (rowKey: string, newPtBase: string) => {
    const row = data.find((r) => r.key === rowKey);
    if (!row) return;
    setData((prev) =>
      prev.map((r) => {
        if (r.caseId === row.caseId) {
          const fathers = prev.filter((x) => x.caseId === r.caseId && x.role === "ALLEGED_FATHER");
          const suffix = generateSuffix(r.role, fathers, r.patientName);
          const fullBase = newPtBase ? `PT${newPtBase}` : "";
          return { ...r, ptBase: newPtBase, testSampleId: newPtBase ? `${fullBase}${suffix}` : "" };
        }
        return r;
      })
    );
    // 写入会话草稿（Case 级 PT）
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    if (newPtBase) d.ptByCase[row.caseId] = newPtBase;
    else delete d.ptByCase[row.caseId];
    persistReceivingDraft(d);
  };

  /** 行级签收人变更 → 写入会话草稿 */
  const handlePersonChange = (row: CaseSampleRow, name?: string) => {
    setReceiptPersons((prev) => ({ ...prev, [row.key]: name || "" }));
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    if (name) d.persons[row.key] = name;
    else delete d.persons[row.key];
    persistReceivingDraft(d);
  };

  /** 行级签收地变更 → 写入会话草稿 */
  const handleLocationChange = (row: CaseSampleRow, loc?: string) => {
    setReceiptLocations((prev) => ({ ...prev, [row.key]: loc || "" }));
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    if (loc) d.locations[row.key] = loc;
    else delete d.locations[row.key];
    persistReceivingDraft(d);
  };

  /** 批量签收人 → 立即应用到所有选中行 */
  const handleBatchPerson = (name?: string) => {
    setBatchPerson(name);
    if (!name) return;
    const selected = data.filter((r) => selectedRowKeys.includes(r.key) && !r.received && r.status !== "REJECTED");
    setReceiptPersons((prev) => {
      const next = { ...prev };
      for (const row of selected) next[row.key] = name;
      return next;
    });
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    for (const row of selected) d.persons[row.key] = name;
    persistReceivingDraft(d);
    message.success(`已应用签收人「${name}」到 ${selected.length} 个样本`);
  };

  /** 批量签收地 → 立即应用到所有选中行 */
  const handleBatchLocation = (loc?: string) => {
    setBatchLocation(loc);
    if (!loc) return;
    const selected = data.filter((r) => selectedRowKeys.includes(r.key) && !r.received && r.status !== "REJECTED");
    setReceiptLocations((prev) => {
      const next = { ...prev };
      for (const row of selected) next[row.key] = loc;
      return next;
    });
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    for (const row of selected) d.locations[row.key] = loc;
    persistReceivingDraft(d);
    message.success(`已应用签收地「${LOCATION_LABEL[loc] || loc}」到 ${selected.length} 个样本`);
  };

  // 选中清空时重置批量签收人控件（便于下一批重新选择）
  useEffect(() => {
    if (selectedRowKeys.length === 0) { setBatchPerson(undefined); setBatchLocation(undefined); }
  }, [selectedRowKeys]);

  // --- PT 编号校验（2026-10-15 口径：只提醒不拦）---
  // 手输 PT 易漏前导 7（PT2260 应为 PT72260；正常是 PT + 5 位且以 7 开头）。
  // 三条规则与页面「最新 PT」提示同口径：位数不一致 / 比最新小 / 该号已存在。
  const checkPtBase = (raw: string, original?: string): string | null => {
    const v = (raw || "").replace(/\D/g, "");
    if (!v) return null;                                // 空值交给「请先填写 PT 编号」
    const orig = (original || "").replace(/\D/g, "");
    if (orig && v === orig) return null;                // 本次没改动（存量已填的号）→ 不校验：存量不管
    const latestDigits = (latestPt?.pt || "").replace(/^PT/i, "").replace(/\D/g, "");
    if (!latestDigits) return null;                     // 取不到最新号时不校验，避免误报
    if (v.length !== latestDigits.length)
      return `位数不对：最新是 ${latestDigits.length} 位（${latestDigits}），你填了 ${v.length} 位`;
    // 查重必须排除本案例自己原来的号，否则「自己的号」会被判成重复
    if ((latestPt?.existing || []).includes(Number(v)) && Number(v) !== Number(orig))
      return `PT${v} 已存在（重复）`;
    if (Number(v) < Number(latestDigits)) return `比最新 PT${latestDigits} 小`;
    return null;
  };

  // --- 签收前置校验：PT 编号 + 图片（Case 级） ---
  const validateBeforeReceipt = (row: CaseSampleRow): string | null => {
    if (!receiptPersons[row.key]) return "请先选择签收人";
    if (!receiptLocations[row.key]) return "请先选择签收地";
    if (!row.ptBase) return "请先填写 PT 编号";
    const hasPhoto = row.caseHasPhoto || data.some((r) => r.caseId === row.caseId && r.image);
    if (!hasPhoto) return "请先上传样本图片";
    return null;
  };

  // --- Receipt actions ---
  const confirmReceipt = async (row: CaseSampleRow, condition: string = "OK", rejectionNote: string = "") => {
    try {
      const preErr = validateBeforeReceipt(row);
      if (preErr) {
        message.error(preErr);
        return;
      }
      const ptWarn = checkPtBase(row.ptBase, row.ptBaseOriginal);
      if (ptWarn) {
        message.warning({ content: `PT 编号可能填错：${ptWarn}（若确认无误可继续）`, duration: 6 });
      }
      const payload: any = { sample_id: row.sampleUuid, condition };
      if (row.ptBase) payload.pt_number = "PT" + row.ptBase;
      if (row.actualSampleType) payload.actual_sample_type = row.actualSampleType;
      if (row.preservationMethod) payload.preservation_method = row.preservationMethod;
      if (condition !== "OK") payload.rejection_note = rejectionNote;
      const personName = receiptPersons[row.key];
      if (personName) payload.received_by_name = personName;
      payload.receipt_location = receiptLocations[row.key] || "";
      const resp = await (casesApi as any).confirmReceipt(row.caseId, payload);
      message.success(condition === "OK" ? `已签收 ${row.testSampleId || row.patientName}` : "已拒收");
      // 清除该行草稿（已签收/拒收不再需要）
      const d = loadReceivingDraft();
      if (d) {
        delete d.persons[row.key];
        delete d.ptByCase[row.caseId];
        persistReceivingDraft(d);
      }
      if (condition !== "OK") {
        fetchData();
      } else {
        const rt = resp?.data?.received_at || new Date().toISOString();
        setData((prev) =>
          prev.map((r) =>
            r.key === row.key
              ? { ...r, received: true, status: "RECEIVED", receivedAt: rt, receivedByName: receiptPersons[row.key] || r.receivedByName, receiptLocation: receiptLocations[row.key] || r.receiptLocation }
              : r
          )
        );
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "操作失败");
    }
  };

  const batchReceive = async () => {
    const selected = data.filter((r) => selectedRowKeys.includes(r.key));
    // ── ① 批量前预检：收集所有问题行，一次性列出（不逐行弹错）──
    const problems: string[] = [];
    for (const row of selected) {
      const preErr = validateBeforeReceipt(row);
      if (preErr) problems.push(`${row.testSampleId || row.patientName || "?"}：${preErr}`);
    }
    if (problems.length) {
      const shown = problems.slice(0, 3).join("；");
      const more = problems.length > 3 ? `；…等共 ${problems.length} 个问题` : "";
      message.error({ content: `以下样本无法签收 —— ${shown}${more}`, duration: 6 });
      return;
    }
    const ptWarns: string[] = [];
    for (const row of selected) {
      const w = checkPtBase(row.ptBase, row.ptBaseOriginal);
      if (w) ptWarns.push(`PT${row.ptBase}（${row.testSampleId || row.patientName || "?"}）：${w}`);
    }
    if (ptWarns.length) {
      const shown = ptWarns.slice(0, 3).join("；");
      const more = ptWarns.length > 3 ? `；…等共 ${ptWarns.length} 个` : "";
      message.warning({ content: `以下 PT 编号可能填错（仍继续签收）：${shown}${more}`, duration: 8 });
    }
    // ── ② 执行签收：失败带具体原因 ──
    let okCount = 0;
    const fails: string[] = [];
    for (const row of selected) {
      try {
        const payload: any = { sample_id: row.sampleUuid, condition: "OK" };
        if (row.ptBase) payload.pt_number = "PT" + row.ptBase;
        if (row.actualSampleType) payload.actual_sample_type = row.actualSampleType;
        if (row.preservationMethod) payload.preservation_method = row.preservationMethod;
        const personName = receiptPersons[row.key];
        if (personName) payload.received_by_name = personName;
        payload.receipt_location = receiptLocations[row.key] || "";
        await (casesApi as any).confirmReceipt(row.caseId, payload);
        okCount++;
      } catch (e: any) {
        const d = e?.response?.data;
        const detail = (Array.isArray(d) ? d[0] : d?.detail) || "网络或服务器错误";
        fails.push(`${row.testSampleId || row.patientName || "?"}：${detail}`);
      }
    }
    // ── ③ 汇总结果 ──
    if (fails.length) {
      const shown = fails.slice(0, 3).join("；");
      const more = fails.length > 3 ? `；…等共 ${fails.length} 个失败` : "";
      message.error({ content: `成功 ${okCount} 个，失败 ${fails.length} 个 —— ${shown}${more}`, duration: 6 });
    } else {
      message.success(`批量签收完成（共 ${okCount} 个样本）`);
    }
    setSelectedRowKeys([]);
    fetchData();
  };

  // --- Reject handler ---
  const handleRejectClick = (row: CaseSampleRow) => {
    setRejectTarget(row);
    setRejectReason("");
    setRejectNote("");
    setRejectModalOpen(true);
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget || !rejectReason) return;
    const fullNote = rejectNote ? `${rejectReason}：${rejectNote}` : rejectReason;
    await confirmReceipt(rejectTarget, "REJECTED", fullNote);
    setRejectModalOpen(false);
    setRejectTarget(null);
    setRejectReason("");
    setRejectNote("");
  };

  // --- Batch PT ---
  const handleBatchPt = () => {
    if (!batchPtStart.trim()) return;
    const selected = data.filter((r) => selectedRowKeys.includes(r.key));
    const caseGroups = new Map<string, CaseSampleRow[]>();
    for (const row of selected) {
      if (!caseGroups.has(row.caseId)) caseGroups.set(row.caseId, []);
      caseGroups.get(row.caseId)!.push(row);
    }
    let ptNum = parseInt(batchPtStart) || 1;
    const drafts: Record<string, string> = {};

    // PT 校验（只提醒不拦）：起始位数 / 是否小于最新 / 生成号是否已存在
    {
      const startDigits = batchPtStart.replace(/\D/g, "");
      const latestDigits = (latestPt?.pt || "").replace(/^PT/i, "").replace(/\D/g, "");
      const warns: string[] = [];
      if (latestDigits && startDigits.length !== latestDigits.length)
        warns.push(`起始数位数不对：最新是 ${latestDigits.length} 位（${latestDigits}），你填了 ${startDigits.length} 位`);
      if (latestDigits && Number(startDigits) < Number(latestDigits)) warns.push(`比最新 PT${latestDigits} 小`);
      const gen: number[] = [];
      for (let i = 0; i < caseGroups.size; i++) gen.push(Number(startDigits) + i);
      const dup = gen.filter((n) => (latestPt?.existing || []).includes(n));
      if (dup.length)
        warns.push(`生成号已存在：${dup.slice(0, 5).map((n) => "PT" + String(n).padStart(Math.max(5, startDigits.length), "0")).join("、")}`);
      if (warns.length) message.warning({ content: `请注意：${warns.join("；")}（仍已填入，可修改后再签收）`, duration: 8 });
    }

    setData((prev) => {
      const updated = [...prev];
      for (const [caseId, rows] of caseGroups) {
        const baseNum = String(ptNum).padStart(5, "0");  // 纯数字（ptBase 用）
        const base = `PT${baseNum}`;
        drafts[caseId] = baseNum;
        const fathers = rows.filter((r) => r.role === "ALLEGED_FATHER");
        for (const row of rows) {
          const idx = updated.findIndex((r) => r.key === row.key);
          if (idx >= 0) {
            const suffix = generateSuffix(row.role, fathers, row.patientName);
            updated[idx] = {
              ...updated[idx],
              ptBase: baseNum,
              testSampleId: `${base}${suffix}`,
            };
          }
        }
        ptNum++;
      }
      return updated;
    });
    // 写入会话草稿（Case 级 PT，与单个填写一致）
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {}, locations: {} };
    Object.assign(d.ptByCase, drafts);
    persistReceivingDraft(d);
    setBatchPtOpen(false);
    setBatchPtStart("");
    message.success("PT 编号已批量分配");
  };

  // --- Photo upload ---
  const handlePhotoClick = (row: CaseSampleRow) => {
    pendingPhoto.current = { caseId: row.caseId, csId: row.csId };
    fileInputRef.current?.click();
  };

  // 2026-10-21：支持把图片直接拖到样本行上（访达 / 微信拖拽）
  const uploadPhotoFor = async (row: CaseSampleRow, file: File) => {
    if (!file || !(file.type || "").startsWith("image/")) return;
    setUploadingPhoto(row.csId);
    const prevPending = pendingPhoto.current;
    pendingPhoto.current = { caseId: row.caseId, csId: row.csId };
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("case_sample_id", row.csId);
      const uploadRes = await (casesApi as any).uploadReceiptPhoto(row.caseId, formData);
      message.success("照片已上传");
      const photoUrl = uploadRes.data?.receipt_photo_url;
      setData((prev) =>
        prev.map((r) => (r.caseId === row.caseId
          ? { ...r, image: r.csId === row.csId ? photoUrl || null : r.image, caseHasPhoto: true }
          : r))
      );
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingPhoto(null);
      pendingPhoto.current = prevPending;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingPhoto.current) return;
    setUploadingPhoto(pendingPhoto.current.csId);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("case_sample_id", pendingPhoto.current.csId);
      const uploadRes = await (casesApi as any).uploadReceiptPhoto(pendingPhoto.current.caseId, formData);
      message.success("照片已上传");
      const photoUrl = uploadRes.data?.receipt_photo_url;
      setData((prev) =>
        prev.map((r) => {
          if (r.caseId === pendingPhoto.current!.caseId) {
            return {
              ...r,
              image: r.csId === pendingPhoto.current!.csId ? photoUrl || null : r.image,
              caseHasPhoto: true,
            };
          }
          return r;
        })
      );
    } catch {
      message.error("上传失败");
    } finally {
      setUploadingPhoto(null);
      pendingPhoto.current = null;
    }
  };

  // 前端字段名（驼峰）→ 后端 API 字段名（下划线）
  const FIELD_TO_API: Record<string, string> = {
    actualSampleType: "actual_sample_type",
    preservationMethod: "preservation_method",
    receiptNote: "receipt_note",
  };
  // --- Inline field update ---
  const updateField = async (row: CaseSampleRow, field: string, value: string) => {
    setEditingField(null);
    setData((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, [field]: value } : r))
    );
    try {
      await (casesApi as any).update(row.caseId, {
        case_sample_id: row.csId,
        [FIELD_TO_API[field] || field]: value,
      });
    } catch {
      // Silent fail
    }
  };

  // --- 签收补录：实收比登记多出的样本类型 ---
  const openReceiptSupplement = (row: CaseSampleRow) => {
    if (row.role !== "ALLEGED_FATHER") return;          // 本期仅疑父开放
    if (row.received || row.status === "REJECTED") return;
    if (!(row.ptBase || "").trim()) {
      message.error("请先填写 PT 编号，再补录实收类型");
      return;
    }
    if (!receiptPersons[row.key]) {
      message.error("请先选择签收人，再补录实收类型");
      return;
    }
    if (!receiptLocations[row.key]) {
      message.error("请先选择签收地，再补录实收类型");
      return;
    }
    setSupTypes([]);
    setSupTarget(row);
  };

  const submitReceiptSupplement = async () => {
    if (!supTarget) return;
    if (!supTypes.length) {
      message.warning("请至少选择一个实收样本类型");
      return;
    }
    setSupLoading(true);
    try {
      const resp = await (casesApi as any).receiptSupplement(supTarget.caseId, {
        case_sample_id: supTarget.csId,
        sample_types: supTypes,
        pt_number: supTarget.ptBase ? `PT${supTarget.ptBase}` : undefined,
        received_by_name: receiptPersons[supTarget.key],
        receipt_location: receiptLocations[supTarget.key] || "",
      });
      const created = resp?.data?.created || [];
      const skipped = resp?.data?.skipped || [];
      if (created.length) {
        const names = created.map((x: any) => x.sample_source_display || x.sample_source).join("、");
        message.success(`已补录并签收：${names}`);
      }
      if (skipped.length) {
        const sk = skipped
          .map((t: string) => SAMPLE_TYPE_OPTIONS.find((o) => o.value === t)?.label || t)
          .join("、");
        message.info(`${sk} 已登记，已跳过`);
      }
      setSupTarget(null);
      setSupTypes([]);
      fetchData();
    } catch (e: any) {
      const d = e?.response?.data;
      message.error((Array.isArray(d) ? d[0] : d?.detail) || "补录失败");
    } finally {
      setSupLoading(false);
    }
  };

  // --- Columns ---
  const columns: any[] = [
    {
      title: "case编号", dataIndex: "caseNumber", key: "cn", width: 160,
      render: (v: string, _r: CaseSampleRow) => (
        <Text code style={{ fontSize: 12 }}>{v}</Text>
      ),
      onCell: (r: CaseSampleRow) => {
        const groupKey = `${r.caseId}:${r.patientName}`;
        const first = data.find((d) => `${d.caseId}:${d.patientName}` === groupKey);
        if (first?.key === r.key) {
          const count = data.filter((d) => `${d.caseId}:${d.patientName}` === groupKey).length;
          return { rowSpan: count };
        }
        return { rowSpan: 0 };
      },
    },
    {
      title: "样本来源", dataIndex: "sampleSource", key: "src", width: 90,
      render: (v: string) => v || "—",
    },
    {
      title: "快递", dataIndex: "fedexNo", key: "fx", width: 150, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
          : "—",
    },
    {
      title: "外部编号", dataIndex: "externalId", key: "eid", width: 140, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ fontSize: 12, cursor: "default" }}>{v}</span></Tooltip>
          : <Text type="secondary">-</Text>,
    },
    {
      title: "PT编号", dataIndex: "testSampleId", key: "pt", width: 180,
      render: (v: string, r: CaseSampleRow) => {
        const ptWarn = checkPtBase(r.ptBase, r.ptBaseOriginal);
        return (
          <div>
            <Input
              size="small"
              value={r.ptBase}
              placeholder="输入数字"
              status={ptWarn ? "error" : undefined}
              onChange={(e) => handlePtChange(r.key, e.target.value.replace(/\D/g, ""))}
              style={{ width: 135, fontFamily: "monospace" }}
              addonBefore="PT"
              addonAfter={<Text type="secondary" style={{ fontSize: 11 }}>{v ? v.replace("PT" + r.ptBase, "") : ""}</Text>}
            />
            {ptWarn && (
              <div title={ptWarn} style={{ color: "#cf1322", fontSize: 11, lineHeight: "14px", marginTop: 2, maxWidth: 176, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⚠ {ptWarn}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: "证件号", dataIndex: "idCard", key: "idc", width: 130, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "管号", dataIndex: "tubeNo", key: "tno", width: 130, ellipsis: true,
      render: (v: string) => v || "—",
    },
    {
      title: "姓名", dataIndex: "patientName", key: "name", width: 180, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
          : <Text type="secondary">-</Text>,
    },
    {
      title: "图片", dataIndex: "image", key: "img", width: 60,
      render: (v: string | null, r: CaseSampleRow) => {
        // Case 级显示：本行无照片时回退显示同案例其他样本的照片（与后端校验口径一致）
        const eff = v || data.find((x) => x.caseId === r.caseId && x.image)?.image || null;
        return eff ? <Image src={eff} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview /> : "—";
      },
    },
    {
      title: "样本类型", dataIndex: "sampleType", key: "st", width: 80,
      render: (v: string) => {
        const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === v);
        return <Tag>{opt?.label || v || "—"}</Tag>;
      },
    },
    {
      title: "实际收到样本类型", dataIndex: "actualSampleType", key: "ast", width: 140,
      render: (v: string, r: CaseSampleRow) =>
        editingField?.key === r.key && editingField?.field === "actualSampleType" ? (
          <Select
            size="small" value={v} style={{ width: 100 }}
            options={SAMPLE_TYPE_OPTIONS}
            onChange={(val) => updateField(r, "actualSampleType", val)}
            onBlur={() => setEditingField(null)}
            autoFocus
            defaultOpen
          />
        ) : (
          <Tag
            color="blue"
            style={{ cursor: "pointer" }}
            onClick={() => !r.received && setEditingField({ key: r.key, field: "actualSampleType" })}
          >
            {(() => { const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === v); return opt?.label || v || "—"; })()}
          </Tag>
        ),
    },
    {
      title: "登记备注", dataIndex: "collectionNotes", key: "notes", width: 140, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ color: "#d46b08", cursor: "default" }}>{v}</span></Tooltip> : "—",
    },
    {
      title: "签收人", key: "rp", width: 110,
      render: (_: any, r: CaseSampleRow) => (
        <Select
          placeholder="签收人"
          size="small"
          style={{ width: 100 }}
          value={receiptPersons[r.key] || undefined}
          onChange={(val) => handlePersonChange(r, val)}
          options={RECEIPT_PERSONS.map(name => ({ label: name, value: name }))}
          allowClear
          disabled={r.received || r.status === "REJECTED"}
        />
      ),
    },
    {
      title: "签收地", key: "rl", width: 100,
      render: (_: any, r: CaseSampleRow) => (
        r.received ? (
          <Text>{LOCATION_LABEL[r.receiptLocation] || "—"}</Text>
        ) : (
          <Select
            placeholder="签收地"
            size="small"
            style={{ width: 88 }}
            value={receiptLocations[r.key] || undefined}
            onChange={(val) => handleLocationChange(r, val)}
            options={RECEIPT_LOCATIONS}
            allowClear
            disabled={r.status === "REJECTED"}
          />
        )
      ),
    },
    {
      title: "孕周", dataIndex: "gestationalWeeks", key: "gw", width: 60,
      render: (v: number | null) => v ? `${v}w` : <Text type="secondary">—</Text>,
    },
    {
      title: "采集日期", dataIndex: "collectionDate", key: "cd", width: 110,
      render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "—",
    },
    {
      title: "销售/代理", dataIndex: "salesPerson", key: "sales", width: 100,
      render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: "手机", dataIndex: "phone", key: "ph", width: 110,
      render: (v: string) => v || "—",
    },
    {
      title: "签收备注", dataIndex: "receiptNote", key: "rn", width: 160, ellipsis: true,
      render: (v: string, r: CaseSampleRow) =>
        editingField?.key === r.key && editingField?.field === "receiptNote" ? (
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            defaultValue={v || ""}
            placeholder="如：样本与登记不一致…"
            autoFocus
            onBlur={(e) => updateField(r, "receiptNote", e.target.value)}
            style={{ width: 150, fontSize: 12 }}
          />
        ) : (
          <Tooltip title={v || "点击填写"}>
            <span
              style={{ color: v ? "#d46b08" : "#bbb", cursor: "pointer", fontSize: 12 }}
              onClick={() => setEditingField({ key: r.key, field: "receiptNote" })}
            >
              {v || "点击填写"}
            </span>
          </Tooltip>
        ),
    },
    {
      title: "保温措施", dataIndex: "preservationMethod", key: "pm", width: 110,
      render: (v: string, r: CaseSampleRow) =>
        editingField?.key === r.key && editingField?.field === "preservationMethod" ? (
          <Select
            size="small" value={v || ""} style={{ width: 90 }}
            options={PRESERVATION_OPTIONS}
            onChange={(val) => updateField(r, "preservationMethod", val)}
            onBlur={() => setEditingField(null)}
            autoFocus
            defaultOpen
          />
        ) : (
          <Tag
            color={PRESERVATION_COLORS[v] || "default"}
            style={{ cursor: "pointer" }}
            onClick={() => !r.received && setEditingField({ key: r.key, field: "preservationMethod" })}
          >
            {v || "无"}
          </Tag>
        ),
    },
    {
      title: "状态", dataIndex: "status", key: "status", width: 80,
      render: (v: string) => {
        const t = STATUS_TAGS[v] || { color: "default", label: v };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: "签收时间", dataIndex: "receivedAt", key: "rt", width: 140,
      render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : <Text type="secondary">—</Text>,
    },
    {
      title: "操作", key: "act", width: 220, fixed: "right" as const,
      render: (_: any, r: CaseSampleRow) =>
        r.received || r.status === "REJECTED" ? (
          <Text type="secondary">{r.status === "REJECTED" ? "已拒收" : "已签收"}</Text>
        ) : (
          <Space size={2}>
            <Button
              size="small" type="primary"
              icon={<CheckOutlined />}
              onClick={() => confirmReceipt(r)}
            />
            <Button
              size="small" danger
              icon={<CloseOutlined />}
              onClick={() => handleRejectClick(r)}
            />
            <Button
              size="small"
              icon={<CameraOutlined />}
              onClick={() => handlePhotoClick(r)}
            />
            {r.role === "ALLEGED_FATHER" && (
              <Tooltip title="补录实收样本类型（按补样登记并直接签收）">
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => openReceiptSupplement(r)}
                />
              </Tooltip>
            )}
          </Space>
        ),
    },
  ];

  // --- Render ---
  return (
    <div>
      {/* Search & Filters */}
      <Row gutter={12} style={{ marginBottom: 12 }} align="middle">
        <Col>
          <Input.Search
            placeholder="搜索 Case号/姓名/PT号..."
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => fetchData()}
            style={{ width: 260 }}
          />
        </Col>
        <Col>
          <Select
            placeholder="来源筛选"
            allowClear
            style={{ width: 140 }}
            value={sourceFilter || undefined}
            onChange={(v) => setSourceFilter(v || "")}
            options={["国内", "中国香港", "泰国", "巴西", "巴西万基", "越南", "韩国", "阿联酋", "北马其顿", "马来西亚", "CYJ印度", "CYJ澳洲", "CYJ秘鲁", "CYJ美国", "CYJ西班牙", "CYJ加纳", "CYJ马来西亚", "西班牙代理", "西班牙巴塞罗那经销商", "YLH西班牙bygens", "YLH西班牙LABGENETICS", "YLH墨西哥经销商", "YLH新加坡经销商"].map((v) => ({ value: v, label: v }))}
          />
        </Col>
        <Col>
          <Select
            placeholder="登记类型"
            allowClear
            style={{ width: 120 }}
            value={regTypeFilter || undefined}
            onChange={(v) => setRegTypeFilter(v || "")}
            options={[
              { value: "FIRST", label: "首次检测" },
              { value: "SUPPLEMENT", label: "补充样本" },
              { value: "RESAMPLE", label: "重采样本" },
            ]}
          />
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        </Col>
      </Row>

      {/* Batch toolbar */}
      {activeTab === "pending" && selectedRowKeys.length >= 2 && (
        <div style={{ marginBottom: 8, padding: "6px 12px", background: "#e6f7ff", borderRadius: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <Text strong>已选 {selectedRowKeys.length} 个样本</Text>
          <Select
            placeholder="批量签收人（应用到所选）"
            size="small"
            style={{ width: 200 }}
            value={batchPerson}
            onChange={handleBatchPerson}
            options={RECEIPT_PERSONS.map((name) => ({ label: name, value: name }))}
            allowClear
          />
          <Select
            placeholder="批量签收地（应用到所选）"
            size="small"
            style={{ width: 200 }}
            value={batchLocation}
            onChange={handleBatchLocation}
            options={RECEIPT_LOCATIONS}
            allowClear
          />
          <Button size="small" icon={<NumberOutlined />} onClick={() => setBatchPtOpen(true)}>批量填写PT</Button>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={batchReceive}>批量签收</Button>
        </div>
      )}

      {/* 最新 PT 编号（手编参考） */}
      {latestPt && latestPt.pt && (
        <div style={{ marginBottom: 6 }}>
          <Tag color="geekblue" style={{ fontSize: 13, padding: "2px 10px", fontWeight: 600 }}>
            最新 PT：{latestPt.pt}{latestPt.next ? `（下一个从 ${latestPt.next} 开始）` : ""}
          </Tag>
        </div>
      )}

      {/* PT 编号疑似填错汇总（只提醒不拦；按案例去重） */}
      {(() => {
        const badMap = new Map<string, CaseSampleRow>();
        data.forEach((r) => {
          if (ptWarnDismissed.includes(r.caseId)) return;      // 已关闭提示的案例不再计入
          if (checkPtBase(r.ptBase, r.ptBaseOriginal)) badMap.set(r.caseId, r);
        });
        const bad = Array.from(badMap.values());
        if (!bad.length) return null;
        return (
          <Alert
            type="warning" showIcon closable style={{ marginBottom: 6 }}
            onClose={() => {
              const ids = Array.from(new Set([...ptWarnDismissed, ...bad.map((r) => r.caseId)]));
              setPtWarnDismissed(ids); savePtWarnDismissed(ids);
              message.info("已关闭这些案例的提示（新出现的仍会提醒）");
            }}
            message={`有 ${bad.length} 个案例的 PT 编号可能填错（仍可签收，请核对）`}
            description={
              <span style={{ fontSize: 12 }}>
                {bad.slice(0, 6).map((r) => `PT${r.ptBase}（${r.testSampleId || r.patientName}）：${checkPtBase(r.ptBase, r.ptBaseOriginal)}`).join("；")}
                {bad.length > 6 ? `；…等共 ${bad.length} 个` : ""}
              </span>
            }
          />
        );
      })()}

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => { setActiveTab(k); setSelectedRowKeys([]); }}
        tabBarExtraContent={
          <Space size={6} style={{ paddingRight: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>排序</Typography.Text>
            <Segmented
              size="small"
              value={sortMode}
              onChange={(v: any) => setSortMode(v)}
              options={[
                { label: "最新登记", value: "newest" },
                { label: "按送检单顺序", value: "form" },
              ]}
            />
          </Space>
        }
        items={[
          { key: "pending", label: `待签收（${tabCounts.pending}个）` },
          { key: "received", label: `已签收（${tabCounts.received}个）` },
          { key: "rejected", label: `已拒收（${tabCounts.rejected}个）` },
        ]}
        style={{ marginBottom: 0 }}
      />

      {/* Table */}
      <style>{`
        .ant-table-tbody > tr.case-boundary-row > td {
          border-bottom: 3px solid rgba(22, 119, 255, 0.85) !important;
        }
      `}</style>
      <Table
        rowKey="key"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="small"
        scroll={{ x: 1600, y: "calc(100vh - 320px)" }}
        onRow={(r) => {
          const idx = data.indexOf(r);
          const nextRow = data[idx + 1];
          const isCaseBoundary = nextRow && r.caseId !== nextRow.caseId;
          const base = isCaseBoundary ? { className: "case-boundary-row" } : {};
          // 2026-10-21：整行作为照片拖拽目标 —— 拖到哪一行就传到那一行的样本
          return {
            ...base,
            onDragOver: (e: any) => {
              if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
                e.preventDefault();
                e.currentTarget.style.outline = "2px dashed #1677ff";
                e.currentTarget.style.outlineOffset = "-2px";
              }
            },
            onDragLeave: (e: any) => {
              e.currentTarget.style.outline = "";
            },
            onDrop: (e: any) => {
              e.currentTarget.style.outline = "";
              const f = e.dataTransfer?.files?.[0];
              if (!f) return;
              e.preventDefault();
              e.stopPropagation();
              uploadPhotoFor(r, f);
            },
          };
        }}
        rowSelection={activeTab === "pending" ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          getCheckboxProps: (r: CaseSampleRow) => ({ disabled: r.received }),
        } : undefined}
        pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条` }}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Batch PT Modal */}
      <Modal
        title="批量填写 PT 编号"
        open={batchPtOpen}
        onOk={handleBatchPt}
        onCancel={() => { setBatchPtOpen(false); setBatchPtStart(""); }}
        width={400}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">输入起始数字即可（无需输入 PT 前缀），每个 Case 自动递增。同 Case 内自动加后缀 (W/H/HA...)</Text>
        </div>
        <Input
          prefix="PT"
          placeholder="如 00088"
          maxLength={6}
          value={batchPtStart}
          onChange={(e) => setBatchPtStart(e.target.value.replace(/\D/g, "").slice(0, 6))}
          style={{ fontFamily: "monospace" }}
        />
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">预览:</Text>
          {(() => {
            if (!batchPtStart.trim()) return null;
            const selected = data.filter((r) => selectedRowKeys.includes(r.key));
            const caseGroups = new Map<string, CaseSampleRow[]>();
            for (const row of selected) {
              if (!caseGroups.has(row.caseId)) caseGroups.set(row.caseId, []);
              caseGroups.get(row.caseId)!.push(row);
            }
            let ptNum = parseInt(batchPtStart.replace(/\D/g, "")) || 1;
            const prefix = batchPtStart.replace(/\d/g, "").trim() || "PT";
            const previews: string[] = [];
            for (const [, rows] of caseGroups) {
              const base = `${prefix}${String(ptNum).padStart(5, "0")}`;
              const names = rows.map((r) => {
                const fathers = rows.filter((x) => x.role === "ALLEGED_FATHER");
                return `${r.patientName}→${base}${generateSuffix(r.role, fathers, r.patientName)}`;
              });
              previews.push(...names);
              ptNum++;
            }
            return previews.map((p, i) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace" }}>{p}</div>);
          })()}
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        title={<Space><CloseOutlined style={{ color: "#ff4d4f" }} />不合格拒收: {rejectTarget?.patientName}</Space>}
        open={rejectModalOpen}
        onOk={handleRejectConfirm}
        onCancel={() => { setRejectModalOpen(false); setRejectTarget(null); setRejectReason(""); setRejectNote(""); }}
        okText="确认拒收"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !rejectReason }}
        width={420}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>样本名称</Text>
            <Text>{rejectTarget?.patientName}</Text>
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>签收人</Text>
            <Select
              placeholder="请选择签收人"
              style={{ width: "100%" }}
              size="middle"
              value={rejectTarget ? receiptPersons[rejectTarget.key] || undefined : undefined}
              onChange={(v) => rejectTarget && handlePersonChange(rejectTarget, v)}
              options={RECEIPT_PERSONS.map(name => ({ label: name, value: name }))}
            />
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>签收地</Text>
            <Select
              placeholder="请选择签收地"
              style={{ width: "100%" }}
              size="middle"
              value={rejectTarget ? receiptLocations[rejectTarget.key] || undefined : undefined}
              onChange={(v) => rejectTarget && handleLocationChange(rejectTarget, v)}
              options={RECEIPT_LOCATIONS}
            />
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>拒收原因</Text>
            <Select
              placeholder="请选择拒收原因"
              style={{ width: "100%" }}
              value={rejectReason || undefined}
              onChange={(v) => setRejectReason(v)}
              options={REJECT_REASONS.map(r => ({ label: r, value: r }))}
            />
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>备注（可选）</Text>
            <Input.TextArea
              rows={3}
              placeholder="请输入备注信息..."
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
          </div>
        </Space>
      </Modal>

      {/* 补录实收样本类型（实收比登记多出）*/}
      <Modal
        open={!!supTarget}
        title={supTarget ? `补录实收样本类型 — ${supTarget.patientName}（${supTarget.caseNumber}）` : ""}
        onCancel={() => { setSupTarget(null); setSupTypes([]); }}
        onOk={submitReceiptSupplement}
        confirmLoading={supLoading}
        okText="确认补录"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 4, padding: "8px 12px", fontSize: 12, color: "#874d00" }}>
            补录的样本将按「补样」登记并<span style={{ fontWeight: 600 }}>直接计为已签收</span>：
            登记人＝当前登录账号，签收人＝{supTarget ? (receiptPersons[supTarget.key] || "—") : "—"}，
            到样日期＝今天。已登记的类型不会重复建档。
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 6 }}>实际收到（未登记）的样本类型</Text>
            <Select
              mode="multiple"
              style={{ width: "100%" }}
              placeholder="选择实际收到但未登记的样本类型"
              value={supTypes}
              onChange={(v) => setSupTypes(v as string[])}
              options={SAMPLE_TYPE_OPTIONS.filter(
                (o) => !(supTarget?.personTypes || []).includes(o.value)
              )}
            />
            {!!supTarget &&
              SAMPLE_TYPE_OPTIONS.filter((o) => !(supTarget.personTypes || []).includes(o.value)).length === 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>该人的所有样本类型都已登记，无需补录</Text>
              )}
          </div>
        </Space>
      </Modal>
    </div>
  );
}
