import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Space, Typography, Modal, Form, Select, Input, InputNumber, DatePicker, message, Popconfirm, Card, Empty, Row, Col, Tabs } from "antd";
import { PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowRightOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi, samplesApi } from "../api";
import DashboardLayout from "../components/DashboardLayout";
import { useTranslation } from "../i18n/useTranslation";

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
  const { t } = useTranslation();
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

  const [samples, setSamples] = useState<any[]>([]);

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
    } catch { message.error("Failed to load batch detail"); }
    finally { setDetailLoading(false); }
  }, []);

  const selectBatch = (batch: any) => {
    setSelectedBatch(batch);
    setActiveStep(STEPS[getStepIndex(batch.status)]?.key || "extraction");
    fetchDetail(batch.id);
  };
  useEffect(() => {
    if (createOpen) samplesApi.list({ status: "RECEIVED", page_size: 200 }).then(r => setSamples((r.data as any).results || [])).catch(() => {});
  }, [createOpen]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const payload: any = { panel_code: "NIPT", samples: values.sample_ids || [], notes: values.batch_number || "" };
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
    const order = ["PLANNED", "LIBRARY_PREP", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
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
          <Row gutter={[16, 16]}>
            <Col span={6}><Form.Item name="ext_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_operator" label="实验人员" rules={[{ required: true }]}><Input placeholder="Name" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_kit" label="提取试剂盒" rules={[{ required: true }]}><Select placeholder="Select" options={[
              { value: "QIAamp_DNA", label: "QIAamp Circulating Nucleic Acid" },
              { value: "MagMAX", label: "MagMAX Cell-Free DNA" },
              { value: "TIANamp", label: "TIANamp Micro DNA" },
            ]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_kit_lot" label="试剂批次" rules={[{ required: true }]}><Input placeholder="Lot #" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_volume" label="血浆体积 (mL)" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 4.0" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_elution" label="洗脱体积 (μL)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 60" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_conc" label="DNA 浓度 (ng/μL)" rules={[{ required: true }]}><InputNumber min={0} step={0.01} style={{ width: "100%" }} placeholder="e.g. 0.45" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_total" label="DNA 总量 (ng)"><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 27" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_a260a280" label="A260/A280"><InputNumber min={0} max={3} step={0.01} style={{ width: "100%" }} placeholder="e.g. 1.85" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_a260a230" label="A260/A230"><InputNumber min={0} max={3} step={0.01} style={{ width: "100%" }} placeholder="e.g. 2.1" /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_qc" label="质控结果" rules={[{ required: true }]}><Select placeholder="Pass / Fail" options={[{ value: "PASS", label: "✅ 合格" }, { value: "FAIL", label: "❌ 不合格" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="ext_qc_note" label="质控备注"><Input placeholder="如不合格，说明原因" /></Form.Item></Col>
            <Col span={24}><Form.Item name="ext_notes" label="备注"><Input.TextArea rows={2} placeholder="记录实验观察..." /></Form.Item></Col>
          </Row>
        );
      case "library":
        return (
          <Row gutter={[16, 16]}>
            <Col span={6}><Form.Item name="lib_date" label="实验日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_operator" label="实验人员" rules={[{ required: true }]}><Input placeholder="Name" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_kit" label="文库试剂盒" rules={[{ required: true }]}><Select placeholder="Select" options={[
              { value: "KAPA_HyperPrep", label: "KAPA HyperPrep Kit" },
              { value: "NEBNext_UltraII", label: "NEBNext Ultra II" },
              { value: "MGI_Easy", label: "MGI Easy Prep" },
            ]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_kit_lot" label="试剂批次" rules={[{ required: true }]}><Input placeholder="Lot #" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_input" label="Input DNA (ng)" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 10" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_conc" label="文库浓度 (ng/μL)"><InputNumber min={0} step={0.01} style={{ width: "100%" }} placeholder="e.g. 25" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_molar" label="摩尔浓度 (nM)"><InputNumber min={0} step={0.01} style={{ width: "100%" }} placeholder="e.g. 8.5" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_size" label="片段大小 (bp)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 310" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_pcr" label="PCR 循环数"><InputNumber min={0} max={20} style={{ width: "100%" }} placeholder="e.g. 8" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_index" label="Index 编号"><Input placeholder="e.g. N701+S501" /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_qc" label="质控结果" rules={[{ required: true }]}><Select placeholder="Pass / Fail" options={[{ value: "PASS", label: "✅ 合格" }, { value: "FAIL", label: "❌ 不合格" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="lib_qc_note" label="质控备注"><Input placeholder="如不合格，说明原因" /></Form.Item></Col>
            <Col span={24}><Form.Item name="lib_notes" label="备注"><Input.TextArea rows={2} placeholder="记录文库构建观察..." /></Form.Item></Col>
          </Row>
        );
      case "sequencing":
        return (
          <Row gutter={[16, 16]}>
            <Col span={6}><Form.Item name="seq_date" label="测序日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_operator" label="操作人员"><Input placeholder="Name" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_instrument" label="测序仪型号" rules={[{ required: true }]}><Select placeholder="Select" options={[
              { value: "MGISEQ2000", label: "MGISEQ-2000" },
              { value: "NextSeq550", label: "NextSeq 550" },
              { value: "NovaSeq6000", label: "NovaSeq 6000" },
            ]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_chip" label="芯片/Flow Cell"><Select placeholder="Select" options={[
              { value: "FCL", label: "FCL" }, { value: "FCS", label: "FCS" },
              { value: "S1", label: "S1" }, { value: "S2", label: "S2" },
            ]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_conc" label="上样浓度 (pM)" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 12" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_read_type" label="Read 类型"><Select placeholder="Select" options={[{ value: "SE75", label: "SE75" }, { value: "PE150", label: "PE150" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_target_reads" label="目标数据量 (M reads)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 25" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_actual_reads" label="实际数据量 (M reads)"><InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 25.3" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_q30" label="Q30 (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 92.5" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_error_rate" label="错误率 (%)"><InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} placeholder="e.g. 0.15" /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_qc" label="质控结果" rules={[{ required: true }]}><Select placeholder="Pass / Fail" options={[{ value: "PASS", label: "✅ 合格" }, { value: "FAIL", label: "❌ 不合格" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="seq_qc_note" label="质控备注"><Input placeholder="如不合格，说明原因" /></Form.Item></Col>
            <Col span={24}><Form.Item name="seq_notes" label="备注"><Input.TextArea rows={2} placeholder="记录测序观察..." /></Form.Item></Col>
          </Row>
        );
      case "bioinformatics":
        return (
          <Row gutter={[16, 16]}>
            <Col span={6}><Form.Item name="bio_date" label="分析日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_operator" label="分析人员" rules={[{ required: true }]}><Input placeholder="Name" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_software" label="分析软件/版本" rules={[{ required: true }]}><Input placeholder="e.g. WisecondorX v1.2" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_genome" label="参考基因组"><Select placeholder="Select" options={[{ value: "hg19", label: "hg19 (GRCh37)" }, { value: "hg38", label: "hg38 (GRCh38)" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_mapped" label="Unique Mapped (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 85.2" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_gc" label="GC 含量 (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 42.1" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_dup" label="Duplication (%)"><InputNumber min={0} max={100} step={0.1} style={{ width: "100%" }} placeholder="e.g. 3.5" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_data" label="有效数据量 (Mb)"><InputNumber min={0} step={0.1} style={{ width: "100%" }} placeholder="e.g. 15.2" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_ff" label="FF 胎儿分数 (%)"><InputNumber min={0} max={100} step={0.01} style={{ width: "100%" }} placeholder="e.g. 10.5" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_z13" label="Chr13 Z-score"><InputNumber step={0.01} style={{ width: "100%" }} placeholder="e.g. 0.85" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_z18" label="Chr18 Z-score"><InputNumber step={0.01} style={{ width: "100%" }} placeholder="e.g. 1.23" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_z21" label="Chr21 Z-score"><InputNumber step={0.01} style={{ width: "100%" }} placeholder="e.g. -0.42" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_qc" label="质控结果" rules={[{ required: true }]}><Select placeholder="Pass / Fail" options={[{ value: "PASS", label: "✅ 合格" }, { value: "FAIL", label: "❌ 不合格" }]} /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_qc_note" label="质控备注"><Input placeholder="如不合格，说明原因" /></Form.Item></Col>
            <Col span={6}><Form.Item name="bio_conclusion" label="分析结论"><Select placeholder="Select" options={[
              { value: "LOW_RISK", label: "低风险" }, { value: "HIGH_RISK", label: "高风险" },
              { value: "NO_CALL", label: "无法判定" },
            ]} /></Form.Item></Col>
            <Col span={24}><Form.Item name="bio_notes" label="备注"><Input.TextArea rows={2} placeholder="记录生信分析观察..." /></Form.Item></Col>
          </Row>
        );
      default:
        return <Empty description="Select a step" />;
    }
  };  return (
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