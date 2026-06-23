import { useEffect, useState, useMemo, useRef } from "react";
import { Form, Input, DatePicker, Select, Button, Card, Row, Col, Checkbox, Space, message, InputNumber, Typography, Popover, Radio, Tag, Table } from "antd";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { getSampleBadge, getCellBg } from "../utils/badge";
import { getSignStatus } from "../utils/sign";
import { ROWS_8, COLS_12, REGIONS, STEPS, EXTRACTION_KITS } from "../utils/constants";

const EXTRACTION_METHODS = [
  { value: "MANUAL", label: "Manual (手动提取)" },
  { value: "MAGNETIC_ROD", label: "Magnetic Rod (磁棒法)" },
  { value: "AUTOMATED", label: "Automated Workstation (自动化工作站)" },
];

// REGIONS imported from ../utils/constants

// KITS_BY_REGION → use EXTRACTION_KITS from ../utils/constants

// STEPS imported from ../utils/constants

// ROWS_8 imported from ../utils/constants
// COLS_12 imported from ../utils/constants

// getSignStatus imported from ../utils/sign

interface Props {
  batch: any;
  samples: any[];
  onRefresh: () => void;
}

const { Text } = Typography;

// ── SampleCell: clickable cell with Pass/Fail popover ──
function SampleCell({ label, sampleIdx, results, onChange, cellStyle }: {
  label: string;
  sampleIdx: number;
  results: Record<string, { status: string; note: string }>;
  onChange: (key: string, status: string, note: string) => void;
  cellStyle: any;
}) {
  const key = String(sampleIdx);
  const result = results[key];
  const status = result?.status || "pass";
  const note = result?.note || "";
  const [open, setOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);
  const [localNote, setLocalNote] = useState(note);

  if (!label || label === "-") {
    return <td style={cellStyle}></td>;
  }

  const bg = cellStyle?.background || (status === "fail" ? "#fff1f0" : "#f6ffed");
  const color = status === "fail" ? "#cf1322" : "#52c41a";

  const popContent = (
    <div style={{ width: 220 }}>
      <Radio.Group
        value={localStatus}
        onChange={e => { setLocalStatus(e.target.value); if (e.target.value === "pass") setLocalNote(""); }}
        style={{ marginBottom: 8 }}
      >
        <Radio value="pass" style={{ color: "#52c41a" }}>Pass ✓</Radio>
        <Radio value="fail" style={{ color: "#cf1322" }}>Fail ✗</Radio>
      </Radio.Group>
      {localStatus === "fail" && (
        <Input.TextArea
          placeholder="失败原因备注"
          value={localNote}
          onChange={e => setLocalNote(e.target.value)}
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ fontSize: 11, marginBottom: 8 }}
        />
      )}
      <div style={{ textAlign: "right" }}>
        <Button size="small" onClick={() => {
          onChange(key, localStatus, localNote);
          setOpen(false);
        }}>
          确认
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={popContent}
      trigger="click"
      open={open}
      onOpenChange={v => { setOpen(v); if (v) { setLocalStatus(status); setLocalNote(note); } }}
      placement="bottomLeft"
      destroyTooltipOnHide
    >
      <td style={{ ...cellStyle, background: bg, cursor: "pointer", color }}>
        {label}
      </td>
    </Popover>
  );
}

export default function NiptExtractionTab({ batch, samples, onRefresh }: Props) {
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState(batch.extraction_method || "");
  const [manualNotes, setManualNotes] = useState("");
  const [region, setRegion] = useState(batch.region || "");
  const magneticNotesRef = useRef<Record<string, string>>({});
  const edata = useMemo(() => batch.extraction_data || {}, [batch.extraction_data]);
  const defaultsFetchedRef = useRef(false);

  // sampleResults: keyed by sample index → { status, note }
  const [sampleResults, setSampleResults] = useState<Record<string, { status: string; note: string }>>({});

  // Load saved data + pre-fill from last batch
  useEffect(() => {
    form.setFieldsValue({
      extraction_date: edata.extraction_date ? dayjs(edata.extraction_date) : dayjs(),
      extraction_time: edata.extraction_time || dayjs().format("HH:mm"),
      equipment: edata.equipment || "",
      kit_type: edata.kit_type || undefined,
      reagent_lot: edata.reagent_lot || "",
      reagent_expiry: edata.reagent_expiry ? dayjs(edata.reagent_expiry) : undefined,
      plasma_volume: edata.plasma_volume ?? undefined,
      elution_volume: edata.elution_volume ?? undefined,
      temperature: edata.temperature ?? undefined,
      humidity: edata.humidity ?? undefined,
    });
    setSteps(edata.step_confirmations || {});
    setManualNotes(edata.manual_notes || "");
    setSampleResults(edata.sample_results || {});
    if (batch.extraction_method) setMethod(batch.extraction_method);
    if (batch.region) setRegion(batch.region);

    // 🆕 Pre-fill reagent & equipment from last batch for new batches
    if (batch.id && !edata.kit_type && !edata.reagent_lot && !defaultsFetchedRef.current) {
      defaultsFetchedRef.current = true;
      api.get("/runs/last_batch_defaults/?panel=NIPT").then((res: any) => {
        const ext = res?.extraction;
        if (ext) {
          form.setFieldsValue({
            equipment: ext.equipment || "",
            kit_type: ext.kit_type || undefined,
            reagent_lot: ext.reagent_lot || "",
            reagent_expiry: ext.reagent_expiry ? dayjs(ext.reagent_expiry) : undefined,
          });
        }
      }).catch(() => {});
    }
  }, [edata, batch, form]);

  const toggleStep = (key: string) => setSteps(prev => ({ ...prev, [key]: !prev[key] }));

  const setSampleResult = (key: string, status: string, note: string) => {
    setSampleResults(prev => {
      const next = { ...prev };
      if (status === "pass" && !note) {
        delete next[key]; // remove pass entries (default)
      } else {
        next[key] = { status, note };
      }
      return next;
    });
  };

  const save = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);
      const payload = {
        extraction_method: method,
        region,
        extraction_data: {
          extraction_date: vals.extraction_date?.format("YYYY-MM-DD"),
          extraction_time: vals.extraction_time,
          equipment: vals.equipment || "",
          kit_type: vals.kit_type || "",
          reagent_lot: vals.reagent_lot || "",
          reagent_expiry: vals.reagent_expiry?.format("YYYY-MM") || "",
          plasma_volume: vals.plasma_volume,
          elution_volume: vals.elution_volume,
          temperature: vals.temperature,
          humidity: vals.humidity,
          step_confirmations: steps,
          manual_notes: manualNotes,
          magnetic_notes: magneticNotesRef.current,
          sample_results: sampleResults,
        },
      };
      await api.post(`/runs/${batch.id}/save_extraction/`, payload);
      message.success("核酸提取记录已保存");
      onRefresh();
    } catch (e: any) {
      if (e?.errorFields) { message.warning("请填写所有必填项"); return; }
      message.error(e?.response?.data?.error || "保存失败");
    } finally { setSaving(false); }
  };

  const { signed: opSigned, name: opSigner } = getSignStatus(edata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(edata, "reviewer");
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);
  const kits = EXTRACTION_KITS[region] || [];

  // ── Failed samples list ──
  const failedSamples = useMemo(() => {
    const list: any[] = [];
    Object.entries(sampleResults).forEach(([key, r]) => {
      if (r.status === "fail") {
        const idx = parseInt(key);
        const s = samples[idx];
        list.push({
          key,
          idx: idx + 1,
          vgId: s ? (s.sample_vg_id || s.sample_barcode || s.vg_id || s.sample_id || "-") : "-",
          patient: s?.sample_patient_id || s?.patient_name || "-",
          note: r.note || "-",
        });
      }
    });
    return list;
  }, [sampleResults, samples]);

  const failColumns = [
    { title: "序号", dataIndex: "idx", width: 60 },
    { title: "样本编号 (VG ID)", dataIndex: "vgId", width: 150 },
    { title: "患者", dataIndex: "patient", width: 120 },
    { title: "结果", dataIndex: "key", width: 60, render: () => <Tag color="red">Fail</Tag> },
    { title: "失败备注", dataIndex: "note" },
  ];

  // ── Helpers ──
  const getLabel = (idx: number) => {
    const s = samples[idx];
    if (!s) return "-";
    const badge = getSampleBadgeLocal(idx);
    const vgId = s.sample_vg_id || s.sample_barcode || s.vg_id || s.sample_id || "-";
    return badge.text ? badge.text + vgId : vgId;
  };
  const getSampleBadgeLocal = (idx: number) => getSampleBadge(samples[idx]);
  const getCellBgLocal = (idx?: number) => getCellBg(idx, samples);

  return (
    <div>
      {/* Method & Region */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Form.Item label="Extraction Method" required>
            <Select options={EXTRACTION_METHODS} value={method || undefined} onChange={setMethod} placeholder="Select method" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Region" required>
            <Select options={REGIONS} value={region || undefined} onChange={setRegion} placeholder="Select region" />
          </Form.Item>
        </Col>
      </Row>

      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={6}><Form.Item name="extraction_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="extraction_time" label="实验时间"><Input placeholder="例：09:00" /></Form.Item></Col>
          <Col span={6}><Form.Item name="equipment" label="设备类型"><Input placeholder="预留" disabled /></Form.Item></Col>
          <Col span={6}><Form.Item name="kit_type" label="提取试剂盒" rules={[{ required: true }]}><Select options={kits} placeholder="选择试剂盒" showSearch optionFilterProp="label" /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="reagent_lot" label="试剂批次" rules={[{ required: true }]}><Input placeholder="批次号" /></Form.Item></Col>
          <Col span={6}><Form.Item name="reagent_expiry" label="有效期"><Input placeholder="YYYY-MM" /></Form.Item></Col>
          <Col span={6}><Form.Item name="plasma_volume" label="血浆投入体积 (mL)" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 4.0" /></Form.Item></Col>
          <Col span={6}><Form.Item name="elution_volume" label="CfDNA洗脱体积 (μL)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 60" /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="temperature" label="环境温度 (℃)"><InputNumber min={0} max={50} step={0.1} style={{ width: "100%" }} placeholder="e.g. 25" /></Form.Item></Col>
          <Col span={6}><Form.Item name="humidity" label="环境湿度 (%)"><InputNumber min={0} max={100} style={{ width: "100%" }} placeholder="e.g. 55" /></Form.Item></Col>
        </Row>
      </Form>

      <Card title="步骤确认" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {STEPS.map(step => {
            const manualHide = method === "MANUAL" && (step.key === "uv_prep" || step.key === "on_machine");
            return (
              <Checkbox key={step.key} checked={!!steps[step.key]} onChange={() => toggleStep(step.key)} style={manualHide ? { opacity: 0.4 } : undefined}>
                {step.label}{manualHide ? " (手动跳过)" : ""}
              </Checkbox>
            );
          })}
        </Space>
      </Card>

      {/* Color legend for test option and twin markers */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, fontSize: 12, color: "#666" }}>
        <span>图例：</span>
        <span style={{ background: "#e6f4ff", padding: "2px 8px", borderRadius: 3, border: "1px solid #91caff" }}>浅蓝 = Plus</span>
        <span style={{ background: "#f6ffed", padding: "2px 8px", borderRadius: 3, border: "1px solid #b7eb8f" }}>浅绿 = Basic</span>
        <span style={{ background: "#e8d5f5", padding: "2px 8px", borderRadius: 3, border: "1px solid #c9a2e0" }}>浅紫 = Basic All</span>
        <span>👶👶 = Twin（双胎标记）</span>
      </div>

      {/* ═══ MANUAL ═══ */}
      {method === "MANUAL" && (() => {
        const TH = { border: "1px solid #bbb", padding: "4px 6px", textAlign: "center" as const, fontWeight: 700, background: "#e8e8e8", fontSize: 12 };
        const TD_NUM = { border: "1px solid #d9d9d9", padding: "3px 6px", textAlign: "center" as const, fontWeight: 600, color: "#595959", fontSize: 12, minWidth: 36 };
        const TD_SAMPLE = { border: "1px solid #d9d9d9", padding: "3px 6px", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, minWidth: 90, color: "#1d1d1d" };
        const totalSamples = samples.length;
        return (
          <Card
            title={`手动提取登记 (${totalSamples} samples，共 48 个样本位)`}
            extra={<Input.TextArea placeholder="备注（试剂批号差异、操作异常等）" value={manualNotes} onChange={e => setManualNotes(e.target.value)} autoSize={{ minRows: 1, maxRows: 3 }} style={{ width: 320, fontSize: 12 }} allowClear />}
            size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: 0 }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <colgroup>
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
                <col style={{ width: "11%" }} /><col style={{ width: "22.33%" }} />
              </colgroup>
              <thead><tr style={{ background: "#e8e8e8" }}><th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th><th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th><th style={TH}>序号</th><th style={TH}>样本编号 (VG ID)</th></tr></thead>
              <tbody>
                {[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(row => {
                  const bg = row % 2 === 0 ? "#fff" : "#f5f5f5";
                  const c0 = row, c1 = 16+row, c2 = 32+row;
                  const l0 = getLabel(c0), l1 = getLabel(c1), l2 = getLabel(c2);
                  return (
                    <tr key={`r${row}`} style={{ background: bg }}>
                      <td style={TD_NUM}>{c0+1}</td>
                      <SampleCell label={l0} sampleIdx={c0} results={sampleResults} onChange={setSampleResult} cellStyle={{...TD_SAMPLE, background: getCellBgLocal(c0)}} />
                      <td style={TD_NUM}>{c1+1}</td>
                      <SampleCell label={l1} sampleIdx={c1} results={sampleResults} onChange={setSampleResult} cellStyle={{...TD_SAMPLE, background: getCellBgLocal(c1)}} />
                      <td style={TD_NUM}>{c2+1}</td>
                      <SampleCell label={l2} sampleIdx={c2} results={sampleResults} onChange={setSampleResult} cellStyle={{...TD_SAMPLE, background: getCellBgLocal(c2)}} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ textAlign: "center", padding: "4px 0" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>按列从上到下排列（左列 1→16，中列 17→32，右列 33→48），序号方便一眼确认提取数量</Text>
            </div>
          </Card>
        );
      })()}

      {/* ═══ MAGNETIC ROD ═══ */}
      {method === "MAGNETIC_ROD" && (() => {
        const SAMPLES_PER_PLATE = 16;
        const totalPlates = Math.ceil(samples.length / SAMPLES_PER_PLATE);
        return (
          <>
            {Array.from({ length: totalPlates }, (_, plateIdx) => {
              const base = plateIdx * SAMPLES_PER_PLATE;
              const plateSamples = samples.slice(base, base + SAMPLES_PER_PLATE);
              const plateNo = `P${plateIdx + 1}`;
              return (
                <Card key={plateIdx} title={`${plateNo} 磁棒法 Plate ${plateIdx+1}/${totalPlates} (${plateSamples.length} samples)`} size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: "4px 8px" }}
                  extra={<Input.TextArea placeholder={`${plateNo} 备注`} defaultValue={magneticNotesRef.current[plateIdx]||""} onChange={e=>{magneticNotesRef.current[plateIdx]=e.target.value}} autoSize={{minRows:1,maxRows:2}} style={{width:240,fontSize:11}} allowClear />}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <colgroup><col style={{width:"3%"}} />{COLS_12.map(c=><col key={c} style={{width:c===6||c===12?"10%":"7.5%"}} />)}</colgroup>
                    <thead><tr style={{background:"#e8e8e8"}}><th style={{border:"1px solid #bbb",padding:"2px 4px",fontSize:11}}></th>{COLS_12.map(c=><th key={c} style={{border:"1px solid #bbb",padding:"2px 4px",textAlign:"center",fontSize:11,fontWeight:700,background:(c===6||c===12)?"#fff1f0":"#e8e8e8",color:(c===6||c===12)?"#cf1322":"#333"}}>{c}</th>)}</tr></thead>
                    <tbody>
                      {ROWS_8.map((r,rowIdx)=>{
                        const bg = rowIdx%2===0?"#fff":"#f5f5f5";
                        const col1Idx=base+rowIdx, col7Idx=base+8+rowIdx;
                        const s1=col1Idx<samples.length?(getLabel(col1Idx)):"";
                        const s7=col7Idx<samples.length?(getLabel(col7Idx)):"";
                        return (<tr key={r} style={{background:bg}}>
                          <td style={{border:"1px solid #d9d9d9",padding:"3px 4px",textAlign:"center",fontWeight:600,color:"#595959",fontSize:11}}>{r}</td>
                          {COLS_12.map(c=>{
                            const isProductCol=c===6||c===12;
                            if(isProductCol) return <td key={c} style={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,background:"#fff1f0",minHeight:28,verticalAlign:"middle"}}><span style={{color:"#cf1322",fontWeight:600}}>产物</span></td>;
                            if(c===1&&s1) return <SampleCell label={s1} sampleIdx={col1Idx} results={sampleResults} onChange={setSampleResult} cellStyle={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,minHeight:28,verticalAlign:"middle"}} />;
                            if(c===7&&s7) return <SampleCell label={s7} sampleIdx={col7Idx} results={sampleResults} onChange={setSampleResult} cellStyle={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,minHeight:28,verticalAlign:"middle"}} />;
                            return <td key={c} style={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,background:bg,minHeight:28,verticalAlign:"middle"}}></td>;
                          })}
                        </tr>);
                      })}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </>
        );
      })()}

      {/* ═══ AUTOMATED ═══ */}
      {method === "AUTOMATED" && (() => {
        const totalCells = 96;
        const ROWS = 8;
        const isFull = samples.length >= totalCells;
        const numCols = Math.min(Math.ceil(samples.length / ROWS), 12);
        const startCol = isFull ? 1 : Math.floor((12 - numCols) / 2) + 1;
        // Sort sample indices by VG ID ascending for left-to-right top-to-bottom filling
        const sortedIndices = samples
          .map((s: any, i: number) => ({ i, id: (s.sample_vg_id || s.sample_barcode || '').toString() }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id, undefined, { numeric: true }))
          .map((x: any) => x.i);
        const cellMap: Record<string, number> = {};
        let sortedPos = 0;
        for (let c = startCol; c < startCol + numCols; c++) { for (let row=0;row<ROWS;row++) { cellMap[`${ROWS_8[row]}${c}`]=sortedIndices[sortedPos]; sortedPos++; } }
        return (
          <Card title={`自动化工作站 (${samples.length} samples，共 ${totalCells} 孔)`} size="small" style={{marginBottom:8}} bodyStyle={{padding:"4px 8px"}}
            extra={<Input.TextArea placeholder="自动化工作站备注" defaultValue={magneticNotesRef.current["auto"]||""} onChange={e=>{magneticNotesRef.current["auto"]=e.target.value}} autoSize={{minRows:1,maxRows:2}} style={{width:260,fontSize:11}} allowClear />}
          >
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <colgroup><col style={{width:"3%"}} />{COLS_12.map(c=><col key={c} style={{width:"8.08%"}} />)}</colgroup>
              <thead><tr style={{background:"#e8e8e8"}}><th style={{border:"1px solid #bbb",padding:"2px 4px",fontSize:11}}></th>{COLS_12.map(c=><th key={c} style={{border:"1px solid #bbb",padding:"2px 4px",textAlign:"center",fontSize:11,fontWeight:700}}>{c}</th>)}</tr></thead>
              <tbody>
                {ROWS_8.map((r,rowIdx)=>{
                  const bg=rowIdx%2===0?"#fff":"#f5f5f5";
                  return (<tr key={r} style={{background:bg}}>
                    <td style={{border:"1px solid #d9d9d9",padding:"3px 4px",textAlign:"center",fontWeight:600,color:"#595959",fontSize:11}}>{r}</td>
                    {COLS_12.map(c=>{
                      const wl=`${r}${c}`; const idx=cellMap[wl];
                      const label=idx!==undefined&&idx<samples.length?(getLabel(idx)):"";
                      if(!label) return <td key={c} style={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,background:getCellBgLocal(idx),minHeight:28,verticalAlign:"middle"}}></td>;
                      return <SampleCell key={c} label={label} sampleIdx={idx} results={sampleResults} onChange={setSampleResult} cellStyle={{border:"1px solid #d9d9d9",padding:"2px 3px",textAlign:"center",fontSize:10,minHeight:28,verticalAlign:"middle",background:getCellBgLocal(idx)}} />;
                    })}
                  </tr>);
                })}
              </tbody>
            </table>
            <div style={{textAlign:"center",padding:"4px 0"}}><Text type="secondary" style={{fontSize:11}}>{isFull?"96 孔满板，从左到右从上到下依次填充":`居中 ${numCols} 列（${startCol}-${startCol+numCols-1}），从左到右从上到下`}</Text></div>
          </Card>
        );
      })()}

      {/* ═══ FAILED SAMPLES SUMMARY ═══ */}
      {failedSamples.length > 0 && (
        <Card title={`失败样本 (${failedSamples.length})`} size="small" style={{ marginBottom: 8, border: "1px solid #ffccc7" }} bodyStyle={{ padding: "8px" }}>
          <Table dataSource={failedSamples} columns={failColumns} rowKey="key" size="small" pagination={false} />
        </Card>
      )}

      {/* Actions & Signatures */}
      <Space>
        <Button type="primary" onClick={save} loading={saving}>保存提取记录</Button>
        {opSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setOpModal(true)}>操作人: {opSigner} ✓</Button> : <Button onClick={()=>setOpModal(true)}>操作人签名</Button>}
        {rvSigned ? <Button style={{color:"#52c41a",borderColor:"#52c41a"}} onClick={()=>setRvModal(true)}>复核人: {rvSigner} ✓</Button> : <Button onClick={()=>setRvModal(true)}>复核人签名</Button>}
      </Space>
      <NiptSignerModal open={opModal} role="operator" roleLabel="操作人" batchId={batch.id} currentSigner={opSigner||null} signUrl={`/runs/${batch.id}/extraction/sign/`} onDone={()=>{setOpModal(false);onRefresh()}} onCancel={()=>setOpModal(false)} />
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel="复核人" batchId={batch.id} currentSigner={rvSigner||null} signUrl={`/runs/${batch.id}/extraction/sign/`} onDone={()=>{setRvModal(false);onRefresh()}} onCancel={()=>setRvModal(false)} />
    </div>
  );
}
