import { useEffect, useState, useRef, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Select, Input, Space, Typography, message, Card, Row, Col, Tabs, Image, Tooltip } from "antd";
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

/** 签收人名单（与 NIPPT 收样页保持一致，免密码，仅记录姓名） */
const RECEIPT_PERSONS = ["吴书凌","叶丽婷","何家宇","胡煜敏","付慧珠","杜兴琼","龙雨青","张斯栋","郭爽洁","林琦","林洋鸿","杨思婷","李彩娟"];

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
  const [batchVgList, setBatchVgList] = useState<{id:string; sample_id:string; external_id:string; vg_id:string; receiver_name:string}[]>([]);
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
    if (!sample.image) {
      message.warning(t("nipt.receiving.photoRequired"));
      return;
    }
    setReceiveTarget(sample);
    setVgIdInput(sample.vg_id || "");
    setReceiverName(sample.received_by_name || undefined);
    setReceiveModalOpen(true);
  };

  const [vgIdInput, setVgIdInput] = useState("");
  const [receiverName, setReceiverName] = useState<string | undefined>(undefined);

  const confirmReceive = async () => {
    if (!receiveTarget) return;
    if (!receiveTarget.image) {
      message.warning(t("nipt.receiving.photoRequired"));
      return;
    }
    setReceiveLoading(true);
    try {
      if (!vgIdInput.trim()) { message.warning("Please enter VG ID"); setReceiveLoading(false); return; }
      if (!receiverName) { message.warning(t("nipt.receiving.receiverRequired")); setReceiveLoading(false); return; }
      try {
        await samplesApi.accept(receiveTarget.id, { receiver_name: receiverName, vg_id: vgIdInput.trim() });
      } catch (e: any) {
        const d = e?.response?.data;
        // 重号（2026-10-15）：HN 编号已存在 → 询问是否继续（继续则自动加 R1/R2 并标记重采）
        if (e?.response?.status === 409 && d?.duplicate) {
          const ex = d.existing || {};
          const _tgt = receiveTarget, _rn = receiverName, _vg = vgIdInput.trim();
          Modal.confirm({
            title: "HN 编号重复",
            width: 470,
            content: (
              <div style={{ fontSize: 13 }}>
                <p><Text strong>{d.message || "HN 编号重复"}</Text></p>
                <p style={{ marginBottom: 4 }}>
                  已有样本：<Text code>{ex.sample_id || "-"}</Text> {ex.patient_name || ""}（HN {ex.vg_id || "-"}）
                </p>
                <p style={{ color: "#d46b08", marginBottom: 0 }}>
                  继续将保存为 <Text code>{_vg}R1</Text>（已有则顺延 R2）并标记为「重采」样本。
                </p>
              </div>
            ),
            okText: "继续（存为 R1/R2）", cancelText: "取消",
            onOk: async () => {
              const res: any = await samplesApi.accept(_tgt.id, { receiver_name: _rn, vg_id: _vg, allow_duplicates: true });
              const nv = res?.data?.vg_id;
              message.success(`已签收（重采${nv ? "，编号 " + nv : ""}）`);
              setReceiveModalOpen(false);
              fetchData();
              fetchTabCounts();
            },
          });
          return;
        }
        throw e;
      }
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

  const handleBatchFillVg = async () => {
    if (selectedRowKeys.length === 0) { message.warning(t("nipt.receiving.selectSamples")); return; }
    const selected = data.filter((s: any) => selectedRowKeys.includes(s.id));
    const list = selected.map((s: any, i: number) => ({
      id: s.id, sample_id: s.sample_id, external_id: s.external_id || "",
      vg_id: s.vg_id || (i === 0 ? "HN" : ""),
      receiver_name: s.received_by_name || "",
    }));
    setBatchVgList(list);
    setBatchVgModal(true);
  };

  const confirmBatchFillVg = async () => {
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
    const dups: { item: any; d: any }[] = [];
    const failed: string[] = [];
    for (const item of filled) {
      try {
        const payload: Record<string, unknown> = { vg_id: item.vg_id.trim() };
        if (item.receiver_name.trim()) payload.received_by_name = item.receiver_name.trim();
        await api.patch(`/samples/${item.id}/`, payload);
        success++;
      } catch (e: any) {
        const d = e?.response?.data;
        if (e?.response?.status === 409 && d?.duplicate) dups.push({ item, d });
        else failed.push(item.sample_id || item.id);
      }
    }
    setBatchLoading(false);
    setBatchVgModal(false);
    if (failed.length) message.error(`${failed.length} 条保存失败：${failed.slice(0, 3).join("、")}${failed.length > 3 ? "…" : ""}`);
    if (success) message.success(t("nipt.receiving.vgIdSaved").replace("{count}", String(success)));
    // 重号（2026-10-15）：列出重复项，由操作者决定是否继续（继续则自动加 R1/R2 并标记重采）
    if (dups.length) {
      Modal.confirm({
        title: `有 ${dups.length} 条 HN 编号重复`,
        width: 540,
        content: (
          <div style={{ fontSize: 13 }}>
            <p style={{ marginBottom: 6 }}>这些编号已存在，<Text strong>默认已跳过</Text>。要继续录入吗？</p>
            <ul style={{ paddingLeft: 18, marginBottom: 6 }}>
              {dups.slice(0, 8).map((x, i) => (
                <li key={i}>
                  <Text code>{x.item.vg_id}</Text>（{x.item.sample_id}）→ 已有 {x.d?.existing?.sample_id || "-"} {x.d?.existing?.patient_name || ""}
                </li>
              ))}
            </ul>
            {dups.length > 8 && <p>…等共 {dups.length} 条</p>}
            <p style={{ color: "#d46b08", marginBottom: 0 }}>继续将自动加 <Text code>R1/R2</Text> 并标记为「重采」样本。</p>
          </div>
        ),
        okText: "继续（加 R1/R2）", cancelText: "保持跳过",
        onOk: async () => {
          let ok = 0; const news: string[] = [];
          for (const x of dups) {
            try {
              const payload: Record<string, unknown> = { vg_id: x.item.vg_id.trim(), allow_duplicates: true };
              if (x.item.receiver_name.trim()) payload.received_by_name = x.item.receiver_name.trim();
              const rr: any = await api.patch(`/samples/${x.item.id}/`, payload);
              ok++;
              if (rr?.data?.vg_id) news.push(rr.data.vg_id);
            } catch { /* skip */ }
          }
          message.success(`已录入 ${ok} 条重采${news.length ? "：" + news.slice(0, 5).join("、") : ""}`);
          fetchData();
          fetchTabCounts();
        },
      });
    }
    setSelectedRowKeys([]);
    fetchData();
    fetchTabCounts();
  };

  const handleReject = (sample: any) => {
    if (!sample.image) {
      message.warning(t("nipt.receiving.photoRequired"));
      return;
    }
    setSelectedSample(sample);
    form.resetFields();
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    if (!selectedSample?.image) {
      message.warning(t("nipt.receiving.photoRequired"));
      return;
    }
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

  // 2026-10-21：支持把图片直接拖到样本行上
  const uploadPhotoFor = async (sample: any, file: File) => {
    if (!file || !(file.type || "").startsWith("image/")) return;
    try {
      await samplesApi.uploadImage(sample.id, file);
      message.success("Photo uploaded");
      fetchData();
    } catch { message.error("Upload failed"); }
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
    { title: t("nipt.samples.accessioningId"), dataIndex: "external_id", key: "external_id", width: 150, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.fedexNo"), dataIndex: "fedex_no", key: "fedex_no", width: 150,
      render: (v: string) => v ? <Text style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.name"), dataIndex: "patient_name", key: "patient_name", width: 120, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
    { title: t("nipt.samples.age"), dataIndex: "age", key: "age", width: 60 },
    { title: t("nipt.samples.gestWeeks"), dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: t("nipt.samples.sampleType"), dataIndex: "sample_type_code", key: "sample_type_code", width: 100, render: (v: string) => SAMPLE_TYPE_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => TEST_OPTION_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.collectionDate"), dataIndex: "collection_date", key: "collection_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: t("nipt.samples.sampleSource"), dataIndex: "sample_source", key: "sample_source", width: 160, ellipsis: true },
    { title: t("nipt.samples.status"), dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS_TL[v] || v}</Tag> },
    { title: t("nipt.receiving.photo"), key: "photo", width: 80,
      render: (_: any, r: any) => r.image
        ? <div style={{ position: "relative", width: 50, height: 50 }}>
            <Image src={r.image} width={50} height={50} style={{ objectFit: "cover", borderRadius: 4 }} preview />
            <div
              onClick={(e: any) => { e.stopPropagation(); handlePhotoUpload(r); }}
              title={t("nipt.receiving.takePhoto")}
              style={{
                position: "absolute", right: 0, bottom: 0, width: 18, height: 18,
                borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}
            ><CameraOutlined style={{ fontSize: 10 }} /></div>
          </div>
        : <Button type="link" icon={<CameraOutlined />} size="small" onClick={(e: any) => { e.stopPropagation(); handlePhotoUpload(r); }} title={t("nipt.receiving.takePhoto")} /> },
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
    { title: t("nipt.samples.accessioningId"), dataIndex: "external_id", key: "external_id", width: 150, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.fedexNo"), dataIndex: "fedex_no", key: "fedex_no", width: 150,
      render: (v: string) => v ? <Text style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.name"), dataIndex: "patient_name", key: "patient_name", width: 120, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.vgId"), dataIndex: "vg_id", key: "vg_id", width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
    { title: t("nipt.samples.age"), dataIndex: "age", key: "age", width: 60 },
    { title: t("nipt.samples.gestWeeks"), dataIndex: "gestational_weeks", key: "gestational_weeks", width: 80 },
    { title: t("nipt.samples.sampleType"), dataIndex: "sample_type_code", key: "sample_type_code", width: 100, render: (v: string) => SAMPLE_TYPE_MAP_TL[v] || v || "-" },
    { title: t("nipt.samples.testOption"), dataIndex: "test_option", key: "test_option", width: 80, render: (v: string) => TEST_OPTION_MAP_TL[v] || v || "-" },
    { title: t("nipt.receiving.receiptDate"), dataIndex: "receipt_date", key: "receipt_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: t("nipt.receiving.receiver"), dataIndex: "received_by_name", key: "received_by_name", width: 110,
      render: (v: string) => v ? <Tag color="green">{v}</Tag> : <Text type="secondary">-</Text> },
    { title: t("nipt.samples.status"), dataIndex: "status", key: "status", width: 100,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS_TL[v] || v}</Tag> },
    { title: t("nipt.receiving.photo"), key: "photo", width: 80,
      render: (_: any, r: any) => r.image
        ? <Image src={r.image} width={50} height={50} style={{ objectFit: "cover", borderRadius: 4 }} preview />
        : <Text type="secondary">-</Text> },
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
            <Button type="primary" loading={batchLoading} onClick={handleBatchFillVg}>{t("nipt.receiving.batchFillVgId")}</Button>
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
        // 2026-10-21：整行作为照片拖拽目标 —— 拖到哪一行就传到那一行的样本
        onRow={(r: any) => ({
          onDragOver: (e: any) => {
            if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
              e.preventDefault();
              e.currentTarget.style.outline = "2px dashed #1677ff";
              e.currentTarget.style.outlineOffset = "-2px";
            }
          },
          onDragLeave: (e: any) => { e.currentTarget.style.outline = ""; },
          onDrop: (e: any) => {
            e.currentTarget.style.outline = "";
            const f = e.dataTransfer?.files?.[0];
            if (!f) return;
            e.preventDefault(); e.stopPropagation();
            uploadPhotoFor(r, f);
          },
        })}
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
            <div style={{ marginTop: 16 }}>
              <Text strong style={{ color: "#ff4d4f" }}>{t("nipt.receiving.receiverRequired")}</Text>
              <Select showSearch style={{ width: "100%", marginTop: 4 }} placeholder={t("nipt.receiving.receiver")}
                value={receiverName} onChange={(v: string) => setReceiverName(v)}
                options={RECEIPT_PERSONS.map(n => ({ label: n, value: n }))} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={t("nipt.receiving.batchVgIdTitle").replace("{count}", String(batchVgList.length))}
        open={batchVgModal} onOk={confirmBatchFillVg} onCancel={() => setBatchVgModal(false)}
        confirmLoading={batchLoading} width={820} destroyOnClose
      >
        <Table rowKey="id" size="small" pagination={false} dataSource={batchVgList}
          columns={[
            { title: t("nipt.samples.sampleId"), dataIndex: "sample_id", width: 170, ellipsis: true,
              render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
            { title: t("nipt.samples.accessioningId"), dataIndex: "external_id", width: 180, ellipsis: true,
              render: (v: string) => v ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip> : <Text type="secondary">-</Text> },
            { title: t("nipt.samples.vgId"), dataIndex: "vg_id", width: 200,
              render: (v: string, _r: any, i: number) => (
                <Input value={v} autoFocus={i === 0} placeholder={t("nipt.receiving.vgIdPlaceholder")}
                  onChange={e => {
                    const next = batchVgList.map((item, idx) => idx === i ? { ...item, vg_id: e.target.value } : item);
                    setBatchVgList(next);
                  }}
                  onBlur={e => {
                    if (i !== 0) return;
                    const val = e.target.value;
                    const match = val.match(/^(.*?)(\d+)$/);
                    if (!match) return;
                    const base = match[1];
                    const num = parseInt(match[2]);
                    const next = batchVgList.map((item, idx) =>
                      idx === 0 ? item : { ...item, vg_id: base + (num + idx) }
                    );
                    setBatchVgList(next);
                  }} />
              )},
            { title: t("nipt.receiving.receiver"), dataIndex: "receiver_name", width: 200,
              render: (v: string, _r: any, i: number) => (
                <Select showSearch style={{ width: "100%" }} placeholder={t("nipt.receiving.receiver")}
                  value={v || undefined}
                  onChange={(val: string) => {
                    // 第一行选定 → 其余行同一人；其他行单独改只影响自己
                    setBatchVgList(prev => prev.map((it, idx) =>
                      (i === 0 || idx === i) ? { ...it, receiver_name: val } : it));
                  }}
                  options={RECEIPT_PERSONS.map(n => ({ label: n, value: n }))} />
              )},
          ]}
        />
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("nipt.receiving.autoIncrementHint")}
        </Text>
        <Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          {t("nipt.receiving.batchReceiverHint")}
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