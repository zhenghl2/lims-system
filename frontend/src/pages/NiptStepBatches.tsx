// NiptStepBatches.tsx — NIPT 实验流程「分步入口」阶段1：每步一个批次列表页
// 阶段1 目标：把 5 步从 1 个 Tabs 页面拆成 5 个独立入口（数据模型不动，仍读 SampleRun）。
// 阶段2 起：换成 Nipt{Step}Batch 新表 + 待处理队列 + M:N 汇流。
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Table, Tag, Button, Typography, Space, message, Tooltip } from "antd";
import { ReloadOutlined, ArrowRightOutlined, InfoCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi } from "../api";

const { Text, Title } = Typography;

/** 5 步的展示元数据（顺序与原「实验流程」Tabs 一致） */
export const NIPT_STEP_META: Record<string, { order: number; title: string; status: string }> = {
  extraction:     { order: 1, title: "提取",     status: "PLANNED" },
  library:        { order: 2, title: "文库构建", status: "LIBRARY_PREP" },
  pooling:        { order: 3, title: "Pooling",  status: "LIBRARY_POOLING" },
  sequencing:     { order: 4, title: "测序",     status: "SEQUENCING" },
  bioinformatics: { order: 5, title: "生信分析", status: "ANALYZING" },
};

/** run.status → 当前进行到第几步（与原页面 getStepIndex 同口径） */
const STATUS_ORDER = ["PLANNED", "LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
export function currentStepIndex(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 0 : Math.min(i, 4);
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", LIBRARY_PREP: "blue", LIBRARY_POOLING: "cyan",
  SEQUENCING: "purple", ANALYZING: "geekblue", QC_REVIEW: "orange",
  COMPLETED: "green", FAILED: "red",
};
const STATUS_TEXT: Record<string, string> = {
  PLANNED: "待提取", LIBRARY_PREP: "建库中", LIBRARY_POOLING: "Pooling 中",
  SEQUENCING: "测序中", ANALYZING: "分析中", QC_REVIEW: "QC 复核",
  COMPLETED: "已完成", FAILED: "失败",
};

export default function NiptStepBatches() {
  const navigate = useNavigate();
  const { step = "extraction" } = useParams();
  const meta = NIPT_STEP_META[step];

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await runsApi.list({ panel_code: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 100, ordering: "-created_at" });
      const data: any = res.data;
      setRows(Array.isArray(data) ? data : (data?.results || []));
    } catch {
      message.error("批次列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  if (!meta) {
    return <Card><Text type="danger">未知步骤：{step}</Text></Card>;
  }

  const myIdx = meta.order - 1;

  const columns = [
    { title: "批次号", dataIndex: "run_number", key: "rn", width: 180,
      render: (v: string) => <Text code>{v}</Text> },
    { title: "样本", dataIndex: "sample_count", key: "sc", width: 70, align: "center" as const },
    { title: "当前步骤", key: "cur", width: 110,
      render: (_: any, r: any) => {
        const idx = currentStepIndex(r.status);
        const key = Object.keys(NIPT_STEP_META).find(k => NIPT_STEP_META[k].order - 1 === idx);
        return <Tag>{key ? NIPT_STEP_META[key].title : "—"}</Tag>;
      } },
    { title: `${meta.title}进度`, key: "stepstate", width: 110,
      render: (_: any, r: any) => {
        const idx = currentStepIndex(r.status);
        if (r.status === "COMPLETED" || idx > myIdx) return <Tag color="green">已完成</Tag>;
        if (idx === myIdx) return <Tag color="blue">本步进行中</Tag>;
        return <Tag color="default">未开始</Tag>;
      } },
    { title: "状态", dataIndex: "status", key: "st", width: 100,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{STATUS_TEXT[v] || v}</Tag> },
    { title: "创建时间", dataIndex: "created_at", key: "ca", width: 120,
      render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD") : "—") },
    { title: "", key: "act", width: 110,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<ArrowRightOutlined />}
          onClick={(e) => { e.stopPropagation(); navigate(`/nipt/${step}/${r.id}`); }}>
          进入本步
        </Button>
      ) },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>{meta.title}</Title>
          <Tooltip title="阶段1：这里已把 5 步拆成独立入口；批次仍是原来的整流程批次（阶段2 起改为每步独立批次 + 上游汇流）">
            <InfoCircleOutlined style={{ color: "#8c8c8c" }} />
          </Tooltip>
        </Space>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={fetchBatches}>刷新</Button>}
    >
      <Table
        dataSource={rows}
        columns={columns as any}
        rowKey="id"
        size="small"
        loading={loading}
        pagination={{ pageSize: 20, size: "small" }}
        onRow={(r: any) => ({ onClick: () => navigate(`/nipt/${step}/${r.id}`), style: { cursor: "pointer" } })}
      />
    </Card>
  );
}
