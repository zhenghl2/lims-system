import { useState, useEffect } from "react";
import {
  Table, Card, Button, Space, Tag, Typography, Input,
  Modal, Form, Select, message, Tabs, Descriptions, Statistic, Row, Col,
  DatePicker, Alert, Empty, Spin, Popconfirm,
} from "antd";
import {
  PlusOutlined, EyeOutlined,
  AlertOutlined, LineChartOutlined, CheckCircleOutlined,
  CloseCircleOutlined, WarningOutlined, ReloadOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { qcApi } from "../api";
import type {
  QCControlMaterial, QCRun, QCChart, QCEvent,
} from "../api/types";
import { usePaginated } from "../hooks/useList";
import DashboardLayout from "../components/DashboardLayout";

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// ── Status/tag helpers ─────────────────────────────────────
const MATERIAL_TYPE_ICON: Record<string, string> = {
  POSITIVE: "🟢",
  NEGATIVE: "🔴",
  NTC: "⚪",
  REFERENCE: "📐",
};

const PASS_FAIL_COLORS: Record<string, string> = {
  PASS: "green",
  FAIL: "red",
  REVIEW: "orange",
};

const EVENT_SEVERITY_COLORS: Record<string, string> = {
  LOW: "blue",
  MEDIUM: "orange",
  HIGH: "red",
  CRITICAL: "magenta",
};

const EVENT_STATUS_COLORS: Record<string, string> = {
  OPEN: "red",
  INVESTIGATING: "orange",
  RESOLVED: "green",
  CLOSED: "default",
};

// ── QC Control Materials Tab ───────────────────────────────
function MaterialsTab() {
  const { items, total, page, loading, fetch, setPage } = usePaginated<QCControlMaterial>(
    ({ page, size }) =>
      qcApi.listMaterials({ page, page_size: size }),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await qcApi.createMaterial({
        ...values,
        expiry_date: values.expiry_date
          ? dayjs(values.expiry_date as string).format("YYYY-MM-DD")
          : null,
      });
      message.success("质控品已添加");
      setModalOpen(false);
      form.resetFields();
      fetch(1);
    } catch {
      message.error("添加失败");
    } finally {
      setSubmitting(false);
    }
  };

  const expiryDays = (exp: string | null | undefined) => {
    if (!exp) return null;
    const d = dayjs(exp).diff(dayjs(), "day");
    return d;
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await qcApi.deleteMaterial(id);
      message.success("质控品已删除");
      fetch(page);
    } catch {
      message.error("删除失败");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Title level={4}>质控品管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          添加质控品
        </Button>
      </div>

      <Table<QCControlMaterial>
        rowKey="id"
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      >
        <Table.Column key="icon" width={40} render={(_: unknown, r) => MATERIAL_TYPE_ICON[r.material_type] || "📦"} />
        <Table.Column title="名称" dataIndex="name" render={(v: string) => <strong>{v}</strong>} />
        <Table.Column
          title="类型"
          dataIndex="material_type"
          render={(v: string) => (
            <Tag color={v === "POSITIVE" ? "green" : v === "NEGATIVE" ? "red" : v === "NTC" ? "default" : "blue"}>
              {v}
            </Tag>
          )}
        />
        <Table.Column title="批号" dataIndex="lot_number" />
        <Table.Column title="厂家" dataIndex="manufacturer" render={(v: string) => v || "—"} />
        <Table.Column
          title="效期"
          dataIndex="expiry_date"
          render={(v: string) => {
            const days = expiryDays(v);
            if (days === null) return <Text type="secondary">未设置</Text>;
            if (days < 0) return <Tag color="red">已过期 {v}</Tag>;
            if (days <= 30) return <Tag color="orange">剩余 {days} 天</Tag>;
            return <Tag color="green">{v}</Tag>;
          }}
        />
        <Table.Column title="指标数" dataIndex="target_values" render={(v: Record<string, unknown>) => Object.keys(v || {}).length} />
        <Table.Column
          title="操作"
          key="actions"
          width={80}
          render={(_: unknown, r: QCControlMaterial) => (
            <Popconfirm
              title="确定删除此质控品？"
              onConfirm={() => handleDeleteMaterial(r.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>

      <Modal
        title="添加质控品"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="e.g., KAPA Universal Control" />
          </Form.Item>
          <Form.Item name="material_type" label="类型" rules={[{ required: true }]}>
            <Select>
              <Option value="POSITIVE">阳性对照</Option>
              <Option value="NEGATIVE">阴性对照</Option>
              <Option value="NTC">无模板对照 (NTC)</Option>
              <Option value="REFERENCE">参考标准</Option>
            </Select>
          </Form.Item>
          <Form.Item name="lot_number" label="批号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="manufacturer" label="厂家">
            <Input />
          </Form.Item>
          <Form.Item name="catalog_number" label="货">
            <Input />
          </Form.Item>
          <Form.Item name="expiry_date" label="有效期至">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ── QC Runs Tab ────────────────────────────────────────────
function RunsTab() {
  const { items, total, page, loading, fetch, setPage } = usePaginated<QCRun>(
    ({ page, size }) =>
      qcApi.listRuns({ page, page_size: size, ordering: "-created_at" }),
  );

  const handleDeleteRun = async (id: string) => {
    try {
      await qcApi.deleteRun(id);
      message.success("QC运行已删除");
      fetch(page);
    } catch {
      message.error("删除失败");
    }
  };

  return (
    <div>
      <Title level={4}>QC 运行记录</Title>
      <Table<QCRun>
        rowKey="id"
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      >
        <Table.Column
          title="运行编号"
          render={(_: unknown, r: QCRun) => (
            <Text strong style={{ fontFamily: "monospace" }}>
              {r.control_material_name}
            </Text>
          )}
        />
        <Table.Column
          title="类型"
          dataIndex="control_material_name"
          width={200}
        />
        <Table.Column
          title="结果"
          dataIndex="pass_fail"
          render={(v: string) => (
            <Tag color={PASS_FAIL_COLORS[v] || "default"}>
              {v === "PASS" ? "✅ PASS" : v === "FAIL" ? "❌ FAIL" : "⚠️ REVIEW"}
            </Tag>
          )}
        />
        <Table.Column
          title="测量值"
          dataIndex="measured_values"
          render={(v: Record<string, number>) => (
            <Space wrap size="small">
              {Object.entries(v || {}).map(([k, val]) => (
                <Tag key={k} style={{ fontSize: 12 }}>
                  {k}: {typeof val === "number" ? val.toFixed(2) : val}
                </Tag>
              ))}
            </Space>
          )}
        />
        <Table.Column
          title="Westgard 违规"
          dataIndex="westgard_violations"
          render={(v: string[]) =>
            v && v.length > 0 ? (
              <Tag color="red">{v.join(", ")}</Tag>
            ) : (
              <Tag color="green">—</Tag>
            )
          }
        />
        <Table.Column title="备注" dataIndex="notes" render={(v: string) => v || "—"} />
        <Table.Column title="审核人" dataIndex="reviewed_by_name" render={(v: string) => v || "待审核"} />
        <Table.Column
          title="时间"
          dataIndex="created_at"
          render={(v: string) => dayjs(v).format("YYYY-MM-DD HH:mm")}
        />
        <Table.Column
          title="操作"
          key="actions"
          width={80}
          render={(_: unknown, r: QCRun) => (
            <Popconfirm
              title="确定删除此QC运行记录？"
              onConfirm={() => handleDeleteRun(r.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        />
      </Table>
    </div>
  );
}

// ── Levey-Jennings Charts Tab ──────────────────────────────
function ChartsTab() {
  const [charts, setCharts] = useState<QCChart[]>([]);
  const [selectedChart, setSelectedChart] = useState<QCChart | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCharts = async () => {
    setLoading(true);
    try {
      const res = await qcApi.listCharts();
      setCharts(res.data.results || []);
    } catch {
      message.error("获取图表失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchChartData = async (id: string) => {
    try {
      const res = await qcApi.getChart(id);
      setSelectedChart(res.data);
    } catch {
      message.error("获取图表数据失败");
    }
  };

  // Use simple effect pattern
  useEffect(() => {
    fetchCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteChart = async (id: string) => {
    try {
      await qcApi.deleteChart(id);
      message.success("图表已删除");
      fetchCharts();
    } catch {
      message.error("删除失败");
    }
  };

  // Simple SVG-based Levey-Jennings chart
  const renderChart = (chart: QCChart) => {
    const points = chart.data_points || [];
    if (points.length === 0) {
      return <Empty description="暂无数据点" />;
    }

    const width = 800;
    const height = 300;
    const pad = { top: 30, bottom: 40, left: 80, right: 30 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const values = points.map((p) => p.value);
    void values;
    const mean = chart.target_mean;
    const sd = chart.target_sd;
    const yMin = mean - 4 * sd;
    const yMax = mean + 4 * sd;

    const xScale = (i: number) => pad.left + (i / (points.length - 1 || 1)) * plotW;
    const yScale = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // Chart lines
    const refY = yScale(mean);
    const w1Up = yScale(mean + 2 * sd);
    const w1Down = yScale(mean - 2 * sd);
    const a1Up = yScale(mean + sd);
    const a1Down = yScale(mean - sd);
    const w2Up = yScale(mean + 3 * sd);
    const w2Down = yScale(mean - 3 * sd);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", background: "#fafafa" }}>
        {/* Title */}
        <text x={width / 2} y={16} textAnchor="middle" fontSize={14} fontWeight="bold">
          {chart.metric_name} — {chart.control_material_name}
        </text>

        {/* Horizontal reference lines */}
        <line x1={pad.left} y1={refY} x2={width - pad.right} y2={refY} stroke="#333" strokeWidth={1.5} strokeDasharray="5,5" />
        <text x={pad.left - 5} y={refY + 4} textAnchor="end" fontSize={10}>Mean ({mean})</text>

        <line x1={pad.left} y1={w1Up} x2={width - pad.right} y2={w1Up} stroke="#fa541c" strokeWidth={1} strokeDasharray="3,3" />
        <line x1={pad.left} y1={w1Down} x2={width - pad.right} y2={w1Down} stroke="#fa541c" strokeWidth={1} strokeDasharray="3,3" />
        <text x={width - pad.right + 2} y={w1Up + 4} fontSize={9} fill="#fa541c">+2SD</text>
        <text x={width - pad.right + 2} y={w1Down + 4} fontSize={9} fill="#fa541c">−2SD</text>

        <line x1={pad.left} y1={w2Up} x2={width - pad.right} y2={w2Up} stroke="#cf1322" strokeWidth={1} />
        <line x1={pad.left} y1={w2Down} x2={width - pad.right} y2={w2Down} stroke="#cf1322" strokeWidth={1} />
        <text x={width - pad.right + 2} y={w2Up + 4} fontSize={9} fill="#cf1322">+3SD</text>
        <text x={width - pad.right + 2} y={w2Down + 4} fontSize={9} fill="#cf1322">−3SD</text>

        {/* +1SD and -1SD */}
        <line x1={pad.left} y1={a1Up} x2={width - pad.right} y2={a1Up} stroke="#52c41a" strokeWidth={0.5} />
        <line x1={pad.left} y1={a1Down} x2={width - pad.right} y2={a1Down} stroke="#52c41a" strokeWidth={0.5} />
        <text x={pad.left + 5} y={a1Up - 3} fontSize={8}>+1SD</text>
        <text x={pad.left + 5} y={a1Down + 10} fontSize={8}>−1SD</text>

        {/* Data points */}
        {points.map((p, i) => {
          const x = xScale(i);
          const y = yScale(p.value);
          const isAlert = Math.abs(p.value - mean) > 3 * sd;
          const isWarning = Math.abs(p.value - mean) > 2 * sd;
          return (
            <g key={i}>
              {i > 0 && (
                <line
                  x1={xScale(i - 1)}
                  y1={yScale(points[i - 1].value)}
                  x2={x}
                  y2={y}
                  stroke={isAlert ? "#cf1322" : isWarning ? "#fa541c" : "#1890ff"}
                  strokeWidth={2}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={isAlert ? 6 : 4}
                fill={isAlert ? "#cf1322" : isWarning ? "#fa541c" : "#1890ff"}
                stroke="#fff"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* X axis labels */}
        {points.map((p, i) => {
          if (i % Math.max(1, Math.floor(points.length / 10)) !== 0 && i !== points.length - 1) return null;
          return (
            <text key={i} x={xScale(i)} y={height - 5} textAnchor="middle" fontSize={9}>
              {dayjs(p.date).format("MM/DD")}
            </text>
          );
        })}
      </svg>
    );
  };

  return (
    <div style={{ display: "flex", gap: 16 }}>
      {/* Chart list */}
      <Card title="QC 图表列表" style={{ width: 360, flexShrink: 0, overflowY: "auto", maxHeight: "80vh" }}>
        <Spin spinning={loading}>
          <div style={{ marginBottom: 8 }}>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchCharts}>
              刷新
            </Button>
          </div>
          {charts.length === 0 ? (
            <Empty description="暂无QC图表" />
          ) : (
            charts.map((c) => (
              <Card
                key={c.id}
                size="small"
                hoverable
                style={{
                  marginBottom: 8,
                  borderLeft: selectedChart?.id === c.id ? "3px solid #1890ff" : "3px solid transparent",
                }}
                onClick={() => fetchChartData(c.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text strong>{c.metric_name}</Text>
                  <Tag color={c.is_active ? "green" : "default"}>{c.is_active ? "激活" : "停用"}</Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {c.control_material_name}
                </Text>
                <div style={{ marginTop: 4, textAlign: "right" }}>
                  <Popconfirm
                    title="确定删除此图表？"
                    onConfirm={() => handleDeleteChart(c.id)}
                    okText="确定"
                    cancelText="取消"
                    onPopupClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              </Card>
            ))
          )}
        </Spin>
      </Card>

      {/* Chart detail */}
      <Card
        title="Levey-Jennings 图表"
        style={{ flex: 1 }}
        extra={
          selectedChart ? (
            <Tag>Mean: {selectedChart.target_mean} ± {selectedChart.target_sd} SD</Tag>
          ) : null
        }
      >
        {selectedChart ? (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="指标">{selectedChart.metric_name}</Descriptions.Item>
              <Descriptions.Item label="质控品">{selectedChart.control_material_name}</Descriptions.Item>
              <Descriptions.Item label="目标均值">{selectedChart.target_mean}</Descriptions.Item>
              <Descriptions.Item label="目标 SD">{selectedChart.target_sd}</Descriptions.Item>
              <Descriptions.Item label="警告规则">
                {(selectedChart.westgard_rules || []).map((r) => (
                  <Tag key={r}>{r}</Tag>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="数据点">{selectedChart.data_points?.length || 0}</Descriptions.Item>
            </Descriptions>
            {renderChart(selectedChart)}
          </>
        ) : (
          <Empty description="请在左侧选择一个图表查看详情" />
        )}
      </Card>
    </div>
  );
}

// ── QC Events (CAPA) Tab ───────────────────────────────────
function EventsTab() {
  const { items, total, page, loading, fetch, setPage, setSearch, search } = usePaginated<QCEvent>(
    ({ page, size }) =>
      qcApi.listEvents({ page, page_size: size, ordering: "-created_at" }),
    { ordering: '-created_at' },
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editingEvent, setEditingEvent] = useState<QCEvent | null>(null);

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await qcApi.createEvent(values);
      message.success("事件已创建");
      setModalOpen(false);
      form.resetFields();
      fetch(1);
    } catch {
      message.error("创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await qcApi.updateEventStatus(id, status);
      message.success(`状态已更新为 ${status}`);
      fetch(page);
    } catch {
      message.error("更新失败");
    }
  };

  const handleDeleteEvent = async (id: string) => {
    try {
      await qcApi.deleteEvent(id);
      message.success("事件已删除");
      fetch(page);
    } catch {
      message.error("删除失败");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Title level={4}>质量事件 (CAPA)</Title>
        <Space>
          <Input.Search
            placeholder="搜索事件..."
            style={{ width: 250 }}
            onSearch={(v) => {
              setSearch(v);
              fetch(1);
            }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新建事件
          </Button>
        </Space>
      </div>

      {/* Summary cards */}
      {search === undefined && page === 1 && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {(items || []).length > 0 && (
            <>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="活跃事件"
                    value={(items as QCEvent[]).filter((i) => i.status === "OPEN" || i.status === "INVESTIGATING").length}
                    valueStyle={{ color: "#fa541c" }}
                    prefix={<AlertOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="已解决"
                    value={(items as QCEvent[]).filter((i) => i.status === "RESOLVED").length}
                    valueStyle={{ color: "#52c41a" }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="高/严重"
                    value={(items as QCEvent[]).filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").length}
                    valueStyle={{ color: "#cf1322" }}
                    prefix={<WarningOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="逾期"
                    value={(items as QCEvent[]).filter(
                      (i) => i.target_date && dayjs(i.target_date).isBefore(dayjs()) && i.status !== "CLOSED"
                    ).length}
                    valueStyle={{ color: "#ff4d4f" }}
                    prefix={<CloseCircleOutlined />}
                  />
                </Card>
              </Col>
            </>
          )}
        </Row>
      )}

      <Table<QCEvent>
        rowKey="id"
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      >
        <Table.Column
          title="类型"
          dataIndex="event_type"
          render={(v: string) => (
            <Tag color={v === "QC_FAILURE" ? "red" : v === "DEVIATION" ? "orange" : "blue"}>
              {v}
            </Tag>
          )}
        />
        <Table.Column
          title="严重度"
          dataIndex="severity"
          render={(v: string) => <Tag color={EVENT_SEVERITY_COLORS[v] || "default"}>{v}</Tag>}
        />
        <Table.Column title="摘要" dataIndex="summary" ellipsis={{ showTitle: true }} />
        <Table.Column
          title="状态"
          dataIndex="status"
          render={(v: string) => (
            <Tag color={EVENT_STATUS_COLORS[v] || "default"}>{v}</Tag>
          )}
        />
        <Table.Column
          title="目标日期"
          dataIndex="target_date"
          render={(v: string) => {
            if (!v) return "—";
            const d = dayjs(v).diff(dayjs(), "day");
            return (
              <Tag color={d < 0 ? "red" : d <= 7 ? "orange" : "blue"}>
                {d < 0 ? `已逾期 ${Math.abs(d)} 天` : `${v}`}
              </Tag>
            );
          }}
        />
        <Table.Column
          title="操作"
          key="actions"
          width={260}
          render={(_: unknown, r: QCEvent) => (
            <Space>
              {r.status === "OPEN" && (
                <Button
                  size="small"
                  onClick={() => handleStatusUpdate(r.id, "INVESTIGATING")}
                >
                  调查
                </Button>
              )}
              {r.status === "INVESTIGATING" && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => handleStatusUpdate(r.id, "RESOLVED")}
                >
                  解决
                </Button>
              )}
              {r.status === "RESOLVED" && (
                <Button size="small" onClick={() => handleStatusUpdate(r.id, "CLOSED")}>
                  关闭
                </Button>
              )}
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setEditingEvent(r)}
              />
              <Popconfirm
                title="确定删除此事件？"
                onConfirm={() => handleDeleteEvent(r.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>

      {/* Create event modal */}
      <Modal
        title="新建质量事件"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="event_type" label="事件类型" rules={[{ required: true }]}>
            <Select>
              <Option value="QC_FAILURE">QC 失败</Option>
              <Option value="PT_UNSATISFACTORY">PT 不满意</Option>
              <Option value="DEVIATION">偏差</Option>
              <Option value="INSTRUMENT_FAILURE">仪器故障</Option>
              <Option value="CUSTOMER_COMPLAINT">客户投诉</Option>
            </Select>
          </Form.Item>
          <Form.Item name="severity" label="严重度" rules={[{ required: true }]}>
            <Select>
              <Option value="LOW">低</Option>
              <Option value="MEDIUM">中</Option>
              <Option value="HIGH">高</Option>
              <Option value="CRITICAL">严重</Option>
            </Select>
          </Form.Item>
          <Form.Item name="summary" label="摘要" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="详细描述">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="target_date" label="目标解决日期">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Detail modal */}
      <Modal
        title="事件详情"
        open={!!editingEvent}
        onCancel={() => setEditingEvent(null)}
        footer={[<Button key="close" onClick={() => setEditingEvent(null)}>关闭</Button>]}
        width={600}
      >
        {editingEvent && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="事件类型">{editingEvent.event_type}</Descriptions.Item>
            <Descriptions.Item label="严重度">
              <Tag color={EVENT_SEVERITY_COLORS[editingEvent.severity]}>{editingEvent.severity}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={EVENT_STATUS_COLORS[editingEvent.status]}>{editingEvent.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="摘要">{editingEvent.summary}</Descriptions.Item>
            <Descriptions.Item label="目标日期">{editingEvent.target_date || "—"}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(editingEvent.created_at).format("YYYY-MM-DD HH:mm")}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

// ── Main QC Page ────────────────────────────────────────────

// ── Main QC Page ────────────────────────────────────────────
const tabItems = [
  { key: "materials", label: "质控品", icon: <LineChartOutlined />, children: <MaterialsTab /> },
  { key: "runs", label: "QC运行", icon: <CheckCircleOutlined />, children: <RunsTab /> },
  { key: "charts", label: "L-J图表", icon: <LineChartOutlined />, children: <ChartsTab /> },
  { key: "events", label: "质量事件", icon: <AlertOutlined />, children: <EventsTab /> },
];

export default function QC() {
  return (
    <DashboardLayout header="质量控制">
      <Alert
        message="QC 模块"
        description="质控品管理 · QC运行记录 · Levey-Jennings图表 · 质量事件(CAPA)"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Tabs
        defaultActiveKey="materials"
        items={tabItems}
        size="large"
      />
    </DashboardLayout>
  );
}
