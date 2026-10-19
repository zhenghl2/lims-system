// NiptStepDetail.tsx — NIPT 分步批次详情（阶段3：5 步全部走新表）
// 5 个实验组件原样挂载，仅通过 apiBase 换接口地址（默认 "/runs" → 旧页面行为不变）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Space, Button, Tag, Spin, Typography, message, Popconfirm } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, LeftOutlined, RightOutlined, CheckOutlined, UndoOutlined } from "@ant-design/icons";
import {
  niptExtractionApi, niptLibraryApi, niptPoolingApi, niptSequencingApi, niptBioinformaticsApi,
} from "../api";
import { NIPT_STEP_META } from "./NiptStepBatches";

import NiptExtractionTab from "./NiptExtractionTab";
import NiptLibraryTab from "./NiptLibraryTab";
import NiptPoolingTab from "./NiptPoolingTab";
import NiptSequencingTab from "./NiptSequencingTab";
import NiptBioinformaticsTab from "./NiptBioinformaticsTab";

const { Text, Title } = Typography;

const STEP_ORDER = ["extraction", "library", "pooling", "sequencing", "bioinformatics"];
const STEP_API: Record<string, any> = {
  extraction: niptExtractionApi,
  library: niptLibraryApi,
  pooling: niptPoolingApi,
  sequencing: niptSequencingApi,
  bioinformatics: niptBioinformaticsApi,
};

export default function NiptStepDetail() {
  const navigate = useNavigate();
  const { step = "extraction", batchId = "" } = useParams();
  const meta = NIPT_STEP_META[step];
  const stepIdx = Math.max(0, STEP_ORDER.indexOf(step));
  const api = STEP_API[step];
  const apiBase = `/nipt/${step}`;

  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!batchId || !api) return;
    setLoading(true);
    try {
      const res: any = await api.detail(batchId);
      setDetail(res.data);
    } catch {
      message.error("批次详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [batchId, api]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const samples = useMemo(() => detail?.samples || [], [detail]);

  const completeStep = async () => {
    if (!api) return;
    setBusy(true);
    try {
      await api.complete(batchId);
      message.success("本步已完成");
      fetchDetail();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "完成失败");
    } finally { setBusy(false); }
  };

  const reopenStep = async () => {
    if (!api) return;
    setBusy(true);
    try {
      await api.reopen(batchId);
      message.success("已撤销完成，可继续编辑");
      fetchDetail();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "操作失败");
    } finally { setBusy(false); }
  };

  if (!meta || !api) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  const renderTab = () => {
    if (loading || !detail) {
      return <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>;
    }
    switch (step) {
      case "extraction":
        return <NiptExtractionTab batch={detail} samples={samples} onRefresh={fetchDetail} apiBase={apiBase} />;
      case "library":
        return <NiptLibraryTab batch={detail} samples={samples} onRefresh={fetchDetail} apiBase={apiBase} />;
      case "pooling":
        return <NiptPoolingTab batch={detail} onRefresh={fetchDetail} apiBase={apiBase} />;
      case "sequencing":
        return <NiptSequencingTab batch={detail} onRefresh={fetchDetail} apiBase={apiBase} />;
      case "bioinformatics":
        return <NiptBioinformaticsTab batch={detail} samples={samples} onRefresh={fetchDetail} apiBase={apiBase} />;
      default:
        return null;
    }
  };

  const prevStep = stepIdx > 0 ? STEP_ORDER[stepIdx - 1] : null;
  const nextStep = stepIdx < STEP_ORDER.length - 1 ? STEP_ORDER[stepIdx + 1] : null;
  const isCompleted = detail?.status === "COMPLETED";

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/nipt/${step}`)}>列表</Button>
          <Title level={5} style={{ margin: 0 }}>{meta.title}</Title>
          {detail?.batch_number && <Text code>{detail.batch_number}</Text>}
          {detail?.status && (
            <Tag color={isCompleted ? "green" : "blue"}>{detail.status_display || detail.status}</Tag>
          )}
          {detail && <Text type="secondary" style={{ fontSize: 12 }}>{samples.length} 个样本</Text>}
        </Space>
      }
      extra={
        <Space>
          {isCompleted
            ? <Button size="small" icon={<UndoOutlined />} loading={busy} onClick={reopenStep}>撤销完成</Button>
            : <Popconfirm title="完成本步后该批次锁定（可撤销）" onConfirm={completeStep}>
                <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy}>完成本步</Button>
              </Popconfirm>}
          {prevStep && <Button size="small" icon={<LeftOutlined />} onClick={() => navigate(`/nipt/${prevStep}`)}>上一步列表</Button>}
          {nextStep && <Button size="small" onClick={() => navigate(`/nipt/${nextStep}`)}>下一步列表<RightOutlined /></Button>}
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={fetchDetail}>刷新</Button>
        </Space>
      }
    >
      {renderTab()}
    </Card>
  );
}
