import { useEffect, useState, useCallback } from "react";
import {
  Table, Button, Tag, Tabs, Form, Input, Select, Modal, Popconfirm,
  Space, Typography, message, Empty, Spin, Dropdown, Statistic, InputNumber,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ReloadOutlined, SyncOutlined, DeleteOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";

import { STATUS_COLOR, STATUS_LABEL } from "./hpv/constants";
import ExtractionTab from "./hpv/ExtractionTab";
import PcrTab from "./hpv/PcrTab";
import HybridizationTab from "./hpv/HybridizationTab";
import ResultEntryTab from "./hpv/ResultEntryTab";
import RetestTab from "./hpv/RetestTab";

const { Title } = Typography;

// ─── Main Component ─────────────────────────────────────────────

export default function HpvWorkflow() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchDetail, setBatchDetail] = useState<any>(null);
  const [wells, setWells] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("extraction");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.get("/hpv/batches/", { params });
      setBatches(r.data.results || r.data || []);
    } catch (e: any) { message.error(e?.response?.data?.error || "加载批次列表失败"); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const selectBatch = useCallback(async (batch: any) => {
    setSelectedBatch(batch);
    setDetailLoading(true);
    setActiveTab("extraction");
    try {
      const [bd, w, r] = await Promise.all([
        api.get(`/hpv/batches/${batch.id}/`),
        api.get(`/hpv/batches/${batch.id}/wells/`),
        api.get("/hpv/results/", { params: { batch: batch.id } }),
      ]);
      setBatchDetail(bd.data);
      setWells(Array.isArray(w.data) ? w.data : []);
      setResults(Array.isArray(r.data.results) ? r.data.results : (Array.isArray(r.data) ? r.data : []));
    } catch (e: any) { message.error(e?.response?.data?.error || "加载批次详情失败"); }
    finally { setDetailLoading(false); }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!selectedBatch) return;
    setDetailLoading(true);
    try {
      const [bd, w, r] = await Promise.all([
        api.get(`/hpv/batches/${selectedBatch.id}/`),
        api.get(`/hpv/batches/${selectedBatch.id}/wells/`),
        api.get("/hpv/results/", { params: { batch: selectedBatch.id } }),
      ]);
      setBatchDetail(bd.data);
      setWells(Array.isArray(w.data) ? w.data : []);
      setResults(Array.isArray(r.data.results) ? r.data.results : (Array.isArray(r.data) ? r.data : []));
    } catch (e: any) { message.error(e?.response?.data?.error || "刷新批次详情失败"); }
    finally { setDetailLoading(false); }
  }, [selectedBatch]);

  const batchColumns: ColumnsType<any> = [
    { title: "批次号", dataIndex: "batch_number", key: "batch_number", width: 140 },
    { title: "状态", dataIndex: "status", key: "status", width: 100,
      render: (s: string) => <Tag color={STATUS_COLOR[s] || "default"}>{STATUS_LABEL[s] || s}</Tag>,
    },
    { title: "结果数", dataIndex: "result_count", key: "result_count", width: 70, align: "center" },
    { title: "创建人", dataIndex: "created_by_name", key: "creator", width: 100, ellipsis: true },
    { title: "创建时间", dataIndex: "created_at", key: "created_at", width: 130,
      render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-",
    },
    { title: "操作", key: "actions", width: 140, fixed: "right",
      render: (_: any, rec: any) => {
        const deleteBatch = async () => {
          try {
            await api.delete(`/hpv/batches/${rec.id}/`);
            message.success(`批次 ${rec.batch_number} 已删除`);
            // Clear detail panel if deleted batch was selected
            if (selectedBatch?.id === rec.id) {
              setSelectedBatch(null);
              setBatchDetail(null);
            }
            fetchBatches();
          } catch (e: any) {
            const data = e?.response?.data;
            const msg = data?.error || data?.detail
              || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
            message.error(msg || "删除失败");
          }
        };
        return (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => selectBatch(rec)}>查看</Button>
            <Popconfirm
              title="确认删除"
              description={`确定要删除批次 ${rec.batch_number} 吗？此操作不可撤销。`}
              onConfirm={deleteBatch}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const batchDetailTabs = [
    { key: "extraction", label: "\u2460 核酸提取" },
    { key: "pcr", label: "\u2461 PCR 扩增" },
    { key: "hybridization", label: "\u2462 杂交显色" },
    { key: "results", label: "\u2463 结果录入" },
    { key: "retests", label: "复查记录" },
  ];

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 140px)" }}>
      <div style={{ width: sidebarCollapsed ? 50 : 540, flexShrink: 0, display: "flex", flexDirection: "column", transition: "width 0.25s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          {sidebarCollapsed ? (
            <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setSidebarCollapsed(false)}
              style={{ padding: 4 }} title="展开批次列表" />
          ) : (
            <>
              <Title level={5} style={{ margin: 0 }}>HPV 分析批</Title>
              <Space>
                <Select placeholder="全部状态" allowClear size="small" style={{ width: 110 }}
                  value={statusFilter} onChange={setStatusFilter}
                  options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
                />
                <Button size="small" icon={<ReloadOutlined />} onClick={fetchBatches} />
                <CreateBatchModal onCreated={() => { fetchBatches(); }} />
                <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setSidebarCollapsed(true)}
                  style={{ padding: 4 }} title="折叠批次列表" />
              </Space>
            </>
          )}
        </div>
        {!sidebarCollapsed && (
        <Table rowKey="id" columns={batchColumns} dataSource={batches} loading={loading}
          size="small" pagination={{ pageSize: 15, size: "small" }} scroll={{ y: "calc(100vh - 280px)" }}
          onRow={(rec) => ({
            onClick: () => selectBatch(rec),
            style: { background: selectedBatch?.id === rec.id ? "#e6f4ff" : undefined, cursor: "pointer" },
          })}
        />
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", border: "1px solid #f0f0f0", borderRadius: 8, padding: 16 }}>
        {!batchDetail ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Empty description="选择左侧批次查看详情" />
          </div>
        ) : detailLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Spin size="large" />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Space>
                <Title level={4} style={{ margin: 0 }}>{batchDetail.batch_number}</Title>
                <Tag color={STATUS_COLOR[batchDetail.status] || "default"}>
                  {STATUS_LABEL[batchDetail.status] || batchDetail.status}
                </Tag>
              </Space>
              <Space>
                <AdvanceStatusButton batch={batchDetail} onDone={() => selectBatch(batchDetail)} />
              </Space>
            </div>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={batchDetailTabs.map(tab => {
              let children: React.ReactNode = <Empty description="功能开发中" />;
              if (tab.key === "extraction") children = <ExtractionTab batch={batchDetail} wells={wells} onRefresh={refreshDetail} />;
              else if (tab.key === "pcr") children = <PcrTab batch={batchDetail} onRefresh={refreshDetail} />;
              else if (tab.key === "hybridization") children = <HybridizationTab batch={batchDetail} wells={wells} onRefresh={refreshDetail} />;
              else if (tab.key === "results") children = <ResultEntryTab batch={batchDetail} results={results} wells={wells} onRefresh={refreshDetail} />;
              else if (tab.key === "retests") children = <RetestTab batch={batchDetail} />;
              return { ...tab, children };
            })} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Create Batch Modal ────────────────────────────────────────

function CreateBatchModal({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const loadPendingCount = async () => {
    try {
      const [sRes, rRes, bRes] = await Promise.all([
        api.get("/samples/", { params: { panel: "HPV", status: "RECEIVED", limit: 1 } }),
        api.get("/hpv/results/", { params: { review_status: "NEEDS_RETEST", limit: 1 } }),
        api.get("/hpv/batches/"),
      ]);
      const received = sRes.data?.count ?? 0;
      const retest = rRes.data?.count ?? 0;
      // Subtract samples already assigned to well positions
      const batches = (bRes.data.results || bRes.data || []);
      const batchedIds = new Set<string>();
      batches.forEach((b: any) => {
        (b.well_positions || []).forEach((wp: any) => {
          if (wp.sample) batchedIds.add(wp.sample);
        });
      });
      setPendingCount(Math.max(0, received + retest - batchedIds.size));
    } catch {
      setPendingCount(0);
    }
  };

  const handleOk = async () => {
    try {
      const vals = await form.validateFields();
      setSubmitting(true);
      const payload: any = { batch_number: vals.batch_number };
      // Always pre-generate 48 wells (column-major: A1,B1,...,H1, A2,...,H6)
      payload.well_labels = [];
      const rows = ['A','B','C','D','E','F','G','H'];
      for (let c = 1; c <= 6; c++) {
        for (let r = 0; r < 8; r++) {
          payload.well_labels.push(`${rows[r]}${c}`);
        }
      }
      if (vals.planned_count != null) {
        payload.planned_count = vals.planned_count;
      }
      await api.post("/hpv/batches/", payload);
      message.success("批次创建成功");
      setOpen(false);
      form.resetFields();
      onCreated();
    } catch (e: any) {
      if (e?.errorFields) return;
      let msg = e?.response?.data?.error || e?.response?.data?.detail;
      if (!msg) {
        const data = e?.response?.data;
        if (data && typeof data === "object") {
          const keys = Object.keys(data);
          if (keys.length > 0 && Array.isArray(data[keys[0]])) {
            msg = data[keys[0]][0];
          }
        }
      }
      message.error(msg || "创建失败");
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <Button type="primary" size="small" icon={<PlusOutlined />}
        onClick={() => { setOpen(true); loadPendingCount(); }}>新建批次</Button>
      <Modal title="创建 HPV 分析批" open={open} onOk={handleOk} onCancel={() => setOpen(false)}
        confirmLoading={submitting} destroyOnClose>
        {pendingCount > 0 && (
          <div style={{ marginBottom: 16, padding: "8px 12px", background: "#e6f4ff", borderRadius: 6 }}>
            <Statistic title="待测样本总数" value={pendingCount} valueStyle={{ fontSize: 18, color: "#1677ff" }}
              suffix="个" />
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              含已收样 + 待复查样本
            </div>
          </div>
        )}
        <Form form={form} layout="vertical">
          <Form.Item name="batch_number" label="批次号" rules={[{ required: false }]} extra="留空则自动生成，格式：YYYYMMDD-MMDD（月批次+日批次）">
            <Input placeholder="留空自动生成，例：20260521-0301" />
          </Form.Item>
          <Form.Item name="planned_count" label="本批次计划检测样本数">
            <InputNumber min={1} max={48} placeholder="最多48孔" style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// ─── Advance Status Button ─────────────────────────────────────

function AdvanceStatusButton({ batch, onDone }: { batch: any; onDone: () => void }) {
  const transitions: Record<string, string[]> = {
    PLANNED: ["EXTRACTION"], EXTRACTION: ["PCR", "FAILED"],
    PCR: ["HYBRIDIZATION", "FAILED"], HYBRIDIZATION: ["RESULT_ENTRY", "FAILED"],
    RESULT_ENTRY: ["IN_REVIEW"], IN_REVIEW: ["REVIEWED", "RESULT_ENTRY"],
    REVIEWED: ["COMPLETED"],
  };
  const allowed = transitions[batch.status];
  if (!allowed || allowed.length === 0) return null;

  const advance = async (target: string) => {
    try {
      await api.post(`/hpv/batches/${batch.id}/advance_status/`, { target_status: target });
      message.success(`状态更新: ${STATUS_LABEL[target] || target}`);
      onDone();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "状态更新失败");
    }
  };

  const menuItems = allowed.map(t => ({ key: t, label: STATUS_LABEL[t] || t, onClick: () => advance(t) }));

  return (
    <Dropdown menu={{ items: menuItems }}>
      <Button icon={<SyncOutlined />}>推进状态</Button>
    </Dropdown>
  );
}
