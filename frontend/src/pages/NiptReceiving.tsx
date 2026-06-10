import { useEffect, useState, useRef, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Select, Input, Space, Typography, message, Card, Row, Col, Tabs } from "antd";
import { CheckOutlined, CloseOutlined, CameraOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green",
};

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: "Registered", RECEIVED: "Received",
  IN_PROCESS: "In Process", COMPLETED: "Completed", REPORTED: "Reported",
  REJECTED: "Rejected",
};

const SAMPLE_TYPE_MAP: Record<string, string> = {
  PLASMA_CFDNA: "cfDNA Plasma",
  PERIPHERAL_BLOOD: "Peripheral Blood",
};

const REJECTION_REASONS = [
  { label: "Unclear label", value: "UNCLEAR_LABEL" },
  { label: "Incomplete info", value: "INCOMPLETE_INFO" },
  { label: "Insufficient volume", value: "INSUFFICIENT_VOLUME" },
  { label: "Tube burst", value: "BURST_TUBE" },
  { label: "Leakage", value: "LEAKAGE" },
  { label: "Contaminated", value: "CONTAMINATED" },
  { label: "Temperature excursion", value: "TEMP_EXCEEDED" },
  { label: "Hemolyzed", value: "HEMOLYZED" },
  { label: "Wrong container", value: "WRONG_CONTAINER" },
  { label: "Expired transport", value: "EXPIRED_TRANSPORT" },
  { label: "Other", value: "OTHER" },
];

export default function NiptReceiving() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedSample, setSelectedSample] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<any>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [form] = Form.useForm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<string>("pending");
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const fetchTabCounts = useCallback(() => {
    samplesApi.statsByPanel().then((res: any) => {
      const panels = (res.data || []) as Array<Record<string,number|string>>;
      const nipt = panels.find((p: any) => p.panel_code === "NIPT") || {};
      const niptPlus = panels.find((p: any) => p.panel_code === "NIPT_PLUS") || {};
      const niptFull = panels.find((p: any) => p.panel_code === "NIPT_FULL") || {};
      setTabCounts({
        pending: Number(nipt.pending || 0) + Number(niptPlus.pending || 0) + Number(niptFull.pending || 0),
        received: Number(nipt.received || 0) + Number(niptPlus.received || 0) + Number(niptFull.received || 0),
      });
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchTabCounts(); }, [fetchTabCounts]);

  const fetchData = useCallback(() => {
    setLoading(true);
    const statusParam = activeTab === "pending" ? "REGISTERED" : "RECEIVED,IN_PROCESS,COMPLETED,REPORTED";
    samplesApi.list({ status: statusParam, panel: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 100 }).then((res: any) => {
      setData((res.data as any).results || res.data || []);
    }).catch(() => message.error("Failed to load samples")).finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReceive = (sample: any) => {
    setReceiveTarget(sample);
    setReceiveModalOpen(true);
  };

  const confirmReceive = async () => {
    if (!receiveTarget) return;
    setReceiveLoading(true);
    try {
      await samplesApi.accept(receiveTarget.id);
      message.success(`Sample ${receiveTarget.sample_id} received`);
      setReceiveModalOpen(false);
      fetchData();
      fetchTabCounts();
    } catch {
      message.error("Failed to receive sample");
    } finally {
      setReceiveLoading(false);
    }
  };

  const handleBatchReceive = async () => {
    if (selectedRowKeys.length === 0) { message.warning("Select samples to receive"); return; }
    setBatchLoading(true);
    let success = 0;
    for (const id of selectedRowKeys) {
      try {
        await samplesApi.accept(id as string);
        success++;
      } catch { /* skip */ }
    }
    setBatchLoading(false);
    message.success(`Received ${success}/${selectedRowKeys.length} samples`);
    setSelectedRowKeys([]);
    fetchData();
    fetchTabCounts();
  };

  const handleReject = (sample: any) => {
    setSelectedSample(sample);
    form.resetFields();
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    try {
      const values = await form.validateFields();
      await samplesApi.reject(selectedSample.id, values.reason, values.note);
      message.success(`Sample ${selectedSample.sample_id} rejected`);
      setRejectOpen(false);
      fetchData();
      fetchTabCounts();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error("Reject failed");
    }
  };

  const handlePhotoUpload = (sample: any) => {
    if (!fileInputRef.current) return;
    const input = fileInputRef.current;
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        await samplesApi.uploadImage(sample.id, file);
        message.success("Photo uploaded");
        fetchData();
      } catch {
        message.error("Upload failed");
      }
    };
    input.click();
  };

  const pendingColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 180 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Age", dataIndex: "age", key: "age", width: 60 },
    { title: "Gest. Weeks", dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: "Sample Type", dataIndex: "sample_type_code", key: "sample_type_code", width: 140, render: (v: string) => SAMPLE_TYPE_MAP[v] || v || "-" },
    { title: "Collection Date", dataIndex: "collection_date", key: "collection_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: "Source Institution", dataIndex: "source_institution", key: "source_institution", width: 160, ellipsis: true },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: "", key: "photo", width: 60,
      render: (_: any, r: any) => (
        <Button type="link" icon={<CameraOutlined />} size="small" onClick={() => handlePhotoUpload(r)} title="Take photo" />
      ),
    },
    {
      title: "Action", key: "action", width: 180,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleReceive(r)}>Receive</Button>
          <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleReject(r)}>Reject</Button>
        </Space>
      ),
    },
  ];

  const receivedColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 180 },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Age", dataIndex: "age", key: "age", width: 60 },
    { title: "Gest. Weeks", dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: "Sample Type", dataIndex: "sample_type_code", key: "sample_type_code", width: 140, render: (v: string) => SAMPLE_TYPE_MAP[v] || v || "-" },
    { title: "Receipt Date", dataIndex: "receipt_date", key: "receipt_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    {
      title: "Status", dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS[v] || v}</Tag>,
    },
  ];

  const rowSelection = activeTab === "pending" ? {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  } : undefined;

  const tabItems = [
    { key: "pending", label: `Pending Receiving (${tabCounts.pending || 0})`, children: null },
    { key: "received", label: `Received (${tabCounts.received || 0})`, children: null },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>NIPT Sample Receiving</Title>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ marginBottom: 16 }} />

      {/* Batch actions */}
      {activeTab === "pending" && selectedRowKeys.length > 0 && (
        <Card size="small" style={{ marginBottom: 16, background: "#e6f7ff", border: "1px solid #91d5ff" }}>
          <Space>
            <Text strong>{selectedRowKeys.length} sample(s) selected</Text>
            <Button type="primary" icon={<CheckOutlined />} loading={batchLoading} onClick={handleBatchReceive}>Batch Receive</Button>
          </Space>
        </Card>
      )}

      <Table
        dataSource={data}
        columns={activeTab === "pending" ? pendingColumns : receivedColumns}
        rowKey="id"
        loading={loading}
        rowSelection={rowSelection}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `Total ${t}` }}
        scroll={{ x: 1200 }}
        size="middle"
      />

      <input type="file" ref={fileInputRef} accept="image/*" capture="environment" style={{ display: "none" }} />

      {/* Receive Modal */}
      <Modal title="Confirm Receipt" open={receiveModalOpen} onOk={confirmReceive} onCancel={() => setReceiveModalOpen(false)} confirmLoading={receiveLoading} destroyOnClose>
        {receiveTarget && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}><Text type="secondary">Sample ID</Text><br /><Text strong>{receiveTarget.sample_id}</Text></Col>
              <Col span={12}><Text type="secondary">Patient</Text><br /><Text strong>{receiveTarget.patient_name}</Text></Col>
              <Col span={12}><Text type="secondary">Sample Type</Text><br /><Text>{SAMPLE_TYPE_MAP[receiveTarget.sample_type_code] || receiveTarget.sample_type_code}</Text></Col>
              <Col span={12}><Text type="secondary">Gest. Weeks</Text><br /><Text>{receiveTarget.gestational_weeks || "-"}</Text></Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal title="Reject Sample" open={rejectOpen} onOk={confirmReject} onCancel={() => setRejectOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label="Rejection Reason" rules={[{ required: true }]}>
            <Select placeholder="Select a reason" options={REJECTION_REASONS} />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <TextArea rows={3} placeholder="Additional notes..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}