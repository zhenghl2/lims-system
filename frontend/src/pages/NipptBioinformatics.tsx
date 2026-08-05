// NipptBioinformatics.tsx — NIPPT Bioinformatics (Pair-based CPI Analysis + QC + Metrics)
import { useState, useEffect, useCallback } from "react";
import { Card, Table, Button, Tag, Modal, message, Typography, InputNumber,
  Space, Popconfirm, Select, Alert, Input, Upload } from "antd";
import { PlusOutlined, ReloadOutlined, CheckOutlined, DeleteOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, SwapOutlined, LinkOutlined,
  DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import api from "../api/client";
const { Text, Title } = Typography;

interface BatchItem {
  id: string; batch_number: string; status: string; status_display: string;
  pair_count: number; completed_pair_count: number; sample_count: number; created_at: string;
}
interface PairItem {
  id: string; case_number: string; pt_number: string;
  mother_name: string; mother_index: string;
  father_name: string; father_index: string; father_sample_type: string;
  father_label: string; is_cross_batch: boolean;
  mother_source_batch: string; father_source_batch: string;
  cpi: number | null; result: string; note: string;
  qc_flag: string; qc_flag_display: string;
  mother_layers: number | null; mother_concentration: number | null;
  mother_het_ratio: number | null; mother_y_ratio: number | null;
  father_layers: number | null; father_concentration: number | null;
  father_het_ratio: number | null; father_y_ratio: number | null;
}
interface SampleItem {
  id: string; patient_name: string; test_sample_id: string | null;
  index: string; sample_type: string; role: string;
  case_number: string; pt_number: string;
}

const QC_FLAG_OPTIONS = [
  { label: "", value: "" },
  { label: "男性层数低", value: "MALE_LOW_LAYERS" },
  { label: "女性层数低", value: "FEMALE_LOW_LAYERS" },
  { label: "男性污染", value: "MALE_CONTAM" },
  { label: "女性污染", value: "FEMALE_CONTAM" },
  { label: "胎儿浓度低", value: "FETAL_LOW_CONC" },
  { label: "其他异常", value: "OTHER" },
];

export default function NipptBioinformatics() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingInfo, setPendingInfo] = useState<any>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedHsBatch, setSelectedHsBatch] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [editingPairs, setEditingPairs] = useState<Record<string, any>>({});
  const [editingSamples, setEditingSamples] = useState<Record<string, any>>({});
  const [manualPairMother, setManualPairMother] = useState<Record<string, string>>({});
  const [manualPairFather, setManualPairFather] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<any>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get("/cases/bioinfo/"); setBatches(res.data?.results || []); } catch (_e) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchDetail = async (id: string) => {
    setBatchLoading(true);
    try {
      const res = await api.get(`/cases/bioinfo/${id}/`);
      setSelectedBatch(res.data); setEditingPairs({}); setEditingSamples({});
      setManualPairMother({}); setManualPairFather({});
    } catch (_e) { message.error("Failed to load detail"); }
    setBatchLoading(false);
  };

  const openCreate = async () => {
    setCreateModalOpen(true); setPendingLoading(true);
    try { const res = await api.get("/cases/bioinfo/pending_info/"); setPendingInfo(res.data); if (res.data.available) setSelectedHsBatch(res.data.primary_batch.id); } catch (_e) { message.error("Failed"); }
    setPendingLoading(false);
  };

  const handleCreate = async () => {
    try {
      const payload: any = {}; if (selectedHsBatch) payload.hybseq_batch_id = selectedHsBatch;
      await api.post("/cases/bioinfo/", payload); message.success("Batch created"); setCreateModalOpen(false); fetchBatches();
    } catch (e: any) { message.error(e.response?.data?.hybseq_batch_id || "Create failed"); }
  };

  const handleSampleEdit = (sampleId: string, field: string, value: any) => {
    setEditingSamples(prev => ({ ...prev, [sampleId]: { ...(prev[sampleId] || {}), [field]: value } }));
  };

  const handlePairEdit = (pairId: string, field: string, value: any) => {
    setEditingPairs(prev => ({ ...prev, [pairId]: { ...(prev[pairId] || {}), [field]: value } }));
  };

  const handleSave = async () => {
    if (!selectedBatch) return;
    const pairIds = Object.keys(editingPairs);
    if (pairIds.length === 0) { message.info("No changes"); return; }
    setSaving(true);
    try {
      const pairs = pairIds.map(id => ({ id, ...editingPairs[id] }));
      const sampleIds = Object.keys(editingSamples);
      const samples = sampleIds.map(id => ({ id, ...editingSamples[id] }));
      await api.post(`/cases/bioinfo/${selectedBatch.id}/save_processing/`, { pairs, samples });
      message.success("Saved"); setEditingPairs({}); fetchDetail(selectedBatch.id);
    } catch (e: any) { message.error(e.response?.data?.error || "Save failed"); }
    setSaving(false);
  };

  const handleComplete = async () => {
    if (!selectedBatch) return;
    const pairs = selectedBatch.pairs || [];
    const empty = pairs.filter((p: PairItem) => !editingPairs[p.id]?.result && !p.result);
    if (empty.length > 0) { message.warning(`${empty.length} pair(s) missing result`); return; }
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/complete/`);
      message.success(`Completed ${pairs.length} pairs`); setSelectedBatch(null); fetchBatches();
    } catch (e: any) { message.error(e.response?.data?.error || "Complete failed"); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/cases/bioinfo/${id}/`); message.success("Deleted"); if (selectedBatch?.id === id) setSelectedBatch(null); fetchBatches(); }
    catch (e: any) { message.error(e.response?.data?.detail || "Delete failed"); }
  };

  const handleManualPair = async (motherId: string | null, fatherId: string | null) => {
    if (!selectedBatch || (!motherId && !fatherId)) return;
    const mid = motherId || manualPairMother[fatherId || ""];
    const fid = fatherId || manualPairFather[motherId || ""];
    if (!mid || !fid) { message.warning("Select both"); return; }
    try {
      await api.post(`/cases/bioinfo/${selectedBatch.id}/add_manual_pair/`, { mother_sample_id: mid, father_sample_id: fid });
      message.success("Pair added");
      if (motherId) { const m = { ...manualPairFather }; delete m[motherId]; setManualPairFather(m); }
      else { const m = { ...manualPairMother }; delete m[fatherId || ""]; setManualPairMother(m); }
      fetchDetail(selectedBatch.id);
    } catch (e: any) { message.error(e.response?.data?.error || "Failed"); }
  };

  const handleImport = async (file: File) => {
    if (!selectedBatch) return false;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api.post(`/cases/bioinfo/${selectedBatch.id}/import_cpi/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(res.data); setImportModalOpen(true); fetchDetail(selectedBatch.id);
    } catch (e: any) { message.error(e.response?.data?.error || "Import failed"); }
    return false; // Prevent default upload
  };

  const downloadTemplate = () => {
    if (!selectedBatch) return;
    window.open(`/api/v1/cases/bioinfo/${selectedBatch.id}/export_template/`);
  };

  // Compact metric input renderer
  const metricInput = (pairId: string, field: string, v: any) => (
    <InputNumber size="small" style={{ width: 60 }}
      value={editingPairs[pairId]?.[field] !== undefined ? editingPairs[pairId][field] : v}
      onChange={(val) => handlePairEdit(pairId, field, val)} />
  );

  const batchColumns = [
    { title: "Batch #", dataIndex: "batch_number", key: "bn", ellipsis: true },
    { title: "", dataIndex: "status", key: "st", width: 55,
      render: (v: string) => <Tag color={v === "COMPLETED" ? "green" : "blue"} style={{ margin: 0 }} /> },
    { title: "Pairs", dataIndex: "pair_count", key: "pc", width: 42, align: "center" as const },
  ];

  const pairColumns = [
    { title: "Case#", dataIndex: "case_number", key: "c", width: 140, ellipsis: true },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 85 },
    { title: "来源", dataIndex: "case_source", key: "src2", width: 70, render: (v: string) => <Text style={{fontSize:12}}>{v || "—"}</Text> },
    { title: "Mother", key: "m", width: 130,
      render: (_: any, r: PairItem) => <Text>{r.mother_name}{r.mother_index ? <Text type="secondary" style={{fontSize:11}}> ({r.mother_index})</Text> : ""}</Text> },
    { title: "Father", key: "f", width: 145,
      render: (_: any, r: PairItem) => {
        const parts: string[] = [];
        if (r.father_index) parts.push(r.father_index);
        if (r.father_sample_type) parts.push(r.father_sample_type);
        return <Text>{r.father_name}{parts.length ? <Text type="secondary" style={{fontSize:11}}> ({parts.join(", ")})</Text> : ""}</Text>;
      }},
    { title: "", dataIndex: "father_label", key: "lbl", width: 42, render: (v: string) => <Tag style={{margin:0}}>{v}</Tag> },
    { title: "", key: "src", width: 55,
      render: (_: any, r: PairItem) => r.is_cross_batch
        ? <Tag icon={<SwapOutlined />} color="orange" style={{margin:0}} />
        : <Tag icon={<LinkOutlined />} color="green" style={{margin:0}}>{r.mother_source_batch?.slice(-6)}</Tag> },
    // Mother metrics
    { title: "M.Layers", key: "ml", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "mother_layers", r.mother_layers) },
    { title: "M.Conc", key: "mc", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "mother_concentration", r.mother_concentration) },
    { title: "M.Het", key: "mh", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "mother_het_ratio", r.mother_het_ratio) },
    { title: "M.Y", key: "my", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "mother_y_ratio", r.mother_y_ratio) },
    // Father metrics
    { title: "F.Layers", key: "fl", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "father_layers", r.father_layers) },
    { title: "F.Conc", key: "fc", width: 70, render: (_: any, r: PairItem) => metricInput(r.id, "father_concentration", r.father_concentration) },
    { title: "F.Het", key: "fh", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "father_het_ratio", r.father_het_ratio) },
    { title: "F.Y", key: "fy", width: 65, render: (_: any, r: PairItem) => metricInput(r.id, "father_y_ratio", r.father_y_ratio) },
    // CPI + Result
    { title: "CPI", dataIndex: "cpi", key: "cpi", width: 110,
      render: (v: any, r: PairItem) => <InputNumber size="small" style={{width:100}}
        value={editingPairs[r.id]?.cpi !== undefined ? editingPairs[r.id].cpi : v}
        onChange={(val) => handlePairEdit(r.id, "cpi", val)} placeholder="99.99" /> },
    { title: "Result", dataIndex: "result", key: "res", width: 135,
      render: (v: string, r: PairItem) => {
        const val = editingPairs[r.id]?.result !== undefined ? editingPairs[r.id].result : v;
        return <Select size="small" style={{width:125}} value={val || undefined}
          onChange={(val) => handlePairEdit(r.id, "result", val)} placeholder="Select..."
          options={[
            { label: <Text type="success">Support</Text>, value: "INCLUSION" },
            { label: <Text type="danger">Exclusion</Text>, value: "EXCLUSION" },
            { label: <Text type="warning">Inconclusive</Text>, value: "INCONCLUSIVE" },
          ]} />; }},
    { title: "Note", dataIndex: "note", key: "nt", width: 120,
      render: (v: string, r: PairItem) => <Input size="small"
        value={editingPairs[r.id]?.note !== undefined ? editingPairs[r.id].note : v || ""}
        onChange={(e) => handlePairEdit(r.id, "note", e.target.value)} placeholder="Note" /> },
    { title: "QC", dataIndex: "qc_flag", key: "qc", width: 120,
      render: (v: string, r: PairItem) => (
        <Select size="small" style={{width:110}} value={v || undefined} allowClear placeholder="Normal"
          onChange={(val) => handlePairEdit(r.id, "qc_flag", val || "")}
          options={QC_FLAG_OPTIONS.map(o => ({ label: o.label || "Normal", value: o.value }))} />
      )},
  ];

  const unpairedMothers: SampleItem[] = selectedBatch?.unpaired_mothers || [];
  const unpairedFathers: SampleItem[] = selectedBatch?.unpaired_fathers || [];
  const maxUnpaired = Math.max(unpairedMothers.length, unpairedFathers.length);
  const unpairedRows: any[] = [];
  for (let i = 0; i < maxUnpaired; i++) unpairedRows.push({ key: `up-${i}`, mother: unpairedMothers[i] || null, father: unpairedFathers[i] || null });
  const hasUnpaired = unpairedRows.length > 0;

  const emptyText = <Text type="secondary" style={{fontSize:12}}>—</Text>;

  const unpairedColumns = [
    { title: "Case#", key: "uc", width: 140, render: (_:any,r:any)=>{const s=r.mother||r.father;return s?<Text>{s.case_number||"—"}</Text>:emptyText}},
    { title: "PT#", key: "upt", width: 85, render: (_:any,r:any)=>{const s=r.mother||r.father;return s?<Text>{s.pt_number||"—"}</Text>:emptyText}},
    { title: "来源", key: "usrc", width: 70, render: () => emptyText },
    { title: "Mother", key: "um", width: 130,
      render: (_: any, r: any) => r.mother ? <Text>{r.mother.patient_name}<Text type="secondary" style={{fontSize:11}}>{r.mother.index ? ` (${r.mother.index})` : ""}</Text></Text> : emptyText },
    { title: "Father", key: "uf", width: 145,
      render: (_: any, r: any) => r.father ? <Text>{r.father.patient_name}<Text type="secondary" style={{fontSize:11}}>{r.father.index ? ` (${r.father.index}` : ""}{r.father.sample_type ? `, ${r.father.sample_type})` : r.father.index ? ")" : ""}</Text></Text> : emptyText },
    { title: "", key: "ul", width: 42, render: () => emptyText },
    { title: "", key: "us", width: 55, render: () => emptyText },
    { title: "M.Layers", key: "uml", width: 70, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.mother.id]?.layers} onChange={(v) => handleSampleEdit(r.mother.id, "layers", v)} /> : emptyText },
    { title: "M.Conc", key: "umc", width: 70, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.mother.id]?.concentration} onChange={(v) => handleSampleEdit(r.mother.id, "concentration", v)} /> : emptyText },
    { title: "M.Het", key: "umh", width: 65, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.mother.id]?.het_ratio} onChange={(v) => handleSampleEdit(r.mother.id, "het_ratio", v)} /> : emptyText },
    { title: "M.Y", key: "umy", width: 65, render: (_: any, r: any) => r.mother ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.mother.id]?.y_ratio} onChange={(v) => handleSampleEdit(r.mother.id, "y_ratio", v)} /> : emptyText },
    { title: "F.Layers", key: "ufl", width: 70, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.father.id]?.layers} onChange={(v) => handleSampleEdit(r.father.id, "layers", v)} /> : emptyText },
    { title: "F.Conc", key: "ufc", width: 70, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.father.id]?.concentration} onChange={(v) => handleSampleEdit(r.father.id, "concentration", v)} /> : emptyText },
    { title: "F.Het", key: "ufh", width: 65, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.father.id]?.het_ratio} onChange={(v) => handleSampleEdit(r.father.id, "het_ratio", v)} /> : emptyText },
    { title: "F.Y", key: "ufy", width: 65, render: (_: any, r: any) => r.father ? <InputNumber size="small" style={{width:60}} value={editingSamples[r.father.id]?.y_ratio} onChange={(v) => handleSampleEdit(r.father.id, "y_ratio", v)} /> : emptyText },
    { title: "CPI", key: "ucpi", width: 110, render: () => emptyText },
    { title: "Result", key: "ures", width: 135, render: () => emptyText },
    { title: "Note", key: "unt", width: 120, render: () => emptyText },
    { title: "QC", key: "uqc", width: 120, render: (_: any, r: any) => {
      const sid = r.mother?.id || r.father?.id;
      if (!sid) return emptyText;
      const val = editingSamples[sid]?.qc_flag;
      return <Select size="small" style={{width:110}} value={val || undefined} allowClear placeholder="Normal"
        onChange={(v) => handleSampleEdit(sid, "qc_flag", v || "")}
        options={QC_FLAG_OPTIONS.map(o => ({ label: o.label || "Normal", value: o.value }))} />;
    }},
    { title: "", key: "ua", width: 260,
      render: (_: any, r: any) => {
        if (r.mother && !r.father) {
          const fatherOpts = unpairedFathers.map((f: SampleItem) => ({ label: `${f.patient_name}${f.index ? ` (${f.index})` : ""}${f.sample_type ? `, ${f.sample_type}` : ""}`, value: f.id }));
          return <Space><Select size="small" style={{width:160}} placeholder="Select Father" value={manualPairFather[r.mother.id] || undefined}
            onChange={(v) => setManualPairFather({ ...manualPairFather, [r.mother.id]: v })} options={fatherOpts} />
            <Button size="small" type="primary" onClick={() => handleManualPair(r.mother.id, null)}>Pair</Button></Space>; }
        if (r.father && !r.mother) {
          const motherOpts = unpairedMothers.map((m: SampleItem) => ({ label: `${m.patient_name}${m.index ? ` (${m.index})` : ""}`, value: m.id }));
          return <Space><Select size="small" style={{width:160}} placeholder="Select Mother" value={manualPairMother[r.father.id] || undefined}
            onChange={(v) => setManualPairMother({ ...manualPairMother, [r.father.id]: v })} options={motherOpts} />
            <Button size="small" type="primary" onClick={() => handleManualPair(null, r.father.id)}>Pair</Button></Space>; }
        return null; }},
  ];

  const totalPairs = selectedBatch?.pair_count || 0;

  return (
    <div style={{ display: "flex", gap: 16, padding: 16, height: "calc(100vh - 80px)" }}>
      {/* LEFT: Batch List */}
      <Card size="small"
        style={{ width: sidebarCollapsed ? 48 : 380, flexShrink: 0, transition: "width 0.25s", overflow: "hidden", display: "flex", flexDirection: "column" }}
        title={sidebarCollapsed ? undefined : <Title level={5} style={{margin:0}}>Bioinformatics</Title>}
        extra={<Button type="text" size="small" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}
        bodyStyle={{ padding: sidebarCollapsed ? 4 : 16, flex: 1, overflow: "auto" }}>
        {!sidebarCollapsed && (<>
          <Space style={{ marginBottom: 12 }}><Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>New Batch</Button><Button size="small" icon={<ReloadOutlined />} onClick={fetchBatches} /></Space>
          <Table dataSource={batches} columns={batchColumns} rowKey="id" loading={loading} size="small" showHeader={false} pagination={{ pageSize: 20, size: "small" }}
            onRow={(r: BatchItem) => ({ onClick: () => fetchDetail(r.id), style: { background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined, cursor: "pointer" } })} />
        </>)}
      </Card>

      {/* RIGHT: Detail */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedBatch ? (
          <Card size="small"
            title={<Space><Text strong>{selectedBatch.batch_number}</Text><Tag color={selectedBatch.status === "COMPLETED" ? "green" : "blue"}>{selectedBatch.status_display}</Tag>
              <Text type="secondary" style={{fontSize:12}}>Pairs: {totalPairs} | CPI: {selectedBatch.pairs?.filter((p:any)=>p.result).length}/{totalPairs}
                {selectedBatch.bioinfo_data?.cross_batch_count > 0 && ` | Cross: ${selectedBatch.bioinfo_data.cross_batch_count}`}</Text></Space>}
            extra={<Space>
              <Button icon={<ReloadOutlined />} size="small" loading={batchLoading} onClick={() => fetchDetail(selectedBatch.id)}>Refresh</Button>
              <Button icon={<DownloadOutlined />} size="small" onClick={downloadTemplate}>Template</Button>
              <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(f) => { handleImport(f as File); return false; }}>
                <Button icon={<UploadOutlined />} size="small">Import</Button>
              </Upload>
              {selectedBatch.status !== "COMPLETED" && <Popconfirm title="Delete?" onConfirm={() => handleDelete(selectedBatch.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
            </Space>}>
            <Table dataSource={selectedBatch.pairs || []} columns={pairColumns} rowKey="id" size="small" pagination={false} loading={batchLoading} scroll={{ x: 1800 }} style={{ marginBottom: hasUnpaired ? 12 : 0 }} />

            {hasUnpaired && selectedBatch.status !== "COMPLETED" && (
              <Card size="small" title={<Text type="warning">Unpaired Samples ({unpairedRows.length})</Text>} style={{ marginBottom: 12 }}>
                <Table dataSource={unpairedRows} columns={unpairedColumns} rowKey="key" size="small" pagination={false} />
              </Card>)}

            {selectedBatch.status !== "COMPLETED" && (
              <Space style={{ marginTop: 16 }}>
                <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={handleSave}>Save</Button>
                <Button icon={<CheckOutlined />} onClick={handleComplete}>Complete Batch</Button>
              </Space>)}
            {selectedBatch.status === "COMPLETED" && <Alert type="success" message="Batch completed" showIcon style={{ marginTop: 16 }} />}
          </Card>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}><Title level={5} type="secondary">Select a batch</Title><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New Batch</Button></div>)}
      </div>

      {/* Create Modal */}
      <Modal title="New Bioinformatics Batch" open={createModalOpen} onOk={handleCreate} onCancel={() => setCreateModalOpen(false)} okText="Create" confirmLoading={pendingLoading}>
        {pendingLoading ? <Text type="secondary">Loading...</Text> : pendingInfo?.available ? (<>
          <Text strong>Primary HybSeq Batch: </Text><Tag color="blue">{pendingInfo.primary_batch.batch_number}</Tag><Text type="secondary"> ({pendingInfo.primary_batch.sample_count} samples)</Text><br /><br />
          <Text>In-batch: {pendingInfo.pairing_summary.batch_internal_pairs} pairs ({pendingInfo.pairing_summary.batch_internal_cases} cases)</Text><br /><br />
          <Text strong>Or select another:</Text>
          <Select style={{ width: "100%", marginTop: 8 }} value={selectedHsBatch} onChange={setSelectedHsBatch} options={(pendingInfo.all_hybseq_batches || []).map((b: any) => ({ label: b.batch_number, value: b.id }))} /></>) : <Alert type="warning" message="No completed HybSeq batches." />}
      </Modal>

      {/* Import Result Modal */}
      <Modal title="Import Result" open={importModalOpen} onOk={() => setImportModalOpen(false)} onCancel={() => setImportModalOpen(false)} footer={<Button type="primary" onClick={() => setImportModalOpen(false)}>OK</Button>}>
        {importResult && (<>
          <Text>Updated: <Text strong style={{color:"#52c41a"}}>{importResult.updated}</Text> | Skipped: <Text strong style={{color:"#faad14"}}>{importResult.skipped}</Text> | Total: {importResult.total_rows}</Text>
          {importResult.errors?.length > 0 && (<>
            <Alert type="warning" message={`${importResult.errors.length} error(s)`} style={{marginTop:12}} />
            <ul style={{maxHeight:200,overflow:"auto",marginTop:8}}>{importResult.errors.map((e:string,i:number) => <li key={i} style={{fontSize:12}}>{e}</li>)}</ul></>)}
        </>)}
      </Modal>
    </div>
  );
}
