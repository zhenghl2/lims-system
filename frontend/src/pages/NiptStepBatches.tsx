// NiptStepBatches.tsx — NIPT 实验流程「分步批次」列表（阶段3：5 步全部走新表）
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Table, Tag, Button, Typography, Space, message, Modal, Alert } from "antd";
import { ReloadOutlined, ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  niptExtractionApi, niptLibraryApi, niptPoolingApi, niptSequencingApi, niptBioinformaticsApi,
} from "../api";

const { Text, Title } = Typography;

export const NIPT_STEP_META: Record<string, { order: number; title: string; status: string; hint: string }> = {
  extraction:     { order: 1, title: "提取",     status: "PLANNED",         hint: "每批 = 一次提取实验（96 孔板）。完成后样本进入「待建库」。" },
  library:        { order: 2, title: "文库构建", status: "LIBRARY_PREP",    hint: "可勾选多个提取批次的样本汇成一个建库批次（上游谱系自动记录）。" },
  pooling:        { order: 3, title: "Pooling",  status: "LIBRARY_POOLING", hint: "可勾选多个建库批次的样本汇成一个 Pooling 批次。" },
  sequencing:     { order: 4, title: "测序",     status: "SEQUENCING",      hint: "可勾选多个 Pooling 批次的样本汇成一次上机。" },
  bioinformatics: { order: 5, title: "生信分析", status: "ANALYZING",       hint: "可勾选多个测序批次的样本汇成一个分析批次，报告按此谱系追溯。" },
};

const STEP_API: Record<string, any> = {
  extraction: niptExtractionApi,
  library: niptLibraryApi,
  pooling: niptPoolingApi,
  sequencing: niptSequencingApi,
  bioinformatics: niptBioinformaticsApi,
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", IN_PROGRESS: "blue", COMPLETED: "green", CANCELLED: "red",
};
const STATUS_TEXT: Record<string, string> = {
  DRAFT: "草稿", IN_PROGRESS: "进行中", COMPLETED: "已完成", CANCELLED: "已取消",
};

export default function NiptStepBatches() {
  const navigate = useNavigate();
  const { step = "extraction" } = useParams();
  const meta = NIPT_STEP_META[step];
  const api = STEP_API[step];

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ count: number; results: any[] }>({ count: 0, results: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const res: any = await api.list({ page_size: 100 });
      const d = res.data;
      const list = Array.isArray(d) ? d : (d?.results || []);
      setRows(list.map((b: any) => ({
        id: b.id, no: b.batch_number, count: b.sample_count,
        status: b.status, status_display: b.status_display,
        extra: b.source_batch_count ?? b.source_extraction_batch_count,
        photos_pending: b.photos_pending,
        created_at: b.created_at,
      })));
      try {
        const p: any = await api.pending();
        setPending({ count: p.data?.count || 0, results: p.data?.results || [] });
      } catch { setPending({ count: 0, results: [] }); }
    } catch {
      message.error("批次列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  /** 待处理行统一成 {key, sampleId, code, name, source, pos} */
  const pendingRows = useMemo(() => pending.results.map((r: any) => ({
    key: r.extraction_sample_id || r.id,
    sampleId: r.sample_id || r.id,
    code: r.sample_code || r.sample_id,
    vg: r.sample_vg_id || r.vg_id || "",
    name: r.patient_name,
    source: r.source_batch || r.sample_source || "",
    pos: r.well_position || "",
    plasma: r.plasma_remaining,
  })), [pending.results]);

  const createBatch = async () => {
    if (!api) return;
    if (!picked.length) { message.warning("请先勾选要加入批次的样本"); return; }
    setCreating(true);
    try {
      let body: any;
      if (step === "extraction") {
        body = { sample_ids: picked };
      } else {
        const sel = pendingRows.filter(r => picked.includes(r.key));
        body = {
          sample_ids: Array.from(new Set(sel.map(r => r.sampleId))),
          source_extraction_sample_ids: sel.map(r => r.key),   // 后端按「上游行」建指针
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

  const columns = useMemo(() => ([
    { title: "批次号", dataIndex: "no", key: "no", width: 250,
      render: (v: string, r: any) => (
        <Space size={4}>
          <Text code>{v}</Text>
          {step !== "extraction" && r.extra > 0 && (
            <Tag color={r.extra > 1 ? "gold" : "default"}>汇入 {r.extra} 个上游批次</Tag>
          )}
        </Space>
      ) },
    { title: "样本", dataIndex: "count", key: "c", width: 70, align: "center" as const },
    { title: "状态", dataIndex: "status", key: "st", width: 150,
      render: (v: string, r: any) => (
        <Space size={4} wrap>
          <Tag color={STATUS_COLOR[v] || "default"}>{r.status_display || STATUS_TEXT[v] || v}</Tag>
          {r.photos_pending && <Tag color="orange" style={{ fontSize: 10 }}>📷 待补照片</Tag>}
        </Space>
      ) },
    { title: "创建时间", dataIndex: "created_at", key: "ca", width: 160,
      render: (v: string) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—") },
    { title: "", key: "act", width: 110,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<ArrowRightOutlined />}
          onClick={(e) => { e.stopPropagation(); navigate(`/nipt/${step}/${r.id}`); }}>
          进入本步
        </Button>
      ) },
  ]), [step, navigate]);

  if (!meta || !api) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  // 2026-10-26：新建批次待处理列表统一增加 VG ID 列（提取 / 建库 / Pooling / 测序）
  const vgCol = { title: "VG ID", dataIndex: "vg", key: "cvg", width: 120,
    render: (v: string) => v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text> };
  const pendingCols = step === "extraction"
    ? [
        { title: "样本编号", dataIndex: "code", key: "c1", width: 170 },
        vgCol,
        { title: "姓名", dataIndex: "name", key: "c2", ellipsis: true },
        { title: "来源", dataIndex: "source", key: "c3", width: 150, ellipsis: true },
        { title: "血浆(管)", dataIndex: "plasma", key: "c4", width: 80, align: "center" as const },
      ]
    : [
        { title: "样本编号", dataIndex: "code", key: "c1", width: 170 },
        vgCol,
        { title: "姓名", dataIndex: "name", key: "c2", ellipsis: true },
        { title: "上游批次", dataIndex: "source", key: "c3", width: 200,
          render: (v: string) => <Text code>{v}</Text> },
        { title: "孔位", dataIndex: "pos", key: "c4", width: 70 },
      ];

  return (
    <>
      <Card
        size="small"
        title={<Title level={5} style={{ margin: 0 }}>{meta.title}</Title>}
        extra={
          <Space>
            <Button type="primary" size="small" icon={<PlusOutlined />}
              onClick={() => { setPicked([]); setModalOpen(true); }}>
              新建批次{pending.count > 0 ? `（待处理 ${pending.count}）` : ""}
            </Button>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={fetchRows}>刷新</Button>
          </Space>
        }
      >
        <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message={`${meta.hint}  待处理 ${pending.count} 个样本`} />
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
          message={step === "extraction"
            ? "勾选的样本会进入同一块 96 孔板的提取批次。"
            : "可跨上游批次勾选：勾中的样本进同一个批次，上游批次谱系自动记录。"} />
        {pendingRows.length === 0 ? (
          <Alert type="success" showIcon message="暂无待处理样本（上游已全部进批次）" />
        ) : (
          <Table
            size="small"
            dataSource={pendingRows}
            columns={pendingCols as any}
            rowKey="key"
            pagination={{ pageSize: 10, size: "small" }}
            rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
            scroll={{ y: 340 }}
          />
        )}
      </Modal>
    </>
  );
}
