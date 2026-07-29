// NipptPreProcessing.tsx — NIPPT 前处理模块
import { useState, useEffect, useCallback } from "react";
import {
  Card, Table, Button, Tag, Tabs, Modal, message, Typography,
  Input, Select, InputNumber, Space, Popconfirm,
  Checkbox, Divider, Upload, Image,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, CheckOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  CameraOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";

const { Text, Title } = Typography;

const SAMPLE_TYPE_OPTIONS = [
  { value: "BLOOD", label: "血液" },
  { value: "DBS", label: "血痕" },
  { value: "HAIR", label: "毛发" },
  { value: "NAIL", label: "指甲" },
  { value: "SWAB", label: "口拭子" },
  { value: "SEMEN", label: "精液" },
  { value: "TOOTHBRUSH", label: "牙刷" },
  { value: "CIGARETTE", label: "烟头" },
  { value: "BOTTLE", label: "水瓶" },
];

const CONDITION_OPTIONS = [
  { value: "OK", label: "合格" },
  { value: "HEMOLYZED", label: "融血" },
  { value: "LOW_VOLUME", label: "体积不足" },
  { value: "OTHER", label: "其他" },
];

interface PendingEntry {
  case_id: string;
  case_number: string;
  patient_name: string;
  role: string;
  category: string;
  sample_types: string[];
  case_sample_ids: string[];
  test_sample_id: string | null;
}

interface PreSample {
  id: string;
  patient_name: string;
  role: string;
  category: string;
  case_sample_ids: string[];
  sample_condition: string;
  aliquot_tubes: number;
  plasma_volume: number | null;
  experiment_sample_type: string;
  elution_volume: number | null;
  dna_concentration: number | null;
  qc_status: string;
  qc_note: string;
  test_sample_id: string | null;
  received_sample_types: string[];
  remaining_sample_types: string[];
}

interface BatchItem {
  id: string;
  batch_number: string;
  status: string;
  status_display: string;
  sample_count: number;
  female_count: number;
  male_blood_count: number;
  male_other_count: number;
  created_at: string;
}

interface BatchDetail extends BatchItem {
  female_samples: PreSample[];
  male_blood_samples: PreSample[];
  male_other_samples: PreSample[];
  processing_data: any;
}

export default function NipptPreProcessing() {
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // New batch modal
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<{
    female_count: number; male_blood_count: number; male_other_count: number;
    total_pending: number; entries: PendingEntry[];
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pendingSearch, setPendingSearch] = useState("");
  const [batchNumberPreview, setBatchNumberPreview] = useState("");

  // Active tab
  const [activeTab, setActiveTab] = useState("female");

  // Photo upload
  const [photos, setPhotos] = useState<string[]>([]);

  // ===== Data fetching =====
  const deleteBatch = async (id: string, batchNumber: string) => {
    try {
      await (casesApi as any).deletePreprocessingBatch(id);
      message.success(`批次 ${batchNumber} 已删除`);
      setSelectedBatch(null);
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "删除失败");
    }
  };

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await (casesApi as any).listPreprocessingBatches();
      setBatches(res.data?.results || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const autoFillExperimentType = (batch: any) => {
    const allSamples = [...(batch.female_samples || []), ...(batch.male_other_samples || []), ...(batch.male_blood_samples || [])];
    for (const s of allSamples) {
      if (s.experiment_sample_type) continue;
      const types = s.received_sample_types || [];
      if (types.length === 1) {
        s.experiment_sample_type = types[0];
        s.remaining_sample_types = [];
      } else if (types.length > 1 && types.includes("BLOOD")) {
        s.experiment_sample_type = "BLOOD";
        s.remaining_sample_types = types.filter((t: string) => t !== "BLOOD");
      }
      // other cases: leave empty for operator
    }
  };

  const fetchDetail = async (id: string) => {
    setBatchLoading(true);
    try {
      const res = await (casesApi as any).getPreprocessingBatch(id);
      autoFillExperimentType(res.data);
      setSelectedBatch(res.data);
      // Load saved photos
      setPhotos(res.data?.processing_data?.photos || []);
    } catch {
      message.error("加载批次详情失败");
    } finally {
      setBatchLoading(false);
    }
  };

  // ===== New batch =====
  const openNewBatch = async () => {
    try {
      const res = await (casesApi as any).pendingPreprocessing();
      const data = res.data;
      setPendingData(data);
      // Default: select all
      const allIds = new Set<string>();
      for (const e of data.entries) {
        for (const id of e.case_sample_ids) allIds.add(id);
      }
      setSelectedKeys(allIds);
      setPendingSearch("");
      // Generate batch number preview
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const h = String(now.getHours()).padStart(2, "0");
      const prefix = `${y}${m}${d}-${h}`;
      // Count existing batches with this prefix
      try {
        const br = await (casesApi as any).listPreprocessingBatches({ search: prefix });
        const cnt = (br.data?.results || []).filter((b: any) => b.batch_number.startsWith(prefix)).length;
        setBatchNumberPreview(`${prefix}-${String(cnt + 1).padStart(3, "0")}`);
      } catch {
        setBatchNumberPreview(`${prefix}-001`);
      }
      setModalOpen(true);
    } catch {
      message.error("加载待处理样本失败");
    }
  };

  const createBatch = async () => {
    if (selectedKeys.size === 0) {
      message.warning("请至少选择一个样本");
      return;
    }
    try {
      const res = await (casesApi as any).createPreprocessingBatch({
        case_sample_ids: Array.from(selectedKeys),
      });
      message.success(`批次 ${res.data.batch_number} 已创建`);
      setModalOpen(false);
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "创建失败");
    }
  };

  const toggleAll = (checked: boolean) => {
    if (!pendingData) return;
    if (checked) {
      const all = new Set<string>();
      for (const e of pendingData.entries) {
        for (const id of e.case_sample_ids) all.add(id);
      }
      setSelectedKeys(all);
    } else {
      setSelectedKeys(new Set());
    }
  };

  // ===== Save & Complete =====
  const saveProcessing = async () => {
    if (!selectedBatch) return;
    try {
      const allSamples = [
        ...selectedBatch.female_samples,
        ...selectedBatch.male_blood_samples,
        ...selectedBatch.male_other_samples,
      ].map(s => ({
        id: s.id,
        sample_condition: s.sample_condition,
        aliquot_tubes: s.aliquot_tubes,
        plasma_volume: s.plasma_volume,
        experiment_sample_type: s.experiment_sample_type,
        elution_volume: s.elution_volume,
        dna_concentration: s.dna_concentration,
        qc_status: s.qc_status,
        qc_note: s.qc_note,
      }));
      await (casesApi as any).savePreprocessing(selectedBatch.id, {
        samples: allSamples,
        processing_data: { ...selectedBatch.processing_data, photos },
      });
      message.success("保存成功");
      fetchDetail(selectedBatch.id);
    } catch {
      message.error("保存失败");
    }
  };

  const completeBatch = async () => {
    if (!selectedBatch) return;
    try {
      await (casesApi as any).completePreprocessing(selectedBatch.id);
      message.success(`批次 ${selectedBatch.batch_number} 已完成`);
      setSelectedBatch(null);
      fetchBatches();
    } catch {
      message.error("操作失败");
    }
  };

  // ===== Field update =====
  const updateSampleField = (sampleId: string, field: string, value: any) => {
    if (!selectedBatch) return;
    const update = (samples: PreSample[]) =>
      samples.map(s => {
        if (s.id !== sampleId) return s;
        const updated = { ...s, [field]: value };
        // Auto-compute remaining_sample_types when experiment type changes
        if (field === "experiment_sample_type") {
          const received = s.received_sample_types || [];
          updated.remaining_sample_types = value
            ? received.filter((t: string) => t !== value)
            : received;
        }
        return updated;
      });
    setSelectedBatch({
      ...selectedBatch,
      female_samples: update(selectedBatch.female_samples),
      male_blood_samples: update(selectedBatch.male_blood_samples),
      male_other_samples: update(selectedBatch.male_other_samples),
    });
  };

  // ===== Photo upload =====
  const handlePhotoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotos(prev => [...prev, e.target?.result as string]);
    };
    reader.readAsDataURL(file);
    return false; // Prevent auto upload
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // ===== Column builders =====
  const femaleBloodColumns = () => [
    { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 110,
      render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text> },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 80 },
    { title: "样本情况", dataIndex: "sample_condition", key: "cond", width: 110,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "OK"} style={{ width: 90 }}
          placeholder="选择" options={CONDITION_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "sample_condition", val)} allowClear />
      ) },
    { title: "分装管数", dataIndex: "aliquot_tubes", key: "tubes", width: 80,
      render: (v: number, r: PreSample) => (
        <InputNumber size="small" min={1} max={10} value={v} style={{ width: 55 }}
          onChange={(val: number | null) => updateSampleField(r.id, "aliquot_tubes", val || 3)} />
      ) },
    { title: "样本情况", dataIndex: "sample_condition", key: "cond", width: 110,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "OK"} style={{ width: 90 }}
          placeholder="选择" options={CONDITION_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "sample_condition", val)} allowClear />
      ) },
    { title: "QC", dataIndex: "qc_status", key: "qc", width: 80,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "PASS"} style={{ width: 70 }}
          onChange={(val: string) => updateSampleField(r.id, "qc_status", val)}
          options={[{ value: "PASS", label: "✅" }, { value: "FAIL", label: "❌" }]} />
      ) },
    { title: "备注", dataIndex: "qc_note", key: "note", width: 120,
      render: (v: string, r: PreSample) => (
        <Input size="small" value={v} placeholder="备注"
          onChange={(e: any) => updateSampleField(r.id, "qc_note", e.target.value)} />
      ) },
  ];

  const maleColumns = () => [
    { title: "PT编号", dataIndex: "test_sample_id", key: "pt", width: 110,
      render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text> },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 80 },
    { title: "样本情况", dataIndex: "sample_condition", key: "cond", width: 110,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "OK"} style={{ width: 90 }}
          placeholder="选择" options={CONDITION_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "sample_condition", val)} allowClear />
      ) },
    { title: "收到样本类型", dataIndex: "received_sample_types", key: "rst", width: 150,
      render: (v: string[]) => (
        <Space size={2} wrap>{v.map(t => {
          const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === t);
          return <Tag key={t} color="blue">{opt?.label || t}</Tag>;
        })}</Space>
      ) },
    { title: "实验样本类型", dataIndex: "experiment_sample_type", key: "est", width: 130,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || undefined} style={{ width: 100 }}
          placeholder="选择" options={SAMPLE_TYPE_OPTIONS}
          onChange={(val: string) => updateSampleField(r.id, "experiment_sample_type", val)} allowClear />
      ) },
    { title: "剩余样本类型", dataIndex: "remaining_sample_types", key: "rest", width: 150,
      render: (v: string[]) => (
        <Space size={2} wrap>{(v && v.length > 0 ? v.map(t => {
          const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === t);
          return <Tag key={t}>{opt?.label || t}</Tag>;
        }) : <Text type="secondary">—</Text>)}</Space>
      ) },
    { title: "分装管数", dataIndex: "aliquot_tubes", key: "tubes", width: 80,
      render: (v: number, r: PreSample) => (
        r.category === "MALE_OTHER" ? <Text type="secondary">—</Text> :
        <InputNumber size="small" min={1} max={10} value={v} style={{ width: 55 }}
          onChange={(val: number | null) => updateSampleField(r.id, "aliquot_tubes", val || (r.role === "MOTHER" ? 3 : 2))} />
      ) },
    { title: "QC", dataIndex: "qc_status", key: "qc", width: 80,
      render: (v: string, r: PreSample) => (
        <Select size="small" value={v || "PASS"} style={{ width: 70 }}
          onChange={(val: string) => updateSampleField(r.id, "qc_status", val)}
          options={[{ value: "PASS", label: "✅" }, { value: "FAIL", label: "❌" }]} />
      ) },
    { title: "备注", dataIndex: "qc_note", key: "note", width: 120,
      render: (v: string, r: PreSample) => (
        <Input size="small" value={v} placeholder="备注"
          onChange={(e: any) => updateSampleField(r.id, "qc_note", e.target.value)} />
      ) },
  ];

  // ===== Render =====
  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", gap: 12 }}>
      {/* Sidebar */}
      <Card size="small" style={{
        width: sidebarCollapsed ? 50 : 380, flexShrink: 0,
        transition: "width 0.25s", overflow: "hidden",
      }}
        title={sidebarCollapsed ? undefined : "前处理批次"}
        extra={<Button type="text" size="small"
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />}
      >
        {!sidebarCollapsed && (
          <>
            <Button type="primary" icon={<PlusOutlined />} block onClick={openNewBatch} style={{ marginBottom: 8 }}>
              新建批次
            </Button>
            <Table dataSource={batches} rowKey="id" loading={loading} size="small"
              pagination={false} scroll={{ y: "calc(100vh - 280px)" }}
              onRow={(r: BatchItem) => ({
                onClick: () => fetchDetail(r.id),
                style: { background: selectedBatch?.id === r.id ? "#e6f4ff" : undefined, cursor: "pointer" },
              })}
              columns={[
                { title: "批次号", dataIndex: "batch_number", key: "bn", width: 140,
                  render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                { title: "状态", dataIndex: "status", key: "st", width: 60,
                  render: (v: string) => {
                    const c: Record<string, string> = { DRAFT: "default", IN_PROGRESS: "blue", COMPLETED: "green" };
                    const l: Record<string, string> = { DRAFT: "待处理", IN_PROGRESS: "处理中", COMPLETED: "已完成" };
                    return <Tag color={c[v] || "default"}>{l[v] || v}</Tag>;
                  } },
                { title: "样本", key: "cnt", width: 100,
                  render: (_: any, r: BatchItem) => (
                    <Text style={{ fontSize: 11 }}>👩{r.female_count} 👨{r.male_blood_count + r.male_other_count}</Text>
                  ) },
              ]}
            />
          </>
        )}
      </Card>

      {/* Main area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedBatch ? (
          <Card size="small" title={
            <Space>
              <Text strong>{selectedBatch.batch_number}</Text>
              <Tag color={selectedBatch.status === "COMPLETED" ? "green" : selectedBatch.status === "IN_PROGRESS" ? "blue" : "default"}>
                {selectedBatch.status_display}
              </Tag>
            </Space>
          } extra={
            <Space>
              <Button icon={<ReloadOutlined />} size="small" loading={batchLoading}
                onClick={() => fetchDetail(selectedBatch.id)}>刷新</Button>
              <Button type="primary" icon={<CheckOutlined />} size="small"
                onClick={saveProcessing} loading={batchLoading}>保存</Button>
              {selectedBatch.status !== "COMPLETED" && (<>
                <Popconfirm title="确定删除该批次？样本将回到待处理" onConfirm={() => deleteBatch(selectedBatch.id, selectedBatch.batch_number)}>
                  <Button type="primary" size="small" danger>删除批次</Button>
                </Popconfirm>
                <Popconfirm title="确定完成该批次？合格样本将进入后续实验" onConfirm={completeBatch}>
                  <Button type="primary" size="small">完成批次</Button>
                </Popconfirm>
              </>)}
            </Space>
          }>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
              {
                key: "female",
                label: `👩 女性 (${selectedBatch.female_count})`,
                children: (
                  <>
                    <Table dataSource={selectedBatch.female_samples} rowKey="id"
                      columns={femaleBloodColumns()} size="small" pagination={false} scroll={{ x: 600 }} />
                  </>
                ),
              },
              {
                key: "male",
                label: `👨 男性 (${selectedBatch.male_blood_count + selectedBatch.male_other_count})`,
                children: (
                  selectedBatch.male_blood_count + selectedBatch.male_other_count > 0 ? (
                    <Table dataSource={[...(selectedBatch.male_blood_samples || []), ...(selectedBatch.male_other_samples || [])]} rowKey="id"
                      columns={maleColumns()} size="small" pagination={false} scroll={{ x: 900 }} />
                  ) : (
                    <Text type="secondary">无男性样本</Text>
                  )
                ),
              },
            ]} />

            {/* Photo upload section */}
            <Divider style={{ margin: "12px 0" }} />
            <Card size="small" title="📷 实验照片" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {photos.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 104, height: 104 }}>
                    <Image src={url} width={104} height={104} style={{ objectFit: "cover", borderRadius: 4 }} />
                    <Button type="text" danger size="small"
                      style={{ position: "absolute", top: -8, right: -8, background: "#fff", borderRadius: "50%" }}
                      onClick={() => removePhoto(i)}>✕</Button>
                  </div>
                ))}
                <Upload beforeUpload={(f) => { handlePhotoUpload(f); return false; }}
                  showUploadList={false} accept="image/*">
                  <div style={{
                    width: 104, height: 104, border: "1px dashed #d9d9d9", borderRadius: 4,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                  }}>
                    <CameraOutlined style={{ fontSize: 24, color: "#999" }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>拍照/上传</Text>
                  </div>
                </Upload>
              </div>
            </Card>
          </Card>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
            <Title level={5} type="secondary">选择左侧批次查看详情</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNewBatch}>
              新建前处理批次
            </Button>
          </div>
        )}
      </div>

      {/* New Batch Modal */}
      <Modal title="新建前处理批次" open={modalOpen} onOk={createBatch}
        onCancel={() => setModalOpen(false)} width={700}
        okText={`创建批次 (${selectedKeys.size}个样本)`}>
        {pendingData && (
          <div>
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f6ffed", borderRadius: 6 }}>
              <Text strong>批次号：</Text>
              <Text code style={{ fontSize: 16 }}>{batchNumberPreview}</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>（自动生成）</Text>
            </div>
            <Input.Search placeholder="搜索姓名/PT号/Case号..." allowClear
              value={pendingSearch} onChange={(e: any) => setPendingSearch(e.target.value)}
              style={{ marginBottom: 8 }} />
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Space>
                <Tag color="magenta">👩 女性: {pendingData.female_count}</Tag>
                <Tag color="blue">👨 男性: {pendingData.male_blood_count + pendingData.male_other_count}</Tag>
              </Space>
              <Space>
                <Button size="small" onClick={() => toggleAll(true)}>全选</Button>
                <Button size="small" onClick={() => toggleAll(false)}>取消全选</Button>
              </Space>
            </div>
            <Divider style={{ margin: "8px 0" }} />
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              {(["FEMALE_BLOOD", "MALE"] as const).map(cat => {
                const entries = pendingData.entries.filter(e =>
                  (cat === "FEMALE_BLOOD" ? e.category === "FEMALE_BLOOD" : e.category !== "FEMALE_BLOOD") &&
                  (!pendingSearch || e.patient_name.includes(pendingSearch) ||
                   e.case_number.includes(pendingSearch) ||
                   (e.test_sample_id || "").includes(pendingSearch))
                );
                if (entries.length === 0) return null;
                const isMale = cat !== "FEMALE_BLOOD";
                const catLabel = isMale ? "👨 男性" : "👩 女性";
                return (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <Text strong style={{ fontSize: 13 }}>{catLabel} ({entries.length})</Text>
                    {entries.map(e => {
                      const allIn = e.case_sample_ids.every((id: string) => selectedKeys.has(id));
                      const someIn = e.case_sample_ids.some((id: string) => selectedKeys.has(id));
                      return (
                        <div key={e.case_sample_ids.join(",")} style={{
                          padding: "6px 8px", borderBottom: "1px solid #f0f0f0",
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <Checkbox checked={allIn} indeterminate={!allIn && someIn}
                            onChange={() => {
                              setSelectedKeys(prev => {
                                const next = new Set(prev);
                                if (allIn) {
                                  e.case_sample_ids.forEach((id: string) => next.delete(id));
                                } else {
                                  e.case_sample_ids.forEach((id: string) => next.add(id));
                                }
                                return next;
                              });
                            }} />
                          <Text code style={{ fontSize: 11, width: 150 }}>{e.case_number}</Text>
                          {e.test_sample_id && <Tag color="blue" style={{ fontSize: 11 }}>{e.test_sample_id}</Tag>}
                          <Text strong>{e.patient_name}</Text>
                          <Space size={2} wrap>
                            {e.sample_types.map((t: string) => {
                              const opt = SAMPLE_TYPE_OPTIONS.find(o => o.value === t);
                              return <Tag key={t} color="green" style={{ fontSize: 10 }}>{opt?.label || t}</Tag>;
                            })}
                          </Space>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
