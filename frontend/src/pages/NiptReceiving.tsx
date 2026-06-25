import { useEffect, useState, useRef, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Select, Input, Space, Typography, message, Card, Row, Col, Tabs } from "antd";
import { CheckOutlined, CloseOutlined, CameraOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";
import api from "../api/client";
import { useTranslation } from "../i18n/useTranslation";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVED: "blue",
  IN_PROCESS: "orange", PLASMA_SEPARATED: "lime", COMPLETED: "green",
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
  const { t } = useTranslation();
  const TEST_OPTION_MAP_TL: Record<string, string> = {
    NIPT: t("nipt.common.basic"),
    Basic: t("nipt.common.basic"),
    NIPT_PLUS: t("nipt.common.plus"),
    Plus: t("nipt.common.plus"),
    NIPT_FULL: t("nipt.common.plus"),
  };
  const SAMPLE_TYPE_MAP_TL: Record<string, string> = {
    BLOOD: t("nipt.receiving.blood"),
    PLASMA_CFDNA: t("nipt.receiving.cfdnaPlasma"),
    PERIPHERAL_BLOOD: t("nipt.receiving.peripheralBlood"),
  };
  const STATUS_LABELS_TL: Record<string, string> = {
    PRE_PROCESSING: t("nipt.common.preProcessing"),
    REGISTERED: t("nipt.dashboard.registered"),
    RECEIVED: t("nipt.dashboard.received"),
    IN_PROCESS: t("nipt.common.plasmaSeparatedStatus"),
    PLASMA_SEPARATED: t("nipt.common.plasmaSeparatedStatus"),
    COMPLETED: t("nipt.dashboard.completed"),
    REPORTED: t("nipt.dashboard.reported"),
    REJECTED: t("nipt.dashboard.rejected"),
  };
  // Translated rejection reasons
  const rejectionReasonsTL = REJECTION_REASONS.map(r => ({
    ...r,
    label: t(`nipt.receiving.rejectionReasons.${r.value === "UNCLEAR_LABEL" ? "unclearLabel" : r.value === "INCOMPLETE_INFO" ? "incompleteInfo" : r.value === "INSUFFICIENT_VOLUME" ? "insufficientVolume" : r.value === "BURST_TUBE" ? "tubeBurst" : r.value === "LEAKAGE" ? "leakage" : r.value === "CONTAMINATED" ? "contaminated" : r.value === "TEMP_EXCEEDED" ? "tempExceeded" : r.value === "HEMOLYZED" ? "hemolyzed" : r.value === "WRONG_CONTAINER" ? "wrongContainer" : r.value === "EXPIRED_TRANSPORT" ? "expiredTransport" : "other"}`),
  }));
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedSample, setSelectedSample] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchVgModal, setBatchVgModal] = useState(false);
  const [batchVgList, setBatchVgList] = useState<{id:string; sample_id:string; vg_id:string}[]>([]);
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
        pending: Number(nipt.registered || 0) + Number(niptPlus.registered || 0) + Number(niptFull.registered || 0),
        received: Number(nipt.received || 0) + Number(niptPlus.received || 0) + Number(niptFull.received || 0),
      });
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchTabCounts(); }, [fetchTabCounts]);

  const fetchData = useCallback(() => {
    setLoading(true);
    const statusParam = activeTab === "pending" ? "REGISTERED" : "RECEIVED,IN_PROCESS,PLASMA_SEPARATED,COMPLETED,REPORTED";
    samplesApi.list({ status: statusParam, panel: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 100 }).then((res: any) => {
      setData((res.data as any).results || res.data || []);
    }).catch(() => message.error("Failed to load samples")).finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReceive = (sample: any) => {
    setReceiveTarget(sample);
    setVgIdInput(sample.vg_id || "");
    setReceiveModalOpen(true);
  };

  const [vgIdInput, setVgIdInput] = useState("");

  const confirmReceive = async () => {
    if (!receiveTarget) return;
    setReceiveLoading(true);
    try {
      if (!vgIdInput.trim()) { message.warning("Please enter VG ID"); setReceiveLoading(false); return; }
      await samplesApi.accept(receiveTarget.id);
      try {
        await api.patch(`/samples/${receiveTarget.id}/`, { vg_id: vgIdInput.trim() });
      } catch {}
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
    const selected = data.filter((s: any) => selectedRowKeys.includes(s.id));
    const list = selected.map((s: any, i: number) => ({
      id: s.id, sample_id: s.sample_id,
      vg_id: s.vg_id || (i === 0 ? "WJ" : ""),
    }));
    setBatchVgList(list);
    setBatchVgModal(true);
  };

  const confirmBatchReceive = async () => {
    const filled = batchVgList.map((item, i) => {
      if (!item.vg_id && i > 0) {
        const first = batchVgList[0].vg_id;
        if (first) {
          const match = first.match(/^(.*?)(\d+)$/);
          if (match) {
            const base = match[1];
            const num = parseInt(match[2]) + i;
            return { ...item, vg_id: base + num };
          }
        }
      }
      return item;
    });

    const missing = filled.filter(f => !f.vg_id.trim());
    if (missing.length > 0) {
      message.warning(`${missing.length} sample(s) missing VG ID`);
      return;
    }

    setBatchLoading(true);
    let success = 0;
    for (const item of filled) {
      try {
        await samplesApi.accept(item.id);
        try { await api.patch(`/samples/${item.id}/`, { vg_id: item.vg_id.trim() }); } catch {}
        success++;
      } catch { /* skip */ }
    }
    setBatchLoading(false);
    setBatchVgModal(false);
    message.success(`Received ${success}/${filled.length} samples`);
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
      } catch { message.error("Upload failed"); }
    };
    input.click();
  };

  const pendingColumns = [
    { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", key: "sample_id", width: 180 },
    { title: t("nipt.samples.name"), dataIndex: "patient_name", key: "patient_name", width: 120 },
    { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
    { title: t("nipt.samples.age"), dataIndex: "age", key: "age", width: 60 },
    { title: t("nipt.samples.gestWeeks"), dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: t("nipt.samples.sampleType"), dataIndex: "sample_type_code", key: "sample_type_code", width: 100, render: (v: string) => SAMPLE_TYPE_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => TEST_OPTION_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.collectionDate"), dataIndex: "collection_date", key: "collection_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: t("nipt.samples.sampleSource"), dataIndex: "sample_source", key: "sample_source", width: 160, ellipsis: true },
    { title: t("nipt.samples.status"), dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS_TL[v] || v}</Tag> },
    { title: "", key: "photo", width: 60,
      render: (_: any, r: any) => <Button type="link" icon={<CameraOutlined />} size="small" onClick={() => handlePhotoUpload(r)} title={t("nipt.receiving.takePhoto")} /> },
    { title: t("nipt.receiving.action"), key: "action", width: 180,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleReceive(r)}>{t("nipt.receiving.receive")}</Button>
          <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleReject(r)}>{t("nipt.receiving.reject")}</Button>
        </Space>
      )},
  ];

  const receivedColumns = [
    { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", key: "sample_id", width: 180 },
    { title: t("nipt.samples.name"), dataIndex: "patient_name", key: "patient_name", width: 120 },
    { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
    { title: t("nipt.samples.age"), dataIndex: "age", key: "age", width: 60 },
    { title: t("nipt.samples.gestWeeks"), dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: t("nipt.samples.sampleType"), dataIndex: "sample_type_code", key: "sample_type_code", width: 100, render: (v: string) => SAMPLE_TYPE_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => TEST_OPTION_MAP_TL[v] || v || "-" },
    { title: t("nipt.receiving.receiptDate"), dataIndex: "receipt_date", key: "receipt_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: t("nipt.samples.status"), dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS_TL[v] || v}</Tag> },
  ];

  const rowSelection = activeTab === "pending" ? {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  } : undefined;

  const tabItems = [
    { key: "pending", label: `${t("nipt.receiving.pendingReceiving")} (${tabCounts.pending || 0})`, children: null },
    { key: "received", label: `${t("nipt.receiving.received")} (${tabCounts.received || 0})`, children: null },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>{t("nipt.receiving.title")}</Title>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ marginBottom: 16 }} />

      {activeTab === "pending" && selectedRowKeys.length > 0 && (
        <Card size="small" style={{ marginBottom: 16, background: "#e6f7ff", border: "1px solid #91d5ff" }}>
          <Space>
            <Text strong>{t("nipt.receiving.selectedCount").replace("{count}", String(selectedRowKeys.length))}</Text>
            <Button type="primary" icon={<CheckOutlined />} loading={batchLoading} onClick={handleBatchReceive}>{t("nipt.receiving.batchReceive")}</Button>
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

      <Modal title={t("nipt.receiving.confirmReceipt")} open={receiveModalOpen} onOk={confirmReceive} onCancel={() => setReceiveModalOpen(false)} confirmLoading={receiveLoading} destroyOnClose>
        {receiveTarget && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}><Text type="secondary">{t("nipt.samples.sampleId")}</Text><br /><Text strong>{receiveTarget.sample_id}</Text></Col>
              <Col span={12}><Text type="secondary">{t("nipt.receiving.patient")}</Text><br /><Text strong>{receiveTarget.patient_name}</Text></Col>
              <Col span={12}><Text type="secondary">{t("nipt.samples.sampleType")}</Text><br /><Text>{SAMPLE_TYPE_MAP_TL[receiveTarget.sample_type_code] || receiveTarget.sample_type_code}</Text></Col>
              <Col span={12}><Text type="secondary">{t("nipt.samples.gestWeeks")}</Text><br /><Text>{receiveTarget.gestational_weeks || "-"}</Text></Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <Text strong style={{ color: "#ff4d4f" }}>{t("nipt.receiving.vgIdRequired")}</Text>
              <Input placeholder={t("nipt.receiving.enterVgId")} autoFocus value={vgIdInput}
                onChange={e => setVgIdInput(e.target.value)} style={{ marginTop: 4 }} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={t("nipt.receiving.batchVgTitle").replace("{count}", String(batchVgList.length))}
        open={batchVgModal} onOk={confirmBatchReceive} onCancel={() => setBatchVgModal(false)}
        confirmLoading={batchLoading} width={550} destroyOnClose
      >
        <Table rowKey="id" size="small" pagination={false} dataSource={batchVgList}
          columns={[
            { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", width: 170, render: (v: string) => <Text code>{v}</Text> },
            { title: t("nipt.samples.vgId"), dataIndex: "vg_id", width: 200,
              render: (v: string, _r: any, i: number) => (
                <Input value={v} autoFocus={i === 0} placeholder={t("nipt.receiving.vgIdPlaceholder")}
                  onChange={e => {
                    const next = batchVgList.map((item, idx) => idx === i ? { ...item, vg_id: e.target.value } : item);
                    setBatchVgList(next);
                  }} />
              )},
          ]}
        />
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("nipt.receiving.autoIncrementHint")}
        </Text>
      </Modal>

      <Modal title={t("nipt.receiving.rejectSample")} open={rejectOpen} onOk={confirmReject} onCancel={() => setRejectOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label={t("nipt.receiving.rejectionReason")} rules={[{ required: true }]}>
            <Select placeholder={t("nipt.receiving.selectReason")} options={rejectionReasonsTL} />
          </Form.Item>
          <Form.Item name="note" label={t("nipt.receiving.note")}>
            <TextArea rows={3} placeholder={t("nipt.receiving.additionalNotes")} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}