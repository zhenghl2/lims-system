import { useState, useRef, useEffect, useCallback } from "react";
import {
  Card, Input, Button, Tag, Typography, message,
  Modal, Space, Empty, Badge, Progress,
} from "antd";
import {
  CheckCircleOutlined, CloseCircleOutlined,
  InboxOutlined, RedoOutlined, LoadingOutlined,
  ExclamationCircleOutlined, ReloadOutlined,
  CameraOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";

const { Text, Title } = Typography;

const STATUS_COLORS: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", IN_PROCESS: "orange",
  PLASMA_SEPARATED: "lime", TESTING: "purple", ANALYZING: "geekblue",
  COMPLETED: "green", REPORTED: "cyan", REJECTED: "red",
};
const STATUS_LABELS: Record<string, string> = {
  REGISTERED: "已登记", RECEIVING: "接收中", IN_PROCESS: "处理中",
  PLASMA_SEPARATED: "血浆已分离", TESTING: "检测中", ANALYZING: "分析中",
  COMPLETED: "已完成", REPORTED: "已报告", REJECTED: "已拒收",
};

const REJECTION_REASONS: Record<string, string> = {
  UNCLEAR_LABEL: "标识不清", BROKEN_CONTAINER: "容器破损",
  INSUFFICIENT_VOLUME: "样本量不足", WRONG_SAMPLE_TYPE: "样本类型不符",
  SEVERE_HEMOLYSIS: "严重溶血/凝血", TEMP_EXCEEDED: "运输温度超标",
  STABILITY_EXPIRED: "超过稳定性时限",
};

const ROLE_LABELS: Record<string, string> = { MOTHER: "母", ALLEGED_FATHER: "疑父" };

export default function SampleReceiving() {
  const [query, setQuery] = useState("");
  const [pendingCases, setPendingCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [receiving, setReceiving] = useState<Set<string>>(new Set());
  const [rejectModal, setRejectModal] = useState<{
    caseId: string; sampleUuid: string; csId: string; name: string;
  } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [uploadingPhotos, setUploadingPhotos] = useState<Set<string>>(new Set());
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ caseId: string; csId: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch pending receiving cases (REGISTERED + RECEIVING, with unreceived samples)
  const fetchPending = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const params: any = { status: "REGISTERED,RECEIVING", page_size: 50 };
      if (search && search.trim().length >= 2) {
        params.search = search.trim();
      }
      const r = await casesApi.list(params);
      const all = r.data?.results || [];
      const pending = all.filter((c: any) => c.received_count < c.sample_count);
      setPendingCases(pending);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  useEffect(() => {
    if (!expanded && pendingCases.length > 0 && !detailLoading) {
      loadDetail(pendingCases[0].id);
    }
  }, [pendingCases]);

  const onSearch = (v: string) => {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchPending(v), 400);
  };

  const loadDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!details[id]) {
      setDetailLoading(true);
      try {
        const r = await casesApi.get(id);
        setDetails((p: any) => ({ ...p, [id]: r.data }));
      } catch { message.error("加载失败"); }
      finally { setDetailLoading(false); }
    }
  };

  // sampleUuid = Sample's UUID (cs.sample), not cs.id (CaseSample UUID) and not cs.sample_id (char ID)
  const confirmReceipt = async (caseId: string, sampleUuid: string, condition: string, note?: string) => {
    const key = `${caseId}:${sampleUuid}`;
    setReceiving((p) => new Set([...p, key]));
    try {
      await (casesApi as any).confirmReceipt(caseId, {
        sample_id: sampleUuid, condition, rejection_note: note || "",
      });
      message.success(condition === "OK" ? "样本已确认接收" : "已拒收");

      // Reload detail and check if case entered lab workflow
      try {
        const r = await casesApi.get(caseId);
        setDetails((p: any) => ({ ...p, [caseId]: r.data }));
        if (r.data.status === "IN_PROCESS") {
          message.success("全部样本接收完毕，已自动进入 Lab Workflow！");
          setExpanded(null);
          setPendingCases((p) => p.filter((c) => c.id !== caseId));
        }
      } catch { /* ignore */ }
    } catch { message.error("操作失败"); }
    finally { setReceiving((p) => { const s = new Set(p); s.delete(key); return s; }); }
  };

  const receiveAllOK = async (caseId: string) => {
    let d = details[caseId];
    if (!d) {
      try {
        const r = await casesApi.get(caseId);
        d = r.data;
        setDetails((p: any) => ({ ...p, [caseId]: d }));
      } catch { message.error('加载详情失败'); return; }
    }
    if (!d) return;
    const api = casesApi as any;
    for (const cs of d.case_samples) {
      if (!cs.received_at && cs.sample_status !== "REJECTED") {
        const sampleUuid = cs.sample;
        setReceiving((p) => new Set([...p, `${caseId}:${sampleUuid}`]));
        try {
          await api.confirmReceipt(caseId, { sample_id: sampleUuid, condition: "OK" });
        } catch { message.error(`接收 ${cs.patient_name || cs.sample_id} 失败`); }
      }
    }
    setReceiving(new Set());
    message.success("全部样本接收完毕，已自动进入 Lab Workflow！");
    setExpanded(null);
    setPendingCases((p) => p.filter((c) => c.id !== caseId));
  };

  const doResample = async (caseId: string, csId: string) => {
    try {
      await (casesApi as any).resample(caseId, { case_sample_id: csId });
      message.success("已创建重采样本");
      const r = await casesApi.get(caseId);
      setDetails((p: any) => ({ ...p, [caseId]: r.data }));
    } catch { message.error("重采失败"); }
  };

  const handlePhotoClick = (caseId: string, csId: string) => {
    pendingUpload.current = { caseId, csId };
    fileInputRef.current?.click();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUpload.current) return;
    const { caseId, csId } = pendingUpload.current;
    const key = `${caseId}:${csId}`;
    setUploadingPhotos((p) => new Set([...p, key]));
    try {
      const formData = new FormData();
      formData.append("case_sample_id", csId);
      formData.append("photo", file);
      const r = await (casesApi as any).uploadReceiptPhoto(caseId, formData);
      const url = r.data?.receipt_photo_url;
      setPhotoUrls((p) => ({ ...p, [key]: url || "" }));
      message.success("拍照登记完成");
    } catch {
      message.error("拍照上传失败");
    } finally {
      setUploadingPhotos((p) => { const s = new Set(p); s.delete(key); return s; });
      // Reset file input so same file can be re-selected
      e.target.value = "";
      pendingUpload.current = null;
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 16,
      }}>
        <Title level={4} style={{ margin: 0 }}>
          <InboxOutlined style={{ marginRight: 8, color: "#1677ff" }} />样本接收
        </Title>
        <Space>
          <Text type="secondary">{pendingCases.length} 个待接收案例</Text>
          <Button icon={<ReloadOutlined />} onClick={() => fetchPending(query)}>刷新</Button>
        </Space>
      </div>

      <Input.Search
        placeholder="按 Case / PT 编号 / 患者姓名筛选..."
        value={query}
        onChange={(e) => onSearch(e.target.value)}
        loading={loading}
        style={{ marginBottom: 16 }}
        size="large"
        allowClear
      />

      {loading && pendingCases.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <LoadingOutlined style={{ fontSize: 32, color: "#1677ff" }} />
          <div style={{ marginTop: 8, color: "#999" }}>加载中...</div>
        </div>
      ) : pendingCases.length === 0 ? (
        <Empty description={query ? "未找到匹配案例" : "暂无待接收样本"} />
      ) : (
        pendingCases.map((c: any) => (
          <Card
            key={c.id}
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space wrap>
                <Button type="link" size="small" onClick={() => loadDetail(c.id)} style={{ padding: 0 }}>
                  <Text code style={{ fontWeight: 600 }}>{c.case_number}</Text>
                </Button>
                {c.pt_number && <Tag color="blue">PT{c.pt_number}</Tag>}
                <Tag color={STATUS_COLORS[c.status] || "default"}>
                  {STATUS_LABELS[c.status] || c.status}
                </Tag>
                {c.is_urgent && <Tag color="red">加急</Tag>}
                <Text type="secondary">
                  已接收{" "}
                  <Text strong style={{ color: "#52c41a" }}>{c.received_count || 0}</Text>
                  {" "}/{" "}{c.sample_count || 0}
                </Text>
                {c.mother_name && <Text type="secondary">母亲: {c.mother_name}</Text>}
                {c.clinic_name && <Text type="secondary">{c.clinic_name}</Text>}
                <Progress percent={c.progress || 0} size="small" style={{ width: 100 }} />
              </Space>
            }
            extra={
              expanded === c.id ? null : (
                <Space size={4}>
                  <Tag color="warning">
                    {(c.sample_count || 0) - (c.received_count || 0)} 个待接收
                  </Tag>
                  <Button size="small" type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={(e) => { e.stopPropagation(); receiveAllOK(c.id); }}>
                    全部接收
                  </Button>
                  <Button size="small"
                    icon={<CameraOutlined />}
                    onClick={(e) => { e.stopPropagation(); loadDetail(c.id); }}>
                    展开操作
                  </Button>
                </Space>
              )
            }
          >
            {expanded === c.id && (
              detailLoading ? <LoadingOutlined /> :
              details[c.id] ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Space>
                      <Button size="small" type="primary" onClick={() => receiveAllOK(c.id)}>
                        <CheckCircleOutlined /> 全部正常接收（自动进入实验流程）
                      </Button>
                      <Text type="secondary">
                        {details[c.id].case_samples?.filter(
                          (cs: any) => !cs.received_at && cs.sample_status !== "REJECTED"
                        ).length || 0} 个待处理
                      </Text>
                    </Space>
                  </div>
                  {details[c.id].case_samples?.map((cs: any) => {
                    const isReceived = cs.received_at && cs.sample_status !== "REJECTED";
                    const isRejected = cs.sample_status === "REJECTED";
                    return (
                      <div key={cs.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "6px 8px", marginBottom: 4, borderRadius: 6,
                        background: isRejected ? "#fff2f0" : isReceived ? "#f6ffed" : "#fafafa",
                        border: `1px solid ${
                          isRejected ? "#ffccc7" : isReceived ? "#b7eb8f" : "#f0f0f0"
                        }`,
                      }}>
                        <Text code style={{ fontSize: 12, color: "#1677ff", minWidth: 90 }}>
                          {cs.test_sample_id || cs.sample_id}
                        </Text>
                        <Tag color={cs.role === "MOTHER" ? "pink" : "blue"} style={{ fontSize: 11 }}>
                          {ROLE_LABELS[cs.role] || cs.role}
                        </Tag>
                        {cs.resample_of && (
                          <Badge count={`R${cs.resample_number}`} size="small" color="orange" />
                        )}
                        <Text style={{ flex: 1 }} ellipsis>
                          {cs.patient_name || cs.sample_id}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {cs.source_display || cs.sample_source}
                        </Text>
                        <Tag color={STATUS_COLORS[cs.sample_status]}>
                          {STATUS_LABELS[cs.sample_status] || cs.sample_status}
                        </Tag>

                        {isRejected ? (
                          <Space size={4}>
                            {cs.rejection_reason && (
                              <Text type="danger" style={{ fontSize: 11 }}
                                ellipsis={{ tooltip: REJECTION_REASONS[cs.rejection_reason] }}>
                                <CloseCircleOutlined />{" "}
                                {REJECTION_REASONS[cs.rejection_reason] || cs.rejection_reason}
                              </Text>
                            )}
                            <Button size="small" type="primary" danger
                              onClick={() => doResample(c.id, cs.id)}>
                              <RedoOutlined /> 重采
                            </Button>
                          </Space>
                        ) : isReceived ? (
                          <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 18 }} />
                        ) : (
                          <Space size={4}>
                            <Button size="small" icon={<CameraOutlined />}
                              onClick={() => handlePhotoClick(c.id, cs.id)}
                              loading={uploadingPhotos.has(`${c.id}:${cs.id}`)}
                              title="拍照登记" />
                            <Button size="small" type="primary"
                              onClick={() => confirmReceipt(c.id, cs.sample, "OK")}
                              loading={receiving.has(`${c.id}:${cs.sample}`)}>
                              <CheckCircleOutlined /> 接收
                            </Button>
                            <Button size="small" danger onClick={() =>
                              setRejectModal({
                                caseId: c.id,
                                sampleUuid: cs.sample,
                                csId: cs.id,
                                name: cs.patient_name || cs.sample_id,
                              })
                            }>
                              <CloseCircleOutlined /> 不合格
                            </Button>
                            {photoUrls[`${c.id}:${cs.id}`] && (
                              <img src={photoUrls[`${c.id}:${cs.id}`]}
                                alt="收样照片"
                                style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover" }} />
                            )}
                          </Space>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : <Text type="secondary">加载失败</Text>
            )}
          </Card>
        ))
      )}

      {/* Rejection Modal */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />
            不合格拒收: {rejectModal?.name}
          </Space>
        }
        open={!!rejectModal}
        footer={null}
        onCancel={() => setRejectModal(null)}
        width={360}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {Object.entries(REJECTION_REASONS).map(([k, v]) => (
            <Button key={k} block size="small" onClick={() => {
              if (rejectModal) {
                confirmReceipt(rejectModal.caseId, rejectModal.sampleUuid, k, rejectNote);
              }
              setRejectModal(null);
              setRejectNote("");
            }}>
              {v}
            </Button>
          ))}
          <Input.TextArea
            rows={2} placeholder="备注（可选）..." value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)} size="small"
          />
        </Space>
      </Modal>
      {/* Hidden file input for camera capture */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
        style={{ display: "none" }} onChange={handlePhotoUpload} />
    </div>
  );
}
