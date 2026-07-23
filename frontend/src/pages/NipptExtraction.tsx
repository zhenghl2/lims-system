// NipptExtraction.tsx — DNA Extraction module (refactored: NIPT-style 3 methods)
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card, Table, Button, Tag, Tabs, Modal, message, Typography,
  Input, Select, InputNumber, Space, Popconfirm, Radio,
  Checkbox, Divider, Upload, Image, DatePicker, TimePicker, Form,
  Popover,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, CheckOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, DeleteOutlined,
  CameraOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text, Title } = Typography;
const { TextArea } = Input;

const EXTRACTION_METHODS = [
  { value: "MANUAL", label: "手工" },
  { value: "MAGNETIC_ROD", label: "磁棒法" },
  { value: "AUTOMATED", label: "自动化" },
];

const SAMPLE_TYPE_LABELS: Record<string, string> = {
  BLOOD: "血液", DBS: "血痕", HAIR: "毛发", NAIL: "指甲",
  SWAB: "口拭子", SEMEN: "精液", TOOTHBRUSH: "牙刷",
  CIGARETTE: "烟头", BOTTLE: "水瓶",
};

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
  case_sample_ids: string[]; test_sample_id: string | null;
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
}
interface BatchDetail extends BatchItem {
  female_samples: ExtractionSample[];
  male_blood_samples: ExtractionSample[];
  male_other_samples: ExtractionSample[];
  extraction_data: any;
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingSearch, setPendingSearch] = useState("");
  const [batchNumberPreview, setBatchNumberPreview] = useState("");
  const [qcSearch, setQcSearch] = useState("");
  const [qcCandidates, setQcCandidates] = useState<QCandidate[]>([]);
  const [selectedQC, setSelectedQC] = useState<QCandidate | null>(null);
  const [qcSearching, setQcSearching] = useState(false);

  // ── Extraction data (per-gender) ──
  const [femaleMethod, setFemaleMethod] = useState("");
  const [maleMethod, setMaleMethod] = useState("");
  const [extForm] = Form.useForm();
  const [stepConfirmations, setStepConfirmations] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  // sampleResults: { [sampleId]: { status: "pass"|"fail", note: string, concentration?: number } }
  const [femaleResults, setFemaleResults] = useState<Record<string, any>>({});
  const [maleResults, setMaleResults] = useState<Record<string, any>>({});
  // MAGNETIC_ROD state
  const [femaleSkipCoords, setFemaleSkipCoords] = useState<Record<number, string>>({});
  const [maleSkipCoords, setMaleSkipCoords] = useState<Record<number, string>>({});
  const [femaleKitTypes, setFemaleKitTypes] = useState<Record<number, string>>({});
  const [maleKitTypes, setMaleKitTypes] = useState<Record<number, string>>({});
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
      femaleMagneticNotes.current = fed.magnetic_notes || {};
      setFemaleManualNotes(fed.manual_notes || "");
      setFemaleAutoNotes(fed.auto_notes || "");
      // Male
      const med = ed.male || {};
      setMaleMethod(med.method || "");
      setMaleResults(med.sample_results || {});
      setMaleSkipCoords(med.plate_skip_coords || {});
      setMaleKitTypes(med.plate_kit_types || {});
      maleMagneticNotes.current = med.magnetic_notes || {};
      setMaleManualNotes(med.manual_notes || "");
      setMaleAutoNotes(med.auto_notes || "");
      // Shared
      setStepConfirmations(ed.step_confirmations || {});
      setPhotos(ed.photos || []);
      extForm.setFieldsValue({
        extraction_date: ed.extraction_date ? dayjs(ed.extraction_date) : dayjs(),
        extraction_time: ed.extraction_time ? dayjs(ed.extraction_time, "HH:mm") : dayjs(),
        equipment: ed.equipment || "", kit_type: ed.kit_type || undefined,
        reagent_lot: ed.reagent_lot || "",
        reagent_expiry: ed.reagent_expiry ? dayjs(ed.reagent_expiry) : undefined,
        temperature: ed.temperature ?? undefined, humidity: ed.humidity ?? undefined,
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
    if (!val.trim()) { setQcCandidates([]); return; }
    setQcSearching(true);
    try {
      const r = await (casesApi as any).getQCandidates(val);
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

  const toggleAll = (checked: boolean) => {
    if (!pendingData) return;
    if (checked) { const all = new Set<string>(); for (const e of pendingData.entries) for (const id of e.case_sample_ids) all.add(id); setSelectedKeys(all); }
    else { setSelectedKeys(new Set()); }
  };

  // ── Save / Complete / Delete ──
  const saveProcessing = async () => {
    if (!selectedBatch) return;
    try {
      const allSamples = [...selectedBatch.female_samples, ...selectedBatch.male_blood_samples, ...selectedBatch.male_other_samples]
        .map(s => ({ id: s.id, extraction_method: s.extraction_method, well_position: s.well_position,
          plasma_volume: s.plasma_volume, elution_volume: s.elution_volume,
          dna_concentration: s.dna_concentration, aliquot_tubes: s.aliquot_tubes,
          qc_status: s.qc_status, qc_note: s.qc_note }));
      const ed = {
        female: { method: femaleMethod, sample_results: femaleResults, plate_skip_coords: femaleSkipCoords,
          plate_kit_types: femaleKitTypes, magnetic_notes: femaleMagneticNotes.current,
          manual_notes: femaleManualNotes, auto_notes: femaleAutoNotes },
        male: { method: maleMethod, sample_results: maleResults, plate_skip_coords: maleSkipCoords,
          plate_kit_types: maleKitTypes, magnetic_notes: maleMagneticNotes.current,
          manual_notes: maleManualNotes, auto_notes: maleAutoNotes },
        ...extForm.getFieldsValue(), step_confirmations: stepConfirmations, photos,
      };
      await (casesApi as any).saveExtraction(selectedBatch.id, { samples: allSamples, extraction_data: ed });
      message.success("保存成功"); fetchDetail(selectedBatch.id);
    } catch { message.error("保存失败"); }
  };

  const completeBatch = async () => {
    if (!selectedBatch) return;
    try { await (casesApi as any).completeExtraction(selectedBatch.id); message.success("已完成"); setSelectedBatch(null); fetchBatches(); }
    catch { message.error("操作失败"); }
  };

  const deleteBatch = async (id: string) => {
    try { await (casesApi as any).deleteExtractionBatch(id); message.success("已删除"); setSelectedBatch(null); fetchBatches(); }
    catch (e: any) { message.error(e?.response?.data?.detail || "删除失败"); }
  };

  // ── Photo ──
  const handlePhoto = (file: File) => { const r = new FileReader(); r.onload = (e) => setPhotos(p => [...p, e.target?.result as string]); r.readAsDataURL(file); return false; };

  // ── Sample result helpers ──
  const setResult = (isFemale: boolean, sampleId: string, status: string, note: string, concentration?: number) => {
    const setter = isFemale ? setFemaleResults : setMaleResults;
    setter((prev: any) => ({ ...prev, [sampleId]: { status, note, ...(concentration !== undefined ? { concentration } : {}) } }));
  };

  const getResult = (isFemale: boolean, sampleId: string) => {
    return isFemale ? (femaleResults[sampleId] || { status: "pass", note: "" }) : (maleResults[sampleId] || { status: "pass", note: "" });
  };

  // ── Well label ──
  const getWellLabel = (s: ExtractionSample) => {
    if (s.is_qc) return `${s.test_sample_id || "QC"} 🔬`;
    const tid = s.test_sample_id || "?";
    if (s.category === "MALE_OTHER") {
      const est = (s as any).experiment_sample_type || "";
      const types = (s as any).sample_types || [];
      const st = est || (types.length ? types[0] : "");
      return `${tid}（${SAMPLE_TYPE_LABELS[st] || st || ""}）`;
    }
    return tid;
  };

  // ── Well Popover Cell ──
  const WellCell = ({ sample, isFemale }: { sample: ExtractionSample; isFemale: boolean }) => {
    if (!sample) return <td style={{ background: "#f0f0f0", width: 80, height: 42, textAlign: "center", fontSize: 11, color: "#bbb" }}>—</td>;
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
        <td style={{ background: bg, cursor: "pointer", width: 80, height: 42, textAlign: "center", fontSize: 11, color, padding: 2 }}>
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
  const buildMagneticPlates = (samples: ExtractionSample[], isFemale: boolean, skipCoords: Record<number, string>, kitTypes: Record<number, string>, setSkipCoords: any, setKitTypes: any, notesRef: any) => {
    const plates: { cells: { row: number; col: number; sampleIdx: number }[] }[] = [];
    let si = 0, pi = 0;
    while (si < samples.length) {
      const skips = skipCoords[pi] || "";
      const skipSet = new Set(skips.split(",").map((s: string) => s.trim().toUpperCase()).filter((s: string) => /^[A-H](1[0-2]|[1-9])$/.test(s)));
      const cells: { row: number; col: number; sampleIdx: number }[] = [];
      for (let r = 0; r < 8; r++) { if (!skipSet.has(`${ROWS_8[r]}1`) && si < samples.length) cells.push({ row: r, col: 1, sampleIdx: si++ }); }
      for (let r = 0; r < 8; r++) { if (!skipSet.has(`${ROWS_8[r]}7`) && si < samples.length) cells.push({ row: r, col: 7, sampleIdx: si++ }); }
      if (cells.length > 0) { plates.push({ cells }); pi++; } else break;
    }
    return (
      <div>
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
                  onChange={e => setSkipCoords((prev: any) => ({ ...prev, [pIdx]: e.target.value.toUpperCase() }))} style={{ width: 160 }} />
                <Select size="small" style={{ width: 90 }} placeholder="试剂盒" value={kitTypes[pIdx] || undefined}
                  onChange={(v: string) => setKitTypes((prev: any) => ({ ...prev, [pIdx]: v }))}
                  options={[{ value: "round", label: "圆底" }, { value: "conical", label: "锥底" }]} allowClear />
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
                                  value={v ?? undefined} placeholder="—"
                                  onChange={val => setResult(isFemale, pairSample.id, r.status || "pass", r.note || "", val ?? undefined)} />
                              </td>
                            );
                          }
                          return <td key={key} style={{ width: 80, height: 42, textAlign: "center", fontSize: 11, background: "#f0f0f0", color: "#bbb" }}>—</td>;
                        }
                        return <WellCell key={key} sample={sample!} isFemale={isFemale} />;
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
    manualNotes: string, setManualNotes: any, autoNotes: string, setAutoNotes: any) => {

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
            <Form form={extForm} layout="inline" style={{ flexWrap: "wrap", gap: 8 }}>
              <Form.Item name="extraction_date" label="日期"><DatePicker size="small" style={{ width: 130 }} /></Form.Item>
              <Form.Item name="extraction_time" label="时间"><TimePicker size="small" format="HH:mm" style={{ width: 100 }} /></Form.Item>
              <Form.Item name="equipment" label="设备"><Input size="small" style={{ width: 120 }} placeholder="设备编号" /></Form.Item>
              <Form.Item name="kit_type" label="试剂盒">
                <Select size="small" style={{ width: 120 }} placeholder="选择"
                  options={[{value:"QIAamp",label:"QIAamp"},{value:"MagMAX",label:"MagMAX"},{value:"NucleoSpin",label:"NucleoSpin"}]} allowClear />
              </Form.Item>
              <Form.Item name="reagent_lot" label="批号"><Input size="small" style={{ width: 100 }} placeholder="批号" /></Form.Item>
              <Form.Item name="reagent_expiry" label="有效期"><DatePicker size="small" style={{ width: 130 }} /></Form.Item>
              <Form.Item name="temperature" label="温度(℃)"><InputNumber size="small" style={{ width: 70 }} min={0} max={50} /></Form.Item>
              <Form.Item name="humidity" label="湿度(%)"><InputNumber size="small" style={{ width: 70 }} min={0} max={100} /></Form.Item>
            </Form>
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
                  if (r.category === "MALE_OTHER") {
                    return <InputNumber size="small" min={0} max={200} value={r.elution_volume || 30}
                      onChange={() => {}} style={{ width: 65 }} />;
                  }
                  return <span style={{ color: "#ccc" }}>—</span>;
                }},
                { title: "DNA浓度", key: "conc", width: 110, render: (_: any, r: ExtractionSample) => {
                  const res = getResult(isFemale, r.id);
                  const v = res.concentration ?? r.dna_concentration;
                  return <InputNumber size="small" min={0} step={0.1} style={{ width: 80 }}
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
          buildMagneticPlates(samples, isFemale, skipCoords, kitTypes, setSkipCoords, setKitTypes, notesRef)
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

  // ── Sidebar columns ──
  const batchColumns = [
    { title: "批次号", dataIndex: "batch_number", key: "bn", width: 140, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: "状态", dataIndex: "status", key: "st", width: 60,
      render: (v: string) => { const c: Record<string,string>={DRAFT:"default",IN_PROGRESS:"blue",COMPLETED:"green"}; const l: Record<string,string>={DRAFT:"待处理",IN_PROGRESS:"处理中",COMPLETED:"已完成"}; return <Tag color={c[v]||"default"}>{l[v]||v}</Tag>; }},
    { title: "样本", key: "cnt", width: 100, render: (_: any, r: BatchItem) => <Text style={{ fontSize: 11 }}>👩{r.female_count} 👨{r.male_blood_count + r.male_other_count}</Text> },
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
          <Card size="small" title={<Space><Text strong>{selectedBatch.batch_number}</Text>
            <Tag color={selectedBatch.status === "COMPLETED" ? "green" : selectedBatch.status === "IN_PROGRESS" ? "blue" : "default"}>{selectedBatch.status_display}</Tag></Space>}
            extra={<Space>
              {selectedBatch.status !== "COMPLETED" && (
                <Popconfirm title="确定删除该批次？管数将恢复" onConfirm={() => deleteBatch(selectedBatch.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
              )}
              <Button icon={<ReloadOutlined />} size="small" loading={batchLoading} onClick={() => fetchDetail(selectedBatch.id)}>刷新</Button>
              {selectedBatch.status !== "COMPLETED" && (<>
                <Button type="primary" icon={<CheckOutlined />} size="small" onClick={saveProcessing}>保存</Button>
                <Popconfirm title="确定完成该批次？" onConfirm={completeBatch}><Button type="primary" size="small" danger>完成批次</Button></Popconfirm>
              </>)}
            </Space>}>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
              { key: "female", label: `👩 女性 (${selectedBatch.female_count})`,
                children: renderExtractionTab(selectedBatch.female_samples, true, femaleMethod, setFemaleMethod,
                  femaleSkipCoords, setFemaleSkipCoords, femaleKitTypes, setFemaleKitTypes, femaleMagneticNotes,
                  femaleManualNotes, setFemaleManualNotes, femaleAutoNotes, setFemaleAutoNotes) },
              { key: "male", label: `👨 男性 (${selectedBatch.male_blood_count + selectedBatch.male_other_count})`,
                children: renderExtractionTab([...selectedBatch.male_blood_samples, ...selectedBatch.male_other_samples], false, maleMethod, setMaleMethod,
                  maleSkipCoords, setMaleSkipCoords, maleKitTypes, setMaleKitTypes, maleMagneticNotes,
                  maleManualNotes, setMaleManualNotes, maleAutoNotes, setMaleAutoNotes) },
            ]} />
            <Divider style={{ margin: "12px 0" }} />
            <Card size="small" title="📷 实验照片">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {photos.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 104, height: 104 }}>
                    <Image src={url} width={104} height={104} style={{ objectFit: "cover", borderRadius: 4 }} />
                    <Button type="text" danger size="small" style={{ position: "absolute", top: -8, right: -8, background: "#fff", borderRadius: "50%" }}
                      onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                ))}
                <Upload beforeUpload={f => { handlePhoto(f); return false; }} showUploadList={false} accept="image/*">
                  <div style={{ width: 104, height: 104, border: "1px dashed #d9d9d9", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <CameraOutlined style={{ fontSize: 24, color: "#999" }} /><Text type="secondary" style={{ fontSize: 11 }}>拍照/上传</Text></div>
                </Upload>
              </div>
            </Card>
          </Card>
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
          <Input.Search placeholder="搜索姓名/PT号/Case号..." allowClear value={pendingSearch} onChange={(e: any) => setPendingSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space><Tag color="magenta">👩 女性: {pendingData.female_count}</Tag><Tag color="blue">👨 男性: {pendingData.male_blood_count + pendingData.male_other_count}</Tag></Space>
            <Space><Button size="small" onClick={() => toggleAll(true)}>全选</Button><Button size="small" onClick={() => toggleAll(false)}>取消全选</Button></Space></div>
          <Divider style={{ margin: "8px 0" }} />
          <div style={{ maxHeight: 300, overflow: "auto", marginBottom: 16 }}>
            {(["FEMALE_BLOOD","MALE_BLOOD","MALE_OTHER"] as const).map(cat => {
              const entries = pendingData.entries.filter((e: any) => e.category === cat && (!pendingSearch || e.patient_name.includes(pendingSearch) || e.case_number.includes(pendingSearch) || (e.test_sample_id||"").includes(pendingSearch)));
              if (!entries.length) return null;
              const labels: Record<string,string> = {FEMALE_BLOOD:"👩 女性",MALE_BLOOD:"🩸 男性血液",MALE_OTHER:"🧬 男性其他"};
              return (<div key={cat} style={{ marginBottom: 8 }}><Text strong style={{ fontSize: 13 }}>{labels[cat]} ({entries.length})</Text>
                {entries.map((e: any) => {
                  const allIn = e.case_sample_ids.every((id: string) => selectedKeys.has(id));
                  const someIn = e.case_sample_ids.some((id: string) => selectedKeys.has(id));
                  return (<div key={e.case_sample_ids.join(",")} style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
                    <Checkbox checked={allIn} indeterminate={!allIn && someIn} onChange={() => { setSelectedKeys(prev => { const next = new Set(prev); if (allIn) e.case_sample_ids.forEach((id: string) => next.delete(id)); else e.case_sample_ids.forEach((id: string) => next.add(id)); return next; }); }} />
                    <Text code style={{ fontSize: 11, width: 150 }}>{e.case_number}</Text>{e.test_sample_id && <Tag color="blue" style={{ fontSize: 11 }}>{e.test_sample_id}</Tag>}
                    <Text strong>{e.patient_name}</Text><Space size={2} wrap>{e.sample_types.map((t: string) => <Tag key={t} color="green" style={{ fontSize: 10 }}>{SAMPLE_TYPE_LABELS[t]||t}</Tag>)}</Space></div>);})}</div>);})}
          </div>
          <Divider style={{ margin: "8px 0" }} />
          <div style={{ padding: "8px 12px", background: "#fffbe6", borderRadius: 6 }}>
            <Text strong>🔬 添加质控样本（可选）</Text>
            <Input.Search placeholder="搜索已完成前处理的女性样本..." allowClear value={qcSearch} onChange={(e: any) => searchQC(e.target.value)} loading={qcSearching} style={{ marginTop: 8, marginBottom: 8 }} />
            {qcCandidates.length > 0 && (<div style={{ marginBottom: 8 }}>{qcCandidates.map(qc => (
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
