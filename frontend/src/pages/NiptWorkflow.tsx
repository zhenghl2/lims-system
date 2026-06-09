import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Space, Typography, Modal, Form, Select, Input, InputNumber, DatePicker, TimePicker, message, Popconfirm, Card, Empty, Row, Col, Tabs } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowRightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi, panelsApi, samplesApi } from "../api";
import DashboardLayout from "../components/DashboardLayout";

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", LIBRARY_PREP: "blue", SEQUENCING: "purple",
  ANALYZING: "orange", QC_REVIEW: "cyan", COMPLETED: "green", FAILED: "red",
};


const STATUS_MAP_ZH: Record<string, string> = {
  PLANNED: "已计划", LIBRARY_PREP: "文库构建", SEQUENCING: "上机测序",
  ANALYZING: "生物信息分析", QC_REVIEW: "质控审核", COMPLETED: "已完成", FAILED: "失败",
};

const STEPS = [
  { key: "extraction", title: "① 核酸提取", status: "PLANNED" },
  { key: "library", title: "② 文库构建", status: "LIBRARY_PREP" },
  { key: "sequencing", title: "③ 上机测序", status: "SEQUENCING" },
  { key: "bioinformatics", title: "④ 生物信息分析", status: "ANALYZING" },
];

function getStepIndex(status: string): number {
  const map: Record<string, number> = { PLANNED: 0, LIBRARY_PREP: 1, SEQUENCING: 2, ANALYZING: 3, QC_REVIEW: 4, COMPLETED: 5 };
  return map[status] ?? 0;
}

export default function NiptWorkflow() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeStep, setActiveStep] = useState("extraction");

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [stepForm] = Form.useForm();

  const [panels, setPanels] = useState<any[]>([]);
  const [samples, setSamples] = useState<any[]>([]);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await runsApi.list({ panel_code: "NIPT,NIPT_PLUS", page_size: 50, ordering: "-created_at" });
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
    } catch { message.error("Failed to load batch detail"); }
    finally { setDetailLoading(false); }
  }, []);

  const selectBatch = (batch: any) => {
    setSelectedBatch(batch);
    setActiveStep(STEPS[getStepIndex(batch.status)]?.key || "extraction");
    fetchDetail(batch.id);
  };

  useEffect(() => {
    panelsApi.list().then(r => setPanels((r.data as any).results || r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (createOpen) samplesApi.list({ status: "RECEIVED", page_size: 200 }).then(r => setSamples((r.data as any).results || [])).catch(() => {});
  }, [createOpen]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await runsApi.create({ run_number: values.batch_number, panel: values.panel, sample_ids: values.sample_ids || [] });
      message.success("Batch created");
      setCreateOpen(false); form.resetFields(); fetchBatches();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || "Failed");
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
    } catch { message.error("Failed"); }
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
    const order = ["PLANNED", "LIBRARY_PREP", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
    const idx = order.indexOf(selectedBatch.status);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  })() : null;

  const batchColumns = [
    { title: "Run Number", dataIndex: "run_number", key: "run_number", width: 170, render: (v: string) => <Text code>{v}</Text> },
    { title: "Panel", dataIndex: "panel_name", key: "panel_name", width: 80, render: (v: string) => v || "-" },
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
          <Row gutter={[16, 16]}>
            <Col span={8}><Form.Item name="ext_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="ext_time" label="实验时间"><TimePicker format="HH:mm" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="bsc_id" label="生物安全柜编号"><Input placeholder="e.g. BSC-A2-01" /></Form.Item></Col>
            <Col span={8}><Form.Item name="extractor_id" label="核酸提取仪编号"><Input placeholder="e.g. 001" /></Form.Item></Col>
            <Col span={8}><Form.Item name="kit_type" label="试剂盒类型" rules={[{ required: true }]}><Select placeholder="Select" options={[{ value: "PN-16E", label: "PN-16E" }, { value: "PN-96E", label: "PN-96E" }]} /></Form.Item></Col>
            <Col span={4}><Form.Item name="kit_lot" label="试剂批次" rules={[{ required: true }]}><Input placeholder="Lot #" /></Form.Item></Col>
            <Col span={4}><Form.Item name="kit_expiry" label="有效期"><Input placeholder="YYYY-MM" /></Form.Item></Col>
            <Col span={24}><Form.Item name="ext_notes" label="备注"><Input.TextArea rows={2} placeholder="记录实验观察..." /></Form.Item></Col>
          </Row>
        );
      case "library":
        return (
          <Row gutter={[16, 16]}>
            <Col span={8}><Form.Item name="lib_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="lib_operator" label="实验人员"><Input placeholder="Name" /></Form.Item></Col>
            <Col span={8}><Form.Item name="lib_kit" label="文库构建试剂盒" rules={[{ required: true }]}><Select placeholder="Select" options={[{ value: "KAPA", label: "KAPA HyperPrep" }, { value: "NEB", label: "NEBNext Ultra II" }, { value: "MGI", label: "MGI Easy" }]} /></Form.Item></Col>
            <Col span={4}><Form.Item name="lib_kit_lot" label="试剂批次"><Input placeholder="Lot #" /></Form.Item></Col>
            <Col span={4}><Form.Item name="lib_conc" label="文库浓度 (ng/μL)"><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 25" /></Form.Item></Col>
            <Col span={4}><Form.Item name="lib_input" label="Input DNA (ng)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 100" /></Form.Item></Col>
            <Col span={4}><Form.Item name="lib_pcr" label="PCR 循环数"><InputNumber min={0} max={20} style={{ width: "100%" }} placeholder="e.g. 8" /></Form.Item></Col>
            <Col span={24}><Form.Item name="lib_notes" label="备注"><Input.TextArea rows={2} placeholder="记录文库构建观察..." /></Form.Item></Col>
          </Row>
        );
      case "sequencing":
        return (
          <Row gutter={[16, 16]}>
            <Col span={8}><Form.Item name="seq_date" label="测序日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="seq_instrument" label="测序仪编号" rules={[{ required: true }]}><Input placeholder="e.g. MGI-2000" /></Form.Item></Col>
            <Col span={8}><Form.Item name="seq_chip" label="测序芯片类型"><Select placeholder="Select" options={[{ value: "FCL", label: "FCL" }, { value: "FCS", label: "FCS" }]} /></Form.Item></Col>
            <Col span={4}><Form.Item name="seq_conc" label="上样浓度 (pM)"><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 12" /></Form.Item></Col>
            <Col span={4}><Form.Item name="seq_reads" label="目标数据量 (M reads)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 25" /></Form.Item></Col>
            <Col span={24}><Form.Item name="seq_notes" label="备注"><Input.TextArea rows={2} placeholder="记录测序观察..." /></Form.Item></Col>
          </Row>
        );
      case "bioinformatics":
        return (
          <Row gutter={[16, 16]}>
            <Col span={8}><Form.Item name="bio_date" label="分析日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="bio_operator" label="分析人员"><Input placeholder="Name" /></Form.Item></Col>
            <Col span={8}><Form.Item name="bio_version" label="分析软件版本"><Input placeholder="e.g. v3.2.1" /></Form.Item></Col>
            <Col span={4}><Form.Item name="bio_q30" label="Q30 (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 92" /></Form.Item></Col>
            <Col span={4}><Form.Item name="bio_gc" label="GC 含量 (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 42" /></Form.Item></Col>
            <Col span={4}><Form.Item name="bio_data" label="有效数据 (Mb)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 15" /></Form.Item></Col>
            <Col span={24}><Form.Item name="bio_notes" label="备注"><Input.TextArea rows={2} placeholder="记录生信分析观察..." /></Form.Item></Col>
          </Row>
        );
      default:
        return <Empty description="Select a step" />;
    }
  };

  return (
    <DashboardLayout>
      <div style={{ display: "flex", gap: 24, height: "calc(100vh - 160px)" }}>
        {/* Left: Batch List */}
        <Card title={<Title level={5} style={{ margin: 0 }}>NIPT Batches</Title>}
          extra={<Space><Button icon={<ReloadOutlined />} onClick={fetchBatches} /><Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreateOpen(true); }}>New Batch</Button></Space>}
          style={{ width: 480, overflow: "auto" }} bodyStyle={{ padding: 0 }}>
          <Table rowKey="id" columns={batchColumns} dataSource={batches} loading={loading}
            pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }} size="small"
            onRow={(r) => ({ onClick: () => selectBatch(r), style: { cursor: "pointer", background: selectedBatch?.id === r.id ? "#e6f7ff" : undefined } })}
          />
        </Card>

        {/* Right: Batch Detail */}
        <Card style={{ flex: 1, overflow: "auto" }} bodyStyle={{ padding: 24 }}>
          {!selectedBatch ? (
            <Empty description="Select a batch to view workflow" style={{ marginTop: 80 }} />
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
                      { title: "Patient Name", dataIndex: "patient_name", width: 130 },
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
      <Modal title="Create NIPT Batch" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} confirmLoading={createLoading} width={550} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="batch_number" label="Batch Number" rules={[{ required: true }]}>
            <Input placeholder="e.g. NIPT-20260609-001" />
          </Form.Item>
          <Form.Item name="panel" label="Test Panel" rules={[{ required: true }]}>
            <Select placeholder="Select panel" options={panels.map((p: any) => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
          </Form.Item>
          <Form.Item name="sample_ids" label="Add Samples">
            <Select mode="multiple" allowClear showSearch placeholder="Select RECEIVED samples"
              filterOption={(input, option) => (option?.label as string || "").toLowerCase().includes(input.toLowerCase())}
              options={samples.map((s: any) => ({ value: s.id, label: `${s.sample_id} - ${s.patient_name}` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
