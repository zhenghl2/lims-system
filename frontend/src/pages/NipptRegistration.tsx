// NipptRegistration.tsx — NIPPT Sample Registration (重写版)
// 2026-07-21: Complete rewrite with 首次/补充/重采 support

import { useState, useEffect, useCallback } from "react";
import {
  Card, Form, Input, Select, AutoComplete, Button, message, Typography,
  Divider, Table, Tag, Modal, DatePicker, Row, Col,
  Radio, Space, Collapse, InputNumber, Upload,
  Checkbox, Descriptions, Tooltip,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, SendOutlined,
  SearchOutlined,
  CopyOutlined, InboxOutlined, SaveOutlined, FileExcelOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";

import { casesApi } from "../api";
import { REPORT_VERSION_PRESETS, fetchReportVersions } from "../utils/reportVersions";
import dayjs from "dayjs";
import SmartDateInput from "../components/SmartDateInput";

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

const SOURCE_OPTIONS = [
  { value: "国内", label: "国内" },
  { value: "中国香港", label: "中国香港" },
  { value: "泰国", label: "泰国" },
  { value: "巴西", label: "巴西" },
  { value: "巴西万基", label: "巴西万基" },
  { value: "越南", label: "越南" },
  { value: "韩国", label: "韩国" },
  { value: "阿联酋", label: "阿联酋" },
  { value: "北马其顿", label: "北马其顿" },
  { value: "马来西亚", label: "马来西亚" },
  { value: "CYJ印度", label: "CYJ印度" },
  { value: "CYJ澳洲", label: "CYJ澳洲" },
  { value: "CYJ秘鲁", label: "CYJ秘鲁" },
  { value: "CYJ美国", label: "CYJ美国" },
  { value: "CYJ西班牙", label: "CYJ西班牙" },
  { value: "CYJ加纳", label: "CYJ加纳" },
  { value: "CYJ马来西亚", label: "CYJ马来西亚" },
  { value: "西班牙代理", label: "西班牙代理" },
  { value: "西班牙巴塞罗那经销商", label: "西班牙巴塞罗那经销商" },
  { value: "YLH西班牙bygens", label: "YLH西班牙bygens" },
  { value: "YLH西班牙LABGENETICS", label: "YLH西班牙LABGENETICS" },
  { value: "YLH墨西哥经销商", label: "YLH墨西哥经销商" },
  { value: "YLH新加坡经销商", label: "YLH新加坡经销商" },
];

// ===== 草稿保存（localStorage）=====
const DRAFT_KEY = "nippt_reg_draft_v1";
const DATE_FIELDS = ["female_arrival_date", "last_menstrual_period", "collection_date", "report_deadline"];

function saveDraft(values: any): { values: any; savedAt: string } {
  const snapshot = JSON.parse(JSON.stringify(values ?? {}));
  // dayjs 对象序列化为 YYYY-MM-DD
  DATE_FIELDS.forEach((k) => {
    if (snapshot[k]) snapshot[k] = dayjs(snapshot[k]).format("YYYY-MM-DD");
  });
  if (Array.isArray(snapshot.males)) {
    snapshot.males = snapshot.males.map((m: any) => ({
      ...m,
      arrival_date: m?.arrival_date ? dayjs(m.arrival_date).format("YYYY-MM-DD") : undefined,
      report_deadline: m?.report_deadline ? dayjs(m.report_deadline).format("YYYY-MM-DD") : undefined,
    }));
  }
  const payload = { values: snapshot, savedAt: new Date().toISOString() };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  return payload;
}

function loadDraft(): { values: any; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.values) return null;
    // 日期字符串 → dayjs
    DATE_FIELDS.forEach((k) => {
      if (data.values[k]) data.values[k] = dayjs(data.values[k]);
    });
    if (Array.isArray(data.values.males)) {
      data.values.males = data.values.males.map((m: any) => ({
        ...m,
        arrival_date: m?.arrival_date ? dayjs(m.arrival_date) : undefined,
        report_deadline: m?.report_deadline ? dayjs(m.report_deadline) : undefined,
      }));
    }
    return data;
  } catch {
    return null;
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

// 汇总显示工具
const CM_LABEL: Record<string, string> = { "1": "1. 本室采集", "2": "2. 申请人送来", "3": "3. 邮寄样本" };
const SIGNED_LABEL: Record<string, string> = { YES: "是", NO: "否", WECHAT: "微信授权" };
const RISK_LABELS: [string, string][] = [
  ["transfusion", "异体输血(一年内)"], ["transplant", "骨髓/器官移植(一年内)"],
  ["immunotherapy", "免疫/干细胞治疗(一个月内)"], ["miscarriage", "流产史(三个月内)"],
  ["reduction", "减胎"], ["surrogacy", "代孕"], ["ivf", "试管婴儿"],
  ["week5_under", "孕期未满5周"], ["week5", "孕期已满5周（旧记录）"],
];

export default function NipptRegistration() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [regType, setRegType] = useState<string>("FIRST");
  const [ptSearch, setPtSearch] = useState("");
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  // Recent cases
  const [recentCases, setRecentCases] = useState<any[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);

  // 草稿汇总快照
  const [draftSummary, setDraftSummary] = useState<{ values: any; savedAt: string } | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);

  // Token modal
  const [tokenModal, setTokenModal] = useState<{
    open: boolean; url: string; expires: string; caseNumber: string;
  } | null>(null);

  // Resample target select
  const [resampleTarget, setResampleTarget] = useState<string | null>(null);

  // ── 巴西导入 ──
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importChecked, setImportChecked] = useState<Set<string>>(new Set());
  const [importExisting, setImportExisting] = useState<Set<string>>(new Set());
  const [importKindMap, setImportKindMap] = useState<Record<string, { kind: string; case_number?: string }>>({});
  const [importNiptSkipped, setImportNiptSkipped] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importNiptFiles, setImportNiptFiles] = useState<any[]>([]);
  const [importErrorFiles, setImportErrorFiles] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<any>(null);

  // ── 国内导入 ──
  const [cnRows, setCnRows] = useState<any[]>([]);
  const [cnChecked, setCnChecked] = useState<Set<number>>(new Set());
  const [cnExisting, setCnExisting] = useState<any[]>([]);
  const [cnErrors, setCnErrors] = useState<any[]>([]);
  const [cnFileName, setCnFileName] = useState("");
  const [cnLoading, setCnLoading] = useState(false);
  const [cnResult, setCnResult] = useState<any>(null);
  const [vnRows, setVnRows] = useState<any[]>([]);
  const [vnChecked, setVnChecked] = useState<Set<number>>(new Set());
  const [vnExisting, setVnExisting] = useState<any[]>([]);
  const [vnErrors, setVnErrors] = useState<any[]>([]);
  const [vnFileName, setVnFileName] = useState("");
  const [vnLoading, setVnLoading] = useState(false);
  const [vnResult, setVnResult] = useState<any>(null);

  useEffect(() => { refreshCases(); }, []);

  const refreshCases = useCallback(() => {
    setCasesLoading(true);
    (casesApi as any).list({ limit: 20, ordering: "-created_at" })
      .then((r: any) => { setRecentCases(r.data?.results || []); })
      .catch(() => {})
      .finally(() => setCasesLoading(false));
  }, []);

  // Search PT number for supplement/resample
  const handlePtSearch = async () => {
    if (!ptSearch.trim()) return;
    setSearching(true);
    try {
      const res = await (casesApi as any).list({ search: ptSearch.trim(), limit: 5 });
      const results = res.data?.results || [];
      if (results.length === 1) {
        const detail = await (casesApi as any).get(results[0].id);
        setSelectedCase(detail.data);
        fillCaseInfo(detail.data);
      } else if (results.length > 1) {
        // Show selection modal (simplified: pick first match)
        const detail = await (casesApi as any).get(results[0].id);
        setSelectedCase(detail.data);
        fillCaseInfo(detail.data);
      } else {
        message.warning("未找到匹配的 PT 号");
        setSelectedCase(null);
      }
    } catch {
      message.error("搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const [reportVersionOpts, setReportVersionOpts] = useState<string[]>(REPORT_VERSION_PRESETS);

  useEffect(() => {
    fetchReportVersions().then(setReportVersionOpts).catch(() => {});
  }, []);

  const fillCaseInfo = (caseData: any) => {
    form.setFieldsValue({
      sales_person: caseData.sales_person || "",
      clinic_name: caseData.clinic_name || "",
      applicant: caseData.applicant || "",
      report_version: caseData.report_version || "",
      notes: caseData.notes || "",
    });
  };

  // Generate token
  const handleGenerateToken = async (id: string, caseNumber: string) => {
    try {
      const res = await (casesApi as any).generateToken(id);
      setTokenModal({
        open: true,
        url: res.data.url,
        expires: res.data.expires,
        caseNumber,
      });
    } catch {
      message.error("Failed to generate token");
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => message.success("Link copied!"));
  };

  // ── 国内导入 handlers ──
  const handleCnImportFiles = async (files: File[]) => {
    if (!files || !files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setCnLoading(true);
    try {
      const res = await (casesApi as any).parseCnDocs(fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const d = res.data;
      const rows = d.cases || [];
      setCnRows(rows);
      setCnErrors(d.errors || []);
      setCnFileName(files.map((f) => f.name).join("、"));
      const existingRows = new Set((d.existing_info || []).map((e: any) => e.row_no));
      setCnExisting(d.existing_info || []);
      setCnChecked(new Set(rows.filter((r: any) => !existingRows.has(r.row_no)).map((r: any) => r.row_no)));
      setCnResult(null);
    } catch (e: any) {
      message.error("解析失败: " + (e?.response?.data?.detail || e?.message || "未知错误"));
    } finally {
      setCnLoading(false);
    }
  };

  const handleCnImportSubmit = async () => {
    const selected = cnRows.filter((r) => cnChecked.has(r.row_no));
    if (!selected.length) { message.warning("请先勾选要导入的行"); return; }
    setCnLoading(true);
    try {
      const res = await (casesApi as any).batchImportCn({ cases: selected });
      const d = res.data;
      const createdCount = d.created_count ?? 0;
      const skippedCount = d.skipped_count ?? 0;
      const errCount = d.error_count ?? 0;
      if (errCount > 0 || skippedCount > 0) {
        message.warning(`导入完成：成功 ${createdCount}，跳过 ${skippedCount}，失败 ${errCount}（详见下方结果）`);
      } else {
        message.success(`导入成功 ${createdCount} 个Case`);
      }
      setCnResult(d);
      // 成功行从预览表移除
      const doneRows = new Set((d.created || []).map((c: any) => c.row_no));
      setCnRows((prev: any[]) => prev.filter((r: any) => !doneRows.has(r.row_no)));
      setCnChecked((prev) => { const n = new Set(prev); doneRows.forEach((rn) => n.delete(rn as number)); return n; });
    } catch (e: any) {
      message.error("导入失败: " + (e?.response?.data?.detail || e?.message || "未知错误"));
    } finally {
      setCnLoading(false);
    }
  };

  // ── 越南导入 handlers ──
  /** 上传前预检文件头：openpyxl 对 .xls/空/其它格式都只报同一句「不是 zip 文件」，
   *  这里先按文件头给出精确原因，避免用户看到看不懂的报错。返回可上传的文件。 */
  const vnPrecheckFiles = async (files: File[]): Promise<File[]> => {
    const good: File[] = [];
    for (const f of files) {
      try {
        const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
        const hex = Array.from(head).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const isZip = head[0] === 0x50 && head[1] === 0x4b;   // PK → xlsx/xlsm
        const isOle = head[0] === 0xd0 && head[1] === 0xcf;   // OLE2 → 老版 .xls
        if (isZip) { good.push(f); continue; }
        if (isOle) {
          message.error(`「${f.name}」是 Excel 97-2003 格式（.xls）：越南导入只支持 .xlsx，请用 Excel/WPS 打开后「另存为 → Excel 工作簿 (*.xlsx)」再上传`);
        } else if (f.size === 0) {
          message.error(`「${f.name}」内容为空（0 字节）：可能只是快捷方式/别名，或拖拽时没有真正读取到文件`);
        } else {
          message.error(`「${f.name}」不是 Excel 文件（文件头 ${hex}，大小 ${f.size} 字节）：可能只是快捷方式/别名，或文件已损坏`);
        }
      } catch (e) {
        good.push(f);   // 读不出头部就交给服务端判断
      }
    }
    return good;
  };

  const handleVnImportFiles = async (files: File[]) => {
    if (!files || !files.length) return;
    files = await vnPrecheckFiles(files);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setVnLoading(true);
    try {
      const res = await (casesApi as any).parseVnDocs(fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const d = res.data;
      const rows = d.cases || [];
      setVnRows(rows);
      setVnErrors(d.errors || []);
      setVnFileName(files.map((f) => f.name).join("、"));
      const existingRows = new Set((d.existing_info || []).map((e: any) => e.row_no));
      setVnExisting(d.existing_info || []);
      setVnChecked(new Set(rows.filter((r: any) => !existingRows.has(r.row_no)).map((r: any) => r.row_no)));
      setVnResult(null);
    } catch (e: any) {
      message.error("解析失败: " + (e?.response?.data?.detail || e?.message || "未知错误"));
    } finally {
      setVnLoading(false);
    }
  };

  const handleVnImportSubmit = async () => {
    const selected = vnRows.filter((r) => vnChecked.has(r.row_no));
    if (!selected.length) { message.warning("请先勾选要导入的行"); return; }
    setVnLoading(true);
    try {
      const res = await (casesApi as any).batchImportVn({ cases: selected });
      const d = res.data;
      const createdCount = d.created_count ?? 0;
      const skippedCount = d.skipped_count ?? 0;
      const errCount = d.error_count ?? 0;
      if (errCount > 0 || skippedCount > 0) {
        message.warning(`导入完成：成功 ${createdCount}，跳过 ${skippedCount}，失败 ${errCount}（详见下方结果）`);
      } else {
        message.success(`导入成功 ${createdCount} 个Case`);
      }
      setVnResult(d);
      const doneRows = new Set((d.created || []).map((c: any) => c.row_no));
      setVnRows((prev: any[]) => prev.filter((r: any) => !doneRows.has(r.row_no)));
      setVnChecked((prev) => { const n = new Set(prev); doneRows.forEach((rn) => n.delete(rn as number)); return n; });
    } catch (e: any) {
      message.error("导入失败: " + (e?.response?.data?.detail || e?.message || "未知错误"));
    } finally {
      setVnLoading(false);
    }
  };

  const handleImportFiles = async (files: File[]) => {
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setImportLoading(true);
    try {
      const res = await (casesApi as any).parseNipptDocs(fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const d = res.data;
      setImportRows(d.cases || []);
      setImportNiptSkipped(d.nipt_count ?? d.nipt_files?.length ?? 0);
      setImportNiptFiles(d.nipt_files || []);
      setImportErrorFiles(d.error_files || []);
      setImportFileName(files.map((f) => f.name).join("、"));
      setImportExisting(new Set(d.existing || []));
      const kindMap: Record<string, { kind: string; case_number?: string }> = {};
      for (const ei of (d.existing_info || [])) kindMap[ei.seq] = { kind: ei.kind, case_number: ei.case_number };
      setImportKindMap(kindMap);
      const existingSet = new Set<string>(d.existing || []);
      const supSeqs = (d.existing_info || [])
        .filter((e: any) => e.kind && e.kind !== "DUPLICATE")
        .map((e: any) => e.seq);
      setImportChecked(new Set([
        ...(d.cases || []).map((r: any) => r.seq).filter((sq: string) => !existingSet.has(sq)),
        ...supSeqs,
      ]));
      setImportResult(null);
      if (d.error_count > 0) {
        message.warning(`解析完成：${d.case_count} 个Case，${d.nipt_count ?? 0} 个NIPT跳过，${d.error_count} 个文件解析失败`);
      } else {
        message.success(`解析完成：${d.case_count} 个Case${d.nipt_count ? `，${d.nipt_count} 个NIPT跳过` : ""}`);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "解析失败");
    } finally {
      setImportLoading(false);
    }
    return false;
  };

  const handleImportSubmit = async () => {
    if (importChecked.size === 0) { message.warning("请先勾选要导入的行"); return; }
    const selected = importRows.filter((r) => importChecked.has(r.seq)).map((r: any) => {
      const info = importKindMap[r.seq];
      if (!info) return r;
      return { ...r, merge_kind: info.kind === "DUPLICATE" ? "FORCE" : info.kind };
    });
    setImportLoading(true);
    try {
      const res = await (casesApi as any).batchImportNippt({ cases: selected });
      const d = res.data;
      const createdCount = d.created_count ?? d.created?.length ?? 0;
      const skippedCount = d.skipped_count ?? d.skipped?.length ?? 0;
      const errCount = d.error_count ?? d.errors?.length ?? 0;
      const mergedCount = d.merged_count ?? d.merged?.length ?? 0;
      if (errCount > 0) {
        message.warning(`导入完成：成功 ${createdCount}，合并 ${mergedCount}，跳过 ${skippedCount}，失败 ${errCount}（详见下方结果）`);
        setImportResult(d);
        refreshCases();
      } else {
        message.success(`导入成功 ${createdCount} 个Case${mergedCount > 0 ? `，合并 ${mergedCount} 个补样` : ""}${skippedCount > 0 ? `，跳过 ${skippedCount}` : ""}`);
        // 成功才清空
        setImportRows([]);
        setImportFileName("");
        setImportChecked(new Set());
        setImportResult(null);
        setImportNiptFiles([]);
        setImportErrorFiles([]);
        refreshCases();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "导入失败");
    } finally {
      setImportLoading(false);
    }
  };

  // 自动恢复草稿：页面挂载或切回「首次检测」时（regType 变化触发）
  useEffect(() => {
    if (regType !== "FIRST") return;
    const draft = loadDraft();
    if (draft && draft.values && Object.keys(draft.values).length > 0) {
      form.setFieldsValue(draft.values);
      const t = dayjs(draft.savedAt).format("HH:mm");
      message.info(`已恢复未提交的草稿（保存于 ${t}）`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regType]);

  // 保存草稿
  const handleSaveDraft = () => {
    const values = form.getFieldsValue();
    const payload = saveDraft(values);
    setDraftSummary(payload);
    setSummaryVisible(true);
    message.success(`草稿已保存 ${dayjs().format("HH:mm:ss")}`);
  };

  // Submit registration
  const handleSubmit = async () => {
    const values = await form.validateFields();
    // 首次登记：至少一个样本（孕妇或任一男性姓名）
    if (regType === "FIRST") {
      const hasMother = !!(values.mother_name || "").trim();
      const hasMale = (values.males || []).some((m: any) => (m?.name || "").trim());
      if (!hasMother && !hasMale) {
        message.warning("请至少填写一个样本（孕妇或男性姓名）");
        return;
      }
    }
    setLoading(true);
    try {
      if (regType === "FIRST") {
        const payload: any = {
          mother_name: values.mother_name || "",
          mother_dob: values.mother_dob ? dayjs(values.mother_dob).format("YYYY-MM-DD") : undefined,
          father_names: (values.males || []).map((m: any) => m.name).filter(Boolean),
          father_dobs: (values.males || []).map((m: any) => m.dob ? dayjs(m.dob).format("YYYY-MM-DD") : null),
          father_sample_types: (values.males || []).map((m: any) => m.sample_type || ["BLOOD"]),
          gestational_age_weeks: values.gestational_age_weeks,
          gestational_age_days: values.gestational_age_days,
          clinic_name: values.clinic_name,
          sales_person: values.sales_person,
          report_version: (values.report_version || "").trim(),
          applicant: values.applicant,
          phone: values.phone,
          email: values.email,
          multiple_gestation: values.multiple_gestation === undefined ? null : values.multiple_gestation,
          risk_warnings: values.risk ? Object.entries(values.risk).filter(([_, v]) => v).map(([k]) => k) : [],
          registration_type: "FIRST",
          sample_source: (values.sample_source || "").trim(),
          collection_method: values.collection_method,
          application_signed: values.application_signed || "",
          expected_completion: values.report_deadline
            ? dayjs(values.report_deadline).format("YYYY-MM-DD")
            : ((values.males || []).map((m: any) => m.report_deadline)
                .filter(Boolean).map((d: any) => dayjs(d).format("YYYY-MM-DD"))[0] || undefined),
          external_id: values.external_id,
          fedex_no: values.fedex_no,
          female_arrival_date: values.female_arrival_date
            ? dayjs(values.female_arrival_date).format("YYYY-MM-DD") : undefined,
          male_arrival_dates: (values.males || []).map((m: any) =>
            m.arrival_date ? dayjs(m.arrival_date).format("YYYY-MM-DD") : null
          ).filter(Boolean),
          last_menstrual_period: values.last_menstrual_period
            ? dayjs(values.last_menstrual_period).format("YYYY-MM-DD") : undefined,
          // 申请日期：字段名用 application_date（后端 2026-10-15 新增）。
          // 此前叫 collection_date 但后端不收、会被丢弃并写死 today，导致用户选的日期从未生效。
          application_date: values.collection_date
            ? dayjs(values.collection_date).format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"),
          // 计算方式 / 双胎类型（2026-10-15 三端打通）
          calculation_method: values.calculation_method || "",
          twin_type: values.multiple_gestation === true ? (values.twin_type || "") : "",
          notes: values.notes,
          is_urgent: values.is_urgent === true,
          gender_info: values.gender_info || "",          // 额外信息（Yes/No，2026-10-13）
        };
        const res = await (casesApi as any).create(payload);
        message.success(`Case ${res.data.case_number} created`);
      } else if (regType === "SUPPLEMENT" && selectedCase) {
        // ── 女性已有 / 男性同名 → 可能是重采误登记，弹窗确认（用户 2026-10-13）──
        const suppRole = values.supp_role;
        const suppName = (values.supp_name || "").trim();
        const existSamples = ((selectedCase as any).case_samples || []).filter(
          (x: any) => x.is_active !== false
        );
        const hit = suppRole === "MOTHER"
          ? existSamples.find((x: any) => x.role === "MOTHER")
          : (suppName
              ? existSamples.find((x: any) => x.role !== "MOTHER"
                  && (x.patient_name || "").trim() === suppName)
              : undefined);
        let resampleDone = false;
        if (hit) {
          const isMother = suppRole === "MOTHER";
          const goResample = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: "可能是重采误登记",
              width: 540,
              content: (
                <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                  {isMother ? "该案例已有女性样本" : "该案例已有同名男士样本"}{" "}
                  <Text strong>{hit.test_sample_id || "（待签收编号）"}</Text>
                  {((hit as any).sample_status_display || (hit as any).sample_status)
                    ? <>（{(hit as any).sample_status_display || (hit as any).sample_status}）</> : null}
                  。<br />
                  若是同一人重新取样，应登记为 <b>重采</b>
                  （编号自动变成 <Text code>{hit.test_sample_id ? `${hit.test_sample_id}_R1` : "PTxxxx_R1"}</Text>）。
                  <br />是否按 <b>重采</b> 登记？
                </div>
              ),
              okText: "按重采登记",
              cancelText: "仍按补样",
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
          if (goResample) {
            const rr = await (casesApi as any).resample?.(selectedCase.id, {
              case_sample_id: hit.id,
              patient_name: hit.patient_name || values.supp_name,
              sample_source: values.supp_sample_type || ["BLOOD"],
              arrival_date: values.supp_arrival_date
                ? dayjs(values.supp_arrival_date).format("YYYY-MM-DD") : undefined,
              notes: values.supp_notes || "",
              gestational_age_weeks: isMother ? (values.supp_ga_weeks ?? null) : null,
              gestational_age_days: isMother ? (values.supp_ga_days ?? null) : null,
            });
            message.success(`已按重采登记：${rr.data?.test_sample_id || ""}`);
            resampleDone = true;
          }
        }
        if (resampleDone) {
          // 已按重采处理，跳过补样提交；后续统一走表单清理
        } else {
        // 补充样本：极简表单一键提交
        await (casesApi as any).supplement?.(selectedCase.id, {
          role: values.supp_role,
          patient_name: values.supp_name,
          sample_types: values.supp_sample_type || ["BLOOD"],
          arrival_date: values.supp_arrival_date
            ? dayjs(values.supp_arrival_date).format("YYYY-MM-DD") : undefined,
          notes: values.supp_notes || "",
          gestational_age_weeks: values.supp_ga_weeks ?? null,
          gestational_age_days: values.supp_ga_days ?? null,
          multiple_gestation: values.supp_mg === "KEEP" ? null
            : values.supp_mg === "TRUE" ? true
            : values.supp_mg === "FALSE" ? false : null,
        });
        message.success(`补充样本成功`);
        }
      } else if (regType === "RESAMPLE" && selectedCase && resampleTarget) {
        // 重采样本：新填值 + 到样日期
        const cs = selectedCase.case_samples?.find((s: any) => s.id === resampleTarget);
        const isMother = cs?.role === "MOTHER";
        const res = await (casesApi as any).resample?.(selectedCase.id, {
          case_sample_id: resampleTarget,
          patient_name: cs?.patient_name || "",
          sample_source: values.re_sample_type || ["BLOOD"],
          arrival_date: values.re_arrival_date
            ? dayjs(values.re_arrival_date).format("YYYY-MM-DD") : undefined,
          notes: values.re_notes || "",
          gestational_age_weeks: isMother ? (values.re_ga_weeks ?? null) : null,
          gestational_age_days: isMother ? (values.re_ga_days ?? null) : null,
        });
        message.success(`重采样本已创建: ${res.data?.test_sample_id || ""}`);
      }

      form.resetFields();
      clearDraft();
      setDraftSummary(null);
      setSummaryVisible(false);
      setSelectedCase(null);
      setPtSearch("");
      setResampleTarget(null);
      refreshCases();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || JSON.stringify(e?.response?.data) || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const caseColumns = [
    { title: "Case #", dataIndex: "case_number", key: "cn", width: 180,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: "PT No.", dataIndex: "pt_number", key: "pt", width: 100,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : "-" },
    { title: "Samples", dataIndex: "sample_count", key: "sc", width: 70 },
    { title: "Status", dataIndex: "status", key: "st", width: 120,
      render: (s: string) => {
        const m: Record<string, string> = { REGISTERED: "blue", DRAFT: "default", RECEIVING: "cyan", IN_PROCESS: "orange", COMPLETED: "green" };
        return <Tag color={m[s] || "default"}>{s}</Tag>;
      } },
    { title: "Created", dataIndex: "created_at", key: "ca", width: 130,
      render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-" },
    { title: "Action", key: "act", width: 130,
      render: (_: any, r: any) => (
        <Button type="primary" size="small" icon={<SendOutlined />}
          onClick={() => handleGenerateToken(r.id, r.case_number)}>
          Generate Link
        </Button>
      ) },
  ];

  return (
    <div>
      {/* Registration Type Selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Radio.Group value={regType} onChange={(e) => {
          setRegType(e.target.value);
          form.resetFields();
          setSelectedCase(null);
          setPtSearch("");
          setResampleTarget(null);
        }} buttonStyle="solid" size="middle">
          <Radio.Button value="FIRST">首次检测</Radio.Button>
          <Radio.Button value="SUPPLEMENT">补充样本</Radio.Button>
          <Radio.Button value="RESAMPLE">重采样本</Radio.Button>
          <Radio.Button value="IMPORT">巴西导入</Radio.Button>
          <Radio.Button value="IMPORT_CN">国内导入</Radio.Button>
          <Radio.Button value="IMPORT_VN">越南导入</Radio.Button>
        </Radio.Group>

        {/* PT Search for supplement/resample */}
        {(regType === "SUPPLEMENT" || regType === "RESAMPLE") && (
          <div style={{ marginTop: 12 }}>
            <Space>
              <Input.Search
                placeholder="输入 PT 号搜索已有案例"
                value={ptSearch}
                onChange={(e) => setPtSearch(e.target.value)}
                onSearch={handlePtSearch}
                loading={searching}
                style={{ width: 280 }}
                enterButton={<><SearchOutlined /> 搜索</>}
              />
              {selectedCase && (
                <Tag color="green">
                  已选择: {selectedCase.case_number} ({selectedCase.pt_number})
                </Tag>
              )}
            </Space>
          </div>
        )}
      </Card>

      {/* === 首次检测：完整登记表单 === */}
      {regType === "FIRST" && (
        <Card size="small" style={{ borderRadius: 8 }}>
          <Form form={form} layout="vertical" size="small"
            initialValues={{
              males: [{ sample_type: ["BLOOD"] }],
              mother_sample_type: ["BLOOD"],
              female_arrival_date: dayjs(),
            }}>

            {/* 1 样本来源 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</span>
              <Text strong style={{ fontSize: 15 }}>样本来源</Text>
            </div>
            <div style={{ marginBottom: 8, color: "#999", fontSize: 11, marginLeft: 32 }}>
              1. 本室工作人员采集；2. 申请人送来；3. 邮寄样本
            </div>
            <Form.Item name="collection_method" style={{ marginLeft: 32, marginBottom: 0 }} initialValue="3">
              <Radio.Group>
                <Radio value="1">1. 本室采集</Radio>
                <Radio value="2">2. 申请人送来</Radio>
                <Radio value="3">3. 邮寄样本</Radio>
              </Radio.Group>
            </Form.Item>
            <Row gutter={[16, 0]} style={{ marginLeft: 32, marginTop: 12 }}>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="sample_source"
                  label="来源(国家)"
                  style={{ marginBottom: 8 }}
                  rules={[{
                    validator: (_: any, v: any) => {
                      const s = String(v ?? "").trim();
                      if (!s) return Promise.reject(new Error("必填"));
                      if (s.length > 50) return Promise.reject(new Error("来源最多 50 个字符"));
                      return Promise.resolve();
                    },
                  }]}
                >
                  <AutoComplete
                    options={SOURCE_OPTIONS}
                    allowClear
                    size="small"
                    style={{ width: "100%" }}
                    filterOption={(input, option) => String((option as any)?.value ?? "").includes(input)}
                  >
                    <Input size="small" placeholder="选择或输入来源国家" />
                  </AutoComplete>
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="clinic_name" label="诊所/医院" style={{ marginBottom: 8 }}>
                  <Input placeholder="诊所或医院名称" size="small" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="applicant" label="申请方" style={{ marginBottom: 8 }}>
                  <Input placeholder="申请方" size="small" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="collection_date" label="申请日期" style={{ marginBottom: 8 }}>
                  <DatePicker style={{ width: "100%" }} size="small" placeholder="选择日期" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="phone" label="电话" style={{ marginBottom: 8 }}>
                  <Input placeholder="电话号码" size="small" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="application_signed" label="申请单是否签字" style={{ marginBottom: 0 }}>
                  <Radio.Group size="small">
                    <Radio value="YES">是</Radio>
                    <Radio value="NO">否</Radio>
                    <Radio value="WECHAT">微信授权</Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="is_urgent" label="加急" style={{ marginBottom: 0 }}>
                  <Radio.Group size="small">
                    <Radio value={true}>是</Radio>
                    <Radio value={false}>否</Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: "8px 0" }} />

            {/* 2 样本信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</span>
              <Text strong style={{ fontSize: 15 }}>样本信息</Text>
            </div>

                        {/* Single unified table — perfect alignment */}
            {/* Mother row — OUTSIDE Form.List, never re-renders when males change */}
            <Table
              dataSource={[{ key: "mother" }]}
              pagination={false}
              size="small"
              rowKey="key"
              showHeader={true}
              style={{ marginLeft: 32, marginBottom: 0 }}
              columns={[
                { title: "采集日期", width: 140,
                  render: () => (
                    <Form.Item name="female_arrival_date" style={{ margin: 0 }}>
                      <DatePicker size="small" bordered={false}
                        style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                    </Form.Item>
                  ) },
                { title: "亲缘关系", dataIndex: "r", width: 90,
                  render: () => <Text strong style={{ fontSize: 13 }}>孕妇</Text> },
                { title: "姓名", width: 120,
                  render: () => (
                    <Form.Item name="mother_name" style={{ margin: 0 }}>
                      <Input placeholder="孕妇姓名" size="small" bordered={false}
                        style={{ background: "#fafafa", borderRadius: 0 }} />
                    </Form.Item>
                  ) },
                { title: "出生日期", width: 130,
                  render: () => (
                    <Form.Item name="mother_dob" style={{ margin: 0 }}>
                      {/* 2026-10-21：可直接输入 14.01.2005 / 27 Feb 1997，右侧日历仍可点选 */}
                      <SmartDateInput size="small" bordered={false} />
                    </Form.Item>
                  ) },
                { title: "民族", width: 100,
                  render: () => (
                    <Form.Item name="mother_ethnicity" style={{ margin: 0 }}>
                      <Input placeholder="民族" size="small" bordered={false}
                        style={{ background: "#fafafa", borderRadius: 0 }} />
                    </Form.Item>
                  ) },
                { title: "样本类型", width: 180,
                  render: () => <Tag color="blue" style={{ margin: 0, fontSize: 12 }}>血液</Tag> },
                { title: "报告截止日期", width: 140,
                  render: () => (
                    <Form.Item name="report_deadline" style={{ margin: 0 }}>
                      <DatePicker size="small" bordered={false}
                        style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                    </Form.Item>
                  ) },
                { title: "操作", width: 60, render: () => null },
              ] as any}
              locale={{ emptyText: "" }}
            />

            {/* Male rows — inside Form.List */}
            <Form.List name="males">
              {(fields, { add, remove }) => (
                <Table
                  dataSource={fields.map((f, i) => ({
                    key: f.key,
                    role: fields.length > 1 ? `疑父${i + 1}` : "疑父",
                    maleIndex: i, field: f,
                  }))}
                  pagination={false}
                  size="small"
                  rowKey="key"
                  showHeader={false}
                  style={{ marginLeft: 32 }}
                  columns={[
                    { title: "", width: 140,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "arrival_date"]} style={{ margin: 0 }}
                          initialValue={dayjs()}>
                          <DatePicker size="small" bordered={false}
                            style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                        </Form.Item>
                      ) },
                    { title: "", width: 90,
                      render: (_r: any, row: any) => <Text strong style={{ fontSize: 13 }}>{row.role}</Text> },
                    { title: "", width: 120,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "name"]} style={{ margin: 0 }}>
                          <Input placeholder="姓名" size="small" bordered={false}
                            style={{ background: "#fafafa", borderRadius: 0 }} />
                        </Form.Item>
                      ) },
                    { title: "", width: 130,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "dob"]} style={{ margin: 0 }}>
                          {/* 2026-10-21：同母亲，支持手输识别 */}
                          <SmartDateInput size="small" bordered={false} />
                        </Form.Item>
                      ) },
                    { title: "", width: 100,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "ethnicity"]} style={{ margin: 0 }}>
                          <Input placeholder="民族" size="small" bordered={false}
                            style={{ background: "#fafafa", borderRadius: 0 }} />
                        </Form.Item>
                      ) },
                    { title: "", width: 180,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "sample_type"]} style={{ margin: 0 }}
                          initialValue={["BLOOD"]}>
                          <Select mode="multiple" options={SAMPLE_TYPE_OPTIONS}
                            size="small" bordered={false}
                            style={{ background: "#fafafa", minWidth: 110, borderRadius: 0 }}
                            placeholder="类型" maxTagCount={5} />
                        </Form.Item>
                      ) },
                    { title: "", width: 140,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "report_deadline"]} style={{ margin: 0 }}>
                          <DatePicker size="small" bordered={false}
                            style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                        </Form.Item>
                      ) },
                    { title: "", width: 60,
                      render: (_r: any, row: any) => (
                        <Button type="link" danger size="small"
                          onClick={() => remove(row.field.name)}>删除</Button>
                      ) },
                  ] as any}
                  locale={{ emptyText: "" }}
                  footer={() => (
                    <div style={{ padding: "6px 8px" }}>
                      <Button type="dashed" onClick={() => add({ sample_type: ["BLOOD"], arrival_date: dayjs() })} block
                        icon={<PlusOutlined />} size="small">
                        添加疑父
                      </Button>
                    </div>
                  )}
                />
              )}
            </Form.List>

<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</span>
              <Text strong style={{ fontSize: 15 }}>基本信息</Text>
            </div>

            <Row gutter={[16, 8]} style={{ marginLeft: 16 }}>
              <Col xs={24} sm={12}>
                <Form.Item name="sales_person" label="销售/代理" style={{ marginBottom: 8 }}>
                  <Input placeholder="销售或代理名称" size="small" />
                </Form.Item>
                <Form.Item name="report_version" label="报告版本" style={{ marginBottom: 8 }}
                  tooltip="决定出报告用哪个模板（后续支持自动生成时生效）；可直接输入新版本">
                  <AutoComplete
                    size="small"
                    placeholder="选择或输入（如 英文 / 英繁 / 泰国…）"
                    options={reportVersionOpts.map((v: string) => ({ value: v }))}
                    filterOption={(input, option) =>
                      String((option as any)?.value ?? "").toLowerCase().includes(String(input).toLowerCase())}
                    allowClear
                  />
                </Form.Item>
                <Form.Item name="external_id" label="外部编号" style={{ marginBottom: 8 }}>
                  <Input placeholder="外部编号" size="small" />
                </Form.Item>
                <Form.Item name="fedex_no" label="快递单号" style={{ marginBottom: 8 }}>
                  <Input placeholder="快递单号" size="small" />
                </Form.Item>
                <Form.Item name="email" label="邮箱" style={{ marginBottom: 0 }}>
                  <Input placeholder="邮箱地址" size="small" />
                </Form.Item>
              </Col>

              <Col xs={24} sm={12}>
                <Form.Item label="孕周" style={{ marginBottom: 8 }}>
                  <Space>
                    <Form.Item name="gestational_age_weeks" style={{ margin: 0 }}>
                      <InputNumber size="small" min={0} max={45} placeholder="周" style={{ width: 60 }} />
                    </Form.Item>
                    <Text>周</Text>
                    <Form.Item name="gestational_age_days" style={{ margin: 0 }}>
                      <InputNumber size="small" min={0} max={6} placeholder="天" style={{ width: 60 }} />
                    </Form.Item>
                    <Text>天</Text>
                  </Space>
                </Form.Item>
                <Form.Item name="calculation_method" label="计算方式" style={{ marginBottom: 8 }} initialValue="lmp">
                  <Radio.Group size="small">
                    <Radio value="lmp">末次月经</Radio>
                    <Radio value="ultrasound">B超</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="last_menstrual_period" label="末次月经" style={{ marginBottom: 8 }}>
                  <DatePicker style={{ width: "100%" }} size="small" placeholder="选择日期" />
                </Form.Item>
                <Form.Item name="multiple_gestation" label="单双胎" style={{ marginBottom: 8 }}
                  initialValue={false}>
                  <Radio.Group size="small" optionType="button" buttonStyle="solid">
                    <Radio.Button value={null}>客户未填</Radio.Button>
                    <Radio.Button value={false}>单胎</Radio.Button>
                    <Radio.Button value={true}>双胎</Radio.Button>
                  </Radio.Group>
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.multiple_gestation !== cur.multiple_gestation}>
                  {({ getFieldValue }) =>
                    getFieldValue("multiple_gestation") === true ? (
                      <Form.Item name="twin_type" label="双胎类型" style={{ marginTop: 0, marginBottom: 0 }} initialValue="dizygotic">
                        <Radio.Group size="small">
                          <Radio value="monozygotic">同卵</Radio>
                          <Radio value="dizygotic">异卵</Radio>
                        </Radio.Group>
                      </Form.Item>
                    ) : null
                  }
                </Form.Item>
                {/* 额外信息（2026-10-13）：实为案例管理基本信息里的 gender 项（Yes/No），决定是否出性别报告 */}
                <Form.Item name="gender_info" label="额外信息" style={{ marginBottom: 0 }}
                  tooltip="案例管理基本信息里显示为 gender 的那一项（是=Yes／否=No）。选「是」才会出性别报告。">
                  <Radio.Group size="small">
                    <Radio value="Yes">是</Radio>
                    <Radio value="No">否</Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: "8px 0" }} />

            {/* 4 风险提示 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>4</span>
              <Text strong style={{ fontSize: 15 }}>风险提示</Text>
              <Text type="danger" style={{ fontSize: 12 }}>*必填</Text>
            </div>

            <Row gutter={[24, 0]} style={{ marginLeft: 16 }}>
              {[
                { key: "transfusion", label: "是否接受过异体输血（一年内）" },
                { key: "transplant", label: "是否做过骨髓或器官移植（一年内）" },
                { key: "immunotherapy", label: "是否做过免疫治疗/干细胞治疗等引入外源DNA的治疗（一个月内）" },
                { key: "miscarriage", label: "是否有流产史（三个月内）" },
                { key: "reduction", label: "是否减胎" },
                { key: "surrogacy", label: "是否代孕" },
                { key: "ivf", label: "是否试管婴儿" },
                { key: "week5_under", label: "是否孕期未满5周" },
              ].map((q, idx) => (
                <Col key={q.key} xs={24} sm={12}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Text style={{ flex: 1, fontSize: 13 }}>{idx + 1}. {q.label}</Text>
                    <Form.Item name={["risk", q.key]} style={{ margin: 0 }} initialValue={false}>
                      <Radio.Group size="small">
                        <Radio value={false}>否</Radio>
                        <Radio value={true}>是</Radio>
                      </Radio.Group>
                    </Form.Item>
                  </div>
                </Col>
              ))}
            </Row>

            <div style={{ margin: "12px 0", padding: "8px 12px", background: "#fffbe6", borderRadius: 6, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
              <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.6 }}>
                异体输血、移植手术、异体细胞治疗等可能引入外源DNA影响检测结果；
                近期流产、减胎可能有残留DNA。以下情况不适合此检测：多胞胎(≥3)、
                孕妇患肿瘤/先兆子痫/先天免疫疾病。
              </Text>
            </div>

            <Form.Item name="notes" label="备注" style={{ marginBottom: 12 }}>
              <Input.TextArea rows={2} placeholder="内部备注" size="small" />
            </Form.Item>

            <Row gutter={12} style={{ marginBottom: 0 }}>
              <Col flex="auto">
                <Button type="primary" icon={<PlusOutlined />} loading={loading}
                  onClick={handleSubmit} size="large" block>
                  提交登记
                </Button>
              </Col>
              <Col flex="220px">
                <Button icon={<SaveOutlined />} onClick={handleSaveDraft} size="large" block>
                  保存草稿
                </Button>
              </Col>
            </Row>

            {summaryVisible && draftSummary && (
              <Card size="small" style={{ marginTop: 16, background: "#fafcff", borderColor: "#d6e4ff" }}
                title={<Text strong style={{ fontSize: 14 }}>📋 登记内容汇总（保存于 {dayjs(draftSummary.savedAt).format("YYYY-MM-DD HH:mm:ss")}）</Text>}
                extra={<Button type="text" size="small" onClick={() => setSummaryVisible(false)}>关闭</Button>}>
                <Descriptions size="small" column={2} bordered
                  labelStyle={{ width: 110, fontSize: 12 }}
                  contentStyle={{ fontSize: 12 }}>
                  <Descriptions.Item label="采集方式" span={1}>{CM_LABEL[draftSummary.values?.collection_method] || "—"}</Descriptions.Item>
                  <Descriptions.Item label="来源(国家)" span={1}>{draftSummary.values?.sample_source || "—"}</Descriptions.Item>
                  <Descriptions.Item label="申请方" span={1}>{draftSummary.values?.applicant || "—"}</Descriptions.Item>
                  <Descriptions.Item label="电话" span={1}>{draftSummary.values?.phone || "—"}</Descriptions.Item>
                  <Descriptions.Item label="申请单签字" span={1}>{SIGNED_LABEL[draftSummary.values?.application_signed] || "—"}</Descriptions.Item>
                  <Descriptions.Item label="报告截止日期" span={1}>
                    {draftSummary.values?.report_deadline
                      ? dayjs(draftSummary.values.report_deadline).format("YYYY-MM-DD") : "—"}
                  </Descriptions.Item>

                  <Descriptions.Item label="孕妇" span={2}>
                    {draftSummary.values?.mother_name || "—"}
                    {draftSummary.values?.mother_ethnicity ? `（${draftSummary.values.mother_ethnicity}）` : ""}
                    {draftSummary.values?.female_arrival_date
                      ? ` · 采集 ${dayjs(draftSummary.values.female_arrival_date).format("YYYY-MM-DD")}` : ""}
                  </Descriptions.Item>
                  {(draftSummary.values?.males || []).map((m: any, i: number) => (
                    <Descriptions.Item label={`疑父${(draftSummary.values?.males || []).length > 1 ? i + 1 : ""}`} span={2} key={i}>
                      {m?.name || "—"}
                      {m?.ethnicity ? `（${m.ethnicity}）` : ""}
                      {m?.sample_type?.length ? ` · ${m.sample_type.join("+")}` : ""}
                      {m?.arrival_date ? ` · 采集 ${dayjs(m.arrival_date).format("YYYY-MM-DD")}` : ""}
                      {m?.report_deadline ? ` · 截止 ${dayjs(m.report_deadline).format("YYYY-MM-DD")}` : ""}
                    </Descriptions.Item>
                  ))}

                  <Descriptions.Item label="销售/代理" span={1}>{draftSummary.values?.sales_person || "—"}</Descriptions.Item>
                  <Descriptions.Item label="外部编号" span={1}>{draftSummary.values?.external_id || "—"}</Descriptions.Item>
                  <Descriptions.Item label="快递单号" span={1}>{draftSummary.values?.fedex_no || "—"}</Descriptions.Item>
                  <Descriptions.Item label="邮箱" span={1}>{draftSummary.values?.email || "—"}</Descriptions.Item>
                  <Descriptions.Item label="孕周" span={1}>
                    {draftSummary.values?.gestational_age_weeks != null || draftSummary.values?.gestational_age_days != null
                      ? `${draftSummary.values?.gestational_age_weeks ?? 0}周${draftSummary.values?.gestational_age_days ?? 0}天` : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="计算方式" span={1}>
                    {draftSummary.values?.calculation_method === "lmp" ? "末次月经" : draftSummary.values?.calculation_method === "ultrasound" ? "B超" : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="末次月经" span={1}>
                    {draftSummary.values?.last_menstrual_period ? dayjs(draftSummary.values.last_menstrual_period).format("YYYY-MM-DD") : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="单双胎" span={1}>
                    {draftSummary.values?.multiple_gestation === true ? "双胎"
                      : draftSummary.values?.multiple_gestation === false ? "单胎" : "客户未填"}
                    {draftSummary.values?.multiple_gestation === true
                      ? (draftSummary.values?.twin_type === "monozygotic" ? "（同卵）" : draftSummary.values?.twin_type === "dizygotic" ? "（异卵）" : "") : ""}
                  </Descriptions.Item>
                  <Descriptions.Item label="申请日期" span={1}>
                    {draftSummary.values?.collection_date ? dayjs(draftSummary.values.collection_date).format("YYYY-MM-DD") : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="诊所/医院" span={1}>{draftSummary.values?.clinic_name || "—"}</Descriptions.Item>
                  <Descriptions.Item label="风险提示「是」" span={2}>
                    {(() => {
                      const yes = RISK_LABELS.filter(([k]) => draftSummary.values?.risk?.[k] === true);
                      return yes.length ? yes.map(([, l]) => l).join("、") : "无";
                    })()}
                  </Descriptions.Item>
                  <Descriptions.Item label="额外信息" span={1}>
                    {draftSummary.values?.gender_info === "Yes" ? "是"
                      : draftSummary.values?.gender_info === "No" ? "否" : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="备注" span={2}>{draftSummary.values?.notes || "—"}</Descriptions.Item>
                </Descriptions>
              </Card>
            )}
          </Form>
        </Card>
      )}

      {/* === 补充样本：极简表单 === */}
      {regType === "SUPPLEMENT" && selectedCase && (
        <Card size="small">
          <Form form={form} layout="vertical" size="small">
            <div style={{ marginBottom: 12 }}>
              <Tag color="blue">PT: {selectedCase.pt_number}</Tag>
              <Tag>{selectedCase.case_number}</Tag>
            </div>

            {/* 原样本信息（参考样本签收列体系，精简 7 列） */}
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={selectedCase.case_samples || []}
              style={{ marginBottom: 16 }}
              columns={[
                { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 130,
                  render: (v: string) => v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text> },
                { title: "姓名", dataIndex: "patient_name", key: "name", width: 100,
                  render: (v: string) => v || "-" },
                { title: "角色", dataIndex: "role", key: "role", width: 70,
                  render: (v: string) => v === "MOTHER" ? <Tag color="magenta" style={{ margin: 0 }}>孕妇</Tag> : <Tag color="blue" style={{ margin: 0 }}>疑父</Tag> },
                { title: "样本类型", dataIndex: "sample_source", key: "st", width: 80,
                  render: (v: string) => {
                    const m: Record<string, string> = { BLOOD: "血液", DBS: "血痕", HAIR: "毛发", SWAB: "口拭子", NAIL: "指甲", SEMEN: "精液", TOOTHBRUSH: "牙刷", CIGARETTE: "烟头", BOTTLE: "水瓶", BEARD: "胡须", FLOSS: "牙线", SEMSTAIN: "精斑", GUM: "口香糖" };
                    return m[v] || v || "-";
                  } },
                { title: "采集日期", dataIndex: "collection_date", key: "cd", width: 100,
                  render: (v: string) => v || "-" },
                { title: "状态", dataIndex: "sample_status", key: "status", width: 90,
                  render: (v: string) => {
                    const m: Record<string, string> = { REGISTERED: "default", RECEIVED: "green", REJECTED: "red", IN_PROCESS: "processing", COMPLETED: "success" };
                    const l: Record<string, string> = { REGISTERED: "已登记", RECEIVED: "已签收", REJECTED: "已拒收", IN_PROCESS: "实验中", COMPLETED: "已完成" };
                    return <Tag color={m[v] || "default"} style={{ margin: 0 }}>{l[v] || v || "-"}</Tag>;
                  } },
                { title: "备注", dataIndex: "collection_notes", key: "notes", width: 140, ellipsis: true,
                  render: (v: string) => v || "-" },
              ] as any}
            />

            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_arrival_date" label="到样日期" style={{ marginBottom: 8 }}>
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_role" label="补样对象" rules={[{ required: true }]} initialValue="ALLEGED_FATHER">
                  <Select options={[
                    { value: "MOTHER", label: "孕妇" },
                    { value: "ALLEGED_FATHER", label: "疑父" },
                  ]} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_name" label="姓名" rules={[{ required: true }]}>
                  <Input placeholder="姓名" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_sample_type" label="样本类型" initialValue={["BLOOD"]} style={{ marginBottom: 8 }}>
                  <Select mode="multiple" options={SAMPLE_TYPE_OPTIONS}
                    placeholder="选择样本类型" maxTagCount={5} />
                </Form.Item>
              </Col>
            </Row>

            {/* 孕妇补样：孕周/单双胎（更新 Case 原值，空=不更新） */}
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.supp_role !== cur.supp_role}>
              {({ getFieldValue }) =>
                getFieldValue("supp_role") === "MOTHER" ? (
                  <Row gutter={12}>
                    <Col xs={24} sm={6}>
                      <Form.Item label="孕周（更新，空=不改）" style={{ marginBottom: 8 }}>
                        <Space>
                          <Form.Item name="supp_ga_weeks" noStyle>
                            <InputNumber size="small" min={0} max={45} placeholder="周" style={{ width: 60 }} />
                          </Form.Item>
                          <Text>周</Text>
                          <Form.Item name="supp_ga_days" noStyle>
                            <InputNumber size="small" min={0} max={6} placeholder="天" style={{ width: 60 }} />
                          </Form.Item>
                          <Text>天</Text>
                        </Space>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={6}>
                      <Form.Item name="supp_mg" label="单双胎（更新）" initialValue="KEEP" style={{ marginBottom: 8 }}>
                        <Select size="small" options={[
                          { value: "KEEP", label: "不更新" },
                          { value: "NULL", label: "客户未填" },
                          { value: "FALSE", label: "单胎" },
                          { value: "TRUE", label: "双胎" },
                        ]} />
                      </Form.Item>
                    </Col>
                  </Row>
                ) : null
              }
            </Form.Item>

            <Form.Item name="supp_notes" label="备注" style={{ marginBottom: 8 }}>
              <Input.TextArea rows={2} placeholder="备注（样本管理与样本签收可见）" />
            </Form.Item>

            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} loading={loading}
                onClick={handleSubmit} size="large">
                补充样本
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* === 重采样本 === */}
      {regType === "RESAMPLE" && selectedCase && (
        <Card size="small">
          <div style={{ marginBottom: 12 }}>
            <Tag color="blue">PT: {selectedCase.pt_number}</Tag>
            <Tag>{selectedCase.case_number}</Tag>
            {resampleTarget && (
              <Tag color="purple">
                重采 →{" "}
                {(() => {
                  const cs = selectedCase.case_samples?.find((s: any) => s.id === resampleTarget);
                  if (!cs) return "";
                  const baseId = cs.test_sample_id || selectedCase.pt_number || selectedCase.case_number || "";
                  const existingResamples = selectedCase.case_samples?.filter(
                    (s: any) => s.resample_of === cs.id
                  ).length || 0;
                  return `${baseId}-R${existingResamples + 1}`;
                })()}
              </Tag>
            )}
          </div>

          {/* 重采对象选择 */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">选择重采对象：</Text>
            <Select
              style={{ width: 320, marginLeft: 8 }}
              placeholder="选择要重采的样本"
              value={resampleTarget}
              onChange={setResampleTarget}
              options={(selectedCase.case_samples || []).map((cs: any) => ({
                value: cs.id,
                label: `${cs.test_sample_id || "(未签收)"} — ${cs.patient_name} (${cs.role === "MOTHER" ? "母亲" : "父亲"})`,
              }))}
            />
          </div>

          {/* 原样本信息表格（同补充样本，7 列） */}
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={selectedCase.case_samples || []}
            style={{ marginBottom: 16 }}
            columns={[
              { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 150,
                render: (v: string) => v
                  ? <Text code style={{ fontSize: 12 }}>{v}</Text>
                  : <Text type="secondary">-</Text> },
              { title: "姓名", dataIndex: "patient_name", key: "name", width: 100,
                render: (v: string) => v || "-" },
              { title: "角色", dataIndex: "role", key: "role", width: 70,
                render: (v: string) => v === "MOTHER" ? <Tag color="magenta" style={{ margin: 0 }}>孕妇</Tag> : <Tag color="blue" style={{ margin: 0 }}>疑父</Tag> },
              { title: "样本类型", dataIndex: "sample_source", key: "st", width: 80,
                render: (v: string) => {
                  const m: Record<string, string> = { BLOOD: "血液", DBS: "血痕", HAIR: "毛发", SWAB: "口拭子", NAIL: "指甲", SEMEN: "精液", TOOTHBRUSH: "牙刷", CIGARETTE: "烟头", BOTTLE: "水瓶", BEARD: "胡须", FLOSS: "牙线", SEMSTAIN: "精斑", GUM: "口香糖" };
                  return m[v] || v || "-";
                } },
              { title: "采集日期", dataIndex: "collection_date", key: "cd", width: 100,
                render: (v: string) => v || "-" },
              { title: "状态", dataIndex: "sample_status", key: "status", width: 90,
                render: (v: string) => {
                  const m: Record<string, string> = { REGISTERED: "default", RECEIVED: "green", REJECTED: "red", IN_PROCESS: "processing", COMPLETED: "success" };
                  const l: Record<string, string> = { REGISTERED: "已登记", RECEIVED: "已签收", REJECTED: "已拒收", IN_PROCESS: "实验中", COMPLETED: "已完成" };
                  return <Tag color={m[v] || "default"} style={{ margin: 0 }}>{l[v] || v || "-"}</Tag>;
                } },
              { title: "备注", dataIndex: "collection_notes", key: "notes", width: 140, ellipsis: true,
                render: (v: string) => v || "-" },
            ] as any}
          />

          {resampleTarget && (
          <Form form={form} layout="vertical" size="small">
            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item name="re_arrival_date" label="到样日期" style={{ marginBottom: 8 }}>
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item label="原编号">
                  <Input disabled value={
                    selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.test_sample_id
                    || selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.sample_id || ""
                  } />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item label="原姓名">
                  <Input disabled value={
                    selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.patient_name || ""
                  } />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                {(() => {
                  const cs = selectedCase.case_samples?.find((s: any) => s.id === resampleTarget);
                  if (cs?.role === "MOTHER") {
                    return (
                      <Form.Item label="孕周（更新，空=不改）" style={{ marginBottom: 8 }}>
                        <Space>
                          <Form.Item name="re_ga_weeks" noStyle>
                            <InputNumber size="small" min={0} max={45} placeholder="周" style={{ width: 60 }} />
                          </Form.Item>
                          <Text>周</Text>
                          <Form.Item name="re_ga_days" noStyle>
                            <InputNumber size="small" min={0} max={6} placeholder="天" style={{ width: 60 }} />
                          </Form.Item>
                          <Text>天</Text>
                        </Space>
                      </Form.Item>
                    );
                  }
                  return (
                    <Form.Item name="re_sample_type" label="样本类型" initialValue={["BLOOD"]} style={{ marginBottom: 8 }}>
                      <Select mode="multiple" options={SAMPLE_TYPE_OPTIONS}
                        placeholder="选择样本类型" maxTagCount={5} />
                    </Form.Item>
                  );
                })()}
              </Col>
            </Row>

            <Form.Item name="re_notes" label="备注" style={{ marginBottom: 8 }}>
              <Input.TextArea rows={2} placeholder="备注（样本管理与样本签收可见）" />
            </Form.Item>

            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} loading={loading}
                onClick={handleSubmit} size="large">
                确认重采
              </Button>
            </div>
          </Form>
          )}
        </Card>
      )}

      {/* === 巴西导入 === */}
      {regType === "IMPORT" && (
        <Card size="small">
          <div style={{ marginBottom: 12, color: "#666", fontSize: 12 }}>
            上传巴西送检单（Word 送检单 或 PLANILHA DE ENVIO 表格），
            系统将过滤 NIPT 项目、合并多疑父，按 Client Code 分组后批量登记首次检测 Case（来源：巴西）。
          </div>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Upload.Dragger
                accept=".docx"
                multiple
                showUploadList={false}
                beforeUpload={(_f: any, fileList: any) => {
                  handleImportFiles(fileList.map((f: any) => f.originFileObj || f));
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><InboxOutlined style={{ fontSize: 32, color: "#1677ff" }} /></p>
                <p className="ant-upload-text">上传送检单 Word（.docx）</p>
                <p className="ant-upload-hint">支持批量上传，NIPT 送检单自动跳过</p>
              </Upload.Dragger>
            </Col>
            <Col xs={24} md={12}>
              <Upload.Dragger
                accept=".xlsx"
                multiple
                showUploadList={false}
                beforeUpload={(_f: any, fileList: any) => {
                  handleImportFiles(fileList.map((f: any) => f.originFileObj || f));
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><FileExcelOutlined style={{ fontSize: 32, color: "#52c41a" }} /></p>
                <p className="ant-upload-text">上传 PLANILHA DE ENVIO 表格（.xlsx）</p>
                <p className="ant-upload-hint">前两行为表头，按 Client Code 分组登记</p>
              </Upload.Dragger>
            </Col>
          </Row>

          {importFileName && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{importFileName}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {importRows.length} 个Case{importNiptSkipped > 0 ? `，跳过 NIPT ${importNiptSkipped} 个` : ""}
                {importExisting.size > 0 ? `，已存在 ${importExisting.size} 个` : ""}
                {importErrorFiles.length > 0 ? `，解析失败 ${importErrorFiles.length} 个` : ""}
              </Text>
            </div>
          )}

          {importNiptFiles.length > 0 && (
            <div style={{ marginBottom: 8, padding: "6px 10px", background: "#fafafa", borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>跳过（NIPT）:</Text>
              {importNiptFiles.map((f: any, i: number) => (
                <Tag key={i} style={{ marginLeft: 4, marginBottom: 2 }}>{f.file}（{f.test_item}）</Tag>
              ))}
            </div>
          )}

          {importErrorFiles.length > 0 && (
            <div style={{ marginBottom: 8, padding: "6px 10px", background: "#fff1f0", borderRadius: 6 }}>
              <Text type="danger" style={{ fontSize: 12 }}>解析失败:</Text>
              {importErrorFiles.map((f: any, i: number) => (
                <Tag key={i} color="red" style={{ marginLeft: 4, marginBottom: 2 }}>{f.file}: {f.error}</Tag>
              ))}
            </div>
          )}

          {importRows.length > 0 && (
            <>
              <Table
                dataSource={importRows}
                rowKey="seq"
                size="small"
                pagination={false}
                scroll={{ x: 900, y: 400 }}
                columns={[
                  { title: "导入", width: 110, render: (_: any, r: any) => {
                      const info = importKindMap[r.seq];
                      const cb = (
                        <Checkbox checked={importChecked.has(r.seq)}
                          onChange={(e) => setImportChecked((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(r.seq) : next.delete(r.seq);
                            return next;
                          })} />
                      );
                      if (info) {
                        const labelMap: Record<string, string> = { MOTHER: "补孕妇", FATHER: "补疑父", FATHER2: "补疑父二", DUPLICATE: "重复" };
                        const colorMap: Record<string, string> = { MOTHER: "magenta", FATHER: "blue", FATHER2: "purple", DUPLICATE: "orange" };
                        return (
                          <Space size={2} direction="vertical" style={{ alignItems: "center", maxWidth: 100 }}>
                            <Tag color={colorMap[info.kind] || "orange"} style={{ fontSize: 10, margin: 0, whiteSpace: "normal", lineHeight: "14px" }}>
                              {labelMap[info.kind] || "已存在"}
                              {info.case_number ? <span style={{ fontSize: 9, opacity: 0.8 }}>{` (${info.case_number.slice(-4)})`}</span> : null}
                            </Tag>
                            {cb}
                          </Space>
                        );
                      }
                      return cb;
                    } },
                  { title: "Seq", dataIndex: "seq", width: 90,
                    render: (v: string) => <Text code>{v}</Text> },
                  { title: "孕妇", dataIndex: "mother_name", width: 170, ellipsis: true },
                  { title: "RG_F", dataIndex: "mother_id_card", width: 110,
                    render: (v: string) => v || "—" },
                  { title: "ID_tubo_F", dataIndex: "mother_tube_no", width: 110,
                    render: (v: string) => v || "—" },
                  { title: "疑父", key: "fathers", width: 200, ellipsis: true,
                    render: (_: any, r: any) => r.fathers.map((f: any) => f.name).join("；") },
                  { title: "RG_M / ID_tubo_M", key: "ftube", width: 170,
                    render: (_: any, r: any) => r.fathers
                      .map((f: any) => [f.id_card, f.tube_no].filter(Boolean).join(" / ") || "—")
                      .join("；") },
                  { title: "疑父样本类型", key: "types", width: 140,
                    render: (_: any, r: any) => r.fathers.map((f: any) => f.sample_types.join("/")).join("；") },
                  { title: "Sales", dataIndex: "sales_person", width: 70 },
                  { title: "采样日期", dataIndex: "collection_date", width: 100 },
                  { title: "孕周", key: "gw", width: 70,
                    render: (_: any, r: any) => r.gestational_age_weeks ? `${r.gestational_age_weeks}周` : "—" },
                ]}
              />
              <div style={{ marginTop: 12 }}>
                <Button type="primary" icon={<PlusOutlined />} loading={importLoading}
                  onClick={handleImportSubmit} size="large">
                  批量导入（{importChecked.size} 个Case）
                </Button>
              </div>
              {importResult && importResult.errors?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="danger" style={{ fontSize: 12 }}>失败明细：</Text>
                  {importResult.errors.map((e: any, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: "#cf1322" }}>
                      Seq {e.seq}: {e.error}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* === 国内导入 === */}
      {regType === "IMPORT_CN" && (
        <Card size="small">
          <div style={{ marginBottom: 12, color: "#666", fontSize: 12 }}>
            上传国内送检表（.xlsx，一行 = 一个案例：孕妇 + 疑父），
            按「孕妇姓名 + 疑父姓名」查重后批量登记首次检测 Case（来源：国内）。
          </div>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Upload.Dragger
                accept=".xlsx"
                multiple
                showUploadList={false}
                beforeUpload={(_f: any, fileList: any) => {
                  handleCnImportFiles(fileList.map((f: any) => f.originFileObj || f));
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><FileExcelOutlined style={{ fontSize: 32, color: "#52c41a" }} /></p>
                <p className="ant-upload-text">上传国内送检表（.xlsx）</p>
                <p className="ant-upload-hint">支持批量上传，按表头「孕妇姓名」「疑父姓名」解析</p>
              </Upload.Dragger>
            </Col>
          </Row>

          {cnFileName && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="green">{cnFileName}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {cnRows.length} 个Case{cnExisting.length > 0 ? `，已存在 ${cnExisting.length} 个` : ""}
                {cnErrors.length > 0 ? `，解析失败 ${cnErrors.length} 行` : ""}
              </Text>
            </div>
          )}

          {cnErrors.length > 0 && (
            <div style={{ marginBottom: 8, padding: "6px 10px", background: "#fff1f0", borderRadius: 6 }}>
              <Text type="danger" style={{ fontSize: 12 }}>解析失败:</Text>
              {cnErrors.map((f: any, i: number) => (
                <Tag key={i} color="red" style={{ marginLeft: 4, marginBottom: 2 }}>{f.file} 行{f.row_no}: {f.error}</Tag>
              ))}
            </div>
          )}

          {cnRows.length > 0 && (
            <>
              <Table
                dataSource={cnRows}
                rowKey="row_no"
                size="small"
                pagination={false}
                scroll={{ x: 1100, y: 400 }}
                columns={[
                  { title: "导入", width: 90, render: (_: any, r: any) => {
                      const ex = cnExisting.find((e: any) => e.row_no === r.row_no);
                      const cb = (
                        <Checkbox checked={cnChecked.has(r.row_no)}
                          onChange={(e) => setCnChecked((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(r.row_no) : next.delete(r.row_no);
                            return next;
                          })} />
                      );
                      if (ex) {
                        return (
                          <Space size={2} direction="vertical" style={{ alignItems: "center", maxWidth: 86 }}>
                            <Tag color="orange" style={{ fontSize: 10, margin: 0, whiteSpace: "normal", lineHeight: "14px" }}>
                              重复<span style={{ fontSize: 9, opacity: 0.8 }}>{` (${String(ex.case_number).slice(-4)})`}</span>
                            </Tag>
                            {cb}
                          </Space>
                        );
                      }
                      return cb;
                    } },
                  { title: "行", dataIndex: "row_no", width: 44 },
                  { title: "孕妇", dataIndex: "mother_name", width: 130, ellipsis: true },
                  { title: "疑父", dataIndex: "father_name", width: 130, ellipsis: true },
                  { title: "类型", dataIndex: "father_sample_type", width: 60,
                    render: (v: string) => { const m: Record<string, string> = { BLOOD: "血液", DBS: "血痕", HAIR: "毛发", NAIL: "指甲", SWAB: "口拭子", SEMEN: "精液", SEMSTAIN: "精斑", TOOTHBRUSH: "牙刷", CIGARETTE: "烟头", BOTTLE: "水瓶", BEARD: "胡须", FLOSS: "牙线", GUM: "口香糖" }; return m[v] || v || "—"; } },
                  { title: "编号", dataIndex: "external_id", width: 100, ellipsis: true },
                  { title: "来源", dataIndex: "applicant", width: 100, ellipsis: true },
                  { title: "人员", dataIndex: "sales_person", width: 70, ellipsis: true },
                  { title: "电话", dataIndex: "phone", width: 110, ellipsis: true },
                  { title: "孕周", key: "gw", width: 70,
                    render: (_: any, r: any) => r.gestational_age_weeks != null ? `${r.gestational_age_weeks}周${r.gestational_age_days ? `${r.gestational_age_days}天` : ""}` : "—" },
                  { title: "申请日期", dataIndex: "collection_date", width: 100 },
                  { title: "预计报告", dataIndex: "expected_completion", width: 100,
                    render: (v: string) => v || "—" },
                  { title: "备注", dataIndex: "notes", ellipsis: true,
                    render: (v: string) => v || "—" },
                  { title: "PT参考", dataIndex: "pt_ref", width: 80,
                    render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v || "—"}</Text> },
                ]}
              />
              <div style={{ marginTop: 12 }}>
                <Button type="primary" icon={<PlusOutlined />} loading={cnLoading}
                  onClick={handleCnImportSubmit} size="large">
                  批量导入（{cnChecked.size} 个Case）
                </Button>
              </div>
              {cnResult && (cnResult.errors?.length > 0 || cnResult.skipped?.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  {cnResult.errors?.length > 0 && (
                    <>
                      <Text type="danger" style={{ fontSize: 12 }}>失败明细：</Text>
                      {cnResult.errors.map((e: any, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: "#cf1322" }}>行 {e.row_no}: {e.error}</div>
                      ))}
                    </>
                  )}
                  {cnResult.skipped?.length > 0 && (
                    <>
                      <Text type="warning" style={{ fontSize: 12, display: "block", marginTop: 4 }}>跳过明细：</Text>
                      {cnResult.skipped.map((s: any, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: "#d46b08" }}>行 {s.row_no}: {s.case_number ? `已存在（${s.case_number}）` : s.reason}</div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* === 越南导入 === */}
      {regType === "IMPORT_VN" && (
        <Card size="small">
          <div style={{ marginBottom: 12, color: "#666", fontSize: 12 }}>
            上传越南客户信息表（.xlsx，一行 = 一个案例：孕妇 + 疑父），
            按「S/N 编号」查重后批量登记首次检测 Case（来源：越南，人员：吴梦婷）。
            孕妇样本按血液处理；疑父样本类型按表格填写（一格多种时建多个样本）。
          </div>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Upload.Dragger
                accept=".xlsx"
                multiple
                showUploadList={false}
                beforeUpload={(_f: any, fileList: any) => {
                  handleVnImportFiles(fileList.map((f: any) => f.originFileObj || f));
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon"><FileExcelOutlined style={{ fontSize: 32, color: "#1890ff" }} /></p>
                <p className="ant-upload-text">上传越南客户信息表（.xlsx）</p>
                <p className="ant-upload-hint">支持批量上传，按表头「Pregnant woman&apos;s Name」「Alleged father&apos;s Name」解析</p>
              </Upload.Dragger>
            </Col>
          </Row>

          {vnFileName && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="blue">{vnFileName}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {vnRows.length} 个Case{vnExisting.length > 0 ? `，已存在 ${vnExisting.length} 个` : ""}
                {vnErrors.length > 0 ? `，解析失败 ${vnErrors.length} 行` : ""}
              </Text>
              {vnRows.find((r: any) => r.file_repaired) && (
                <Tag color="orange" style={{ marginLeft: 6 }}>
                  {vnRows.find((r: any) => r.file_repaired).file_repaired}
                </Tag>
              )}
            </div>
          )}

          {vnErrors.length > 0 && (
            <div style={{ marginBottom: 8, padding: "6px 10px", background: "#fff1f0", borderRadius: 6 }}>
              <Text type="danger" style={{ fontSize: 12 }}>解析失败:</Text>
              {vnErrors.map((f: any, i: number) => (
                <Tag key={i} color="red" style={{ marginLeft: 4, marginBottom: 2 }}>{f.file} 行{f.row_no}: {f.error}</Tag>
              ))}
            </div>
          )}

          {vnRows.length > 0 && (
            <>
              <Table
                dataSource={vnRows}
                rowKey="row_no"
                size="small"
                pagination={false}
                scroll={{ x: 1500, y: 400 }}
                columns={[
                  { title: "导入", width: 90, render: (_: any, r: any) => {
                      const ex = vnExisting.find((e: any) => e.row_no === r.row_no);
                      const cb = (
                        <Checkbox checked={vnChecked.has(r.row_no)}
                          onChange={(e) => setVnChecked((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(r.row_no) : next.delete(r.row_no);
                            return next;
                          })} />
                      );
                      if (ex) {
                        return (
                          <Space size={2} direction="vertical" style={{ alignItems: "center", maxWidth: 86 }}>
                            <Tag color="orange" style={{ fontSize: 10, margin: 0, whiteSpace: "normal", lineHeight: "14px" }}>
                              重复<span style={{ fontSize: 9, opacity: 0.8 }}>{` (${String(ex.case_number).slice(-4)})`}</span>
                            </Tag>
                            {cb}
                          </Space>
                        );
                      }
                      return cb;
                    } },
                  { title: "行", dataIndex: "row_no", width: 44 },
                  { title: "S/N 编号", dataIndex: "external_id", width: 110, ellipsis: true },
                  { title: "孕妇", dataIndex: "mother_name", width: 150, ellipsis: true },
                  { title: "疑父", dataIndex: "father_name", width: 150, ellipsis: true },
                  { title: "疑父样本类型", key: "ftypes", width: 150,
                    render: (_: any, r: any) => {
                      const m: Record<string, string> = { BLOOD: "血液", DBS: "血痕", HAIR: "毛发", NAIL: "指甲", SWAB: "口拭子", SEMEN: "精液", SEMSTAIN: "精斑", TOOTHBRUSH: "牙刷", CIGARETTE: "烟头", BOTTLE: "水瓶", BEARD: "胡须", FLOSS: "牙线", GUM: "口香糖" };
                      const list: string[] = r.father_sample_types || [];
                      const warn = (r.type_warnings || []).length > 0;
                      return (
                        <span>
                          {list.map((t) => m[t] || t).join(" + ") || "—"}
                          {warn && (
                            <Tooltip title={(r.type_warnings || []).join("；")}>
                              <ExclamationCircleOutlined style={{ color: "#faad14", marginLeft: 4 }} />
                            </Tooltip>
                          )}
                        </span>
                      );
                    } },
                  { title: "孕周", key: "gw", width: 70,
                    render: (_: any, r: any) => r.gestational_age_weeks != null ? `${r.gestational_age_weeks}周${r.gestational_age_days ? `${r.gestational_age_days}天` : ""}` : "—" },
                  { title: "孕妇采样", dataIndex: "mother_collection_date", width: 100,
                    render: (v: string) => v || "—" },
                  { title: "疑父采样", dataIndex: "father_collection_date", width: 100,
                    render: (v: string) => v || "—" },
                  { title: "预计报告", dataIndex: "expected_completion", width: 100,
                    render: (v: string) => v || "—" },
                  { title: "来源", dataIndex: "applicant", width: 80, ellipsis: true },
                  { title: "人员", dataIndex: "sales_person", width: 80, ellipsis: true },
                  { title: "备注", dataIndex: "notes", ellipsis: true,
                    render: (v: string) => v || "—" },
                ]}
              />
              <div style={{ marginTop: 12 }}>
                <Button type="primary" icon={<PlusOutlined />} loading={vnLoading}
                  onClick={handleVnImportSubmit} size="large">
                  批量导入（{vnChecked.size} 个Case）
                </Button>
              </div>
              {vnResult && (vnResult.errors?.length > 0 || vnResult.skipped?.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  {vnResult.errors?.length > 0 && (
                    <>
                      <Text type="danger" style={{ fontSize: 12 }}>失败明细：</Text>
                      {vnResult.errors.map((e: any, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: "#cf1322" }}>行 {e.row_no}: {e.error}</div>
                      ))}
                    </>
                  )}
                  {vnResult.skipped?.length > 0 && (
                    <>
                      <Text type="warning" style={{ fontSize: 12, display: "block", marginTop: 4 }}>跳过明细：</Text>
                      {vnResult.skipped.map((s: any, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: "#d46b08" }}>行 {s.row_no}: {s.case_number ? `已存在（${s.case_number}）` : s.reason}</div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Recent Cases (collapsible) */}
      <Collapse style={{ marginTop: 16 }} ghost items={[{
        key: "recent",
        label: <span><ReloadOutlined style={{ marginRight: 8 }} />Recent Cases ({recentCases.length})</span>,
        children: (
          <Table
            dataSource={recentCases}
            columns={caseColumns}
            rowKey="id"
            loading={casesLoading}
            size="small"
            pagination={{ pageSize: 10, size: "small" }}
            scroll={{ x: 800 }}
          />
        ),
      }]} />

      {/* Token Modal */}
      <Modal
        title="Registration Link"
        open={tokenModal?.open || false}
        onCancel={() => setTokenModal(null)}
        footer={[
          <Button key="copy" type="primary" icon={<CopyOutlined />}
            onClick={() => copyLink(tokenModal?.url || "")}>
            Copy Link
          </Button>,
          <Button key="close" onClick={() => setTokenModal(null)}>Close</Button>,
        ]}
        width={560}
      >
        {tokenModal && (
          <div>
            <p><Text strong>Case:</Text> {tokenModal.caseNumber}</p>
            <Card size="small" style={{ background: "#f6ffed", marginBottom: 12 }}>
              <Text copyable style={{ wordBreak: "break-all", fontSize: 14 }}>
                {tokenModal.url}
              </Text>
            </Card>
            <p>
              <Text type="secondary">
                Expires: {tokenModal.expires ? dayjs(tokenModal.expires).format("YYYY-MM-DD HH:mm") : "N/A"}
              </Text>
            </p>
            <Divider />
            <Text type="secondary">
              Share this link with the family. They can register sample information without logging in.
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
