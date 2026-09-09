import { useState, useEffect, useCallback } from "react";
import { Card, Row, Col, Statistic, Typography, Table, Tag, Select, DatePicker, Radio, Empty, Button, Space } from "antd";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  REGISTERED: "default", RECEIVED: "blue", PRE_PROCESSING: "orange",
  EXTRACTION: "gold", LIBRARY_PREP: "purple", POOLING: "magenta",
  HYB_SEQ: "cyan", BIOINFO: "geekblue", REPORT_DRAFT: "lime",
  COMPLETED: "green", REJECTED: "red", HAS_FAILURE: "red",
};
const STATUS_DISPLAY: Record<string, string> = {
  REGISTERED: "已登记", RECEIVED: "已签收", PRE_PROCESSING: "前处理",
  EXTRACTION: "提取中", LIBRARY_PREP: "建库中", POOLING: "Pooling",
  HYB_SEQ: "测序中", BIOINFO: "生信中", REPORT_DRAFT: "报告草稿",
  COMPLETED: "已完成", REJECTED: "已拒收", HAS_FAILURE: "有失败",
};

const STATUS_KEYS = ["REGISTERED","RECEIVED","PRE_PROCESSING","EXTRACTION","LIBRARY_PREP","POOLING","HYB_SEQ","BIOINFO","REPORT_DRAFT","COMPLETED"];
const STAGE_META: Record<string, [string, string]> = {
  REGISTERED: ["登记", "default"], RECEIVED: ["签收", "blue"], REJECTED: ["拒收", "red"],
  PRE_PROCESSING: ["前处理", "orange"], EXTRACTION: ["提取", "gold"], LIBRARY_PREP: ["建库", "purple"],
  POOLING: ["Pooling", "magenta"], HYB_SEQ: ["测序", "cyan"], BIOINFO: ["生信", "geekblue"],
  REPORT_DRAFT: ["报告", "lime"], COMPLETED: ["完成", "green"],
};

const DIM_OPTIONS = [
  { value: "gestational_age", label: "孕周" },
  { value: "sales_person", label: "销售Case量" },
  { value: "case_source", label: "来源分布" },
  { value: "multiple_gestation", label: "单双胎" },
  { value: "status", label: "状态分布" },
];
const BAR_COLORS = ["#1677ff", "#69b1ff", "#91caff", "#ffc53d", "#ffa940", "#ff7a45", "#f759ab", "#9254de", "#5cdbd3", "#a0d911"];
const MAX_BARS = 10;

export default function NipptDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [activeView, setActiveView] = useState<string>("");   // stage key | "urgent" | "deadline" | "stats"
  const [detailRows, setDetailRows] = useState<any[]>([]);

  // stats 筛选状态
  const [timeType, setTimeType] = useState<string>("created");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [dimension, setDimension] = useState<string>("gestational_age");
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);

  useEffect(() => {
    casesApi.dashboard().then((res: any) => {
      const d = res.data;
      d.workflow_stages = d.workflow_stages || {};
      d.urgent_detail = d.urgent_detail || [];
      d.deadline_detail = d.deadline_detail || [];
      setData(d);
    });
  }, []);

  const fetchStats = useCallback(async (dim: string, tt: string, s: string, e: string) => {
    setStatsLoading(true);
    try {
      const params: any = { dimension: dim, time_type: tt };
      if (s) params.start = s;
      if (e) params.end = e;
      const res = await (casesApi as any).stats(params);
      setStats(res.data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (statsVisible) fetchStats(dimension, timeType, start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsVisible, dimension, timeType, start, end]);

  const handleStageClick = (stageKey: string) => {
    if (activeView === stageKey) { setActiveView(""); setDetailRows([]); return; }
    setActiveView(stageKey);
    const samples = data?.stage_detail?.[stageKey] || [];
    setDetailRows(samples.map((s: any, i: number) => ({ ...s, key: s.case_id + "_" + i })));
  };

  const handleTopClick = (kind: string) => {
    if (activeView === kind) { setActiveView(""); setDetailRows([]); return; }
    setActiveView(kind);
    const src = kind === "urgent" ? data?.urgent_detail : data?.deadline_detail;
    setDetailRows((src || []).map((s: any, i: number) => ({ ...s, key: s.case_id + "_" + i })));
  };

  const stageColumns = [
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 160 },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 80 },
    { title: "PT ID", dataIndex: "test_sample_id", key: "tid", width: 100 },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 90 },
    { title: "样本类型", dataIndex: "sample_source", key: "st", width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: "更新时间", dataIndex: "updated_at", key: "dt", width: 110 },
  ];
  const topColumns = [
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 160 },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 90 },
    { title: "母亲", dataIndex: "mother_name", key: "mn", width: 90, render: (v: string) => v || "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 90,
      render: (v: string) => <Tag color={STATUS_COLORS[v] || "default"}>{STATUS_DISPLAY[v] || v}</Tag> },
    { title: "登记日期", dataIndex: "created_at", key: "ct", width: 110,
      render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    { title: "截止日期", dataIndex: "expected_completion", key: "ec", width: 110,
      render: (v: string) => v ? v.slice(0, 10) : "-" },
  ];

  const activeTitle = activeView === "urgent" ? "紧急 Case"
    : activeView === "deadline" ? "即将到期 Case"
    : (STAGE_META[activeView]?.[0] || "") ;

  // stats bar chart
  const maxCount = stats?.buckets?.length ? Math.max(...stats.buckets.map((b: any) => b.count)) : 0;

  return (
    <div style={{ padding: 24 }}>
      <Title level={4}>NIPPT Dashboard</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: "#f0f5ff" }}>
            <Statistic title="总案例" value={data?.total_cases ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: "#f6ffed" }}>
            <Statistic title="总实验样本" value={data?.total_samples ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card
            size="small" hoverable
            style={{ background: "#fff2f0", border: activeView === "urgent" ? "2px solid #cf1322" : undefined }}
            onClick={() => handleTopClick("urgent")}
          >
            <Statistic title="紧急" value={data?.urgent ?? 0} valueStyle={{ color: "#cf1322" }} />
            <Text type="secondary" style={{ fontSize: 10 }}>点击查看明细</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card
            size="small" hoverable
            style={{ background: "#fffbe6", border: activeView === "deadline" ? "2px solid #d48806" : undefined }}
            onClick={() => handleTopClick("deadline")}
          >
            <Statistic title="即将到期" value={data?.near_deadline ?? 0} valueStyle={{ color: "#d48806" }} />
            <Text type="secondary" style={{ fontSize: 10 }}>点击查看明细</Text>
          </Card>
        </Col>
      </Row>
      <Card title="样本流水线状态" size="small">
        <Row gutter={[8, 8]}>
          {STATUS_KEYS.map((k) => {
            const [l, c] = STAGE_META[k];
            const count = data?.workflow_stages?.[k.toLowerCase()] ?? 0;
            const isActive = activeView === k;
            return (
              <Col key={k} xs={6} sm={4} md={3} lg={2}>
                <div onClick={() => handleStageClick(k)} style={{ cursor: "pointer" }}>
                  <Card
                    size="small"
                    hoverable
                    style={{
                      textAlign: "center",
                      background: isActive ? "#e6f7ff" : count > 0 ? "#f0f5ff" : "#fafafa",
                      border: isActive ? "2px solid #1677ff" : undefined,
                    }}
                  >
                    <Statistic title={l} value={count} valueStyle={{ fontSize: 18, color: count > 0 ? c : "#ccc" }} />
                  </Card>
                </div>
              </Col>
            );
          })}
        </Row>
        {activeView && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ marginBottom: 8, display: "block" }}>
              {activeTitle} ({detailRows.length})
            </Text>
            <Table
              columns={activeView === "urgent" || activeView === "deadline" ? topColumns : stageColumns}
              dataSource={detailRows}
              size="small"
              pagination={{ pageSize: 10, showTotal: (t: number) => `共 ${t} 条` }}
            />
          </div>
        )}
      </Card>

      {/* 统计分析 */}
      <Card
        size="small"
        title="统计分析"
        style={{ marginTop: 16 }}
        extra={
          <Space size={4}>
            <Radio.Group
              size="small" value={timeType}
              onChange={(e) => { setTimeType(e.target.value); setStart(""); setEnd(""); }}
              options={[
                { label: "登记时间", value: "created" },
                { label: "签收时间", value: "received" },
              ]}
              optionType="button"
            />
            <DatePicker
              size="small" placeholder="开始"
              value={start ? dayjs(start) : null}
              onChange={(v) => setStart(v ? v.format("YYYY-MM-DD") : "")}
              allowClear
            />
            <DatePicker
              size="small" placeholder="结束"
              value={end ? dayjs(end) : null}
              onChange={(v) => setEnd(v ? v.format("YYYY-MM-DD") : "")}
              allowClear
            />
            <Select
              size="small" style={{ width: 130 }}
              value={dimension}
              onChange={setDimension}
              options={DIM_OPTIONS}
            />
            <Button size="small" type="primary" onClick={() => setStatsVisible(true)}>查询</Button>
          </Space>
        }
      >
        {!statsVisible ? (
          <Empty description="选择时间范围与维度后点击「查询」开始统计" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : statsLoading ? (
          <Text type="secondary">统计中…</Text>
        ) : (
          <>
            <Text type="secondary" style={{ marginBottom: 8, display: "block", fontSize: 12 }}>
              筛选后共 {stats?.total ?? 0} 个 Case
            </Text>
            {stats && stats.buckets?.length ? (
            <div>
              {stats.buckets.slice(0, MAX_BARS).map((b: any, i: number) => (
                <div key={b.label + i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ width: 90, fontSize: 12, textAlign: "right" }}>{b.label}</Text>
                  <div style={{ flex: 1, background: "#f5f5f5", borderRadius: 3, height: 16, overflow: "hidden" }}>
                    <div style={{
                      width: maxCount ? `${Math.round((b.count / maxCount) * 100)}%` : 0,
                      background: b.label === "未填写" ? "#bfbfbf" : (BAR_COLORS[i % BAR_COLORS.length]),
                      height: "100%", borderRadius: 3,
                    }} />
                  </div>
                  <Text strong style={{ width: 36, fontSize: 12 }}>{b.count}</Text>
                </div>
              ))}
              {stats.buckets.length > MAX_BARS && (
                <Text type="secondary" style={{ fontSize: 11 }}>… 其余 {stats.buckets.length - MAX_BARS} 项未显示</Text>
              )}
            </div>
            ) : (
              <Empty description="该条件下暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
