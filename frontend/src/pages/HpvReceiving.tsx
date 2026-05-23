import { useEffect, useState, useRef, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Select, Input, DatePicker, Space, Typography, message, Card, Row, Col, Divider, Tabs } from "antd";
import { CheckOutlined, CloseOutlined, CameraOutlined, UploadOutlined, DeleteOutlined } from "@ant-design/icons";
import api from "../api/client";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green",
};

interface PhotoItem {
  uid: string;
  file?: File;
  previewUrl?: string;
  uploadedId?: number;
  uploading: boolean;
  sampleIndices: Set<number>;
}

const REJECTION_REASONS = [
  { label: "标识不清", value: "UNCLEAR_LABEL" },
  { label: "信息不全", value: "INCOMPLETE_INFO" },
  { label: "量不足", value: "INSUFFICIENT_VOLUME" },
  { label: "爆管", value: "BURST_TUBE" },
  { label: "漏液", value: "LEAKAGE" },
  { label: "污染", value: "CONTAMINATED" },
  { label: "运输温度超标", value: "TEMP_EXCEEDED" },
  { label: "其他", value: "OTHER" },
];

const HANDLING_MEASURES = [
  { label: "要求重新送样", value: "REQUEST_RESUBMIT" },
  { label: "与客户沟通后继续检测", value: "PROCEED_AFTER_COMM" },
  { label: "退回客户", value: "RETURN_TO_CUSTOMER" },
  { label: "报废处理", value: "DISPOSE" },
  { label: "其他", value: "OTHER" },
];

export default function HpvReceiving() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedSample, setSelectedSample] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<any>(null);
  const [receivers, setReceivers] = useState<any[]>([]);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null);
  const [receiverPassword, setReceiverPassword] = useState("");
  const [receiptDate, setReceiptDate] = useState<any>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [form] = Form.useForm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<string>('pending');
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const fetchTabCounts = useCallback(() => {
    // Use HPV-specific dashboard stats for consistency
    api.get("/hpv/batches/dashboard_stats/").then((res) => {
      const ds = res.data || {};
      setTabCounts(prev => ({
        ...prev,
        pending: ds.pending ?? 0,
        received: ds.received ?? 0,
      }));
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchTabCounts(); }, [fetchTabCounts]);

  const fetchData = useCallback(() => {
    setLoading(true);
    if (activeTab === "pending") {
      api.get("/samples/", { params: { panel: "HPV", status: "REGISTERED,RECEIVING" } })
        .then(r => setData(r.data.results || r.data))
        .catch(() => message.error("Failed to load samples"))
        .finally(() => setLoading(false));
    } else if (activeTab === "received") {
      Promise.all([
        api.get("/samples/", { params: { panel: "HPV", status: "RECEIVED,ACCEPTED", limit: 200 } }),
        api.get("/hpv/batches/"),
      ]).then(([r, bRes]) => {
        const batches = (bRes.data.results || bRes.data || []);
        const batchedIds = new Set<string>();
        batches.forEach((b: any) => {
          (b.well_positions || []).forEach((wp: any) => {
            if (wp.sample) batchedIds.add(wp.sample);
          });
        });
        const filtered = (r.data.results || r.data || []).filter((s: any) => !batchedIds.has(s.id));
        setData(filtered);
      }).catch(() => message.error("Failed to load samples"))
        .finally(() => setLoading(false));
    } else if (activeTab === "pending_experiment") {
      // Fetch RECEIVED samples + NEEDS_RETEST samples + all batches (to exclude already-assigned samples)
      Promise.all([
        api.get("/samples/", { params: { panel: "HPV", status: "RECEIVED,ACCEPTED", limit: 200 } }),
        api.get("/hpv/results/", { params: { review_status: "NEEDS_RETEST" } }),
        api.get("/hpv/batches/"),
      ]).then(([receivedRes, retestRes, batchesRes]) => {
        // Collect sample IDs already assigned to well positions
        const batches = (batchesRes.data.results || batchesRes.data || []);
        const batchedSampleIds = new Set<string>();
        batches.forEach((b: any) => {
          (b.well_positions || []).forEach((wp: any) => {
            if (wp.sample) batchedSampleIds.add(wp.sample);
          });
        });

        const received = (receivedRes.data.results || receivedRes.data || []);
        const retestResults = (retestRes.data.results || retestRes.data || []);
        // Filter out batched samples
        const receivedRows = received
          .filter((s: any) => !batchedSampleIds.has(s.id))
          .map((s: any) => ({ ...s, _source: "received" }));
        // Get retest sample IDs and fetch their details individually (exclude batched)
        const retestSampleIds = [...new Set(
          retestResults
            .filter((r: any) => !batchedSampleIds.has(r.sample))
            .map((r: any) => r.sample)
        )];
        if (retestSampleIds.length > 0 && retestSampleIds.length <= 50) {
          return Promise.all(
            (retestSampleIds as string[]).map((sid: string) =>
              api.get(`/samples/${sid}/`).catch(() => null)
            )
          ).then(retestSampleResponses => {
            const retestRows = retestSampleResponses
              .filter((res: any) => res !== null)
              .map((res: any) => {
                const s = res.data;
                const result = retestResults.find((r: any) => r.sample === s.id);
                return { ...s, _source: "retest", _retest_reason: result?.rejection_reason || result?.review_status || "", _result_id: result?.id || "" };
              });
            // Merge: retest takes priority, deduplicate received
            const retestIds = new Set(retestRows.map((r: any) => r.id));
            const uniqueReceived = receivedRows.filter((r: any) => !retestIds.has(r.id));
            const merged = [...retestRows, ...uniqueReceived];
            setData(merged);
            setTabCounts(prev => ({ ...prev, pending_experiment: merged.length }));
          });
        } else {
          setData(receivedRows);
          setTabCounts(prev => ({ ...prev, pending_experiment: receivedRows.length }));
        }
      }).catch(() => message.error("Failed to load samples"))
        .finally(() => setLoading(false));
    }
  }, [activeTab]);


const fetchReceivers = () => {
    api.get("/receivers/").then(r => setReceivers(r.data?.results || r.data || []))
      .catch(() => {});
  };

  useEffect(() => { fetchData(); fetchReceivers(); if (activeTab === "pending_experiment") { /* counts set in fetchData */ } else { fetchTabCounts(); } }, [fetchData]);

  const selectedSamples = data.filter((s: any) => selectedRowKeys.includes(s.id));

  const pendingColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 150 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Sample Source", dataIndex: "sample_source", key: "sample_source", width: 120 },
    { title: "Collection Date", dataIndex: "collection_date", key: "collection_date", width: 120 },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (s: string) => <Tag color={STATUS_MAP[s] || "default"}>{s}</Tag>,
    },
    {
      title: "Action", key: "action", width: 160,
      render: (_: any, record: any) => (
        <Space>
          <Button type="primary" size="small" icon={<CheckOutlined />}
            onClick={() => handleSingleReceive(record)}>
            Receive
          </Button>
          <Button danger size="small" icon={<CloseOutlined />}
            onClick={() => { setSelectedSample(record); setRejectOpen(true); }}>
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  const receivedColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 150 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Sample Source", dataIndex: "sample_source", key: "sample_source", width: 120 },
    { title: "Collection Date", dataIndex: "collection_date", key: "collection_date", width: 120 },
    {
      title: "Receiver", dataIndex: "received_by_name", key: "received_by_name", width: 100,
      render: (v: string) => v || "-",
    },
    {
      title: "Receipt Date", dataIndex: "receipt_date", key: "receipt_date", width: 120,
      render: (d: string) => d ? d.slice(0, 10) : "-",
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (s: string) => <Tag color={STATUS_MAP[s] || "default"}>{s}</Tag>,
    },
  ];

  const pendingExperimentColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 150 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Sample Source", dataIndex: "sample_source", key: "sample_source", width: 120 },
    { title: "Collection Date", dataIndex: "collection_date", key: "collection_date", width: 120 },
    {
      title: "类型", dataIndex: "_source", key: "_source", width: 90,
      render: (v: string) => v === "retest"
        ? <Tag color="volcano">复查</Tag>
        : <Tag color="blue">待实验</Tag>,
    },
    {
      title: "复查原因", dataIndex: "_retest_reason", key: "_retest_reason", width: 130,
      render: (v: string) => {
        if (!v) return "-";
        const map: Record<string, string> = { POSITIVE: "阳性复查", IC_NO_SIGNAL: "IC无信号", QC_FAILURE: "质控失控", OTHER: "其他" };
        return map[v] || v;
      },
    },
    {
      title: "Receiver", dataIndex: "received_by_name", key: "received_by_name", width: 100,
      render: (v: string) => v || "-",
    },
    {
      title: "Receipt Date", dataIndex: "receipt_date", key: "receipt_date", width: 120,
      render: (d: string) => d ? d.slice(0, 10) : "-",
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (s: string) => <Tag color={STATUS_MAP[s] || "default"}>{s}</Tag>,
    },
  ];

  const columns = activeTab === "pending" ? pendingColumns
    : activeTab === "pending_experiment" ? pendingExperimentColumns
    : receivedColumns;

  const handleSingleReceive = (record: any) => {
    setReceiveTarget(record);
    setSelectedReceiverId(null);
    setReceiverPassword("");
    setReceiptDate(null);
    setReceiveModalOpen(true);
  };

  
  const handleConfirmReceive = async () => {
    if (!receiveTarget) return;
    if (!selectedReceiverId) { message.warning("请选择签收人"); return; }
    if (!receiverPassword) { message.warning("请输入签收密码"); return; }

    setReceiveLoading(true);
    try {
      await api.post(`/samples/${receiveTarget.id}/accept/`, {
        receiver_id: selectedReceiverId,
        receiver_password: receiverPassword,
        receipt_date: receiptDate ? receiptDate.format("YYYY-MM-DD") : undefined,
      });
      message.success(`Sample ${receiveTarget.sample_id} received`);
      setReceiveModalOpen(false);
      fetchData();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error
        || data?.detail
        || (typeof data === 'object' && data !== null
            ? Object.values(data).flat()[0]
            : null);
      message.error(msg || "Failed to receive sample");
    } finally {
      setReceiveLoading(false);
    }
  };

  const handleReject = () => {
    form.validateFields().then((values: any) => {
      api.post(`/samples/${selectedSample.id}/reject/`, {
        rejection_reason: values.rejection_reason,
        rejection_note: values.rejection_note || "",
        rejection_handling: values.rejection_handling || "",
        rejection_communication: values.rejection_communication || "",
      }).then(() => {
        message.success(`Sample ${selectedSample.sample_id} rejected`);
        setRejectOpen(false);
        form.resetFields();
        fetchData();
      }).catch(() => message.error("Failed to reject sample"));
    });
  };

  const openBatchModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning("Select at least one sample first");
      return;
    }
    setPhotos([]);
    setBatchOpen(true);
  };

  const addPhotos = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newPhotos: PhotoItem[] = fileArray.map((file, i) => ({
      uid: `photo-${Date.now()}-${i}`,
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: false,
      sampleIndices: new Set(selectedSamples.map((_, i) => i)),
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (uid: string) => {
    setPhotos(prev => {
      const p = prev.find(x => x.uid === uid);
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return prev.filter(x => x.uid !== uid);
    });
  };

  const togglePhotoSample = (photoUid: string, sampleIdx: number) => {
    setPhotos(prev => prev.map(p => {
      if (p.uid !== photoUid) return p;
      const next = new Set(p.sampleIndices);
      if (next.has(sampleIdx)) next.delete(sampleIdx);
      else next.add(sampleIdx);
      return { ...p, sampleIndices: next };
    }));
  };

  const selectAllForPhoto = (photoUid: string) => {
    setPhotos(prev => prev.map(p => {
      if (p.uid !== photoUid) return p;
      return { ...p, sampleIndices: new Set(selectedSamples.map((_, i) => i)) };
    }));
  };

  const deselectAllForPhoto = (photoUid: string) => {
    setPhotos(prev => prev.map(p => {
      if (p.uid !== photoUid) return p;
      return { ...p, sampleIndices: new Set() };
    }));
  };

  const handleBatchReceive = async () => {
    const sampleIds = selectedSamples.map((s: any) => s.id);
    
    setBatchLoading(true);
    try {
      await Promise.all(sampleIds.map((id: number) => 
        api.post(`/samples/${id}/accept/`, {
          receiver_id: selectedReceiverId,
          receiver_password: receiverPassword,
          receipt_date: receiptDate ? receiptDate.format("YYYY-MM-DD") : undefined,
        }).catch((err: any) => {
          console.error(`Failed to accept sample ${id}:`, err);
        })
      ));

      const uploadResults = await Promise.all(
        photos.filter(p => p.file && p.sampleIndices.size > 0).map(async (photo) => {
          const formData = new FormData();
          formData.append("image", photo.file!);
          const photoSampleIds = Array.from(photo.sampleIndices)
            .map(idx => sampleIds[idx])
            .filter(Boolean);
          
          if (photoSampleIds.length > 0) {
            formData.append("sample_ids", JSON.stringify(photoSampleIds));
          }

          try {
            const res = await api.post("/photos/", formData, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            return { uid: photo.uid, success: true, id: res.data.id };
          } catch (err: any) {
            return { uid: photo.uid, success: false, error: err?.response?.data || "Upload failed" };
          }
        })
      );

      const succeeded = uploadResults.filter(r => r.success).length;
      const failed = uploadResults.filter(r => !r.success).length;
      
      message.success(
        `Received ${sampleIds.length} sample(s). ` +
        (photos.length > 0 ? `Photos: ${succeeded} uploaded${failed > 0 ? `, ${failed} failed` : ""}.` : "")
      );
      setBatchOpen(false);
      setSelectedRowKeys([]);
      fetchData();
    } catch (e) {
      message.error("Batch receive failed");
    } finally {
      setBatchLoading(false);
    }
  };

  const closeBatchModal = () => {
    photos.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
    setPhotos([]);
    setBatchOpen(false);
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={(k) => { setActiveTab(k); setSelectedRowKeys([]); fetchData(); }}
        items={[
          { key: "pending", label: `Pending (${tabCounts.pending ?? "..."})` },
          { key: "received", label: `Received (${tabCounts.received ?? "..."})` },
          { key: "pending_experiment", label: `待实验样本 (${tabCounts.pending_experiment ?? "..."})` },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Space style={{ justifyContent: "space-between", width: "100%", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Sample Receiving</Title>
        {activeTab === "pending" && (
          <Button 
            type="primary" 
            icon={<CameraOutlined />}
            disabled={selectedRowKeys.length === 0}
            onClick={openBatchModal}
          >
            Batch Receive & Photo ({selectedRowKeys.length})
          </Button>
        )}
      </Space>

      <Table 
        rowKey="id" 
        rowSelection={activeTab === "pending" ? rowSelection : undefined}
        columns={columns} 
        dataSource={data} 
        loading={loading} 
        pagination={{ pageSize: 20 }} 
      />

      {/* Receive Confirmation Modal */}
      <Modal
        title={`样本签收确认 — ${receiveTarget?.sample_id || ""}`}
        open={receiveModalOpen}
        onOk={handleConfirmReceive}
        onCancel={() => { setReceiveModalOpen(false); }}
        confirmLoading={receiveLoading}
        okText="确认签收"
        width={420}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>{receiveTarget?.patient_name || ""}</Text>
        </div>
        <Form layout="vertical">
          <Form.Item label="签收人" required>
            <Select
              placeholder="请选择签收人"
              value={selectedReceiverId}
              onChange={setSelectedReceiverId}
              options={receivers.map((r: any) => ({ label: r.name, value: r.id }))}
            />
          </Form.Item>
          <Form.Item label="签收密码" required>
            <Input.Password
              placeholder="请输入签收人密码"
              value={receiverPassword}
              onChange={e => setReceiverPassword(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="签收日期">
            <DatePicker
              style={{ width: "100%" }}
              value={receiptDate}
              onChange={setReceiptDate}
              placeholder="默认今天"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reject Modal */}
      <Modal 
        title={`Reject Sample — ${selectedSample?.sample_id || ""}`} 
        open={rejectOpen} 
        onOk={handleReject} 
        onCancel={() => { setRejectOpen(false); form.resetFields(); }} 
        destroyOnClose
        width={600}
        okText="Confirm Reject"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="rejection_reason" label="不合格原因" rules={[{ required: true, message: "请选择不合格原因" }]}>
            <Select placeholder="请选择不合格原因" options={REJECTION_REASONS} />
          </Form.Item>

          <Form.Item name="rejection_handling" label="处理措施">
            <Select 
              placeholder="请选择处理措施" 
              options={HANDLING_MEASURES}
              allowClear
            />
          </Form.Item>

          <Form.Item name="rejection_communication" label="与客户沟通记录">
            <TextArea 
              rows={3} 
              placeholder="记录与客户的沟通内容、时间、方式等..." 
            />
          </Form.Item>

          <Form.Item name="rejection_note" label="备注">
            <TextArea rows={2} placeholder="其他备注信息..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch Receive Modal */}
      <Modal
        title={`Batch Receive — ${selectedSamples.length} sample(s) selected`}
        open={batchOpen}
        onOk={handleBatchReceive}
        onCancel={closeBatchModal}
        confirmLoading={batchLoading}
        width={900}
        destroyOnClose
        okText="Receive All & Upload Photos"
      >
        <Card size="small" style={{ marginBottom: 16, background: "#fafafa" }}>
          <Text strong>Selected samples:</Text>
          <div style={{ maxHeight: 120, overflowY: "auto", marginTop: 8 }}>
            {selectedSamples.map((s: any, i: number) => (
              <Tag key={s.id} color="blue" style={{ marginBottom: 4 }}>
                [{i + 1}] {s.sample_id} — {s.patient_name}
              </Tag>
            ))}
          </div>
        </Card>

        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <Form.Item label="签收人" required>
            <Select
              placeholder="请选择签收人"
              value={selectedReceiverId}
              onChange={setSelectedReceiverId}
              options={receivers.map((r: any) => ({ label: r.name, value: r.id }))}
              style={{ width: 300 }}
            />
          </Form.Item>
          <Form.Item label="签收密码" required>
            <Input.Password
              placeholder="请输入签收人密码"
              value={receiverPassword}
              onChange={e => setReceiverPassword(e.target.value)}
              style={{ width: 300 }}
            />
          </Form.Item>
          <Form.Item label="签收日期">
            <DatePicker
              value={receiptDate}
              onChange={setReceiptDate}
              placeholder="默认今天"
            />
          </Form.Item>
        </Form>

        <Divider style={{ margin: "12px 0" }} />

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            Receiving Photos ({photos.length})
          </Text>
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Take or select photos of the received samples. Each photo can be associated with one or more samples.
          </Text>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: "none" }}
            onChange={e => { if (e.target.files) addPhotos(e.target.files); }}
          />

          <Space>
            <Button icon={<CameraOutlined />} onClick={() => fileInputRef.current?.click()}>
              Take Photo
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.multiple = true;
              input.onchange = (ev: any) => { if (ev.target.files) addPhotos(ev.target.files); };
              input.click();
            }}>
              Select Files
            </Button>
          </Space>
        </div>

        {photos.length > 0 && (
          <div style={{ maxHeight: 350, overflowY: "auto", border: "1px solid #d9d9d9", borderRadius: 8, padding: 12 }}>
            <Row gutter={[12, 12]}>
              {photos.map((photo) => (
                <Col span={8} key={photo.uid}>
                  <Card
                    size="small"
                    cover={
                      photo.previewUrl ? (
                        <div style={{ height: 120, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                          <img src={photo.previewUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: 120, objectFit: "contain" }} />
                        </div>
                      ) : null
                    }
                    actions={[
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removePhoto(photo.uid)} key="del">
                        Remove
                      </Button>
                    ]}
                    bodyStyle={{ padding: "8px 12px" }}
                  >
                    <div style={{ fontSize: 12 }}>
                      <div style={{ marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Associate with:</Text>
                        <span>
                          <Button type="link" size="small" style={{ fontSize: 10, padding: 0, height: 18 }} onClick={() => selectAllForPhoto(photo.uid)}>All</Button>
                          <Button type="link" size="small" style={{ fontSize: 10, padding: "0 0 0 4px", height: 18 }} onClick={() => deselectAllForPhoto(photo.uid)}>None</Button>
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {selectedSamples.map((s: any, i: number) => (
                          <Tag
                            key={s.id}
                            color={photo.sampleIndices.has(i) ? "green" : "default"}
                            style={{ cursor: "pointer", fontSize: 10, marginRight: 0, padding: "0 4px", lineHeight: "18px" }}
                            onClick={() => togglePhotoSample(photo.uid, i)}
                          >
                            {photo.sampleIndices.has(i) ? "✓" : ""} {s.sample_id?.slice(-6)}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </Modal>
    </div>
  );
}
