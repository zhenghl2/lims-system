// NipptPreProcessing.tsx — NIPPT 前处理模块
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card, Table, Button, Tag, Tabs, Modal, message, Typography,
  Input, Select, InputNumber, Space, Popconfirm,
  Checkbox, Divider, Upload, Image, DatePicker, TimePicker,
} from "antd";
import {
  PlusOutlined, ReloadOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  CameraOutlined, LoadingOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text, Title } = Typography;

const SAMPLE_TYPE_OPTIONS = [
  { value: "BLOOD", label: "血液" },
  { value: "DBS", label: "血痕" },
  { value: "HAIR", label: "毛发" },
  { value: "NAIL", label: "指甲" },
  { value: "SWAB", label: "口拭子" },
  { value: "SEMEN", label: "精液" },
  { value: "TOOTHBRUSH", label: "牙刷" },
  { value: "CIGARETTE", label: "烟头" },
  { value: "BOTTLE", label: "水瓶" },
  { value: "BEARD", label: "胡须" },
  { value: "FLOSS", label: "牙线" },
  { value: "SEMSTAIN", label: "精斑" },
  { value: "GUM", label: "口香糖" },
];

const CONDITION_OPTIONS = [
  { value: "OK", label: "合格" },
  { value: "HEMOLYZED", label: "融血" },
  { value: "LOW_VOLUME", label: "体积不足" },
  { value: "OTHER", label: "其他" },
];

interface PendingEntry {
  case_id: string;
  case_number: string;
  patient_name: string;
  role: string;
  category: string;
  sample_types: string[];
  case_sample_ids: string[];
  test_sample_id: string | null;
}

interface PreSample {
  id: string;
  patient_name: string;
  role: string;
  category: string;
  case_sample_ids: string[];
  sample_condition: string;
  aliquot_tubes: number;
  plasma_volume: number | null;
  experiment_sample_type: string;
  elution_volume: number | null;
  dna_concentration: number | null;
  qc_status: string;
  qc_note: string;
  test_sample_id: string | null;
  received_sample_types: string[];
  remaining_sample_types: string[];
}

interface BatchItem {
  id: string;
  batch_number: string;
  status: string;
  status_display: string;
  sample_count: number;
  female_count: number;
  male_blood_count: number;
  male_other_count: number;
  created_at: string;
}

interface BatchDetail extends BatchItem {
  female_samples: PreSample[];
  male_blood_samples: PreSample[];
  male_other_samples: PreSample[];
  processing_data: any;
  operator?: string; reviewer?: string; experiment_time?: string;
}

export default function NipptPreProcessing() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [ppDate, setPpDate] = useState<string>("");      // 女性日期
  const [ppTime, setPpTime] = useState<string>("");      // 女性时间
  const [ppDateM, setPpDateM] = useState<string>("");    // 男性日期
  const [ppTimeM, setPpTimeM] = useState<string>("");    // 男性时间
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // New batch modal
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<{
    female_count: number; male_blood_count: number; male_other_count: number;
    total_pending: number; entries: PendingEntry[];
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingSearch, setPendingSearch] = useState("");
  const [batchNumberPreview, setBatchNumberPreview] = useState("");

  // Active tab
  const [activeTab, setActiveTab] = useState("female");

  // Photo upload（男女独立）
  const [photosF, setPhotosF] = useState<string[]>([]);
  const [photosM, setPhotosM] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const pendingUploads = useRef<Promise<void>[]>([]);
  const draftSkipRef = useRef(false);
const PERSONS = ["吴书凌","叶丽婷","何家宇","胡煜敏","付慧珠","杜兴琼","龙雨青","张斯栋","郭爽洁","林琦"];
// 女性操作人/审核人
const [operators, setOperators] = useState<Record<string,string>>({});
const [reviewers, setReviewers] = useState<Record<string,string>>({});
// 男性操作人/审核人
const [operatorsM, setOperatorsM] = useState<Record<string,string>>({});
const [reviewersM, setReviewersM] = useState<Record<string,string>>({});
// 照片 ref 镜像：保证保存/校验时读到最新值（防闭包旧快照）
const photosFRef = useRef<string[]>([]);
const photosMRef = useRef<string[]>([]);
const setPhotosFSync = (next: string[]) => { photosFRef.current = next; setPhotosF(next); };
const setPhotosMSync = (next: string[]) => { photosMRef.current = next; setPhotosM(next); };

  // ===== Data fetching =====
  const deleteBatch = async (id: string, batchNumber: string) => {
    try {
      await (casesApi as any).deletePreprocessingBatch(id);
      message.success(`批次 ${batchNumber} 已删除`);
      setSelectedBatch(null);
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "删除失败");
    }
  };

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await (casesApi as any).listPreprocessingBatches();
      setBatches(res.data?.results || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const autoFillExperimentType = (batch: any) => {
    const allSamples = [...(batch.female_samples || []), ...(batch.male_other_samples || []), ...(batch.male_blood_samples || [])];
    for (const s of allSamples) {
      if (s.experiment_sample_type) continue;
      const types = s.received_sample_types || [];
      if (types.length === 1) {
        s.experiment_sample_type = types[0];
        // 男性血液可分2-3次实验：选"血液"时血液保留在剩余中
        s.remaining_sample_types = (types[0] === "BLOOD" && s.category === "MALE_BLOOD") ? [...types] : [];
      } else if (types.length > 1 && types.includes("BLOOD")) {
        s.experiment_sample_type = "BLOOD";
        s.remaining_sample_types = s.category === "MALE_BLOOD"
          ? [...types]
          : types.filter((t: string) => t !== "BLOOD");
      }
      // other cases: leave empty for operator
    }
  };

  // ===== 草稿（sessionStorage）：照片+操作人+审核人 切页不丢 =====
  const PP_DRAFT_KEY = "nippt_pp_draft_v1";
  const loadPpDraft = (): any => {
    try { return JSON.parse(sessionStorage.getItem(PP_DRAFT_KEY) || "{}") || {}; } catch { return {}; }
  };
  const savePpDraft = (patch: any) => {
    if (!selectedBatch) return;
    try {
      const d = loadPpDraft();
      d[selectedBatch.id] = { ...(d[selectedBatch.id] || {}), ...patch, savedAt: Date.now() };
      sessionStorage.setItem(PP_DRAFT_KEY, JSON.stringify(d));
    } catch { /* ignore */ }
  };

  // ===== 草稿照片：IndexedDB（大容量，防 sessionStorage 超限丢图）=====
  const idbOpen = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open("nippt_pp_big", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const idbPut = async (key: string, val: any): Promise<void> => {
    const db = await idbOpen();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  };
  const idbGet = async (key: string): Promise<any> => {
    const db = await idbOpen();
    const val = await new Promise<any>((res, rej) => {
      const tx = db.transaction("kv", "readonly");
      const rq = tx.objectStore("kv").get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return val;
  };
  const idbDel = async (key: string): Promise<void> => {
    try {
      const db = await idbOpen();
      await new Promise<void>((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
      db.close();
    } catch { /* ignore */ }
  };
  const clearPpDraft = (batchId: string) => {
    try { const d = loadPpDraft(); delete d[batchId]; sessionStorage.setItem(PP_DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  };

  const fetchDetail = async (id: string) => {
    setBatchLoading(true);
    try {
      const res = await (casesApi as any).getPreprocessingBatch(id);
      autoFillExperimentType(res.data);
      setSelectedBatch(res.data);
      // Load photos/persons（男女独立；兼容旧结构：旧 photos/operator_name 归女性）
      const pd = res.data?.processing_data || {};
      const legacyPhotos = Array.isArray(pd.photos) ? pd.photos : [];
      draftSkipRef.current = true;
      setPhotosFSync(Array.isArray(pd.photos_female) ? pd.photos_female : legacyPhotos);
      setPhotosMSync(Array.isArray(pd.photos_male) ? pd.photos_male : []);
      setOperators(prev => ({ ...prev, [id]: pd.operator_female ?? res.data?.operator_name ?? "" }));
      setReviewers(prev => ({ ...prev, [id]: pd.reviewer_female ?? res.data?.reviewer ?? "" }));
      setOperatorsM(prev => ({ ...prev, [id]: pd.operator_male ?? "" }));
      setReviewersM(prev => ({ ...prev, [id]: pd.reviewer_male ?? "" }));
      // 日期/时间（男女独立；旧值归女性）
      setPpDate((pd.pp_date_female ?? pd.pp_date) || "");
      setPpTime((pd.pp_time_female ?? pd.pp_time) || "");
      setPpDateM(pd.pp_date_male || "");
      setPpTimeM(pd.pp_time_male || "");
      // 草稿恢复：人员（sessionStorage）+ 照片（IndexedDB，异步）
      const draft = loadPpDraft()[id];
      if (draft) {
        if (typeof draft.operator_female === "string") setOperators(prev => ({ ...prev, [id]: draft.operator_female }));
        if (typeof draft.reviewer_female === "string") setReviewers(prev => ({ ...prev, [id]: draft.reviewer_female }));
        if (typeof draft.operator_male === "string") setOperatorsM(prev => ({ ...prev, [id]: draft.operator_male }));
        if (typeof draft.reviewer_male === "string") setReviewersM(prev => ({ ...prev, [id]: draft.reviewer_male }));
        if (typeof draft.pp_date_female === "string") setPpDate(draft.pp_date_female);
        if (typeof draft.pp_time_female === "string") setPpTime(draft.pp_time_female);
        if (typeof draft.pp_date_male === "string") setPpDateM(draft.pp_date_male);
        if (typeof draft.pp_time_male === "string") setPpTimeM(draft.pp_time_male);
      }
      idbGet("pp_photos_" + id).then((v) => {
        if (v) {
          if (Array.isArray(v.photosF)) setPhotosFSync(v.photosF);
          if (Array.isArray(v.photosM)) setPhotosMSync(v.photosM);
        }
      }).catch(() => { /* ignore */ });
      setTimeout(() => { draftSkipRef.current = false; }, 0);
    } catch {
      message.error("加载批次详情失败");
    } finally {
      setBatchLoading(false);
    }
  };

  // 草稿写入：人员→sessionStorage；照片→IndexedDB（跳过 fetchDetail/恢复 触发的那次）
  useEffect(() => {
    if (!selectedBatch || draftSkipRef.current) return;
    savePpDraft({
      operator_female: operators[selectedBatch.id] || "",
      reviewer_female: reviewers[selectedBatch.id] || "",
      operator_male: operatorsM[selectedBatch.id] || "",
      reviewer_male: reviewersM[selectedBatch.id] || "",
      pp_date_female: ppDate, pp_time_female: ppTime,
      pp_date_male: ppDateM, pp_time_male: ppTimeM,
    });
    idbPut("pp_photos_" + selectedBatch.id, { photosF, photosM }).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photosF, photosM, operators, reviewers, operatorsM, reviewersM, ppDate, ppTime, ppDateM, ppTimeM, selectedBatch]);

  // ===== New batch =====
  const openNewBatch = async () => {
    try {
      const res = await (casesApi as any).pendingPreprocessing();
      const data = res.data;
      setPendingData(data);
      // Default: select all
      const allIds = new Set<string>();
      for (const e of data.entries) {
        for (const id of e.case_sample_ids) allIds.add(id);
      }
      setSelectedKeys(allIds);
      setPendingSearch("");
      // Generate batch number preview
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const h = String(now.getHours()).padStart(2, "0");
      const prefix = `${y}${m}${d}-${h}`;
      // Count existing batches with this prefix
      try {
        const br = await (casesApi as any).listPreprocessingBatches({ search: prefix });
        const cnt = (br.data?.results || []).filter((b: any) => b.batch_number.startsWith(prefix)).length;
        setBatchNumberPreview(`${prefix}-${String(cnt + 1).padStart(3, "0")}`);
      } catch {
        setBatchNumberPreview(`${prefix}-001`);
      }
      setModalOpen(true);
    } catch {
      message.error("加载待处理样本失败");
    }
  };

  const createBatch = async () => {
    if (selectedKeys.size === 0) {
      message.warning("请至少选择一个样本");
      return;
    }
    try {
      const res = await (casesApi as any).createPreprocessingBatch({
        case_sample_ids: Array.from(selectedKeys),
      });
      message.success(`批次 ${res.data.batch_number} 已创建`);
      setModalOpen(false);
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const toggleAll = (checked: boolean) => {
    if (!pendingData) return;
    if (checked) {
      const all = new Set<string>();
      for (const e of pendingData.entries) {
        for (const id of e.case_sample_ids) all.add(id);
      }
      setSelectedKeys(all);
    } else {
      setSelectedKeys(new Set());
    }
  };

  // ===== Save & Complete =====
  const buildSamplePayload = (samples: PreSample[]) =>
    samples.map(s => ({
      id: s.id,
      sample_condition: s.sample_condition,
      aliquot_tubes: s.aliquot_tubes,
      plasma_volume: s.plasma_volume,
      experiment_sample_type: s.experiment_sample_type,
      elution_volume: s.elution_volume,
      dna_concentration: s.dna_concentration,
      qc_status: s.qc_status,
      qc_note: s.qc_note,
    }));

  /** 保存前校验（side: f=女性 m=男性）：照片+操作人+审核人 */
  const validateBeforeSave = (side: "f" | "m"): string[] => {
    const missing: string[] = [];
    if (!selectedBatch) return missing;
    const who = side === "f" ? "女性" : "男性";
    const ph = side === "f" ? photosFRef.current : photosMRef.current;
    const opMap = side === "f" ? operators : operatorsM;
    const rvMap = side === "f" ? reviewers : reviewersM;
    if (!ph.length) missing.push(`上传${who}实验照片`);
    if (!opMap[selectedBatch.id]) missing.push(`选择${who}操作人`);
    if (!rvMap[selectedBatch.id]) missing.push(`选择${who}审核人`);
    return missing;
  };

  /** 保存（side: f=女性 m=男性）：等待图片处理完成后校验并提交全量 */
  const doSave = async (side: "f" | "m") => {
    if (!selectedBatch) return;
    const who = side === "f" ? "女性" : "男性";
    // 竞态修复：等待所有照片读取/压缩完成再提交
    if (pendingUploads.current.length) {
      setBatchLoading(true);
      await Promise.allSettled(pendingUploads.current);
      setBatchLoading(false);
    }
    // 保存前校验：照片 + 操作人 + 审核人
    const missing = validateBeforeSave(side);
    if (missing.length) { message.warning(`保存前请先：${missing.join("、")}`); return; }
    // 保存前校验：实验样本类型必填
    const samples = side === "f"
      ? selectedBatch.female_samples
      : [...selectedBatch.male_blood_samples, ...selectedBatch.male_other_samples];
    const noType = samples.filter((s) => !s.experiment_sample_type);
    if (noType.length) {
      const names = noType.slice(0, 5).map((s) => s.patient_name).join("、");
      message.warning(`保存前请先填写实验样本类型：${names}${noType.length > 5 ? " 等" : ""}`);
      return;
    }
    try {
      // 全量合并（两边照片/人员都带上，互不覆盖）
      const pd = {
        ...selectedBatch.processing_data,
        photos_female: photosFRef.current,
        photos_male: photosMRef.current,
        operator_female: operators[selectedBatch.id] || "",
        reviewer_female: reviewers[selectedBatch.id] || "",
        operator_male: operatorsM[selectedBatch.id] || "",
        reviewer_male: reviewersM[selectedBatch.id] || "",
        pp_date_female: ppDate, pp_time_female: ppTime,
        pp_date_male: ppDateM, pp_time_male: ppTimeM,
      };
      await (casesApi as any).savePreprocessing(selectedBatch.id, {
        samples: buildSamplePayload(samples),
        processing_data: pd,
      });
      clearPpDraft(selectedBatch.id);
      idbDel("pp_photos_" + selectedBatch.id).catch(() => { /* ignore */ });
      message.success(`${who}保存成功`);
      fetchDetail(selectedBatch.id);
    } catch {
      message.error(`${who}保存失败`);
    }
  };

  const saveFemaleSamples = () => doSave("f");
  const saveMaleSamples = () => doSave("m");

  const completeBatch = async () => {
    if (!selectedBatch) return;
    // ── 完成前校验：有样本的侧必须已保存（实验照片+操作人+审核人）──
    const pd = selectedBatch.processing_data || {};
    const cMissing: string[] = [];
    if ((selectedBatch.female_samples || []).length > 0) {
      if (!pd.operator_female || !pd.reviewer_female || !(pd.photos_female || []).length) cMissing.push("女性");
    }
    if (((selectedBatch.male_blood_samples || []).length + (selectedBatch.male_other_samples || []).length) > 0) {
      if (!pd.operator_male || !pd.reviewer_male || !(pd.photos_male || []).length) cMissing.push("男性");
    }
    if (cMissing.length) {
      message.warning(`完成批次前需先保存：${cMissing.join("、")}实验数据（实验照片+操作人+审核人）`);
      return;
    }
    try {
      await (casesApi as any).completePreprocessing(selectedBatch.id);
      message.success(`批次 ${selectedBatch.batch_number} 已完成`);
      setSelectedBatch(null);
      fetchBatches();
    } catch {
      message.error("操作失败");
    }
  };

  // ===== Field update =====
  const updateSampleField = (sampleId: string, field: string, value: any) => {
    if (!selectedBatch) return;
    const update = (samples: PreSample[]) =>
      samples.map(s => {
        if (s.id !== sampleId) return s;
        const updated = { ...s, [field]: value };
        // Auto-compute remaining_sample_types when experiment type changes
        if (field === "experiment_sample_type") {
          const received = s.received_sample_types || [];
          // 男性血液可分2-3次实验：选"血液"时血液保留在剩余中
          if (value === "BLOOD" && s.category === "MALE_BLOOD" && received.includes("BLOOD")) {
            updated.remaining_sample_types = [...received];
          } else {
            updated.remaining_sample_types = value
              ? received.filter((t: string) => t !== value)
              : received;
          }
        }
        return updated;
      });
    setSelectedBatch({
      ...selectedBatch,
      female_samples: update(selectedBatch.female_samples),
      male_blood_samples: update(selectedBatch.male_blood_samples),
      male_other_samples: update(selectedBatch.male_other_samples),
    });
  };

  // ===== Photo upload（压缩 + 男女分开）=====
  /** 压缩图片：超过 1600px 或 800KB 转 JPEG 0.85 */
  const compressImage = (dataUrl: string): Promise<string> => new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1 && dataUrl.length < 800000) { resolve(dataUrl); return; }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const handlePhotoUpload = (side: "f" | "m", file: File) => {
    setUploading(c => c + 1);
    const p = new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        compressImage(e.target?.result as string)
          .then((url) => {
            if (side === "f") setPhotosFSync([...photosFRef.current, url]);
            else setPhotosMSync([...photosMRef.current, url]);
            resolve();
          })
          .catch(() => resolve());
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
    pendingUploads.current.push(p);
    p.finally(() => {
      pendingUploads.current = pendingUploads.current.filter(x => x !== p);
      setUploading(c => c - 1);
    });
    return false; // Prevent auto upload
  };

  const removePhoto = (side: "f" | "m", index: number) => {
    if (side === "f") setPhotosFSync(photosFRef.current.filter((_, i) => i !== index));
    else setPhotosMSync(photosMRef.current.filter((_, i) => i !== index));
  };

  /** 照片区 + 操作人/审核人（男女各自一套） */
  const renderPhotosPersons = (side: "f" | "m") => {
    if (!selectedBatch) return null;
    const who = side === "f" ? "女性" : "男性";
    const ph = side === "f" ? photosF : photosM;
    const opMap = side === "f" ? operators : operatorsM;
    const setOpMap = side === "f" ? setOperators : setOperatorsM;
    const rvMap = side === "f" ? reviewers : reviewersM;
    const setRvMap = side === "f" ? setReviewers : setReviewersM;
    return (
      <Card size="small" title={`📋 ${who}实验记录`} style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ color: "#666" }}>日期:</span>
          <DatePicker size="small" style={{ width: 130 }} value={(side === "f" ? ppDate : ppDateM) ? dayjs(side === "f" ? ppDate : ppDateM) : null}
            onChange={(d: any) => (side === "f" ? setPpDate : setPpDateM)(d ? d.format("YYYY-MM-DD") : "")} placeholder="选择日期" format="YYYY-MM-DD" />
          <span style={{ color: "#666", marginLeft: 8 }}>时间:</span>
          <TimePicker size="small" style={{ width: 100 }} format="HH:mm" value={(side === "f" ? ppTime : ppTimeM) ? dayjs(side === "f" ? ppTime : ppTimeM, "HH:mm") : null}
            onChange={(d: any) => (side === "f" ? setPpTime : setPpTimeM)(d ? d.format("HH:mm") : "")} placeholder="选择时间" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ph.map((url, i) => (
            <div key={i} style={{ position: "relative", width: 104, height: 104 }}>
              <Image src={url} width={104} height={104} style={{ objectFit: "cover", borderRadius: 4 }} />
              <Button type="text" danger size="small"
                style={{ position: "absolute", top: -8, right: -8, background: "#fff", borderRadius: "50%" }}
                onClick={() => removePhoto(side, i)}>✕</Button>
            </div>
          ))}
          {uploading > 0 && (
            <div style={{ width: 104, height: 104, border: "1px dashed #1677ff", borderRadius: 4,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#1677ff" }}>
              <LoadingOutlined style={{ fontSize: 22 }} />
              <Text style={{ fontSize: 11 }}>处理中…</Text>
            </div>
          )}
          <Upload beforeUpload={(f) => { handlePhotoUpload(side, f); return false; }}
            showUploadList={false} accept="image/*">
            <div style={{
              width: 104, height: 104, border: "1px dashed #d9d9d9", borderRadius: 4,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}>
              <CameraOutlined style={{ fontSize: 24, color: "#999" }} />
              <Text type="secondary" style={{ fontSize: 11 }}>拍照/上传</Text>
            </div>
          </Upload>
        </div>
        <div style={{ marginTop: 12, padding: 8, background: "#fafafa", borderRadius: 4, fontSize: 12 }}>
          <Text type="secondary">操作人: </Text>
          <Select size="small" placeholder="选择" style={{ width: 100 }}
            value={opMap[selectedBatch.id] || undefined}
            onChange={v => setOpMap(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
            {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
          </Select>
          <Text type="secondary" style={{ marginLeft: 16 }}>审核人: </Text>
          <Select size="small" placeholder="选择" style={{ width: 100 }}
            value={rvMap[selectedBatch.id] || undefined}
            onChange={v => setRvMap(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
            {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
          </Select>
          <Button size="small" type="primary" style={{ marginLeft: 16 }}
            onClick={() => doSave(side)}>保存</Button>
        </div>
      </Card>
    );
  };

  // ===== Column builders =====
  const femaleBloodColumns = () => [
    { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 110,
      render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text> },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 80 },
    { title: "样本情况", dataIndex: "sample_condition", key: "cond", width: 110,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "OK"} style={{ width: 90 }}
          placeholder="选择" options={CONDITION_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "sample_condition", val)} allowClear />
      ) },
    { title: "分装管数", dataIndex: "aliquot_tubes", key: "tubes", width: 80,
      render: (v: number, r: PreSample) => (
        <InputNumber size="small" min={1} max={10} value={v} style={{ width: 55 }}
          onChange={(val: number | null) => updateSampleField(r.id, "aliquot_tubes", val || 3)} />
      ) },
    { title: "QC", dataIndex: "qc_status", key: "qc", width: 80,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "PASS"} style={{ width: 70 }}
          onChange={(val: string) => updateSampleField(r.id, "qc_status", val)}
          options={[{ value: "PASS", label: "✅" }, { value: "FAIL", label: "❌" }]} />
      ) },
    { title: "备注", dataIndex: "qc_note", key: "note", width: 120,
      render: (v: string, r: PreSample) => (
        <Input size="small" value={v} placeholder="备注"
          onChange={(e: any) => updateSampleField(r.id, "qc_note", e.target.value)} />
      ) },
  ];

  const maleColumns = () => [
    { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 110,
      render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text> },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 80 },
    { title: "样本情况", dataIndex: "sample_condition", key: "cond", width: 110,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "OK"} style={{ width: 90 }}
          placeholder="选择" options={CONDITION_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "sample_condition", val)} allowClear />
      ) },
    { title: "收到样本类型", dataIndex: "received_sample_types", key: "rst", width: 150,
      render: (v: string[]) => (
        <Space size={2} wrap>{v.map(t => {
          const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === t);
          return <Tag key={t} color="blue">{opt?.label || t}</Tag>;
        })}</Space>
      ) },
    { title: "实验样本类型", dataIndex: "experiment_sample_type", key: "est", width: 130,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || undefined} style={{ width: 100 }}
          placeholder="选择" options={SAMPLE_TYPE_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "experiment_sample_type", val)} allowClear />
      ) },
    { title: "剩余样本类型", dataIndex: "remaining_sample_types", key: "rest", width: 150,
      render: (v: string[], r: PreSample) => (
        <Select mode="multiple" size="small" value={v || []}
          style={{ width: 130 }} placeholder="默认"
          options={SAMPLE_TYPE_OPTIONS}
          onChange={(val: string[]) => updateSampleField(r.id, "remaining_sample_types", val)}
          allowClear maxTagCount={2} />
      ) },
    { title: "QC", dataIndex: "qc_status", key: "qc", width: 80,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "PASS"} style={{ width: 70 }}
          onChange={(val: string) => updateSampleField(r.id, "qc_status", val)}
          options={[{ value: "PASS", label: "✅" }, { value: "FAIL", label: "❌" }]} />
      ) },
    { title: "备注", dataIndex: "qc_note", key: "note", width: 120,
      render: (v: string, r: PreSample) => (
        <Input size="small" value={v} placeholder="备注"
          onChange={(e: any) => updateSampleField(r.id, "qc_note", e.target.value)} />
      ) },
  ];

  // ===== Render =====
  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", gap: 12 }}>
      {/* Sidebar */}
      <Card size="small" style={{
        width: sidebarCollapsed ? 50 : 380, flexShrink: 0,
        transition: "width 0.25s", overflow: "hidden",
      }}
        title={sidebarCollapsed ? undefined : "前处理批次"}
        extra={<Button type="text" size="small"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}
      >
        {!sidebarCollapsed && (
          <>
            <Button type="primary" icon={<PlusOutlined />} block onClick={openNewBatch} style={{ marginBottom: 8 }}>
              新建批次
            </Button>
            <Table dataSource={batches} rowKey="id" loading={loading} size="small"
              pagination={false} scroll={{ y: "calc(100vh - 280px)" }}
              onRow={(r: BatchItem) => ({
                onClick: () => fetchDetail(r.id),
                style: { background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined, cursor: "pointer" },
              })}
              columns={[
                { title: "批次号", dataIndex: "batch_number", key: "bn", width: 140,
                  render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                { title: "状态", dataIndex: "status", key: "st", width: 60,
                  render: (v: string) => {
                    const c: Record<string, string> = { DRAFT: "default", IN_PROGRESS: "blue", COMPLETED: "green" };
                    const l: Record<string, string> = { DRAFT: "待处理", IN_PROGRESS: "处理中", COMPLETED: "已完成" };
                    return <Tag color={c[v] || "default"}>{l[v] || v}</Tag>;
                  } },
                { title: "样本", key: "cnt", width: 100,
                  render: (_: any, r: BatchItem) => (
                    <Text style={{ fontSize: 11 }}>👩{r.female_count} 👨{r.male_blood_count + r.male_other_count}</Text>
                  ) },
              ]}
            />
          </>
        )}
      </Card>

      {/* Main area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedBatch ? (
          <Card size="small" title={
            <Space>
              <Text strong>{selectedBatch.batch_number}</Text>
              <Tag color={selectedBatch.status === "COMPLETED" ? "green" : selectedBatch.status === "IN_PROGRESS" ? "blue" : "default"}>
                {selectedBatch.status_display}
              </Tag>
            </Space>
          } extra={
            <Space>
              <Button icon={<ReloadOutlined />} size="small" loading={batchLoading}
                onClick={() => fetchDetail(selectedBatch.id)}>刷新</Button>
              <Button type="primary" size="small"
                onClick={saveFemaleSamples} loading={batchLoading}>💾 保存女性</Button>
              <Button size="small"
                onClick={saveMaleSamples} loading={batchLoading}>💾 保存男性</Button>
              {selectedBatch.status !== "COMPLETED" && (<>
                <Popconfirm title="确定删除该批次？样本将回到待处理" onConfirm={() => deleteBatch(selectedBatch.id, selectedBatch.batch_number)}>
                  <Button type="primary" size="small" danger>删除批次</Button>
                </Popconfirm>
                <Popconfirm title="确定完成该批次？合格样本将进入后续实验" onConfirm={completeBatch}>
                  <Button type="primary" size="small">完成批次</Button>
                </Popconfirm>
              </>)}
            </Space>
          }>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
              {
                key: "female",
                label: `👩 女性 (${selectedBatch.female_count})`,
                children: (
                  <>
                    <Table dataSource={selectedBatch.female_samples} rowKey="id"
                      columns={femaleBloodColumns()} size="small" pagination={false} scroll={{ x: 600 }} />
                    {renderPhotosPersons("f")}
                  </>
                ),
              },
              {
                key: "male",
                label: `👨 男性 (${selectedBatch.male_blood_count + selectedBatch.male_other_count})`,
                children: (
                  <>
                  {selectedBatch.male_blood_count + selectedBatch.male_other_count > 0 ? (
                    <Table dataSource={[...(selectedBatch.male_blood_samples || []), ...(selectedBatch.male_other_samples || [])]} rowKey="id"
                      columns={maleColumns()} size="small" pagination={false} scroll={{ x: 900 }} />
                  ) : (
                    <Text type="secondary">无男性样本</Text>
                  )}
                  {renderPhotosPersons("m")}
                  </>
                ),
              },
            ]} />

          </Card>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
            <Title level={5} type="secondary">选择左侧批次查看详情</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNewBatch}>
              新建前处理批次
            </Button>
          </div>
        )}
      </div>

      {/* New Batch Modal */}
      <Modal title="新建前处理批次" open={modalOpen} onOk={createBatch}
        onCancel={() => setModalOpen(false)} width={700}
        okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData && (
          <div>
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f6ffed", borderRadius: 6 }}>
              <Text strong>批次号：</Text>
              <Text code style={{ fontSize: 16 }}>{batchNumberPreview}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>（自动生成）</Text>
            </div>
            <Input.Search placeholder="搜索姓名/PT号/Case号..." allowClear
              value={pendingSearch} onChange={(e: any) => setPendingSearch(e.target.value)}
              style={{ marginBottom: 8 }} />
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Space>
                <Tag color="magenta">👩 女性: {pendingData.female_count}</Tag>
                <Tag color="blue">👨 男性: {pendingData.male_blood_count + pendingData.male_other_count}</Tag>
              </Space>
              <Space>
                <Button size="small" onClick={() => toggleAll(true)}>全选</Button>
                <Button size="small" onClick={() => toggleAll(false)}>取消全选</Button>
              </Space>
            </div>
            <Divider style={{ margin: "8px 0" }} />
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              {(["FEMALE_BLOOD", "MALE"] as const).map(cat => {
                const entries = pendingData.entries.filter(e =>
                  (cat === "FEMALE_BLOOD" ? e.category === "FEMALE_BLOOD" : e.category !== "FEMALE_BLOOD") &&
                  (!pendingSearch || e.patient_name.includes(pendingSearch) ||
                   e.case_number.includes(pendingSearch) ||
                   (e.test_sample_id || "").includes(pendingSearch))
                );
                if (entries.length === 0) return null;
                const isMale = cat !== "FEMALE_BLOOD";
                const catLabel = isMale ? "👨 男性" : "👩 女性";

  return (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: 13 }}>{catLabel} ({entries.length})</Text>
                    {entries.map(e => {
                      const allIn = e.case_sample_ids.every((id: string) => selectedKeys.has(id));
                      const someIn = e.case_sample_ids.some((id: string) => selectedKeys.has(id));

  return (
                        <div key={e.case_sample_ids.join(",")} style={{
                          padding: "6px 8px", borderBottom: "1px solid #f0f0f0",
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <Checkbox checked={allIn} indeterminate={!allIn && someIn}
                            onChange={() => {
                              setSelectedKeys(prev => {
                                const next = new Set(prev);
                                if (allIn) {
                                  e.case_sample_ids.forEach((id: string) => next.delete(id));
                                } else {
                                  e.case_sample_ids.forEach((id: string) => next.add(id));
                                }
                                return next;
                              });
                            }} />
                          <Text code style={{ fontSize: 11, width: 150 }}>{e.case_number}</Text>
                          {e.test_sample_id ? (
                            <Tag color="blue" style={{ fontSize: 11, minWidth: 90, textAlign: "center", marginRight: 0 }}>{e.test_sample_id}</Tag>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 11, minWidth: 90, textAlign: "center" }}>-</Text>
                          )}
                          <Text strong>{e.patient_name}</Text>
                          <Space size={2} wrap>
                            {e.sample_types.map((t: string) => {
                              const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === t);
                              return <Tag key={t} color="green" style={{ fontSize: 10 }}>{opt?.label || t}</Tag>;
                            })}
                          </Space>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
