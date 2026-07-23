// NipptHybSeq.tsx — Hybridization & Sequencing (NIPT-style + Mix dilution table)
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, InputNumber,
  Space, Popconfirm, Select, Checkbox, Form, DatePicker, TimePicker } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";
const { Text, Title } = Typography;

const EQUIPMENT_OPTIONS = [
  {value:"ILLUMINA_500",label:"illumina500"},{value:"ILLUMINA_550DX",label:"illumina550dx"},
  {value:"SALUS_PRO",label:"Salus Pro"},{value:"SIKUN_2000",label:"Sikun2000"},{value:"MGI_G99",label:"MGI G99"},
];
const CHIP_OPTIONS:Record<string,{value:string;label:string}[]> = {
  ILLUMINA_500:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"},{value:"S4",label:"S4 Flow Cell"}],
  ILLUMINA_550DX:[{value:"S1",label:"S1 Flow Cell"},{value:"S2",label:"S2 Flow Cell"}],
  SALUS_PRO:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
  SIKUN_2000:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
  MGI_G99:[{value:"FCL",label:"FCL Chip"},{value:"FCS",label:"FCS Chip"}],
};
const READ_TYPE_OPTIONS = [{value:"SE75",label:"SE75"},{value:"SE100",label:"SE100"},{value:"PE150",label:"PE150"}];
const STEPS = [
  {key:"clean_equip",label:"设备准备"},{key:"reagent_prep",label:"试剂准备"},
  {key:"sample_prep",label:"样本准备"},{key:"on_machine",label:"上机测序"},{key:"cleanup",label:"清洁台面"},
];

interface MixItem { id:string; pooling_batch_id:string; pooling_batch_number:string; mix_name:string; female:number; male:number; data_amount:number; }
interface MixRow { mix_name:string; library_conc:number|null; input_amount:number; input_vol:number; expected_conc:number; water_added:number; }
interface SampleItem { id:string; patient_name:string; category:string; test_sample_id:string|null; }
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; }
interface BatchDetail extends BatchItem { female_samples:SampleItem[]; male_blood_samples:SampleItem[]; male_other_samples:SampleItem[]; hyb_seq_data:any; }

export default function NipptHybSeq() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail|null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingMixes, setPendingMixes] = useState<MixItem[]>([]);
  const [selectedMixIds, setSelectedMixIds] = useState<Set<string>>(new Set());
  const [chipNumber, setChipNumber] = useState("");
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Sequencing state
  const [platform, setPlatform] = useState("");
  const [stepConfirmations, setStepConfirmations] = useState<Record<string,boolean>>({});
  const [mixRows, setMixRows] = useState<MixRow[]>([]);
  const [finalConc, setFinalConc] = useState(0.783);

  const fetchBatches = useCallback(async()=>{setLoading(true);try{const r=await(casesApi as any).listHybSeqBatches();setBatches(r.data?.results||[])}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{fetchBatches()},[fetchBatches]);

  const fetchDetail = async(id:string)=>{
    setBatchLoading(true);
    try{
      const r=await(casesApi as any).getHybSeqBatch(id);
      const d=r.data; setSelectedBatch(d);
      const sd=d.hyb_seq_data||{};
      setPlatform(sd.platform||""); setStepConfirmations(sd.step_confirmations||{});
      setMixRows(sd.mix_rows||[]); setFinalConc(sd.final_conc??0.783);
      form.setFieldsValue({
        seq_date:sd.seq_date?dayjs(sd.seq_date):dayjs(), seq_time:sd.seq_time?dayjs(sd.seq_time,"HH:mm"):dayjs(),
        equipment:sd.equipment||"", chip:sd.chip||"", read_type:sd.read_type||"",
        chip_number:sd.chip_number||"",
      });
    }catch{message.error("加载失败")}finally{setBatchLoading(false)}
  };

  const openNewBatch = async()=>{
    try{
      const r=await(casesApi as any).pendingHybSeqMixes();
      setPendingMixes(r.data?.mixes||[]); setSelectedMixIds(new Set()); setChipNumber("");
      const now=new Date();
      setBatchNumberPreview(`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-SEQ-???`);
      setModalOpen(true);
    }catch{message.error("加载失败")}
  };

  const createBatch = async()=>{
    if(selectedMixIds.size===0){message.warning("请选择mix");return}
    try{
      const mixIds = Array.from(selectedMixIds);
      const r=await(casesApi as any).createHybSeqBatch({mix_ids:mixIds, chip_number:chipNumber});
      message.success(`批次 ${r.data.batch_number} 已创建`); setModalOpen(false); fetchBatches();
    }catch(e:any){message.error(e?.response?.data?.detail||"创建失败")}
  };

  // Mix table computations
  const mixSums = useMemo(()=>{
    const totalInput = mixRows.reduce((s,r)=>s+(r.input_amount??0),0);
    const totalVol = mixRows.reduce((s,r)=>s+(r.input_vol??0),0);
    const theoryConc = totalVol>0?totalInput/totalVol:0;
    const water = (theoryConc/finalConc-1)*totalVol;
    return {totalInput, totalVol, theoryConc:Math.round(theoryConc*100)/100, water:Math.round(water*100)/100};
  },[mixRows, finalConc]);

  const updateMixCell = (i:number, field:string, val:any)=>{
    setMixRows(prev=>{
      const next=[...prev]; const r={...next[i]};
      (r as any)[field]=val;
      if(field==="library_conc") r.input_vol=(r.input_amount??0)/(val||1);
      if(field==="input_amount") r.input_vol=val/(r.library_conc||1);
      next[i]=r; return next;
    });
  };

  const save = async()=>{
    if(!selectedBatch)return; setSaving(true);
    try{
      const sd = {
        platform, step_confirmations:stepConfirmations,
        ...form.getFieldsValue(), mix_rows:mixRows, final_conc:finalConc,
      };
      await(casesApi as any).saveHybSeq(selectedBatch.id,{hyb_seq_data:sd});
      message.success("保存成功"); fetchDetail(selectedBatch.id);
    }catch{message.error("保存失败")}finally{setSaving(false)}
  };

  const completeBatch = async()=>{if(!selectedBatch)return;try{await(casesApi as any).completeHybSeq(selectedBatch.id);message.success("已完成");setSelectedBatch(null);fetchBatches()}catch{message.error("失败")}};
  const deleteBatch = async(id:string)=>{try{await(casesApi as any).deleteHybSeqBatch(id);message.success("已删除");setSelectedBatch(null);fetchBatches()}catch(e:any){message.error(e?.response?.data?.detail||"删除失败")}};

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
        title={sidebarCollapsed?undefined:"杂交及测序"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}/>}>
        {!sidebarCollapsed&&(<>
          <Button type="primary" icon={<PlusOutlined/>} block onClick={openNewBatch} style={{marginBottom:8}}>新建上机批次</Button>
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
            {/* Mix dilution table — ON TOP */}
            {mixRows.length > 0 && (
              <Card size="small" title="🧪 Mix 稀释表" style={{marginBottom:12}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"fixed"}}>
                    <thead><tr>
                      <th style={{...th,width:80}}>mix编号</th>
                      <th style={{...th,width:90}}>文库浓度</th>
                      <th style={{...th,width:65}}>投入量</th>
                      <th style={{...th,width:75}}>投入体积</th>
                      <th style={{...th,width:85}}>理论浓度</th>
                      <th style={{...th,width:65}}>预期浓度</th>
                      <th style={{...th,width:75}}>加水量</th>
                    </tr></thead>
                    <tbody>
                      {mixRows.map((r,i)=>(
                        <tr key={i} style={{background:"#e8f5e9"}}>
                          <td style={td}><Tag color="blue">{r.mix_name}</Tag></td>
                          <td style={td}><InputNumber size="small" min={0} step={0.001} value={r.library_conc} onChange={v=>updateMixCell(i,"library_conc",v)} style={{width:80}} placeholder="0"/></td>
                          <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.input_amount} onChange={v=>updateMixCell(i,"input_amount",v)} style={{width:60}}/></td>
                          <td style={{...td,fontFamily:"monospace"}}>{r.input_vol>0?r.input_vol.toFixed(2):"-"}</td>
                          {i===0?<td style={{...td,background:"#e6f7ff",fontWeight:700}} rowSpan={mixRows.length}>{mixSums.theoryConc.toFixed(2)}</td>:null}
                          <td style={td}><InputNumber size="small" min={0} step={0.1} value={r.expected_conc} onChange={v=>updateMixCell(i,"expected_conc",v)} style={{width:60}}/></td>
                          <td style={{...td,fontFamily:"monospace"}}>{mixSums.water>0?mixSums.water.toFixed(2):"-"}</td>
                        </tr>
                      ))}
                      <tr style={{background:"#fffbe6",fontWeight:600}}>
                        <td style={td} colSpan={5}>最终检测浓度: <InputNumber size="small" min={0} step={0.001} value={finalConc} onChange={v=>v!==null&&setFinalConc(v)} style={{width:80}}/></td>
                        <td style={td} colSpan={2}>总投入: {mixSums.totalInput.toFixed(2)} ng | 总体积: {mixSums.totalVol.toFixed(2)} μL</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Platform + Basic Info */}
            <Card size="small" style={{marginBottom:12}}>
              <Space direction="vertical" style={{width:"100%"}}>
                <Space wrap>
                  <Text strong>测序平台:</Text>
                  <Select style={{width:180}} value={platform||undefined} onChange={setPlatform} options={EQUIPMENT_OPTIONS} placeholder="选择平台"/>
                  {platform&&<>
                    <Text>芯片:</Text>
                    <Select style={{width:150}} options={CHIP_OPTIONS[platform]||[]} value={form.getFieldValue("chip")} onChange={v=>form.setFieldsValue({chip:v})} placeholder="选择"/>
                  </>}
                  <Text>Read Type:</Text>
                  <Select style={{width:100}} options={READ_TYPE_OPTIONS} value={form.getFieldValue("read_type")} onChange={v=>form.setFieldsValue({read_type:v})} placeholder="选择"/>
                </Space>
                <Form form={form} layout="inline" style={{flexWrap:"wrap",gap:8}}>
                  <Form.Item name="seq_date" label="日期"><DatePicker size="small" style={{width:120}}/></Form.Item>
                  <Form.Item name="seq_time" label="时间"><TimePicker size="small" format="HH:mm" style={{width:90}}/></Form.Item>
                  <Form.Item name="equipment" label="设备"><Select size="small" style={{width:160}} options={EQUIPMENT_OPTIONS} placeholder="选择"/></Form.Item>
                  <Form.Item name="chip_number" label="Chip号"><Input size="small" style={{width:120}} placeholder="chip编号"/></Form.Item>
                </Form>
              </Space>
            </Card>

            {/* Step confirmations */}
            <Card size="small" style={{marginBottom:12}}>
              <Text strong style={{marginBottom:8,display:"block"}}>📋 步骤确认</Text>
              <Space wrap>{STEPS.map(s=><Checkbox key={s.key} checked={!!stepConfirmations[s.key]} onChange={e=>setStepConfirmations(p=>({...p,[s.key]:e.target.checked}))}>{s.label}</Checkbox>)}</Space>
            </Card>

            {/* Index table — NIPT-style */}
            {selectedBatch.female_samples&&selectedBatch.female_samples.length>0&&(
              <Card size="small" title={`📊 Index列表 — ${selectedBatch.sample_count} 样本`} style={{marginBottom:12}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,tableLayout:"fixed"}}>
                    <thead><tr>
                      <th style={{...th,width:36}}>#</th>
                      <th style={{...th,width:90}}>PT编号</th>
                      <th style={{...th,width:55}}>Index</th>
                      <th style={{...th,width:80}}>I7</th>
                      <th style={{...th,width:80}}>I5</th>
                      <th style={{...th,width:140}}>批次号</th>
                      <th style={{...th,width:100}}>上传ID</th>
                    </tr></thead>
                    <tbody>
                      {[...(selectedBatch.female_samples||[]),...(selectedBatch.male_blood_samples||[]),...(selectedBatch.male_other_samples||[])].map((s:any,i:number)=>{
                        const idx = s.index||String(i+1);
                        const idxNum = parseInt(idx)||0;
                        const i7 = `TAG-${String(idxNum).padStart(3,"0")}-I7`;
                        const i5 = `TAG-${String(idxNum).padStart(3,"0")}-I5`;
                        return (
                          <tr key={i} style={{background:i%2===0?"#e8f5e9":"#fafafa"}}>
                            <td style={td}>{i+1}</td>
                            <td style={td}><Text code style={{fontSize:11}}>{s.test_sample_id||"-"}</Text></td>
                            <td style={td}>{idx}</td>
                            <td style={td}>{i7}</td>
                            <td style={td}>{i5}</td>
                            <td style={td}>{selectedBatch.batch_number}</td>
                            <td style={td}><Input size="small" style={{width:80}} placeholder="上传ID"/></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </Card>
        ):(
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建上机批次</Button></div>
        )}
      </div>
      <Modal title="新建杂交测序批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={650} okText={`创建批次 (${selectedMixIds.size}个mix)`}>
        <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}>
          <Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text>
        </div>
        <div style={{marginBottom:8}}>
          <Text>Chip号：</Text>
          <Input size="small" style={{width:150}} value={chipNumber} onChange={e=>{setChipNumber(e.target.value);const n=new Date();setBatchNumberPreview(`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}-SEQ-${e.target.value||"???"}`)}} placeholder="输入chip号"/>
        </div>
        <div style={{maxHeight:350,overflow:"auto"}}>
          {pendingMixes.map(m=>{
            const checked = selectedMixIds.has(m.id);
            return (
              <div key={m.id} style={{padding:"4px 8px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:8}}>
                <Checkbox checked={checked} onChange={()=>{setSelectedMixIds(p=>{const n=new Set(p);checked?n.delete(m.id):n.add(m.id);return n})}}/>
                <Tag color="blue">{m.mix_name}</Tag>
                <Text type="secondary">女:{m.female} 男:{m.male} 数据量:{m.data_amount}</Text>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
