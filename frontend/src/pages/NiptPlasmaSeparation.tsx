
import { useState, useEffect, useCallback } from "react";
import {
  Table, Button, Tag, Space, Typography, Modal, Form,
  Input, InputNumber, TimePicker, DatePicker, message, Card, Empty, Row, Col,
  Upload, Popconfirm, Image,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined,
  CameraOutlined, CheckOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { useTranslation } from "../i18n/useTranslation";

const { Title, Text } = Typography;

export default function NiptPlasmaSeparation() {
  const { t } = useTranslation();
  const QC_RESULT_MAP_TL: Record<string, { color: string; label: string }> = {
    PENDING: { color: "default", label: t("nipt.plasmaSeparation.pendingStatus") },
    PASS: { color: "green", label: t("nipt.plasmaSeparation.passStatus") },
    FAIL: { color: "red", label: t("nipt.plasmaSeparation.failStatus") },
  };
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [availableSamples, setAvailableSamples] = useState<any[]>([]);
  const [createSelectedIds, setCreateSelectedIds] = useState<string[]>([]);
  const [sampleSearch, setSampleSearch] = useState("");

  // QC modal
  const [qcOpen, setQcOpen] = useState(false);
  const [qcSample, setQcSample] = useState<any>(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcNote, setQcNote] = useState("");
  const [qcReasons, setQcReasons] = useState<{ code: string; label: string }[]>([]);
  const [plasmaCounts, setPlasmaCounts] = useState<Record<string, number>>({});

  // Signature modal
  const [signOpen, setSignOpen] = useState(false);
  const [signRole, setSignRole] = useState<"operator" | "reviewer">("operator");

  // Photo upload
  const [uploading, setUploading] = useState(false);

  // Batch QC
  const [selectedSampleKeys, setSelectedSampleKeys] = useState<string[]>([]);
  const [batchQcLoading, setBatchQcLoading] = useState(false);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/plasma-separation/", {
        params: { panel: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 50, ordering: "-created_at" },
      });
      setBatches((res.data as any).results || res.data || []);
    } catch {
      message.error("Failed to load batches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/plasma-separation/${id}/`);
      setBatchDetail(res.data);
    } catch {
      message.error("Failed to load batch detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectBatch = (batch: any) => {
    setSelectedBatch(batch);
    fetchDetail(batch.id);
  };

  // Load QC reasons once on mount
  useEffect(() => {
    api.get("/plasma-separation/qc_reasons/")
      .then(r => setQcReasons(r.data))
      .catch(() => {});
  }, []);

  // Load plasma counts from batch detail
  useEffect(() => {
    if (batchDetail?.batch_samples) {
      const map: Record<string, number> = {};
      batchDetail.batch_samples.forEach((ps: any) => {
        if (ps.plasma_count) map[ps.sample] = ps.plasma_count;
      });
      setPlasmaCounts(map);
    }
  }, [batchDetail]);

  useEffect(() => {
    if (createOpen) {
      api.get("/samples/", { params: { status: "RECEIVED", panel: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 200 } })
        .then(r => {
          const list = (r.data as any).results || [];
          setAvailableSamples(list);
          setCreateSelectedIds(list.map((s: any) => s.id));
        })
        .catch(() => {});
    }
  }, [createOpen]);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      const expTime = values.experiment_time;
      const payload = {
        experiment_date: values.experiment_date.format("YYYY-MM-DD"),
        experiment_time: expTime ? expTime.format("HH:mm:ss") : dayjs().format("HH:mm:ss"),
        equipment_type: "HIGH_SPEED",
        sample_ids: createSelectedIds,
        notes: values.notes || "",
      };
      await api.post("/plasma-separation/", payload);
      message.success("Batch created");
      setCreateOpen(false);
      createForm.resetFields();
      fetchBatches();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.error || "Failed to create batch");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/plasma-separation/${id}/`);
      message.success(t("nipt.common.deleted"));
      if (selectedBatch?.id === id) {
        setSelectedBatch(null);
        setBatchDetail(null);
      }
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed to delete");
    }
  };

  const handleQc = (ps: any) => {
    setQcSample(ps);
    setQcNote(ps.notes || "");
    setQcOpen(true);
  };

  const submitQc = async () => {
    if (!qcSample) return;
    setQcLoading(true);
    try {
      await api.patch(
        `/plasma-separation/${selectedBatch.id}/samples/${qcSample.sample}/qc/`,
        { qc_result: "PASS", qc_reason: "", notes: qcNote }
      );
      message.success("QC updated");
      setQcOpen(false);
      fetchDetail(selectedBatch.id);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed to update QC");
    } finally {
      setQcLoading(false);
    }
  };

  const submitQcFail = async (reason: string) => {
    if (!qcSample) return;
    setQcLoading(true);
    try {
      await api.patch(
        `/plasma-separation/${selectedBatch.id}/samples/${qcSample.sample}/qc/`,
        { qc_result: "FAIL", qc_reason: reason, notes: qcNote }
      );
      message.success("Marked as FAIL");
      setQcOpen(false);
      fetchDetail(selectedBatch.id);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed");
    } finally {
      setQcLoading(false);
    }
  };

  const openSignModal = (role: "operator" | "reviewer") => {
    setSignRole(role);
    setSignOpen(true);
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("image", file);
    try {
      await api.post(`/plasma-separation/${selectedBatch.id}/upload_photo/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      message.success("Photo uploaded");
      fetchDetail(selectedBatch.id);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed to upload photo");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handlePhotoDelete = async (photoId: string) => {
    try {
      await api.delete(`/plasma-separation/${selectedBatch.id}/photos/${photoId}/`);
      message.success("Photo deleted");
      fetchDetail(selectedBatch.id);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed to delete photo");
    }
  };

  const handleBatchPass = async () => {
    const samples = batchDetail?.batch_samples || [];
    const targets = samples.filter((s: any) => selectedSampleKeys.includes(s.id));
    if (targets.length === 0) { message.warning("Select samples first"); return; }
    setBatchQcLoading(true);
    let ok = 0;
    for (const s of targets) {
      try {
        await api.patch(`/plasma-separation/${selectedBatch.id}/samples/${s.sample}/qc/`,
          { qc_result: "PASS", qc_reason: "", notes: qcNote });
        ok++;
      } catch (e: any) { /* skip failed */ }
    }
    message.success(`${ok}/${targets.length} marked Pass`);
    setSelectedSampleKeys([]);
    setBatchQcLoading(false);
    fetchDetail(selectedBatch.id);
  };

  const handleComplete = async () => {
    if (!selectedBatch) return;
    try {
      await api.post(`/plasma-separation/${selectedBatch.id}/complete/`);
      message.success("Batch completed");
      fetchDetail(selectedBatch.id);
      fetchBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "Failed to complete batch");
    }
  };

  const columns = [
    {
      title: t("nipt.plasmaSeparation.batchNumber"), dataIndex: "batch_number", key: "batch_number", width: 240,
      render: (v: string) => <Text code style={{ whiteSpace: "nowrap" }}>{v}</Text>,
    },
    {
      title: t("nipt.plasmaSeparation.sampleCount"), dataIndex: "sample_count", key: "sample_count", width: 80,
    },
    {
      title: t("nipt.samples.status"), dataIndex: "status_display", key: "status", width: 110,
      render: (v: string, r: any) => {
        const statusMap: Record<string, string> = {
          "In Progress": t("nipt.plasmaSeparation.inProgress"),
          "Completed": t("nipt.plasmaSeparation.completedStatus"),
        };
        return <Tag color={r.status === "COMPLETED" ? "green" : "blue"}>{statusMap[v] || v}</Tag>;
      },
    },
    {
      title: "", key: "actions", width: 40,
      render: (_: any, r: any) => (
        <Popconfirm title={t("nipt.samples.delete")} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={r.status === "COMPLETED"} />
        </Popconfirm>
      ),
    },
  ];

  const allQcDone = batchDetail?.batch_samples?.every((s: any) => s.qc_result !== "PENDING");
  const opSigned = batchDetail?.operator_signature_data && (Array.isArray(batchDetail.operator_signature_data) ? batchDetail.operator_signature_data.length > 0 : batchDetail.operator_signature_data.username) || batchDetail?.operator_signature;
  const rvSigned = batchDetail?.reviewer_signature_data && (Array.isArray(batchDetail.reviewer_signature_data) ? batchDetail.reviewer_signature_data.length > 0 : batchDetail.reviewer_signature_data.username) || batchDetail?.reviewer_signature;
  const canComplete = allQcDone && opSigned && rvSigned && batchDetail?.photos?.length > 0;

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)" }}>
      {/* ── Left: Batch List ── */}
      <Card
        title={<Title level={5} style={{ margin: 0 }}>🩸 {t("nipt.plasmaSeparation.title")}</Title>}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchBatches} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              createForm.resetFields();
              setCreateOpen(true);
              api.get("/samples/", { params: { status: "RECEIVED", panel: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 200 } })
                .then(r => {
                  const list = (r.data as any).results || [];
                  setAvailableSamples(list);
                  setCreateSelectedIds(list.map((s: any) => s.id));
                })
                .catch(() => {});
            }}>
              {t("nipt.plasmaSeparation.newBatch")}
            </Button>
          </Space>
        }
        style={{ width: 340, flexShrink: 0, overflow: "auto" }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={batches}
          loading={loading}
          size="small"
          pagination={false}
          showHeader={true}
          onRow={(r) => ({
            onClick: () => selectBatch(r),
            style: { cursor: "pointer", background: selectedBatch?.id === r.id ? "#e6f7ff" : undefined },
          })}
        />
      </Card>

      {/* ── Right: Batch Detail ── */}
      <Card
        style={{ flex: 1, overflow: "auto" }}
        bodyStyle={{ padding: selectedBatch ? 16 : undefined }}
      >
        {!selectedBatch ? (
          <Empty description={t("nipt.plasmaSeparation.selectBatch")} style={{ marginTop: 80 }} />
        ) : detailLoading ? (
          <Text type="secondary">{t("nipt.plasmaSeparation.loading")}</Text>
        ) : batchDetail ? (
          <>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Space>
                <Title level={4} style={{ margin: 0 }}>{batchDetail.batch_number}</Title>
                <Tag color={batchDetail.status === "COMPLETED" ? "green" : "blue"}>
                  {batchDetail.status_display}
                </Tag>
              </Space>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => fetchDetail(selectedBatch.id)} />
                <Popconfirm
                  title={t("nipt.plasmaSeparation.completeConfirm")}
                  onConfirm={handleComplete}
                  disabled={!canComplete}
                >
                  <Button type="primary" icon={<CheckOutlined />} disabled={!canComplete}>
                    {t("nipt.plasmaSeparation.complete")}
                  </Button>
                </Popconfirm>
              </Space>
            </div>

            {/* Info bar */}
            <Row gutter={16} style={{ marginBottom: 12, padding: "8px 12px", background: "#fafafa", borderRadius: 6 }}>
              <Col><Text type="secondary">{t("nipt.extraction.experimentDate")}: </Text><Text strong>{batchDetail.experiment_date}</Text></Col>
              <Col><Text type="secondary">{t("nipt.extraction.experimentTime")}: </Text><Text strong>{batchDetail.experiment_time}</Text></Col>
              <Col><Text type="secondary">{t("nipt.plasmaSeparation.samples")}: </Text><Text strong>{batchDetail.batch_samples?.length || 0}</Text></Col>
            </Row>

            {/* Equipment Type */}
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fafafa", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <Text type="secondary">{t("nipt.plasmaSeparation.equipment")}</Text>
              <Tag color="blue">{t("nipt.plasmaSeparation.highSpeedCentrifuge")}</Tag>
              <Tag color="orange">{t("nipt.plasmaSeparation.lowSpeedCentrifuge")}</Tag>
            </div>

            {/* Photos */}
            <Card size="small" title={`${t("nipt.plasmaSeparation.photos")} (${batchDetail.photos?.length || 0})`} style={{ marginBottom: 12 }}
              extra={
                <Upload showUploadList={false} beforeUpload={handlePhotoUpload} accept="image/*" disabled={batchDetail.status === "COMPLETED"}>
                  <Button size="small" icon={<CameraOutlined />} loading={uploading} disabled={batchDetail.status === "COMPLETED"}>
                    {t("nipt.plasmaSeparation.upload")}
                  </Button>
                </Upload>
              }
            >
              {batchDetail.photos?.length > 0 ? (
                <Image.PreviewGroup>
                  <Space wrap>
                    {batchDetail.photos.map((p: any) => (
                      <div key={p.id} style={{ position: "relative", display: "inline-block" }}>
                      <Image src={p.image} width={100} height={80} style={{ objectFit: "cover", borderRadius: 4 }} />
                      <Button size="small" danger type="text" icon={<DeleteOutlined />}
                        style={{ position: "absolute", top: -8, right: -8, background: "#fff", borderRadius: "50%", padding: 0, minWidth: 20, height: 20 }}
                        onClick={() => handlePhotoDelete(p.id)}
                        disabled={batchDetail.status === "COMPLETED"} />
                    </div>
                    ))}
                  </Space>
                </Image.PreviewGroup>
              ) : (
                <Text type="secondary">{t("nipt.plasmaSeparation.noPhotos")}</Text>
              )}
            </Card>

            {/* Samples with QC */}
            <Card size="small" title={`${t("nipt.plasmaSeparation.samples")} (${batchDetail.batch_samples?.length || 0})`} style={{ marginBottom: 12 }}
              extra={
                <Space>
                  <Text type="secondary">
                    {t("nipt.plasmaSeparation.pass")}: {batchDetail.batch_samples?.filter((s: any) => s.qc_result === "PASS").length || 0}
                    {" / "}{t("nipt.plasmaSeparation.fail")}: {batchDetail.batch_samples?.filter((s: any) => s.qc_result === "FAIL").length || 0}
                    {" / "}{t("nipt.plasmaSeparation.pending")}: {batchDetail.batch_samples?.filter((s: any) => s.qc_result === "PENDING").length || 0}
                  </Text>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={batchQcLoading}
                    onClick={handleBatchPass}
                    disabled={batchDetail.status === "COMPLETED" || selectedSampleKeys.length === 0}
                  >
                    {t("nipt.plasmaSeparation.batchPass")} ({selectedSampleKeys.length})
                  </Button>
                </Space>
              }
            >
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={batchDetail.batch_samples || []}
                rowSelection={{
                  selectedRowKeys: selectedSampleKeys,
                  onChange: (keys) => setSelectedSampleKeys(keys as string[]),
                  getCheckboxProps: (r: any) => ({
                    disabled: batchDetail.status === "COMPLETED" || r.qc_result !== "PENDING",
                  }),
                }}
                columns={[
                  { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", key: "sample_id", width: 150, render: (v: string) => <Text code style={{ whiteSpace: "nowrap" }}>{v}</Text> },
                  { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
                  { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 90,
                    render: (v: string) => {
                      if (!v) return <Text type="secondary">-</Text>;
                      const colors: Record<string, string> = { "Basic": "blue", "Plus": "purple", "Basic All": "green" };
                      return <Tag color={colors[v] || "default"} style={{ fontSize: 11 }}>{v}</Tag>;
                    },
                  },
                  { title: t("nipt.receiving.patient"), dataIndex: "patient_name", key: "patient_name", width: 110 },
                  {
                    title: "Plasma", dataIndex: "plasma_count", key: "plasma_count", width: 70,
                    render: (v: number, r: any) => {
                      const key = r.sample || r.id;
                      const val = plasmaCounts[key] ?? v ?? 3;
                      return (
                        <InputNumber size="small" min={1} max={10} value={val}
                          onChange={(nv) => {
                            const newVal = nv ?? 3;
                            setPlasmaCounts(prev => ({ ...prev, [key]: newVal }));
                            api.patch(
                              `/plasma-separation/${selectedBatch.id}/samples/${key}/qc/`,
                              { plasma_count: newVal }
                            ).catch(() => {});
                          }}
                          style={{ width: 55 }}
                          disabled={batchDetail.status === "COMPLETED"}
                        />
                      );
                    },
                  },
                  {
                    title: "QC", dataIndex: "qc_result", key: "qc_result", width: 100,
                    render: (v: string) => <Tag color={QC_RESULT_MAP_TL[v]?.color}>{QC_RESULT_MAP_TL[v]?.label || v}</Tag>,
                  },
                  { title: t("nipt.plasmaSeparation.reasonNotes"), dataIndex: "notes", key: "notes", width: 160, ellipsis: true,
                    render: (v: string, r: any) => {
                      const reason = qcReasons.find(q => q.code === r.qc_reason);
                      return (
                        <span>
                          {r.qc_reason && reason ? <Tag color="red" style={{ marginRight: 4 }}>{reason.label}</Tag> : null}
                          {v ? <Text style={{ fontSize: 12 }}>{v}</Text> : (!r.qc_reason ? <Text type="secondary">-</Text> : null)}
                        </span>
                      );
                    },
                  },
                  {
                    title: t("nipt.receiving.action"), key: "action", width: 90,
                    render: (_: any, r: any) => (
                      <Button size="small" onClick={() => handleQc(r)} disabled={batchDetail.status === "COMPLETED"}>
                        {r.qc_result === "PENDING" ? t("nipt.plasmaSeparation.qc") : t("nipt.plasmaSeparation.edit")}
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>

            {/* Signatures */}
            <Card size="small" title={t("nipt.plasmaSeparation.signatures")} style={{ marginBottom: 12 }}>
              <Space size="large">
                <div>
                  <Text type="secondary">{t("nipt.extraction.operatorLabel")}: </Text>
                  {opSigned ? (
                    <Space>
                      <Text strong>{Array.isArray(batchDetail.operator_signature_data) ? batchDetail.operator_signature_data.map((s: any) => s.username).join(", ") : batchDetail.operator_signature_data?.username || batchDetail.operator_name}</Text>
                      <Tag color="green">✓</Tag>
                    </Space>
                  ) : (
                    <Button size="small" icon={<UserOutlined />} onClick={() => openSignModal("operator")}
                      disabled={batchDetail.status === "COMPLETED"}>
                      {t("nipt.plasmaSeparation.sign")}
                    </Button>
                  )}
                </div>
                <div>
                  <Text type="secondary">{t("nipt.extraction.reviewerLabel")}: </Text>
                  {rvSigned ? (
                    <Space>
                      <Text strong>{Array.isArray(batchDetail.reviewer_signature_data) ? batchDetail.reviewer_signature_data.map((s: any) => s.username).join(", ") : batchDetail.reviewer_signature_data?.username || batchDetail.reviewer_name}</Text>
                      <Tag color="green">✓</Tag>
                    </Space>
                  ) : (
                    <Button size="small" icon={<UserOutlined />} onClick={() => openSignModal("reviewer")}
                      disabled={batchDetail.status === "COMPLETED"}>
                      {t("nipt.plasmaSeparation.sign")}
                    </Button>
                  )}
                </div>
              </Space>
            </Card>

            {/* Not ready warning */}
            {!canComplete && batchDetail.status !== "COMPLETED" && (
              <Card size="small" style={{ background: "#fffbe6", border: "1px solid #ffe58f" }}>
                <Text type="warning">
                  {t("nipt.plasmaSeparation.cannotComplete")}:
                  {!allQcDone && ` • ${t("nipt.plasmaSeparation.allSamplesNeedQc")}`}
                  {!opSigned && ` • ${t("nipt.plasmaSeparation.operatorSignatureRequired")}`}
                  {!rvSigned && ` • ${t("nipt.plasmaSeparation.reviewerSignatureRequired")}`}
                  {!batchDetail?.photos?.length && ` • ${t("nipt.plasmaSeparation.photosRequired")}`}
                </Text>
              </Card>
            )}
          </>
        ) : null}
      </Card>

      {/* ── Create Batch Modal ── */}
      <Modal
        title={t("nipt.plasmaSeparation.createTitle")}
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateOpen(false); setCreateSelectedIds([]); }}
        confirmLoading={createLoading}
        width={650}
        destroyOnClose
        okText={`Create (${createSelectedIds.length} samples)`}
        okButtonProps={{ disabled: createSelectedIds.length === 0 }}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="experiment_date" label="Experiment Date" rules={[{ required: true }]} initialValue={dayjs()}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="experiment_time" label="Experiment Time" rules={[{ required: true }]} initialValue={dayjs()}>
                <TimePicker format="HH:mm" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <Text strong>{t("nipt.plasmaSeparation.selectSamples")}</Text>
            <Tag color="blue" style={{ fontSize: 13, padding: "2px 10px" }}>
              {availableSamples.length} RECEIVED
            </Tag>
            <Tag color="green" style={{ fontSize: 13, padding: "2px 10px" }}>
              {createSelectedIds.length} selected
            </Tag>
            {createSelectedIds.length !== availableSamples.length && (
              <Button type="link" size="small" onClick={() => setCreateSelectedIds(availableSamples.map(s => s.id))}>
                Select all
              </Button>
            )}
            {createSelectedIds.length > 0 && createSelectedIds.length === availableSamples.length && (
              <Button type="link" size="small" onClick={() => setCreateSelectedIds([])}>
                Deselect all
              </Button>
            )}
            <Input.Search
              placeholder={t("nipt.plasmaSeparation.searchPlaceholder")}
              allowClear
              size="small"
              style={{ width: 220, marginLeft: "auto" }}
              value={sampleSearch}
              onChange={e => setSampleSearch(e.target.value)}
            />
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ y: 280 }}
            dataSource={availableSamples.filter((s: any) => {
              if (!sampleSearch) return true;
              const q = sampleSearch.toLowerCase();
              return (s.sample_id || "").toLowerCase().includes(q) ||
                     (s.patient_name || "").toLowerCase().includes(q);
            })}
            rowSelection={{
              selectedRowKeys: createSelectedIds,
              onChange: (keys) => setCreateSelectedIds(keys as string[]),
              preserveSelectedRowKeys: true,
            }}
            columns={[
              { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", key: "sample_id", width: 170, render: (v: string) => <Text code style={{ whiteSpace: "nowrap" }}>{v}</Text> },
              { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 90, render: (v: string) => v || "-" },
              { title: t("nipt.receiving.patient"), dataIndex: "patient_name", key: "patient_name" },
              { title: "Panel", dataIndex: "panel_name", key: "panel_name", width: 80 },
            ]}
          />
          <Form.Item name="notes" label="Notes" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── QC Modal ── */}
      <Modal
        title={`QC: ${qcSample?.sample_id || ""}`}
        open={qcOpen}
        onCancel={() => setQcOpen(false)}
        footer={null}
        width={440}
      >
        {qcSample && (
          <div style={{ textAlign: "center" }}>
            <Text strong style={{ fontSize: 16 }}>{qcSample.patient_name || qcSample.sample_id}</Text>
            <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "center" }}>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                style={{ width: 120 }}
                loading={qcLoading}
                onClick={submitQc}
              >
                {t("nipt.plasmaSeparation.pass")}
              </Button>
            </div>
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">{t("nipt.plasmaSeparation.failSelectReason")}</Text>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {qcReasons.length > 0 ? qcReasons.map(r => (
                  <Button
                    key={r.code}
                    size="small"
                    danger
                    onClick={() => submitQcFail(r.code)}
                    loading={qcLoading}
                  >
                    {r.label}
                  </Button>
                )) : <Text type="secondary">{t("nipt.plasmaSeparation.loading")}</Text>}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">备注:</Text>
              <Input.TextArea
                rows={2}
                value={qcNote}
                onChange={e => setQcNote(e.target.value)}
                placeholder="可选备注（如 Pass 但有注意事项）"
                style={{ marginTop: 4 }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Signature Modal ── */}
      <NiptSignerModal
        open={signOpen}
        role={signRole}
        roleLabel={signRole === "operator" ? "操作人" : "复核人"}
        batchId={selectedBatch?.id}
        currentSigner={
          signRole === "operator"
            ? (Array.isArray(batchDetail?.operator_signature_data) ? batchDetail?.operator_signature_data.map((s: any) => s.username).join(", ") : batchDetail?.operator_signature_data?.username) || null
            : (Array.isArray(batchDetail?.reviewer_signature_data) ? batchDetail?.reviewer_signature_data.map((s: any) => s.username).join(", ") : batchDetail?.reviewer_signature_data?.username) || null
        }
        onDone={() => { setSignOpen(false); fetchDetail(selectedBatch.id); }}
        onCancel={() => setSignOpen(false)}
      />
    </div>
  );
}
