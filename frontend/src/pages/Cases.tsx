import { useState, useEffect } from "react";
import dayjs from "dayjs";
import {
  Card, Table, Tag, Typography, Button, Input, Select, Space,
  Progress, Drawer, message, Badge, Popconfirm, DatePicker,
} from "antd";
import {
  EyeOutlined, LinkOutlined, RedoOutlined,
  CloseCircleOutlined, DeleteOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import type { CaseDetail } from "../api/types";
import { REJECTION_REASONS, SAMPLE_STATUS_DISPLAY } from "../api/types";

const { Text, Title } = Typography;

const STATUS_COLORS: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "blue", RECEIVED: "blue",
  PRE_PROCESSING: "orange", EXTRACTION: "gold", LIBRARY_PREP: "purple",
  POOLING: "magenta", HYB_SEQ: "cyan", BIOINFO: "geekblue",
  REPORT_DRAFT: "lime", IN_PROCESS: "orange", COMPLETED: "green",
  REPORTED: "cyan", REJECTED: "red",
};
const STATUS_DISPLAY: Record<string, string> = {
  REGISTERED: "已登记", RECEIVING: "接收中", RECEIVED: "已签收",
  PRE_PROCESSING: "前处理", EXTRACTION: "提取中", LIBRARY_PREP: "建库中",
  POOLING: "Pooling", HYB_SEQ: "测序中", BIOINFO: "生信中",
  REPORT_DRAFT: "报告草稿", IN_PROCESS: "处理中", COMPLETED: "已完成",
  REPORTED: "已报告",
};

const fmtDate = (v: string | null | undefined) => {
  if (!v) return "-";
  return v.slice(0, 10);
};

export default function Cases() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[any, any] | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const loadData = async (p: number = page) => {
    setLoading(true);
    try {
      const params: any = { page: p, page_size: 20 };
      if (search) params.search = search;
      if (statusFilter) params.workflow_status = statusFilter;
      if (sourceFilter) params.applicant = sourceFilter;
      if (dateRange && dateRange[0]) params.created_after = dayjs(dateRange[0]).format("YYYY-MM-DD");
      if (dateRange && dateRange[1]) params.created_before = dayjs(dateRange[1]).format("YYYY-MM-DD");
      const r = await casesApi.list(params);
      setData(r.data?.results || []);
      setTotal(r.data?.count || 0);
    } catch { message.error("加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(1); }, [search, statusFilter, sourceFilter, dateRange, page]);

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
      title: "Case 编号", dataIndex: "case_number", width: 180,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: "PT 编号", dataIndex: "pt_number", width: 100,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : "-",
    },
    {
      title: "母亲", dataIndex: "mother_name", width: 80,
      render: (v: string) => v || "-",
    },
    {
      title: "样本", width: 80, align: "center" as const,
      render: (_: any, r: any) => (
        <Text><Text type="success" strong>{r.received_count}</Text>/{r.sample_count}</Text>
      ),
    },
    {
      title: "来源", dataIndex: "case_source", width: 120, responsive: ["md" as const],
      render: (v: string) => v || "-",
    },
    {
      title: "状态", dataIndex: "workflow_status", width: 100,
      render: (v: string, r: any) => {
        const display = STATUS_DISPLAY[v] || STATUS_DISPLAY[r.status] || v || r.status;
        const color = STATUS_COLORS[v] || STATUS_COLORS[r.status] || "default";
        return <Tag color={color}>{display}</Tag>;
      },
    },
    {
      title: "加急", dataIndex: "is_urgent", width: 60, align: "center" as const,
      render: (v: boolean) => v ? <Tag color="red">加急</Tag> : null,
    },
    {
      title: "进度", dataIndex: "progress", width: 150, responsive: ["lg" as const],
      render: (v: number) => <Progress percent={v || 0} size="small" />,
    },
    {
      title: "创建时间", dataIndex: "created_at", width: 110, responsive: ["lg" as const],
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: "操作", width: 120, align: "center" as const,
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
    <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
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
        pagination={{
          current: page, total, pageSize: 20,
          onChange: (p) => setPage(p),
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
        width={520}
        loading={drawerLoading}
      >
        {selectedCase && (
          <>
            <Progress percent={selectedCase.progress || 0} style={{ marginBottom: 16 }} />

            <Card size="small" style={{ marginBottom: 12 }}>
              <Space direction="vertical" size={2}>
                <Text><Text type="secondary">母亲:</Text> {(selectedCase as any).mother_name || "-"}</Text>
                <Text><Text type="secondary">Panel:</Text> {selectedCase.panel_name || selectedCase.panel_code}</Text>
                <Text><Text type="secondary">孕周:</Text> {selectedCase.gestational_age_weeks ?? "-"}周{selectedCase.gestational_age_days ?? ""}天</Text>
                <Text><Text type="secondary">诊所:</Text> {selectedCase.clinic_name || "-"}</Text>
                <Text><Text type="secondary">销售:</Text> {selectedCase.sales_person || "-"}</Text>
                <Text><Text type="secondary">联系方式:</Text> {selectedCase.clinic_contact || "-"}</Text>
                <Text><Text type="secondary">创建时间:</Text> {fmtDate(selectedCase.created_at)}</Text>
                {selectedCase.expected_completion && (
                  <Text><Text type="secondary">预计完成:</Text> {selectedCase.expected_completion}</Text>
                )}
                {selectedCase.notes && (
                  <Text><Text type="secondary">备注:</Text> {selectedCase.notes}</Text>
                )}
              </Space>
            </Card>

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

            <Title level={5}>样本列表</Title>
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
                  <Text style={{ fontSize: 12 }}>{cs.patient_name || cs.sample_id}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{cs.source_display || cs.sample_source}</Text>
                  {cs.received_at && <Text type="secondary" style={{ fontSize: 11 }}>接收: {fmtDate(cs.received_at)}</Text>}
                </Space>

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
          </>
        )}
      </Drawer>
    </div>
  );
}
