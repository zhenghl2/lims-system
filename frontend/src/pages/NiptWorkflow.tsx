import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Space, Typography, Modal, Form, Input, message, Popconfirm, Card, Empty, Tabs } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowRightOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi, samplesApi } from "../api";
import NiptExtractionTab from "./NiptExtractionTab";
import NiptLibraryTab from "./NiptLibraryTab";
import NiptPoolingTab from "./NiptPoolingTab";
import NiptSequencingTab from "./NiptSequencingTab";
import NiptBioinformaticsTab from "./NiptBioinformaticsTab";
import DashboardLayout from "../components/DashboardLayout";
import { useTranslation } from "../i18n/useTranslation";

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", LIBRARY_PREP: "blue", LIBRARY_POOLING: "geekblue", SEQUENCING: "purple",
  ANALYZING: "orange", QC_REVIEW: "cyan", COMPLETED: "green", FAILED: "red",
};


const STATUS_MAP_ZH: Record<string, string> = {
  PLANNED: "已计划", LIBRARY_PREP: "文库构建", LIBRARY_POOLING: "文库定量及Pooling", SEQUENCING: "上机测序",
  ANALYZING: "生物信息分析", QC_REVIEW: "质控审核", COMPLETED: "已完成", FAILED: "失败",
};

const STEPS = [
  { key: "extraction", title: "① 核酸提取", status: "PLANNED" },
  { key: "library", title: "② 文库构建", status: "LIBRARY_PREP" },
  { key: "pooling", title: "③ 文库定量及Pooling", status: "LIBRARY_POOLING" },
  { key: "sequencing", title: "④ 上机测序", status: "SEQUENCING" },
  { key: "bioinformatics", title: "⑤ 生物信息分析", status: "ANALYZING" },
];

function getStepIndex(status: string): number {
  const map: Record<string, number> = { PLANNED: 0, LIBRARY_PREP: 1, LIBRARY_POOLING: 2, SEQUENCING: 3, ANALYZING: 4, QC_REVIEW: 5, COMPLETED: 6 };
  return map[status] ?? 0;
}

export default function NiptWorkflow() {
  const { t } = useTranslation();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeStep, setActiveStep] = useState("extraction");

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [stepForm] = Form.useForm();

  const [samples, setSamples] = useState<any[]>([]);
  const [sampleSearch, setSampleSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await runsApi.list({ panel_code: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 50, ordering: "-created_at" });
      setBatches((res.data as any).results || res.data || []);
    } catch { message.error("Failed to load batches"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await runsApi.detail(id);
      setBatchDetail(res.data);
      setSelectedBatch((prev: any) => prev?.id === id ? { ...prev, ...res.data } : prev);
    } catch { message.error("Failed to load batch detail"); }
    finally { setDetailLoading(false); }
  }, []);

  const selectBatch = (batch: any) => {
    setSelectedBatch(batch);
    setActiveStep(STEPS[getStepIndex(batch.status)]?.key || "extraction");
    fetchDetail(batch.id);
  };
  useEffect(() => {
    if (createOpen) samplesApi.list({ status: "IN_PROCESS", page_size: 200 }).then(r => {
      const list = (r.data as any).results || [];
      setSamples(list);
      setSelectedIds(list.map((s: any) => s.id));
    }).catch(() => {});
  }, [createOpen]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const payload: any = { panel_code: "NIPT", samples: selectedIds, notes: values.batch_number || "" };
      if (values.batch_number) payload.notes = "Batch: " + values.batch_number;
      await runsApi.create(payload);
      message.success(t("workflow.batchCreated"));
      setCreateOpen(false); form.resetFields(); fetchBatches();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || t("common.failed"));
    } finally { setCreateLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try { await runsApi.delete(id); message.success("Deleted"); if (selectedBatch?.id === id) { setSelectedBatch(null); setBatchDetail(null); } fetchBatches(); }
    catch { message.error("Delete failed"); }
  };

  const handleAdvance = async (status: string) => {
    if (!selectedBatch) return;
    try {
      await runsApi.advanceStatus(selectedBatch.id, status);
      message.success(`Status: ${STATUS_MAP_ZH[status] || status}`);
      setSelectedBatch({ ...selectedBatch, status });
      setActiveStep(STEPS[getStepIndex(status)]?.key || "extraction");
      fetchBatches(); fetchDetail(selectedBatch.id);
    } catch { message.error(t("common.failed")); }
  };

  const handleStepSave = async () => {
    try {
      const values = await stepForm.validateFields();
      message.success(`${STEPS.find(s => s.key === activeStep)?.title} data saved`);
      // TODO: save step data to backend when API is ready
      console.log("Step data:", values);
    } catch { /* validation error */ }
  };

  const nextStatus = selectedBatch ? (() => {
    const order = ["PLANNED", "LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
    const idx = order.indexOf(selectedBatch.status);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  })() : null;

  const batchColumns = [
    { title: "Run Number", dataIndex: "run_number", key: "run_number", width: 170, render: (v: string) => <Text code>{v}</Text> },
    { title: "Samples", dataIndex: "sample_count", key: "sample_count", width: 70, align: "center" as const },
    { title: "Status", dataIndex: "status", key: "status", width: 110, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{STATUS_MAP_ZH[v] || v}</Tag> },
    { title: "Created", dataIndex: "created_at", key: "created_at", width: 100, render: (v: string) => dayjs(v).format("YYYY-MM-DD") },
    { title: "", key: "action", width: 50, render: (_: any, r: any) => (
      <Popconfirm title="Delete?" onConfirm={() => handleDelete(r.id)}><Button type="link" danger size="small" icon={<DeleteOutlined />} /></Popconfirm>
    )},
  ];

  // Step form content
  const renderStepForm = () => {
    switch (activeStep) {
      case "extraction":
        return (
          <NiptExtractionTab
            batch={selectedBatch}
            samples={batchDetail?.run_samples || batchDetail?.samples || []}
            onRefresh={() => fetchDetail(selectedBatch.id)}
          />
        );
      case "library":
        return (
          <NiptLibraryTab
            batch={selectedBatch}
            samples={batchDetail?.run_samples || batchDetail?.samples || []}
            onRefresh={() => fetchDetail(selectedBatch.id)}
          />
        );
      case "pooling":
        return (
          <NiptPoolingTab
            batch={selectedBatch}
            onRefresh={() => fetchDetail(selectedBatch.id)}
          />
        );
      case "sequencing":
        return (
          <NiptSequencingTab
            batch={selectedBatch}
            onRefresh={() => fetchDetail(selectedBatch.id)}
          />
        );
      case "bioinformatics":
        return (
          <NiptBioinformaticsTab
            batch={selectedBatch}
            samples={batchDetail?.run_samples || batchDetail?.samples || []}
            onRefresh={() => fetchDetail(selectedBatch.id)}
          />
        );
      default:
        return <Empty description="Select a step" />;
    }
  };  return (
    <DashboardLayout>
      <div style={{ display: "flex", gap: 24, height: "calc(100vh - 160px)" }}>
        {/* Left: Batch List */}
        <div id="nipt-batch-panel" style={{ width: sidebarCollapsed ? 50 : 480, flexShrink: 0, transition: "width 0.25s", overflow: "hidden" }}>
          {sidebarCollapsed ? (
            <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setSidebarCollapsed(false)}
              style={{ padding: 4, marginTop: 8 }} title="展开批次列表" />
          ) : (
            <Card title={<Title level={5} style={{ margin: 0 }}>NIPT Batches</Title>}
              extra={
                <Space>
                  <Button icon={<ReloadOutlined />} onClick={fetchBatches} />
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreateOpen(true); }}>New Batch</Button>
                  <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setSidebarCollapsed(true)}
                    style={{ padding: 4 }} title="折叠批次列表" />
                </Space>
              }
              style={{ width: 480, overflow: "auto" }} bodyStyle={{ padding: 0 }}>
              <Table rowKey="id" columns={batchColumns} dataSource={batches} loading={loading}
                pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }} size="small"
                onRow={(r) => ({ onClick: () => selectBatch(r), style: { cursor: "pointer", background: selectedBatch?.id === r.id ? "#e6f7ff" : undefined } })}
              />
            </Card>
          )}
        </div>

        {/* Right: Batch Detail */}
        <Card style={{ flex: 1, overflow: "auto" }} bodyStyle={{ padding: 24 }}>
          {!selectedBatch ? (
            <Empty description={t("workflow.selectBatch")} style={{ marginTop: 80 }} />
          ) : detailLoading ? (
            <div style={{ textAlign: "center", padding: 80 }}>Loading...</div>
          ) : (
            <div>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>{selectedBatch.run_number}</Title>
                  <Space style={{ marginTop: 4 }}>
                    <Tag color={STATUS_COLOR[selectedBatch.status]}>{STATUS_MAP_ZH[selectedBatch.status] || selectedBatch.status}</Tag>
                    <Text type="secondary">{selectedBatch.panel_name} | {selectedBatch.sample_count} samples</Text>
                  </Space>
                </div>
                <Space>
                  {nextStatus && (
                    <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => handleAdvance(nextStatus)}>
                      Advance: {STATUS_MAP_ZH[nextStatus]}
                    </Button>
                  )}
                  <Button icon={<ReloadOutlined />} onClick={() => fetchDetail(selectedBatch.id)} />
                </Space>
              </div>

              {/* Step Tabs */}
              <Tabs activeKey={activeStep} onChange={k => { setActiveStep(k); stepForm.resetFields(); }}
                items={STEPS.map(s => ({ key: s.key, label: s.title }))}
                style={{ marginBottom: 0 }}
              />

              {/* Step Form */}
              <Card size="small" style={{ background: "#fafafa" }}>
                <Form form={stepForm} layout="vertical" onFinish={handleStepSave}>
                  {renderStepForm()}
                  <div style={{ textAlign: "right", marginTop: 12 }}>
                    <Button type="primary" htmlType="submit">Save</Button>
                  </div>
                </Form>
              </Card>

              {/* Sample Table */}
              {batchDetail?.samples && batchDetail.samples.length > 0 && (
                <Card size="small" title={`Samples (${batchDetail.samples.length})`} style={{ marginTop: 16 }}>
                  <Table rowKey="id" size="small" dataSource={batchDetail.samples}
                    columns={[
                      { title: "Sample ID", dataIndex: "sample_id", width: 160 },
                      { title: "VG ID", dataIndex: "vg_id", width: 80, render: (v: string) => v || "-" },
                      { title: "Name", dataIndex: "patient_name", width: 130 },
                      { title: "Age", dataIndex: "age", width: 50 },
                      { title: "Sample Type", dataIndex: "sample_type_code", width: 130 },
                      { title: "Status", dataIndex: "status", width: 100, render: (v: string) => <Tag>{v}</Tag> },
                    ]}
                    pagination={false}
                  />
                </Card>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Create Modal */}
      <Modal title="Create NIPT Batch" open={createOpen} onOk={handleCreate} onCancel={() => { setCreateOpen(false); setSelectedIds([]); }} confirmLoading={createLoading} width={650} destroyOnClose
        okText={`Create (${selectedIds.length} samples)`}
        okButtonProps={{ disabled: selectedIds.length === 0 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="batch_number" label="Batch Number" rules={[{ required: true }]}>
            <Input placeholder="e.g. NIPT-20260609-001" />
          </Form.Item>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <Text strong>Select Samples</Text>
            <Tag color="blue" style={{ fontSize: 13, padding: "2px 10px" }}>{samples.length} IN_PROCESS</Tag>
            <Tag color="green" style={{ fontSize: 13, padding: "2px 10px" }}>{selectedIds.length} selected</Tag>
            {selectedIds.length !== samples.length && (
              <Button type="link" size="small" onClick={() => setSelectedIds(samples.map((s: any) => s.id))}>Select all</Button>
            )}
            {selectedIds.length > 0 && selectedIds.length === samples.length && (
              <Button type="link" size="small" onClick={() => setSelectedIds([])}>Deselect all</Button>
            )}
            <Input.Search
              placeholder="Search sample or patient..."
              allowClear size="small" style={{ width: 220, marginLeft: "auto" }}
              value={sampleSearch}
              onChange={e => setSampleSearch(e.target.value)}
            />
          </div>
          <Table
            rowKey="id" size="small" pagination={false} scroll={{ y: 280 }}
            dataSource={samples.filter((s: any) => {
              if (!sampleSearch) return true;
              const q = sampleSearch.toLowerCase();
              return (s.sample_id || "").toLowerCase().includes(q) || (s.patient_name || "").toLowerCase().includes(q);
            })}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys as string[]),
              preserveSelectedRowKeys: true,
            }}
            columns={[
              { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 180, render: (v: string) => <Text code style={{ whiteSpace: "nowrap" }}>{v}</Text> },
              { title: "VG ID", dataIndex: "vg_id", key: "vg_id", width: 90, render: (v: string) => v || "-" },
              { title: "Patient", dataIndex: "patient_name", key: "patient_name", width: 110 },
              { title: "Test Option", dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => {
                if (v === "NIPT" || v === "Basic") return <Tag color="blue">Basic</Tag>;
                if (v === "NIPT_PLUS" || v === "Plus" || v === "NIPT_FULL") return <Tag color="purple">Plus</Tag>;
                return v || "-";
              }},
            ]}
          />
        </Form>
      </Modal>
    </DashboardLayout>
  );
}