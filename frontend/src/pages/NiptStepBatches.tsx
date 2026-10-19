// NiptStepBatches.tsx — NIPT 实验流程「分步批次」列表
// 阶段2：提取 / 建库 已切到新表（nipt_workflow）；Pooling/测序/生信 仍读整流程 SampleRun（阶段3 再切）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Table, Tag, Button, Typography, Space, message, Modal, Alert } from "antd";
import { ReloadOutlined, ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { runsApi, niptExtractionApi, niptLibraryApi } from "../api";

const { Text, Title } = Typography;

export const NIPT_STEP_META: Record<string, { order: number; title: string; status: string }> = {
  extraction:     { order: 1, title: "提取",     status: "PLANNED" },
  library:        { order: 2, title: "文库构建", status: "LIBRARY_PREP" },
  pooling:        { order: 3, title: "Pooling",  status: "LIBRARY_POOLING" },
  sequencing:     { order: 4, title: "测序",     status: "SEQUENCING" },
  bioinformatics: { order: 5, title: "生信分析", status: "ANALYZING" },
};

const STATUS_ORDER = ["PLANNED", "LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];
export function currentStepIndex(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 0 : Math.min(i, 4);
}

const NEW_STEP_HINT: Record<string, string> = {
  extraction: "每批 = 一次提取实验（96 孔板）。完成后样本进入「待建库」。",
  library: "可勾选多个提取批次的样本汇成一个建库批次（上游谱系自动记录）。",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", IN_PROGRESS: "blue", COMPLETED: "green", CANCELLED: "red",
  PLANNED: "default", LIBRARY_PREP: "blue", LIBRARY_POOLING: "cyan",
  SEQUENCING: "purple", ANALYZING: "geekblue", QC_REVIEW: "orange", FAILED: "red",
};
const STATUS_TEXT: Record<string, string> = {
  DRAFT: "草稿", IN_PROGRESS: "进行中", COMPLETED: "已完成", CANCELLED: "已取消",
  PLANNED: "待提取", LIBRARY_PREP: "建库中", LIBRARY_POOLING: "Pooling 中",
  SEQUENCING: "测序中", ANALYZING: "分析中", QC_REVIEW: "QC 复核", FAILED: "失败",
};

export default function NiptStepBatches() {
  const navigate = useNavigate();
  const { step = "extraction" } = useParams();
  const meta = NIPT_STEP_META[step];
  const isNewStep = step === "extraction" || step === "library";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ count: number; results: any[] }>({ count: 0, results: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const api = step === "extraction" ? niptExtractionApi : step === "library" ? niptLibraryApi : null;

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      if (api) {
        const res: any = await api.list({ page_size: 100 });
        const d = res.data;
        const list = Array.isArray(d) ? d : (d?.results || []);
        setRows(list.map((b: any) => ({
          id: b.id, no: b.batch_number, count: b.sample_count,
          status: b.status, status_display: b.status_display,
          extra: b.source_extraction_batch_count, created_at: b.created_at,
        })));
        try {
          const p: any = await api.pending();
          setPending({ count: p.data?.count || 0, results: p.data?.results || [] });
        } catch { setPending({ count: 0, results: [] }); }
      } else {
        const res: any = await runsApi.list({ panel_code: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 100, ordering: "-created_at" });
        const d = res.data;
        const list = Array.isArray(d) ? d : (d?.results || []);
        setRows(list.map((r: any) => ({
          id: r.id, no: r.run_number, count: r.sample_count,
          status: r.status, status_display: STATUS_TEXT[r.status] || r.status,
          extra: null, created_at: r.created_at, raw_status: r.status,
        })));
        setPending({ count: 0, results: [] });
      }
    } catch {
      message.error("批次列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const createBatch = async () => {
    if (!api) return;
    if (!picked.length) { message.warning("请先勾选要加入批次的样本"); return; }
    setCreating(true);
    try {
      let body: any;
      if (step === "extraction") {
        body = { sample_ids: picked };
      } else {
        const pickedRows = pending.results.filter(r => picked.includes(r.extraction_sample_id));
        body = {
          sample_ids: Array.from(new Set(pickedRows.map(r => r.sample_id))),
          source_extraction_sample_ids: pickedRows.map(r => r.extraction_sample_id),
        };
      }
      const res: any = await api.create(body);
      message.success("批次已创建：" + res.data?.batch_number);
      setModalOpen(false); setPicked([]);
      const nid = res.data?.id;
      fetchRows();
      if (nid) navigate(`/nipt/${step}/${nid}`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || e?.response?.data?.detail || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const columns = useMemo(() => {
    if (api) {
      return [
        { title: "批次号", dataIndex: "no", key: "no", width: 240,
          render: (v: string, r: any) => (
            <Space size={4}>
              <Text code>{v}</Text>
              {step === "library" && r.extra > 0 && (
                <Tag color={r.extra > 1 ? "gold" : "default"}>汇入 {r.extra} 个提取批次</Tag>
              )}
            </Space>
          ) },
        { title: "样本", dataIndex: "count", key: "c", width: 70, align: "center" as const },
        { title: "状态", dataIndex: "status", key: "st", width: 90,
          render: (v: string, r: any) => <Tag color={STATUS_COLOR[v] || "default"}>{r.status_display || STATUS_TEXT[v] || v}</Tag> },
        { title: "创建时间", dataIndex: "created_at", key: "ca", width: 160,
          render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—") },
        { title: "", key: "act", width: 110,
          render: (_: any, r: any) => (
            <Button type="link" size="small" icon={<ArrowRightOutlined />}
              onClick={(e) => { e.stopPropagation(); navigate(`/nipt/${step}/${r.id}`); }}>
              进入本步
            </Button>
          ) },
      ];
    }
    const myIdx = (meta?.order || 1) - 1;
    return [
      { title: "批次号", dataIndex: "no", key: "no", width: 180, render: (v: string) => <Text code>{v}</Text> },
      { title: "样本", dataIndex: "count", key: "c", width: 70, align: "center" as const },
      { title: "当前步骤", key: "cur", width: 100,
        render: (_: any, r: any) => {
          const idx = currentStepIndex(r.raw_status);
          const k = Object.keys(NIPT_STEP_META).find(x => NIPT_STEP_META[x].order - 1 === idx);
          return <Tag>{k ? NIPT_STEP_META[k].title : "—"}</Tag>;
        } },
      { title: `${meta?.title}进度`, key: "ss", width: 100,
        render: (_: any, r: any) => {
          if (r.raw_status === "COMPLETED" || currentStepIndex(r.raw_status) > myIdx) return <Tag color="green">已完成</Tag>;
          if (currentStepIndex(r.raw_status) === myIdx) return <Tag color="blue">本步进行中</Tag>;
          return <Tag>未开始</Tag>;
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
  }, [api, meta, step, navigate]);

  if (!meta) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  const pendingCols = step === "library"
    ? [
        { title: "样本编号", dataIndex: "sample_code", key: "sc", width: 170 },
        { title: "姓名", dataIndex: "patient_name", key: "pn", ellipsis: true },
        { title: "来源提取批次", dataIndex: "source_batch", key: "sb", width: 190,
          render: (v: string) => <Text code>{v}</Text> },
        { title: "孔位", dataIndex: "well_position", key: "wp", width: 70 },
      ]
    : [
        { title: "样本编号", dataIndex: "sample_id", key: "sc", width: 170 },
        { title: "姓名", dataIndex: "patient_name", key: "pn", ellipsis: true },
        { title: "来源", dataIndex: "sample_source", key: "src", width: 150, ellipsis: true },
        { title: "血浆(管)", dataIndex: "plasma_remaining", key: "pr", width: 80, align: "center" as const },
      ];

  return (
    <>
      <Card
        size="small"
        title={<Title level={5} style={{ margin: 0 }}>{meta.title}</Title>}
        extra={
          <Space>
            {isNewStep && (
              <Button type="primary" size="small" icon={<PlusOutlined />}
                onClick={() => { setPicked([]); setModalOpen(true); }}>
                新建批次{pending.count > 0 ? `（待处理 ${pending.count}）` : ""}
              </Button>
            )}
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={fetchRows}>刷新</Button>
          </Space>
        }
      >
        {isNewStep && (
          <Alert type="info" showIcon style={{ marginBottom: 10 }}
            message={`${NEW_STEP_HINT[step]}  待处理 ${pending.count} 个样本`} />
        )}
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

      <Modal
        open={modalOpen}
        title={`新建${meta.title}批次 · 从待处理勾选`}
        onCancel={() => setModalOpen(false)}
        onOk={createBatch}
        okText={creating ? "创建中…" : "创建批次"}
        confirmLoading={creating}
        width={880}
        destroyOnClose
      >
        <Alert type="warning" showIcon style={{ marginBottom: 10 }}
          message={step === "library"
            ? "可跨提取批次勾选：勾中的样本会进同一个建库批次，上游提取批次自动记录。"
            : "勾选的样本会进入同一块 96 孔板的提取批次。"} />
        <Table
          size="small"
          dataSource={pending.results}
          columns={pendingCols as any}
          rowKey={(r: any) => r.extraction_sample_id || r.id}
          pagination={{ pageSize: 10, size: "small" }}
          rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
          scroll={{ y: 340 }}
        />
      </Modal>
    </>
  );
}
