import { useState, useEffect } from "react";
import dayjs from "dayjs";
import {
  Card, Table, Tag, Typography, Button, Input, Select, Space,
  Progress, Drawer, message, Badge, Popconfirm, DatePicker, Collapse,
  Modal, Timeline, Tooltip,
} from "antd";
import {
  EyeOutlined, LinkOutlined, RedoOutlined,
  CloseCircleOutlined, DeleteOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import api from "../api/client";
import type { CaseDetail } from "../api/types";
import { REJECTION_REASONS, SAMPLE_STATUS_DISPLAY } from "../api/types";

const { Text, Title } = Typography;

const STATUS_COLORS: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "blue", RECEIVED: "blue",
  PRE_PROCESSING: "orange", EXTRACTION: "gold", LIBRARY_PREP: "purple",
  POOLING: "magenta", HYB_SEQ: "cyan", BIOINFO: "geekblue",
  REPORT_DRAFT: "lime", IN_PROCESS: "orange", COMPLETED: "green",
  REPORTED: "cyan", REJECTED: "red", HAS_FAILURE: "red",
};
const STATUS_DISPLAY: Record<string, string> = {
  REGISTERED: "已登记", RECEIVING: "接收中", RECEIVED: "已签收",
  PRE_PROCESSING: "前处理", EXTRACTION: "提取中", LIBRARY_PREP: "建库中",
  POOLING: "Pooling", HYB_SEQ: "测序中", BIOINFO: "生信中",
  REPORT_DRAFT: "报告草稿", IN_PROCESS: "处理中", COMPLETED: "已完成",
  REPORTED: "已报告", HAS_FAILURE: "有失败", REJECTED: "已拒收",
};

const fmtDate = (v: string | null | undefined) => {
  if (!v) return "-";
  return v.slice(0, 10);
};
const fmtDT = (v: string | null | undefined) => {
  if (!v) return "-";
  return `${v.slice(5, 10)} ${v.slice(11, 16)}`;  // MM-DD HH:mm
};
const rejectionLabel = (reason: string) =>
  reason === "REJECTED" ? "拒收" : (REJECTION_REASONS[reason || ""] || reason || "");

(casesApi as any).redo = (caseId: string, data: any) => api.post(`/cases/${caseId}/redo/`, data);
(casesApi as any).sampleHistory = (caseId: string) => api.get(`/cases/${caseId}/sample_history/`);

export default function Cases() {
    const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[any, any] | null>(null);
  const [dateType, setDateType] = useState<string>("created");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoTarget, setRedoTarget] = useState<any>(null);
  const [sampleHistory, setSampleHistory] = useState<any>({});
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());

  const loadData = async (p: number = page) => {
    setLoading(true);
    try {
      const params: any = { page: p, page_size: pageSize };
      if (search) params.search = search;
      if (statusFilter) {
        if (statusFilter === "has_resample") params.has_resample = "true";
        else params.workflow_status = statusFilter;
      }
      if (sourceFilter) params.applicant = sourceFilter;
      if (dateRange && dateRange[0]) {
        const k1 = dateType === "received" ? "received_after" : "created_after";
        params[k1] = dayjs(dateRange[0]).format("YYYY-MM-DD");
      }
      if (dateRange && dateRange[1]) {
        const k2 = dateType === "received" ? "received_before" : "created_before";
        params[k2] = dayjs(dateRange[1]).format("YYYY-MM-DD");
      }
      const r = await casesApi.list(params);
      setData(r.data?.results || []);
      setTotal(r.data?.count || 0);
    } catch { message.error("加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(page); }, [search, statusFilter, sourceFilter, dateRange, dateType, page, pageSize]);

  const doRedo = async () => {
    if (!redoTarget) return;
    try {
      await (casesApi as any).redo(redoTarget.caseId, {
        original_case_sample_id: redoTarget.csId,
        target_stage: redoTarget.targetStage,
        sample_source: redoTarget.sampleSource,
      });
      message.success("重做已创建");
      setRedoOpen(false);
      if (selectedCase) { const r = await casesApi.get(selectedCase.id); setSelectedCase(r.data); }
    } catch (e: any) { message.error(e?.response?.data?.detail || "重做失败"); }
  };

  const toggleHistory = async (csId: string) => {
    const next = new Set(historyOpen);
    if (next.has(csId)) { next.delete(csId); }
    else {
      next.add(csId);
      if (!sampleHistory[csId] && selectedCase) {
        try {
          const r = await (casesApi as any).sampleHistory(selectedCase.id);
          setSampleHistory((prev: any) => ({ ...prev, ...r.data }));
        } catch {}
      }
    }
    setHistoryOpen(next);
  };

  const openDetail = async (id: string) => {
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const r = await casesApi.get(id);
      setSelectedCase(r.data);
    } catch { message.error("加载失败"); }
    finally { setDrawerLoading(false); }
  };

  const handleDeleteCase = async (id: string) => {
    try {
      await (casesApi as any).deleteCase(id);
      message.success("Case deleted");
      loadData();
    } catch (e: any) {
      message.error(String(e?.response?.data?.detail || "Delete failed"));
    }
  };

  const doResample = async (caseId: string, csId: string) => {
    try {
      await casesApi.resample(caseId, { case_sample_id: csId });
      message.success("已创建重采样本");
      const r = await casesApi.get(caseId);
      setSelectedCase(r.data);
    } catch { message.error("重采失败"); }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/register/${token}`;
    navigator.clipboard.writeText(url).then(() => message.success("链接已复制"));
  };

  const generateLink = async (caseId: string) => {
    try {
      await casesApi.generateToken(caseId);
      const r = await casesApi.get(caseId);
      setSelectedCase(r.data);
      message.success("已生成注册链接");
    } catch { message.error("生成失败"); }
  };

  const columns = [
    {
      title: "Case 编号", dataIndex: "case_number", width: 170,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: "PT 编号", dataIndex: "pt_number", width: 100,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : "-",
    },
    {
      title: "母亲", dataIndex: "mother_name", width: 180, ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ cursor: "default" }}>{v}</span></Tooltip>
        : "-",
    },
    {
      title: "样本", width: 80, align: "center" as const,
      render: (_: any, r: any) => (
        <Text><Text type="success" strong>{r.received_count}</Text>/{r.sample_count}</Text>
      ),
    },
    {
      title: "外部编号", width: 140, responsive: ["md" as const], ellipsis: true,
        render: (_: any, r: any) => {
          const cs = r.case_samples?.find((s: any) => s.role === "MOTHER") || r.case_samples?.[0];
          return cs?.external_id
            ? <Tooltip title={cs.external_id}><span style={{ fontSize: 12, cursor: "default" }}>{cs.external_id}</span></Tooltip>
            : <Text type="secondary">-</Text>;
        },
      },
      { title: "来源", dataIndex: "case_source", width: 110, responsive: ["md" as const],
      render: (v: string) => v || "-",
    },
    {
      title: "销售/代理", width: 100, responsive: ["md" as const],
      render: (_: any, r: any) =>
        r.sales_person ? <Text style={{ fontSize: 12 }}>{r.sales_person}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: "状态", dataIndex: "status", width: 100,
      render: (_v: string, r: any) => {
        const display = r.status_display || _v;
        const color = STATUS_COLORS[r.status] || STATUS_COLORS[_v] || "default";
        return <Tag color={color}>{display}</Tag>;
      },
    },
    {
      title: "备注", key: "evts", width: 180,
      render: (_: any, r: any) => {
        const evts: { label: string; color: string; tip: string }[] = [];
        if (r.notes) {
          evts.push({ label: "登记备注", color: "purple", tip: r.notes });
        }
        for (const cs of r.case_samples || []) {
          const who = cs.patient_name ? `${cs.patient_name} · ` : "";
          if (cs.sample_status === "REJECTED") {
            const reason = rejectionLabel(cs.rejection_reason);
            const note = cs.rejection_note ? `: ${cs.rejection_note}` : "";
            evts.push({ label: "拒收", color: "red", tip: `${reason}${note} · ${who}${fmtDT(cs.received_at)}` });
          }
          if (cs.resample_of) {
            evts.push({ label: `重采R${cs.resample_number || ""}`, color: "orange", tip: `重采样本 · ${who}${fmtDT(cs.created_at)}` });
          }
          if (cs.redo_count) {
            evts.push({ label: `重做T${cs.redo_count}`, color: "cyan", tip: `重做样本 · ${who}${fmtDT(cs.created_at)}` });
          }
          if (cs.collection_notes) {
            evts.push({ label: "备注", color: "gold", tip: cs.collection_notes });
          }
        }
        if (!evts.length) return <Text type="secondary">-</Text>;
        return (
          <Space size={2} wrap>
            {evts.map((e, i) => (
              <Tooltip key={i} title={e.tip}>
                <Tag color={e.color} style={{ fontSize: 11, margin: 0 }}>{e.label}</Tag>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: "加急", dataIndex: "is_urgent", width: 60, align: "center" as const,
      render: (v: boolean) => v ? <Tag color="red">加急</Tag> : null,
    },
    {
      title: "进度", dataIndex: "progress", width: 140, responsive: ["lg" as const],
      render: (v: number) => <Progress percent={v || 0} size="small" />,
    },
    {
      title: "签收时间", width: 100, responsive: ["lg" as const],
        render: (_: any, r: any) => {
          const cs = r.case_samples?.find((s: any) => s.received_at);
          if (cs?.received_at) return dayjs(cs.received_at).format("MM-DD HH:mm");
          return <Text type="secondary">-</Text>;
        },
      },
      { title: "创建时间", dataIndex: "created_at", width: 100, responsive: ["lg" as const],
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: "操作", width: 120, align: "center" as const, fixed: "right" as const,
      render: (_: any, r: any) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          <Popconfirm
            title="Delete this case?"
            description="All associated samples will also be deleted."
            onConfirm={() => handleDeleteCase(r.id)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Title level={4}><EyeOutlined style={{ marginRight: 8, color: "#1677ff" }} />案例管理</Title>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="Case / PT / 姓名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => { setSearch(value); setPage(1); }}
          style={{ width: 240 }}
        />
        <Select
          placeholder="全部来源"
          value={sourceFilter || undefined}
          onChange={(v) => { setSourceFilter(v || ""); setPage(1); }}
          style={{ width: 110 }}
          allowClear
        >
          <Select.Option value="国内">国内</Select.Option>
          <Select.Option value="泰国">泰国</Select.Option>
          <Select.Option value="巴西">巴西</Select.Option>
          <Select.Option value="巴西万基">巴西万基</Select.Option>
          <Select.Option value="韩国">韩国</Select.Option>
          <Select.Option value="澳洲">澳洲</Select.Option>
          <Select.Option value="CYJ印度">CYJ印度</Select.Option>
          <Select.Option value="CYJ澳洲">CYJ澳洲</Select.Option>
          <Select.Option value="CYJ秘鲁">CYJ秘鲁</Select.Option>
          <Select.Option value="CYJ美国">CYJ美国</Select.Option>
          <Select.Option value="澳洲经销商">澳洲经销商</Select.Option>
          <Select.Option value="西班牙代理">西班牙代理</Select.Option>
          <Select.Option value="西班牙巴塞罗那经销商">西班牙巴塞罗那经销商</Select.Option>
          <Select.Option value="YLH西班牙bygens">YLH西班牙bygens</Select.Option>
          <Select.Option value="YLH西班牙LABGENETICS">YLH西班牙LABGENETICS</Select.Option>
        </Select>
        <Select
          placeholder="全部状态"
          value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ""); setPage(1); }}
          style={{ width: 110 }}
          allowClear
        >
          <Select.Option value="REGISTERED">已登记</Select.Option>
          <Select.Option value="RECEIVED">已签收</Select.Option>
          <Select.Option value="PRE_PROCESSING">前处理</Select.Option>
          <Select.Option value="EXTRACTION">提取中</Select.Option>
          <Select.Option value="LIBRARY_PREP">建库中</Select.Option>
          <Select.Option value="POOLING">Pooling</Select.Option>
          <Select.Option value="HYB_SEQ">测序中</Select.Option>
          <Select.Option value="BIOINFO">生信中</Select.Option>
          <Select.Option value="REPORT_DRAFT">报告草稿</Select.Option>
          <Select.Option value="COMPLETED">已完成</Select.Option>
          <Select.Option value="REPORTED">已报告</Select.Option>
          <Select.Option value="REJECTED">已拒收</Select.Option>
          <Select.Option value="HAS_FAILURE">有失败</Select.Option>
          <Select.Option value="CANCELLED">已取消</Select.Option>
          <Select.Option value="has_resample">有重采</Select.Option>
        </Select>
        <Select
          value={dateType}
          onChange={(v) => { setDateType(v); setDateRange(null); setPage(1); }}
          style={{ width: 100 }}
          size="middle"
        >
          <Select.Option value="created">创建时间</Select.Option>
          <Select.Option value="received">签收时间</Select.Option>
        </Select>
        <DatePicker.RangePicker
          placeholder={["开始日期", "结束日期"]}
          value={dateRange as any}
          onChange={(v) => { setDateRange(v as any); setPage(1); }}
          style={{ width: 240 }}
          allowEmpty={[true, true]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1680, y: "calc(100vh - 280px)" }}
        pagination={{
          current: page, total, pageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (p: number, ps?: number) => {
            if (ps && ps !== pageSize) {
              setPage(1);
              setPageSize(ps);
            } else {
              setPage(p);
            }
          },
          showTotal: (t) => `共 ${t} 个案例`,
        }}
      />

      {/* Detail Drawer */}
      <Drawer
        title={selectedCase ? (
          <Space>
            <Text strong code>{selectedCase.case_number}</Text>
            {selectedCase.pt_number && <Tag color="blue">{selectedCase.pt_number}</Tag>}
            <Tag color={STATUS_COLORS[selectedCase.status]}>{STATUS_DISPLAY[selectedCase.status] || selectedCase.status}</Tag>
            {selectedCase.is_urgent && <Tag color="red">加急</Tag>}
          </Space>
        ) : "案例详情"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={800}
        loading={drawerLoading}
      >
        {selectedCase && (
          <>
            <Progress percent={selectedCase.progress || 0} style={{ marginBottom: 16 }} />

            <Collapse defaultActiveKey={["basic", "samples"]} size="small" style={{ marginBottom: 12 }}>
              <Collapse.Panel key="basic" header="基本信息">
                <Space direction="vertical" size={2}>
                  <Text><Text type="secondary">母亲:</Text> {(selectedCase as any).mother_name || "-"}</Text>
                  <Text><Text type="secondary">Panel:</Text> {selectedCase.panel_name || selectedCase.panel_code}</Text>
                  <Text><Text type="secondary">孕周:</Text> {selectedCase.gestational_age_weeks ?? "-"}周{selectedCase.gestational_age_days ?? ""}天</Text>
                  <Text><Text type="secondary">诊所:</Text> {selectedCase.clinic_name || "-"}</Text>
                  <Text><Text type="secondary">销售:</Text> {selectedCase.sales_person || "-"}</Text>
                  <Text><Text type="secondary">联系方式:</Text> {selectedCase.clinic_contact || "-"}</Text>
                  <Text><Text type="secondary">来源:</Text> {(selectedCase as any).case_source || "-"}</Text>
                  <Text><Text type="secondary">申请方:</Text> {(selectedCase as any).applicant || "-"}</Text>
                  <Text><Text type="secondary">登记类型:</Text> {(selectedCase as any).registration_type || "首次"}</Text>
                  <Text><Text type="secondary">创建时间:</Text> {fmtDate(selectedCase.created_at)}</Text>
                  {selectedCase.expected_completion && (
                    <Text><Text type="secondary">预计完成:</Text> {selectedCase.expected_completion}</Text>
                  )}
                  {selectedCase.notes && (
                    <Text><Text type="secondary">备注:</Text> {selectedCase.notes}</Text>
                  )}
                </Space>
              </Collapse.Panel>
              <Collapse.Panel key="samples" header={`样本列表 (${selectedCase.case_samples?.length || 0})`}>

            <div style={{ marginBottom: 12 }}>
              {selectedCase.registration_token ? (
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(selectedCase.registration_token!)}>
                  复制注册链接
                </Button>
              ) : (
                <Button size="small" icon={<LinkOutlined />} onClick={() => generateLink(selectedCase.id)}>
                  生成注册链接
                </Button>
              )}
            </div>

            {selectedCase.case_samples.map((cs: any) => (
              <Card key={cs.id} size="small" style={{ marginBottom: 8 }}
                bodyStyle={{
                  background: cs.sample_status === "REJECTED" ? "#fff2f0" : "#fafafa",
                  borderLeft: `3px solid ${cs.workflow_stage === "REJECTED" ? "#ff4d4f" : "#d9d9d9"}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Space>
                    <Text code style={{ color: "#1677ff" }}>{cs.test_sample_id || cs.sample_id}</Text>
                    <Tag color={cs.role === "MOTHER" ? "pink" : "blue"}>{cs.role === "MOTHER" ? "母亲" : "疑父"}</Tag>
                    {(() => {
                      const st = cs.workflow_stage;
                      if (!st || st === "REGISTERED") return null;
                      const mp: Record<string, [string, string]> = {
                        RECEIVED: ["签收", "blue"], REJECTED: ["拒收", "red"],
                        PRE_PROCESSING: ["前处理", "orange"], EXTRACTION: ["提取", "gold"],
                        LIBRARY_PREP: ["建库", "purple"], POOLING: ["Pooling", "magenta"],
                        HYB_SEQ: ["测序", "cyan"], BIOINFO: ["生信", "geekblue"],
                        REPORT_DRAFT: ["报告", "lime"], COMPLETED: ["完成", "green"],
                      };
                      const [l, c] = mp[st] || [st, "default"];
                      return <Tag color={c} style={{fontSize:11}}>{l}</Tag>;
                    })()}
                    {cs.resample_of && <Badge count={`R${cs.resample_number}`} color="orange" />}
                    {cs.redo_count && <Badge count={`T${cs.redo_count}`} color="cyan" />}
                    {(cs.workflow_stage || "").endsWith("_FAILED") && (
                      <Button size="small" danger onClick={() => {
                        setRedoTarget({
                          caseId: selectedCase!.id, csId: cs.id,
                          testSampleId: cs.test_sample_id || cs.sample_id,
                          patientName: cs.patient_name,
                          failedStage: cs.workflow_stage,
                          targetStage: "", sampleSource: "BLOOD"
                        });
                        setRedoOpen(true);
                      }}>重做</Button>
                    )}
                  </Space>
                  <Tag color={STATUS_COLORS[cs.sample_status]}>
                    {SAMPLE_STATUS_DISPLAY[cs.sample_status] || cs.sample_status}
                  </Tag>
                </div>

                <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
                  {[..."REGISTERED,RECEIVED,PRE_PROCESSING,EXTRACTION,LIBRARY_PREP,POOLING,HYB_SEQ,BIOINFO,REPORT_DRAFT,COMPLETED".split(",")].map((s: string, i: number) => {
                    const workflowOrder = "REGISTERED,RECEIVED,PRE_PROCESSING,EXTRACTION,LIBRARY_PREP,POOLING,HYB_SEQ,BIOINFO,REPORT_DRAFT,COMPLETED".split(",");
                    const idx = workflowOrder.indexOf(cs.workflow_stage || "REGISTERED");
                    const isActive = i <= idx;
                    const colorMap: Record<string, string> = {
                      REGISTERED: "#d9d9d9", RECEIVED: "#1677ff", PRE_PROCESSING: "#faad14",
                      EXTRACTION: "#faad14", LIBRARY_PREP: "#722ed1", POOLING: "#722ed1",
                      HYB_SEQ: "#2f54eb", BIOINFO: "#2f54eb", REPORT_DRAFT: "#52c41a",
                      COMPLETED: "#52c41a",
                    };
                    return (
                      <div key={s} style={{
                        flex: 1, height: 6, borderRadius: 3,
                        background: cs.sample_status === "REJECTED" ? "#ff4d4f"
                          : isActive ? colorMap[s] : "#f0f0f0",
                      }} title={SAMPLE_STATUS_DISPLAY[s]} />
                    );
                  })}
                </div>

                <Space size={8}>
                  <Tooltip title={cs.patient_name || cs.sample_id}>
                    <Text style={{
                      fontSize: 12, display: "inline-block", maxWidth: 240,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      verticalAlign: "bottom",
                    }}>{cs.patient_name || cs.sample_id}</Text>
                  </Tooltip>
                  <Text type="secondary" style={{ fontSize: 11 }}>{cs.source_display || cs.sample_source}</Text>
                  {cs.received_at && <Text type="secondary" style={{ fontSize: 11 }}>接收: {fmtDate(cs.received_at)}</Text>}
                  {cs.collection_notes && <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>备注: {cs.collection_notes}</Tag>}
                  <Button size="small" type="link" onClick={() => toggleHistory(cs.id)}>
                    {historyOpen.has(cs.id) ? "收起历史" : "实验历史"}
                  </Button>
                </Space>
                {historyOpen.has(cs.id) && sampleHistory[cs.id] && (
                  <Timeline style={{ marginTop: 8 }} items={
                    sampleHistory[cs.id].stages.map((s: any) => {
                      if (s.stage === "RECEIVED") {
                        return {
                          color: s.condition === "OK" ? "green" : "red",
                          children: <div style={{ fontSize: 12 }}>
                            <Space size={4}>
                              {s.pt_number && <Tag color="blue" style={{ fontSize: 11 }}>{s.pt_number}</Tag>}
                              <Text strong>签收</Text>
                              <Tag color={s.condition === "OK" ? "green" : "red"} style={{ fontSize: 11 }}>
                                {s.condition === "OK" ? "通过" : s.condition}
                              </Tag>
                            </Space>
                            <br />
                            <Text type="secondary">时间: {s.timestamp?.slice(0, 19)}</Text>
                            {s.received_by && <Text type="secondary"> | 签收人: {s.received_by}</Text>}
                            {s.receipt_photo_url && (
                              <div style={{ marginTop: 4 }}>
                                <img
                                  src={s.receipt_photo_url}
                                  alt="签收照片"
                                  style={{ maxWidth: 120, maxHeight: 80, cursor: "pointer", borderRadius: 4 }}
                                  onClick={() => window.open(s.receipt_photo_url, "_blank")}
                                />
                              </div>
                            )}
                          </div>
                        };
                      }
                      return {
                        color: s.action === "COMPLETE" ? "green" : s.action === "FAIL" ? "red" : "blue",
                        children: <span style={{ fontSize: 12 }}>
                          <Text strong>{s.stage}</Text> — {s.action}
                          {s.batch_number && <Text type="secondary"> ({s.batch_number})</Text>}
                          <br /><Text type="secondary" style={{ fontSize: 11 }}>{s.timestamp?.slice(0, 19)}</Text>
                        </span>
                      };
                    })
                  } />
                )}

                {cs.sample_status === "REJECTED" && (
                  <div style={{ marginTop: 6, padding: "4px 8px", background: "#fff2f0", borderRadius: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Text type="danger" style={{ fontSize: 11 }}>
                      <CloseCircleOutlined /> {REJECTION_REASONS[cs.rejection_reason || ""] || cs.rejection_reason}
                      {cs.rejection_note && `: ${cs.rejection_note}`}
                    </Text>
                    <Button size="small" danger onClick={() => doResample(selectedCase.id, cs.id)}>
                      <RedoOutlined /> 重采
                    </Button>
                  </div>
                )}
              </Card>
            ))}
              </Collapse.Panel>
            </Collapse>
          </>
        )}
      </Drawer>

      {/* Redo Modal */}
      <Modal title="重做样本" open={redoOpen} onCancel={() => setRedoOpen(false)} onOk={doRedo} okText="确认重做">
        {redoTarget && (
          <>
            <p>原样本: {redoTarget.testSampleId} ({redoTarget.patientName})</p>
            <p>失败环节: {redoTarget.failedStage}</p>
            <p>目标环节:{" "}
              <Select value={redoTarget.targetStage || undefined} style={{width:200}}
                onChange={(v) => setRedoTarget({...redoTarget, targetStage: v})}
                options={[
                  {label:"EXTRACTION 核酸提取",value:"EXTRACTION"},
                  {label:"LIBRARY_PREP 文库构建",value:"LIBRARY_PREP"},
                  {label:"POOLING 定量Pooling",value:"POOLING"},
                  {label:"HYB_SEQ 杂交测序",value:"HYB_SEQ"},
                  {label:"BIOINFO 生物信息",value:"BIOINFO"},
                ]} />
            </p>
            <p>样本类型:{" "}
              <Select value={redoTarget.sampleSource} style={{width:200}}
                onChange={(v) => setRedoTarget({...redoTarget, sampleSource: v})}
                options={[
                  {label:"血液 BLOOD",value:"BLOOD"},
                  {label:"毛发 HAIR",value:"HAIR"},
                  {label:"口拭子 SWAB",value:"SWAB"},
                  {label:"血痕 DBS",value:"DBS"},
                  {label:"指甲 NAIL",value:"NAIL"},
                  {label:"精液 SEMEN",value:"SEMEN"},
                  {label:"胡须 BEARD",value:"BEARD"},
                  {label:"牙线 FLOSS",value:"FLOSS"},
                  {label:"精斑 SEMSTAIN",value:"SEMSTAIN"},
                  {label:"口香糖 GUM",value:"GUM"},
                ]} />
            </p>
            <p>新PT编号预览: <Text code>{redoTarget.testSampleId?.replace(/_?R\d+/, "")}_T{Math.max(1, ((selectedCase?.case_samples || []).filter((c:any) => c.redo_of === redoTarget.csId).length) + 1)}</Text></p>
          </>
        )}
      </Modal>
    </div>
  );
}
