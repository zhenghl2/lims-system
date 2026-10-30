// NipptLibrary.tsx — Library Prep module (NIPT-style table + reagents)
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ConfigProvider, Card, Table, Button, Tag, Modal, message, Typography, Input, Select, InputNumber,
  Space, Radio, Checkbox, Upload, Image, DatePicker, TimePicker, Form,
  Popover, Row, Col, Alert } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined, CameraOutlined, LoadingOutlined, DownloadOutlined } from "@ant-design/icons";
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
  if (!d || d.status === "COMPLETED") return raw;   // 已完成批次保持原样
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
const ROWS = ["A","B","C","D","E","F","G","H"];
const COLS = [1,2,3,4,5,6,7,8,9,10,11,12];

const STEPS = [
  {key:"reagent_warm",label:"试剂平衡至室温"},{key:"equipment_check",label:"检查设备运行状态"},
  {key:"supplies_ready",label:"准备耗材"},{key:"end_repair",label:"末端修复/加A"},
  {key:"adapter_ligation",label:"接头连接"},{key:"pcr_amplification",label:"PCR扩增"},
];
const EQUIPMENT_OPTIONS = [
  {value:"PCR_ABI_9700",label:"PCR仪 - ABI 9700"},{value:"PCR_BioRad_T100",label:"PCR仪 - Bio-Rad T100"},
];

// ── Reagent kits ──
const FEMALE_KITS = [{value:"F-KIT-A",label:"NIPPT Female Library Kit A"},{value:"F-KIT-B",label:"NIPPT Female Library Kit B"}];
const MALE_KITS = [{value:"M-KIT-A",label:"NIPPT Male Library Kit A"},{value:"M-KIT-B",label:"NIPPT Male Library Kit B"}];
const LIB_KITS = [{value:"ND607-C2",label:"VAHTS Universal DNA Library Prep Kit for Illumina V5 (ND607-C2)"},{value:"ND801-02",label:"VAHTS Universal Plus DNA Library Prep Kit V4 (ND801-02)"}];
const INDEX_KITS = [{value:"N34201",label:"VAHTS Maxi UDI Adapters Set1 (1-96) - Cat#N34201-01"},{value:"N34202",label:"VAHTS Maxi UDI Adapters Set2 (97-192) - Cat#N34202-01"},{value:"N34203",label:"VAHTS Maxi UDI Adapters Set3 (193-288) - Cat#N34203-01"},{value:"N34204",label:"VAHTS Maxi UDI Adapters Set4 (289-384) - Cat#N34204-01"}];

type PlateCell = { vgId: string; index: string; sampleIdx?: number; isQC?: boolean; kind?: string;
  /** 「提取顺序填入」保留的 SKIP 孔位：占位但无样本，不可拖动、不计样本数 */
  skip?: boolean;
  /** 仅居中合并板用于本板男女计数；kind/sampleIdx 保持与旧版一致（sample_results 的 key 不能变）*/
  sexKind?: "F" | "M" };
type PlateGrid = PlateCell[][];
interface SampleItem { id:string; patient_name:string; role:string; category:string; case_sample_ids:string[]; test_sample_id:string|null; is_qc?:boolean; qc_status:string; qc_note:string; }
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; created_at:string; receipt_location?:string; photos_pending?:boolean; }
interface BatchDetail extends BatchItem { female_samples:SampleItem[]; male_blood_samples:SampleItem[]; male_other_samples:SampleItem[]; library_data:any; }

export default function NipptLibrary() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail|null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // QC 质控样本单独记录（用上游行 id 建行，避免与母亲样本合并）
  const [selectedQCSrc, setSelectedQCSrc] = useState<Set<string>>(new Set());
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingLoc, setPendingLoc] = useState<string | undefined>(undefined);

  // ── Region & coords ──
  const [region, setRegion] = useState("XIAMEN");
  // 起点状态已迁到 xiamenStarts / hkFemaleStarts / hkMaleStarts（每块板各自起点，2026-10-14）
  // 孔板重排基准：记录"进入批次时"的起点/地区值，只有用户真的改了才重排（否则会覆盖拖动的板面）
  const plateBaseRef = useRef<string>("");

  // ── Reagents (NIPT-style) ──
  const [femaleLibKit, setFemaleLibKit] = useState("");
  const [maleLibKit, setMaleLibKit] = useState("");
  const [libKits, setLibKits] = useState<string[]>([]);
  const [libKitDetails, setLibKitDetails] = useState<Record<string,{lot:string;expiry:string}>>({});
  const [selectedIndexKits, setSelectedIndexKits] = useState<string[]>([]);
  const [indexKitDetails, setIndexKitDetails] = useState<Record<string,{lot:string;expiry:string}>>({});
  const [positiveControl, setPositiveControl] = useState("");
  const [negativeControl, setNegativeControl] = useState("");
  const [libForm] = Form.useForm();

  // ── Steps & photos ──
  const [stepConfirmations, setStepConfirmations] = useState<Record<string,boolean>>({});
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

  // ── Plate data (NIPT-style grid) ──
  const emptyPlate = ():PlateGrid => Array.from({length:8},()=>Array.from({length:12},()=>({vgId:"",index:""})));
  // 2026-10-14：超 96 孔自动增板 —— 状态改为「板数组」，每块板有独立起点；最多 4 块（4 套 UDI 试剂盒）
  const MAX_PLATES = 4;
  // 2026-10-30：填板方式 —— pt=按 PT 顺序居中（默认）｜extraction=按提取板列顺序（保留 SKIP）
  const [fillMode, setFillMode] = useState<"pt" | "extraction">("pt");
  const [extOrder, setExtOrder] = useState<any>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [femalePlates, setFemalePlates] = useState<PlateGrid[]>([emptyPlate()]);
  const [malePlates, setMalePlates] = useState<PlateGrid[]>([emptyPlate()]);
  const [xiamenPlates, setXiamenPlates] = useState<PlateGrid[]>([emptyPlate()]);
  const [xiamenStarts, setXiamenStarts] = useState<{f:string;m:string}[]>([{f:"",m:""}]);
  const [hkFemaleStarts, setHkFemaleStarts] = useState<string[]>([""]);
  const [hkMaleStarts, setHkMaleStarts] = useState<string[]>([""]);
  const [plateOverflow, setPlateOverflow] = useState(0);   // 超过 4 块板而未显示的样本数
  // 兼容旧代码：以下 4 个派生量 = 第 1 块板的起点（所有旧用法继续可用）
  const femaleStartCoord = xiamenStarts[0]?.f || "";
  const maleStartCoord = xiamenStarts[0]?.m || "";
  const hkFemaleStart = hkFemaleStarts[0] || "";
  const hkMaleStart = hkMaleStarts[0] || "";
  const setFemaleStartCoord = (v:string)=>setXiamenStarts(p=>[{...p[0], f:v}, ...p.slice(1)]);
  const setMaleStartCoord = (v:string)=>setXiamenStarts(p=>[{...p[0], m:v}, ...p.slice(1)]);
  const setHkFemaleStart = (v:string)=>setHkFemaleStarts(p=>[v, ...p.slice(1)]);
  const setHkMaleStart = (v:string)=>setHkMaleStarts(p=>[v, ...p.slice(1)]);
  /** 每块板的 setter（供 renderNiptPlate 用） */
  const plateSetter = (scheme:"f"|"m"|"x", k:number) => (updater:any) => {
    const setAll = scheme==="x" ? setXiamenPlates : scheme==="f" ? setFemalePlates : setMalePlates;
    setAll((prev:PlateGrid[]) => prev.map((g,i)=> i===k ? (typeof updater==="function" ? updater(g) : updater) : g));
  };
  const parsePlateKey = (pk:string) => ({ scheme:(pk[0]||"x") as "f"|"m"|"x", k:parseInt(pk.slice(1)||"0",10)||0 });
  /** 起点数组按需加长再写。
   *  ⚠️ 不能写成 prev.map((x,i)=> i===k?…:x)：板数多于数组长度时（如板2 而数组只有 1 个），
   *  map 根本遍历不到下标 k，用户的输入会被**静默丢弃**（表现为“第 2 块板输入框打不进字”）。 */
  const padStarts = <T,>(arr:T[], k:number, blank:T):T[] => {
    const next = arr.slice();
    while (next.length <= k) next.push(blank);
    return next;
  };

  /** Index 归一化：去空格、统一大写、纯数字时 01 与 1 视为同一个（用户选定口径） */
  const normIndex = (v:any):string => {
    const t = String(v ?? "").trim().toUpperCase();
    return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
  };

  /** 跨板 Index 查重：本批次「当前地区」的所有板（空 index 不算重复，另有「填齐」校验把关）
   *  - dups     ：归一化 index → 出现位置列表（顶部汇总提示用）
   *  - cellDup  ：`板key:行:列` → 该格重复信息（实时标红用，key 与 plateKey 同构：x0/f1/m2）
   *  用户口径（2026-10-14）：全批次所有板唯一；归一化比较；只提醒不拦；实时标红 */
  const indexCheck = useMemo(() => {
    const occ = new Map<string, {pos:string; vgId:string}[]>();
    const cells: {key:string; k:string; vgId:string}[] = [];
    const collect = (scheme:"x"|"f"|"m", arr:PlateGrid[], label:(k:number)=>string) =>
      arr.forEach((g, ki) => g.forEach((row, r) => row.forEach((cell, c) => {
        if (!cell?.vgId || !cell.index) return;
        const k = normIndex(cell.index);
        if (!k) return;
        const pos = `${label(ki)}·${ROWS[r]}${c+1}`;
        const list = occ.get(k) || [];
        list.push({ pos, vgId: cell.vgId });
        occ.set(k, list);
        cells.push({ key: `${scheme}${ki}:${r}:${c}`, k, vgId: cell.vgId });
      })));
    if (region === "XIAMEN") collect("x", xiamenPlates, k => `板${k+1}`);
    else { collect("f", femalePlates, k => `女性板${k+1}`); collect("m", malePlates, k => `男性板${k+1}`); }
    const dups = new Map<string, {pos:string; vgId:string}[]>();
    occ.forEach((v, k) => { if (v.length > 1) dups.set(k, v); });
    const cellDup = new Map<string, {pos:string; vgId:string}[]>();
    cells.forEach(({ key, k }) => { if (dups.has(k)) cellDup.set(key, dups.get(k)!); });
    return { dups, cellDup };
  }, [region, xiamenPlates, femalePlates, malePlates]);

  /** 重复提示文案（保存/完成时用，只提醒不拦） */
  const dupWarnText = (prefix:string) => {
    const n = indexCheck.dups.size;
    if (!n) return "";
    const brief = Array.from(indexCheck.dups.keys()).slice(0, 8).join("、");
    return `${prefix}注意：有 ${n} 个重复 Index（${brief}${n > 8 ? "…" : ""}），所有板之间不建议重复（已标黄提示，不影响保存）`;
  };
  /** 当前地区全部板（校验/导出用） */
  const allPlates = ():PlateGrid[] => region==="XIAMEN" ? xiamenPlates
    : (region==="HONGKONG" ? [...femalePlates, ...malePlates] : femalePlates);
  const [sampleResults, setSampleResults] = useState<Record<string,{status:string;note:string}>>({});

  // ── Coord helpers ──
  const coordToIndexTB = (coord:string)=>{const r=coord[0],c=parseInt(coord.slice(1));return (c-1)*8+ROWS.indexOf(r);};
  const indexToCoordTB = (i:number)=>{const c=Math.floor(i/8),r=i%8;return`${ROWS[r]}${c+1}`;};

  // ── Build plates ──
  /** 单块板：从 startIdx 起填，返回 [板, 用掉的样本数] */
  const fillPlateFromStart = (samples:SampleItem[], startIdx:number, kind:string):[PlateGrid,number] => {
    const p = emptyPlate();
    let idx = 0;
    for (let i = startIdx; i < 96 && idx < samples.length; i++) {
      const coord = indexToCoordTB(i);
      const r = ROWS.indexOf(coord[0]);
      const c = parseInt(coord.slice(1)) - 1;
      p[r][c] = { vgId: samples[idx].test_sample_id || "?", index: "", sampleIdx: idx, isQC: samples[idx].is_qc, kind };
      idx++;
    }
    return [p, idx];
  };
  /** 多块板：按顺序切片，每块板用各自起点；返回 {plates, overflow} */
  const buildPlatesFromStart = (samples:SampleItem[], starts:string[], kind:string) => {
    const plates:PlateGrid[] = []; let idx = 0;
    for (let k = 0; k < MAX_PLATES && idx < samples.length; k++) {
      const st = (starts[k] || "").trim();
      const [g, used] = st ? fillPlateFromStart(samples.slice(idx), coordToIndexTB(st), kind)
                           : fillCenteredPlate(samples.slice(idx), kind);
      plates.push(g); idx += used;
    }
    return { plates: plates.length ? plates : [emptyPlate()], overflow: samples.length - idx };
  };

  const fillCenteredPlate = (samples:SampleItem[], kind:string):[PlateGrid,number] => {
    const p = emptyPlate();
    const total = Math.min(samples.length, 96);
    const numCols = Math.min(Math.ceil(total/8),12);
    let startCol = Math.floor((12-numCols)/2);
    if (startCol%2===1) startCol-=1;
    let idx=0;
    for(let c=startCol;c<startCol+numCols&&idx<total;c++)
      for(let r=0;r<8&&idx<total;r++) {
        p[r][c] = {vgId:samples[idx].test_sample_id||"?",index:"",sampleIdx:idx,isQC:samples[idx].is_qc,kind};
        idx++;
      }
    return [p, idx];
  };

  /**
   * 2026-10-30「提取顺序填入」：把提取板的每一个「列」整列搬到建库板的一列。
   * · 列内 A→H 行位不变，SKIP 孔保留为空位
   * · 起始输入填 1~12 = 起始列号；留空 = 按本板列数居中
   * · 超过 12 列自动接下一块板（下一块板可用它自己的起始列）
   */
  const buildPlatesFromExtraction = (columns: any[], starts: string[], kind: string,
                                     idxById: Record<string, number>) => {
    const colNum = (v: string) => {
      const n = parseInt(String(v || "").replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) && n >= 1 && n <= 12 ? n - 1 : null;
    };
    const plates: PlateGrid[] = [];
    let ci = 0, p = 0;
    while (ci < columns.length && p < MAX_PLATES) {
      const st = colNum(starts[p] || "");
      const remain = columns.length - ci;
      const startCol = st !== null ? st : Math.max(0, Math.floor((12 - Math.min(remain, 12)) / 2));
      const g = emptyPlate();
      let used = 0;
      for (let c = startCol; c < 12 && ci < columns.length; c++) {
        const col = columns[ci] || {};
        const cells = col.cells || [];
        for (let r = 0; r < 8; r++) {
          const cell = cells[r] || {};
          if (cell.sample) {
            g[r][c] = {
              vgId: cell.sample.test_sample_id || "?",
              index: "",
              sampleIdx: idxById[cell.sample.id],
              isQC: !!cell.sample.is_qc,
              kind,
            };
          } else if (cell.skip) {
            g[r][c] = { vgId: "", index: "", skip: true, kind };
          }
        }
        ci++; used++;
      }
      if (!used) break;
      plates.push(g); p++;
    }
    return { plates: plates.length ? plates : [emptyPlate()], overflow: columns.length - ci };
  };

  /** 厦门合并板：顺序切片多板；每块板用各自的 女起/男起（2026-10-14） */
  const buildXiamenPlates = (female:SampleItem[], male:SampleItem[], starts:{f:string;m:string}[]) => {
    const plates:PlateGrid[] = []; let fi=0, mi=0;
    for (let k = 0; k < MAX_PLATES && (fi < female.length || mi < male.length); k++) {
      const st = starts[k] || {f:"", m:""};
      if(!st.f && !st.m && fi===0 && mi===0){
        // 无起点：整块居中（与旧行为一致，仅第 1 块；后续块各自居中）
      }
      const p = emptyPlate();
      const fStart = st.f ? coordToIndexTB(st.f) : 0;
      const mStart = st.m ? coordToIndexTB(st.m) : 0;
      if(!st.f && !st.m){
        // 居中合并板：严格按旧逻辑（kind="X"、sampleIdx=合并序号）→ sample_results 的 key 不变；
        // 只额外标 sexKind 供「本板男女数量」显示（2026-10-14）
        const rest = [...female.slice(fi), ...male.slice(mi)];
        const p2 = emptyPlate();
        const total2 = Math.min(rest.length, 96);
        const numCols = Math.min(Math.ceil(total2/8), 12);
        let startCol = Math.floor((12-numCols)/2);
        if (startCol%2===1) startCol-=1;
        let idx2 = 0;
        const fRemain = female.length - fi;
        for (let c=startCol; c<startCol+numCols && idx2<total2; c++)
          for (let r=0; r<8 && idx2<total2; r++) {
            p2[r][c] = { vgId: rest[idx2].test_sample_id||"?", index:"", sampleIdx: idx2,
                         isQC: rest[idx2].is_qc, kind:"X", sexKind: idx2 < fRemain ? "F" : "M" };
            idx2++;
          }
        const usedF = Math.min(idx2, fRemain);
        fi += usedF; mi += (idx2 - usedF);
        plates.push(p2);
        continue;
      }
      for(let i=0;i<96;i++){
        const coord = indexToCoordTB(i);
        if(i>=fStart&&fi<female.length&&(i<mStart||mi>=male.length||!st.m)){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:female[fi].test_sample_id||"?",index:"",sampleIdx:fi,isQC:female[fi].is_qc,kind:"F"};fi++;}
        else if(st.m&&i>=mStart&&mi<male.length){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:male[mi].test_sample_id||"?",index:"",sampleIdx:mi,isQC:male[mi].is_qc,kind:"M"};mi++;}
        else if(!st.m&&fi>=female.length&&mi<male.length){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:male[mi].test_sample_id||"?",index:"",sampleIdx:mi,isQC:male[mi].is_qc,kind:"M"};mi++;}
      }
      plates.push(p);
    }
    return { plates: plates.length ? plates : [emptyPlate()], overflow: (female.length-fi)+(male.length-mi) };
  };
  /** 多板统一入口（按地区） */
  const rebuildAllPlates = (d:any, startsXm:{f:string;m:string}[], startsF:string[], startsM:string[],
                            modeOverride?: "pt" | "extraction", orderOverride?: any) => {
    const males = maleOrder<SampleItem>(d);
    const mode = modeOverride || fillMode;
    const order = orderOverride || extOrder;
    if (region === "XIAMEN") {
      const r = buildXiamenPlates(d.female_samples || [], males, startsXm);
      setXiamenPlates(prev => r.plates.map((g,k)=>keepIndex(g, prev[k]||emptyPlate())));
      setPlateOverflow(r.overflow);
      // 起点数补齐到板数：只增不减，避免与依赖它的 effect 反复触发
      setXiamenStarts(p => p.length >= r.plates.length ? p : padStarts(p, r.plates.length-1, {f:"",m:""}));
    } else if (mode === "extraction" && order) {
      // 提取顺序：按提取板列 → 建库板列（保留 SKIP）
      const fIdx: Record<string, number> = {};
      (d.female_samples || []).forEach((x: any, i: number) => { if (x?.id) fIdx[x.id] = i; });
      const mIdx: Record<string, number> = {};
      males.forEach((x: any, i: number) => { if (x?.id) mIdx[x.id] = i; });
      const rf = buildPlatesFromExtraction(order?.female?.columns || [], startsF, "F", fIdx);
      const rm = buildPlatesFromExtraction(order?.male?.columns || [], startsM, "M", mIdx);
      setFemalePlates(prev => rf.plates.map((g,k)=>keepIndex(g, prev[k]||emptyPlate())));
      setMalePlates(prev => rm.plates.map((g,k)=>keepIndex(g, prev[k]||emptyPlate())));
      setPlateOverflow(rf.overflow + rm.overflow);
      setHkFemaleStarts(p => p.length >= rf.plates.length ? p : padStarts(p, rf.plates.length-1, ""));
      setHkMaleStarts(p => p.length >= rm.plates.length ? p : padStarts(p, rm.plates.length-1, ""));
    } else {
      const rf = buildPlatesFromStart(d.female_samples || [], startsF, "F");
      const rm = buildPlatesFromStart(males, startsM, "M");
      setFemalePlates(prev => rf.plates.map((g,k)=>keepIndex(g, prev[k]||emptyPlate())));
      setMalePlates(prev => rm.plates.map((g,k)=>keepIndex(g, prev[k]||emptyPlate())));
      setPlateOverflow(rf.overflow + rm.overflow);
      setHkFemaleStarts(p => p.length >= rf.plates.length ? p : padStarts(p, rf.plates.length-1, ""));
      setHkMaleStarts(p => p.length >= rm.plates.length ? p : padStarts(p, rm.plates.length-1, ""));
    }
  };

  // ── Auto-fill index ──
  const updateIndex = (setter:any, row:number, col:number, value:string) => {
    setter((prev:PlateGrid)=>{
      const next = prev.map(r=>r.map(c=>({...c})));
      next[row][col].index = value;
      // 自动填充：本孔若是本列中「同性别分组」的第一个有样本孔，就从「下一行」起递增。
      // ⚠️ 绝不回写当前孔、也不用绝对行号——列首不在 A 行（女起/男起非居中）时，
      //    base+行号 会让用户输入的孔被加上自己的行号（输入 1 在 D3 显示 4）。
      // ⚠️ 判定按性别分组：同列混排（女起 D3 + 男起 F3）时，男性区第一个孔上方是
      //    女性样本，旧逻辑会误判为「非列首」而拒绝递增。异性孔不阻断。
      const myKind = prev[row]?.[col]?.kind;
      const isFirstOfGroup = prev.slice(0, row).every(r => {
        const up = r?.[col];
        if (!up?.vgId) return true;                       // 空孔不阻断
        return !!myKind && up.kind !== myKind;            // 异性不阻断；同性别阻断
      });
      if (isFirstOfGroup && /^\d+$/.test(value.trim())) {
        const base = parseInt(value, 10);
        let offset = 1;
        for (let r = row + 1; r < 8; r++) {
          if (!prev[r]?.[col]?.vgId) continue;
          next[r][col].index = String(base + offset++);
        }
      }
      return next;
    });
  };

  /** 重排板（改起始坐标）时保留已填 Index：优先按样本(vgId)带走，匹配不到再按孔位回落 */
  const keepIndex = (newPlate:PlateGrid, oldPlate:PlateGrid):PlateGrid => {
    const byVg:Record<string,string> = {};
    oldPlate.forEach(row=>row.forEach(c=>{ if(c?.vgId && c.index) byVg[c.vgId]=c.index; }));
    newPlate.forEach((row,r)=>row.forEach((c,ci)=>{
      if(!c.vgId || c.index) return;
      if(byVg[c.vgId]!==undefined) c.index = byVg[c.vgId];
      else if(oldPlate[r]?.[ci]?.index) c.index = oldPlate[r][ci].index;
    }));
    return newPlate;
  };

  // ── Fetch ──
  const fetchBatches = useCallback(async()=>{setLoading(true);try{const r=await(casesApi as any).listLibraryBatches();setBatches(r.data?.results||[])}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{fetchBatches()},[fetchBatches]);

  // Rebuild plates when start coords change（仅当用户真的改了起点/地区；否则会覆盖拖动后的板面）
  useEffect(() => {
    if (!selectedBatch) return;
    const _key = `${region}|${femaleStartCoord}|${maleStartCoord}|${hkFemaleStart}|${hkMaleStart}`;
    if (plateBaseRef.current === "") { plateBaseRef.current = _key; return; }   // 刚进入批次：只记基准，不重排
    if (plateBaseRef.current === _key) return;                                  // 与基准一致：保持已保存的板面
    plateBaseRef.current = _key;                                                // 用户改了起点/地区：重排
    const d = selectedBatch;
    rebuildAllPlates(d, xiamenStarts, hkFemaleStarts, hkMaleStarts);
  }, [JSON.stringify(xiamenStarts), JSON.stringify(hkFemaleStarts), JSON.stringify(hkMaleStarts), region]);

  const fetchDetail = async(id:string)=>{
    setBatchLoading(true);
    try{
      const r = await(casesApi as any).getLibraryBatch(id);
      const d=r.data;setSelectedBatch(d);plateBaseRef.current="";
      setFillMode("pt"); setExtOrder(null);   // 换批次：回到默认排列
      const ld=d.library_data||{};
      setRegion(ld.region||"XIAMEN");setFemaleStartCoord(ld.female_start_coord||"");setMaleStartCoord(ld.male_start_coord||"");
      setHkFemaleStart(ld.hk_female_start||"");setHkMaleStart(ld.hk_male_start||"");
      setFemaleLibKit(ld.female_lib_kit||"");setMaleLibKit(ld.male_lib_kit||"");
      setLibKitDetails({});
      if(Array.isArray(ld.lib_kits)){setLibKits(ld.lib_kits.map((k:any)=>k.kit));const ldt:any={};ld.lib_kits.forEach((k:any)=>{ldt[k.kit]={lot:k.lot||"",expiry:k.expiry||""}});setLibKitDetails(ldt)}
      else{setLibKits([]);setLibKitDetails({})}
      setPositiveControl(ld.positive_control||"");setNegativeControl(ld.negative_control||"");
      if(Array.isArray(ld.index_kits)){setSelectedIndexKits(ld.index_kits.map((k:any)=>k.kit));const dt:any={};ld.index_kits.forEach((k:any)=>{dt[k.kit]={lot:k.lot||"",expiry:k.expiry||""}});setIndexKitDetails(dt)}
      else{setSelectedIndexKits([]);setIndexKitDetails({})}
      setStepConfirmations(ld.step_confirmations||{});
      // 照片（男女独立；旧 photos 归女性；厦门合并记录：female 空时合并 male）
      const legacyPhotos = Array.isArray(ld.photos) ? ld.photos : [];
      const isXmLoad = (ld.region || "XIAMEN") === "XIAMEN";
      const xmPhotos = isXmLoad
        ? [...(Array.isArray(ld.photos_female) ? ld.photos_female : legacyPhotos), ...(Array.isArray(ld.photos_male) ? ld.photos_male : [])]
        : null;
      const _pf = isXmLoad ? xmPhotos : (Array.isArray(ld.photos_female) ? ld.photos_female : legacyPhotos);
      const _pm = Array.isArray(ld.photos_male) ? ld.photos_male : [];
      setPhotosFSync(_pf);
      setPhotosMSync(_pm);
      // 历史 base64 照片后台迁移为 URL（幂等：同内容复用同一文件；失败保持 base64）
      migrateLegacyNipptPhotos("library", id, "f", _pf, setPhotosFSync);
      migrateLegacyNipptPhotos("library", id, "m", _pm, setPhotosMSync);
      // 人员（男女独立；旧批次字段归女性；厦门合并记录：female 空时取 male）
      setOperators(prev => ({ ...prev, [id]: splitPersons(ld.operator_female || ((ld.region||"XIAMEN")==="XIAMEN" ? (ld.operator_male || "") : "") || d.operator_name || "") }));
      setReviewers(prev => ({ ...prev, [id]: splitPersons(ld.reviewer_female || ((ld.region||"XIAMEN")==="XIAMEN" ? (ld.reviewer_male || "") : "") || d.reviewer || "") }));
      setOperatorsM(prev => ({ ...prev, [id]: splitPersons(ld.operator_male) }));
      setReviewersM(prev => ({ ...prev, [id]: splitPersons(ld.reviewer_male) }));
      // 日期/时间（男女独立；旧值归女性；厦门合并记录：female 空时取 male；未完成批次空值默认当前时间）
      const _lbNotDone = d.status !== "COMPLETED";
      const _lbD0 = dayjs().format("YYYY-MM-DD"), _lbT0 = dayjs().format("HH:mm");
      setDateF(ld.lib_date_female || ((ld.region||"XIAMEN")==="XIAMEN" ? (ld.lib_date_male || "") : "") || ld.lib_date || (_lbNotDone ? _lbD0 : ""));
      setTimeF(ld.lib_time_female || ((ld.region||"XIAMEN")==="XIAMEN" ? (ld.lib_time_male || "") : "") || ld.lib_time || (_lbNotDone ? _lbT0 : ""));
      setDateM(ld.lib_date_male || (_lbNotDone && !isXmLoad ? _lbD0 : ""));
      setTimeM(ld.lib_time_male || (_lbNotDone && !isXmLoad ? _lbT0 : ""));
      setSampleResults(ld.sample_results||{});
      // Restore plate data
      // 2026-10-14：优先读「板数组」；旧批次只有单板键 → 包成 1 块板（零迁移）
      const _asList = (v:any):PlateGrid[]|null => {
        if(!Array.isArray(v) || !v.length) return null;
        if(Array.isArray(v[0]) && Array.isArray(v[0][0])) return v;        // 板数组
        if(v.length===8 && Array.isArray(v[0])) return [v];                // 单块板
        return null;
      };
      const _xmS = Array.isArray(ld.xiamen_starts) && ld.xiamen_starts.length ? ld.xiamen_starts
                 : [{f: ld.female_start_coord || "", m: ld.male_start_coord || ""}];
      const _fS  = Array.isArray(ld.hk_female_starts) && ld.hk_female_starts.length ? ld.hk_female_starts : [ld.hk_female_start || ""];
      const _mS  = Array.isArray(ld.hk_male_starts) && ld.hk_male_starts.length ? ld.hk_male_starts : [ld.hk_male_start || ""];
      setXiamenStarts(_xmS); setHkFemaleStarts(_fS); setHkMaleStarts(_mS);
      const fps = _asList(ld.female_plates) || _asList(ld.female_plate);
      const mps = _asList(ld.male_plates) || _asList(ld.male_plate);
      const xps = _asList(ld.xiamen_plates) || _asList(ld.xiamen_plate);
      if(xps) setXiamenPlates(xps);
      else { const r = buildXiamenPlates(d.female_samples||[], maleOrder<SampleItem>(d), _xmS); setXiamenPlates(r.plates); setPlateOverflow(r.overflow); }
      if(fps) setFemalePlates(fps);
      else setFemalePlates(buildPlatesFromStart(d.female_samples||[], _fS, "F").plates);
      if(mps) setMalePlates(mps);
      else setMalePlates(buildPlatesFromStart(maleOrder<SampleItem>(d), _mS, "M").plates);
      libForm.setFieldsValue({
        equipment:ld.equipment||"",pcr_cycles:ld.pcr_cycles??12,cfDNA_volume:ld.cfDNA_volume??undefined,
        elution_volume:ld.elution_volume??undefined,temperature:ld.temperature??undefined,humidity:ld.humidity??undefined,
      });
    }catch{message.error("加载失败")}finally{setBatchLoading(false)}
  };

  /** 当前筛选（签收地）后可见的条目 —— 渲染与全选共用同一出口，避免逻辑漂移 */
  const visibleEntries = () => {
    if (!pendingData) return [] as any[];
    return pendingData.entries.filter((e: any) => !pendingLoc || e.receipt_location === pendingLoc);
  };

  /** 顶部计数：当前筛选可见的条目数（与分组标题同口径，条目数而非样本数） */
  const visCount = (female: boolean) =>
    visibleEntries().filter((e: any) => (e.category === "FEMALE_BLOOD") === female).length;

  /** 全选 / 取消全选：只作用于当前筛选可见样本（切到香港后全选 = 只选香港那批） */
  const toggleAll = (checked: boolean) => {
    if (!pendingData) return;
    if (checked) {
      const all = new Set<string>(); const qcAll = new Set<string>();
      for (const e of visibleEntries()) { if (e.is_qc) qcAll.add(e.qc_source_id); else for (const id of e.case_sample_ids) all.add(id); }
      setSelectedKeys(all); setSelectedQCSrc(qcAll);
    } else { setSelectedKeys(new Set()); setSelectedQCSrc(new Set()); }
  };

  const openNewBatch = async()=>{
    try{
      const r=await(casesApi as any).pendingLibrary();const d=r.data;setPendingData(d);
      const all=new Set<string>();const qcAll=new Set<string>();d.entries.filter((e:any)=>!pendingLoc||e.receipt_location===pendingLoc).forEach((e:any)=>{ if(e.is_qc) qcAll.add(e.qc_source_id); else e.case_sample_ids.forEach((id:string)=>all.add(id)); });setSelectedKeys(all);setSelectedQCSrc(qcAll);
      const now=new Date();const pfx=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}`;
      try{const br=await(casesApi as any).listLibraryBatches({search:pfx});const c=(br.data?.results||[]).filter((b:any)=>b.batch_number.startsWith(pfx)).length;setBatchNumberPreview(`${pfx}-${String(c+1).padStart(3,"0")}`)}
      catch{setBatchNumberPreview(`${pfx}-001`)}
      setModalOpen(true);
    }catch{message.error("加载失败")}
  };

  const createBatch = async()=>{
    if(selectedKeys.size===0 && selectedQCSrc.size===0){message.warning("请选择样本");return}
    try{const r=await(casesApi as any).createLibraryBatch({case_sample_ids:Array.from(selectedKeys), qc_source_ids:Array.from(selectedQCSrc)});message.success(`批次 ${r.data.batch_number} 已创建`);setModalOpen(false);fetchBatches()}
    catch(e:any){message.error(e?.response?.data?.detail||"创建失败")}
  };

  /** 保存前校验（side: f=女性 m=男性 all=两侧；有样本的侧才校验；照片+操作人+审核人） */
  const validateBeforeSave = (side: "f" | "m" | "all" = "all"): string[] => {
    const missing: string[] = [];
    if (!selectedBatch) return missing;
    const xiamen = region === "XIAMEN";
    const check = (s: "f" | "m", label?: string) => {
      const who = label ?? (s === "f" ? "女性" : "男性");
      const has = xiamen
        ? (selectedBatch.female_samples.length > 0 || selectedBatch.male_blood_count + selectedBatch.male_other_count > 0)
        : (s === "f"
            ? selectedBatch.female_samples.length > 0
            : selectedBatch.male_blood_count + selectedBatch.male_other_count > 0);
      if (!has) return;
      // 实验照片**不再是保存/完成前提**（2026-10-19）：改为完成时弹窗提醒，可完成后再补传
      const dv = s === "f" ? dateF : dateM;
      const opMap = s === "f" ? operators : operatorsM;
      const rvMap = s === "f" ? reviewers : reviewersM;
      if (!dv) missing.push(`选择${who}日期`);
      if (!(opMap[selectedBatch.id] || []).length) missing.push(`选择${who}操作人`);
      if (!(rvMap[selectedBatch.id] || []).length) missing.push(`选择${who}审核人`);
    };
    if (xiamen) {
      // 厦门：合并记录（承载在 female 字段），只校验一套
      check("f", "");
    } else {
      if (side === "f" || side === "all") check("f");
      if (side === "m" || side === "all") check("m");
    }
    return missing;
  };

  /** 已完成批次补照片：只写回 photos 字段，不动其他记录 */
  const persistPhotosOnly = async () => {
    if (!selectedBatch) return;
    try {
      const base: any = (selectedBatch as any).library_data || {};
      const ld = { ...base, photos_female: photosFRef.current, photos_male: photosMRef.current };
      await (casesApi as any).saveLibrary(selectedBatch.id, { library_data: ld });
      flushPhotoDeletes(selectedBatch.id);
      message.success("照片已保存");
      fetchDetail(selectedBatch.id);
    } catch {
      message.error("照片已上传，但记录未保存，请点「保存」重试");
    }
  };

  /** 缺照片提示文案（厦门=合并记录单套；香港=男女各一套） */
  const photosMissingText = (): string => {
    if (!selectedBatch) return "";
    const xiamen = region === "XIAMEN";
    const hasF = selectedBatch.female_samples.length > 0;
    const hasM = (selectedBatch.male_blood_count + selectedBatch.male_other_count) > 0;
    if (xiamen) return (hasF || hasM) && !photosFRef.current.length && !photosMRef.current.length ? "本批次" : "";
    const miss: string[] = [];
    if (hasF && !photosFRef.current.length) miss.push("女性");
    if (hasM && !photosMRef.current.length) miss.push("男性");
    return miss.join("、");
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

  // 构建与保存完全一致的 library_data（保存 / 完成前未保存检测共用）
  const buildLibraryData = ():any => {
    const sid = selectedBatch?.id || "";
    return {region,female_start_coord:femaleStartCoord,male_start_coord:maleStartCoord,
      hk_female_start:hkFemaleStart,hk_male_start:hkMaleStart,
      female_lib_kit:femaleLibKit,male_lib_kit:maleLibKit,
      lib_kits:libKits.map(k=>({kit:k,lot:libKitDetails[k]?.lot||"",expiry:libKitDetails[k]?.expiry||""})),
      index_kits:selectedIndexKits.map(k=>({kit:k,lot:indexKitDetails[k]?.lot||"",expiry:indexKitDetails[k]?.expiry||""})),
      positive_control:positiveControl,negative_control:negativeControl,
      lib_date_female: dateF || "", lib_time_female: timeF || "",
      lib_date_male: dateM || "", lib_time_male: timeM || "",
      ...libForm.getFieldsValue(),step_confirmations:stepConfirmations,sample_results:sampleResults,
      photos_female: photosFRef.current, photos_male: photosMRef.current,
      operator_female: joinPersons(operators[sid]), reviewer_female: joinPersons(reviewers[sid]),
      operator_male: joinPersons(operatorsM[sid]), reviewer_male: joinPersons(reviewersM[sid]),
      // 2026-10-14：板数组 + 每板起点；旧键保留 = 第 1 块板（兼容）
      female_plates:femalePlates,male_plates:malePlates,xiamen_plates:xiamenPlates,
      xiamen_starts:xiamenStarts,hk_female_starts:hkFemaleStarts,hk_male_starts:hkMaleStarts,
      female_plate:femalePlates[0],male_plate:malePlates[0],xiamen_plate:xiamenPlates[0],
    };
  };

  const saveProcessing = async(side: "f" | "m" | "all" = "all")=>{
    if(!selectedBatch)return;
    const who = region === "XIAMEN" ? "" : (side === "f" ? "女性" : side === "m" ? "男性" : "");
    // 竞态修复：等待所有照片读取/压缩完成再提交
    if (pendingUploads.current.length) {
      setBatchLoading(true);
      await Promise.allSettled(pendingUploads.current);
      setBatchLoading(false);
    }
    // 保存前校验：按侧
    const missing = validateBeforeSave(side);
    if (missing.length) { message.warning(`保存前请先：${missing.join("、")}`); return; }
    // Validate index
    const currentPlate = allPlates().flat();
    const missingIndex = currentPlate.some(row=>row.some(cell=>cell.vgId&&!cell.index));
    if(missingIndex){message.warning("请填写所有 Index");return}
    // Index 查重：只提醒不拦（用户 2026-10-14 选定），照常保存
    const _dupSaveMsg = dupWarnText("保存前");
    if(_dupSaveMsg){ message.warning({ content:_dupSaveMsg, duration:6 }); }
    if(selectedIndexKits.length===0){message.warning("请选择 Index 接头试剂盒");return}
    setSaving(true);
    try{
      const ld:any = buildLibraryData();
      await(casesApi as any).saveLibrary(selectedBatch.id,{library_data:ld});
      flushPhotoDeletes(selectedBatch.id);
      message.success(who ? `${who}保存成功` : "保存成功");fetchDetail(selectedBatch.id);
    }catch{message.error(who ? `${who}保存失败` : "保存失败")}
    finally{setSaving(false)}
  };

  const doCompleteBatch = async()=>{
    if(!selectedBatch)return;
    // 完成前校验：① 保存要求全满足（日期+操作人+审核人；照片不再强制）
    const miss = validateBeforeSave("all");
    if (miss.length) { message.warning(`完成前请先：${miss.join("、")}`); return; }
    // ② Index 完整性（与保存要求一致）
    const curPlate = allPlates().flat();
    const missIdx = curPlate.some(row=>row.some(cell=>cell.vgId&&!cell.index));
    if(missIdx){message.warning("完成前请先：填写所有 Index");return}
    // Index 查重：只提醒不拦（用户 2026-10-14 选定）
    const _dupDoneMsg = dupWarnText("完成前");
    if(_dupDoneMsg){ message.warning({ content:_dupDoneMsg, duration:6 }); }
    if(selectedIndexKits.length===0){message.warning("完成前请先：选择 Index 接头试剂盒");return}
    // ③ 必须保存过 + 无未保存改动（深度对比服务器数据）
    const serverLd = (selectedBatch as any).library_data || {};
    if (!(serverLd.operator_female || serverLd.operator_male)) { message.warning("完成前请先点击保存"); return; }
    if (JSON.stringify(canon(buildLibraryData())) !== JSON.stringify(canon(serverLd))) { message.warning("有未保存的修改，请先点击保存再完成"); return; }
    try{await(casesApi as any).completeLibrary(selectedBatch.id);message.success("已完成");setSelectedBatch(null);fetchBatches()}catch{message.error("失败")}};

  /** 点「完成批次」：单弹窗确认 —— 缺照片时提示可完成后补传，照片齐全则确认锁定 */
  const completeBatch = async()=>{
    if(!selectedBatch)return;
    const missPh = photosMissingText();
    Modal.confirm({
      title: missPh ? "尚未上传实验照片" : "完成批次？",
      content: missPh
        ? `${missPh}尚未上传实验照片，确定完成吗？（可完成后再补传）`
        : "完成后批次将锁定（可撤销）。",
      okText: missPh ? "确定完成" : "确定",
      cancelText: missPh ? "返回上传" : "取消",
      onOk: () => doCompleteBatch(),
    });
  };
  // ── 导出 Excel（照 DNA 提取模块的模板；厦门 1 sheet / 香港 女性+男性 2 sheet）──
  const exportExcel = () => {
    if (!selectedBatch) return;
    const sid = selectedBatch.id;
    const femSamples: SampleItem[] = selectedBatch.female_samples || [];
    const maleSamples: SampleItem[] = maleOrder<SampleItem>(selectedBatch);
    const kitLabel = (list: { value: string; label: string }[], v: string) => list.find(x => x.value === v)?.label || v || "—";

    // 共用试剂（只在第一个 sheet 输出一次）
    const commonReagents = (): any[][] => {
      const rows: any[][] = [["一、建库试剂盒及配套试剂"]];
      libKits.forEach(kv => {
        const k = LIB_KITS.find(x => x.value === kv);
        rows.push(["文库构建Kit", k?.label || kv, "批号", libKitDetails[kv]?.lot || "", "有效期", libKitDetails[kv]?.expiry || ""]);
      });
      selectedIndexKits.forEach(kv => {
        const k = INDEX_KITS.find(x => x.value === kv);
        rows.push(["Index接头", k?.label || kv, "批号", indexKitDetails[kv]?.lot || "", "有效期", indexKitDetails[kv]?.expiry || ""]);
      });
      rows.push(["阳性质控品", positiveControl || ""]);
      rows.push(["阴性质控品", negativeControl || ""]);
      rows.push([]);
      return rows;
    };

    // 96 孔板 → 行。姓名用 vgId(=test_sample_id) 匹配，最可靠：
    // 厦门合并板里男性 cell 的 sampleIdx 指向男性数组而非合并数组，按 sampleIdx 取会串人。
    // 板 → 网格（与网页一致：A-H × 1-12，格内「Index + VG ID」）+ 明细表
    const plateRows = (plate: PlateGrid, title: string, startLabel: string, startCoord: string): { rows: any[][]; merges: any[] } => {
      const pool = [...femSamples, ...maleSamples];
      const rows: any[][] = [[startCoord ? `${title}   ${startLabel}：${startCoord}` : `${title}   ${startLabel}：居中编号`]];
      // 表头：每口井占两列，数字写在左格（用合并跨两列）
      const header: any[] = [""];
      for (const c of COLS) { header.push(String(c)); header.push(""); }
      rows.push(header);
      const merges: any[] = [];
      const hdrRow = rows.length - 1;
      for (let i = 0; i < COLS.length; i++) {
        merges.push({ s: { r: hdrRow, c: 2 * i + 1 }, e: { r: hdrRow, c: 2 * i + 2 } });
      }
      for (const r of ROWS) {
        const line: any[] = [r];
        for (const c of COLS) {
          const cell = plate[ROWS.indexOf(r)]?.[c - 1];
          if (!cell?.vgId) { line.push("", ""); continue; }
          // 左格 index、右格 VG ID（QC 标记跟在 VG ID 后）
          line.push(cell.index || "", cell.vgId + (cell.isQC ? " QC" : ""));
        }
        rows.push(line);
      }
      // 明细表（姓名只在这里有位置放）；⚠️ 按列优先：A3-B3-C3… 然后 A4-B4-C4…
      rows.push([]);
      rows.push(["样本明细"]);
      rows.push(["孔位", "VG ID", "姓名", "Index"]);
      for (const c of COLS) {
        for (const r of ROWS) {
          const cell = plate[ROWS.indexOf(r)]?.[c - 1];
          if (!cell?.vgId) continue;
          const smp = pool.find(x => x.test_sample_id === cell.vgId);
          rows.push([`${r}${c}`, cell.vgId, smp?.patient_name || "", cell.index || ""]);
        }
      }
      return { rows, merges };
    };

    /** 生成 sheet，并把板图表头「数字跨两列」的合并套上去（startRow = 板图块在 aoa 里的起始行） */
    const sheetWithPlate = (aoa: any[][], plate: { rows: any[][]; merges: any[] }, startRow: number) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      (ws as any)["!merges"] = plate.merges.map(m => ({
        s: { r: m.s.r + startRow, c: m.s.c }, e: { r: m.e.r + startRow, c: m.e.c },
      }));
      return ws;
    };

    // 实验记录（只含用户点名的：日期/时间/男女试剂盒/操作人/审核人）
    const records = (who: string, date: string, time: string, kit: string, op: string, rev: string): any[][] => {
      const rows: any[][] = [["二、实验记录"]];
      rows.push(["日期", date || "", "时间", time || ""]);
      rows.push([who ? `试剂盒(${who})` : "试剂盒", kitLabel(who === "男性" ? MALE_KITS : FEMALE_KITS, kit)]);
      rows.push(["操作人", op || ""]);
      rows.push(["审核人", rev || ""]);
      rows.push([]);
      return rows;
    };

    const wb = XLSX.utils.book_new();
    if (region === "XIAMEN") {
      // 厦门：单 sheet（合并板，人员/日期走女性那套，与网页一致）
      const aoa: any[][] = [[`${selectedBatch.batch_number} — 文库构建记录（厦门）`], []];
      aoa.push(...commonReagents());
      aoa.push(...records("", dateF, timeF, femaleLibKit, joinPersons(operators[sid]), joinPersons(reviewers[sid])));
      // 2026-10-14：所有板依次列出（板1/板2/…）
      const xmMerges: any[] = [];
      let cursor = aoa.length;
      xiamenPlates.forEach((g,k)=>{
        const st = xiamenStarts[k] || {f:"",m:""};
        const xmStart = [st.f && `女起 ${st.f}`, st.m && `男起 ${st.m}`].filter(Boolean).join("  ");
        const cnt = (kind:string)=> g.flat().filter((c:any)=>c?.vgId && (c.sexKind||c.kind)===kind).length;
        const blk = plateRows(g, `三、96孔板 板${k+1}${xiamenPlates.length>1?`/共${xiamenPlates.length}块`:""}（👩${cnt("F")}+👨${cnt("M")} 合并板）`, "起始", xmStart);
        if (k > 0) { aoa.push([]); cursor += 1; }
        blk.merges.forEach(m=>xmMerges.push({ s:{r:m.s.r+cursor,c:m.s.c}, e:{r:m.e.r+cursor,c:m.e.c} }));
        aoa.push(...blk.rows);
        cursor += blk.rows.length;
      });
      XLSX.utils.book_append_sheet(wb, sheetWithPlate(aoa, {rows:[], merges:xmMerges}, 0), "文库构建");
    } else {
      // 香港：女性/男性两个 sheet；共用试剂只在「女性」sheet 出现一次
      const build = (isF: boolean) => {
        const aoa: any[][] = [[`${selectedBatch.batch_number} — ${isF ? "女性" : "男性"}文库构建记录`], []];
        if (isF) aoa.push(...commonReagents());
        aoa.push(...records(
          isF ? "女性" : "男性",
          isF ? dateF : dateM,
          isF ? timeF : timeM,
          isF ? femaleLibKit : maleLibKit,
          joinPersons((isF ? operators : operatorsM)[sid]),
          joinPersons((isF ? reviewers : reviewersM)[sid]),
        ));
        // 2026-10-14：该性别所有板依次列出
        const list = isF ? femalePlates : malePlates;
        const starts = isF ? hkFemaleStarts : hkMaleStarts;
        const hkMerges: any[] = [];
        let hkCursor = aoa.length;
        list.forEach((g,k)=>{
          const st = starts[k] || "";
          const blk = plateRows(g, `三、96孔板 板${k+1}${list.length>1?`/共${list.length}块`:""}（${isF ? "👩 女性板" : "👨 男性板"}）`,
                                isF ? "女起" : "男起", st);
          if (k > 0) { aoa.push([]); hkCursor += 1; }
          blk.merges.forEach(m=>hkMerges.push({ s:{r:m.s.r+hkCursor,c:m.s.c}, e:{r:m.e.r+hkCursor,c:m.e.c} }));
          aoa.push(...blk.rows);
          hkCursor += blk.rows.length;
        });
        return sheetWithPlate(aoa, {rows:[], merges:hkMerges}, 0);
      };
      XLSX.utils.book_append_sheet(wb, build(true), "女性");
      XLSX.utils.book_append_sheet(wb, build(false), "男性");
    }
    XLSX.writeFile(wb, `${selectedBatch.batch_number}_文库构建.xlsx`);
    message.success("已导出Excel");
  };

  const deleteBatch = async(id:string)=>{try{await(casesApi as any).deleteLibraryBatch(id);message.success("已删除");setSelectedBatch(null);fetchBatches()}catch(e:any){message.error(e?.response?.data?.detail||"删除失败")}};
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
              const url = await uploadNipptPhoto("library", selectedBatch?.id || "", side, dataUrl);
              if (side === "f") setPhotosFSync([...photosFRef.current, url]);
              else setPhotosMSync([...photosMRef.current, url]);
              // 已完成批次补照片：立即写回，避免刷新后丢失
              if (selectedBatch?.status === "COMPLETED") persistPhotosOnly();
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
    jobs.forEach(({ side, url }) => deleteNipptPhoto("library", batchId, side, url));
  };

  const removePhoto = (side: "f" | "m", index: number) => {
    const list = side === "f" ? photosFRef.current : photosMRef.current;
    const target = list[index];
    if (side === "f") setPhotosFSync(list.filter((_, i) => i !== index));
    else setPhotosMSync(list.filter((_, i) => i !== index));
    // 只登记，不立即删文件（见 flushPhotoDeletes 注释）
    if (isRemotePhoto(target)) pendingPhotoDeletes.current.push({ side, url: target });
    if (selectedBatch?.status === "COMPLETED") persistPhotosOnly();
  };

  /** 日期/时间 + 照片 + 操作人/审核人（男女各自一套；merged=厦门：单套不区分男女） */
  const renderPhotosPersons = (side: "f" | "m", merged?: boolean) => {
    if (!selectedBatch) return null;
    const who = merged ? "" : (side === "f" ? "女性" : "男性");
    const ph = side === "f" ? photosF : photosM;
    const dv = side === "f" ? dateF : dateM;
    const tv = side === "f" ? timeF : timeM;
    const opMap = side === "f" ? operators : operatorsM;
    const setOpMap = side === "f" ? setOperators : setOperatorsM;
    const rvMap = side === "f" ? reviewers : reviewersM;
    const setRvMap = side === "f" ? setReviewers : setReviewersM;
    return (
      <Card size="small" title={merged ? "📋 实验记录" : `📋 ${who}实验记录`} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ color: "#666" }}>日期:</span>
          <DatePicker size="small" style={{ width: 130 }} value={dv ? dayjs(dv) : null}
            onChange={(d: any) => (side === "f" ? setDateF : setDateM)(d ? d.format("YYYY-MM-DD") : "")} placeholder="选择日期" format="YYYY-MM-DD" />
          <span style={{ color: "#666", marginLeft: 8 }}>时间:</span>
          <TimePicker size="small" style={{ width: 100 }} format="HH:mm" value={tv ? dayjs(tv, "HH:mm") : null}
            onChange={(d: any) => (side === "f" ? setTimeF : setTimeM)(d ? d.format("HH:mm") : "")} placeholder="选择时间" />
        </div>
        {/* 已完成批次仍允许补传/删除照片（只解锁照片区与保存按钮，日期/操作人/审核人保持只读） */}
        <ConfigProvider componentDisabled={false}>
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
              <CameraOutlined style={{ fontSize: 24, color: "#999" }} /><Text type="secondary" style={{ fontSize: 11 }}>拍照</Text></div>
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
          <ConfigProvider componentDisabled={false}>
            <Button size="small" type="primary" style={{ marginLeft: 16 }} onClick={() => saveProcessing(side)}>保存</Button>
          </ConfigProvider>
        </div>
      </Card>
    );
  };

  // ── Table styles (NIPT-style) ──
  const thStyle:React.CSSProperties = {border:"1px solid #bbb",padding:"4px 6px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12,minWidth:32};
  const rowLabelStyle:React.CSSProperties = {border:"1px solid #bbb",padding:"4px 6px",textAlign:"center",fontWeight:600,fontSize:12,background:"#e8e8e8",width:24};
  const cellStyle:React.CSSProperties = {border:"1px solid #d9d9d9",padding:0,verticalAlign:"middle"};
  const inputStyle:React.CSSProperties = {width:50,border:"none",borderRadius:0,textAlign:"center",padding:"2px 4px",fontSize:11,background:"#fffbe6",borderRight:"1px solid #e0e0e0"};
  const vgIdStyle:React.CSSProperties = {fontSize:11,padding:"2px 4px",textAlign:"center",whiteSpace:"nowrap",maxWidth:80,background:"#fafafa",flex:1,display:"flex",alignItems:"center",justifyContent:"center"};

  // ── 拖拽换位：按住拖动交换两孔样本（vgId/sampleIdx/isQC 随样本走；Index 留在原孔）──
  const dragSrcRef = useRef<{plate:string;row:number;col:number}|null>(null);
  const touchDragRef = useRef<{plate:string;row:number;col:number;x:number;y:number;active:boolean}|null>(null);
  const [dragOverCell, setDragOverCell] = useState<{plate:string;row:number;col:number}|null>(null);

  const swapPlateCells = (fromKey:string, fromR:number, fromC:number, toKey:string, toR:number, toC:number) => {
    if (fromKey===toKey && fromR===toR && fromC===toC) return;
    const a = parsePlateKey(fromKey), b = parsePlateKey(toKey);   // plateKey 形如 x0/f1/m2
    // 跨板只允许「同类板之间」：厦门板↔厦门板、女性板↔女性板、男性板↔男性板
    if (a.scheme !== b.scheme) return;
    const setAll = a.scheme==="f"?setFemalePlates : a.scheme==="m"?setMalePlates : setXiamenPlates;
    setAll((prev:PlateGrid[])=>{
      const need = a.k===b.k ? [a.k] : [a.k, b.k];
      if (need.some(i=>!prev[i])) return prev;
      const next = prev.map((g,gi)=> need.includes(gi) ? g.map(r=>r.map(c=>({...c}))) : g);
      const A = next[a.k][fromR][fromC], B = next[b.k][toR][toC];
      // 样本（vgId/sampleIdx/isQC/kind/sexKind…）跟着人走；index 是试剂盒孔位号，留在原孔位
      next[a.k][fromR][fromC] = { ...B, index: A.index };
      next[b.k][toR][toC]     = { ...A, index: B.index };
      return next;
    });
  };

  /** 2026-10-30：切换「提取顺序填入」——取提取板列顺序后立即重排；再点一次恢复按 PT 顺序 */
  const toggleExtractionFill = async () => {
    if (!selectedBatch) return;
    if (fillMode === "extraction") {
      setFillMode("pt");
      setExtOrder(null);
      rebuildAllPlates(selectedBatch, xiamenStarts, hkFemaleStarts, hkMaleStarts, "pt", null);
      message.success("已恢复按 PT 顺序排列（起始输入回到孔位坐标，如 A3）");
      return;
    }
    setExtLoading(true);
    try {
      const r = await (casesApi as any).libraryExtractionOrder(selectedBatch.id);
      const d = r.data || {};
      const fN = d?.female?.columns?.length || 0;
      const mN = d?.male?.columns?.length || 0;
      if (!fN && !mN) {
        message.warning("本批次样本在提取板里没有找到排列数据（提取批次可能未保存板面）");
        return;
      }
      setExtOrder(d);
      setFillMode("extraction");
      // 原来的起始值是孔位坐标（如 A1），在「起始列」语义下会被读成第 1 列 → 先清空，按列数居中
      const cleanStarts = (arr: string[]) => arr.map(v => /^[0-9]{1,2}$/.test(String(v || "").trim()) ? v : "");
      const fStarts = cleanStarts(hkFemaleStarts);
      const mStarts = cleanStarts(hkMaleStarts);
      setHkFemaleStarts(fStarts); setHkMaleStarts(mStarts);
      rebuildAllPlates(selectedBatch, xiamenStarts, fStarts, mStarts, "extraction", d);
      const batches = (d.batches || []).join("、");
      message.success(`已按提取顺序排列：女性 ${fN} 列 / 男性 ${mN} 列（保留 SKIP）${batches ? "；提取批次 " + batches : ""}`, 6);
      if ((d.missing || []).length) {
        message.warning(`有 ${d.missing.length} 个样本找不到提取板位置，未排入板面：` +
          d.missing.slice(0, 3).map((x: any) => `${x.test_sample_id || ""} ${x.patient_name}`).join("、"), 8);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "读取提取顺序失败");
    } finally {
      setExtLoading(false);
    }
  };

  /** 按当前样本列表重建孔板（用于清理含旧样本的陈旧板面；Index 按 vgId 保留） */
  const rebuildPlates = () => {
    if (!selectedBatch) return;
    const d = selectedBatch;
    rebuildAllPlates(d, xiamenStarts, hkFemaleStarts, hkMaleStarts);
    message.success("已按当前样本重排孔板（确认无误后点「保存全部」）");
  };

  const renderNiptPlate = (plate:PlateGrid, setter:any, plateKey:string) => (
    <div style={{overflowX:"auto"}}>
      <table data-plate-grid={plateKey} style={{borderCollapse:"collapse",fontSize:12,margin:"0 auto"}}>
        <thead><tr><th style={rowLabelStyle}></th>{COLS.map(c=><th key={c} style={thStyle}>{c}</th>)}</tr></thead>
        <tbody>{ROWS.map((label,row)=>(
          <tr key={row}><td style={rowLabelStyle}>{label}</td>
            {Array.from({length:12},(_,col)=>{
              const cell = plate[row]?.[col]||{vgId:"",index:""};
              const sIdx = cell.sampleIdx;
              // Pass/Fail key 带性别前缀：厦门板女性 sampleIdx 与男性 sampleIdx 都从 0 起，
              // 旧 key 会让女性样本 N 与男性样本 N 共用同一个状态（实测已确认）。
              const sKey = sIdx!==undefined ? `${cell.kind||"X"}:${sIdx}` : undefined;
              const sr = sKey ? (sampleResults[sKey] ?? sampleResults[String(sIdx)]) : undefined;
              const failBg = sr?.status==="fail"?"#fff1f0":undefined;
              const passBg = sr?.status==="pass"?"#f6ffed":undefined;
              const baseBg = cell.skip ? "#fff7e6" : cell.vgId?"#e8f5e9":"#fafafa";
              const bg = failBg||passBg||baseBg;
              // Index 查重（实时）：本格重复则标红并提示其他位置
              const _dupList = indexCheck.cellDup.get(`${plateKey}:${row}:${col}`);
              const _dupOther = _dupList ? _dupList.filter(x => x.vgId !== cell.vgId).map(x => x.pos).join(" / ") : "";

  return (
                <td key={col}
                  data-plate-key={plateKey} data-plate-cell={row+","+col}
                  draggable={!!cell.vgId && selectedBatch?.status!=="COMPLETED"}
                  onDragStart={(e)=>{ dragSrcRef.current={plate:plateKey,row,col}; try{e.dataTransfer.setData("text/plain","");}catch{} e.dataTransfer.effectAllowed="move"; }}
                  onDragEnd={()=>{ dragSrcRef.current=null; setDragOverCell(null); }}
                  onDragOver={(e)=>{ const s0=dragSrcRef.current; if(!s0) return; if(parsePlateKey(s0.plate).scheme!==parsePlateKey(plateKey).scheme) return; if(s0.plate===plateKey&&s0.row===row&&s0.col===col) return; e.preventDefault(); e.dataTransfer.dropEffect="move"; if(!dragOverCell||dragOverCell.plate!==plateKey||dragOverCell.row!==row||dragOverCell.col!==col) setDragOverCell({plate:plateKey,row,col}); }}
                  onDragLeave={()=>{ setDragOverCell(p=>p&&p.plate===plateKey&&p.row===row&&p.col===col?null:p); }}
                  onDrop={(e)=>{ e.preventDefault(); const s0=dragSrcRef.current; if(s0) swapPlateCells(s0.plate,s0.row,s0.col,plateKey,row,col); dragSrcRef.current=null; setDragOverCell(null); }}
                  onTouchStart={(e)=>{ if(!cell.vgId||selectedBatch?.status==="COMPLETED") return; const t=e.touches[0]; touchDragRef.current={plate:plateKey,row,col,x:t.clientX,y:t.clientY,active:false}; }}
                  onTouchMove={(e)=>{ const d=touchDragRef.current; if(!d) return; const t=e.touches[0]; if(!d.active&&(Math.abs(t.clientX-d.x)>8||Math.abs(t.clientY-d.y)>8)){ d.active=true; dragSrcRef.current={plate:d.plate,row:d.row,col:d.col}; } if(d.active){ e.preventDefault(); const el=document.elementFromPoint(t.clientX,t.clientY) as HTMLElement|null; const cellEl=el?.closest?.("[data-plate-cell]") as HTMLElement|null; if(cellEl){ const pk=cellEl.getAttribute("data-plate-key")||""; const rc=(cellEl.getAttribute("data-plate-cell")||"").split(","); if(pk&&parsePlateKey(pk).scheme===parsePlateKey(plateKey).scheme) setDragOverCell({plate:pk,row:parseInt(rc[0]),col:parseInt(rc[1])}); } } }}
                  onTouchEnd={(e)=>{ const d=touchDragRef.current; touchDragRef.current=null; if(d&&d.active){ dragSrcRef.current=null; const t=e.changedTouches[0]; const el=document.elementFromPoint(t.clientX,t.clientY) as HTMLElement|null; const cellEl=el?.closest?.("[data-plate-cell]") as HTMLElement|null; setDragOverCell(null); if(cellEl){ const pk=cellEl.getAttribute("data-plate-key")||""; const rc=(cellEl.getAttribute("data-plate-cell")||"").split(","); if(pk) swapPlateCells(d.plate,d.row,d.col,pk,parseInt(rc[0]),parseInt(rc[1])); } } else { dragSrcRef.current=null; setDragOverCell(null); } }}
                  style={{...cellStyle,background:_dupList?"#fff7e6":bg,cursor:(cell.vgId&&selectedBatch?.status!=="COMPLETED")?"pointer":"default",outline:(dragOverCell&&dragOverCell.plate===plateKey&&dragOverCell.row===row&&dragOverCell.col===col)?"2px dashed #1677ff":undefined,outlineOffset:-2}}>
                  <Popover trigger={(selectedBatch?.status==="COMPLETED"||cell.skip)?[]:"click"} content={
                    <div style={{minWidth:180}}>
                      <Radio.Group value={sr?.status||""} onChange={e=>{const v=e.target.value;setSampleResults((p:any)=>({...p,[String(sKey)]:{status:v,note:v==="fail"?(p[String(sKey)]?.note||""):""}}))}}>
                        <Radio value="pass" style={{color:"#52c41a"}}>Pass</Radio>
                        <Radio value="fail" style={{color:"#ff4d4f"}}>Fail</Radio>
                      </Radio.Group>
                      {sr?.status==="fail"&&<TextArea size="small" rows={2} placeholder="失败原因..." value={sr?.note||""} onChange={e=>setSampleResults((p:any)=>({...p,[String(sKey)]:{status:"fail",note:e.target.value}}))} style={{marginTop:8}}/>}
                    </div>
                  }>
                    {cell.skip ? (
                      <div style={{minHeight:30,lineHeight:"30px",textAlign:"center",fontSize:10,color:"#d48806",fontWeight:600}}>SKIP</div>
                    ) : (
                    <div style={{display:"flex",alignItems:"stretch",minHeight:30}}>
                      <input type="text" data-ix-cell={row+"_"+col} disabled={selectedBatch?.status==="COMPLETED"} value={cell.index} onChange={e=>updateIndex(setter,row,col,e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); const ni=col*8+row+1; if(ni<96){ const nr=ni%8, nc=Math.floor(ni/8); const root=document.querySelector(`[data-plate-grid="${plateKey}"]`); const el=root?.querySelector(`[data-ix-cell="${nr}_${nc}"]`) as HTMLInputElement|null; if(el){ el.focus(); el.select(); } } } }} style={_dupList ? {...inputStyle, background:"#ffe58f", color:"#ad4e00", fontWeight:700, boxSizing:"border-box", border:"1px solid #faad14"} : inputStyle}
                        title={_dupList ? `Index ${cell.index} 重复：与 ${_dupOther} 相同` : undefined} placeholder="ix"/>
                      <div style={{...vgIdStyle}}>{cell.vgId||""}{cell.isQC?<span style={{color:"#13c2c2",fontWeight:600,marginLeft:1}}>QC</span>:null}</div>
                    </div>
                    )}
                  </Popover>
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  const batchColumns = [
    {title:"批次号",dataIndex:"batch_number",width:140,render:(v:string)=><Text code style={{fontSize:12}}>{v}</Text>},
    {title:"状态",dataIndex:"status",width:76,render:(v:string,r:BatchItem)=>{const c:Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"},l:Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};return<Space size={4} wrap><Tag color={c[v]||"default"}>{l[v]||v}</Tag>{r.photos_pending&&<Tag color="orange" style={{fontSize:10}}>📷 待补照片</Tag>}</Space>}},
    {title:"样本",width:90,render:(_:any,r:BatchItem)=><Text style={{fontSize:11}}>👩{r.female_count} 👨{r.male_blood_count+r.male_other_count}</Text>},
    {title:"签收地",width:88,render:(_:any,r:BatchItem)=>r.receipt_location?<Tag color={r.receipt_location.includes("/")?"red":"geekblue"} style={{fontSize:11}}>📍{r.receipt_location}</Tag>:<Text type="secondary" style={{fontSize:11}}>—</Text>},
  ];


  return (
    <div style={{display:"flex",height:"calc(100vh - 140px)",gap:12}}>
      <Card size="small" style={{width:sidebarCollapsed?50:380,flexShrink:0,transition:"width 0.25s",overflow:"hidden"}}
        title={sidebarCollapsed?undefined:"文库构建批次"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}/>}>
        {!sidebarCollapsed&&(<>
          <Button type="primary" icon={<PlusOutlined/>} block onClick={openNewBatch} style={{marginBottom:8}}>新建文库批次</Button>
          <Table dataSource={batches} rowKey="id" loading={loading} size="small" pagination={false} scroll={{y:"calc(100vh - 280px)"}}
            onRow={(r:BatchItem)=>({onClick:()=>fetchDetail(r.id),style:{background:selectedBatch?.id===r.id?"#e6f4ff":undefined,cursor:"pointer"}})} columns={batchColumns}/>
        </>)}
      </Card>
      <div style={{flex:1,overflow:"auto"}}>
        {selectedBatch?(
          <ConfigProvider componentDisabled={selectedBatch.status === "COMPLETED"}>
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status==="COMPLETED"?"green":selectedBatch.status==="IN_PROGRESS"?"blue":"default"}>{selectedBatch.status_display}</Tag>{selectedBatch.status==="COMPLETED"&&<Tag color="default">🔒 只读</Tag>}{(selectedBatch as any).photos_pending&&<Tag color="orange">📷 待补照片</Tag>}{selectedBatch.receipt_location&&<Tag color={selectedBatch.receipt_location.includes("/")?"red":"geekblue"} style={{fontSize:12}}>📍{selectedBatch.receipt_location}{selectedBatch.receipt_location.includes("/")?" ⚠️混地区":""}</Tag>}</Space>}
            extra={<Space>
              {<ConfigProvider componentDisabled={false}><Button size="small" danger icon={<DeleteOutlined/>} onClick={async()=>{ const r = await confirmBatchDelete("library", selectedBatch.id, async () => { fetchBatches(); setSelectedBatch(null as any); }); if (r.ok) await deleteBatch(selectedBatch.id); }}>删除</Button></ConfigProvider>}
              <Button disabled={false} icon={<ReloadOutlined/>} size="small" loading={batchLoading} onClick={()=>fetchDetail(selectedBatch.id)}>刷新</Button>
              <Button disabled={false} icon={<DownloadOutlined/>} size="small" onClick={exportExcel}>导出Excel</Button>
              {selectedBatch.status!=="COMPLETED"&&<Button icon={<ReloadOutlined/>} size="small" onClick={rebuildPlates}>按样本重排</Button>}
              {selectedBatch.status!=="COMPLETED"&&<>
                <Button type="primary" icon={<CheckOutlined/>} size="small" loading={saving} onClick={() => saveProcessing("all")}>保存全部</Button>
                <Button type="primary" size="small" danger onClick={completeBatch}>完成</Button>
              </>}
            </Space>}>
            {/* Region */}
            <Card size="small" style={{marginBottom:12}}>
              <Space direction="vertical" style={{width:"100%"}}>
                <Space wrap>
                  <Text strong>地区：</Text>
                  <Radio.Group value={region} onChange={e=>setRegion(e.target.value)} optionType="button" options={[{value:"XIAMEN",label:"厦门"},{value:"HONGKONG",label:"香港"}]}/>
                  <span>👩试剂盒:<Select size="small" style={{width:200}} value={femaleLibKit||undefined} onChange={setFemaleLibKit} options={FEMALE_KITS} placeholder="女性试剂盒"/></span>
                  <span>👨试剂盒:<Select size="small" style={{width:200}} value={maleLibKit||undefined} onChange={setMaleLibKit} options={MALE_KITS} placeholder="男性试剂盒"/></span>
                </Space>
                <Form form={libForm} layout="inline" style={{flexWrap:"wrap",gap:8}}>
                  <Form.Item name="equipment" label="设备"><Select size="small" style={{width:160}} options={EQUIPMENT_OPTIONS} placeholder="选择"/></Form.Item>
                  <Form.Item name="pcr_cycles" label="PCR cycles"><InputNumber size="small" style={{width:60}} min={0} max={30}/></Form.Item>
                </Form>
              </Space>
            </Card>

            {/* Reagent kits (NIPT-style) */}
            <Card size="small" title="建库试剂盒及配套试剂" style={{marginBottom:12}}>
              <div style={{marginBottom:8}}>
                <Row gutter={12} style={{marginBottom:4}}><Col span={13}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>文库构建Kit</span></Col><Col span={4}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>批号</span></Col><Col span={5}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>有效期</span></Col></Row>
                <Row gutter={12}><Col span={13}><Select mode="multiple" options={LIB_KITS} value={libKits} onChange={(vs:string[])=>{setLibKits(vs);setLibKitDetails((p:any)=>{const n={...p};Object.keys(n).forEach(k=>{if(!vs.includes(k))delete n[k]});vs.forEach(v=>{if(!n[v])n[v]={lot:"",expiry:""}});return n})}} placeholder="选择文库构建Kit" showSearch optionFilterProp="label" style={{width:"100%"}} maxTagCount={2}/></Col></Row>
                {libKits.map(kv=>{const k=LIB_KITS.find(k=>k.value===kv);return(
                  <Row key={kv} gutter={12} style={{marginBottom:8}}><Col span={13}><div style={{padding:"4px 11px",lineHeight:"30px",border:"1px solid #d9d9d9",borderRadius:6,background:"#f5f5f5",color:"#1677ff",fontWeight:500,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k?.label||kv}</div></Col>
                  <Col span={4}><Input placeholder="批号" value={libKitDetails[kv]?.lot||""} onChange={e=>setLibKitDetails((p:any)=>({...p,[kv]:{...p[kv],lot:e.target.value}}))}/></Col>
                  <Col span={5}><DatePicker picker="month" placeholder="有效期" style={{width:"100%"}} format="YYYY-MM" value={libKitDetails[kv]?.expiry?dayjs(libKitDetails[kv].expiry):null} onChange={(d:any)=>setLibKitDetails((p:any)=>({...p,[kv]:{...p[kv],expiry:d?d.format("YYYY-MM"):""}}))}/></Col></Row>
                )})}
              </div>
              <div style={{marginBottom:8}}>
                <Row gutter={12} style={{marginBottom:4}}><Col span={13}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>Index接头</span></Col><Col span={4}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>批号</span></Col><Col span={5}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>有效期</span></Col></Row>
                <Row gutter={12}><Col span={13}><Select mode="multiple" options={INDEX_KITS} value={selectedIndexKits} onChange={(vs:string[])=>{setSelectedIndexKits(vs);setIndexKitDetails((p:any)=>{const n={...p};Object.keys(n).forEach(k=>{if(!vs.includes(k))delete n[k]});vs.forEach(v=>{if(!n[v])n[v]={lot:"",expiry:""}});return n})}} placeholder="选择 Index 接头" showSearch optionFilterProp="label" style={{width:"100%"}} maxTagCount={2}/></Col></Row>
                {selectedIndexKits.map(kv=>{const k=INDEX_KITS.find(k=>k.value===kv);return(
                  <Row key={kv} gutter={12} style={{marginBottom:8}}><Col span={13}><div style={{padding:"4px 11px",lineHeight:"30px",border:"1px solid #d9d9d9",borderRadius:6,background:"#f5f5f5",color:"#1677ff",fontWeight:500,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k?.label||kv}</div></Col>
                  <Col span={4}><Input placeholder="批号" value={indexKitDetails[kv]?.lot||""} onChange={e=>setIndexKitDetails((p:any)=>({...p,[kv]:{...p[kv],lot:e.target.value}}))}/></Col>
                  <Col span={5}><DatePicker picker="month" placeholder="有效期" style={{width:"100%"}} format="YYYY-MM" value={indexKitDetails[kv]?.expiry?dayjs(indexKitDetails[kv].expiry):null} onChange={(d:any)=>setIndexKitDetails((p:any)=>({...p,[kv]:{...p[kv],expiry:d?d.format("YYYY-MM"):""}}))}/></Col></Row>
                )})}
              </div>

              <Row gutter={16} style={{marginTop:8}}>
                <Col span={12}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontWeight:600,whiteSpace:"nowrap"}}>阳性质控品:</span><Input placeholder="批号/序列号" value={positiveControl} onChange={e=>setPositiveControl(e.target.value)}/></div></Col>
                <Col span={12}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontWeight:600,whiteSpace:"nowrap"}}>阴性质控品:</span><Input placeholder="批号/序列号" value={negativeControl} onChange={e=>setNegativeControl(e.target.value)}/></div></Col>
              </Row>
            </Card>

            {/* Step confirmations */}
            <Card size="small" style={{marginBottom:12}}>
              <Text strong style={{marginBottom:8,display:"block"}}>📋 步骤确认</Text>
              <Space wrap>{STEPS.map(s=><Checkbox key={s.key} checked={!!stepConfirmations[s.key]} onChange={e=>setStepConfirmations(p=>({...p,[s.key]:e.target.checked}))}>{s.label}</Checkbox>)}</Space>
            </Card>

            {/* Plate(s) */}
            {indexCheck.dups.size > 0 && (
              <Alert type="warning" showIcon style={{marginBottom:8}}
                message={`Index 重复 ${indexCheck.dups.size} 个 —— 所有板之间不建议有重复 Index（仅提示，不影响保存与完成）`}
                description={
                  <div style={{fontSize:12, lineHeight:1.9}}>
                    {Array.from(indexCheck.dups.entries()).map(([k, v]) => (
                      <div key={k}><Text strong>{`Index ${k}`}</Text>{`：${v.map(x => x.pos).join(" / ")}`}</div>
                    ))}
                    <div style={{marginTop:4}}><Text type="secondary">请核对后修改；本提示不阻止「保存」与「完成」。</Text></div>
                  </div>
                } />
            )}
            {region==="XIAMEN"?(
              <Space direction="vertical" style={{width:"100%"}}>
                {xiamenPlates.map((g,k)=>{
                  const cnt = (kind:string)=> g.flat().filter((c:any)=>c?.vgId && (c.sexKind||c.kind)===kind).length;
                  const st = xiamenStarts[k] || {f:"",m:""};
                  return (
                    <Card key={`x${k}`} size="small" title={<Space>{`🧬 96孔板 板${k+1}${xiamenPlates.length>1?`/共${xiamenPlates.length}块`:""} — 👩${cnt("F")}+👨${cnt("M")} 样本`}<Text type="secondary" style={{fontSize:11}}>（按住拖动样本可换位）</Text><Text type="secondary" style={{fontSize:11}}>女起:</Text><Input size="small" style={{width:50}} value={st.f} onChange={e=>setXiamenStarts(p=>{const n=padStarts(p,k,{f:"",m:""}); n[k]={...n[k],f:e.target.value.toUpperCase()}; return n;})} placeholder="居中"/><Text type="secondary" style={{fontSize:11}}>男起:</Text><Input size="small" style={{width:50}} value={st.m} onChange={e=>setXiamenStarts(p=>{const n=padStarts(p,k,{f:"",m:""}); n[k]={...n[k],m:e.target.value.toUpperCase()}; return n;})} placeholder="居中"/></Space>}>
                      {renderNiptPlate(g, plateSetter("x", k), `x${k}`)}
                    </Card>
                  );
                })}
              </Space>
            ):(
              <Space direction="vertical" style={{width:"100%"}}>
                {/* 2026-10-30：按提取板列顺序填入（香港女性/男性板通用；保留 SKIP 孔位） */}
                <Space size={8} wrap>
                  <Button
                    size="small"
                    type={fillMode === "extraction" ? "primary" : "default"}
                    loading={extLoading}
                    onClick={toggleExtractionFill}
                  >
                    🧪 提取顺序填入
                  </Button>
                  {fillMode === "extraction" && (
                    <>
                      <Button size="small" onClick={toggleExtractionFill}>恢复按 PT 顺序</Button>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        已按提取板「一列 → 一列」排列（SKIP 孔保留）；「起始列」填 1–12，留空=居中
                      </Text>
                      {!!(extOrder?.female?.columns?.length || extOrder?.male?.columns?.length) && (
                        <Tag color="blue" style={{ fontSize: 11 }}>
                          提取批次 {(extOrder?.batches || []).join("、") || "—"}
                        </Tag>
                      )}
                    </>
                  )}
                </Space>
                {femalePlates.map((g,k)=>(
                  <Card key={`f${k}`} size="small" title={<Space>{`👩 女性板${k+1}${femalePlates.length>1?`/共${femalePlates.length}块`:""} — ${g.flat().filter((c:any)=>c?.vgId).length} 样本`}<Text type="secondary" style={{fontSize:11}}>（可拖动换位）</Text><Text type="secondary" style={{fontSize:11}}>{fillMode==="extraction"?"起始列:":"起始:"}</Text><Input size="small" style={{width:50}} value={hkFemaleStarts[k]||""} onChange={e=>setHkFemaleStarts(p=>{const n=padStarts(p,k,""); n[k]=fillMode==="extraction"?(e.target.value.replace(/[^0-9]/g,"").slice(0,2)):e.target.value.toUpperCase(); return n;})} placeholder={fillMode==="extraction"?"1-12":"居中"}/></Space>} extra={<Text type="secondary">试剂盒: {femaleLibKit||"未选"}</Text>}>
                    {renderNiptPlate(g, plateSetter("f", k), `f${k}`)}
                  </Card>
                ))}
                {malePlates.map((g,k)=>(
                  <Card key={`m${k}`} size="small" title={<Space>{`👨 男性板${k+1}${malePlates.length>1?`/共${malePlates.length}块`:""} — ${g.flat().filter((c:any)=>c?.vgId).length} 样本`}<Text type="secondary" style={{fontSize:11}}>（可拖动换位）</Text><Text type="secondary" style={{fontSize:11}}>{fillMode==="extraction"?"起始列:":"起始:"}</Text><Input size="small" style={{width:50}} value={hkMaleStarts[k]||""} onChange={e=>setHkMaleStarts(p=>{const n=padStarts(p,k,""); n[k]=fillMode==="extraction"?(e.target.value.replace(/[^0-9]/g,"").slice(0,2)):e.target.value.toUpperCase(); return n;})} placeholder={fillMode==="extraction"?"1-12":"居中"}/></Space>} extra={<Text type="secondary">试剂盒: {maleLibKit||"未选"}</Text>}>
                    {renderNiptPlate(g, plateSetter("m", k), `m${k}`)}
                  </Card>
                ))}
              </Space>
            )}
            {plateOverflow > 0 && (
              <Alert type="warning" showIcon style={{marginTop:8}}
                message={`样本超出 ${MAX_PLATES} 块板（${MAX_PLATES*96} 孔）容量：还有 ${plateOverflow} 个样本未排入板面，请拆分批次`} />
            )}

            {region==="XIAMEN"?renderPhotosPersons("f", true):(<>{renderPhotosPersons("f")}{renderPhotosPersons("m")}</>)}
          </Card>
          </ConfigProvider>
        ):(
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建文库批次</Button></div>
        )}
      </div>
      <Modal title="新建文库构建批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={700} okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData&&(<div>
          <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}><Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text></div>
          <Space style={{marginBottom:8}} wrap><Tag color="magenta">👩 {visCount(true)}</Tag><Tag color="blue">👨 {visCount(false)}</Tag>
            <Select placeholder="全部签收地" style={{ width: 140 }} value={pendingLoc} allowClear
              onChange={(v: string | undefined) => { setPendingLoc(v); setSelectedKeys(new Set()); }} options={LOC_OPTIONS} />
            <Button size="small" onClick={() => toggleAll(true)}>全选</Button>
            <Button size="small" onClick={() => toggleAll(false)}>取消全选</Button></Space>
          <div style={{maxHeight:350,overflow:"auto"}}>
            {/* 2026-10-26：男性不再分「血液 / 其他」，合并为一个男性分组；组内按 PT 编号排序 */}
            {([["FEMALE_BLOOD"],["MALE_BLOOD","MALE_OTHER"]] as string[][]).map((cats, gi)=>{
              const entries = pendingData.entries
                .filter((e:any)=>cats.includes(e.category) && (!pendingLoc || e.receipt_location === pendingLoc))
                .sort((a:any,b:any)=>{
                  const ka = String(a.test_sample_id || a.case_number || "￿");
                  const kb = String(b.test_sample_id || b.case_number || "￿");
                  return ka.localeCompare(kb, undefined, { numeric: true });
                });
              if(!entries.length)return null;
              const label = gi === 0 ? "👩 女性" : "👨 男性";

  return (<div key={gi} style={{marginBottom:8}}><Text strong style={{fontSize:13}}>{label} ({entries.length})</Text>
                {entries.map((e:any)=>{const allIn=e.is_qc?selectedQCSrc.has(e.qc_source_id):e.case_sample_ids.every((id:string)=>selectedKeys.has(id)),someIn=e.is_qc?selectedQCSrc.has(e.qc_source_id):e.case_sample_ids.some((id:string)=>selectedKeys.has(id));

  return (<div key={e.is_qc ? ("qc_"+e.qc_source_id) : e.case_sample_ids.join(",")} style={{padding:"4px 8px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:8}}>
                    <Checkbox checked={allIn} indeterminate={!allIn&&someIn} onChange={()=>{ if(e.is_qc){ setSelectedQCSrc(prev=>{const n=new Set(prev); if(n.has(e.qc_source_id)) n.delete(e.qc_source_id); else n.add(e.qc_source_id); return n;}); return; } setSelectedKeys(prev=>{const n=new Set(prev);if(allIn)e.case_sample_ids.forEach((id:string)=>n.delete(id));else e.case_sample_ids.forEach((id:string)=>n.add(id));return n})}}/>
                    <Text code style={{fontSize:11,width:150}}>{e.case_number}</Text>{e.test_sample_id&&<Tag color="blue" style={{fontSize:11}}>{e.test_sample_id}</Tag>}<Text strong>{e.patient_name}</Text>{e.receipt_location&&<Tag color={e.receipt_location==="HONGKONG"?"geekblue":"volcano"} style={{fontSize:10,marginRight:0}}>📍{LOC_LABEL[e.receipt_location]||e.receipt_location}</Tag>}</div>)})}</div>)
            })}
          </div>
        </div>)}
      </Modal>

    </div>
  );
}