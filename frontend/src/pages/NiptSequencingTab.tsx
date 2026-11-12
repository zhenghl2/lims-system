import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Typography, Table, Tag, Tooltip } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { INDEX_LOOKUP } from "../utils/indexLookup";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { useTranslation } from "../i18n/useTranslation";
import { registerTabSaver } from "../utils/niptTabSave";

const { Text } = Typography;

// ── Index range extender for 097-384 (generated from the original data)
// Only showing 001-096 above; 097+ follows same pattern
// For now we include the complete set up to 384

// ── Helper: parse index string (e.g. "UDIA-015" or "015") to lookup key ──
function parseIndexNum(index: string): string {
  const m = index.match(/(\d+)/);
  return m ? m[1].padStart(3, "0") : "";
}

// ── 平台 / 设备（2026-11-12：平台=测序仪直接选；实验设备照 NIPPT 三台） ──
// 2026-11-05（用户口径）：芯片类型改为固定 3 种 PRM 规格，与平台无关
const CHIP_TYPE_OPTIONS = [
  { value:"PRM-PE150-150M", label:"PRM-PE150-150M" },
  { value:"PRM-PE100-250M", label:"PRM-PE100-250M" },
  { value:"PRM-PE75-500M",  label:"PRM-PE75-500M"  },
];
// 2026-11-05（用户口径）：补 PE100 / PE75 / SE50（原来只有 SE75 / SE100 / PE150）
const READ_TYPE_OPTIONS = [
  { value:"PE75",  label:"PE75"  },
  { value:"PE100", label:"PE100" },
  { value:"PE150", label:"PE150" },
  { value:"SE50",  label:"SE50"  },
  { value:"SE75",  label:"SE75"  },
  { value:"SE100", label:"SE100" },
];
/** 2026-11-12（用户口径）：测序平台 = 测序仪编号，直接选，不再由「设备」推导 */
const PLATFORM_OPTIONS = [
  { value: "YSFH-EI-035-01", label: "YSFH-EI-035-01（Illumian）" },
  { value: "YSFH-EI-035-02", label: "YSFH-EI-035-02（Salus）" },
];
/** 实验设备：完全照 NIPPT 杂交及测序（金属浴 / PCR仪 / Qubit，整批一套，可多选） */
// 2026-11-12（用户口径）：NIPT 测序只需 Qubit定量仪；金属浴 / PCR仪 已去掉
const SEQ_DEVICES: { key: "dev_qubit"; label: string; options: string[]; width: number }[] = [
  { key: "dev_qubit", label: "Qubit定量仪", options: ["YSFH-EI-021-02"], width: 200 },
];
/** 试剂目录：完全照抄 NIPPT 五类（探针 / 封闭序列 / 杂交试剂 / 测序试剂 / 定量试剂） */
type ReagentOpt = { value: string; label: string; cat: string };
const FIXED_REAGENTS: Record<string, { label: string; cat: string }> = {
  probe: { label: "NIPPT探针", cat: "定制" },
  blocker: { label: "NadPrep NanoBlockers (for Illumina),96 rxn", cat: "1006102" },
  quant: { label: "VAHTS 1×dsDNA HS Assay Kit", cat: "EQ121-02" },
};
const HYB_REAGENTS: ReagentOpt[] = [
  { value: "1005421", label: "NadPrep Rapid Hybrid Capture Reagents v2,96 rxn", cat: "1005421" },
  { value: "1005101", label: "NadPrep Hybrid Capture Reagents, 96 rxn", cat: "1005101" },
];
const SEQ_REAGENTS: ReagentOpt[] = [
  { value: "PRM-PE150-150M", label: "Salus Pro测序试剂套装(PRM-PE150-150M)", cat: "PRM-PE150-150M" },
  { value: "PRM-PE100-250M", label: "Salus Pro测序试剂套装(PRM-PE100-250M)", cat: "PRM-PE100-250M" },
  { value: "PRM-PE75-500M", label: "Salus Pro测序试剂套装(PRM-PE75-500M)", cat: "PRM-PE75-500M" },
  { value: "PRM-SE50-500M", label: "Salus Pro测序试剂套装(PRM-SE50-500M)", cat: "PRM-SE50-500M" },
  { value: "20064346CN", label: "NextSeq 500/550 Mid Output Kit v2.5 (300 Cycles)", cat: "20064346 CN" },
  { value: "20064344CN", label: "NextSeq 500/550 High Output Kit v2.5 (300 Cycles)", cat: "20064344 CN" },
];
// 2026-11-12（用户口径）：NIPT 测序只填 测序试剂 + 定量试剂；
// 探针 / 封闭序列 / 杂交试剂 已去掉（库里旧的 reagent_probe_* / reagent_blocker_* /
// reagent_hyb_* / hyb_kit 不删，保存时也不覆盖）
const RG_CATS: { key: "seq" | "quant"; name: string }[] = [
  { key: "seq", name: "测序试剂" },
  { key: "quant", name: "定量试剂" },
];
const rgOpts = (k: string): ReagentOpt[] => (k === "hyb" ? HYB_REAGENTS : k === "seq" ? SEQ_REAGENTS : []);

const STEPS = [{ key:"clean_equip",label:"设备准备（清洗）" },{ key:"reagent_prep",label:"试剂准备（解冻、混匀、离心）" },{ key:"sample_prep",label:"样本准备" },{ key:"on_machine",label:"上机测序" },{ key:"cleanup",label:"实验结束（清洁台面、紫外 30min）" }];

/** Mix 稀释行（与 NIPPT 杂交及测序同结构） */
interface MixRow { mix_name:string; source:string; pooling_batch_id?:string; library_conc:number|null;
  input_amount:number; input_vol:number; expected_conc:number; water_added:number; }

/** Mix 稀释表初始行（2026-11-12 用户口径）：
 *  优先用本批次已保存的 mix_rows；否则「新建批次时勾选的每个上游 Pooling 批次」各出一行，
 *  文库浓度预填该 Pooling 批次的理论浓度（pooling_data.totals.theoryConc）。 */
function buildMixRows(sd: any, b: any): MixRow[] {
  const saved = sd?.mix_rows;
  if (Array.isArray(saved) && saved.length) return saved as MixRow[];
  const srcs: any[] = (b?.source_batches || []);
  const chipNum = String(b?.batch_number || "").trim();
  return srcs.map((s: any, i: number) => ({
    mix_name: chipNum ? `${chipNum}Mix${i + 1}` : `mix${i + 1}`,
    source: s.batch_number || "",
    pooling_batch_id: s.id,
    library_conc: (typeof s.theory_conc === "number" ? s.theory_conc : null),
    input_amount: 10,
    input_vol: (typeof s.theory_conc === "number" && s.theory_conc > 0) ? 10 / s.theory_conc : 0,
    expected_conc: 0.8,
    water_added: 0,
  }));
}
interface Props { batch:any; onRefresh:()=>void; lastBatchSeqData?:any; }
interface IndexRow { key:number; idx:number; vgId:string; index:string; i7:string; i5:string; batchNumber:string; uploadId:string; reportCode:string; }

function getSignStatus(edata:any, role:"operator"|"reviewer") {
  const key = role==="operator"?"operator_signature":"reviewer_signature";
  const sig = edata?.[key];
  if (!sig||typeof sig!=="object"||!sig.username) return {signed:false,name:"",time:""};
  return {signed:true,name:sig.username,time:sig.signed_at||""};
}

export default function NiptSequencingTab({batch,onRefresh,lastBatchSeqData,apiBase="/runs"}:Props & { apiBase?: string }) {
  const { t } = useTranslation();
  const [form]=Form.useForm();
  const edata=useMemo(()=>batch.sequencing_data||{},[batch.sequencing_data]);
  // 2026-11-05（用户口径）：顶部「测序平台」与基本信息里的「测序仪」重复 → 删掉平台下拉，
  // 平台由测序仪自动推导（芯片类型/试剂盒都按平台联动）。
  const [platform,setPlatform]=useState(edata.platform || (edata.sequencing_data||{}).platform || "");
  const [steps,setSteps]=useState<Record<string,boolean>>(edata.step_confirmations||{});
  const [saving,setSaving]=useState(false);
  const [opModal,setOpModal]=useState(false);
  const [rvModal,setRvModal]=useState(false);
  const saveOkRef = useRef(false);   // 保存是否成功（签名前先保存用）
  const defaultsFetchedRef=useRef(false);
  useEffect(() => { defaultsFetchedRef.current = false; }, [batch.id]);
  const {signed:opSigned,name:opSigner}=getSignStatus(edata,"operator");
  const {signed:rvSigned,name:rvSigner}=getSignStatus(edata,"reviewer");

  // ── 2026-11-12：Mix 稀释表 / 设备 / 试剂（照 NIPPT 杂交及测序） ──
  const [mixRows,setMixRows]=useState<MixRow[]>(()=>buildMixRows(edata, batch));
  const [finalConc,setFinalConc]=useState<number>(Number(edata.final_conc ?? 0.783));
  const [seqKit,setSeqKit]=useState<string>(edata.sequencing_kit || "");
  const [quantKitH,setQuantKitH]=useState<string>(edata.quant_kit || "");
  const [rgLots,setRgLots]=useState<Record<string,{lot:string;expiry:string}>>(()=>Object.fromEntries(
    RG_CATS.map(c=>[c.key,{lot:edata[`reagent_${c.key}_lot`]||"",expiry:edata[`reagent_${c.key}_expiry`]||""}])));
  const [seqDev,setSeqDev]=useState<Record<string,string>>(()=>Object.fromEntries(
    SEQ_DEVICES.map(d=>[d.key, edata[d.key] || (d.options.length===1 ? d.options[0] : "")])));
  // 批次切换：按新批次的上游 Pooling 批次重建（已保存过 mix_rows 的批次保持原样）
  useEffect(()=>{
    const sd = batch.sequencing_data || {};
    setMixRows(buildMixRows(sd, batch));
    setFinalConc(Number(sd.final_conc ?? 0.783));
    setSeqKit(sd.sequencing_kit||""); setQuantKitH(sd.quant_kit||"");
    setRgLots(Object.fromEntries(RG_CATS.map(c=>[c.key,{lot:sd[`reagent_${c.key}_lot`]||"",expiry:sd[`reagent_${c.key}_expiry`]||""}])));
    setSeqDev(Object.fromEntries(SEQ_DEVICES.map(d=>[d.key, sd[d.key] || (d.options.length===1?d.options[0]:"")])));
  },[batch.id]);

  // ── Build index table from pooling data ──
  const poolSamples: any[] = useMemo(() => {
    const pdata = batch.pooling_data || {};
    const runSampleMap = new Map<string, string>();
    (batch.run_samples || []).forEach((rs: any) => {
      if (rs.sample_vg_id) runSampleMap.set(rs.sample_vg_id, rs.sample_status || "");
    });
    // 2026-11-05：只保留「本批次」里的样本。
    // 原来只按 REJECTED 过滤上游 JSON，导致只勾了 2 个样本、index 表却列出上游整批 12 行。
    const inBatch = runSampleMap.size > 0;
    return (pdata.samples || []).filter((s: any) => {
      if (s.qc === "FAIL") return false;
      const st = runSampleMap.get(s.vgId);
      if (st === "REJECTED") return false;
      if (inBatch && !runSampleMap.has(s.vgId)) return false;   // 不在本批次 → 不进 index 表
      return true;
    });
  }, [batch.pooling_data, batch.run_samples]);

  const indexRows: IndexRow[] = useMemo(() => {
    // 2026-11-05：批次号直接用批次本身的 batch_number（测序批次=操作员填的 chip 号）；
    // 老数据没有时再回退到 notes 里的 "Batch: xxx"
    const batchNotes = batch.notes || "";
    const batchNum = String(batch.batch_number || "").trim()
      || batchNotes.replace(/^Batch:\s*/i, "").trim();
    // Report Code prefix: chipXXXX → RXXXX.date
    // 2026-11-05：Report Code 的日期用「上机日期」（有就取，没有才用今天）。
    // 原来固定取浏览器当天 → 隔天打开同一批次，Report Code 会变。
    const today = edata?.seq_date ? dayjs(edata.seq_date).format("YYYY.MM.DD")
                                  : dayjs().format("YYYY.MM.DD");
    const reportPrefix = batchNum.replace(/^chip/i, "R");
    return poolSamples.map((ps: any, i: number) => {
      const indexStr = ps.index || "";
      const num = parseIndexNum(indexStr);
      const lookup = INDEX_LOOKUP[num] || { i7: "", i5: "" };
      const idxPadded = String(ps.index || "").padStart(3, "0");
      const vgId = ps.vgId || "";
      return {
        key: i,
        idx: i + 1,
        vgId,
        index: indexStr,
        i7: lookup.i7,
        i5: lookup.i5,
        batchNumber: batchNum,
        uploadId: `${batchNum}_${idxPadded}_${vgId}`,
        reportCode: `${reportPrefix}.${today}.${idxPadded}.${vgId}`,
      };
    });
  }, [poolSamples, batch.batch_number, batch.notes, edata?.seq_date]);

  useEffect(()=>{
    form.setFieldsValue({
      seq_date:edata.seq_date?dayjs(edata.seq_date):dayjs(),
      seq_time:edata.seq_time||dayjs().format("HH:mm"),
      equipment:edata.equipment||[],
      chip:edata.chip || (edata.sequencing_data||{}).chip || undefined,
      // 2026-11-05：单位改为 ng/μl（原 pM 是写错）；旧数据存的是 conc_pM，读时兼容
      conc_ng_ul:edata.conc_ng_ul ?? edata.conc_pM ?? undefined,
      read_type:edata.read_type||undefined,
      target_reads:edata.target_reads??undefined,
      temperature:edata.temperature??undefined,
      humidity:edata.humidity??undefined,
    });
    setSteps(edata.step_confirmations||{});
    // 2026-11-05：平台可能只在 sequencing_data 里（老数据/只发 JSON 的保存）→ 兜底，否则芯片类型一直是灰的
    const _pf = edata.platform || (edata.sequencing_data||{}).platform;
    if(_pf)setPlatform(_pf);
  },[edata,form]);

  // Pre-fill platform/equipment/chip from last batch (runs once per batch.id)
  useEffect(()=>{
    if(!batch.id||!lastBatchSeqData)return;
    const hasData=!!(edata.platform||(edata.equipment||[]).length||edata.dev_metal||edata.dev_pcr||edata.dev_qubit);
    if(hasData)return;
    if(defaultsFetchedRef.current)return;
    defaultsFetchedRef.current=true;
    const seq=lastBatchSeqData;
    if(seq.platform)setPlatform(seq.platform);
    form.setFieldsValue({ chip:seq.chip||undefined });
    // 设备：上一批填过的号带过来（与 NIPPT 一致）
    setSeqDev(Object.fromEntries(SEQ_DEVICES.map(d=>[d.key, seq[d.key] || (d.options.length===1 ? d.options[0] : "")])));
    // 试剂：名称/批号/有效期取上一批（与 NIPPT「默认带上一批」一致）
    setSeqKit(seq.sequencing_kit||""); setQuantKitH(seq.quant_kit||"");
    setRgLots(Object.fromEntries(RG_CATS.map(c=>[c.key,{
      lot:seq[`reagent_${c.key}_lot`]||"", expiry:seq[`reagent_${c.key}_expiry`]||"",
    }])));
  },[batch.id,lastBatchSeqData]);

  const toggleStep=(key:string)=>setSteps(prev=>({...prev,[key]:!prev[key]}));
  const addMixRow=()=>setMixRows(prev=>[...prev,{mix_name:`mix${prev.length+1}`,source:"",library_conc:null,
    input_amount:10,input_vol:0,expected_conc:0.8,water_added:0}]);
  const updateMixCell=(i:number,field:string,val:any)=>{
    setMixRows(prev=>{
      const next=[...prev]; const r={...next[i]} as any;
      r[field]=val;
      // 投入体积 = 投入量 / 文库浓度（与 NIPPT 同一口径）
      if(field==="library_conc") r.input_vol=(r.input_amount??0)/(val||1);
      if(field==="input_amount") r.input_vol=val/(r.library_conc||1);
      next[i]=r; return next;
    });
  };
  /** Mix 汇总（口径照抄 NIPPT 2026-10-16）：
   *  理论浓度=Σ投入量/Σ投入体积；加水量=(理论浓度/预期浓度-1)×Σ投入体积，预期浓度取第一行 */
  const mixSums=useMemo(()=>{
    const totalInput=mixRows.reduce((s,r)=>s+(r.input_amount??0),0);
    const totalVol=mixRows.reduce((s,r)=>s+(r.input_vol??0),0);
    const theoryConc=totalVol>0?totalInput/totalVol:0;
    const expectedConc=Number((mixRows[0] as any)?.expected_conc ?? 0.8)||0;
    const water=(expectedConc>0&&totalVol>0)?(theoryConc/expectedConc-1)*totalVol:0;
    return {totalInput,totalVol,theoryConc:Math.round(theoryConc*100)/100,expectedConc,
            water:Math.round(water*100)/100};
  },[mixRows]);

  const save=async(opts?:{refresh?:boolean})=>{
    saveOkRef.current = false;
    try{
      const vals=await form.validateFields();
      setSaving(true);
      const seqData={
        platform,
        seq_date:vals.seq_date?.format("YYYY-MM-DD"),
        seq_time:vals.seq_time,
        chip:vals.chip,
        // 2026-11-12：Mix 稀释表 + 实验设备 + 五类试剂（键名与 NIPPT 一致）
        mix_rows:mixRows, final_conc:finalConc,
        sequencing_kit:seqKit, quant_kit:quantKitH,
        ...Object.fromEntries(Object.entries(rgLots).flatMap(([k,v]:any)=>[
          [`reagent_${k}_lot`, v?.lot||""], [`reagent_${k}_expiry`, v?.expiry||""],
        ])),
        ...Object.fromEntries(SEQ_DEVICES.map(d=>[d.key, seqDev[d.key]||""])),
        conc_ng_ul:vals.conc_ng_ul,
        read_type:vals.read_type,
        target_reads:vals.target_reads,
        temperature:vals.temperature,
        humidity:vals.humidity,
        step_confirmations:steps,
        index_samples: indexRows.map(r => ({ vgId: r.vgId, uploadId: r.uploadId, reportCode: r.reportCode })),
      };
      await api.post(`${apiBase}/${batch.id}/save_sequencing/`,{sequencing_data:seqData});
      message.success("上机测序记录已保存");
      if (opts?.refresh !== false) onRefresh();
      saveOkRef.current = true;
    }catch(e:any){
      if(e?.errorFields){message.warning("请填写所有必填项");return;}
      message.error(e?.response?.data?.error||"保存失败");
    }finally{setSaving(false);}
  }
  // 2026-10-21：把本页保存注册给「完成本步」（避免未保存的填写在完成时丢失）
  const saveFnRef = useRef(save);
  saveFnRef.current = save;
  useEffect(() => {
    registerTabSaver(async () => { await saveFnRef.current(); return saveOkRef.current; });
    return () => registerTabSaver(null);
  }, []);

  // 2026-10-21：签名前先保存 —— 否则签完 onRefresh 会把未保存的填写全部冲掉
  const openSign = async (role: "op" | "rv") => {
    await save({ refresh: false });
    // 已完成批次记录锁定（save 只补照片），不因未保存拦截签名
    if (batch.status !== "COMPLETED" && !saveOkRef.current) {
      message.warning("请先补全必填项并保存成功，再签名");
      return;
    }
    if (role === "op") setOpModal(true); else setRvModal(true);
  };

  const indexColumns = [
    { title:"编号",dataIndex:"idx",key:"idx",width:50,align:"center" as const },
    { title:"VG_ID",dataIndex:"vgId",key:"vgId",width:100,render:(v:string)=><Text code style={{fontSize:12}}>{v||"-"}</Text> },
    { title:"Index",dataIndex:"index",key:"index",width:90,render:(v:string)=><Text code style={{fontSize:11}}>{v||"-"}</Text> },
    { title:"Index1_i7",dataIndex:"i7",key:"i7",width:90,render:(v:string)=><Text code style={{fontSize:11,color:"#1677ff"}}>{v||"-"}</Text> },
    { title:"Index2_i5",dataIndex:"i5",key:"i5",width:90,render:(v:string)=><Text code style={{fontSize:11,color:"#52c41a"}}>{v||"-"}</Text> },
    { title:"Batch Number",dataIndex:"batchNumber",key:"batchNumber",width:120,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
    { title:"upload_ID",dataIndex:"uploadId",key:"uploadId",width:100,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
    { title:"Report Code",dataIndex:"reportCode",key:"reportCode",width:110,render:(v:string)=><Text style={{fontSize:12}}>{v||<Text type="secondary">-</Text>}</Text> },
  ];

  // Mix 稀释表（与 NIPPT 杂交及测序同款表头/单元格）
  const th:React.CSSProperties={border:"1px solid #bbb",padding:"4px 8px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12};
  const td:React.CSSProperties={border:"1px solid #d9d9d9",padding:"4px 6px",textAlign:"center",fontSize:12};

  const handleDownloadCsv = () => {
    // Header: Sample_ID (renamed from upload_ID), Index1_i7, Index2_i5, Mismatch
    const header = "Sample_ID,Index1_i7,Index2_i5,Mismatch";
    const rows = indexRows.map(r => `${r.uploadId},${r.i7},${r.i5},`);
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SampleSheet_${String(batch.batch_number || "").trim() || batch.notes?.replace(/^Batch:\s*/i, "").trim() || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* 试剂（2026-11-12：照 NIPPT 五类固定目录，整批一套，默认带上一批） */}
      <Card size="small" title="🧪 试剂" style={{marginBottom:12}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:13}}>
          <thead><tr>
            {["试剂","试剂盒名称（货号）","批号","有效期"].map((h,i)=>(
              <th key={h} style={{border:"1px solid #ddd",padding:"6px 10px",background:"#f5f5f5",textAlign:i===0?"center":"left",width:i===0?110:(i===1?undefined:(i===2?180:150))}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {RG_CATS.map(cat=>{
              const opts=rgOpts(cat.key);
              const val=cat.key==="seq"?seqKit:quantKitH;
              const setVal=cat.key==="seq"?setSeqKit:setQuantKitH;
              const fixed=!opts.length?(FIXED_REAGENTS as any)[cat.key]:null;
              const cell:React.CSSProperties={border:"1px solid #ddd",padding:"4px 8px",verticalAlign:"middle"};
              const lot=rgLots[cat.key]||{lot:"",expiry:""};
              const setLot=(patch:any)=>setRgLots(p=>({...p,[cat.key]:{...(p[cat.key]||{lot:"",expiry:""}),...patch}}));
              return (
                <tr key={cat.key}>
                  <td style={{...cell,textAlign:"center",fontWeight:600}}>{cat.name}</td>
                  <td style={cell}>
                    {opts.length?(
                      <Select size="small" style={{width:"100%"}} allowClear value={val||undefined}
                        onChange={(v:any)=>setVal&&setVal(v||"")} placeholder="选择试剂（名称 / 货号）"
                        options={opts.map(o=>({value:o.value,label:`${o.label}（${o.cat}）`}))}/>
                    ):(
                      <span>{fixed.label}<Text code style={{marginLeft:6}}>{fixed.cat}</Text></span>
                    )}
                  </td>
                  <td style={cell}><Input size="small" value={lot.lot} onChange={e=>setLot({lot:e.target.value})} placeholder="批号" bordered={false}/></td>
                  <td style={cell}><DatePicker size="small" picker="month" value={lot.expiry?dayjs(lot.expiry):null}
                    onChange={d=>setLot({expiry:d?d.format("YYYY-MM"):""})} placeholder="有效期" bordered={false} style={{width:"100%"}} format="YYYY-MM"/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{marginTop:6,fontSize:11,color:"#999"}}>定量试剂为固定项；测序试剂 6 选 1。默认带上一批的批号与有效期。</div>
      </Card>

      {/* ── Mix 稀释表（2026-11-12 新增，照 NIPPT 杂交及测序）── */}
      <Card size="small" title="🧪 Mix 稀释表" style={{marginBottom:12}}>
        <div style={{overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"fixed"}}>
            <thead><tr>
              <th style={{...th,width:90}}>mix编号</th>
              <th style={{...th,width:170}}>mix来源（上游 Pooling 批次）</th>
              <th style={{...th,width:90}}>文库浓度</th>
              <th style={{...th,width:65}}>投入量</th>
              <th style={{...th,width:80}}>投入体积</th>
              <th style={{...th,width:85}}>理论浓度</th>
              <th style={{...th,width:70}}>预期浓度</th>
              <th style={{...th,width:80}}>加水量</th>
            </tr></thead>
            <tbody>
              {mixRows.length===0&&(
                <tr><td style={td} colSpan={8}>
                  <Text type="secondary" style={{fontSize:12}}>本批次没有上游 Pooling 批次（或未保存过 Mix 表），点下面「＋ 新增行」手工填</Text>
                </td></tr>
              )}
              {mixRows.map((r,i)=>(
                <tr key={i} style={{background:"#e8f5e9"}}>
                  <td style={td}><Tag color="blue">{r.mix_name}</Tag></td>
                  <td style={{...td,overflow:"hidden"}}>
                    {i < (batch.source_batches||[]).length
                      ? <Tooltip title={r.source||""}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.source||"-"}</div></Tooltip>
                      : <Input size="small" value={r.source} placeholder="填写来源/备注"
                          onChange={(e)=>updateMixCell(i,"source",e.target.value)} style={{width:"100%"}}/>}
                  </td>
                  <td style={td}><InputNumber size="small" min={0} step={0.01} value={r.library_conc as any}
                    onChange={v=>updateMixCell(i,"library_conc",v)} style={{width:80}} placeholder="0"/></td>
                  <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.input_amount}
                    onChange={v=>updateMixCell(i,"input_amount",v)} style={{width:60}} placeholder="0"/></td>
                  <td style={{...td,fontFamily:"monospace"}}>{r.input_vol>0?r.input_vol.toFixed(2):"-"}</td>
                  {i===0?<td style={{...td,background:"#e6f7ff",fontWeight:700}} rowSpan={Math.max(mixRows.length,1)}>{mixSums.theoryConc.toFixed(2)}</td>:null}
                  <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.expected_conc}
                    onChange={v=>updateMixCell(i,"expected_conc",v)} style={{width:60}} placeholder="0"/></td>
                  <td style={{...td,fontFamily:"monospace"}}>{mixSums.water>0?mixSums.water.toFixed(2):"-"}</td>
                </tr>
              ))}
              <tr style={{background:"#f5f5f5"}}>
                <td style={td} colSpan={8}>
                  <Button size="small" type="dashed" onClick={addMixRow} style={{width:"100%"}}>＋ 新增行</Button>
                </td>
              </tr>
              <tr style={{background:"#fffbe6",fontWeight:600}}>
                <td style={td} colSpan={6}>
                  最终检测浓度: <InputNumber size="small" min={0} step={0.001} value={finalConc}
                    onChange={v=>v!==null&&setFinalConc(v)} style={{width:80}}/>
                </td>
                <td style={td} colSpan={2}>
                  总投入: {mixSums.totalInput.toFixed(2)} ng | 总体积: {mixSums.totalVol.toFixed(2)} μL
                  {mixSums.expectedConc?<> | 按预期浓度 {mixSums.expectedConc} 计算加水量</>:null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Form form={form} layout="vertical">
        {/* Basic info */}
        <Card size="small" title={t("nipt.sequencing.basicInfo")} style={{marginBottom:12}}>
          <Row gutter={[16,8]}>
            <Col span={6}><Form.Item name="seq_date" label={t("nipt.extraction.experimentDate")} rules={[{required:true}]} style={{marginBottom:0}}><DatePicker style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_time" label={t("nipt.extraction.experimentTime")} rules={[{required:true}]} style={{marginBottom:0}}><Input placeholder="例：09:00"/></Form.Item></Col>
            <Col span={6}><Form.Item label={t("nipt.sequencing.equipment")} required style={{marginBottom:0}}>
              <Select value={platform||undefined} onChange={v=>setPlatform(v||"")}
                options={Array.from(new Set([...PLATFORM_OPTIONS.map(o=>o.value), platform].filter(Boolean)))
                  .map(v=>({ value:v, label: (PLATFORM_OPTIONS.find(o=>o.value===v)||{label:v}).label }))}
                placeholder="选择测序仪（平台）"/>
            </Form.Item></Col>
            <Col span={6}><Form.Item name="chip" label={t("nipt.sequencing.chipType")} rules={[{required:true}]} style={{marginBottom:0}}>
              <Select options={CHIP_TYPE_OPTIONS} placeholder={t("nipt.sequencing.selectChip")}/>
            </Form.Item></Col>
            <Col span={6}><Form.Item name="conc_ng_ul" label={t("nipt.sequencing.concentration")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} step={0.1} style={{width:"100%"}} placeholder="e.g. 12"/></Form.Item></Col>
            <Col span={6}><Form.Item name="read_type" label={t("nipt.sequencing.readLength")} rules={[{required:true}]} style={{marginBottom:0}}><Select options={READ_TYPE_OPTIONS} placeholder="选择"/></Form.Item></Col>
            <Col span={6}><Form.Item name="target_reads" label={t("nipt.sequencing.targetReads")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} style={{width:"100%"}} placeholder="e.g. 25"/></Form.Item></Col>
            <Col span={6}><Form.Item name="temperature" label={t("nipt.extraction.temperature")} style={{marginBottom:0}}><InputNumber min={0} max={50} step={0.1} style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="humidity" label={t("nipt.extraction.humidity")} style={{marginBottom:0}}><InputNumber min={0} max={100} style={{width:"100%"}}/></Form.Item></Col>
          </Row>
          {/* 实验设备：金属浴 / PCR仪 / Qubit（整批一套，可多选） */}
          <Space wrap size={8} style={{marginTop:10}}>
            {SEQ_DEVICES.map(d=>{
              const cur=String(seqDev[d.key]||"").split("、").map(x=>x.trim()).filter(Boolean);
              return (
                <span key={d.key} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                  <span style={{color:"#666",fontSize:12}}>{d.label}:</span>
                  <Select size="small" mode="multiple" style={{width:d.width}} maxTagCount={1} allowClear
                    placeholder="选择设备号（可多选）" value={cur}
                    onChange={(v:string[])=>setSeqDev(p=>({...p,[d.key]:v.filter(Boolean).join("、")}))}
                    options={Array.from(new Set([...d.options,...cur])).map(o=>({label:o,value:o}))}/>
                </span>
              );
            })}
          </Space>
        </Card>
      </Form>

      {/* ── Sample Index Table ── */}
      {indexRows.length > 0 && (
        <Card size="small" title={`${t("nipt.sequencing.indexTable")} (${indexRows.length} samples)`} style={{marginBottom:12}}
          extra={<Button size="small" icon={<DownloadOutlined />} onClick={handleDownloadCsv}>{t("nipt.sequencing.downloadCsv")}</Button>}>
          <Table rowKey="key" size="small" pagination={false} dataSource={indexRows} columns={indexColumns}
            scroll={{x:800}}
            locale={{emptyText:t("nipt.sequencing.noIndexData")}}/>
          <div style={{marginTop:8,fontSize:11,color:"#999"}}>
            {t("nipt.sequencing.indexHint")}
          </div>
        </Card>
      )}

      {/* Step Confirmations */}
      <Card title={t("nipt.extraction.stepConfirm")} size="small" style={{marginBottom:16}}>
        <Space wrap>{STEPS.map(step=>{const slm:Record<string,string>={clean_equip:t("nipt.sequencing.stepCleanEquip"),reagent_prep:t("nipt.sequencing.stepReagentPrep"),sample_prep:t("nipt.sequencing.stepSamplePrep"),on_machine:t("nipt.sequencing.stepOnMachine"),cleanup:t("nipt.sequencing.stepCleanup")};return(<Checkbox key={step.key} checked={!!steps[step.key]} onChange={()=>toggleStep(step.key)}>{slm[step.key]||step.label}</Checkbox>);})}</Space>
      </Card>

      {/* Signature */}
      <Card title={t("nipt.library.signature")} size="small" style={{marginBottom:16}}>
        <Space>
          {opSigned?<Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={() => openSign("op")}>{t("nipt.extraction.operatorLabel")}: {opSigner} ✓</Button>:<Button onClick={() => openSign("op")}>{t("nipt.extraction.operatorSign")}</Button>}
          {rvSigned?<Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={() => openSign("rv")}>{t("nipt.extraction.reviewerLabel")}: {rvSigner} ✓</Button>:<Button onClick={() => openSign("rv")}>{t("nipt.extraction.reviewerSign")}</Button>}
        </Space>
      </Card>

      {/* Save */}
      <div style={{textAlign:"right",marginBottom:16}}><Button type="primary" onClick={() => save()} loading={saving}>{t("nipt.sequencing.saveRecord")}</Button></div>

      <NiptSignerModal open={opModal} role="operator" roleLabel={t("nipt.extraction.operatorLabel")} batchId={batch.id} currentSigner={opSigner||null} signUrl={`${apiBase}/${batch.id}/sequencing/sign/`} onDone={()=>{setOpModal(false);onRefresh();}} onCancel={()=>setOpModal(false)}/>
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel={t("nipt.extraction.reviewerLabel")} batchId={batch.id} currentSigner={rvSigner||null} signUrl={`${apiBase}/${batch.id}/sequencing/sign/`} onDone={()=>{setRvModal(false);onRefresh();}} onCancel={()=>setRvModal(false)}/>
    </div>
  );
}
