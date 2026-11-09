// NipptExtraction.tsx — DNA Extraction module (refactored: NIPT-style 3 methods)
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Alert,
  Tooltip,
  ConfigProvider, Card, Table, Button, Tag, Tabs, Modal, message, Typography,
  Input, Select, InputNumber, Space, Popconfirm, Radio,
  Checkbox, Divider, Upload, Image, DatePicker, TimePicker, Popover,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, CheckOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined,
  CameraOutlined, LoadingOutlined, DownloadOutlined, SwapOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
import { uploadNipptPhoto, deleteNipptPhoto, migrateLegacyNipptPhotos, isRemotePhoto } from "../utils/nipptPhoto";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { confirmBatchDelete } from "../utils/batchDelete";


/* ── 男性样本排序（2026-10-12 调整）────────────────────────────────────────────
   原：血液组在前 + 其他组在后（先分样本类型，再各自按 PT 排）
   新：不再分类型，统一按 PT 号排（位数 → 数值）；HA 与普通样本一起正常排序，
       HB 一律排到最后（多个 HB 之间仍按 PT 排）。
   ⚠️ 仅对未完成批次生效：已完成批次保持原顺序（保护历史孔板图，与后端规则一致）。
   ⚠️ 仅改变顺序，不影响 HA/HB 各自独立成样本/独立完成的规则。 */
const PT_HB = /HB(?:_[RT]\d+)*$/;
const ptSortKey = (s: any) => {
  const t = String(s?.test_sample_id || "");
  const m = /PT(\d+)/.exec(t);
  return { len: m ? m[1].length : Number.MAX_SAFE_INTEGER, num: m ? Number(m[1]) : 0, s: t };
};
function maleOrder<T = any>(d: any): T[] {
  const raw = [...(d?.male_blood_samples || []), ...(d?.male_other_samples || [])];
  // 已完成批次保持后端原始顺序：历史板图现在由 plate_layout 快照保证（见 snapPlateLayout），
  // 不再依赖这里的排序；改排序会让历史已完成批次的显示集体变化，故维持原样。
  if (!d || d.status === "COMPLETED") return raw;
  return raw.sort((a: any, b: any) => {
    const ah = PT_HB.test(String(a?.test_sample_id || "")) ? 1 : 0;
    const bh = PT_HB.test(String(b?.test_sample_id || "")) ? 1 : 0;
    if (ah !== bh) return ah - bh;                  // HB 一律排最后
    const ka = ptSortKey(a), kb = ptSortKey(b);
    if (ka.len !== kb.len) return ka.len - kb.len;  // 位数优先（与后端 Length(pt_number) 口径一致）
    if (ka.num !== kb.num) return ka.num - kb.num;
    return ka.s.localeCompare(kb.s, "en", { numeric: true });
  });
}


const { Text, Title } = Typography;
const { TextArea } = Input;

/** 2026-11-09：提取试剂盒支持多选（每个试剂盒各自一套批号/有效期） */
const KIT_OPTIONS = [
  { value: "MAGEN_CFDNA", label: "Magen cfDNA提取试剂盒 (12919w-480)" },
  { value: "MAGEN_ROUND", label: "Magen磁珠法DNA提取试剂盒-圆底 (MD5432-TL-06C)" },
  { value: "MAGEN_CONICAL", label: "Magen磁珠法DNA提取试剂盒-锥底 (MD5432-TL-06C)" },
];
/** 设备（2026-11-09 改）：按签收地给不同设备号
 *  · 厦门：金属浴 YSFH-EI-010-03、Qubit YSFH-EI-021-03（各一个）
 *  · 香港：金属浴 VBL-DB-01 / VBL-TS-01（可多选）、Qubit VBL-QB-03、核酸提取仪 VBL-ANAES-01-圆底 / -02-锥底（可多选）
 *  多选值用「、」拼接存储；def = 该地区没有历史值时的默认勾选（空 = 人工选）
 */
type DevItem = {
  key: "dev_metal" | "dev_qubit" | "dev_extractor";
  label: string;
  options: string[];
  def: string[];
  multi?: boolean;
  width?: number;
};
const DEVICE_BY_REGION: Record<"XIAMEN" | "HONGKONG", DevItem[]> = {
  XIAMEN: [
    { key: "dev_metal", label: "金属浴", options: ["YSFH-EI-010-03"], def: ["YSFH-EI-010-03"], width: 170 },
    { key: "dev_qubit", label: "Qubit定量仪", options: ["YSFH-EI-021-03"], def: ["YSFH-EI-021-03"], width: 170 },
  ],
  HONGKONG: [
    { key: "dev_metal", label: "金属浴", options: ["VBL-DB-01", "VBL-TS-01"], def: [], multi: true, width: 210 },
    { key: "dev_qubit", label: "Qubit定量仪", options: ["VBL-QB-03"], def: ["VBL-QB-03"], width: 170 },
    { key: "dev_extractor", label: "核酸提取仪", options: ["VBL-ANAES-01-圆底", "VBL-ANAES-02-锥底"],
      def: [], multi: true, width: 300 },
  ],
};
const DEVICE_ALL_LABEL: Record<string, string> = {
  dev_metal: "金属浴", dev_qubit: "Qubit定量仪", dev_extractor: "核酸提取仪",
};
/** "、"拼接 ↔ 数组 */
const splitDev = (v: any): string[] =>
  Array.isArray(v) ? v.filter(Boolean) : String(v || "").split("、").map((x) => x.trim()).filter(Boolean);
const joinDev = (arr?: string[] | null): string => (arr || []).filter(Boolean).join("、");

/** 男性侧固定定量试剂（2026-11-09） */
const QUANT_KIT_CODE = "VAHTS_DSDNA_HS";
const QUANT_KIT_LABEL = "VAHTS 1×dsDNA HS Assay Kit (EQ121-02)";

const KIT_LABEL: Record<string, string> = KIT_OPTIONS.reduce(
  (m, o) => ({ ...m, [o.value]: o.label }), {} as Record<string, string>);

const EXTRACTION_METHODS = [
  { value: "MANUAL", label: "手工" },
  { value: "MAGNETIC_ROD", label: "磁棒法" },
  { value: "AUTOMATED", label: "自动化" },
];

const SAMPLE_TYPE_LABELS: Record<string, string> = {
  BLOOD: "血液", DBS: "血痕", HAIR: "毛发", NAIL: "指甲",
  SWAB: "口拭子", SEMEN: "精液", TOOTHBRUSH: "牙刷",
  CIGARETTE: "烟头", BOTTLE: "水瓶",
  BEARD: "胡须", FLOSS: "牙线", SEMSTAIN: "精斑", GUM: "口香糖",
};

/** 2026-11-05（用户口径）：DNA浓度输入框按回车 → 焦点跳到「同一列的下一个样本」。
 *  兼容两种 DOM 落点：antd InputNumber 会把未知 props 透传到**内层 <input> 本身**
 *  （rc-input-number: inputProps 展开在 <input> 上），也可能落在包裹层，
 *  所以统一按 data-conc 分组取元素，再找行号更大的第一个。 */
const focusNextConcInput = (group: string, row: number) => {
  const toInput = (n: HTMLElement) =>
    (n instanceof HTMLInputElement ? n : n.querySelector("input")) as HTMLInputElement | null;
  const next = Array.from(document.querySelectorAll<HTMLElement>(`[data-conc="${group}"]`))
    .map(n => ({ r: Number(n.getAttribute("data-row")), input: toInput(n) }))
    .filter(x => !!x.input && Number.isFinite(x.r) && x.r > row)
    .sort((a, b) => a.r - b.r)[0];
  if (!next?.input) return;
  next.input.focus();
  next.input.select();
};

/** 按磁棒法规则生成板位（与 buildMagneticPlates 的 filling 完全一致）：
 *  每板先 1 列 A-H，再 7 列 A-H；跳过孔不进。
 *  2026-11-06：完成批次时把它存进 extraction_data.plate_layout，
 *  板位从此是「数据」而不是「每次按顺序现算」，不会再因排序/样本变动而漂。 */
function rulePlateLayout(samples: any[], skipMap: Record<number, string>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let si = 0, pi = 0;
  while (si < samples.length) {
    let skips = new Set(
      String((skipMap || {})[pi] || "").split(",").map((x) => x.trim().toUpperCase())
        .filter((x) => /^[A-H](1[0-2]|[1-9])$/.test(x))
    );
    // 与页面一致：跳过孔位把上样孔占满 → 视为无效配置，按常规排
    const loadWells = [...ROWS_8.map((r) => `${r}1`), ...ROWS_8.map((r) => `${r}7`)];
    if (loadWells.every((w) => skips.has(w))) skips = new Set();
    const cells: Record<string, string> = {};
    for (const r of ROWS_8) if (!skips.has(`${r}1`) && si < samples.length) cells[`${r}1`] = samples[si++].id;
    for (const r of ROWS_8) if (!skips.has(`${r}7`) && si < samples.length) cells[`${r}7`] = samples[si++].id;
    if (!Object.keys(cells).length) break;
    out[String(pi)] = cells;
    pi++;
  }
  return out;
}

/** 已有板位仍覆盖当前样本集合 → 保留（尊重手动拖动）；否则按规则重算 */
function snapPlateLayout(samples: any[], method: string, skipMap: Record<number, string>,
                         existing: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  if (String(method || "").toUpperCase() !== "MAGNETIC_ROD") return existing || {};
  const ids = new Set(samples.map((s) => String(s.id)));
  const layIds = new Set(Object.values(existing || {}).flatMap((m) => Object.values(m || {}))
    .filter(Boolean).map(String));
  const sameSet = layIds.size > 0 && layIds.size === ids.size && [...layIds].every((i) => ids.has(i));
  return sameSet ? existing : rulePlateLayout(samples, skipMap);
}

const ROWS_8 = ["A","B","C","D","E","F","G","H"];
const COLS_12 = [1,2,3,4,5,6,7,8,9,10,11,12];

const STEPS = [
  { key: "reagent_warm", label: "试剂平衡至室温" },
  { key: "equipment_check", label: "检查设备运行状态" },
  { key: "supplies_ready", label: "准备耗材" },
  { key: "uv_prep", label: "紫外照射" },
  { key: "on_machine", label: "上机" },
];

// ── Types ──
interface ExtractionSample {
  id: string; patient_name: string; role: string; category: string;
  case_sample_ids: string[]; test_sample_id: string | null; redo_count?: number;
  extraction_method: string; well_position: string;
  plasma_volume: number | null; elution_volume: number;
  dna_concentration: number | null; aliquot_tubes: number;
  is_qc: boolean; qc_status: string; qc_note: string;
  sample_types?: string[];
}
interface BatchItem {
  id: string; batch_number: string; status: string;
  status_display: string; sample_count: number;
  female_count: number; male_blood_count: number; male_other_count: number;
  created_at: string;
  receipt_location?: string;
  photos_pending?: boolean;   // 已完成但缺实验照片 → 「📷 待补照片」
}
interface BatchDetail extends BatchItem {
  female_samples: ExtractionSample[];
  male_blood_samples: ExtractionSample[];
  male_other_samples: ExtractionSample[];
  extraction_data: any;
  operator?: string; reviewer?: string; experiment_time?: string;
}
interface QCandidate {
  id: string; patient_name: string; case_number: string;
  test_sample_id: string | null; aliquot_tubes: number;
}

export default function NipptExtraction() {
  // ── Layout state ──
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("female");

  // ── New batch modal ──
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  // 新建批次弹窗：候选样本排序口径 —— "pt"=按 PT 编号（默认）| "case"=按 Case 编号
  const [pendingSort, setPendingSort] = useState<"pt" | "case">("pt");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingLoc, setPendingLoc] = useState<string | undefined>(undefined);
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [qcSearch, setQcSearch] = useState("");
  const [qcCandidates, setQcCandidates] = useState<QCandidate[]>([]);
  const [selectedQC, setSelectedQC] = useState<QCandidate | null>(null);
  const [qcSearching, setQcSearching] = useState(false);

  // ── Extraction data (per-gender) ──
  const [femaleMethod, setFemaleMethod] = useState("");
  const [maleMethod, setMaleMethod] = useState("");
  // 实验记录（设备/试剂盒/批号/有效期/温湿度）——男女各自一套（2026-10-19 解耦）
  type KitRow = { kit: string; lot: string; expiry?: any };
  type ReagentInfo = { equipment?: string; dev_metal?: string; dev_qubit?: string; dev_extractor?: string; dev_extra?: string;
    kit_type?: any; reagent_lot?: string; reagent_expiry?: any;
    kits?: KitRow[]; quant_lot?: string; quant_expiry?: any;
    temperature?: number | null; humidity?: number | null };
  const [reagentF, setReagentF] = useState<ReagentInfo>({});
  const [reagentM, setReagentM] = useState<ReagentInfo>({});
  // 每种试剂盒「该地区（厦门/香港）最近一次保存」的批号/有效期 → 选中时自动带入
  // 结构：{ XIAMEN: {kit: {lot,expiry}}, HONGKONG: {...}, "": {...} }
  type LotInfo = { lot?: string; expiry?: string; saved_at?: string };
  const kitLotsRef = useRef<Record<string, Record<string, LotInfo>>>({});
  // 设备号记忆（金属浴/Qubit）——同样按地区分
  const deviceNosRef = useRef<Record<string, Record<string, { no?: string }>>>({});
  /** 批次签收地 → 记忆桶 key（厦门/香港）；混地区或未知 → ""（不自动带值） */
  const regionKeyOf = (loc?: string): "XIAMEN" | "HONGKONG" | "" => {
    const t = String(loc || "");
    if (!t || t.includes("/")) return "";      // 混地区（香港/厦门）
    if (t.includes("香港") || t.toUpperCase().includes("HONGKONG")) return "HONGKONG";
    if (t.includes("厦门") || t.toUpperCase().includes("XIAMEN")) return "XIAMEN";
    return "";
  };
  /** 该地区上次的试剂盒批号/有效期；混地区/未知批次 → 空（用户要求：这种批次人工填） */
  const kitLotsFor = (loc?: string): Record<string, LotInfo> => {
    const k = regionKeyOf(loc);
    if (!k) return {};
    return (kitLotsRef.current || {})[k] || {};
  };
  /** 该批次的设备项（混地区/无签收地 → 两地并集，且不设默认值） */
  const devItemsFor = (loc?: string): DevItem[] => {
    const k = regionKeyOf(loc);
    if (k) return DEVICE_BY_REGION[k];
    const merged = new Map<string, DevItem>();
    [...DEVICE_BY_REGION.XIAMEN, ...DEVICE_BY_REGION.HONGKONG].forEach((it) => {
      const cur = merged.get(it.key);
      if (!cur) merged.set(it.key, { ...it, def: [], options: [...it.options], multi: true });
      else {
        cur.options = Array.from(new Set([...cur.options, ...it.options]));
        cur.multi = true;
      }
    });
    return Array.from(merged.values());
  };

  /** 核酸提取仪与试剂盒联动（只有香港有）：圆底→01-圆底、锥底→02-锥底 */
  const syncExtractor = (kits: KitRow[], loc?: string): string | undefined => {
    if (regionKeyOf(loc) !== "HONGKONG") return undefined;
    const has = (k: string) => (kits || []).some((r) => r.kit === k);
    const want: string[] = [];
    if (has("MAGEN_ROUND")) want.push("VBL-ANAES-01-圆底");
    if (has("MAGEN_CONICAL")) want.push("VBL-ANAES-02-锥底");
    return joinDev(want);
  };

  /** 该地区上次的设备编号 */
  const deviceNosFor = (loc?: string): Record<string, { no?: string }> => {
    const k = regionKeyOf(loc);
    if (!k) return {};
    return (deviceNosRef.current || {})[k] || {};
  };

  // 打开页面拉一次：选中试剂盒时自动带入上次的批号/有效期；设备号同理
  useEffect(() => {
    (async () => {
      try {
        const r = await (casesApi as any).extractionKitLots?.();
        const data = (r && r.data) || {};
        kitLotsRef.current = data;
      } catch { /* 读不到就不带入，不影响手工填写 */ }
      try {
        const r2 = await (casesApi as any).extractionDeviceNos?.();
        deviceNosRef.current = (r2 && r2.data) || {};
      } catch { /* 同上 */ }
    })();
  }, []);
  const [stepConfirmations, setStepConfirmations] = useState<Record<string, boolean>>({});
  // 照片（男女独立）
  const [photosF, setPhotosF] = useState<string[]>([]);
  const [photosM, setPhotosM] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const pendingUploads = useRef<Promise<void>[]>([]);
  // 待删除的照片（保存成功后才真正删文件）
  const pendingPhotoDeletes = useRef<{ side: "f" | "m"; url: string }[]>([]);
  const photosFRef = useRef<string[]>([]);
  const photosMRef = useRef<string[]>([]);
  const setPhotosFSync = (next: string[]) => { photosFRef.current = next; setPhotosF(next); };
  const setPhotosMSync = (next: string[]) => { photosMRef.current = next; setPhotosM(next); };
  // 日期/时间（男女独立）
  const [dateF, setDateF] = useState<string>("");
  const [timeF, setTimeF] = useState<string>("");
  const [dateM, setDateM] = useState<string>("");
  const [timeM, setTimeM] = useState<string>("");
const PERSONS = ["吴书凌","叶丽婷","何家宇","胡煜敏","付慧珠","杜兴琼","龙雨青","张斯栋","郭爽洁","林琦","林洋鸿","杨思婷","李彩娟"];

/** 操作人/审核人：多选（数组）↔ 存储文本（顿号分隔；兼容历史单值） */
const joinPersons = (v?: string[] | string | null): string =>
  Array.isArray(v) ? v.filter(Boolean).join("、") : (v || "");
const splitPersons = (v?: string | string[] | null): string[] =>
  Array.isArray(v) ? v.filter(Boolean)
    : (v || "").split("、").map((x: string) => x.trim()).filter(Boolean);


// 签收地（receipt_location）：厦门 / 香港
const LOC_OPTIONS = [
  { label: "厦门", value: "XIAMEN" },
  { label: "香港", value: "HONGKONG" },
];
const LOC_LABEL: Record<string, string> = { XIAMEN: "厦门", HONGKONG: "香港" };

// 女性操作人/审核人
const [operators, setOperators] = useState<Record<string,string[]>>({});
const [reviewers, setReviewers] = useState<Record<string,string[]>>({});
// 男性操作人/审核人
const [operatorsM, setOperatorsM] = useState<Record<string,string[]>>({});
const [reviewersM, setReviewersM] = useState<Record<string,string[]>>({});
  // sampleResults: { [sampleId]: { status: "pass"|"fail", note: string, concentration?: number } }
  const [femaleResults, setFemaleResults] = useState<Record<string, any>>({});
  const [maleResults, setMaleResults] = useState<Record<string, any>>({});
  // MAGNETIC_ROD state
  const [femaleSkipCoords, setFemaleSkipCoords] = useState<Record<number, string>>({});
  const [maleSkipCoords, setMaleSkipCoords] = useState<Record<number, string>>({});
  const [femaleKitTypes, setFemaleKitTypes] = useState<Record<number, string>>({});
  const [maleKitTypes, setMaleKitTypes] = useState<Record<number, string>>({});
  // 磁棒法板拖动换位后的位置覆盖：{ "板号": { "孔位(A1..H12)": "样本id" } }
  const [femalePlateLayout, setFemalePlateLayout] = useState<Record<string, Record<string, string>>>({});
  const [malePlateLayout, setMalePlateLayout] = useState<Record<string, Record<string, string>>>({});
  const [magneticDragOver, setMagneticDragOver] = useState<{ pi: number; well: string } | null>(null);
  const magneticDragRef = useRef<{ pi: number; well: string } | null>(null);
  const femaleMagneticNotes = useRef<Record<string, string>>({});
  const maleMagneticNotes = useRef<Record<string, string>>({});
  const [femaleManualNotes, setFemaleManualNotes] = useState("");
  const [maleManualNotes, setMaleManualNotes] = useState("");
  const [femaleAutoNotes, setFemaleAutoNotes] = useState("");
  const [maleAutoNotes, setMaleAutoNotes] = useState("");

  // ── Data fetching ──
  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try { const res = await (casesApi as any).listExtractionBatches(); setBatches(res.data?.results || []); }
    catch { /* silent */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchDetail = async (id: string) => {
    setBatchLoading(true);
    try {
      const res = await (casesApi as any).getExtractionBatch(id);
      const d = res.data;
      setSelectedBatch(d);
      const ed = d.extraction_data || {};
      // Female
      const fed = ed.female || {};
      setFemaleMethod(fed.method || "");
      setFemaleResults(fed.sample_results || {});
      setFemaleSkipCoords(fed.plate_skip_coords || {});
      setFemaleKitTypes(fed.plate_kit_types || {});
      setFemalePlateLayout(fed.plate_layout || {});
      femaleMagneticNotes.current = fed.magnetic_notes || {};
      setFemaleManualNotes(fed.manual_notes || "");
      setFemaleAutoNotes(fed.auto_notes || "");
      // Male
      const med = ed.male || {};
      setMaleMethod(med.method || "");
      setMaleResults(med.sample_results || {});
      setMaleSkipCoords(med.plate_skip_coords || {});
      setMaleKitTypes(med.plate_kit_types || {});
      setMalePlateLayout(med.plate_layout || {});
      maleMagneticNotes.current = med.magnetic_notes || {};
      setMaleManualNotes(med.manual_notes || "");
      setMaleAutoNotes(med.auto_notes || "");
      // Shared
      setStepConfirmations(ed.step_confirmations || {});
      // 照片（男女独立；旧 photos 归女性）
      const legacyPhotos = Array.isArray(ed.photos) ? ed.photos : [];
      const _pf = Array.isArray(ed.photos_female) ? ed.photos_female : legacyPhotos;
      const _pm = Array.isArray(ed.photos_male) ? ed.photos_male : [];
      setPhotosFSync(_pf);
      setPhotosMSync(_pm);
      // 历史 base64 照片后台迁移为 URL（幂等：同内容复用同一文件；失败保持 base64）
      migrateLegacyNipptPhotos("extraction", id, "f", _pf, setPhotosFSync);
      migrateLegacyNipptPhotos("extraction", id, "m", _pm, setPhotosMSync);
      // 人员（男女独立；旧批次字段归女性）
      setOperators(prev => ({ ...prev, [id]: splitPersons(ed.operator_female ?? d.operator_name) }));
      setReviewers(prev => ({ ...prev, [id]: splitPersons(ed.reviewer_female ?? d.reviewer) }));
      setOperatorsM(prev => ({ ...prev, [id]: splitPersons(ed.operator_male) }));
      setReviewersM(prev => ({ ...prev, [id]: splitPersons(ed.reviewer_male) }));
      // 日期/时间（男女独立；旧值归女性；未完成批次空值默认当前时间）
      const _exNotDone = d.status !== "COMPLETED";
      const _exD0 = dayjs().format("YYYY-MM-DD"), _exT0 = dayjs().format("HH:mm");
      setDateF(fed.extraction_date ?? ed.extraction_date ?? (_exNotDone ? _exD0 : ""));
      setTimeF(fed.extraction_time ?? ed.extraction_time ?? (_exNotDone ? _exT0 : ""));
      setDateM(med.extraction_date ?? (_exNotDone ? _exD0 : ""));
      setTimeM(med.extraction_time ?? (_exNotDone ? _exT0 : ""));
      // 试剂盒多选：新数据读 kits；旧数据（单选 kit_type + 一个批号/有效期）自动转成一行
      const pickKits = (sec: any, legacy: any): KitRow[] => {
        const arr = Array.isArray(sec?.kits) ? sec.kits.filter((x: any) => x && x.kit) : [];
        const rows = arr.length ? arr : (sec?.kit_type ? [{ kit: sec.kit_type, lot: sec.reagent_lot, expiry: sec.reagent_expiry }]
          : (legacy?.kit_type ? [{ kit: legacy.kit_type, lot: legacy.reagent_lot, expiry: legacy.reagent_expiry }] : []));
        return rows.map((x: any) => ({
          kit: x.kit, lot: x.lot || "",
          expiry: x.expiry ? dayjs(x.expiry) : undefined,
        }));
      };
      const _dev = (sec: any) => {
        // 2026-11-09：设备号按批次签收地取（厦门/香港各有自己的设备清单）
        // 取值顺序：本批次已存的值 > 该地区上次保存的值 > 该地区默认（香港金属浴默认空）
        const mem: any = deviceNosFor(d.receipt_location);
        const out: any = {};
        devItemsFor(d.receipt_location).forEach((it) => {
          const own = splitDev(sec?.[it.key]);
          const remembered = splitDev(mem?.[it.key]?.no);
          out[it.key] = joinDev(own.length ? own : (remembered.length ? remembered : it.def));
        });
        return out;
      };
      const _devF = _dev(fed);
      const _devM = _dev(med);
      setReagentF({
        ..._devF,
        equipment: fed.equipment ?? ed.equipment ?? "",
        kits: pickKits(fed, ed),
        kit_type: fed.kit_type ?? ed.kit_type ?? undefined,
        reagent_lot: fed.reagent_lot ?? ed.reagent_lot ?? "",
        reagent_expiry: fed.reagent_expiry ? dayjs(fed.reagent_expiry) : (ed.reagent_expiry ? dayjs(ed.reagent_expiry) : undefined),
        temperature: fed.temperature ?? ed.temperature ?? null,
        humidity: fed.humidity ?? ed.humidity ?? null,
      });
      const _q = kitLotsFor(d.receipt_location)[QUANT_KIT_CODE] || {};
      const _exNotDoneM = d.status !== "COMPLETED";
      setReagentM({
        ..._devM,
        equipment: med.equipment ?? ed.equipment ?? "",
        kits: pickKits(med, ed),
        quant_lot: med.quant_lot || (_exNotDoneM ? (_q.lot || "") : ""),
        quant_expiry: med.quant_expiry ? dayjs(med.quant_expiry)
          : (_exNotDoneM && _q.expiry ? dayjs(_q.expiry) : undefined),
        kit_type: med.kit_type ?? ed.kit_type ?? undefined,
        reagent_lot: med.reagent_lot ?? ed.reagent_lot ?? "",
        reagent_expiry: med.reagent_expiry ? dayjs(med.reagent_expiry) : (ed.reagent_expiry ? dayjs(ed.reagent_expiry) : undefined),
        temperature: med.temperature ?? ed.temperature ?? null,
        humidity: med.humidity ?? ed.humidity ?? null,
      });
    } catch { message.error("加载批次详情失败"); }
    finally { setBatchLoading(false); }
  };

  // ── New batch ──
  const openNewBatch = async () => {
    try {
      const res = await (casesApi as any).pendingExtraction();
      const data = res.data; setPendingData(data);
      const allIds = new Set<string>();
      for (const e of data.entries) for (const id of e.case_sample_ids) allIds.add(id);
      setSelectedKeys(allIds); setPendingSearch(""); setSelectedQC(null); setQcSearch(""); setQcCandidates([]);
      // 2026-10-21：不再预载质控候选列表（太长）；改为输入关键字才搜索
      const now = new Date();
      const prefix = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}`;
      try {
        const br = await (casesApi as any).listExtractionBatches({ search: prefix });
        const cnt = (br.data?.results || []).filter((b: any) => b.batch_number.startsWith(prefix)).length;
        setBatchNumberPreview(`${prefix}-${String(cnt + 1).padStart(3, "0")}`);
      } catch { setBatchNumberPreview(`${prefix}-001`); }
      setModalOpen(true);
    } catch { message.error("加载待提取样本失败"); }
  };

  const searchQC = async (val: string) => {
    setQcSearch(val);
    // 2026-10-21：只有输入关键字才查询；清空即收起列表（原先空关键字会拉全部候选，列表太长）
    if (!val.trim()) { setQcCandidates([]); setQcSearching(false); return; }
    setQcSearching(true);
    try {
      const r = await (casesApi as any).getQCandidates(val.trim());
      setQcCandidates(r.data?.results || []);
    } catch { setQcCandidates([]); }
    finally { setQcSearching(false); }
  };

  const createBatch = async () => {
    if (selectedKeys.size === 0 && !selectedQC) { message.warning("请至少选择一个样本"); return; }
    try {
      const payload: any = { case_sample_ids: Array.from(selectedKeys) };
      if (selectedQC) payload.qc_sample_id = selectedQC.id;
      const res = await (casesApi as any).createExtractionBatch(payload);
      message.success(`批次 ${res.data.batch_number} 已创建`);
      setModalOpen(false); fetchBatches();
    } catch (e: any) { message.error(e?.response?.data?.detail || "创建失败"); }
  };

  /** 顶部计数：当前筛选可见的条目数（与分组标题同口径，条目数而非样本数） */
  const visCount = (female: boolean) =>
    visibleEntries().filter((e: any) => (e.category === "FEMALE_BLOOD") === female).length;

  /** 当前筛选（搜索 + 签收地）后可见的条目 */
  const visibleEntries = () => {
    if (!pendingData) return [] as any[];
    return pendingData.entries.filter((e: any) =>
      (!pendingSearch || e.patient_name.includes(pendingSearch) ||
        e.case_number.includes(pendingSearch) || (e.test_sample_id || "").includes(pendingSearch)) &&
      (!pendingLoc || e.receipt_location === pendingLoc)
    );
  };

  const toggleAll = (checked: boolean) => {
    if (!pendingData) return;
    if (checked) { const all = new Set<string>(); for (const e of visibleEntries()) for (const id of e.case_sample_ids) all.add(id); setSelectedKeys(all); }
    else { setSelectedKeys(new Set()); }
  };

  /** 按性别替换式全选：f=只选女性，m=只选男性（血液+其他），另一性别清掉 */
  const selectByGender = (g: "f" | "m") => {
    if (!pendingData) return;
    const next = new Set<string>();
    for (const e of visibleEntries()) {
      const isF = e.category === "FEMALE_BLOOD";
      if ((g === "f" && isF) || (g === "m" && !isF)) {
        for (const id of e.case_sample_ids) next.add(id);
      }
    }
    setSelectedKeys(next);
  };

  // ── Save / Complete / Delete ──
  /** 保存前校验（side: f=女性 m=男性 all=两侧；有样本的侧才校验；操作人+审核人） */
  const validateBeforeSave = (side: "f" | "m" | "all" = "all"): string[] => {
    const missing: string[] = [];
    if (!selectedBatch) return missing;
    const check = (s: "f" | "m") => {
      const who = s === "f" ? "女性" : "男性";
      const has = s === "f"
        ? selectedBatch.female_samples.length > 0
        : selectedBatch.male_blood_count + selectedBatch.male_other_count > 0;
      if (!has) return;
      const opMap = s === "f" ? operators : operatorsM;
      const rvMap = s === "f" ? reviewers : reviewersM;
      // 照片不再是硬性要求：改为保存时弹窗提醒，允许完成批次后再补传
      if (!(opMap[selectedBatch.id] || []).length) missing.push(`选择${who}操作人`);
      if (!(rvMap[selectedBatch.id] || []).length) missing.push(`选择${who}审核人`);
    };
    if (side === "f" || side === "all") check("f");
    if (side === "m" || side === "all") check("m");
    return missing;
  };

  // 深度规范化（键排序 / 去 undefined）——JSONB 读回时键序会变，对比需先规范化
  const canon = (o:any):any => {
    if (o === undefined || o === null) return undefined;
    if (Array.isArray(o)) { const r = o.map(canon); return r.length === 0 ? undefined : r; }
    if (typeof o === "object") {
      if (typeof o.toJSON === "function") { try { return canon(o.toJSON()); } catch { return undefined; } }
      const acc:any = {};
      Object.keys(o).sort().forEach(k => {
        const v = o[k];
        if (v === undefined || v === null || v === "") return;
        const cv = canon(v);
        if (cv !== undefined) acc[k] = cv;
      });
      return Object.keys(acc).length === 0 ? undefined : acc;
    }
    return o === "" ? undefined : o;
  };

  /** 设备三项 → 兼容旧字段 equipment（导出/统计仍读它） */
  const devJoined = (rg: ReagentInfo) =>
    (["dev_metal", "dev_qubit", "dev_extractor"] as const)
      .map((k) => { const v = String((rg as any)[k] || "").trim(); return v ? `${DEVICE_ALL_LABEL[k]} ${v}` : ""; })
      .filter(Boolean).join(" / ");

  /** 试剂盒多选 → 保存用数组（日期统一 YYYY-MM-DD） */
  const kitsForSave = (rg: ReagentInfo) =>
    (rg.kits || []).filter((k) => k && k.kit).map((k) => ({
      kit: k.kit, lot: k.lot || "",
      expiry: k.expiry ? dayjs(k.expiry).format("YYYY-MM-DD") : "",
    }));

  /** 改某个试剂盒那一行的批号/有效期 */
  const updateKitRow = (side: "f" | "m", idx: number, patch: Partial<KitRow>) => {
    const setter = side === "f" ? setReagentF : setReagentM;
    setter((p: any) => {
      const rows = [...(p.kits || [])];
      rows[idx] = { ...rows[idx], ...patch };
      return { ...p, kits: rows };
    });
  };

  /** 选择试剂盒（多选）：新增的行自动带入上次批号/有效期；取消的行直接去掉 */
  const changeKits = (side: "f" | "m", vals: string[]) => {
    const setter = side === "f" ? setReagentF : setReagentM;
    setter((p: any) => {
      const cur: KitRow[] = p.kits || [];
      const next: KitRow[] = vals.map((v) => {
        const hit = cur.find((k) => k.kit === v);
        if (hit) return hit;
        const last = kitLotsFor(selectedBatch?.receipt_location)[v] || {};
        return { kit: v, lot: last.lot || "", expiry: last.expiry ? dayjs(last.expiry) : undefined };
      });
      // 2026-11-09：香港核酸提取仪跟试剂盒联动（圆底→01-圆底，锥底→02-锥底）
      const ex = syncExtractor(next, selectedBatch?.receipt_location);
      return { ...p, kits: next, ...(ex === undefined ? {} : { dev_extractor: ex }) };
    });
  };

  // 构建与保存一致的 extraction_data（保存 / 完成前未保存检测共用）
  const buildExData = ():any => {
    const sid = selectedBatch?.id || "";
    return {
      female: { method: femaleMethod, sample_results: femaleResults, plate_skip_coords: femaleSkipCoords,
        plate_kit_types: femaleKitTypes,
        plate_layout: snapPlateLayout(selectedBatch?.female_samples || [], femaleMethod, femaleSkipCoords, femalePlateLayout),
        magnetic_notes: femaleMagneticNotes.current,
        manual_notes: femaleManualNotes, auto_notes: femaleAutoNotes,
        extraction_date: dateF || "", extraction_time: timeF || "",
        equipment: devJoined(reagentF),
        dev_metal: reagentF.dev_metal || "", dev_qubit: reagentF.dev_qubit || "",
        dev_extractor: reagentF.dev_extractor || "",
        kits: kitsForSave(reagentF),
        kit_type: (reagentF.kits?.[0]?.kit) || reagentF.kit_type || "",
        reagent_lot: (reagentF.kits?.[0]?.lot) || reagentF.reagent_lot || "",
        reagent_expiry: reagentF.kits?.[0]?.expiry ? dayjs(reagentF.kits[0].expiry).format("YYYY-MM-DD")
          : (reagentF.reagent_expiry ? dayjs(reagentF.reagent_expiry).format("YYYY-MM-DD") : ""),
        temperature: reagentF.temperature ?? null, humidity: reagentF.humidity ?? null },
      male: { method: maleMethod, sample_results: maleResults, plate_skip_coords: maleSkipCoords,
        plate_kit_types: maleKitTypes,
        plate_layout: snapPlateLayout(maleOrder<ExtractionSample>(selectedBatch), maleMethod, maleSkipCoords, malePlateLayout),
        magnetic_notes: maleMagneticNotes.current,
        manual_notes: maleManualNotes, auto_notes: maleAutoNotes,
        extraction_date: dateM || "", extraction_time: timeM || "",
        equipment: devJoined(reagentM),
        dev_metal: reagentM.dev_metal || "", dev_qubit: reagentM.dev_qubit || "",
        dev_extractor: reagentM.dev_extractor || "",
        kits: kitsForSave(reagentM),
        quant_lot: reagentM.quant_lot || "",
        quant_expiry: reagentM.quant_expiry ? dayjs(reagentM.quant_expiry).format("YYYY-MM-DD") : "",
        kit_type: (reagentM.kits?.[0]?.kit) || reagentM.kit_type || "",
        reagent_lot: (reagentM.kits?.[0]?.lot) || reagentM.reagent_lot || "",
        reagent_expiry: reagentM.kits?.[0]?.expiry ? dayjs(reagentM.kits[0].expiry).format("YYYY-MM-DD")
          : (reagentM.reagent_expiry ? dayjs(reagentM.reagent_expiry).format("YYYY-MM-DD") : ""),
        temperature: reagentM.temperature ?? null, humidity: reagentM.humidity ?? null },
      // 顶层字段保留女性侧值：旧导出模板/报表仍按顶层读（向后兼容）
      kit_type: (reagentF.kits?.[0]?.kit) || reagentF.kit_type || "", equipment: devJoined(reagentF),
      reagent_lot: (reagentF.kits?.[0]?.lot) || reagentF.reagent_lot || "",
      reagent_expiry: reagentF.kits?.[0]?.expiry ? dayjs(reagentF.kits[0].expiry).format("YYYY-MM-DD")
        : (reagentF.reagent_expiry ? dayjs(reagentF.reagent_expiry).format("YYYY-MM-DD") : ""),
      temperature: reagentF.temperature ?? undefined, humidity: reagentF.humidity ?? undefined,
      photos_female: photosFRef.current, photos_male: photosMRef.current,
      operator_female: joinPersons(operators[sid]), reviewer_female: joinPersons(reviewers[sid]),
      operator_male: joinPersons(operatorsM[sid]), reviewer_male: joinPersons(reviewersM[sid]),
      step_confirmations: stepConfirmations,
    };
  };

  // 保存用样本 payload（当前侧：inline 编辑结果优先）
  const buildExSamples = (srcSamples: any[]): any[] =>
    srcSamples.map(s => {
      const isF = (selectedBatch?.female_samples || []).some((f: any) => f.id === s.id);
      const res = (isF ? femaleResults : maleResults)[s.id] || {};
      const qcFromRes = res.status === "fail" ? "FAIL" : res.status === "pass" ? "PASS" : s.qc_status;
      return { id: s.id, extraction_method: s.extraction_method, well_position: s.well_position,
        plasma_volume: s.plasma_volume,
        elution_volume: res.elution ?? s.elution_volume,
        dna_concentration: res.concentration ?? s.dna_concentration,
        aliquot_tubes: s.aliquot_tubes,
        qc_status: qcFromRes, qc_note: res.note ?? s.qc_note };
    });

  // 对比用直读版（服务器样本字段原值）
  const buildExSamplesDirect = (srcSamples: any[]): any[] =>
    srcSamples.map(s => ({ id: s.id, extraction_method: s.extraction_method, well_position: s.well_position,
      plasma_volume: s.plasma_volume, elution_volume: s.elution_volume, dna_concentration: s.dna_concentration,
      aliquot_tubes: s.aliquot_tubes, qc_status: s.qc_status, qc_note: s.qc_note }));

  const saveProcessing = async (side: "f" | "m" | "all" = "all") => {
    if (!selectedBatch) return;
    const who = side === "f" ? "女性" : side === "m" ? "男性" : "";
    // 竞态修复：等待所有照片读取/压缩完成再提交
    if (pendingUploads.current.length) {
      setBatchLoading(true);
      await Promise.allSettled(pendingUploads.current);
      setBatchLoading(false);
    }
    // 保存前校验：按侧
    const missing = validateBeforeSave(side);
    if (missing.length) { message.warning(`保存前请先：${missing.join("、")}`); return; }
    // 照片不是硬性要求：没传就提醒确认一次（允许先完成、之后再补传）
    const noPhoto: string[] = [];
    if ((side === "f" || side === "all") && selectedBatch.female_samples.length > 0 && !photosFRef.current.length) noPhoto.push("女性");
    if ((side === "m" || side === "all") && (selectedBatch.male_blood_count + selectedBatch.male_other_count) > 0 && !photosMRef.current.length) noPhoto.push("男性");
    if (noPhoto.length) {
      const goOn = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "尚未上传实验照片",
          content: `${noPhoto.join("、")}尚未上传实验照片，确定保存吗？（可稍后在批次中补传）`,
          okText: "确定保存", cancelText: "返回上传", onOk: () => resolve(true), onCancel: () => resolve(false),
        });
      });
      if (!goOn) return;
    }
    try {
      const srcSamples = side === "f"
        ? [...selectedBatch.female_samples]
        : side === "m"
          ? [...selectedBatch.male_blood_samples, ...selectedBatch.male_other_samples]
          : [...selectedBatch.female_samples, ...selectedBatch.male_blood_samples, ...selectedBatch.male_other_samples];
      const allSamples = buildExSamples(srcSamples);
      const ed = buildExData();
      await (casesApi as any).saveExtraction(selectedBatch.id, { samples: allSamples, extraction_data: ed });
      flushPhotoDeletes(selectedBatch.id);
      message.success(who ? `${who}保存成功` : "保存成功"); fetchDetail(selectedBatch.id);
    } catch { message.error(who ? `${who}保存失败` : "保存失败"); }
  };

  const completeBatch = async () => {
    if (!selectedBatch) return;
    // ── 完成前校验：有样本的侧必须已保存（操作人+审核人；照片可完成后再补传）──
    const ed = selectedBatch.extraction_data || {};
    const cMissing: string[] = [];
    if ((selectedBatch.female_samples || []).length > 0) {
      if (!ed.operator_female || !ed.reviewer_female) cMissing.push("女性");
    }
    if (((selectedBatch.male_blood_count || 0) + (selectedBatch.male_other_count || 0)) > 0) {
      if (!ed.operator_male || !ed.reviewer_male) cMissing.push("男性");
    }
    if (cMissing.length) {
      message.warning(`完成批次前需先保存：${cMissing.join("、")}实验数据（操作人+审核人）`);
      return;
    }
    // 照片提醒：不阻断，确认后继续（照片可完成后再补传）
    const noPhoto: string[] = [];
    if ((selectedBatch.female_samples || []).length > 0 && !photosFRef.current.length) noPhoto.push("女性");
    if (((selectedBatch.male_blood_count || 0) + (selectedBatch.male_other_count || 0)) > 0 && !photosMRef.current.length) noPhoto.push("男性");
    if (noPhoto.length) {
      const goOn = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: "尚未上传实验照片",
          content: `${noPhoto.join("、")}尚未上传实验照片，确定完成吗？（可完成后再补传）`,
          okText: "确定完成", cancelText: "返回上传", onOk: () => resolve(true), onCancel: () => resolve(false),
        });
      });
      if (!goOn) return;
    }
    // ── 未保存改动检测：与服务器最新数据对比，防止完成时丢失未保存修改 ──
    try {
      const fr = await (casesApi as any).getExtractionBatch(selectedBatch.id);
      const fresh = fr.data;
      const curSamples = buildExSamples([...(selectedBatch.female_samples || []), ...(selectedBatch.male_blood_samples || []), ...(selectedBatch.male_other_samples || [])]);
      const freshSamples = buildExSamplesDirect([...(fresh.female_samples || []), ...(fresh.male_blood_samples || []), ...(fresh.male_other_samples || [])]);
      if (JSON.stringify(canon(curSamples)) !== JSON.stringify(canon(freshSamples))
        || JSON.stringify(canon(buildExData())) !== JSON.stringify(canon(fresh.extraction_data || {}))) {
        message.warning("有未保存的修改，请先点击保存再完成");
        return;
      }
    } catch { /* 拉取失败不阻塞（原有校验仍生效） */ }
    try { await (casesApi as any).completeExtraction(selectedBatch.id); message.success("已完成"); setSelectedBatch(null); fetchBatches(); }
    catch { message.error("操作失败"); }
  };

  const deleteBatch = async (id: string) => {
    try { await (casesApi as any).deleteExtractionBatch(id); message.success("已删除"); setSelectedBatch(null); fetchBatches(); }
    catch (e: any) { message.error(e?.response?.data?.detail || "删除失败"); }
  };

  // ── Photo ──
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

  const handlePhoto = (side: "f" | "m", file: File) => {
    setUploading(c => c + 1);
    const p = new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        compressImage(e.target?.result as string)
          .then(async (dataUrl) => {
            try {
              // 压缩后立即上传，列表里只存 URL —— 避免把 base64 塞进批次 JSON 使保存请求体过大
              const url = await uploadNipptPhoto("extraction", selectedBatch?.id || "", side, dataUrl);
              if (side === "f") setPhotosFSync([...photosFRef.current, url]);
              else setPhotosMSync([...photosMRef.current, url]);
              if (selectedBatch?.status === "COMPLETED") autoSavePhotos();
            } catch {
              message.error("照片上传失败，请重试");
            }
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
    return false;
  };

  /** 真正删除被移除照片的服务端文件 —— 只在保存成功后调用。
   *  若删除时立刻删文件，用户又不保存，库里的 URL 就会指向已删文件（裂图）。 */
  const flushPhotoDeletes = (batchId?: string) => {
    const jobs = pendingPhotoDeletes.current;
    if (!jobs.length || !batchId) return;
    pendingPhotoDeletes.current = [];
    jobs.forEach(({ side, url }) => deleteNipptPhoto("extraction", batchId, side, url));
  };

  /** 已完成批次补传/删除照片后自动落库（后端 save_processing 对已完成批次不设限） */
  const autoSavePhotos = async () => {
    if (!selectedBatch) return;
    try {
      const ed = { ...(selectedBatch.extraction_data || {}), photos_female: photosFRef.current, photos_male: photosMRef.current };
      await (casesApi as any).saveExtraction(selectedBatch.id, { extraction_data: ed });
      flushPhotoDeletes(selectedBatch.id);
      message.success("照片已保存");
      fetchDetail(selectedBatch.id);
    } catch { message.error("照片保存失败，请重试"); }
  };

  const removePhoto = (side: "f" | "m", index: number) => {
    const list = side === "f" ? photosFRef.current : photosMRef.current;
    const target = list[index];
    if (side === "f") setPhotosFSync(list.filter((_, i) => i !== index));
    else setPhotosMSync(list.filter((_, i) => i !== index));
    // 只登记，不立即删文件（见 flushPhotoDeletes 注释）
    if (isRemotePhoto(target)) pendingPhotoDeletes.current.push({ side, url: target });
    if (selectedBatch?.status === "COMPLETED") autoSavePhotos();
  };

  /** 日期/时间 + 照片 + 操作人/审核人（男女各自一套） */
  const renderPhotosPersons = (side: "f" | "m") => {
    if (!selectedBatch) return null;
    const who = side === "f" ? "女性" : "男性";
    const ph = side === "f" ? photosF : photosM;
    const dv = side === "f" ? dateF : dateM;
    const tv = side === "f" ? timeF : timeM;
    const opMap = side === "f" ? operators : operatorsM;
    const setOpMap = side === "f" ? setOperators : setOperatorsM;
    const rvMap = side === "f" ? reviewers : reviewersM;
    const setRvMap = side === "f" ? setReviewers : setReviewersM;
    return (
      <Card size="small" title={`📋 ${who}实验记录`} style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ color: "#666" }}>日期:</span>
          <DatePicker size="small" style={{ width: 130 }} value={dv ? dayjs(dv) : null}
            onChange={(d: any) => (side === "f" ? setDateF : setDateM)(d ? d.format("YYYY-MM-DD") : "")} placeholder="选择日期" format="YYYY-MM-DD" />
          <span style={{ color: "#666", marginLeft: 8 }}>时间:</span>
          <TimePicker size="small" style={{ width: 100 }} format="HH:mm" value={tv ? dayjs(tv, "HH:mm") : null}
            onChange={(d: any) => (side === "f" ? setTimeF : setTimeM)(d ? d.format("HH:mm") : "")} placeholder="选择时间" />
        </div>
        <ConfigProvider componentDisabled={false}>{/* 已完成批次仍允许补传/删除照片 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ph.map((url, i) => (
            <div key={i} style={{ position: "relative", width: 104, height: 104 }}>
              <Image src={url} width={104} height={104} style={{ objectFit: "cover", borderRadius: 4 }} />
              <Button type="text" danger size="small" style={{ position: "absolute", top: -8, right: -8, background: "#fff", borderRadius: "50%" }}
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
          <Upload beforeUpload={f => { handlePhoto(side, f); return false; }} showUploadList={false} accept="image/*">
            <div style={{ width: 104, height: 104, border: "1px dashed #d9d9d9", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <CameraOutlined style={{ fontSize: 24, color: "#999" }} /><Text type="secondary" style={{ fontSize: 11 }}>拍照/上传</Text></div>
          </Upload>
        </div>
        </ConfigProvider>
        <div style={{ marginTop: 12, padding: 8, background: "#fafafa", borderRadius: 4, fontSize: 12 }}>
          <Text type="secondary">操作人: </Text>
          <Select size="small" mode="multiple" maxTagCount="responsive" placeholder="可选择多个"
            style={{ width: 190, minWidth: 190 }}
            value={opMap[selectedBatch.id] || []}
            onChange={(v: string[]) => setOpMap(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
            {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
          </Select>
          <Text type="secondary" style={{ marginLeft: 16 }}>审核人: </Text>
          <Select size="small" mode="multiple" maxTagCount="responsive" placeholder="可选择多个"
            style={{ width: 190, minWidth: 190 }}
            value={rvMap[selectedBatch.id] || []}
            onChange={(v: string[]) => setRvMap(prev => ({...prev, [selectedBatch.id]: v}))} allowClear>
            {PERSONS.map(p => <Select.Option key={p} value={p}>{p}</Select.Option>)}
          </Select>
          <Button size="small" type="primary" style={{ marginLeft: 16 }} onClick={() => saveProcessing(side)}>保存</Button>
        </div>
      </Card>
    );
  };

  // ── Sample result helpers ──
  const setResult = (isFemale: boolean, sampleId: string, status: string, note: string, concentration?: number) => {
    const setter = isFemale ? setFemaleResults : setMaleResults;
    setter((prev: any) => ({ ...prev, [sampleId]: { ...(prev[sampleId] || {}), status, note, ...(concentration !== undefined ? { concentration } : {}) } }));
  };

  // 洗脱体积(μL)：存于 sample_results（与浓度同模式），默认显示 55
  const setElution = (isFemale: boolean, sampleId: string, val?: number) => {
    const setter = isFemale ? setFemaleResults : setMaleResults;
    setter((prev: any) => ({ ...prev, [sampleId]: { ...(prev[sampleId] || { status: "pass", note: "" }), elution: val } }));
  };

  const getResult = (isFemale: boolean, sampleId: string) => {
    return isFemale ? (femaleResults[sampleId] || { status: "pass", note: "" }) : (maleResults[sampleId] || { status: "pass", note: "" });
  };

  // ── Well label ──
  const getWellLabel = (s: ExtractionSample) => {
    if (s.is_qc) return `${s.test_sample_id || "QC"} 🔬`;
    const tid = s.test_sample_id || "?";
    // 男性（血液+其他）统一在 PT 编号后标注样本类型；女性不标
    if (s.category === "MALE_BLOOD" || s.category === "MALE_OTHER") {
      const est = (s as any).experiment_sample_type || "";
      const types = (s as any).sample_types || [];
      const st = est || (s.category === "MALE_BLOOD" ? "BLOOD" : (types.length ? types[0] : ""));
      const label = SAMPLE_TYPE_LABELS[st] || st || "";
      if (label) return (<>{tid}<span style={{ display: "inline-block" }}>（{label}）</span></>);
    }
    return tid;
  };

  // ── Well Popover Cell ──
  const WellCell = ({ sample, isFemale, tdProps, dropTarget }:
    { sample: ExtractionSample; isFemale: boolean; tdProps?: any; dropTarget?: boolean }) => {
    // 空孔：可作落点（拖到空孔=移动），但不可从空孔发起拖动
    if (!sample) return <td {...(tdProps || {})} draggable={false} style={{ background: "#f0f0f0", width: 80, height: 42, textAlign: "center", fontSize: 11, color: "#bbb", outline: dropTarget ? "2px dashed #1677ff" : undefined, outlineOffset: -2 }}>—</td>;
    const r = getResult(isFemale, sample.id);
    const status = r.status || "pass";
    const note = r.note || "";
    const bg = status === "fail" ? "#fff1f0" : "#f6ffed";
    const color = status === "fail" ? "#cf1322" : "#52c41a";
    const isOther = sample.category === "MALE_OTHER";
    const [localStatus, setLocalStatus] = useState(status);
    const [localNote, setLocalNote] = useState(note);
    const [localConc, setLocalConc] = useState<number | undefined>(r.concentration);
    const [open, setOpen] = useState(false);

    const popContent = (
      <div style={{ width: 240 }}>
        <Radio.Group value={localStatus} onChange={e => setLocalStatus(e.target.value)} style={{ marginBottom: 8 }}>
          <Radio value="pass" style={{ color: "#52c41a" }}>Pass ✓</Radio>
          <Radio value="fail" style={{ color: "#cf1322" }}>Fail ✗</Radio>
        </Radio.Group>
        {isOther && (
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 11 }}>DNA浓度(ng/μL):</Text>
            <InputNumber size="small" min={0} step={0.1} style={{ width: 80, marginLeft: 8 }}
              value={localConc} onChange={v => setLocalConc(v ?? undefined)} />
          </div>
        )}
        {localStatus === "fail" && (
          <TextArea placeholder="失败原因备注" value={localNote} onChange={e => setLocalNote(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 3 }} style={{ fontSize: 11, marginBottom: 8 }} />
        )}
        <div style={{ textAlign: "right" }}>
          <Button size="small" onClick={() => { setResult(isFemale, sample.id, localStatus, localNote, localConc); setOpen(false); }}>确认</Button>
        </div>
      </div>
    );


  return (
      <Popover content={popContent} trigger="click" open={open} onOpenChange={v => { setOpen(v); if (v) { setLocalStatus(status); setLocalNote(note); setLocalConc(r.concentration); } }}
        placement="bottomLeft" destroyTooltipOnHide>
        <td {...(tdProps || {})} style={{ background: bg, cursor: tdProps?.draggable ? "grab" : "pointer", width: 80, height: 42, textAlign: "center", fontSize: 11, color, padding: 2, lineHeight: 1.25, wordBreak: "break-all", outline: dropTarget ? "2px dashed #1677ff" : undefined, outlineOffset: -2 }}>
          {getWellLabel(sample)}
        </td>
      </Popover>
    );
  };

  // ── Build 96-well full table (AUTOMATED) ──
  const buildFullPlate = (samples: ExtractionSample[], isFemale: boolean, skipSet?: Set<string>) => {
    const map: Record<string, ExtractionSample> = {};
    let si = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 12; c++) {
        const key = `${ROWS_8[r]}${COLS_12[c]}`;
        if (skipSet?.has(key)) continue;
        if (si < samples.length) { map[key] = samples[si]; si++; }
      }
    }

  return (
      <table style={{ borderCollapse: "collapse", margin: "8px auto" }}>
        <thead><tr><th style={{ width: 30 }}></th>{COLS_12.map(c => <th key={c} style={{ width: 80, fontSize: 12, fontWeight: 500, padding: 4 }}>{c}</th>)}</tr></thead>
        <tbody>{ROWS_8.map(row => (
          <tr key={row}><td style={{ textAlign: "center", fontWeight: 600, fontSize: 12, padding: 4 }}>{row}</td>
            {COLS_12.map(col => <WellCell key={`${row}${col}`} sample={map[`${row}${col}`]} isFemale={isFemale} />)}
          </tr>
        ))}</tbody>
      </table>
    );
  };

  // ── Build magnetic rod plate (col 1 + col 7 only) ──
  const buildMagneticPlates = (samples: ExtractionSample[], isFemale: boolean, skipCoords: Record<number, string>, kitTypes: Record<number, string>, setSkipCoords: any, setKitTypes: any, notesRef: any, plateLayout: Record<string, Record<string, string>>, setPlateLayout: any) => {
    const canDrag = selectedBatch?.status !== "COMPLETED";
    const plates: { cells: { row: number; col: number; sampleIdx: number }[] }[] = [];
    let si = 0, pi = 0;
    // 2026-10-28：跳过孔位若把本板的上样孔（1列 / 7列）全部占满，视为无效配置，
    // 否则 cells 一直是 0 → 整个磁棒板不渲染（表现为「磁棒法没有 plate 表」）。
    const badSkipPlates: number[] = [];
    while (si < samples.length) {
      const skips = skipCoords[pi] || "";
      let skipSet = new Set(
        skips.split(",").map((s: string) => s.trim().toUpperCase())
          .filter((s: string) => /^[A-H](1[0-2]|[1-9])$/.test(s))
      );
      const loadWells = [...ROWS_8.map(r => `${r}1`), ...ROWS_8.map(r => `${r}7`)];
      if (loadWells.every(w => skipSet.has(w))) {
        skipSet = new Set();
        badSkipPlates.push(pi);
      }
      const cells: { row: number; col: number; sampleIdx: number }[] = [];
      for (let r = 0; r < 8; r++) { if (!skipSet.has(`${ROWS_8[r]}1`) && si < samples.length) cells.push({ row: r, col: 1, sampleIdx: si++ }); }
      for (let r = 0; r < 8; r++) { if (!skipSet.has(`${ROWS_8[r]}7`) && si < samples.length) cells.push({ row: r, col: 7, sampleIdx: si++ }); }
      if (cells.length > 0) { plates.push({ cells }); pi++; } else break;
    }
    const defaultTotalPlates = plates.length;

    // ── 位置覆盖（拖动换位后以 plateLayout 为准；样本集变了就忽略旧布局，回到规则排列）──
    const idxById: Record<string, number> = {};
    samples.forEach((s, i) => { if (s?.id) idxById[s.id] = i; });
    const layoutKeys = Object.keys(plateLayout || {});
    let useLayout = false;
    if (layoutKeys.length > 0) {
      const layIds = new Set<string>();
      layoutKeys.forEach(k => Object.values(plateLayout[k] || {}).forEach(v => { if (v) layIds.add(v as string); }));
      const curIds = new Set<string>(Object.keys(idxById));
      useLayout = layIds.size > 0 && layIds.size === curIds.size && [...layIds].every(v => curIds.has(v));
    }
    if (useLayout) {
      const layoutMax = Math.max(...layoutKeys.map(k => parseInt(k, 10) + 1));
      const total = Math.max(layoutMax, defaultTotalPlates);
      const laidOut: { cells: { row: number; col: number; sampleIdx: number }[] }[] = [];
      for (let p = 0; p < total; p++) {
        const m = plateLayout[String(p)] || {};
        const cells: { row: number; col: number; sampleIdx: number }[] = [];
        Object.entries(m).forEach(([well, sid]) => {
          const row = ROWS_8.indexOf(String(well).charAt(0));
          const col = parseInt(String(well).slice(1), 10);
          const sx = idxById[sid as string];
          if (row >= 0 && col >= 1 && sx !== undefined) cells.push({ row, col, sampleIdx: sx });
        });
        laidOut.push({ cells });
      }
      plates.length = 0;
      laidOut.forEach(p => plates.push(p));
    }

    // ── 拖动换位（交换两孔样本；拖到空孔=移动；支持跨板；跳过孔不可落样）──
    const parseSkipsOf = (v?: string) => new Set(
      String(v || "").split(",").map(x => x.trim().toUpperCase()).filter(x => /^[A-H](1[0-2]|[1-9])$/.test(x)));
    const platesToLayout = () => {
      const out: Record<string, Record<string, string>> = {};
      plates.forEach((p, pIdx) => {
        const m: Record<string, string> = {};
        p.cells.forEach(c => { const sid = samples[c.sampleIdx]?.id || ""; if (sid) m[`${ROWS_8[c.row]}${c.col}`] = sid; });
        out[String(pIdx)] = m;
      });
      return out;
    };
    const magneticDrop = (targetPi: number, targetWell: string) => {
      const srcPos = magneticDragRef.current;
      magneticDragRef.current = null;
      setMagneticDragOver(null);
      if (!srcPos) return;
      if (parseSkipsOf(skipCoords[targetPi]).has(targetWell)) {
        message.warning(`${targetWell} 是跳过孔位，不能放置样本`);
        return;
      }
      if (srcPos.pi === targetPi && srcPos.well === targetWell) return;
      const base = useLayout ? plateLayout : platesToLayout();
      const next: Record<string, Record<string, string>> = {};
      Object.keys(base).forEach(k => { next[k] = { ...(base[k] || {}) }; });
      const maxPi = Math.max(srcPos.pi, targetPi);
      for (let p = 0; p <= maxPi; p++) if (!next[String(p)]) next[String(p)] = {};
      const a = next[String(srcPos.pi)][srcPos.well];
      const b = next[String(targetPi)][targetWell];
      if (!a && !b) return;
      if (b) next[String(srcPos.pi)][srcPos.well] = b; else delete next[String(srcPos.pi)][srcPos.well];
      if (a) next[String(targetPi)][targetWell] = a; else delete next[String(targetPi)][targetWell];
      setPlateLayout(next);
    };
    const isDropTarget = (pIdx: number, well: string) =>
      canDrag && !!magneticDragOver && magneticDragOver.pi === pIdx && magneticDragOver.well === well;
    const dragProps = (pIdx: number, well: string) => {
      if (!canDrag) return {};
      return {
        draggable: true,
        onDragStart: (e: any) => {
          magneticDragRef.current = { pi: pIdx, well };
          try { e.dataTransfer.setData("text/plain", ""); } catch { /* noop */ }
          e.dataTransfer.effectAllowed = "move";
        },
        onDragEnd: () => { magneticDragRef.current = null; setMagneticDragOver(null); },
        onDragOver: (e: any) => {
          const s0 = magneticDragRef.current;
          if (!s0) return;
          if (s0.pi === pIdx && s0.well === well) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!magneticDragOver || magneticDragOver.pi !== pIdx || magneticDragOver.well !== well) setMagneticDragOver({ pi: pIdx, well });
        },
        onDragLeave: () => setMagneticDragOver(p2 => (p2 && p2.pi === pIdx && p2.well === well ? null : p2)),
        onDrop: (e: any) => { e.preventDefault(); magneticDrop(pIdx, well); },
      };
    };
    const resetMagneticLayout = () => { setPlateLayout({}); message.success("已按规则重排孔板"); };

  return (
      <div>
        {badSkipPlates.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 8 }}
            message={`跳过孔位把 ${badSkipPlates.map(p => `P${p + 1}`).join("、")} 的上样孔全部占满了，已按常规排布显示；请检查「跳过孔位」设置`} />
        )}
        {plates.map((plate, pIdx) => {
          const skips = skipCoords[pIdx] || "";
          const skipSet = new Set(skips.split(",").map((s: string) => s.trim().toUpperCase()).filter((s: string) => /^[A-H](1[0-2]|[1-9])$/.test(s)));
          const cellMap = new Map<string, number>();
          plate.cells.forEach(c => cellMap.set(`${ROWS_8[c.row]}:${COLS_12[c.col-1]}`, c.sampleIdx));
          const plateNo = `P${pIdx + 1}`;

  return (
            <div key={pIdx} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: "#666", whiteSpace: "nowrap" }}>{plateNo} 跳过孔位:</span>
                <Input size="small" placeholder="如 B1,C7" value={skips}
                  onChange={e => { setPlateLayout({}); setSkipCoords((prev: any) => ({ ...prev, [pIdx]: e.target.value.toUpperCase() })); }} style={{ width: 160 }} />
                <Select size="small" style={{ width: 90 }} placeholder="试剂盒" value={kitTypes[pIdx] || undefined}
                  onChange={(v: string) => setKitTypes((prev: any) => ({ ...prev, [pIdx]: v }))}
                  options={[{ value: "round", label: "圆底" }, { value: "conical", label: "锥底" }]} allowClear />
                {canDrag && <Button size="small" onClick={resetMagneticLayout}>按规则重排</Button>}
                {canDrag
                  ? <span style={{ color: "#8c8c8c", fontSize: 11 }}>（可直接拖动样本换位，支持跨板）</span>
                  : <span style={{ color: "#bbb", fontSize: 11 }}>🔒 已完成</span>}
              </div>
              <Card size="small" title={<span>{plateNo} 磁棒法 Plate {pIdx+1}/{plates.length} ({plate.cells.length} samples)</span>}
                extra={<Input.TextArea placeholder={`${plateNo} 磁棒备注`} defaultValue={notesRef.current[pIdx] || ""}
                  onChange={e => { notesRef.current[pIdx] = e.target.value; }} autoSize={{ minRows: 1, maxRows: 2 }}
                  style={{ width: 200, fontSize: 11 }} allowClear />}
                style={{ marginBottom: 8 }}>
                <table style={{ borderCollapse: "collapse", margin: "0 auto" }}>
                  <thead><tr><th style={{ width: 30 }}></th>{COLS_12.map(c => <th key={c} style={{ width: 80, fontSize: 12, fontWeight: 500, padding: 4 }}>{c}</th>)}</tr></thead>
                  <tbody>{ROWS_8.map(row => (
                    <tr key={row}><td style={{ textAlign: "center", fontWeight: 600, fontSize: 12, padding: 4 }}>{row}</td>
                      {COLS_12.map(col => {
                        const key = `${row}${col}`;
                        const idx = cellMap.get(`${row}:${col}`);
                        const sample = idx !== undefined && idx < samples.length ? samples[idx] : null;
                        if (skipSet.has(key)) return <td key={key} style={{ width: 80, height: 42, textAlign: "center", fontSize: 11, background: "#fff7e6", color: "#d48806" }}>SKIP</td>;
                        // Col 6 / Col 12: DNA concentration for male
                        if (!isFemale && (col === 6 || col === 12)) {
                          const pairCol = col === 6 ? 1 : 7;
                          const pairIdx = cellMap.get(`${row}:${pairCol}`);
                          const pairSample = pairIdx !== undefined && pairIdx < samples.length ? samples[pairIdx] : null;
                          if (pairSample) {
                            const r = getResult(isFemale, pairSample.id);
                            const v = r.concentration ?? pairSample.dna_concentration;

  return (
                              <td key={key} style={{ width: 80, height: 42, textAlign: "center", padding: 2, background: "#fafafa" }}>
                                <InputNumber size="small" min={0} step={0.1} style={{ width: 70, fontSize: 11 }}
                                  data-conc={`mag-${isFemale ? "F" : "M"}-${pIdx}-${col}`}
                                  data-row={ROWS_8.indexOf(row)}
                                  onPressEnter={() => focusNextConcInput(`mag-${isFemale ? "F" : "M"}-${pIdx}-${col}`, ROWS_8.indexOf(row))}
                                  value={v ?? undefined} placeholder="—"
                                  onChange={val => setResult(isFemale, pairSample.id, r.status || "pass", r.note || "", val ?? undefined)} />
                              </td>
                            );
                          }
                          return <td key={key} style={{ width: 80, height: 42, textAlign: "center", fontSize: 11, background: "#f0f0f0", color: "#bbb" }}>—</td>;
                        }
                        // 只有孔1/孔7 是真实上样孔（空孔也算落点，支持"拖到空孔=移动"）
                        const isWellCol = col === 1 || col === 7;
                        return <WellCell key={key} sample={sample!} isFemale={isFemale}
                          tdProps={isWellCol ? dragProps(pIdx, key) : undefined}
                          dropTarget={isWellCol && isDropTarget(pIdx, key)} />;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </Card>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render extraction tab content ──
  const renderExtractionTab = (samples: ExtractionSample[], isFemale: boolean, method: string, setMethod: any,
    skipCoords: any, setSkipCoords: any, kitTypes: any, setKitTypes: any, notesRef: any,
    plateLayout: Record<string, Record<string, string>>, setPlateLayout: any,
    manualNotes: string, setManualNotes: any, autoNotes: string, setAutoNotes: any,
    reagent: ReagentInfo, setReagent: any) => {

    const manualHide = method === "MANUAL";


  return (
      <div>
        {/* Method selector */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              <Text strong style={{ marginRight: 12 }}>🧪 提取方法：</Text>
              <Radio.Group value={method} onChange={e => setMethod(e.target.value)} options={EXTRACTION_METHODS} optionType="button" />
            </div>
            {/* 实验记录：设备/试剂盒/批号/有效期/温湿度 —— 男女各自独立（2026-10-19） */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>温度(℃)</div>
                <InputNumber size="small" style={{ width: 80 }} min={0} max={50}
                  value={reagent.temperature as any}
                  onChange={(v) => setReagent((p: any) => ({ ...p, temperature: v }))} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>湿度(%)</div>
                <InputNumber size="small" style={{ width: 80 }} min={0} max={100}
                  value={reagent.humidity as any}
                  onChange={(v) => setReagent((p: any) => ({ ...p, humidity: v }))} />
              </div>
              {/* 2026-11-09：设备拆成三行 —— 金属浴 / Qubit定量仪（默认带编号）+ 设备号（留空，填过就记住） */}
              {devItemsFor(selectedBatch?.receipt_location).map((d) => {
                const cur = splitDev((reagent as any)[d.key]);
                // 历史里手工填过的非标值也列进选项，避免显示成空白
                const opts = Array.from(new Set([...d.options, ...cur]));
                return (
                  <div key={d.key}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>{d.label}</div>
                    <Select size="small" mode="multiple" style={{ width: d.width || 200 }}
                      placeholder="选择设备号" allowClear maxTagCount={1}
                      value={cur}
                      onChange={(v: string[]) => setReagent((p: any) => ({ ...p, [d.key]: joinDev(v) }))}
                      options={opts.map((o) => ({ label: o, value: o }))} />
                  </div>
                );
              })}
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>试剂盒（可多选）</div>
                <Select mode="multiple" size="small" style={{ minWidth: 300 }} placeholder="选择（可多选）"
                  allowClear maxTagCount={1}
                  value={(reagent.kits || []).map((k) => k.kit)}
                  onChange={(vals: string[]) => changeKits(isFemale ? "f" : "m", vals)}
                  options={KIT_OPTIONS} />
              </div>
              <Button size="small" icon={<SwapOutlined />}
                onClick={() => {
                  const src: ReagentInfo = isFemale ? reagentM : reagentF;
                  setReagent({ ...src, kits: (src.kits || []).map((k) => ({ ...k })) });
                }}>
                {isFemale ? "同男性侧" : "同女性侧"}
              </Button>
            </div>
            {/* 2026-11-09：多选试剂盒 → 每个试剂盒各自一行批号/有效期（选中时自动带入上次的值） */}
            {(reagent.kits || []).length > 0 && (
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                {/* 2026-11-09：两种试剂用「行名 + 分隔线」分开，避免混在一起看不清 */}
                <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>提取试剂</div>
                {(reagent.kits || []).map((k, i) => (
                  // 2026-11-09：试剂名称一行显示（不换行；列宽固定保证批号/有效期上下对齐）
                  <div key={k.kit} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                                             flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                    <div title={KIT_LABEL[k.kit] || k.kit}
                      style={{ fontSize: 12, color: "#666", flex: "0 0 340px", width: 340,
                               whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {KIT_LABEL[k.kit] || k.kit}
                    </div>
                    <Input size="small" style={{ width: 140, flex: "0 0 140px" }} placeholder="批号"
                      value={k.lot || ""}
                      onChange={(e) => updateKitRow(isFemale ? "f" : "m", i, { lot: e.target.value })} />
                    <DatePicker size="small" style={{ width: 150, flex: "0 0 150px" }} placeholder="有效期"
                      value={k.expiry || null}
                      onChange={(d) => updateKitRow(isFemale ? "f" : "m", i, { expiry: d })} />
                  </div>
                ))}
              </div>
            )}
            {/* 2026-11-09：男性侧定量试剂（固定这一种，只需批号/有效期；自动带入上次的值） */}
            {!isFemale && (
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                <Divider style={{ margin: (reagent.kits || []).length > 0 ? "6px 0 8px" : "0 0 8px" }} />
                <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>定量试剂</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                  <div title={QUANT_KIT_LABEL}
                    style={{ fontSize: 12, color: "#666", flex: "0 0 340px", width: 340,
                             whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {QUANT_KIT_LABEL}
                  </div>
                  <Input size="small" style={{ width: 140, flex: "0 0 140px" }} placeholder="批号"
                    value={reagent.quant_lot || ""}
                    onChange={(e) => setReagent((p: any) => ({ ...p, quant_lot: e.target.value }))} />
                  <DatePicker size="small" style={{ width: 150, flex: "0 0 150px" }} placeholder="有效期"
                    value={reagent.quant_expiry || null}
                    onChange={(dd) => setReagent((p: any) => ({ ...p, quant_expiry: dd }))} />
                </div>
              </div>
            )}
          </Space>
        </Card>

        {/* Step confirmations */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Text strong style={{ marginBottom: 8, display: "block" }}>📋 操作步骤确认</Text>
          <Space wrap>
            {STEPS.filter(s => !manualHide || (s.key !== "uv_prep" && s.key !== "on_machine")).map(s => (
              <Checkbox key={s.key} checked={!!stepConfirmations[s.key]}
                onChange={e => setStepConfirmations((prev: any) => ({ ...prev, [s.key]: e.target.checked }))}>{s.label}</Checkbox>
            ))}
          </Space>
        </Card>

        {/* Method-specific content */}
        {/* MANUAL */}
        {method === "MANUAL" && (
          <Card size="small" title={`📝 手工提取 — ${samples.length} 个样本`}
            extra={<div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <TextArea placeholder="手工提取备注" value={manualNotes} onChange={e => setManualNotes(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 3 }} style={{ width: 280, fontSize: 12 }} allowClear />
            </div>}>
            <Table dataSource={samples} rowKey="id" size="small" pagination={false}
              columns={isFemale ? [
                { title: "#", width: 40, render: (_: any, __: any, i: number) => i + 1 },
                { title: "PT编号", dataIndex: "test_sample_id", width: 120, render: (v: string) => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : "—" },
                { title: "姓名", dataIndex: "patient_name", width: 100 },
                { title: "洗脱体积(μL)", key: "ev", width: 100, render: (_: any, r: ExtractionSample) => {
                  const res = getResult(isFemale, r.id);
                  const v = res.elution ?? r.elution_volume ?? 55;
                  return <InputNumber size="small" min={0} max={200} value={v}
                    onChange={val => setElution(isFemale, r.id, val ?? undefined)} style={{ width: 65 }} />;
                }},
                { title: "QC", key: "qc", width: 120, render: (_: any, r: ExtractionSample) => {
                  const res = getResult(isFemale, r.id);

  return (
                    <Select size="small" value={res.status || "pass"} style={{ width: 90 }}
                      onChange={v => setResult(isFemale, r.id, v, res.note || "", res.concentration)}
                      options={[{value:"pass",label:"✅ PASS"}, {value:"fail",label:"❌ FAIL"}]} />
                  );
                }},
              ] : [
                { title: "#", width: 40, render: (_: any, __: any, i: number) => i + 1 },
                { title: "PT编号", dataIndex: "test_sample_id", width: 120, render: (v: string) => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : "—" },
                { title: "姓名", dataIndex: "patient_name", width: 80 },
                { title: "类型", width: 70, render: (_: any, r: ExtractionSample) => {
                  if (r.category === "MALE_BLOOD") return <Tag color="blue" style={{ fontSize: 11 }}>血液</Tag>;
                  const est = (r as any).experiment_sample_type || "";
                  const types = (r as any).sample_types || [];
                  const st = est || types[0] || "";
                  return <Tag color="green" style={{ fontSize: 11 }}>{SAMPLE_TYPE_LABELS[st] || st || "—"}</Tag>;
                }},
                { title: "洗脱体积(μL)", key: "ev", width: 100, render: (_: any, r: ExtractionSample) => {
                  const res = getResult(isFemale, r.id);
                  const v = res.elution ?? r.elution_volume ?? 55;
                  return <InputNumber size="small" min={0} max={200} value={v}
                    onChange={val => setElution(isFemale, r.id, val ?? undefined)} style={{ width: 65 }} />;
                }},
                { title: "DNA浓度", key: "conc", width: 110, render: (_: any, r: ExtractionSample, i: number) => {
                  const res = getResult(isFemale, r.id);
                  const v = res.concentration ?? r.dna_concentration;
                  const concGroup = `manual-${isFemale ? "F" : "M"}`;
                  return <InputNumber size="small" min={0} step={0.1} style={{ width: 80 }}
                    data-conc={concGroup} data-row={i}
                    onPressEnter={() => focusNextConcInput(concGroup, i)}
                    value={v ?? undefined} placeholder="—"
                    onChange={val => setResult(isFemale, r.id, res.status || "pass", res.note || "", val ?? undefined)} />;
                }},
                { title: "QC", key: "qc", width: 120, render: (_: any, r: ExtractionSample) => {
                  const res = getResult(isFemale, r.id);

  return (
                    <Select size="small" value={res.status || "pass"} style={{ width: 90 }}
                      onChange={v => setResult(isFemale, r.id, v, res.note || "", res.concentration)}
                      options={[{value:"pass",label:"✅ PASS"}, {value:"fail",label:"❌ FAIL"}]} />
                  );
                }},
              ]}
            />
          </Card>
        )}

        {/* MAGNETIC_ROD */}
        {method === "MAGNETIC_ROD" && (
          buildMagneticPlates(samples, isFemale, skipCoords, kitTypes, setSkipCoords, setKitTypes, notesRef, plateLayout, setPlateLayout)
        )}

        {/* AUTOMATED */}
        {method === "AUTOMATED" && (
          <Card size="small" title={`🤖 自动化 — ${samples.length} 个样本`}
            extra={<TextArea placeholder="自动化备注" value={autoNotes} onChange={e => setAutoNotes(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 2 }} style={{ width: 220, fontSize: 11 }} allowClear />}>
            {buildFullPlate(samples, isFemale)}
          </Card>
        )}
      </div>
    );
  };

  // ── 导出 Excel（两个 sheet：女性/男性；实验记录 + 96孔板图 + 样本明细 + 磁棒Plate）──
  const exportExcel = () => {
    if (!selectedBatch) return;
    const sid = selectedBatch.id;
    const methodLabel = (m: string) => EXTRACTION_METHODS.find(x => x.value === m)?.label || m || "—";
    const parseSkip = (str: string) => new Set((str || "").split(",").map((x: string) => x.trim().toUpperCase()).filter((x: string) => /^[A-H](1[0-2]|[1-9])$/.test(x)));
    const buildSheet = (isF: boolean) => {
      const who = isF ? "女性" : "男性";
      const samples: ExtractionSample[] = isF ? (selectedBatch.female_samples || []) : maleOrder<ExtractionSample>(selectedBatch);
      const method = isF ? femaleMethod : maleMethod;
      const date = isF ? dateF : dateM;
      const time = isF ? timeF : timeM;
      const photos = isF ? photosF : photosM;
      const operator = joinPersons((isF ? operators : operatorsM)[sid]);
      const reviewer = joinPersons((isF ? reviewers : reviewersM)[sid]);
      const skipCoords: any = isF ? femaleSkipCoords : maleSkipCoords;
      const plateLayout: any = isF ? femalePlateLayout : malePlateLayout;
      const kitTypes: any = isF ? femaleKitTypes : maleKitTypes;
      const rg: ReagentInfo = isF ? reagentF : reagentM;
      const magNotes: any = (isF ? femaleMagneticNotes : maleMagneticNotes).current || {};
      const results: any = isF ? femaleResults : maleResults;
      const aoa: any[][] = [];
      aoa.push([`${selectedBatch.batch_number} — ${who}核酸提取记录`]);
      aoa.push([]);
      // 一、实验记录
      aoa.push(["一、实验记录"]);
      aoa.push(["日期", date || ""]);
      aoa.push(["时间", time || ""]);
      aoa.push(["提取方法", methodLabel(method)]);
      aoa.push(["操作人", operator]);
      aoa.push(["审核人", reviewer]);
      aoa.push(["照片数量", photos.length]);
      aoa.push(["温度(℃)", rg.temperature ?? ""]);
      aoa.push(["湿度(%)", rg.humidity ?? ""]);
      devItemsFor(selectedBatch?.receipt_location).forEach((d) => {
        const v = String((rg as any)[d.key] || "").trim();
        if (v) aoa.push([d.label, v]);
      });
      const _kits = (rg.kits && rg.kits.length)
        ? rg.kits
        : (rg.kit_type ? [{ kit: rg.kit_type, lot: rg.reagent_lot, expiry: rg.reagent_expiry }] : []);
      if (!_kits.length) {
        aoa.push(["试剂盒", ""]);
        aoa.push(["批号", ""]);
        aoa.push(["有效期", ""]);
      } else {
        _kits.forEach((k: any, i: number) => {
          aoa.push([i === 0 ? "试剂盒" : "", KIT_LABEL[k.kit] || k.kit || "",
                    "批号", k.lot || "",
                    "有效期", k.expiry ? dayjs(k.expiry).format("YYYY-MM-DD") : ""]);
        });
      }
      if (!isF) {
        aoa.push(["定量试剂", QUANT_KIT_LABEL,
                  "批号", rg.quant_lot || "",
                  "有效期", rg.quant_expiry ? dayjs(rg.quant_expiry).format("YYYY-MM-DD") : ""]);
      }
      if (method === "MANUAL") aoa.push(["备注", isF ? femaleManualNotes : maleManualNotes]);
      if (method === "AUTOMATED") aoa.push(["备注", isF ? femaleAutoNotes : maleAutoNotes]);
      aoa.push([]);
      // 二、按系统方法显示（手工=样本表；磁棒法=磁棒板；自动化=全板图）
      if (method === "MANUAL") {
        aoa.push(["二、样本明细（手工提取）"]);
        if (isF) aoa.push(["#", "PT编号", "姓名", "洗脱体积(μL)", "QC", "备注"]);
        else aoa.push(["#", "PT编号", "姓名", "类型", "洗脱体积(μL)", "DNA浓度", "QC", "备注"]);
        samples.forEach((smp, i) => {
          const res: any = results[smp.id] || {};
          const ev = res.elution ?? smp.elution_volume ?? 55;
          const qc = (res.status || "pass") === "fail" ? "FAIL" : "PASS";
          if (isF) {
            aoa.push([i + 1, smp.test_sample_id || "", smp.patient_name || "", ev, qc, res.note || ""]);
          } else {
            const est = (smp as any).experiment_sample_type || "";
            const types = (smp as any).sample_types || [];
            const st = est || types[0] || "";
            const typeLabel = smp.category === "MALE_BLOOD" ? "血液" : (SAMPLE_TYPE_LABELS[st] || st || "—");
            aoa.push([i + 1, smp.test_sample_id || "", smp.patient_name || "", typeLabel, ev, res.concentration ?? smp.dna_concentration ?? "", qc, res.note || ""]);
          }
        });
      } else if (method === "MAGNETIC_ROD") {
        aoa.push(["二、磁棒法Plate（每板：孔1 + 孔7 上样）"]);
        const plates: { cells: { row: number; col: number; idx: number }[] }[] = [];
        let si = 0, pi = 0;
        while (si < samples.length) {
          const sk0 = parseSkip(skipCoords?.[pi] || "");
          const cells: { row: number; col: number; idx: number }[] = [];
          for (let r = 0; r < 8; r++) if (!sk0.has(`${ROWS_8[r]}1`) && si < samples.length) cells.push({ row: r, col: 1, idx: si++ });
          for (let r = 0; r < 8; r++) if (!sk0.has(`${ROWS_8[r]}7`) && si < samples.length) cells.push({ row: r, col: 7, idx: si++ });
          if (cells.length > 0) { plates.push({ cells }); pi++; } else break;
        }
        // 位置覆盖：拖动换位后导出也按 plate_layout（样本集变了则忽略）
        {
          const idxById: Record<string, number> = {};
          samples.forEach((sm: any, i: number) => { if (sm?.id) idxById[sm.id] = i; });
          const lk = Object.keys(plateLayout || {});
          if (lk.length > 0) {
            const layIds = new Set<string>();
            lk.forEach(k => Object.values(plateLayout[k] || {}).forEach(v => { if (v) layIds.add(v as string); }));
            const curIds = new Set<string>(Object.keys(idxById));
            if (layIds.size > 0 && layIds.size === curIds.size && [...layIds].every(v => curIds.has(v))) {
              const layoutMax = Math.max(...lk.map(k => parseInt(k, 10) + 1));
              const total = Math.max(layoutMax, plates.length);
              const laidOut: { cells: { row: number; col: number; idx: number }[] }[] = [];
              for (let p = 0; p < total; p++) {
                const m = plateLayout[String(p)] || {};
                const cells: { row: number; col: number; idx: number }[] = [];
                Object.entries(m).forEach(([well, sid]) => {
                  const row = ROWS_8.indexOf(String(well).charAt(0));
                  const col = parseInt(String(well).slice(1), 10);
                  const sx = idxById[sid as string];
                  if (row >= 0 && col >= 1 && sx !== undefined) cells.push({ row, col, idx: sx });
                });
                laidOut.push({ cells });
              }
              plates.length = 0;
              laidOut.forEach(p => plates.push(p));
            }
          }
        }
        plates.forEach((plate, pIdx) => {
          const kt = kitTypes?.[pIdx];
          aoa.push([`P${pIdx + 1}`, "跳过孔位:", skipCoords?.[pIdx] || "无", "试剂盒:", kt === "round" ? "圆底" : kt === "conical" ? "锥底" : "—", "备注:", magNotes?.[pIdx] || ""]);
          const cm = new Map<string, number>();
          plate.cells.forEach(c => cm.set(`${ROWS_8[c.row]}:${c.col}`, c.idx));
          const sk2 = parseSkip(skipCoords?.[pIdx] || "");
          aoa.push(["", ...COLS_12.map(String)]);
          for (const row of ROWS_8) {
            const line: any[] = [row];
            for (const col of COLS_12) {
              if (col === 1 || col === 7) {
                if (sk2.has(`${row}${col}`)) { line.push("SKIP"); continue; }
                const idx = cm.get(`${row}:${col}`);
                const smp = idx !== undefined ? samples[idx] : null;
                line.push(smp ? `${smp.test_sample_id || ""} ${smp.patient_name || ""}`.trim() : "");
              } else if (!isF && (col === 6 || col === 12)) {
                const pairCol = col === 6 ? 1 : 7;
                const pi2 = cm.get(`${row}:${pairCol}`);
                const pSmp = pi2 !== undefined ? samples[pi2] : null;
                if (pSmp) {
                  const r2: any = results[pSmp.id] || {};
                  const v = r2.concentration ?? pSmp.dna_concentration;
                  line.push(v ?? "");
                } else line.push("");
              } else {
                line.push("");
              }
            }
            aoa.push(line);
          }
          aoa.push([]);
        });
      } else {
        aoa.push(["二、96孔板图（孔位 → 样本）"]);
        aoa.push(["", ...COLS_12.map(String)]);
        const map: Record<string, ExtractionSample> = {};
        let si = 0;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
          if (si < samples.length) { map[`${ROWS_8[r]}${COLS_12[c]}`] = samples[si]; si++; }
        }
        for (const row of ROWS_8) {
          const line: any[] = [row];
          for (const col of COLS_12) {
            const smp = map[`${row}${col}`];
            line.push(smp ? `${smp.test_sample_id || ""} ${smp.patient_name || ""}`.trim() : "");
          }
          aoa.push(line);
        }
      }
      return XLSX.utils.aoa_to_sheet(aoa);
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet(true), "女性");
    XLSX.utils.book_append_sheet(wb, buildSheet(false), "男性");
    XLSX.writeFile(wb, `${selectedBatch.batch_number}_核酸提取.xlsx`);
    message.success("已导出Excel");
  };

  // ── Sidebar columns ──
  const batchColumns = [
    { title: "批次号", dataIndex: "batch_number", key: "bn", width: 140, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: "状态", dataIndex: "status", key: "st", width: 76,
      render: (v: string, r: any) => { const c: Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"}; const l: Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};
        return <Space size={4}><Tag color={c[v]||"default"}>{l[v]||v}</Tag>{r.photos_pending && <Tooltip title="已完成但未上传实验照片，可补传"><span style={{cursor:"help"}}>📷</span></Tooltip>}</Space>; }},
    { title: "样本", key: "cnt", width: 90, render: (_: any, r: BatchItem) => <Text style={{ fontSize: 11 }}>👩{r.female_count} 👨{r.male_blood_count + r.male_other_count}</Text> },
    { title: "签收地", key: "loc", width: 88, render: (_: any, r: BatchItem) => r.receipt_location
        ? <Tag color={r.receipt_location.includes("/") ? "red" : "geekblue"} style={{ fontSize: 11 }}>📍{r.receipt_location}</Tag>
        : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
  ];

  // ── Main Render ──
  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", gap: 12 }}>
      {/* Sidebar */}
      <Card size="small" style={{ width: sidebarCollapsed ? 50 : 380, flexShrink: 0, transition: "width 0.25s", overflow: "hidden" }}
        title={sidebarCollapsed ? undefined : "核酸提取批次"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}>
        {!sidebarCollapsed && (<>
          <Button type="primary" icon={<PlusOutlined />} block onClick={openNewBatch} style={{ marginBottom: 8 }}>新建提取批次</Button>
          <Table dataSource={batches} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ y: "calc(100vh - 280px)" }}
            onRow={(r: BatchItem) => ({ onClick: () => fetchDetail(r.id), style: { background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined, cursor: "pointer" } })}
            columns={batchColumns} />
        </>)}
      </Card>

      {/* Main */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedBatch ? (
          <ConfigProvider componentDisabled={selectedBatch.status === "COMPLETED"}>
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text>
            <Tag color={selectedBatch.status === "COMPLETED" ? "green" : selectedBatch.status === "IN_PROGRESS" ? "blue" : "default"}>{selectedBatch.status_display}</Tag>{selectedBatch.status==="COMPLETED"&&<Tag color="default">🔒 只读</Tag>}{(selectedBatch as any).photos_pending&&<Tag color="orange">📷 待补照片</Tag>}{selectedBatch.receipt_location&&<Tag color={selectedBatch.receipt_location.includes("/")?"red":"geekblue"} style={{fontSize:12}}>📍{selectedBatch.receipt_location}{selectedBatch.receipt_location.includes("/")?" ⚠️混地区":""}</Tag>}</Space>}
            extra={<Space>
              {selectedBatch.status === "COMPLETED" && (
                <ConfigProvider componentDisabled={false}>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => {
                    const r = await confirmBatchDelete("extraction", selectedBatch.id, async () => { await fetchBatches(); setSelectedBatch(null as any); });
                    if (r.ok) await deleteBatch(selectedBatch.id);
                  }}>强制删除</Button>
                </ConfigProvider>
              )}
              {selectedBatch.status !== "COMPLETED" && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { const r = await confirmBatchDelete("extraction", selectedBatch.id, async () => { await fetchBatches(); setSelectedBatch(null as any); }); if (r.ok) await deleteBatch(selectedBatch.id); }}>删除</Button>
              )}
              <Button disabled={false} icon={<DownloadOutlined />} size="small" onClick={exportExcel}>导出Excel</Button>
              <Button disabled={false} icon={<ReloadOutlined />} size="small" loading={batchLoading} onClick={() => fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status !== "COMPLETED" && (<>
                <Button type="primary" icon={<CheckOutlined />} size="small" onClick={() => saveProcessing("all")}>保存全部</Button>
                <Popconfirm title="确定完成该批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成批次</Button></Popconfirm>
              </>)}
            </Space>}>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
              { key: "female", label: `👩 女性 (${selectedBatch.female_count})`,
                children: (
                  <>
                    {renderExtractionTab(selectedBatch.female_samples, true, femaleMethod, setFemaleMethod,
                      femaleSkipCoords, setFemaleSkipCoords, femaleKitTypes, setFemaleKitTypes, femaleMagneticNotes,
                      femalePlateLayout, setFemalePlateLayout,
                      femaleManualNotes, setFemaleManualNotes, femaleAutoNotes, setFemaleAutoNotes,
                      reagentF, setReagentF)}
                    {renderPhotosPersons("f")}
                  </>
                ) },
              { key: "male", label: `👨 男性 (${selectedBatch.male_blood_count + selectedBatch.male_other_count})`,
                children: (
                  <>
                    {renderExtractionTab(maleOrder<ExtractionSample>(selectedBatch), false, maleMethod, setMaleMethod,
                      maleSkipCoords, setMaleSkipCoords, maleKitTypes, setMaleKitTypes, maleMagneticNotes,
                      malePlateLayout, setMalePlateLayout,
                      maleManualNotes, setMaleManualNotes, maleAutoNotes, setMaleAutoNotes,
                      reagentM, setReagentM)}
                    {renderPhotosPersons("m")}
                  </>
                ) },
            ]} />
          </Card>
          </ConfigProvider>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
            <Title level={5} type="secondary">选择左侧批次查看详情</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNewBatch}>新建核酸提取批次</Button>
          </div>
        )}
      </div>

      {/* New Batch Modal */}
      <Modal title="新建核酸提取批次" open={modalOpen} onOk={createBatch} onCancel={() => setModalOpen(false)} width={750}
        okText={`创建批次 (${selectedKeys.size + (selectedQC ? 1 : 0)}个样本)`}>
        {pendingData && (<div>
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f6ffed", borderRadius: 6 }}>
            <Text strong>批次号：</Text><Text code style={{ fontSize: 16 }}>{batchNumberPreview}</Text><Text type="secondary" style={{ marginLeft: 8 }}>（自动生成）</Text></div>
          <Space style={{ marginBottom: 8 }} wrap><Input.Search placeholder="搜索姓名/PT号/Case号..." allowClear value={pendingSearch} onChange={(e: any) => setPendingSearch(e.target.value)} style={{ width: 300 }} />
              <Select size="small" style={{ width: 130 }} value={pendingSort}
                onChange={(v: "pt" | "case") => setPendingSort(v)}
                options={[{ value: "pt", label: "按 PT 编号" }, { value: "case", label: "按 Case 编号" }]} />
              <Select placeholder="全部签收地" style={{ width: 140 }} value={pendingLoc} allowClear onChange={(v: string | undefined) => { setPendingLoc(v); setSelectedKeys(new Set()); }} options={LOC_OPTIONS} /></Space>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space><Tag color="magenta">👩 女性: {visCount(true)}</Tag><Tag color="blue">👨 男性: {visCount(false)}</Tag></Space>
            <Space><Button size="small" onClick={() => selectByGender("f")}>👩 全选女性</Button><Button size="small" onClick={() => selectByGender("m")}>👨 全选男性</Button><Button size="small" onClick={() => toggleAll(true)}>全选</Button><Button size="small" onClick={() => toggleAll(false)}>取消全选</Button></Space></div>
          <Divider style={{ margin: "8px 0" }} />
          <div style={{ maxHeight: 300, overflow: "auto", marginBottom: 16 }}>
            {(["FEMALE_BLOOD","MALE_BLOOD","MALE_OTHER"] as const).map(cat => {
              const entries = pendingData.entries
                .filter((e: any) => e.category === cat && (!pendingSearch || e.patient_name.includes(pendingSearch) || e.case_number.includes(pendingSearch) || (e.test_sample_id||"").includes(pendingSearch)) && (!pendingLoc || e.receipt_location === pendingLoc))
                // 排序只影响弹窗显示，不影响已创建批次的样本顺序 / 导出 / 后端口径
                .slice()
                .sort((a: any, b: any) => {
                  if (pendingSort === "case") {
                    return String(a.case_number || "").localeCompare(String(b.case_number || ""), "en", { numeric: true });
                  }
                  const ka = ptSortKey(a), kb = ptSortKey(b);
                  if (ka.len !== kb.len) return ka.len - kb.len;   // 位数优先（PT7210 在 PT72081 之前）
                  if (ka.num !== kb.num) return ka.num - kb.num;
                  return ka.s.localeCompare(kb.s, "en", { numeric: true });
                });
              if (!entries.length) return null;
              const labels: Record<string,string> = {FEMALE_BLOOD:"👩 女性",MALE_BLOOD:"🩸 男性血液",MALE_OTHER:"🧬 男性其他"};

  return (<div key={cat} style={{ marginBottom: 8 }}><Text strong style={{ fontSize: 13 }}>{labels[cat]} ({entries.length})</Text>
                {entries.map((e: any) => {
                  const allIn = e.case_sample_ids.every((id: string) => selectedKeys.has(id));
                  const someIn = e.case_sample_ids.some((id: string) => selectedKeys.has(id));

  return (<div key={e.case_sample_ids.join(",")} style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
                    <Checkbox checked={allIn} indeterminate={!allIn && someIn} onChange={() => { setSelectedKeys(prev => { const next = new Set(prev); if (allIn) e.case_sample_ids.forEach((id: string) => next.delete(id)); else e.case_sample_ids.forEach((id: string) => next.add(id)); return next; }); }} />
                    <Text code style={{ fontSize: 11, width: 150 }}>{e.case_number}</Text>{e.test_sample_id && <Tag color="blue" style={{ fontSize: 11 }}>{e.test_sample_id}</Tag>}
                    <Text strong>{e.patient_name}</Text>{e.redo_count ? <Tag color="orange" style={{ fontSize: 10, marginRight: 0 }}>重做#{e.redo_count}</Tag> : null}{e.receipt_location && <Tag color={e.receipt_location === "HONGKONG" ? "geekblue" : "volcano"} style={{ fontSize: 10, marginRight: 0 }}>📍{LOC_LABEL[e.receipt_location] || e.receipt_location}</Tag>}<Space size={2} wrap>{e.sample_types.map((t: string) => <Tag key={t} color="green" style={{ fontSize: 10 }}>{SAMPLE_TYPE_LABELS[t]||t}</Tag>)}</Space></div>);})}</div>);})}
          </div>
          <Divider style={{ margin: "8px 0" }} />
          <div style={{ padding: "8px 12px", background: "#fffbe6", borderRadius: 6 }}>
            <Text strong>🔬 添加质控样本（可选）</Text>
            <Input.Search placeholder="输入 PT 编号 / 姓名 / case 编号搜索质控样本" allowClear
              value={qcSearch} onChange={(e: any) => searchQC(e.target.value)} onSearch={(v: string) => searchQC(v)}
              loading={qcSearching} style={{ marginTop: 8, marginBottom: 8 }} />
            {!qcSearch.trim() && !selectedQC && (
              <Text type="secondary" style={{ fontSize: 12 }}>按需搜索：输入 PT 编号（如 PT1618W）、姓名或 case 编号后再选择</Text>
            )}
            {qcSearch.trim() && !qcSearching && qcCandidates.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>没有匹配的质控候选（需已完成前处理且还有剩余血浆管）</Text>
            )}
            {qcSearch.trim() && qcCandidates.length > 0 && (<div style={{ marginBottom: 8 }}>{qcCandidates.map(qc => (
              <div key={qc.id} style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
                <Radio checked={selectedQC?.id === qc.id} onChange={() => setSelectedQC(qc)} />
                <Text code style={{ fontSize: 11 }}>{qc.case_number}</Text>{qc.test_sample_id && <Tag color="blue">{qc.test_sample_id}</Tag>}
                <Text>{qc.patient_name}</Text><Tag>管数: {qc.aliquot_tubes}</Tag></div>))}</div>)}
            {selectedQC && (<div style={{ marginTop: 4 }}><Tag color="orange">已选质控: {selectedQC.patient_name} {selectedQC.test_sample_id}-QC</Tag><Button type="link" size="small" onClick={() => setSelectedQC(null)}>取消</Button></div>)}
          </div>
        </div>)}
      </Modal>

    </div>
  );
}