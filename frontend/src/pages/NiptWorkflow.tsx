import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Space, Typography, Modal, Form, Select, Input, message, Popconfirm, Steps, Card, Empty, Row, Col } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowRightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi, panelsApi, samplesApi } from "../api";
import DashboardLayout from "../components/DashboardLayout";

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", LIBRARY_PREP: "blue", SEQUENCING: "purple",
  ANALYZING: "orange", QC_REVIEW: "cyan", COMPLETED: "green", FAILED: "red",
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planned", LIBRARY_PREP: "Library Prep", SEQUENCING: "Sequencing",
  ANALYZING: "Analyzing", QC_REVIEW: "QC Review", COMPLETED: "Completed", FAILED: "Failed",
};

const STATUS_MAP_ZH: Record<string, string> = {
  PLANNED: "已计划", LIBRARY_PREP: "文库构建", SEQUENCING: "上机测序",
  ANALYZING: "生物信息分析", QC_REVIEW: "质控审核", COMPLETED: "已完成", FAILED: "失败",
};

const NGS_NIPT_STAGES = [
  { title: "核酸提取", status: "PLANNED" },
  { title: "文库构建", status: "LIBRARY_PREP" },
  { title: "上机测序", status: "SEQUENCING" },
  { title: "生物信息分析", status: "ANALYZING" },
];

function getStageIndex(status: string): number {
  const order = ["PLANNED", "LIBRARY_PREP", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
  return order.indexOf(status);
}

export default function NiptWorkflow() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();

  const [panels, setPanels] = useState<any[]>([]);
  const [samples, setSamples] = useState<any[]>([]);

  // Fetch batches
  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await runsApi.list({ panel_code: "NIPT,NIPT_PLUS", page_size: 50, ordering: "-created_at" });
      setBatches((res.data as any).results || res.data || []);
    } catch { message.error("Failed to load batches"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  // Fetch batch detail
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await runsApi.detail(id);
      setBatchDetail(res.data);
    } catch { message.error("Failed to load batch detail"); }
    finally { setDetailLoading(false); }
  }, []);

  const selectBatch = (batch: any) => {
    setSelectedBatch(batch);
    fetchDetail(batch.id);
  };

  // Load form options
  useEffect(() => {
    panelsApi.list().then(r => setPanels((r.data as any).results || r.data || [])).catch(() => {});
    samplesApi.list({ status: "RECEIVED", page_size: 200 }).then(r => setSamples((r.data as any).results || [])).catch(() => {});
  }, [createOpen]);

  // Create batch
  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const payload: any = {
        run_number: values.batch_number,
        panel: values.panel,
        sample_ids: values.sample_ids || [],
      };
      await runsApi.create(payload);
      message.success("Batch created");
      setCreateOpen(false);
      form.resetFields();
      fetchBatches();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || "Failed to create batch");
    } finally { setCreateLoading(false); }
  };

  // Delete batch
  const handleDelete = async (id: string) => {
    try {
      await runsApi.delete(id);
      message.success("Batch deleted");
      if (selectedBatch?.id === id) { setSelectedBatch(null); setBatchDetail(null); }
      fetchBatches();
    } catch { message.error("Delete failed"); }
  };

  // Advance status
  const handleAdvance = async (status: string) => {
    if (!selectedBatch) return;
    try {
      await runsApi.advanceStatus(selectedBatch.id, status);
      message.success(`Status advanced to ${STATUS_LABEL[status] || status}`);
      fetchBatches();
      fetchDetail(selectedBatch.id);
    } catch { message.error("Failed to advance status"); }
  };

  const batchColumns = [
    { title: "Run Number", dataIndex: "run_number", key: "run_number", width: 160, render: (v: string) => <Text code>{v}</Text> },
    { title: "Panel", dataIndex: "panel_name", key: "panel_name", width: 100, render: (v: string) => v || "-" },
    { title: "Protocol", dataIndex: "protocol_name", key: "protocol_name", width: 160, ellipsis: true, render: (v: string) => v || "-" },
    { title: "Samples", dataIndex: "sample_count", key: "sample_count", width: 80, align: "center" as const },
    {
      title: "Status", dataIndex: "status", key: "status", width: 130,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{STATUS_MAP_ZH[v] || STATUS_LABEL[v] || v}</Tag>,
    },
    { title: "Created", dataIndex: "created_at", key: "created_at", width: 110, render: (v: string) => dayjs(v).format("YYYY-MM-DD") },
    {
      title: "", key: "action", width: 60,
      render: (_: any, r: any) => (
        <Popconfirm title="Delete this batch?" onConfirm={() => handleDelete(r.id)}>
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const nextStatus = selectedBatch ? (() => {
    const order = ["PLANNED", "LIBRARY_PREP", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
    const idx = order.indexOf(selectedBatch.status);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  })() : null;

  const stageIdx = selectedBatch ? getStageIndex(selectedBatch.status) : 0;

  return (
    <DashboardLayout>
      <div style={{ display: "flex", gap: 24, height: "calc(100vh - 160px)" }}>
        {/* Left: Batch List */}
        <Card title={<Title level={5} style={{ margin: 0 }}>NIPT Batches</Title>}
          extra={<Space><Button icon={<ReloadOutlined />} onClick={fetchBatches} /><Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreateOpen(true); }}>New Batch</Button></Space>}
          style={{ width: 550, overflow: "auto" }} bodyStyle={{ padding: 0 }}>
          <Table rowKey="id" columns={batchColumns} dataSource={batches} loading={loading}
            pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }} size="small"
            onRow={(r) => ({ onClick: () => selectBatch(r), style: { cursor: "pointer", background: selectedBatch?.id === r.id ? "#e6f7ff" : undefined } })}
          />
        </Card>

        {/* Right: Batch Detail */}
        <Card style={{ flex: 1, overflow: "auto" }} bodyStyle={{ padding: 24 }}>
          {!selectedBatch ? (
            <Empty description="Select a batch from the list to view details" style={{ marginTop: 80 }} />
          ) : detailLoading ? (
            <div style={{ textAlign: "center", padding: 80 }}>Loading...</div>
          ) : (
            <div>
              {/* Batch Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>{selectedBatch.run_number}</Title>
                  <Space style={{ marginTop: 4 }}>
                    <Tag color={STATUS_COLOR[selectedBatch.status] || "default"}>
                      {STATUS_MAP_ZH[selectedBatch.status] || STATUS_LABEL[selectedBatch.status] || selectedBatch.status}
                    </Tag>
                    <Text type="secondary">Panel: {selectedBatch.panel_name || "-"}</Text>
                    <Text type="secondary">Protocol: {selectedBatch.protocol_name || "-"}</Text>
                  </Space>
                </div>
                <Space>
                  {nextStatus && (
                    <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => handleAdvance(nextStatus)}>
                      Advance: {STATUS_MAP_ZH[nextStatus] || STATUS_LABEL[nextStatus]}
                    </Button>
                  )}
                  <Button icon={<ReloadOutlined />} onClick={() => fetchDetail(selectedBatch.id)} />
                </Space>
              </div>

              {/* Progress Steps */}
              <Card size="small" style={{ marginBottom: 16, background: "#fafafa" }}>
                <Steps current={stageIdx} size="small" items={NGS_NIPT_STAGES.map((s, i) => ({
                  title: s.title,
                  status: i < stageIdx ? "finish" : i === stageIdx ? "process" : "wait",
                }))} />
              </Card>

              {/* Batch Stats */}
              {batchDetail && (
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col span={6}><Card size="small"><Stat title="Samples" value={batchDetail.sample_count || 0} /></Card></Col>
                  <Col span={6}><Card size="small"><Stat title="Steps Total" value={batchDetail.steps?.length || 0} /></Card></Col>
                  <Col span={6}><Card size="small"><Stat title="Completed" value={batchDetail.steps?.filter((s: any) => s.status === "COMPLETED").length || 0} color="#52c41a" /></Card></Col>
                  <Col span={6}><Card size="small"><Stat title="In Progress" value={batchDetail.steps?.filter((s: any) => s.status === "IN_PROGRESS").length || 0} color="#1677ff" /></Card></Col>
                </Row>
              )}

              {/* Workflow Steps Table */}
              {batchDetail?.steps && batchDetail.steps.length > 0 && (
                <Table rowKey="id" size="small" dataSource={batchDetail.steps}
                  columns={[
                    { title: "Step", dataIndex: "step_name", key: "step_name", width: 180 },
                    { title: "Order", dataIndex: "step_order", key: "step_order", width: 60, align: "center" as const },
                    { title: "Sample", dataIndex: "sample_barcode", key: "sample_barcode", width: 150, render: (v: string) => v || "-" },
                    {
                      title: "Status", dataIndex: "status", key: "status", width: 120,
                      render: (v: string) => {
                        const colors: Record<string, string> = { PENDING: "default", IN_PROGRESS: "processing", COMPLETED: "green", SKIPPED: "warning", FAILED: "red" };
                        return <Tag color={colors[v]}>{v}</Tag>;
                      },
                    },
                    { title: "Performed By", dataIndex: "performed_by_name", key: "performed_by_name", width: 120, render: (v: string) => v || "-" },
                    { title: "Started", dataIndex: "started_at", key: "started_at", width: 120, render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-" },
                    { title: "Completed", dataIndex: "completed_at", key: "completed_at", width: 120, render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-" },
                    { title: "Observations", dataIndex: "observations", key: "observations", ellipsis: true, render: (v: string) => v || "-" },
                  ]}
                  pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }}
                />
              )}
              {(!batchDetail?.steps || batchDetail.steps.length === 0) && (
                <Empty description="No workflow steps yet. Create a protocol with NGS-NIPT steps and assign it to this batch." />
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Create Batch Modal */}
      <Modal title="Create NIPT Batch" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} confirmLoading={createLoading} width={600} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="batch_number" label="Batch Number" rules={[{ required: true, message: "Enter batch number" }]}>
            <Input placeholder="e.g. NIPT-BATCH-001" />
          </Form.Item>
          <Form.Item name="panel" label="Test Panel" rules={[{ required: true, message: "Select test panel" }]}>
            <Select placeholder="Select test panel" options={panels.map((p: any) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
          </Form.Item>
          <Form.Item name="sample_ids" label="Add Samples">
            <Select mode="multiple" allowClear placeholder="Select samples to add" showSearch
              filterOption={(input, option) => (option?.label as string || "").toLowerCase().includes(input.toLowerCase())}
              options={samples.map((s: any) => ({ value: s.id, label: `${s.sample_id} - ${s.patient_name}` }))}
            />
          </Form.Item>
          <Text type="secondary">Run number will be auto-generated. You can add more samples later.</Text>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}

function Stat({ title, value, color }: { title: string; value: number; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "#1677ff" }}>{value}</div>
      <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
    </div>
  );
}
