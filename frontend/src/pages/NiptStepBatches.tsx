// NiptStepBatches.tsx — NIPT 实验流程「分步批次」列表（阶段3：5 步全部走新表）
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, Table, Tag, Button, Typography, Space, message, Modal, Alert, Input, Tooltip, Row, Col, Empty } from "antd";
import NiptStepDetail from "./NiptStepDetail";
import { ReloadOutlined, PlusOutlined, DeleteOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
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
  const [selectedId, setSelectedId] = useState<string>("");   // 2026-11-10 左右分栏：右侧显示的批次
  const [listCollapsed, setListCollapsed] = useState(false);  // 2026-11-10：收起左侧列表，右侧占满
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ count: number; results: any[] }>({ count: 0, results: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  // 2026-11-05：测序批次由操作员手填 chip 号当批次号（chip7047 → R7047）
  const [chipNo, setChipNo] = useState("");

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

  /** 2026-11-05：测序步骤按「上游 Pooling 批次」整组勾选 —— 56 个样本变成 7 组，
   *  等价于 NIPPT 按 mix 勾选（NIPT 一次 pooling 实验 = 一管）。 */
  const poolGroups = useMemo(() => {
    const m = new Map<string, any[]>();
    pendingRows.forEach((r: any) => {
      const k = r.source || "未分组";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return Array.from(m.entries()).map(([batch, rows]) => ({
      key: batch,
      batch,
      count: rows.length,
      vgPreview: rows.map((r: any) => r.vg).filter(Boolean).slice(0, 4).join(", ")
        + (rows.filter((r: any) => r.vg).length > 4 ? " …" : ""),
      sampleKeys: rows.map((r: any) => r.key),
      rows,
    }));
  }, [pendingRows]);

  /** 本次真正要提交的样本行：测序按组展开，其它步骤按勾选的样本 */
  const pickedRows = useMemo(() => {
    if (step !== "sequencing") return pendingRows.filter((r: any) => picked.includes(r.key));
    const keys = new Set<string>();
    poolGroups.forEach((g: any) => { if (picked.includes(g.key)) g.sampleKeys.forEach((k: string) => keys.add(k)); });
    return pendingRows.filter((r: any) => keys.has(r.key));
  }, [step, pendingRows, picked, poolGroups]);

  const confirmDelete = (r: any) => {
    Modal.confirm({
      title: `删除批次 ${r.no}？`,
      content: "批次内样本会回到「待处理」，可重新建批次。已完成的批次不能删除。",
      okText: "删除", okType: "danger", cancelText: "取消",
      onOk: async () => {
        try {
          await api.remove(r.id);
          message.success(`已删除批次 ${r.no}`);
          fetchRows();
        } catch (e: any) {
          message.error(e?.response?.data?.error || e?.response?.data?.detail || "删除失败");
        }
      },
    });
  };

  const createBatch = async () => {
    if (!api) return;
    if (!pickedRows.length) {
      message.warning(step === "sequencing" ? "请先勾选要上机的上游批次" : "请先勾选要加入批次的样本");
      return;
    }
    setCreating(true);
    try {
      let body: any;
      if (step === "extraction") {
        body = { sample_ids: picked };
      } else {
        const sel = pickedRows;
        body = {
          sample_ids: Array.from(new Set(sel.map(r => r.sampleId))),
          source_extraction_sample_ids: sel.map(r => r.key),   // 后端按「上游行」建指针
        };
        if (step === "sequencing") body.batch_number = chipNo.trim();
      }
      const res: any = await api.create(body);
      message.success("批次已创建：" + res.data?.batch_number);
      setModalOpen(false); setPicked([]); setChipNo("");
      const nid = res.data?.id;
      fetchRows();
      if (nid) setSelectedId(nid);   // 2026-11-10 分栏：新建后直接在右侧打开
    } catch (e: any) {
      message.error(e?.response?.data?.error || e?.response?.data?.detail || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const columns = useMemo(() => ([
    { title: "批次号", dataIndex: "no", key: "no",
      render: (v: string, r: any) => (
        <Space size={4}>
          <Text code style={{ fontSize: 11, whiteSpace: "nowrap" }}>{v}</Text>
          {step !== "extraction" && r.extra > 0 && (
            <Tag color={r.extra > 1 ? "gold" : "default"}>汇入 {r.extra} 个上游批次</Tag>
          )}
        </Space>
      ) },
    { title: "样本", dataIndex: "count", key: "c", width: 58, align: "center" as const, onHeaderCell: () => ({ style: { whiteSpace: "nowrap" } }) },
    { title: "状态", dataIndex: "status", key: "st", width: 100,
      render: (v: string, r: any) => (
        <Space size={4} wrap>
          <Tag color={STATUS_COLOR[v] || "default"}>{r.status_display || STATUS_TEXT[v] || v}</Tag>
          {r.photos_pending && <Tag color="orange" style={{ fontSize: 10 }}>📷 待补照片</Tag>}
        </Space>
      ) },
    ...(step === "sequencing" ? [{ title: "", key: "act", width: 46,
      render: (_: any, r: any) => (
        <Tooltip title={r.status === "COMPLETED" ? "已完成批次不能删除" : "删除该批次（样本回到待处理）"}>
          <Button danger type="link" size="small" icon={<DeleteOutlined />}
            disabled={r.status === "COMPLETED"}
            onClick={(e) => { e.stopPropagation(); confirmDelete(r); }} />
        </Tooltip>
      ) }] : []),
  ]), [step, navigate, confirmDelete]);

  if (!meta || !api) return <Card><Text type="danger">未知步骤：{step}</Text></Card>;

  // 2026-10-26：新建批次待处理列表统一增加 VG ID 列（提取 / 建库 / Pooling / 测序）
  // 纯文本显示（不要 code 小方框）
  const vgCol = { title: "VG ID", dataIndex: "vg", key: "cvg", width: 120,
    render: (v: string) => v ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> : <Text type="secondary">-</Text> };
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
      <Row gutter={12} align="top">
      {listCollapsed ? (
        <Col flex="40px">
          <Tooltip title="展开批次列表" placement="right">
            <Button icon={<MenuUnfoldOutlined />} onClick={() => setListCollapsed(false)}
              style={{ height: 72, width: 34, padding: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />
          </Tooltip>
        </Col>
      ) : (
      <Col span={6}>
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
            <Tooltip title="收起批次列表（右侧占满）">
              <Button size="small" icon={<MenuFoldOutlined />} onClick={() => setListCollapsed(true)} />
            </Tooltip>
          </Space>
        }
      >
        <Alert type="info" showIcon style={{ marginBottom: 8, fontSize: 12 }}
          message={`${meta.hint}  待处理 ${pending.count} 个样本`} />
        <Table
          dataSource={rows}
          columns={columns as any}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, size: "small" }}
          onRow={(r: any) => ({
            onClick: () => setSelectedId(r.id),
            style: { cursor: "pointer", background: r.id === selectedId ? "#e6f7ff" : undefined },
          })}
        />
      </Card>
      </Col>
      )}
      <Col flex="auto">
        {selectedId
          ? <NiptStepDetail step={step} batchId={selectedId} onChanged={fetchRows} />
          : <Card size="small" style={{ minHeight: 320 }}>
              <Empty description="点击左侧批次查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </Card>}
      </Col>
    </Row>

      <Modal
        open={modalOpen}
        title={`新建${meta.title}批次 · 从待处理勾选`}
        onCancel={() => { setModalOpen(false); setChipNo(""); }}
        onOk={createBatch}
        okText={creating ? "创建中…" : "创建批次"}
        confirmLoading={creating}
        okButtonProps={{ disabled: picked.length === 0 || (step === "sequencing" && !chipNo.trim()) }}
        width={880}
        destroyOnClose
      >
        {step === "sequencing" && (
          <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <Text strong>批次号（芯片号）</Text>
            <Input
              style={{ width: 190 }}
              value={chipNo}
              onChange={(e) => setChipNo(e.target.value)}
              placeholder="例如 chip7047"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              即本批次的批次号；index 表的 Batch Number 用它，Report Code 前缀取
              {" "}<Text code style={{ fontSize: 12 }}>R{(chipNo.trim().replace(/^chip/i, "") || "XXXX")}</Text>
            </Text>
          </div>
        )}
        <Alert type="warning" showIcon style={{ marginBottom: 10 }}
          message={step === "extraction"
            ? "勾选的样本会进入同一块 96 孔板的提取批次。"
            : step === "sequencing"
              ? "按上游 Pooling 批次整组勾选（一次 pooling = 一管）；勾中某个批次，该批全部样本进入本次上机。"
              : "可跨上游批次勾选：勾中的样本进同一个批次，上游批次谱系自动记录。"} />
        {pendingRows.length === 0 ? (
          <Alert type="success" showIcon message="暂无待处理样本（上游已全部进批次）" />
        ) : step === "sequencing" ? (
          <Table
            size="small"
            dataSource={poolGroups as any}
            rowKey="key"
            pagination={false}
            rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
            columns={[
              { title: "上游 Pooling 批次", dataIndex: "batch", key: "g1",
                render: (v: string) => <Text code>{v}</Text> },
              { title: "样本数", dataIndex: "count", key: "g2", width: 80, align: "center" as const },
              { title: "VG ID", dataIndex: "vgPreview", key: "g3", ellipsis: true },
            ]}
            expandable={{
              expandedRowRender: (g: any) => (
                <Table size="small" pagination={false} dataSource={g.rows} rowKey="key"
                  columns={[
                    { title: "样本编号", dataIndex: "code", key: "s1", width: 180 },
                    { title: "VG ID", dataIndex: "vg", key: "s2", width: 120 },
                    { title: "姓名", dataIndex: "name", key: "s3", ellipsis: true },
                    { title: "孔位", dataIndex: "pos", key: "s4", width: 80 },
                  ]} />
              ),
            }}
            scroll={{ y: 340 }}
          />
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
