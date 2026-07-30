// NipptPooling.tsx — Library QC & Pooling (NIPT-style + grouping)
import { useState, useEffect, useCallback, useMemo } from "react";
import React from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, InputNumber,
  Space, Popconfirm, Select, Checkbox } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
const { Text, Title } = Typography;

const SAMPLE_TYPE_LABELS:Record<string,string>={BLOOD:"血液",DBS:"血痕",HAIR:"毛发",NAIL:"指甲",SWAB:"口拭子",TOOTHBRUSH:"牙刷"};
const DEFAULT_POOLING_AMOUNT=0;
const YIELD_THRESHOLD=60;
const DEFAULT_ELUTION=30;
const MAX_PER_GROUP=34;
const AMOUNT_MAP:Record<string,number>={BLOODSTAIN:250,HAIR:300,NAIL:160,SWAB:120,TOOTHBRUSH:450,CIGARETTE:120,BEARD:230};
const getDefaultAmount=(category:string,sampleType:string):number=>{
  if(category==="FEMALE_BLOOD")return 200;
  if(category==="MALE_BLOOD")return 120;
  return AMOUNT_MAP[sampleType]??120;
};

type PoolRow = { id:string; ptId:string; index:string; sampleType:string; category:string;
  concentration:number|null; elutionVolume:number; yield:number;
  poolingAmount:number; poolingVolume:number; eliminated:boolean; qc:string; mixOverride?:number };
type PoolGroup = { name:string; rows:PoolRow[]; totalMass:number; totalVol:number; theoryConc:number; dataAmount:number };
interface SampleItem { id:string; patient_name:string; category:string; test_sample_id:string|null; experiment_sample_type?:string; }
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; }
interface BatchDetail extends BatchItem { female_samples:SampleItem[]; male_blood_samples:SampleItem[]; male_other_samples:SampleItem[]; pooling_data:any; }

export default function NipptPooling() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail|null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [saving, setSaving] = useState(false);

  // Pooling state
  const [poolingBase, setPoolingBase] = useState(DEFAULT_POOLING_AMOUNT);
  const [globalElutionVol, setGlobalElutionVol] = useState(DEFAULT_ELUTION);
  const [groupBases, setGroupBases] = useState<Record<number,number>>({});
  const [groupElutions, setGroupElutions] = useState<Record<number,number>>({});
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [manualAlloc, setManualAlloc] = useState<{female:number;male:number}[]>([]);
  const [pendingAlloc, setPendingAlloc] = useState<{female:number;male:number}[]>([]);
  const [showAllocInputs, setShowAllocInputs] = useState(false);
  const [customAmounts, setCustomAmounts] = useState<Record<string,number>>({});
  const [useManualAlloc, setUseManualAlloc] = useState(false);
  const [savedIndexes, setSavedIndexes] = useState<Record<string,string>>({});

  // ── Computed females/males for allocation UI
  const females = rows.filter(r=>r.category==="FEMALE_BLOOD");
  const males = rows.filter(r=>r.category!=="FEMALE_BLOOD");

  // ── Grouping ──
  const groups = useMemo(():PoolGroup[]=>{
    const active = rows;
    const result:PoolGroup[] = [];
    
    // Use manual allocation if enabled
    const alloc = useManualAlloc && manualAlloc.length>0 ? manualAlloc : null;
    
    
    // Auto: distribute female/male evenly (default)
    const total = active.length;
    const numGroups = alloc ? alloc.length : (total > MAX_PER_GROUP ? Math.ceil(total / MAX_PER_GROUP) : 1);

    // Initialize mix arrays
    const mixArrays: PoolRow[][] = Array.from({length: numGroups}, () => []);
    const assigned = active.filter(r => r.mixOverride != null && r.mixOverride >= 1 && r.mixOverride <= numGroups);
    const unassigned = active.filter(r => !(r.mixOverride != null && r.mixOverride >= 1 && r.mixOverride <= numGroups));

    // Place assigned rows first
    for (const r of assigned) {
      mixArrays[(r.mixOverride || 1) - 1].push(r);
    }

    // Distribute unassigned
    let uf = unassigned.filter(r => r.category === "FEMALE_BLOOD");
    let um = unassigned.filter(r => r.category !== "FEMALE_BLOOD");
    if (alloc) {
      let fi = 0, mi = 0;
      for (let g = 0; g < alloc.length; g++) {
        const fTake = Math.min(alloc[g].female, uf.length - fi);
        const mTake = Math.min(alloc[g].male, um.length - mi);
        const fSlice = uf.slice(fi, fi + fTake);
        const mSlice = um.slice(mi, mi + mTake);
        fi += fTake; mi += mTake;
        mixArrays[g].push(...fSlice, ...mSlice);
      }
    } else {
      let fi = 0, mi = 0;
      for (let g = 0; g < numGroups; g++) {
        const fRemain = uf.length - fi;
        const mRemain = um.length - mi;
        const gRemain = numGroups - g;
        const fPerGroup = Math.ceil(fRemain / gRemain);
        const mPerGroup = Math.ceil(mRemain / gRemain);
        const fSlice = uf.slice(fi, fi + fPerGroup);
        const mSlice = um.slice(mi, mi + mPerGroup);
        fi += fPerGroup; mi += mPerGroup;
        mixArrays[g].push(...fSlice, ...mSlice);
      }
    }

    for (let g = 0; g < numGroups; g++) {
      const groupRows = mixArrays[g];
      const fCount = groupRows.filter(r => r.category === "FEMALE_BLOOD").length;
      const mCount = groupRows.filter(r => r.category !== "FEMALE_BLOOD").length;
      const dataAmt = fCount * 2 + mCount * 1;
      const totalMass = groupRows.reduce((s, r) => s + r.poolingAmount, 0);
      const totalVol = groupRows.reduce((s, r) => s + r.poolingVolume, 0);
      result.push({
        name: `mix${g + 1}`,
        rows: groupRows,
        totalMass: Math.round(totalMass * 100) / 100,
        totalVol: Math.round(totalVol * 100) / 100,
        theoryConc: totalVol > 0 ? Math.round(totalMass / totalVol * 100) / 100 : 0,
        dataAmount: dataAmt,
      });
    }
    return result;
  }, [rows, useManualAlloc, manualAlloc]);

  // ── Fetch ──
  const fetchBatches = useCallback(async()=>{setLoading(true);try{const r=await(casesApi as any).listPoolingBatches();setBatches(r.data?.results||[])}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{fetchBatches()},[fetchBatches]);

  const fetchDetail = async(id:string)=>{
    setBatchLoading(true);
    try{
      const r=await(casesApi as any).getPoolingBatch(id);
      const d=r.data;setSelectedBatch(d);
      const pd=d.pooling_data||{};
      setPoolingBase(pd.poolingBase??DEFAULT_POOLING_AMOUNT);
      setGlobalElutionVol(pd.globalElutionVol??DEFAULT_ELUTION);
      setGroupBases(pd.groupBases||{});
      setGroupElutions(pd.groupElutions||{});
      const allSamples = [...(d.female_samples||[]),...(d.male_blood_samples||[]),...(d.male_other_samples||[])];
      // Init manual alloc from saved or default
      const savedAlloc = pd.manual_alloc;
      if (savedAlloc && savedAlloc.length > 0) {
        setManualAlloc(savedAlloc); setUseManualAlloc(true);
      setCustomAmounts(pd.customAmounts||{});
      } else {
        setManualAlloc([]); setUseManualAlloc(false);
      }
      const savedRows = pd.rows||[];
      // Index from library plate or saved data
      const savedIdx = pd.indexes||{};
      const libPlate = d.library_plate || [];
      if (Object.keys(savedIdx).length === 0 && libPlate.length > 0) {
        // Build vgId→index map from library plate
        const idxMap:Record<string,string> = {};
        libPlate.forEach((row:any[])=>
          row.forEach((cell:any)=>{ if(cell?.vgId && cell?.index) idxMap[cell.vgId] = cell.index; })
        );
        // Match by test_sample_id (vgId)
        const autoIdx:Record<string,string> = {};
        allSamples.forEach((s:SampleItem)=>{
          autoIdx[s.id] = idxMap[s.test_sample_id||''] || '';
        });
        setSavedIndexes(autoIdx);
      } else {
        setSavedIndexes(savedIdx);
      }
      const poolRows:PoolRow[] = allSamples.map((s:SampleItem,i)=>{
        const sr = savedRows[i]||{};
        const conc = sr.concentration??null;
        const elution = sr.elutionVolume??globalElutionVol??DEFAULT_ELUTION;
        const y = (conc??0)*elution;
        const sampleTp=s.experiment_sample_type||(s.category==="MALE_BLOOD"?"BLOOD":s.category==="FEMALE_BLOOD"?"BLOOD":"");const defaultPa=getDefaultAmount(s.category,sampleTp);const pa=sr.poolingAmount??defaultPa;
        const pv = (conc??0)>0?pa/conc:0;
        const sampleType2 = s.experiment_sample_type||(s.category==="FEMALE_BLOOD"||s.category==="MALE_BLOOD"?"BLOOD":"");
        return {
          id:s.id, ptId:s.test_sample_id||"?", index:savedIdx[s.id]||"", sampleType:sampleType2, category:s.category,
          concentration:conc, elutionVolume:elution, yield:Math.round(y*10)/10,
          poolingAmount:pa, poolingVolume:Math.round(pv*100)/100,
          eliminated:sr.eliminated||false, qc:sr.qc||"PASS",
        };
      });
      setRows(poolRows);
    }catch{message.error("加载失败")}finally{setBatchLoading(false)}
  };

  const openNewBatch = async()=>{
    try{
      const r=await(casesApi as any).pendingPooling();const d=r.data;setPendingData(d);
      const all=new Set<string>();d.entries.forEach((e:any)=>e.case_sample_ids.forEach((id:string)=>all.add(id)));setSelectedKeys(all);
      const now=new Date();const pfx=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}`;
      try{const br=await(casesApi as any).listPoolingBatches({search:pfx});const c=(br.data?.results||[]).filter((b:any)=>b.batch_number.startsWith(pfx)).length;setBatchNumberPreview(`${pfx}-${String(c+1).padStart(3,"0")}`)}
      catch{setBatchNumberPreview(`${pfx}-001`)}
      setModalOpen(true);
    }catch{message.error("加载失败")}
  };

  const createBatch = async()=>{
    if(selectedKeys.size===0){message.warning("请选择样本");return}
    try{const r=await(casesApi as any).createPoolingBatch({case_sample_ids:Array.from(selectedKeys)});message.success(`批次 ${r.data.batch_number} 已创建`);setModalOpen(false);fetchBatches()}
    catch(e:any){message.error(e?.response?.data?.detail||"创建失败")}
  };

  const updateCell = (i:number, field:string, val:any)=>{
    setRows(prev=>{
      const next=[...prev];const r={...next[i]};
      (r as any)[field]=val;
      if(field==="concentration"||field==="elutionVolume"){
        const conc=field==="concentration"?val:r.concentration;
        const ev=field==="elutionVolume"?val:r.elutionVolume;
        r.yield=Math.round((conc??0)*ev*10)/10;
        
      }
      if(field==="poolingAmount"||field==="concentration"){
        const pa=field==="poolingAmount"?val:r.poolingAmount;
        const conc=field==="concentration"?val:r.concentration;
        r.poolingVolume=(conc??0)>0?Math.round(pa/(conc)*100)/100:0;
      }
      next[i]=r;return next;
    });
  };

  const save = async()=>{
    if(!selectedBatch)return;
    setSaving(true);
    try{
      const samples = rows.map(r=>({id:r.id,qc_status:r.qc,qc_note:""}));
      const pd = {
        poolingBase,globalElutionVol,groupBases,groupElutions,manual_alloc:manualAlloc,customAmounts,
        rows:rows.map(r=>({concentration:r.concentration,elutionVolume:r.elutionVolume,yield:r.yield,poolingAmount:r.poolingAmount,poolingVolume:r.poolingVolume,eliminated:r.eliminated,qc:r.qc})),
        indexes:savedIndexes,
      };
      await(casesApi as any).savePooling(selectedBatch.id,{pooling_data:pd,samples});
      message.success("保存成功");fetchDetail(selectedBatch.id);
    }catch{message.error("保存失败")}finally{setSaving(false)}
  };

  const completeBatch = async()=>{if(!selectedBatch)return;try{await(casesApi as any).completePooling(selectedBatch.id);message.success("已完成");setSelectedBatch(null);fetchBatches()}catch{message.error("失败")}};
  const deleteBatch = async(id:string)=>{try{await(casesApi as any).deletePoolingBatch(id);message.success("已删除");setSelectedBatch(null);fetchBatches()}catch(e:any){message.error(e?.response?.data?.detail||"删除失败")}};

  const batchColumns=[
    {title:"批次号",dataIndex:"batch_number",width:140,render:(v:string)=><Text code style={{fontSize:12}}>{v}</Text>},
    {title:"状态",dataIndex:"status",width:60,render:(v:string)=>{const c:Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"},l:Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};return<Tag color={c[v]||"default"}>{l[v]||v}</Tag>}},
    {title:"样本",width:100,render:(_:any,r:BatchItem)=><Text style={{fontSize:11}}>👩{r.female_count} 👨{r.male_blood_count+r.male_other_count}</Text>},
  ];

  const th:React.CSSProperties={border:"1px solid #bbb",padding:"4px 8px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12};
  const td:React.CSSProperties={border:"1px solid #d9d9d9",padding:"4px 6px",textAlign:"center",fontSize:12};

  return (
    <div style={{display:"flex",height:"calc(100vh - 140px)",gap:12}}>
      <Card size="small" style={{width:sidebarCollapsed?50:380,flexShrink:0,transition:"width 0.25s",overflow:"hidden"}}
        title={sidebarCollapsed?undefined:"文库定量及Pooling"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}/>}>
        {!sidebarCollapsed&&(<>
          <Button type="primary" icon={<PlusOutlined/>} block onClick={openNewBatch} style={{marginBottom:8}}>新建Pooling批次</Button>
          <Table dataSource={batches} rowKey="id" loading={loading} size="small" pagination={false} scroll={{y:"calc(100vh - 280px)"}}
            onRow={(r:BatchItem)=>({onClick:()=>fetchDetail(r.id),style:{background:selectedBatch?.id===r.id?"#e6f4ff":undefined,cursor:"pointer"}})} columns={batchColumns}/>
        </>)}
      </Card>
      <div style={{flex:1,overflow:"auto"}}>
        {selectedBatch?(
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status==="COMPLETED"?"green":selectedBatch.status==="IN_PROGRESS"?"blue":"default"}>{selectedBatch.status_display}</Tag></Space>}
            extra={<Space>
              {selectedBatch.status!=="COMPLETED"&&<Popconfirm title="删除？" onConfirm={()=>deleteBatch(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm>}
              <Button icon={<ReloadOutlined/>} size="small" loading={batchLoading} onClick={()=>fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status!=="COMPLETED"&&<>
                <Button type="primary" icon={<CheckOutlined/>} size="small" loading={saving} onClick={save}>保存</Button>
                <Popconfirm title="完成批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成</Button></Popconfirm>
              </>}
            </Space>}>
            {/* Global info */}
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:10,fontSize:12,flexWrap:"wrap"}}>
              <span style={{color:"#666"}}>样本数: {rows.length} | 淘汰阈值: &lt;{YIELD_THRESHOLD} ng | 组数: {groups.length}</span>
            </div>

            {/* Manual allocation table */}
            {rows.length > 0 && (
              <div style={{marginBottom:12,padding:"6px 10px",border:"1px solid #e8e8e8",borderRadius:6,background:"#fafafa"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <Text strong style={{fontSize:12}}>📋 分组方案 <Text type="secondary" style={{fontSize:11}}>（可手动调整，留空=自动均分）</Text></Text>
                  <Space size={4}>
                    {!showAllocInputs && <Button size="small" onClick={()=>{const d=(_g:any)=>groups.map(g=>({female:g.rows.filter(r=>r.category==="FEMALE_BLOOD").length,male:g.rows.filter(r=>r.category!=="FEMALE_BLOOD").length}));setPendingAlloc(useManualAlloc&&manualAlloc.length>0?[...manualAlloc]:d(groups));setShowAllocInputs(true)}}>手动调整</Button>}
                    {showAllocInputs && <>
                      <Button size="small" onClick={()=>{setPendingAlloc(p=>[...p,{female:0,male:0}])}}>+组</Button>
                      <Button size="small" type="primary" onClick={()=>{if(pendingAlloc.length>0){setManualAlloc([...pendingAlloc]);setUseManualAlloc(true)}setShowAllocInputs(false)}}>✓ 确定</Button>
                      <Button size="small" onClick={()=>{setShowAllocInputs(false);setPendingAlloc([])}}>取消</Button>
                      <Button size="small" onClick={()=>{setManualAlloc([]);setUseManualAlloc(false);setShowAllocInputs(false);setPendingAlloc([])}}>重置</Button>
                    </>}
                  </Space>
                </div>
                {(showAllocInputs||useManualAlloc) && (
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                  <thead><tr>
                    <th style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",background:"#f5f5f5",fontSize:11}}>分组</th>
                    <th style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",background:"#fff0f6",fontSize:11}}>👩 女</th>
                    <th style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",background:"#e6f4ff",fontSize:11}}>👨 男</th>
                    <th style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",background:"#f5f5f5",fontSize:11,width:40}}></th>
                  </tr></thead>
                  <tbody>
                    {(showAllocInputs ? pendingAlloc : manualAlloc).map((a:{female:number;male:number},i:number)=>{
                      const fVal = a.female ?? 0;
                      const mVal = a.male ?? 0;
                      return (
                        <tr key={i}>
                          <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",fontSize:12,fontWeight:600}}>mix{i+1}</td>
                          <td style={{border:"1px solid #ddd",padding:1,textAlign:"center"}}>
                            <InputNumber size="small" min={0} style={{width:60}} value={fVal}
                              onChange={v=>{const na=[...pendingAlloc];na[i]={...na[i],female:v??0};setPendingAlloc(na)}}/>
                          </td>
                          <td style={{border:"1px solid #ddd",padding:1,textAlign:"center"}}>
                            <InputNumber size="small" min={0} style={{width:60}} value={mVal}
                              onChange={v=>{const na=[...pendingAlloc];na[i]={...na[i],male:v??0};setPendingAlloc(na)}}/>
                          </td>
                          <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center"}}>
                            {pendingAlloc.length>1 && <Button size="small" danger type="text" style={{fontSize:11,padding:0,minWidth:16}} onClick={()=>{const na=pendingAlloc.filter((_,j)=>j!==i);setPendingAlloc(na.length===0?[]:na)}}>×</Button>}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{fontWeight:600,background:"#f6ffed",fontSize:11}}>
                      <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center"}}>合计</td>
                      <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",color:pendingAlloc.reduce((s,a)=>s+a.female,0)!==females.length?"#ff4d4f":undefined}}>
                        {pendingAlloc.reduce((s,a)=>s+a.female,0)}/{females.length}
                      </td>
                      <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center",color:pendingAlloc.reduce((s,a)=>s+a.male,0)!==males.length?"#ff4d4f":undefined}}>
                        {pendingAlloc.reduce((s,a)=>s+a.male,0)}/{males.length}
                      </td>
                      <td style={{border:"1px solid #ddd",padding:"2px 6px",textAlign:"center"}}></td>
                    </tr>
                  </tbody>
                </table>
                )}
              </div>
            )}

            {/* Grouped tables */}            {/* Grouped tables */}
            {groups.map((g,gi)=>(
              <div key={gi} style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <Tag color="blue" style={{fontSize:14,padding:"4px 16px"}}>{g.name}</Tag>
                    <Text type="secondary">女:{g.rows.filter(r=>r.category==="FEMALE_BLOOD").length} 男:{g.rows.filter(r=>r.category!=="FEMALE_BLOOD").length} 数据量:{g.dataAmount}</Text>
                  </div>
                  <Space size={2} style={{flexWrap:"wrap"}}>
                    <Text style={{fontSize:11,color:"#999"}}>投入:</Text>
                    <Text style={{color:"#ff4d8f",fontSize:11}}>♀</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["FEMALE_BLOOD"]??200} onChange={v=>{const val=v??200;setCustomAmounts(p=>({...p,FEMALE_BLOOD:val}));setRows(prev=>prev.map(r=>r.category==="FEMALE_BLOOD"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#1677ff",fontSize:11}}>♂</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["MALE_BLOOD"]??120} onChange={v=>{const val=v??120;setCustomAmounts(p=>({...p,MALE_BLOOD:val}));setRows(prev=>prev.map(r=>r.category==="MALE_BLOOD"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>血痕</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["BLOODSTAIN"]??250} onChange={v=>{const val=v??250;setCustomAmounts(p=>({...p,BLOODSTAIN:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="BLOODSTAIN"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>毛</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["HAIR"]??300} onChange={v=>{const val=v??300;setCustomAmounts(p=>({...p,HAIR:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="HAIR"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>甲</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["NAIL"]??160} onChange={v=>{const val=v??160;setCustomAmounts(p=>({...p,NAIL:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="NAIL"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>牙刷</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["TOOTHBRUSH"]??450} onChange={v=>{const val=v??450;setCustomAmounts(p=>({...p,TOOTHBRUSH:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="TOOTHBRUSH"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>烟头</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["CIGARETTE"]??120} onChange={v=>{const val=v??120;setCustomAmounts(p=>({...p,CIGARETTE:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="CIGARETTE"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Text style={{color:"#666",fontSize:11}}>胡须</Text><InputNumber size="small" min={1} style={{width:42,fontSize:11}} value={customAmounts["BEARD"]??230} onChange={v=>{const val=v??230;setCustomAmounts(p=>({...p,BEARD:val}));setRows(prev=>prev.map(r=>r.category==="MALE_OTHER"&&r.sampleType==="BEARD"?{...r,poolingAmount:val,poolingVolume:(r.concentration??0)>0?Math.round(val/(r.concentration??1)*100)/100:0}:r))}}/>
                    <Button size="small" style={{fontSize:11,padding:"0 4px"}} onClick={()=>{setCustomAmounts({});setRows(prev=>prev.map(r=>{const da=getDefaultAmount(r.category,r.sampleType);return{...r,poolingAmount:da,poolingVolume:(r.concentration??0)>0?Math.round(da/(r.concentration??1)*100)/100:0}}))}}>重置</Button>
                    <Text style={{fontSize:11,color:"#999",marginLeft:4}}>洗脱:</Text>
                    <InputNumber size="small" min={1} step={1} style={{width:50}} value={groupElutions[gi]??globalElutionVol} onChange={v=>{if(v!==null){setGroupElutions(p=>({...p,[gi]:v}));setRows(prev=>prev.map(r=>{if(g.rows.find(gr=>gr.id===r.id)){r.elutionVolume=v;r.yield=Math.round((r.concentration??0)*v*10)/10;r.eliminated=r.yield<YIELD_THRESHOLD;}return r}))}}}/>μL
                  </Space>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"auto"}}>
                    <thead><tr>
                      <th style={{...th,width:36}}>#</th><th style={{...th,width:90}}>PT编号</th><th style={{...th,width:55}}>Index</th><th style={{...th,width:55}}>类型</th>
                      <th style={{...th,width:85}}>浓度</th><th style={{...th,width:65}}>洗脱 μL</th><th style={{...th,width:70}}>产量 ng</th>
                      <th style={{...th,width:75}}>投入 ng</th><th style={{...th,width:75}}>体积 μL</th><th style={{...th,width:90}}>QC</th><th style={{...th,width:95}}>mix</th>
                    </tr></thead>
                    <tbody>
                      {g.rows.map((r)=>{
                        const ri = rows.findIndex(rr=>rr.id===r.id);
                        const stLabel = SAMPLE_TYPE_LABELS[r.sampleType]||r.sampleType||(r.category.includes("BLOOD")?"血液":"—");
                        return (
                          <tr key={r.id} style={{background:r.qc==="FAIL"?"#fff1f0":r.eliminated?"#fffbe6":"#e8f5e9"}}>
                            <td style={td}>{ri+1}</td>
                            <td style={td}><Text code style={{fontSize:11}}>{r.ptId}</Text></td>
                            <td style={td}><Input size="small" style={{width:60}} value={savedIndexes[r.id]||""} onChange={e=>setSavedIndexes(p=>({...p,[r.id]:e.target.value}))} placeholder="ix"/></td>
                            <td style={td}>{stLabel}</td>
                            <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.concentration} onChange={v=>updateCell(ri,"concentration",v)} style={{width:70}} placeholder="0"/></td>
                            <td style={td}><InputNumber size="small" min={0} step={1} value={r.elutionVolume} onChange={v=>updateCell(ri,"elutionVolume",v)} style={{width:60}}/></td>
                            <td style={{...td,fontWeight:r.yield>0?600:400,color:r.eliminated?"#faad14":"#333"}}>{r.yield>0?r.yield.toFixed(1):"-"}{r.eliminated&&<Tag color="gold" style={{marginLeft:4,fontSize:10}}>淘汰</Tag>}</td>
                            <td style={td}><InputNumber size="small" min={0} step={1} value={r.poolingAmount} onChange={v=>updateCell(ri,"poolingAmount",v)} style={{width:70}}/></td>
                            <td style={{...td,fontFamily:"monospace"}}>{r.poolingVolume>0?r.poolingVolume.toFixed(2):"-"}</td>
                            <td style={td}><Select size="small" value={r.qc} onChange={v=>updateCell(ri,"qc",v)} style={{width:90}} options={[{value:"PASS",label:"PASS"},{value:"FAIL",label:"FAIL"}]}/></td>
                            <td style={td}>
                              <Select size="small" value={r.mixOverride ?? (gi + 1)}
                                style={{width:85}}
                                onChange={v => {
                                  const target = v ?? (gi + 1);
                                  setRows(prev => prev.map(rr =>
                                    rr.id === r.id ? { ...rr, mixOverride: target !== (gi + 1) ? target : undefined } : rr
                                  ));
                                }}
                                options={groups.map((_, i) => ({ value: i + 1, label: `mix${i + 1}` }))}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {/* Group summary */}
                      <tr style={{background:"#e6f7ff",fontWeight:700}}>
                        <td style={{...td,textAlign:"left",paddingLeft:12}} colSpan={6}>📊 {g.name} 汇总</td>
                        <td style={td}>投入: {g.totalMass} ng</td>
                        <td style={td}>总体积: {g.totalVol.toFixed(2)} μL</td>
                        <td style={td}>理论浓度: {g.theoryConc.toFixed(2)} ng/μL</td>
                        <td style={td}>总数据量: {g.dataAmount}M ({(()=>{const f=g.rows.filter(r=>r.category==="FEMALE_BLOOD").length;const m=g.rows.filter(r=>r.category!=="FEMALE_BLOOD").length;return`${f}×2M+${m}×1M`})()})</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Card>
        ):(
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建Pooling批次</Button></div>
        )}
      </div>
      <Modal title="新建文库定量及Pooling批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={700} okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData&&(<div>
          <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}><Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text></div>
          <Space style={{marginBottom:8}}><Tag color="magenta">👩 {pendingData.female_count}</Tag><Tag color="blue">👨 {pendingData.male_blood_count+pendingData.male_other_count}</Tag></Space>
          <div style={{maxHeight:350,overflow:"auto"}}>
            {(["FEMALE_BLOOD","MALE_BLOOD","MALE_OTHER"] as const).map(cat=>{
              const entries = pendingData.entries.filter((e:any)=>e.category===cat);
              if(!entries.length)return null;
              const labels:Record<string,string>={FEMALE_BLOOD:"👩 女性",MALE_BLOOD:"🩸 男性血液",MALE_OTHER:"🧬 男性其他"};
              return (<div key={cat}><Text strong style={{fontSize:13}}>{labels[cat]} ({entries.length})</Text>
                {entries.map((e:any)=>{const allIn=e.case_sample_ids.every((id:string)=>selectedKeys.has(id)),someIn=e.case_sample_ids.some((id:string)=>selectedKeys.has(id));
                  return (<div key={e.case_sample_ids.join(",")} style={{padding:"4px 8px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:8}}>
                    <Checkbox checked={allIn} indeterminate={!allIn&&someIn} onChange={()=>{setSelectedKeys(prev=>{const n=new Set(prev);if(allIn)e.case_sample_ids.forEach((id:string)=>n.delete(id));else e.case_sample_ids.forEach((id:string)=>n.add(id));return n})}}/>
                    <Text code style={{fontSize:11,width:150}}>{e.case_number}</Text>{e.test_sample_id&&<Tag color="blue" style={{fontSize:11}}>{e.test_sample_id}</Tag>}<Text strong>{e.patient_name}</Text></div>)})}</div>)
            })}
          </div>
        </div>)}
      </Modal>
    </div>
  );
}
