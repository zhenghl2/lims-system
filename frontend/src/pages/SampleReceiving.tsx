// SampleReceiving.tsx — NIPPT Sample Receiving (TABLE layout restored)
// Table-based, PT auto-suffix, batch operations, filters
// Features: YYYY-MM-DD dates, 签收人 column, reject Modal, 已拒收 tab

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Table, Button, Tag, Input, Select, Space, Typography, message,
  Modal, Tabs, Row, Col, Image, Tooltip,
} from "antd";
import {
  CheckOutlined, CloseOutlined, CameraOutlined,
  ReloadOutlined, NumberOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text } = Typography;

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
];

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
  collectionNotes: string;
  status: string;
  image: string | null;
  ptBase: string;
  received: boolean;
  receivedAt: string;
  receivedByName: string;
  workflowStage: string;
  caseHasPhoto?: boolean;
}

// ===== 待签收编辑草稿（sessionStorage：路由切换保留，F5 清空）=====
const RECEIVING_DRAFT_KEY = "nippt_receiving_draft_v1";

interface ReceivingDraft {
  ptByCase: Record<string, string>;   // caseId -> PT 数字部分
  persons: Record<string, string>;    // rowKey -> 签收人
}

function loadReceivingDraft(): ReceivingDraft | null {
  try {
    const raw = sessionStorage.getItem(RECEIVING_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ptByCase: d?.ptByCase || {}, persons: d?.persons || {} };
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
  const [tabCounts, setTabCounts] = useState({ pending: 0, received: 0, rejected: 0 });
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [regTypeFilter, setRegTypeFilter] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Batch PT modal
  const [batchPtOpen, setBatchPtOpen] = useState(false);
  const [batchPtStart, setBatchPtStart] = useState("");
  const [batchPerson, setBatchPerson] = useState<string | undefined>(undefined);

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPhoto = useRef<{ caseId: string; csId: string } | null>(null);
  const [, setUploadingPhoto] = useState<string | null>(null);

  // Inline editing
  const [editingField, setEditingField] = useState<{ key: string; field: string } | null>(null);

  // Receipt person per row: key = rowKey, value = person name
  const [receiptPersons, setReceiptPersons] = useState<Record<string, string>>({});

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
      for (const cs of caseSamples) {
        const isMother = cs.role === "MOTHER";
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
          phone: c.phone || "",
          preservationMethod: cs.preservation_method || "",
          collectionNotes: c.notes || cs.collection_notes || "",
          status: cs.sample_status || "REGISTERED",
          workflowStage: cs.workflow_stage || "",
          image: cs.receipt_photo_url || null,
          ptBase: c.pt_number ? c.pt_number.replace(/^PT/i, "") : "",
          received: cs.received_at != null,
          receivedAt: cs.received_at || "",
          receivedByName: cs.received_by_name || "",
        });
      }
    }
    return rows;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 全量拉取一次 → 本地分类（Tab 计数与列表同源，永不失配）
      const params: any = { page_size: 500 };
      if (search.trim().length >= 2) params.search = search.trim();
      const _r = await (casesApi as any).list(params);
      const cases = _r.data?.results || [];
      let filtered = cases;
      if (sourceFilter) {
        filtered = filtered.filter((c: any) => c.sample_source === sourceFilter);
      }
      if (regTypeFilter) {
        filtered = filtered.filter((c: any) => c.registration_type === regTypeFilter);
      }
      const allRows = flatCases(filtered);
      // Tab 计数（跟随筛选，样本级）
      setTabCounts({
        pending: allRows.filter((r) => r.status === "REGISTERED").length,
        rejected: allRows.filter((r) => r.status === "REJECTED").length,
        received: allRows.filter((r) => r.workflowStage === "RECEIVED").length,
      });
      // 行级状态过滤：拒绝样本绝不出现于待签收/已签收 tab
      const rows = allRows.filter((r) => {
        if (activeTab === "pending") return r.status === "REGISTERED";
        if (activeTab === "rejected") return r.status === "REJECTED";
        // 已签收 = 仅待前处理（进前处理批次即隐藏，删批次回退后自动重现）
        return r.workflowStage === "RECEIVED";
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
  }, [activeTab, search, sourceFilter, regTypeFilter, flatCases]);

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
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {} };
    if (newPtBase) d.ptByCase[row.caseId] = newPtBase;
    else delete d.ptByCase[row.caseId];
    persistReceivingDraft(d);
  };

  /** 行级签收人变更 → 写入会话草稿 */
  const handlePersonChange = (row: CaseSampleRow, name?: string) => {
    setReceiptPersons((prev) => ({ ...prev, [row.key]: name || "" }));
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {} };
    if (name) d.persons[row.key] = name;
    else delete d.persons[row.key];
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
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {} };
    for (const row of selected) d.persons[row.key] = name;
    persistReceivingDraft(d);
    message.success(`已应用签收人「${name}」到 ${selected.length} 个样本`);
  };

  // 选中清空时重置批量签收人控件（便于下一批重新选择）
  useEffect(() => {
    if (selectedRowKeys.length === 0) setBatchPerson(undefined);
  }, [selectedRowKeys]);

  // --- 签收前置校验：PT 编号 + 图片（Case 级） ---
  const validateBeforeReceipt = (row: CaseSampleRow): string | null => {
    if (!receiptPersons[row.key]) return "请先选择签收人";
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
      const payload: any = { sample_id: row.sampleUuid, condition };
      if (row.ptBase) payload.pt_number = "PT" + row.ptBase;
      if (row.actualSampleType) payload.actual_sample_type = row.actualSampleType;
      if (row.preservationMethod) payload.preservation_method = row.preservationMethod;
      if (condition !== "OK") payload.rejection_note = rejectionNote;
      const personName = receiptPersons[row.key];
      if (personName) payload.received_by_name = personName;
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
              ? { ...r, received: true, status: "RECEIVED", receivedAt: rt, receivedByName: receiptPersons[row.key] || r.receivedByName }
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
    for (const row of selected) {
      try {
        const preErr = validateBeforeReceipt(row);
        if (preErr) {
          message.error(`${row.patientName}: ${preErr}`);
          continue;
        }
        const payload: any = { sample_id: row.sampleUuid, condition: "OK" };
        if (row.ptBase) payload.pt_number = "PT" + row.ptBase;
        if (row.actualSampleType) payload.actual_sample_type = row.actualSampleType;
        if (row.preservationMethod) payload.preservation_method = row.preservationMethod;
        const personName = receiptPersons[row.key];
        if (personName) payload.received_by_name = personName;
        await (casesApi as any).confirmReceipt(row.caseId, payload);
      } catch {
        message.error(`${row.patientName} 签收失败`);
      }
    }
    message.success("批量签收完成");
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
    const d = loadReceivingDraft() || { ptByCase: {}, persons: {} };
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

  // --- Inline field update ---
  const updateField = async (row: CaseSampleRow, field: string, value: string) => {
    setEditingField(null);
    setData((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, [field]: value } : r))
    );
    try {
      await (casesApi as any).update(row.caseId, {
        case_sample_id: row.csId,
        [field]: value,
      });
    } catch {
      // Silent fail
    }
  };

  // --- Columns ---
  const columns: any[] = [
    {
      title: "号", dataIndex: "caseNumber", key: "cn", width: 160,
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
      title: "外部编号", dataIndex: "externalId", key: "eid", width: 140, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ fontSize: 12, cursor: "default" }}>{v}</span></Tooltip>
          : <Text type="secondary">-</Text>,
    },
    {
      title: "PT编号", dataIndex: "testSampleId", key: "pt", width: 180,
      render: (v: string, r: CaseSampleRow) => (
        <Input
          size="small"
          value={r.ptBase}
          placeholder="输入数字"
          onChange={(e) => handlePtChange(r.key, e.target.value.replace(/\D/g, ""))}
          style={{ width: 135, fontFamily: "monospace" }}
          addonBefore="PT"
          addonAfter={<Text type="secondary" style={{ fontSize: 11 }}>{v ? v.replace("PT" + r.ptBase, "") : ""}</Text>}
        />
      ),
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
      title: "图片", dataIndex: "image", key: "img", width: 60,
      render: (v: string | null) =>
        v ? <Image src={v} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview /> : "—",
    },
    {
      title: "姓名", dataIndex: "patientName", key: "name", width: 180, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
          : <Text type="secondary">-</Text>,
    },
    {
      title: "孕周", dataIndex: "gestationalWeeks", key: "gw", width: 60,
      render: (v: number | null) => v ? `${v}w` : <Text type="secondary">—</Text>,
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
      title: "采集日期", dataIndex: "collectionDate", key: "cd", width: 110,
      render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "—",
    },
    {
      title: "样本来源", dataIndex: "sampleSource", key: "src", width: 90,
      render: (v: string) => v || "—",
    },
    {
      title: "销售/代理", dataIndex: "salesPerson", key: "sales", width: 100,
      render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: "快递", dataIndex: "fedexNo", key: "fx", width: 150, ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
          : "—",
    },
    {
      title: "手机", dataIndex: "phone", key: "ph", width: 110,
      render: (v: string) => v || "—",
    },
    {
      title: "登记备注", dataIndex: "collectionNotes", key: "notes", width: 140, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ color: "#d46b08", cursor: "default" }}>{v}</span></Tooltip> : "—",
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
      title: "操作", key: "act", width: 180, fixed: "right" as const,
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
            options={["国内", "泰国", "巴西", "巴西万基", "韩国", "澳洲", "CYJ印度", "CYJ澳洲", "CYJ秘鲁", "CYJ美国", "澳洲经销商", "西班牙代理", "西班牙巴塞罗那经销商", "YLH西班牙bygens", "YLH西班牙LABGENETICS"].map((v) => ({ value: v, label: v }))}
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
          <Button size="small" icon={<NumberOutlined />} onClick={() => setBatchPtOpen(true)}>批量填写PT</Button>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={batchReceive}>批量签收</Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => { setActiveTab(k); setSelectedRowKeys([]); }}
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
          return isCaseBoundary ? { className: "case-boundary-row" } : {};
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
    </div>
  );
}
