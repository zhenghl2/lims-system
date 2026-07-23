// NipptPooling.tsx — Library QC & Pooling (NIPT-style + grouping)
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, InputNumber,
  Space, Popconfirm, Select, Checkbox } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
const { Text, Title } = Typography;

const SAMPLE_TYPE_LABELS:Record<string,string>={BLOOD:"血液",DBS:"血痕",HAIR:"毛发",NAIL:"指甲",SWAB:"口拭子",TOOTHBRUSH:"牙刷"};
const DEFAULT_POOLING_AMOUNT=143;
const YIELD_THRESHOLD=60;
const DEFAULT_ELUTION=30;
const MAX_PER_GROUP=34;

type PoolRow = { id:string; ptId:string; index:string; sampleType:string; category:string;
  concentration:number|null; elutionVolume:number; yield:number;
  poolingAmount:number; poolingVolume:number; eliminated:boolean; qc:string };
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
  const [savedIndexes, setSavedIndexes] = useState<Record<string,string>>({});

  // ── Grouping ──
  const groups = useMemo(():PoolGroup[]=>{
    const active = rows.filter(r=>!r.eliminated);
    const total = active.length;
    const numGroups = total > MAX_PER_GROUP ? Math.ceil(total / MAX_PER_GROUP) : 1;
    // Distribute female/male evenly
    const females = active.filter(r=>r.category==="FEMALE_BLOOD");
    const males = active.filter(r=>r.category!=="FEMALE_BLOOD");
    const result:PoolGroup[] = [];
    let fi=0, mi=0;
    for (let g=0; g<numGroups; g++) {
      const fRemain = females.length - fi;
      const mRemain = males.length - mi;
      const gRemain = numGroups - g;
      const fPerGroup = Math.ceil(fRemain / gRemain);
      const mPerGroup = Math.ceil(mRemain / gRemain);
      const fSlice = females.slice(fi, fi+fPerGroup);
      const mSlice = males.slice(mi, mi+mPerGroup);
      fi += fPerGroup; mi += mPerGroup;
      const groupRows = [...fSlice, ...mSlice];
      const dataAmt = fSlice.length*2 + mSlice.length*1;
      const totalMass = groupRows.reduce((s,r)=>s+r.poolingAmount,0);
      const totalVol = groupRows.reduce((s,r)=>s+r.poolingVolume,0);
      result.push({
        name: `mix${g+1}`,
        rows: groupRows,
        totalMass: Math.round(totalMass*100)/100,
        totalVol: Math.round(totalVol*100)/100,
        theoryConc: totalVol>0?Math.round(totalMass/totalVol*100)/100:0,
        dataAmount: dataAmt,
      });
    }
    return result;
  }, [rows]);

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
        const gIdx = 0; const pa = sr.poolingAmount??(pd.groupBases||{})[gIdx]??poolingBase??DEFAULT_POOLING_AMOUNT;
        const pv = (conc??0)>0?pa/conc:0;
        const st = s.experiment_sample_type||(s.category==="FEMALE_BLOOD"||s.category==="MALE_BLOOD"?"BLOOD":"");
        return {
          id:s.id, ptId:s.test_sample_id||"?", index:savedIdx[s.id]||"", sampleType:st, category:s.category,
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
        if(r.yield<YIELD_THRESHOLD&&!r.eliminated) r.eliminated=true;
        else if(r.yield>=YIELD_THRESHOLD&&r.eliminated) r.eliminated=false;
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
        poolingBase,globalElutionVol,groupBases,groupElutions,
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
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:12,fontSize:12,flexWrap:"wrap"}}>
              <span style={{color:"#666"}}>样本数: {rows.length} | 淘汰阈值: &lt;{YIELD_THRESHOLD} ng | 组数: {groups.length}</span>
            </div>

            {/* Grouped tables */}
            {groups.map((g,gi)=>(
              <div key={gi} style={{marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <Tag color="blue" style={{fontSize:14,padding:"4px 16px"}}>{g.name}</Tag>
                    <Text type="secondary">女:{g.rows.filter(r=>r.category==="FEMALE_BLOOD").length} 男:{g.rows.filter(r=>r.category!=="FEMALE_BLOOD").length} 数据量:{g.dataAmount}</Text>
                  </div>
                  <Space size={4}>
                    <span style={{fontSize:11}}>投入量:</span>
                    <InputNumber size="small" min={1} step={1} value={groupBases[gi]??poolingBase} onChange={v=>{if(v!==null){setGroupBases(p=>({...p,[gi]:v}));setRows(prev=>prev.map((r,i)=>{const rr=r;if(g.rows.find(gr=>gr.id===r.id)){rr.poolingAmount=v;rr.poolingVolume=(r.concentration??0)>0?Math.round(v/(r.concentration??1)*100)/100:0;}return i===rows.findIndex(rr=>rr.id===r.id)?rr:r}))}}}/>ng
                    <span style={{fontSize:11}}>洗脱:</span>
                    <InputNumber size="small" min={1} step={1} value={groupElutions[gi]??globalElutionVol} onChange={v=>{if(v!==null){setGroupElutions(p=>({...p,[gi]:v}));setRows(prev=>prev.map((r,i)=>{const rr=r;if(g.rows.find(gr=>gr.id===r.id)){rr.elutionVolume=v;rr.yield=Math.round((r.concentration??0)*v*10)/10;rr.eliminated=rr.yield<YIELD_THRESHOLD;}return i===rows.findIndex(rr=>rr.id===r.id)?rr:r}))}}}/>μL
                  </Space>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                    <thead><tr>
                      <th style={th}>#</th><th style={th}>PT编号</th><th style={th}>Index</th><th style={th}>类型</th>
                      <th style={th}>浓度 ng/μL</th><th style={th}>洗脱 μL</th><th style={th}>产量 ng</th>
                      <th style={th}>Pooling 投入 ng</th><th style={th}>Pooling 体积 μL</th><th style={th}>QC</th>
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
                            <td style={td}><Select size="small" value={r.qc} onChange={v=>updateCell(ri,"qc",v)} style={{width:80}} options={[{value:"PASS",label:"✅ PASS"},{value:"FAIL",label:"❌ FAIL"}]}/></td>
                          </tr>
                        );
                      })}
                      {/* Group summary */}
                      <tr style={{background:"#e6f7ff",fontWeight:700}}>
                        <td style={{...td,textAlign:"left",paddingLeft:12}} colSpan={7}>📊 {g.name} 汇总 (Pooling总体积/理论浓度)</td>
                        <td style={td}>总投入: {g.totalMass.toFixed(2)}</td>
                        <td style={td}>总体积: {g.totalVol.toFixed(2)}</td>
                        <td style={td}>理论浓度: {g.theoryConc.toFixed(2)} ng/μL</td>
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
