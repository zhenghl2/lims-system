// NiptStepDetail.tsx — NIPT 实验流程「分步入口」阶段1：单步批次详情
// 关键：5 个实验组件原样挂载（实验逻辑零改动），只改数据来源（路由参数 + 5 步共用取数逻辑）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Space, Button, Tag, Spin, Typography, message, Empty } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { runsApi } from "../api";
import { NIPT_STEP_META, currentStepIndex } from "./NiptStepBatches";

import NiptExtractionTab from "./NiptExtractionTab";
import NiptLibraryTab from "./NiptLibraryTab";
import NiptPoolingTab from "./NiptPoolingTab";
import NiptSequencingTab from "./NiptSequencingTab";
import NiptBioinformaticsTab from "./NiptBioinformaticsTab";

const { Text, Title } = Typography;

/** 每步需要按需拉取的大 JSON（与原 NiptWorkflow 完全一致，组件内部字段不需改） */
const TAB_DATA_KEYS: Record<string, string[]> = {
  extraction: ["extraction_data"],
  library: ["library_data", "extraction_data"],
  pooling: ["library_data", "pooling_data"],
  sequencing: ["sequencing_data", "pooling_data"],
  bioinformatics: ["extraction_data", "library_data", "pooling_data", "bioinformatics_data"],
};

const STEP_ORDER = ["extraction", "library", "pooling", "sequencing", "bioinformatics"];

export default function NiptStepDetail() {
  const navigate = useNavigate();
  const { step = "extraction", batchId = "" } = useParams();
  const meta = NIPT_STEP_META[step];
  const stepIdx = Math.max(0, STEP_ORDER.indexOf(step));

  const [detail, setDetail] = useState<any>(null);
  const [tabData, setTabData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const keys = useMemo(() => TAB_DATA_KEYS[step] || [], [step]);

  const fetchDetail = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const res = await runsApi.detail(batchId);
      setDetail(res.data);
    } catch {
      message.error("批次详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  const fetchTabData = useCallback(async () => {
    if (!batchId || !keys.length) { setTabData({}); return; }
    setDataLoading(true);
    try {
      const res = await runsApi.data(batchId, keys);
      setTabData(res.data || {});
    } catch {
      message.error("本步数据加载失败");
      setTabData({});
    } finally {
      setDataLoading(false);
    }
  }, [batchId, keys]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchTabData(); }, [fetchTabData]);

  /** 组件要求的 batch：详情 + 本步大 JSON 合并（与 NiptWorkflow 的 tabBatch 同构） */
  const tabBatch = useMemo(() => (detail ? { ...detail, ...(tabData || {}) } : null), [detail, tabData]);

  const refreshAll = useCallback(() => { fetchDetail(); fetchTabData(); }, [fetchDetail, fetchTabData]);

  if (!meta) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  const renderTab = () => {
    if (loading || dataLoading || !tabBatch) {
      return <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>;
    }
    const samples = detail?.run_samples || detail?.samples || [];
    switch (step) {
      case "extraction":
        return <NiptExtractionTab batch={tabBatch} samples={samples} onRefresh={refreshAll} />;
      case "library":
        return <NiptLibraryTab batch={tabBatch} samples={samples} onRefresh={refreshAll} />;
      case "pooling":
        return <NiptPoolingTab batch={tabBatch} onRefresh={refreshAll} />;
      case "sequencing":
        return <NiptSequencingTab batch={tabBatch} onRefresh={refreshAll} />;
      case "bioinformatics":
        return <NiptBioinformaticsTab batch={tabBatch} samples={samples} onRefresh={refreshAll} />;
      default:
        return <Empty />;
    }
  };

  const prevStep = stepIdx > 0 ? STEP_ORDER[stepIdx - 1] : null;
  const nextStep = stepIdx < STEP_ORDER.length - 1 ? STEP_ORDER[stepIdx + 1] : null;

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/nipt/${step}`)}>列表</Button>
          <Title level={5} style={{ margin: 0 }}>{meta.title}</Title>
          {detail?.run_number && <Text code>{detail.run_number}</Text>}
          {detail?.status && <Tag color="blue">{detail.status}</Tag>}
          {detail && <Text type="secondary" style={{ fontSize: 12 }}>当前第 {currentStepIndex(detail.status) + 1} 步</Text>}
        </Space>
      }
      extra={
        <Space>
          {prevStep && <Button size="small" icon={<LeftOutlined />} onClick={() => navigate(`/nipt/${prevStep}/${batchId}`)}>上一步</Button>}
          {nextStep && <Button size="small" onClick={() => navigate(`/nipt/${nextStep}/${batchId}`)}>下一步<RightOutlined /></Button>}
          <Button size="small" icon={<ReloadOutlined />} loading={loading || dataLoading} onClick={refreshAll}>刷新</Button>
        </Space>
      }
    >
      {renderTab()}
    </Card>
  );
}
