// NipptLibrary.tsx — Library Prep module
import { useState, useEffect, useCallback } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, Select, InputNumber,
  Space, Popconfirm, Radio, Checkbox, Divider, Upload, Image, DatePicker, TimePicker, Form, Popover } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined, CameraOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text, Title } = Typography;
const { TextArea } = Input;

const ROWS = ["A","B","C","D","E","F","G","H"];
const COLS = [1,2,3,4,5,6,7,8,9,10,11,12];

const STEPS = [
  { key:"reagent_warm",label:"试剂平衡至室温" },
  { key:"equipment_check",label:"检查设备运行状态" },
  { key:"supplies_ready",label:"准备耗材" },
  { key:"end_repair",label:"末端修复/加A" },
  { key:"adapter_ligation",label:"接头连接" },
  { key:"pcr_amplification",label:"PCR扩增" },
];

const EQUIPMENT_OPTIONS = [
  {value:"PCR_ABI_9700",label:"PCR仪 - ABI 9700"},
  {value:"PCR_BioRad_T100",label:"PCR仪 - Bio-Rad T100"},
];

const FEMALE_KITS = [{value:"F-KIT-A",label:"NIPPT Female Library Kit A"},{value:"F-KIT-B",label:"NIPPT Female Library Kit B"}];
const MALE_KITS = [{value:"M-KIT-A",label:"NIPPT Male Library Kit A"},{value:"M-KIT-B",label:"NIPPT Male Library Kit B"}];
const INDEX_KITS = [{value:"IDX-01",label:"UDI Adapters Set1"},{value:"IDX-02",label:"UDI Adapters Set2"}];
const QUANT_KITS = [{value:"Q-01",label:"Quant Kit A"},{value:"Q-02",label:"Quant Kit B"}];
const BEAD_KITS = [{value:"B-01",label:"DNA Clean Beads A"},{value:"B-02",label:"DNA Clean Beads B"}];

interface ExtractionSample {
  id:string; patient_name:string; role:string; category:string;
  case_sample_ids:string[]; test_sample_id:string|null;
  dna_concentration:number|null; is_qc:boolean;
  qc_status:string; qc_note:string; experiment_sample_type?:string;
  sample_types?:string[];
}
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; created_at:string; }
interface BatchDetail extends BatchItem { female_samples:ExtractionSample[]; male_blood_samples:ExtractionSample[]; male_other_samples:ExtractionSample[]; library_data:any; }

type CoordKey = string; // "A1", "A2", etc.

export default function NipptLibrary() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail|null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchNumberPreview, setBatchNumberPreview] = useState("");

  // Library data
  const [region, setRegion] = useState("XIAMEN");
  const [femaleStartCoord, setFemaleStartCoord] = useState("");
  const [maleStartCoord, setMaleStartCoord] = useState("");
  const [femaleLibKit, setFemaleLibKit] = useState("");
  const [maleLibKit, setMaleLibKit] = useState("");
  const [indexKit, setIndexKit] = useState("");
  const [quantKit, setQuantKit] = useState("");
  const [beadKit, setBeadKit] = useState("");
  const [libForm] = Form.useForm();
  const [stepConfirmations, setStepConfirmations] = useState<Record<string,boolean>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [sampleResults, setSampleResults] = useState<Record<string,{status:string;note:string}>>({});

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try { const r = await (casesApi as any).listLibraryBatches(); setBatches(r.data?.results||[]); } catch {}
    finally { setLoading(false); }
  }, []);
  useEffect(()=>{fetchBatches();},[fetchBatches]);

  const fetchDetail = async (id:string) => {
    setBatchLoading(true);
    try {
      const r = await (casesApi as any).getLibraryBatch(id);
      const d = r.data; setSelectedBatch(d);
      const ld = d.library_data || {};
      setRegion(ld.region||"XIAMEN"); setFemaleStartCoord(ld.female_start_coord||"");
      setMaleStartCoord(ld.male_start_coord||""); setFemaleLibKit(ld.female_lib_kit||"");
      setMaleLibKit(ld.male_lib_kit||""); setIndexKit(ld.index_kit||""); setQuantKit(ld.quant_kit||"");
      setBeadKit(ld.bead_kit||""); setStepConfirmations(ld.step_confirmations||{});
      setPhotos(ld.photos||[]); setSampleResults(ld.sample_results||{});
      libForm.setFieldsValue({
        lib_date: ld.lib_date?dayjs(ld.lib_date):dayjs(), lib_time: ld.lib_time?dayjs(ld.lib_time,"HH:mm"):dayjs(),
        equipment: ld.equipment||"", pcr_cycles: ld.pcr_cycles??12, temperature: ld.temperature??undefined, humidity: ld.humidity??undefined,
      });
    } catch { message.error("加载失败"); }
    finally { setBatchLoading(false); }
  };

  const openNewBatch = async () => {
    try {
      const r = await (casesApi as any).pendingLibrary();
      const d = r.data; setPendingData(d);
      const all = new Set<string>(); d.entries.forEach((e:any)=>e.case_sample_ids.forEach((id:string)=>all.add(id)));
      setSelectedKeys(all);
      const now = new Date(); const pfx = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}`;
      try { const br = await (casesApi as any).listLibraryBatches({search:pfx}); const c = (br.data?.results||[]).filter((b:any)=>b.batch_number.startsWith(pfx)).length; setBatchNumberPreview(`${pfx}-${String(c+1).padStart(3,"0")}`); }
      catch { setBatchNumberPreview(`${pfx}-001`); }
      setModalOpen(true);
    } catch { message.error("加载失败"); }
  };

  const createBatch = async () => {
    if (selectedKeys.size===0) { message.warning("请选择样本"); return; }
    try {
      const r = await (casesApi as any).createLibraryBatch({case_sample_ids:Array.from(selectedKeys)});
      message.success(`批次 ${r.data.batch_number} 已创建`); setModalOpen(false); fetchBatches();
    } catch (e:any) { message.error(e?.response?.data?.detail||"创建失败"); }
  };

  const saveProcessing = async () => {
    if (!selectedBatch) return;
    try {
      const all = [...selectedBatch.female_samples,...selectedBatch.male_blood_samples,...selectedBatch.male_other_samples]
        .map(s=>({id:s.id,qc_status:s.qc_status,qc_note:s.qc_note}));
      const ld = {region,female_start_coord:femaleStartCoord,male_start_coord:maleStartCoord,
        female_lib_kit:femaleLibKit,male_lib_kit:maleLibKit,index_kit:indexKit,quant_kit:quantKit,bead_kit:beadKit,
        ...libForm.getFieldsValue(),step_confirmations:stepConfirmations,sample_results:sampleResults,photos};
      await (casesApi as any).saveLibrary(selectedBatch.id,{samples:all,library_data:ld});
      message.success("保存成功"); fetchDetail(selectedBatch.id);
    } catch { message.error("保存失败"); }
  };

  const completeBatch = async () => {
    if (!selectedBatch) return;
    try { await (casesApi as any).completeLibrary(selectedBatch.id); message.success("已完成"); setSelectedBatch(null); fetchBatches(); }
    catch { message.error("失败"); }
  };

  const deleteBatch = async (id:string) => {
    try { await (casesApi as any).deleteLibraryBatch(id); message.success("已删除"); setSelectedBatch(null); fetchBatches(); }
    catch (e:any) { message.error(e?.response?.data?.detail||"删除失败"); }
  };

  const handlePhoto = (file:File) => { const r = new FileReader(); r.onload=e=>setPhotos(p=>[...p,e.target?.result as string]); r.readAsDataURL(file); return false; };

  const getResult = (sampleId:string) => sampleResults[sampleId]||{status:"pass",note:""};
  const setResult = (sampleId:string, status:string, note:string) => setSampleResults(p=>({...p,[sampleId]:{status,note}}));

  // ── Coordinate helpers ──

  // ── Build plate (Xiamen: single plate with 2 start coords) ──
  const buildXiamenPlate = (femaleSamples:ExtractionSample[], maleSamples:ExtractionSample[]) => {
    const allSamples = [...femaleSamples, ...maleSamples];
    const map:Record<string,ExtractionSample> = {};
    if (!femaleStartCoord && !maleStartCoord) {
      const total = allSamples.length;
      const numCols = Math.min(Math.ceil(total / 8), 12);
      let startCol = Math.floor((12 - numCols) / 2);
      if (startCol % 2 === 1) startCol -= 1;
      let idx = 0;
      for (let c = startCol; c < startCol + numCols; c++) {
        for (let r = 0; r < 8; r++) {
          if (idx < total) { map[`${ROWS[r]}${c+1}`] = allSamples[idx]; idx++; }
        }
      }
      return map;
    }
    // Top-to-bottom fill (col-major): A1,B1,C1,...H1, A2,B2,...
    const coordToIndexTB = (coord: string) => { const r=coord[0],c=parseInt(coord.slice(1)); return (c-1)*8 + ROWS.indexOf(r); };
    const indexToCoordTB = (i: number) => { const c=Math.floor(i/8), r=i%8; return `${ROWS[r]}${c+1}`; };
    const fStartTB = coordToIndexTB(femaleStartCoord as CoordKey);
    const mStartTB = maleStartCoord ? coordToIndexTB(maleStartCoord as CoordKey) : 0;
    let fi=0, mi=0;
    for (let i=0; i<96; i++) {
      if (i>=fStartTB && fi<femaleSamples.length && (i<mStartTB||mi>=maleSamples.length||!maleStartCoord)) { map[indexToCoordTB(i)]=femaleSamples[fi]; fi++; }
      else if (maleStartCoord && i>=mStartTB && mi<maleSamples.length) { map[indexToCoordTB(i)]=maleSamples[mi]; mi++; }
      else if (!maleStartCoord && fi>=femaleSamples.length && mi<maleSamples.length) { map[indexToCoordTB(i)]=maleSamples[mi]; mi++; }
    }
    return map;
  };


  const indexToCoord = (i:number) => `${ROWS[Math.floor(i/12)]}${(i%12)+1}`;

  // ── Build full plate (Hong Kong) ──
  const buildFullPlateMap = (samples:ExtractionSample[]) => {
    const map:Record<string,ExtractionSample> = {};
    samples.forEach((s,i)=>{ if(i<96) map[indexToCoord(i)]=s; });
    return map;
  };

  const WellCell = ({sample}:{sample:ExtractionSample|null}) => {
    if (!sample) return <td style={{background:"#f0f0f0",width:70,height:38,textAlign:"center",fontSize:10,color:"#bbb"}}>—</td>;
    const r = getResult(sample.id);
    const st = r.status||"pass";
    const bg = st==="fail"?"#fff1f0":"#f6ffed", color=st==="fail"?"#cf1322":"#52c41a";
    const [ls,setLs] = useState(st);
    const [ln,setLn] = useState(r.note||"");
    const [open,setOpen] = useState(false);
    const label = sample.test_sample_id||"?";
    const pop = (
      <div style={{width:200}}>
        <Radio.Group value={ls} onChange={e=>setLs(e.target.value)} style={{marginBottom:8}}>
          <Radio value="pass" style={{color:"#52c41a"}}>Pass</Radio>
          <Radio value="fail" style={{color:"#cf1322"}}>Fail</Radio>
        </Radio.Group>
        {ls==="fail" && <TextArea placeholder="备注" value={ln} onChange={e=>setLn(e.target.value)} autoSize={{minRows:1,maxRows:3}} style={{fontSize:11,marginBottom:8}} />}
        <div style={{textAlign:"right"}}><Button size="small" onClick={()=>{setResult(sample.id,ls,ln);setOpen(false);}}>确认</Button></div>
      </div>
    );
    return (
      <Popover content={pop} trigger="click" open={open} onOpenChange={v=>{setOpen(v);if(v){setLs(st);setLn(r.note||"");}}} placement="bottomLeft" destroyTooltipOnHide>
        <td style={{background:bg,cursor:"pointer",width:70,height:38,textAlign:"center",fontSize:10,color,padding:1}}>{label}</td>
      </Popover>
    );
  };

  const renderPlate = (map:Record<string,ExtractionSample>) => (
    <table style={{borderCollapse:"collapse",margin:"0 auto"}}>
      <thead><tr><th style={{width:24}}></th>{COLS.map(c=><th key={c} style={{width:70,fontSize:11,fontWeight:500,padding:2}}>{c}</th>)}</tr></thead>
      <tbody>{ROWS.map(row=>(
        <tr key={row}><td style={{textAlign:"center",fontWeight:600,fontSize:11,padding:2}}>{row}</td>
          {COLS.map(col=><WellCell key={`${row}${col}`} sample={map[`${row}${col}`]||null} />)}
        </tr>
      ))}</tbody>
    </table>
  );

  const batchColumns = [
    {title:"批次号",dataIndex:"batch_number",width:140,render:(v:string)=><Text code style={{fontSize:12}}>{v}</Text>},
    {title:"状态",dataIndex:"status",width:60,render:(v:string)=>{const c:Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"},l:Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};return <Tag color={c[v]||"default"}>{l[v]||v}</Tag>;}},
    {title:"样本",width:100,render:(_:any,r:BatchItem)=><Text style={{fontSize:11}}>👩{r.female_count} 👨{r.male_blood_count+r.male_other_count}</Text>},
  ];

  return (
    <div style={{display:"flex",height:"calc(100vh - 140px)",gap:12}}>
      <Card size="small" style={{width:sidebarCollapsed?50:380,flexShrink:0,transition:"width 0.25s",overflow:"hidden"}}
        title={sidebarCollapsed?undefined:"文库构建批次"}
        extra={<Button type="text" size="small" icon={sidebarCollapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}/>}>
        {!sidebarCollapsed && (<>
          <Button type="primary" icon={<PlusOutlined/>} block onClick={openNewBatch} style={{marginBottom:8}}>新建文库批次</Button>
          <Table dataSource={batches} rowKey="id" loading={loading} size="small" pagination={false} scroll={{y:"calc(100vh - 280px)"}}
            onRow={(r:BatchItem)=>({onClick:()=>fetchDetail(r.id),style:{background:selectedBatch?.id===r.id?"#e6f4ff":undefined,cursor:"pointer"}})} columns={batchColumns} />
        </>)}
      </Card>

      <div style={{flex:1,overflow:"auto"}}>
        {selectedBatch ? (
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status==="COMPLETED"?"green":selectedBatch.status==="IN_PROGRESS"?"blue":"default"}>{selectedBatch.status_display}</Tag></Space>}
            extra={<Space>
              {selectedBatch.status!=="COMPLETED" && <Popconfirm title="删除？" onConfirm={()=>deleteBatch(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm>}
              <Button icon={<ReloadOutlined/>} size="small" loading={batchLoading} onClick={()=>fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status!=="COMPLETED" && (<>
                <Button type="primary" icon={<CheckOutlined/>} size="small" onClick={saveProcessing}>保存</Button>
                <Popconfirm title="完成批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成</Button></Popconfirm>
              </>)}
            </Space>}>
            {/* Region + Kit selection */}
            <Card size="small" style={{marginBottom:12}}>
              <Space direction="vertical" style={{width:"100%"}}>
                <Space wrap>
                  <Text strong>地区：</Text>
                  <Radio.Group value={region} onChange={e=>setRegion(e.target.value)} optionType="button" options={[{value:"XIAMEN",label:"厦门"},{value:"HONGKONG",label:"香港"}]} />
                </Space>
                {/* Kits */}
                <Space wrap>
                  <span>👩 女性试剂盒: <Select size="small" style={{width:200}} value={femaleLibKit||undefined} onChange={setFemaleLibKit} options={FEMALE_KITS} placeholder="选择"/> </span>
                  <span>👨 男性试剂盒: <Select size="small" style={{width:200}} value={maleLibKit||undefined} onChange={setMaleLibKit} options={MALE_KITS} placeholder="选择"/> </span>
                  <span>Index: <Select size="small" style={{width:150}} value={indexKit||undefined} onChange={setIndexKit} options={INDEX_KITS} placeholder="选择"/> </span>
                  <span>Quant: <Select size="small" style={{width:140}} value={quantKit||undefined} onChange={setQuantKit} options={QUANT_KITS} placeholder="选择"/> </span>
                  <span>Beads: <Select size="small" style={{width:140}} value={beadKit||undefined} onChange={setBeadKit} options={BEAD_KITS} placeholder="选择"/> </span>
                </Space>
                {/* Start coords moved to above plate */}
                <Form form={libForm} layout="inline" style={{flexWrap:"wrap",gap:8}}>
                  <Form.Item name="lib_date" label="日期"><DatePicker size="small" style={{width:120}}/></Form.Item>
                  <Form.Item name="lib_time" label="时间"><TimePicker size="small" format="HH:mm" style={{width:90}}/></Form.Item>
                  <Form.Item name="equipment" label="设备"><Select size="small" style={{width:160}} options={EQUIPMENT_OPTIONS} placeholder="选择"/></Form.Item>
                  <Form.Item name="pcr_cycles" label="PCR cycles"><InputNumber size="small" style={{width:60}} min={0} max={30}/></Form.Item>
                  <Form.Item name="temperature" label="温度℃"><InputNumber size="small" style={{width:60}}/></Form.Item>
                  <Form.Item name="humidity" label="湿度%"><InputNumber size="small" style={{width:60}}/></Form.Item>
                </Form>
              </Space>
            </Card>

            {/* Step confirmations */}
            <Card size="small" style={{marginBottom:12}}>
              <Text strong style={{marginBottom:8,display:"block"}}>📋 步骤确认</Text>
              <Space wrap>{STEPS.map(s=>(
                <Checkbox key={s.key} checked={!!stepConfirmations[s.key]} onChange={e=>setStepConfirmations(p=>({...p,[s.key]:e.target.checked}))}>{s.label}</Checkbox>
              ))}</Space>
            </Card>

            {/* Plate(s) */}
            {region==="XIAMEN" ? (
              <div>
                <Space style={{marginBottom:8}}>
                  <span>👩 女性起始:</span>
                  <Input size="small" style={{width:60}} value={femaleStartCoord}
                    onChange={e=>setFemaleStartCoord(e.target.value.toUpperCase())} placeholder="默认居中"/>
                  <span>👨 男性起始:</span>
                  <Input size="small" style={{width:60}} value={maleStartCoord}
                    onChange={e=>setMaleStartCoord(e.target.value.toUpperCase())} placeholder="默认居中"/>
                  <Text type="secondary" style={{fontSize:11}}>（留空=居中填入，先女后男）</Text>
                </Space>
                <Card size="small" title={`🧬 96孔板 — 👩${selectedBatch.female_count}+👨${selectedBatch.male_blood_count+selectedBatch.male_other_count} 样本`}>
                  {renderPlate(buildXiamenPlate(selectedBatch.female_samples, [...selectedBatch.male_blood_samples,...selectedBatch.male_other_samples]))}
                </Card>
              </div>
            ) : (
              <Space direction="vertical" style={{width:"100%"}}>
                <Card size="small" title={`👩 女性板 — ${selectedBatch.female_count} 样本`} extra={<Text type="secondary">试剂盒: {femaleLibKit||"未选"}</Text>}>
                  {renderPlate(buildFullPlateMap(selectedBatch.female_samples))}
                </Card>
                <Card size="small" title={`👨 男性板 — ${selectedBatch.male_blood_count+selectedBatch.male_other_count} 样本`} extra={<Text type="secondary">试剂盒: {maleLibKit||"未选"}</Text>}>
                  {renderPlate(buildFullPlateMap([...selectedBatch.male_blood_samples,...selectedBatch.male_other_samples]))}
                </Card>
              </Space>
            )}

            <Divider style={{margin:"12px 0"}}/>
            <Card size="small" title="📷 实验照片">
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {photos.map((url,i)=>(<div key={i} style={{position:"relative",width:104,height:104}}><Image src={url} width={104} height={104} style={{objectFit:"cover",borderRadius:4}}/><Button type="text" danger size="small" style={{position:"absolute",top:-8,right:-8,background:"#fff",borderRadius:"50%"}} onClick={()=>setPhotos(p=>p.filter((_,j)=>j!==i))}>✕</Button></div>))}
                <Upload beforeUpload={f=>{handlePhoto(f);return false;}} showUploadList={false} accept="image/*">
                  <div style={{width:104,height:104,border:"1px dashed #d9d9d9",borderRadius:4,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><CameraOutlined style={{fontSize:24,color:"#999"}}/><Text type="secondary" style={{fontSize:11}}>拍照</Text></div>
                </Upload>
              </div>
            </Card>
          </Card>
        ) : (
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建文库批次</Button></div>
        )}
      </div>

      <Modal title="新建文库构建批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={700}
        okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData && (<div>
          <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}><Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text></div>
          <Space style={{marginBottom:8}}><Tag color="magenta">👩 {pendingData.female_count}</Tag><Tag color="blue">👨 {pendingData.male_blood_count+pendingData.male_other_count}</Tag></Space>
          <div style={{maxHeight:350,overflow:"auto"}}>
            {(["FEMALE_BLOOD","MALE_BLOOD","MALE_OTHER"] as const).map(cat=>{
              const entries = pendingData.entries.filter((e:any)=>e.category===cat);
              if (!entries.length) return null;
              const labels:Record<string,string>={FEMALE_BLOOD:"👩 女性",MALE_BLOOD:"🩸 男性血液",MALE_OTHER:"🧬 男性其他"};
              return (<div key={cat} style={{marginBottom:8}}><Text strong style={{fontSize:13}}>{labels[cat]} ({entries.length})</Text>
                {entries.map((e:any)=>{const allIn=e.case_sample_ids.every((id:string)=>selectedKeys.has(id)),someIn=e.case_sample_ids.some((id:string)=>selectedKeys.has(id));
                  return (<div key={e.case_sample_ids.join(",")} style={{padding:"4px 8px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:8}}>
                    <Checkbox checked={allIn} indeterminate={!allIn&&someIn} onChange={()=>{setSelectedKeys(prev=>{const n=new Set(prev);if(allIn) e.case_sample_ids.forEach((id:string)=>n.delete(id));else e.case_sample_ids.forEach((id:string)=>n.add(id));return n;})}}/>
                    <Text code style={{fontSize:11,width:150}}>{e.case_number}</Text>{e.test_sample_id&&<Tag color="blue" style={{fontSize:11}}>{e.test_sample_id}</Tag>}
                    <Text strong>{e.patient_name}</Text></div>);})}</div>);})}
          </div>
        </div>)}
      </Modal>
    </div>
  );
}
