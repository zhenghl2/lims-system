import { useState, useEffect, useCallback, useMemo } from "react";
import { Table, Button, Tag, Space, Typography, Modal, Form, Input, message, Popconfirm, Card, Empty, Tabs, Switch } from "antd";
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
  const STATUS_MAP_TL: Record<string, string> = {
    PLANNED: t("nipt.workflow.statusPlanned"), LIBRARY_PREP: t("nipt.workflow.statusLibraryPrep"),
    LIBRARY_POOLING: t("nipt.workflow.statusPooling"), SEQUENCING: t("nipt.workflow.statusSequencing"),
    ANALYZING: t("nipt.workflow.statusAnalyzing"), QC_REVIEW: t("nipt.workflow.statusQcReview"),
    COMPLETED: t("nipt.workflow.statusCompleted"), FAILED: t("nipt.workflow.statusFailed"),
  };
  const STEPS_TL = [
    { key: "extraction", title: t("nipt.workflow.step1"), status: "PLANNED" },
    { key: "library", title: t("nipt.workflow.step2"), status: "LIBRARY_PREP" },
    { key: "pooling", title: t("nipt.workflow.step3"), status: "LIBRARY_POOLING" },
    { key: "sequencing", title: t("nipt.workflow.step4"), status: "SEQUENCING" },
    { key: "bioinformatics", title: t("nipt.workflow.step5"), status: "ANALYZING" },
  ];
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
  const [qcMode, setQcMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [qcSelectedIds, setQcSelectedIds] = useState<string[]>([]);

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
    if (createOpen) {
      if (qcMode) {
        samplesApi.list({ status: "COMPLETED", plasma_remaining__gt: 0, page_size: 200 }).then(r => {
          const list = (r.data as any).results || [];
          setSamples(list);
        }).catch(() => {});
      } else {
        samplesApi.list({ status: "IN_PROCESS,PLASMA_SEPARATED", page_size: 200 }).then(r => {
          const list = (r.data as any).results || [];
          setSamples(list);
          // Auto-select all only on first open, not on mode switch
          if (selectedIds.length === 0 && qcSelectedIds.length === 0) {
            setSelectedIds(list.map((s: any) => s.id));
          }
        }).catch(() => {});
      }
    }
  }, [createOpen, qcMode]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const allIds = [...selectedIds, ...qcSelectedIds];
      const payload: any = { panel_code: "NIPT", samples: allIds, notes: values.batch_number || "" };
      if (qcSelectedIds.length > 0) payload.qc_sample_ids = qcSelectedIds;
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
      message.success(`Status: ${STATUS_MAP_TL[status] || status}`);
      setSelectedBatch({ ...selectedBatch, status });
      setActiveStep(STEPS[getStepIndex(status)]?.key || "extraction");
      fetchBatches(); fetchDetail(selectedBatch.id);
    } catch { message.error(t("common.failed")); }
  };

  const handleStepSave = async () => {
    try {
      const values = await stepForm.validateFields();
      message.success(`${STEPS_TL.find(s => s.key === activeStep)?.title} data saved`);
      console.log("Step data:", values);
    } catch { /* validation error */ }
  };

  const nextStatus = selectedBatch ? (() => {
    const order = ["PLANNED", "LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
    const idx = order.indexOf(selectedBatch.status);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  })() : null;

  // Find last batch with data for pre-filling new batches
  const lastBatchLibData = useMemo(() => {
    if (!selectedBatch?.id) return null;
    const sorted = [...batches]
      .filter((b: any) => b.id !== selectedBatch.id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    for (const b of sorted) {
      const lib = b.library_data;
      if (lib && (lib.lib_kit || (lib.equipment || []).length > 0)) return lib;
    }
    return null;
  }, [batches, selectedBatch?.id]);
  const lastBatchSeqData = useMemo(() => {
    if (!selectedBatch?.id) return null;
    const sorted = [...batches]
      .filter((b: any) => b.id !== selectedBatch.id)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    for (const b of sorted) {
      const seq = b.sequencing_data;
      if (seq && (seq.platform || (seq.equipment || []).length > 0)) return seq;
    }
    return null;
  }, [batches, selectedBatch?.id]);

  const batchColumns = [
    { title: t("nipt.workflow.runNumber"), dataIndex: "run_number", key: "run_number", width: 170, render: (v: string) => <Text code>{v}</Text> },
    { title: t("nipt.workflow.samples"), dataIndex: "sample_count", key: "sample_count", width: 70, align: "center" as const },
    { title: t("nipt.workflow.status"), dataIndex: "status", key: "status", width: 110, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{STATUS_MAP_TL[v] || v}</Tag> },
    { title: t("nipt.workflow.created"), dataIndex: "created_at", key: "created_at", width: 100, render: (v: string) => dayjs(v).format("YYYY-MM-DD") },
    { title: "", key: "action", width: 50, render: (_: any, r: any) => (
      <Popconfirm title="Delete?" onConfirm={() => handleDelete(r.id)}><Button type="link" danger size="small" icon={<DeleteOutlined />} /></Popconfirm>
    )},
  ];

  const renderStepForm = () => {
    switch (activeStep) {
      case "extraction":
        return <NiptExtractionTab batch={selectedBatch} samples={batchDetail?.run_samples || batchDetail?.samples || []} onRefresh={() => fetchDetail(selectedBatch.id)} />;
      case "library":
        return <NiptLibraryTab batch={selectedBatch} samples={batchDetail?.run_samples || batchDetail?.samples || []} onRefresh={() => fetchDetail(selectedBatch.id)}
          lastBatchLibData={lastBatchLibData}
        />;
      case "pooling":
        return <NiptPoolingTab batch={selectedBatch} onRefresh={() => fetchDetail(selectedBatch.id)} />;
      case "sequencing":
        return <NiptSequencingTab batch={selectedBatch} onRefresh={() => fetchDetail(selectedBatch.id)} lastBatchSeqData={lastBatchSeqData} />;
      case "bioinformatics":
        return <NiptBioinformaticsTab batch={selectedBatch} samples={batchDetail?.run_samples || batchDetail?.samples || []} onRefresh={() => fetchDetail(selectedBatch.id)} />;
      default:
        return <Empty description={t("nipt.common.selectStep")} />;
    }
  };

  return (
    <DashboardLayout>
      <div style={{ display: "flex", gap: 24, height: "calc(100vh - 160px)" }}>
        <div id="nipt-batch-panel" style={{ width: sidebarCollapsed ? 50 : 480, flexShrink: 0, transition: "width 0.25s", overflow: "hidden" }}>
          {sidebarCollapsed ? (
            <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setSidebarCollapsed(false)}
              style={{ padding: 4, marginTop: 8 }} title={t("nipt.workflow.expandList")} />
          ) : (
            <Card title={<Title level={5} style={{ margin: 0 }}>{t("nipt.workflow.title")}</Title>}
              extra={
                <Space>
                  <Button icon={<ReloadOutlined />} onClick={fetchBatches} />
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreateOpen(true); }}>{t("nipt.workflow.newBatch")}</Button>
                  <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setSidebarCollapsed(true)}
                    style={{ padding: 4 }} title={t("nipt.workflow.collapseList")} />
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

        <Card style={{ flex: 1, overflow: "auto" }} bodyStyle={{ padding: 24 }}>
          {!selectedBatch ? (
            <Empty description={t("workflow.selectBatch")} style={{ marginTop: 80 }} />
          ) : detailLoading ? (
            <div style={{ textAlign: "center", padding: 80 }}>{t("nipt.common.loading")}</div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>{selectedBatch.run_number}</Title>
                  <Space style={{ marginTop: 4 }}>
                    <Tag color={STATUS_COLOR[selectedBatch.status]}>{STATUS_MAP_TL[selectedBatch.status] || selectedBatch.status}</Tag>
                    <Text type="secondary">{selectedBatch.panel_name} | {selectedBatch.sample_count} samples</Text>
                  </Space>
                </div>
                <Space>
                  {nextStatus && (
                    <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => handleAdvance(nextStatus)}>
                      Advance: {STATUS_MAP_TL[nextStatus]}
                    </Button>
                  )}
                  <Button icon={<ReloadOutlined />} onClick={() => fetchDetail(selectedBatch.id)} />
                </Space>
              </div>

              <Tabs activeKey={activeStep} onChange={k => { setActiveStep(k); stepForm.resetFields(); }}
                items={STEPS_TL.map(s => ({ key: s.key, label: s.title }))}
                style={{ marginBottom: 0 }}
              />

              <Card size="small" style={{ background: "#fafafa" }}>
                <Form form={stepForm} layout="vertical" onFinish={handleStepSave}>
                  {renderStepForm()}
                  <div style={{ textAlign: "right", marginTop: 12 }}>
                    <Button type="primary" htmlType="submit">{t("nipt.common.save")}</Button>
                  </div>
                </Form>
              </Card>

              {batchDetail?.samples && batchDetail.samples.length > 0 && (
                <Card size="small" title={`Samples (${batchDetail.samples.length})`} style={{ marginTop: 16 }}>
                  <Table rowKey="id" size="small" dataSource={batchDetail.samples}
                    columns={[
                      { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", width: 150 },
                      { title: "VG ID", dataIndex: "vg_id", width: 80, render: (v: string) => v || "-" },
                      { title: t("nipt.samples.name"), dataIndex: "patient_name", width: 100 },
                      { title: "Plasma", dataIndex: "plasma_remaining", width: 55,
                        render: (v: number) => <Text type={v <= 1 ? "danger" : undefined} strong={v <= 1}>{v ?? "-"}</Text>
                      },
                      { title: "R", dataIndex: "retest_flag", width: 40,
                        render: (v: string) => v ? <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>{v}</Tag> : null
                      },
                      { title: t("nipt.workflow.status"), dataIndex: "status", width: 100,
                        render: (v: string, r: any) => (
                          <span>
                            <Tag>{v}</Tag>
                            {r.is_qc && <Tag color="cyan" style={{ fontSize: 10 }}>QC</Tag>}
                          </span>
                        ),
                      },
                    ]}
                    pagination={false}
                  />
                </Card>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal title={t("nipt.workflow.createTitle")} open={createOpen} onOk={handleCreate} onCancel={() => { setCreateOpen(false); setSelectedIds([]); setQcSelectedIds([]); setQcMode(false); }} confirmLoading={createLoading} width={650} destroyOnClose
        okText={`Create (${selectedIds.length + qcSelectedIds.length} samples)`}
        okButtonProps={{ disabled: selectedIds.length === 0 && qcSelectedIds.length === 0 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="batch_number" label={t("nipt.workflow.batchNumber")} rules={[{ required: true }]}>
            <Input placeholder={t("nipt.workflow.batchNumberPlaceholder")} />
          </Form.Item>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <Text strong>{t("nipt.workflow.selectSamples")}</Text>
            <Switch
              checkedChildren="QC样本" unCheckedChildren="普通样本"
              checked={qcMode} onChange={setQcMode}
              style={{ marginLeft: 8 }}
            />
            <Tag color="blue" style={{ fontSize: 13, padding: "2px 10px" }}>{samples.length} 待处理</Tag>
            <Tag color="green" style={{ fontSize: 13, padding: "2px 10px" }}>{selectedIds.length + qcSelectedIds.length} selected</Tag>
            {selectedIds.length !== samples.length && (
              <Button type="link" size="small" onClick={() => { if (qcMode) setQcSelectedIds(samples.map((s: any) => s.id)); else setSelectedIds(samples.map((s: any) => s.id)); }}>{t("nipt.workflow.selectAll")}</Button>
            )}
            {selectedIds.length > 0 && selectedIds.length === samples.length && (
              <Button type="link" size="small" onClick={() => { if (qcMode) setQcSelectedIds([]); else setSelectedIds([]); }}>{t("nipt.workflow.deselectAll")}</Button>
            )}
            <Input.Search
              placeholder={t("nipt.workflow.searchPlaceholder")}
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
              return (s.sample_id || "").toLowerCase().includes(q) || (s.patient_name || "").toLowerCase().includes(q) || (s.vg_id || "").toLowerCase().includes(q);
            })}
            rowSelection={{
              selectedRowKeys: qcMode ? qcSelectedIds : selectedIds,
              onChange: (keys) => { if (qcMode) setQcSelectedIds(keys as string[]); else setSelectedIds(keys as string[]); },
              preserveSelectedRowKeys: true,
            }}
            columns={[
              { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", key: "sample_id", width: 180, render: (v: string) => <Text code style={{ whiteSpace: "nowrap" }}>{v}</Text> },
              { title: "VG ID", dataIndex: "vg_id", key: "vg_id", width: 90, render: (v: string) => v || "-" },
              { title: t("nipt.receiving.patient"), dataIndex: "patient_name", key: "patient_name", width: 110 },
              { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => {
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