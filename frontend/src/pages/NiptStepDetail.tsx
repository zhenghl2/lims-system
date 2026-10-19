// NiptStepDetail.tsx — NIPT 实验流程「分步批次」详情
// 阶段2：提取/建库走新 API（nipt_workflow）+ 支持「完成本步 / 撤销完成」；
//        Pooling/测序/生信 仍走旧 SampleRun（阶段3 再切）。
// 关键：5 个实验组件原样挂载，只通过 apiBase 换接口地址（默认 "/runs" → 旧接口行为不变）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Space, Button, Tag, Spin, Typography, message, Empty, Popconfirm } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, LeftOutlined, RightOutlined, CheckOutlined, UndoOutlined } from "@ant-design/icons";
import { runsApi, niptExtractionApi, niptLibraryApi } from "../api";
import { NIPT_STEP_META, currentStepIndex } from "./NiptStepBatches";

import NiptExtractionTab from "./NiptExtractionTab";
import NiptLibraryTab from "./NiptLibraryTab";
import NiptPoolingTab from "./NiptPoolingTab";
import NiptSequencingTab from "./NiptSequencingTab";
import NiptBioinformaticsTab from "./NiptBioinformaticsTab";

const { Text, Title } = Typography;

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
  const isNewStep = step === "extraction" || step === "library";
  const api = step === "extraction" ? niptExtractionApi : step === "library" ? niptLibraryApi : null;
  const apiBase = api ? `/nipt/${step}` : "/runs";

  const [detail, setDetail] = useState<any>(null);
  const [tabData, setTabData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const keys = useMemo(() => TAB_DATA_KEYS[step] || [], [step]);

  const fetchDetail = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const res: any = api ? await api.detail(batchId) : await runsApi.detail(batchId);
      setDetail(res.data);
    } catch {
      message.error("批次详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [batchId, api]);

  const fetchTabData = useCallback(async () => {
    if (api) { setTabData({}); return; }   // 新表的 data 已在 detail 里一起返回
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
  }, [batchId, keys, api]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchTabData(); }, [fetchTabData]);

  const tabBatch = useMemo(() => (detail ? { ...detail, ...(tabData || {}) } : null), [detail, tabData]);
  const refreshAll = useCallback(() => { fetchDetail(); fetchTabData(); }, [fetchDetail, fetchTabData]);

  const completeStep = async () => {
    if (!api) return;
    setBusy(true);
    try {
      await api.complete(batchId);
      message.success("本步已完成");
      refreshAll();
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
      refreshAll();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "操作失败");
    } finally { setBusy(false); }
  };

  if (!meta) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  const renderTab = () => {
    if (loading || dataLoading || !tabBatch) {
      return <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>;
    }
    const samples = detail?.samples || detail?.run_samples || [];
    switch (step) {
      case "extraction":
        return <NiptExtractionTab batch={tabBatch} samples={samples} onRefresh={refreshAll} apiBase={apiBase} />;
      case "library":
        return <NiptLibraryTab batch={tabBatch} samples={samples} onRefresh={refreshAll} apiBase={apiBase} />;
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
  const isCompleted = detail?.status === "COMPLETED";

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/nipt/${step}`)}>列表</Button>
          <Title level={5} style={{ margin: 0 }}>{meta.title}</Title>
          {detail?.batch_number && <Text code>{detail.batch_number}</Text>}
          {!isNewStep && detail?.run_number && <Text code>{detail.run_number}</Text>}
          {detail?.status && (
            <Tag color={isCompleted ? "green" : "blue"}>
              {detail.status_display || detail.status}
            </Tag>
          )}
          {!isNewStep && detail && <Text type="secondary" style={{ fontSize: 12 }}>当前第 {currentStepIndex(detail.status) + 1} 步</Text>}
        </Space>
      }
      extra={
        <Space>
          {api && (isCompleted
            ? <Button size="small" icon={<UndoOutlined />} loading={busy} onClick={reopenStep}>撤销完成</Button>
            : <Popconfirm title="完成本步后该批次锁定（可撤销）" onConfirm={completeStep}>
                <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy}>完成本步</Button>
              </Popconfirm>)}
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
