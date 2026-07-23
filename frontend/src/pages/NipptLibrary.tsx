// NipptLibrary.tsx — Library Prep module (NIPT-style table + reagents)
import { useState, useEffect, useCallback } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, Input, Select, InputNumber,
  Space, Popconfirm, Radio, Checkbox, Divider, Upload, Image, DatePicker, TimePicker, Form,
  Popover, Row, Col } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined, CameraOutlined } from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

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

// ── Reagent kits (NIPT-style) ──
const FEMALE_KITS = [{value:"F-KIT-A",label:"NIPPT Female Library Kit A"},{value:"F-KIT-B",label:"NIPPT Female Library Kit B"}];
const MALE_KITS = [{value:"M-KIT-A",label:"NIPPT Male Library Kit A"},{value:"M-KIT-B",label:"NIPPT Male Library Kit B"}];
const LIB_KITS = [{value:"ND607-02",label:"VAHTS Universal DNA Library Prep Kit (ND607-02)"},{value:"ZD101-02",label:"ZHIXUAN Universal DNA Library Prep Kit (ZD101-02)"}];
const INDEX_KITS = [{value:"N34201-01",label:"VAHTS Maxi UDI Adapters Set1 (N34201-01)"},{value:"N34202-01",label:"VAHTS Maxi UDI Adapters Set2 (N34202-01)"},{value:"ZA201",label:"ZHIXUAN Maxi UDI Adapters Set1 (ZA201)"}];
const QUANT_KITS = [{value:"EQ121-02",label:"Equalbit 1x dsDNA HS Assay Kit (EQ121-02)"},{value:"ZQ501",label:"ZHIXUAN 1x dsDNA HS Assay Kit (ZQ501)"}];
const BEAD_KITS = [{value:"ZB401",label:"DNA Clean Beads (ZB401)"}];

type PlateCell = { vgId: string; index: string; sampleIdx?: number; isQC?: boolean };
type PlateGrid = PlateCell[][];
interface SampleItem { id:string; patient_name:string; role:string; category:string; case_sample_ids:string[]; test_sample_id:string|null; is_qc?:boolean; qc_status:string; qc_note:string; }
interface BatchItem { id:string; batch_number:string; status:string; status_display:string; sample_count:number; female_count:number; male_blood_count:number; male_other_count:number; created_at:string; }
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
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Region & coords ──
  const [region, setRegion] = useState("XIAMEN");
  const [femaleStartCoord, setFemaleStartCoord] = useState("");
  const [maleStartCoord, setMaleStartCoord] = useState("");
  const [hkFemaleStart, setHkFemaleStart] = useState("");
  const [hkMaleStart, setHkMaleStart] = useState("");

  // ── Reagents (NIPT-style) ──
  const [femaleLibKit, setFemaleLibKit] = useState("");
  const [maleLibKit, setMaleLibKit] = useState("");
  const [libKit, setLibKit] = useState("");
  const [selectedIndexKits, setSelectedIndexKits] = useState<string[]>([]);
  const [indexKitDetails, setIndexKitDetails] = useState<Record<string,{lot:string;expiry:string}>>({});
  const [quantKit, setQuantKit] = useState("");
  const [beadKit, setBeadKit] = useState("");
  const [positiveControl, setPositiveControl] = useState("");
  const [negativeControl, setNegativeControl] = useState("");
  const [libForm] = Form.useForm();

  // ── Steps & photos ──
  const [stepConfirmations, setStepConfirmations] = useState<Record<string,boolean>>({});
  const [photos, setPhotos] = useState<string[]>([]);

  // ── Plate data (NIPT-style grid) ──
  const emptyPlate = ():PlateGrid => Array.from({length:8},()=>Array.from({length:12},()=>({vgId:"",index:""})));
  const [femalePlate, setFemalePlate] = useState<PlateGrid>(emptyPlate());
  const [malePlate, setMalePlate] = useState<PlateGrid>(emptyPlate());
  const [xiamenPlate, setXiamenPlate] = useState<PlateGrid>(emptyPlate());
  const [sampleResults, setSampleResults] = useState<Record<string,{status:string;note:string}>>({});

  // ── Coord helpers ──
  const coordToIndexTB = (coord:string)=>{const r=coord[0],c=parseInt(coord.slice(1));return (c-1)*8+ROWS.indexOf(r);};
  const indexToCoordTB = (i:number)=>{const c=Math.floor(i/8),r=i%8;return`${ROWS[r]}${c+1}`;};

  // ── Build plates ──
  const buildCenteredPlate = (samples:SampleItem[]):PlateGrid => {
    const p = emptyPlate();
    const total = samples.length;
    const numCols = Math.min(Math.ceil(total/8),12);
    let startCol = Math.floor((12-numCols)/2);
    if (startCol%2===1) startCol-=1;
    let idx=0;
    for(let c=startCol;c<startCol+numCols&&idx<total;c++)
      for(let r=0;r<8&&idx<total;r++)
        p[r][c] = {vgId:samples[idx].test_sample_id||"?",index:"",sampleIdx:idx,isQC:samples[idx].is_qc};
        idx++;
    return p;
  };

  const buildXiamenPlateGrid = (female:SampleItem[], male:SampleItem[]):PlateGrid => {
    const all = [...female, ...male];
    if(!femaleStartCoord&&!maleStartCoord) return buildCenteredPlate(all);
    const p = emptyPlate();
    const fStart = femaleStartCoord?coordToIndexTB(femaleStartCoord):0;
    const mStart = maleStartCoord?coordToIndexTB(maleStartCoord):0;
    let fi=0, mi=0;
    for(let i=0;i<96;i++){
      const coord = indexToCoordTB(i);
      if(i>=fStart&&fi<female.length&&(i<mStart||mi>=male.length||!maleStartCoord)){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:female[fi].test_sample_id||"?",index:"",sampleIdx:fi,isQC:female[fi].is_qc};fi++;}
      else if(maleStartCoord&&i>=mStart&&mi<male.length){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:male[mi].test_sample_id||"?",index:"",sampleIdx:mi,isQC:male[mi].is_qc};mi++;}
      else if(!maleStartCoord&&fi>=female.length&&mi<male.length){p[ROWS.indexOf(coord[0])][parseInt(coord.slice(1))-1]={vgId:male[mi].test_sample_id||"?",index:"",sampleIdx:mi,isQC:male[mi].is_qc};mi++;}
    }
    return p;
  };

  // ── Auto-fill index ──
  const updateIndex = (setter:any, row:number, col:number, value:string, plate:PlateGrid) => {
    setter((prev:PlateGrid)=>{
      const next = prev.map(r=>r.map(c=>({...c})));
      next[row][col].index = value;
      if(row===0&&/^\d+$/.test(value)){
        const base = parseInt(value);
        const isFirst = plate.slice(0,row).every((r:any)=>!r[col]?.vgId);
        if(isFirst){
          for(let r=0;r<8;r++){
            if(plate[r]?.[col]?.vgId) next[r][col].index = String(base+r);
          }
        }
      }
      return next;
    });
  };

  // ── Fetch ──
  const fetchBatches = useCallback(async()=>{setLoading(true);try{const r=await(casesApi as any).listLibraryBatches();setBatches(r.data?.results||[])}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{fetchBatches()},[fetchBatches]);

  const fetchDetail = async(id:string)=>{
    setBatchLoading(true);
    try{
      const r = await(casesApi as any).getLibraryBatch(id);
      const d=r.data;setSelectedBatch(d);
      const ld=d.library_data||{};
      setRegion(ld.region||"XIAMEN");setFemaleStartCoord(ld.female_start_coord||"");setMaleStartCoord(ld.male_start_coord||"");
      setHkFemaleStart(ld.hk_female_start||"");setHkMaleStart(ld.hk_male_start||"");
      setFemaleLibKit(ld.female_lib_kit||"");setMaleLibKit(ld.male_lib_kit||"");
      setLibKit(ld.lib_kit||"");setQuantKit(ld.quant_kit||"");setBeadKit(ld.bead_kit||"");
      setPositiveControl(ld.positive_control||"");setNegativeControl(ld.negative_control||"");
      if(Array.isArray(ld.index_kits)){setSelectedIndexKits(ld.index_kits.map((k:any)=>k.kit));const dt:any={};ld.index_kits.forEach((k:any)=>{dt[k.kit]={lot:k.lot||"",expiry:k.expiry||""}});setIndexKitDetails(dt)}
      else{setSelectedIndexKits([]);setIndexKitDetails({})}
      setStepConfirmations(ld.step_confirmations||{});setPhotos(ld.photos||[]);
      setSampleResults(ld.sample_results||{});
      // Restore plate data
      const fp = ld.female_plate; const mp = ld.male_plate; const xp = ld.xiamen_plate;
      if(fp&&Array.isArray(fp)) setFemalePlate(fp);
      else setFemalePlate(buildCenteredPlate(d.female_samples||[]));
      if(mp&&Array.isArray(mp)) setMalePlate(mp);
      else setMalePlate(buildCenteredPlate([...(d.male_blood_samples||[]),...(d.male_other_samples||[])]));
      if(xp&&Array.isArray(xp)) setXiamenPlate(xp);
      else setXiamenPlate(buildXiamenPlateGrid(d.female_samples||[], [...(d.male_blood_samples||[]),...(d.male_other_samples||[])]));
      libForm.setFieldsValue({
        lib_date:ld.lib_date?dayjs(ld.lib_date):dayjs(),lib_time:ld.lib_time?dayjs(ld.lib_time,"HH:mm"):dayjs(),
        equipment:ld.equipment||"",pcr_cycles:ld.pcr_cycles??12,cfDNA_volume:ld.cfDNA_volume??undefined,
        elution_volume:ld.elution_volume??undefined,temperature:ld.temperature??undefined,humidity:ld.humidity??undefined,
      });
    }catch{message.error("加载失败")}finally{setBatchLoading(false)}
  };

  const openNewBatch = async()=>{
    try{
      const r=await(casesApi as any).pendingLibrary();const d=r.data;setPendingData(d);
      const all=new Set<string>();d.entries.forEach((e:any)=>e.case_sample_ids.forEach((id:string)=>all.add(id)));setSelectedKeys(all);
      const now=new Date();const pfx=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}`;
      try{const br=await(casesApi as any).listLibraryBatches({search:pfx});const c=(br.data?.results||[]).filter((b:any)=>b.batch_number.startsWith(pfx)).length;setBatchNumberPreview(`${pfx}-${String(c+1).padStart(3,"0")}`)}
      catch{setBatchNumberPreview(`${pfx}-001`)}
      setModalOpen(true);
    }catch{message.error("加载失败")}
  };

  const createBatch = async()=>{
    if(selectedKeys.size===0){message.warning("请选择样本");return}
    try{const r=await(casesApi as any).createLibraryBatch({case_sample_ids:Array.from(selectedKeys)});message.success(`批次 ${r.data.batch_number} 已创建`);setModalOpen(false);fetchBatches()}
    catch(e:any){message.error(e?.response?.data?.detail||"创建失败")}
  };

  const saveProcessing = async()=>{
    if(!selectedBatch)return;
    // Validate index
    const currentPlate = region==="XIAMEN"?xiamenPlate:(region==="HONGKONG"?femalePlate.concat(malePlate):femalePlate);
    const missingIndex = currentPlate.some(row=>row.some(cell=>cell.vgId&&!cell.index));
    if(missingIndex){message.warning("请填写所有 Index");return}
    if(selectedIndexKits.length===0){message.warning("请选择 Index 接头试剂盒");return}
    setSaving(true);
    try{
      const ld:any = {region,female_start_coord:femaleStartCoord,male_start_coord:maleStartCoord,
        hk_female_start:hkFemaleStart,hk_male_start:hkMaleStart,
        female_lib_kit:femaleLibKit,male_lib_kit:maleLibKit,
        lib_kit:libKit,index_kits:selectedIndexKits.map(k=>({kit:k,lot:indexKitDetails[k]?.lot||"",expiry:indexKitDetails[k]?.expiry||""})),
        quant_kit:quantKit,bead_kit:beadKit,
        positive_control:positiveControl,negative_control:negativeControl,
        ...libForm.getFieldsValue(),step_confirmations:stepConfirmations,sample_results:sampleResults,photos,
        female_plate:femalePlate,male_plate:malePlate,xiamen_plate:xiamenPlate,
      };
      await(casesApi as any).saveLibrary(selectedBatch.id,{library_data:ld});
      message.success("保存成功");fetchDetail(selectedBatch.id);
    }catch{message.error("保存失败")}
    finally{setSaving(false)}
  };

  const completeBatch = async()=>{if(!selectedBatch)return;try{await(casesApi as any).completeLibrary(selectedBatch.id);message.success("已完成");setSelectedBatch(null);fetchBatches()}catch{message.error("失败")}};
  const deleteBatch = async(id:string)=>{try{await(casesApi as any).deleteLibraryBatch(id);message.success("已删除");setSelectedBatch(null);fetchBatches()}catch(e:any){message.error(e?.response?.data?.detail||"删除失败")}};
  const handlePhoto = (file:File)=>{const r=new FileReader();r.onload=e=>setPhotos(p=>[...p,e.target?.result as string]);r.readAsDataURL(file);return false};

  // ── Table styles (NIPT-style) ──
  const thStyle:React.CSSProperties = {border:"1px solid #bbb",padding:"4px 6px",textAlign:"center",fontWeight:700,background:"#d5e8d4",fontSize:12,minWidth:32};
  const rowLabelStyle:React.CSSProperties = {border:"1px solid #bbb",padding:"4px 6px",textAlign:"center",fontWeight:600,fontSize:12,background:"#e8e8e8",width:24};
  const cellStyle:React.CSSProperties = {border:"1px solid #d9d9d9",padding:0,verticalAlign:"middle"};
  const inputStyle:React.CSSProperties = {width:50,border:"none",borderRadius:0,textAlign:"center",padding:"2px 4px",fontSize:11,background:"#fffbe6",borderRight:"1px solid #e0e0e0"};
  const vgIdStyle:React.CSSProperties = {fontSize:11,padding:"2px 4px",textAlign:"center",whiteSpace:"nowrap",maxWidth:80,background:"#fafafa",flex:1,display:"flex",alignItems:"center",justifyContent:"center"};

  const renderNiptPlate = (plate:PlateGrid, setter:any) => (
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",fontSize:12,margin:"0 auto"}}>
        <thead><tr><th style={rowLabelStyle}></th>{COLS.map(c=><th key={c} style={thStyle}>{c}</th>)}</tr></thead>
        <tbody>{ROWS.map((label,row)=>(
          <tr key={row}><td style={rowLabelStyle}>{label}</td>
            {Array.from({length:12},(_,col)=>{
              const cell = plate[row]?.[col]||{vgId:"",index:""};
              const sIdx = cell.sampleIdx;
              const sr = sIdx!==undefined?sampleResults[String(sIdx)]:undefined;
              const failBg = sr?.status==="fail"?"#fff1f0":undefined;
              const passBg = sr?.status==="pass"?"#f6ffed":undefined;
              const baseBg = cell.vgId?"#e8f5e9":"#fafafa";
              const bg = failBg||passBg||baseBg;
              return (
                <td key={col} style={{...cellStyle,background:bg,cursor:cell.vgId?"pointer":"default"}}>
                  <Popover trigger="click" content={
                    <div style={{minWidth:180}}>
                      <Radio.Group value={sr?.status||""} onChange={e=>{const v=e.target.value;setSampleResults((p:any)=>({...p,[String(sIdx)]:{status:v,note:v==="fail"?(p[String(sIdx)]?.note||""):""}}))}}>
                        <Radio value="pass" style={{color:"#52c41a"}}>Pass</Radio>
                        <Radio value="fail" style={{color:"#ff4d4f"}}>Fail</Radio>
                      </Radio.Group>
                      {sr?.status==="fail"&&<TextArea size="small" rows={2} placeholder="失败原因..." value={sr?.note||""} onChange={e=>setSampleResults((p:any)=>({...p,[String(sIdx)]:{status:"fail",note:e.target.value}}))} style={{marginTop:8}}/>}
                    </div>
                  }>
                    <div style={{display:"flex",alignItems:"stretch",minHeight:30}}>
                      <input type="text" value={cell.index} onChange={e=>updateIndex(setter,row,col,e.target.value,plate)} style={inputStyle} placeholder="ix"/>
                      <div style={{...vgIdStyle}}>{cell.vgId||""}{cell.isQC?<span style={{color:"#13c2c2",fontWeight:600,marginLeft:1}}>QC</span>:null}</div>
                    </div>
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
    {title:"状态",dataIndex:"status",width:60,render:(v:string)=>{const c:Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"},l:Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"};return<Tag color={c[v]||"default"}>{l[v]||v}</Tag>}},
    {title:"样本",width:100,render:(_:any,r:BatchItem)=><Text style={{fontSize:11}}>👩{r.female_count} 👨{r.male_blood_count+r.male_other_count}</Text>},
  ];

  const ReagentRow = ({label,value,onChange,options,lot,onLot,expiry,onExpiry}:{label:string;value:string;onChange:any;options:{value:string;label:string}[];lot:string;onLot:any;expiry:string;onExpiry:any})=>(
    <Row gutter={12} style={{marginBottom:8}}>
      <Col span={13}><Form.Item label={label} style={{marginBottom:0}}><Select options={options} value={value||undefined} onChange={onChange} placeholder={`选择${label}`} showSearch optionFilterProp="label"/></Form.Item></Col>
      <Col span={4}><Form.Item label="批号" style={{marginBottom:0}}><Input value={lot} onChange={e=>onLot(e.target.value)} placeholder="批号"/></Form.Item></Col>
      <Col span={5}><Form.Item label="有效期" style={{marginBottom:0}}><DatePicker picker="month" value={expiry?dayjs(expiry):null} onChange={(d:any)=>onExpiry(d?d.format("YYYY-MM"):"")} placeholder="有效期" style={{width:"100%"}} format="YYYY-MM"/></Form.Item></Col>
    </Row>
  );

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
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status==="COMPLETED"?"green":selectedBatch.status==="IN_PROGRESS"?"blue":"default"}>{selectedBatch.status_display}</Tag></Space>}
            extra={<Space>
              {selectedBatch.status!=="COMPLETED"&&<Popconfirm title="删除？" onConfirm={()=>deleteBatch(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm>}
              <Button icon={<ReloadOutlined/>} size="small" loading={batchLoading} onClick={()=>fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status!=="COMPLETED"&&<>
                <Button type="primary" icon={<CheckOutlined/>} size="small" loading={saving} onClick={saveProcessing}>保存</Button>
                <Popconfirm title="完成批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成</Button></Popconfirm>
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
                  <Form.Item name="lib_date" label="日期"><DatePicker size="small" style={{width:120}}/></Form.Item>
                  <Form.Item name="lib_time" label="时间"><TimePicker size="small" format="HH:mm" style={{width:90}}/></Form.Item>
                  <Form.Item name="equipment" label="设备"><Select size="small" style={{width:160}} options={EQUIPMENT_OPTIONS} placeholder="选择"/></Form.Item>
                  <Form.Item name="pcr_cycles" label="PCR cycles"><InputNumber size="small" style={{width:60}} min={0} max={30}/></Form.Item>
                </Form>
              </Space>
            </Card>

            {/* Reagent kits (NIPT-style) */}
            <Card size="small" title="建库试剂盒及配套试剂" style={{marginBottom:12}}>
              <ReagentRow label="文库构建Kit" value={libKit} onChange={setLibKit} options={LIB_KITS} lot="lib_kit_lot" onLot={()=>{}} expiry="lib_kit_expiry" onExpiry={()=>{}}/>
              <div style={{marginBottom:8}}>
                <Row gutter={12} style={{marginBottom:4}}><Col span={13}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>Index接头</span></Col><Col span={4}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>批号</span></Col><Col span={5}><span style={{fontSize:14,color:"rgba(0,0,0,0.88)"}}>有效期</span></Col></Row>
                <Row gutter={12}><Col span={13}><Select mode="multiple" options={INDEX_KITS} value={selectedIndexKits} onChange={(vs:string[])=>{setSelectedIndexKits(vs);setIndexKitDetails((p:any)=>{const n={...p};Object.keys(n).forEach(k=>{if(!vs.includes(k))delete n[k]});vs.forEach(v=>{if(!n[v])n[v]={lot:"",expiry:""}});return n})}} placeholder="选择 Index 接头" showSearch optionFilterProp="label" style={{width:"100%"}} maxTagCount={2}/></Col></Row>
                {selectedIndexKits.map(kv=>{const k=INDEX_KITS.find(k=>k.value===kv);return(
                  <Row key={kv} gutter={12} style={{marginBottom:8}}><Col span={13}><div style={{padding:"4px 11px",lineHeight:"30px",border:"1px solid #d9d9d9",borderRadius:6,background:"#f5f5f5",color:"#1677ff",fontWeight:500,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k?.label||kv}</div></Col>
                  <Col span={4}><Input placeholder="批号" value={indexKitDetails[kv]?.lot||""} onChange={e=>setIndexKitDetails((p:any)=>({...p,[kv]:{...p[kv],lot:e.target.value}}))}/></Col>
                  <Col span={5}><DatePicker picker="month" placeholder="有效期" style={{width:"100%"}} format="YYYY-MM" value={indexKitDetails[kv]?.expiry?dayjs(indexKitDetails[kv].expiry):null} onChange={(d:any)=>setIndexKitDetails((p:any)=>({...p,[kv]:{...p[kv],expiry:d?d.format("YYYY-MM"):""}}))}/></Col></Row>
                )})}
              </div>
              <ReagentRow label="定量Kit" value={quantKit} onChange={setQuantKit} options={QUANT_KITS} lot="quant_kit_lot" onLot={()=>{}} expiry="quant_kit_expiry" onExpiry={()=>{}}/>
              <ReagentRow label="纯化磁珠" value={beadKit} onChange={setBeadKit} options={BEAD_KITS} lot="bead_kit_lot" onLot={()=>{}} expiry="bead_kit_expiry" onExpiry={()=>{}}/>
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
            {region==="XIAMEN"?(
              <Card size="small" title={<Space>{`🧬 96孔板 — 👩${selectedBatch.female_count}+👨${selectedBatch.male_blood_count+selectedBatch.male_other_count} 样本`}<Text type="secondary" style={{fontSize:11}}>女起:</Text><Input size="small" style={{width:50}} value={femaleStartCoord} onChange={e=>setFemaleStartCoord(e.target.value.toUpperCase())} placeholder="居中"/><Text type="secondary" style={{fontSize:11}}>男起:</Text><Input size="small" style={{width:50}} value={maleStartCoord} onChange={e=>setMaleStartCoord(e.target.value.toUpperCase())} placeholder="居中"/></Space>}>
                {renderNiptPlate(xiamenPlate, setXiamenPlate)}
              </Card>
            ):(
              <Space direction="vertical" style={{width:"100%"}}>
                <Card size="small" title={<Space>{`👩 女性板 — ${selectedBatch.female_count} 样本`}<Text type="secondary" style={{fontSize:11}}>起始:</Text><Input size="small" style={{width:50}} value={hkFemaleStart} onChange={e=>setHkFemaleStart(e.target.value.toUpperCase())} placeholder="居中"/></Space>} extra={<Text type="secondary">试剂盒: {femaleLibKit||"未选"}</Text>}>
                  {renderNiptPlate(femalePlate, setFemalePlate)}
                </Card>
                <Card size="small" title={<Space>{`👨 男性板 — ${selectedBatch.male_blood_count+selectedBatch.male_other_count} 样本`}<Text type="secondary" style={{fontSize:11}}>起始:</Text><Input size="small" style={{width:50}} value={hkMaleStart} onChange={e=>setHkMaleStart(e.target.value.toUpperCase())} placeholder="居中"/></Space>} extra={<Text type="secondary">试剂盒: {maleLibKit||"未选"}</Text>}>
                  {renderNiptPlate(malePlate, setMalePlate)}
                </Card>
              </Space>
            )}

            <Divider style={{margin:"12px 0"}}/>
            <Card size="small" title="📷 实验照片">
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {photos.map((url,i)=>(<div key={i} style={{position:"relative",width:104,height:104}}><Image src={url} width={104} height={104} style={{objectFit:"cover",borderRadius:4}}/><Button type="text" danger size="small" style={{position:"absolute",top:-8,right:-8,background:"#fff",borderRadius:"50%"}} onClick={()=>setPhotos(p=>p.filter((_,j)=>j!==i))}>✕</Button></div>))}
                <Upload beforeUpload={f=>{handlePhoto(f);return false}} showUploadList={false} accept="image/*"><div style={{width:104,height:104,border:"1px dashed #d9d9d9",borderRadius:4,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><CameraOutlined style={{fontSize:24,color:"#999"}}/><Text type="secondary" style={{fontSize:11}}>拍照</Text></div></Upload>
              </div>
            </Card>
          </Card>
        ):(
          <div style={{textAlign:"center",paddingTop:100,color:"#999"}}><Title level={5} type="secondary">选择批次查看详情</Title><Button type="primary" icon={<PlusOutlined/>} onClick={openNewBatch}>新建文库批次</Button></div>
        )}
      </div>
      <Modal title="新建文库构建批次" open={modalOpen} onOk={createBatch} onCancel={()=>setModalOpen(false)} width={700} okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData&&(<div>
          <div style={{marginBottom:12,padding:"8px 12px",background:"#f6ffed",borderRadius:6}}><Text strong>批次号：</Text><Text code style={{fontSize:16}}>{batchNumberPreview}</Text></div>
          <Space style={{marginBottom:8}}><Tag color="magenta">👩 {pendingData.female_count}</Tag><Tag color="blue">👨 {pendingData.male_blood_count+pendingData.male_other_count}</Tag></Space>
          <div style={{maxHeight:350,overflow:"auto"}}>
            {(["FEMALE_BLOOD","MALE_BLOOD","MALE_OTHER"] as const).map(cat=>{
              const entries = pendingData.entries.filter((e:any)=>e.category===cat);
              if(!entries.length)return null;
              const labels:Record<string,string>={FEMALE_BLOOD:"👩 女性",MALE_BLOOD:"🩸 男性血液",MALE_OTHER:"🧬 男性其他"};
              return (<div key={cat} style={{marginBottom:8}}><Text strong style={{fontSize:13}}>{labels[cat]} ({entries.length})</Text>
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
