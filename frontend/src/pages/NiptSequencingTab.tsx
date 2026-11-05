import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Typography, Table } from "antd";
import { PlusOutlined, DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
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

// ── Platform / Equipment ──
const EQUIPMENT_OPTIONS = [{ value:"ILLUMINA_500",label:"illumina500" },{ value:"ILLUMINA_550DX",label:"illumina550dx" },{ value:"SALUS_PRO",label:"Salus Pro" },{ value:"SIKUN_2000",label:"Sikun2000" },{ value:"MGI_G99",label:"MGI G99" },{ value:"PCR_ABI_9700",label:"PCR仪 - ABI 9700" },{ value:"PCR_ABI_Veriti",label:"PCR仪 - ABI Veriti" },{ value:"PCR_BioRad_T100",label:"PCR仪 - Bio-Rad T100" }];
// 2026-11-05（用户口径）：芯片类型改为固定 3 种 PRM 规格，与平台无关
const CHIP_TYPE_OPTIONS = [
  { value:"PRM-PE150-150M", label:"PRM-PE150-150M" },
  { value:"PRM-PE100-250M", label:"PRM-PE100-250M" },
  { value:"PRM-PE75-500M",  label:"PRM-PE75-500M"  },
];
// 测序仪型 equipment 值（用于从「测序仪」推导平台；PCR 仪不在其中）
const SEQUENCER_PLATFORMS = ["ILLUMINA_500","ILLUMINA_550DX","SALUS_PRO","SIKUN_2000","MGI_G99"];
// 2026-11-05（用户口径）：补 PE100 / PE75 / SE50（原来只有 SE75 / SE100 / PE150）
const READ_TYPE_OPTIONS = [
  { value:"PE75",  label:"PE75"  },
  { value:"PE100", label:"PE100" },
  { value:"PE150", label:"PE150" },
  { value:"SE50",  label:"SE50"  },
  { value:"SE75",  label:"SE75"  },
  { value:"SE100", label:"SE100" },
];
const DEFAULT_REAGENT_TYPES = [{ key: "SEQUENCING", label: "测序试剂" }, { key: "CHIP_FLOWCELL", label: "芯片/Flow Cell" }, { key: "WASH_BUFFER", label: "清洗液" }];
const REAGENT_OPTIONS = [{ key: "SEQUENCING", label: "测序试剂" }, { key: "CHIP_FLOWCELL", label: "芯片/Flow Cell" }, { key: "WASH_BUFFER", label: "清洗液" }, { key: "NAOH_DENATURE", label: "NaOH变性液" }, { key: "OTHER", label: "其他" }];
const REAGENT_KITS_BY_PLATFORM: Record<string,Record<string,{value:string;label:string}[]>> = { ILLUMINA_500:{"测序试剂":[{value:"NextSeq500_High_v2.5",label:"NextSeq 500 High Output v2.5"}],"芯片/Flow Cell":[{value:"S1_FlowCell",label:"S1 Flow Cell"},{value:"S2_FlowCell",label:"S2 Flow Cell"}],"清洗液":[{value:"Wash_Buffer_A",label:"Wash Buffer A"}]},ILLUMINA_550DX:{"测序试剂":[{value:"NextSeq550_High_v2.5",label:"NextSeq 550 High Output v2.5"}],"芯片/Flow Cell":[{value:"S1_FlowCell",label:"S1 Flow Cell"},{value:"S2_FlowCell",label:"S2 Flow Cell"}],"清洗液":[{value:"Wash_Buffer_A",label:"Wash Buffer A"}]},SALUS_PRO:{"测序试剂":[{value:"Salus_Seq_Kit_v1",label:"Salus Pro Sequencing Kit v1"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"Salus_Wash",label:"Salus Wash Buffer"}]},SIKUN_2000:{"测序试剂":[{value:"Sikun_Seq_Kit",label:"Sikun2000 Sequencing Kit"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"Sikun_Wash",label:"Sikun Wash Buffer"}]},MGI_G99:{"测序试剂":[{value:"MGI_G99_Standard",label:"MGI G99 Standard Kit"}],"芯片/Flow Cell":[{value:"FCL_Chip",label:"FCL Chip"},{value:"FCS_Chip",label:"FCS Chip"}],"清洗液":[{value:"MGI_Wash",label:"MGI Wash Buffer"}]} };
const STEPS = [{ key:"clean_equip",label:"设备准备（清洗）" },{ key:"reagent_prep",label:"试剂准备（解冻、混匀、离心）" },{ key:"sample_prep",label:"样本准备" },{ key:"on_machine",label:"上机测序" },{ key:"cleanup",label:"实验结束（清洁台面、紫外 30min）" }];

interface ReagentRow { id:number; type:string; kit:string; lot:string; expiry:string; }
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
  // Reagent type: English key ↔ Chinese label mapping (backward compat with saved data)
  const reagentKeyToChinese: Record<string, string> = { SEQUENCING: "测序试剂", CHIP_FLOWCELL: "芯片/Flow Cell", WASH_BUFFER: "清洗液", NAOH_DENATURE: "NaOH变性液", OTHER: "其他" };
  const chineseToReagentKey: Record<string, string> = {};
  Object.entries(reagentKeyToChinese).forEach(([k, v]) => { chineseToReagentKey[v] = k; });
  const translateReagentType = (v: string) => chineseToReagentKey[v] || v;
  const reagentOptionsTL = REAGENT_OPTIONS.map(o => ({ value: o.key, label: t(`nipt.sequencing.${o.key === "SEQUENCING" ? "seqReagent" : o.key === "CHIP_FLOWCELL" ? "chipFlowCell" : o.key === "WASH_BUFFER" ? "washBuffer" : o.key === "NAOH_DENATURE" ? "naohDenature" : "otherReagent"}`) }));
  const [form]=Form.useForm();
  const edata=useMemo(()=>batch.sequencing_data||{},[batch.sequencing_data]);
  // 2026-11-05（用户口径）：顶部「测序平台」与基本信息里的「测序仪」重复 → 删掉平台下拉，
  // 平台由测序仪自动推导（芯片类型/试剂盒都按平台联动）。
  const [platform,setPlatform]=useState(edata.platform || (edata.sequencing_data||{}).platform || "");
  const [steps,setSteps]=useState<Record<string,boolean>>(edata.step_confirmations||{});
  const [saving,setSaving]=useState(false);
  const [opModal,setOpModal]=useState(false);
  const [rvModal,setRvModal]=useState(false);
  const counterRef=useRef(100);
  const saveOkRef = useRef(false);   // 保存是否成功（签名前先保存用）
  const defaultsFetchedRef=useRef(false);
  useEffect(() => { defaultsFetchedRef.current = false; }, [batch.id]);
  const {signed:opSigned,name:opSigner}=getSignStatus(edata,"operator");
  const {signed:rvSigned,name:rvSigner}=getSignStatus(edata,"reviewer");

  const [reagents,setReagents]=useState<ReagentRow[]>(()=>{
    if(edata.reagents&&Array.isArray(edata.reagents)) return edata.reagents.map((r:any,i:number)=>({id:i+1,type:translateReagentType(r.type)||"",kit:r.kit||"",lot:r.lot||"",expiry:r.expiry||""}));
    return DEFAULT_REAGENT_TYPES.map((t,i)=>({id:i+1,type:t.key,kit:"",lot:"",expiry:""}));
  });

  // 测序仪 → 平台映射：取第一个「测序仪」型选项（PCR 仪器不算）
  const equipmentWatch = Form.useWatch("equipment", form);
  useEffect(() => {
    const list = Array.isArray(equipmentWatch) ? equipmentWatch : [];
    const seq = list.find((v: string) => SEQUENCER_PLATFORMS.includes(v));
    if (seq) setPlatform(seq);
    else if (list.length > 0) setPlatform("");   // 只选了 PCR 等非测序仪 → 清空
    // list 为空时保持原平台不动：老批次可能只存了 platform、没存 equipment
  }, [equipmentWatch]);


  const reagentKits=useMemo(()=>REAGENT_KITS_BY_PLATFORM[platform]||{},[platform]);

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
    const hasData=!!(edata.platform||(edata.equipment||[]).length);
    if(hasData)return;
    if(defaultsFetchedRef.current)return;
    defaultsFetchedRef.current=true;
    const seq=lastBatchSeqData;
    if(seq.platform)setPlatform(seq.platform);
    form.setFieldsValue({
      equipment:seq.equipment||[],
      chip:seq.chip||undefined,
    });
    if(seq.reagents&&Array.isArray(seq.reagents)&&seq.reagents.length>0){
      setReagents(seq.reagents.map((r:any,i:number)=>({id:i+1,type:translateReagentType(r.type)||"",kit:r.kit||"",lot:r.lot||"",expiry:r.expiry||""})));
    }
  },[batch.id,lastBatchSeqData]);

  const toggleStep=(key:string)=>setSteps(prev=>({...prev,[key]:!prev[key]}));
  const addReagent=()=>{const id=++counterRef.current;setReagents(prev=>[...prev,{id,type:"",kit:"",lot:"",expiry:""}]);};
  const removeReagent=(id:number)=>{setReagents(prev=>prev.filter(r=>r.id!==id));};
  const updateReagent=(id:number,field:keyof ReagentRow,value:string)=>{setReagents(prev=>prev.map(r=>r.id===id?{...r,[field]:value}:r));};

  const save=async(opts?:{refresh?:boolean})=>{
    saveOkRef.current = false;
    try{
      const vals=await form.validateFields();
      setSaving(true);
      const seqData={
        platform,
        seq_date:vals.seq_date?.format("YYYY-MM-DD"),
        seq_time:vals.seq_time,
        equipment:vals.equipment,
        chip:vals.chip,
        reagents:reagents.filter(r=>r.type),
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

  const thStyle:React.CSSProperties={border:"1px solid #bbb",padding:"6px 8px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12};
  const tdStyle:React.CSSProperties={border:"1px solid #d9d9d9",padding:0,minHeight:32};

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
      <Form form={form} layout="vertical">
        {/* Basic info */}
        <Card size="small" title={t("nipt.sequencing.basicInfo")} style={{marginBottom:12}}>
          <Row gutter={[16,8]}>
            <Col span={6}><Form.Item name="seq_date" label={t("nipt.extraction.experimentDate")} rules={[{required:true}]} style={{marginBottom:0}}><DatePicker style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_time" label={t("nipt.extraction.experimentTime")} rules={[{required:true}]} style={{marginBottom:0}}><Input placeholder="例：09:00"/></Form.Item></Col>
            <Col span={6}><Form.Item name="equipment" label={t("nipt.sequencing.equipment")} rules={[{required:true}]} style={{marginBottom:0}}><Select mode="multiple" options={EQUIPMENT_OPTIONS} placeholder={t("nipt.sequencing.equipmentPlaceholder")} maxTagCount={2}/></Form.Item></Col>
            <Col span={6}><Form.Item name="chip" label={t("nipt.sequencing.chipType")} rules={[{required:true}]} style={{marginBottom:0}}>
              <Select options={CHIP_TYPE_OPTIONS} placeholder={t("nipt.sequencing.selectChip")}/>
            </Form.Item></Col>
            <Col span={6}><Form.Item name="conc_ng_ul" label={t("nipt.sequencing.concentration")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} step={0.1} style={{width:"100%"}} placeholder="e.g. 12"/></Form.Item></Col>
            <Col span={6}><Form.Item name="read_type" label={t("nipt.sequencing.readLength")} rules={[{required:true}]} style={{marginBottom:0}}><Select options={READ_TYPE_OPTIONS} placeholder="选择"/></Form.Item></Col>
            <Col span={6}><Form.Item name="target_reads" label={t("nipt.sequencing.targetReads")} rules={[{required:true}]} style={{marginBottom:0}}><InputNumber min={0} style={{width:"100%"}} placeholder="e.g. 25"/></Form.Item></Col>
            <Col span={6}><Form.Item name="temperature" label={t("nipt.extraction.temperature")} style={{marginBottom:0}}><InputNumber min={0} max={50} step={0.1} style={{width:"100%"}}/></Form.Item></Col>
            <Col span={6}><Form.Item name="humidity" label={t("nipt.extraction.humidity")} style={{marginBottom:0}}><InputNumber min={0} max={100} style={{width:"100%"}}/></Form.Item></Col>
          </Row>
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

      {/* Reagents */}
      <Card size="small" title={t("nipt.sequencing.reagents")} extra={<Button size="small" icon={<PlusOutlined/>} onClick={addReagent}>{t("nipt.sequencing.addReagent")}</Button>} style={{marginBottom:12}}>
        {reagents.length===0?(
          <div style={{textAlign:"center",padding:16,color:"#999",fontSize:12}}>{t("nipt.sequencing.noReagents")}</div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
              <thead><tr><th style={thStyle}>{t("nipt.sequencing.reagentName")}</th><th style={thStyle}>{t("nipt.sequencing.reagentKit")}</th><th style={thStyle}>{t("nipt.sequencing.lotNumber")}</th><th style={thStyle}>{t("nipt.extraction.expiry")}</th><th style={{...thStyle,width:40}}></th></tr></thead>
              <tbody>
                {reagents.map(r=>{const kits=reagentKits[reagentKeyToChinese[r.type]||r.type]||[];return(
                  <tr key={r.id}>
                    <td style={tdStyle}><Select size="small" value={r.type||undefined} onChange={v=>{updateReagent(r.id,"type",v);updateReagent(r.id,"kit","");}} options={reagentOptionsTL} placeholder={t("nipt.sequencing.reagentType")} style={{"width":"100%"}} bordered={false}/></td>
                    <td style={tdStyle}><Select size="small" value={r.kit||undefined} onChange={v=>updateReagent(r.id,"kit",v)} options={kits} placeholder={t("nipt.extraction.kitPlaceholder")} style={{"width":"100%",minWidth:120}} bordered={false} showSearch optionFilterProp="label" popupMatchSelectWidth={false}/></td>
                    <td style={tdStyle}><Input size="small" value={r.lot} onChange={e=>updateReagent(r.id,"lot",e.target.value)} placeholder={t("nipt.extraction.lotPlaceholder")} bordered={false} style={{"textAlign":"center"}}/></td>
                    <td style={tdStyle}><DatePicker size="small" picker="month" value={r.expiry?dayjs(r.expiry):null} onChange={d=>updateReagent(r.id,"expiry",d?.format("YYYY-MM")||"")} placeholder={t("nipt.extraction.expiryPlaceholder")} style={{"width":"100%"}} bordered={false} format="YYYY-MM"/></td>
                    <td style={tdStyle}><Button type="link" danger size="small" icon={<DeleteOutlined/>} onClick={()=>removeReagent(r.id)}/></td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
