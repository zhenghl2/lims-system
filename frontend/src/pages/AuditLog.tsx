import { useState, useEffect } from "react";
import {
  Table, Card, Button, Tag, Typography, Statistic, message,
  Row, Col, Tabs,
} from "antd";
import {
  ReloadOutlined, LockOutlined, SafetyOutlined as ShieldOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/client";
import DashboardLayout from "../components/DashboardLayout";

const { Title } = Typography;

// ── Types ──────────────────────────────────────────────────
interface AuditLog {
  id: number;
  action: string;
  user_email: string;
  user_role: string;
  entity_type: string;
  entity_id: string;
  entity_repr: string;
  changes: Record<string, unknown>;
  ip_address: string | null;
  timestamp: string;
  row_hash: string;
}

interface AuditStats {
  total_count: number;
  by_action: { action: string; count: number }[];
  by_entity_type: { entity_type: string; count: number }[];
}

// ── Helpers ────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  LOGIN: "cyan",
  SIGN: "purple",
  REVIEW: "orange",
  VERIFY: "geekblue",
  RELEASE: "lime",
  RESAMPLE: "orange",
  SUPPLEMENT: "purple",
};

const ENTITY_LABELS: Record<string, string> = {
  sample: "样本",
  run: "运行",
  report: "报告",
  document: "文档",
  qc_run: "QC 运行",
  qc_event: "QC 事件",
  user: "用户",
  reagent_lot: "试剂批号",
  instrument: "仪器",
  training_record: "培训记录",
  competency_assessment: "能力评估",
  pt_program: "PT 项目",
  pt_round: "PT 轮次",
  internal_audit: "内部审计",
};

// ── Stats Tab ──────────────────────────────────────────────
function AuditStatsTab({ stats }: { stats: AuditStats | null }) {
  if (!stats) return <div style={{ padding: 20, color: "#999" }}>加载中...</div>;

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="总日志数"
              value={stats.total_count}
              prefix={<ShieldOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="唯一操作类型"
              value={stats.by_action.length}
              prefix={<BarChartOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="涉及实体类型"
              value={stats.by_entity_type.length}
              prefix={<LockOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="按操作类型统计" size="small">
            <Table
              dataSource={stats.by_action || []}
              size="small"
              pagination={false}
              rowKey="action"
            >
              <Table.Column
                title="操作"
                dataIndex="action"
                render={(v: string) => <Tag color={ACTION_COLORS[v] || "default"}>{v}</Tag>}
              />
              <Table.Column title="次数" dataIndex="count" />
            </Table>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="按实体类型统计" size="small">
            <Table
              dataSource={stats.by_entity_type || []}
              size="small"
              pagination={false}
              rowKey="entity_type"
            >
              <Table.Column
                title="实体"
                dataIndex="entity_type"
                render={(v: string) => ENTITY_LABELS[v] || v}
              />
              <Table.Column title="次数" dataIndex="count" />
            </Table>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const fetch = async (p = page) => {
    setLoading(true);
    try {
      const res = await api.get("/audit/audit-logs/", { params: { page: p, page_size: 20, ordering: "-timestamp" } });
      setLogs(res.data.results || []);
      setTotal(res.data.count || 0);
      setPage(p);
    } catch {
      message.error("获取审计日志失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get("/audit/audit-logs/stats/");
      setStats(res.data);
    } catch {
      // stats endpoint may not have data yet
    }
  };

  useEffect(() => { fetch(); fetchStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DashboardLayout header="审计日志">
      <Card>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <Title level={5}>审计追踪 — 防篡改哈希链</Title>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => { fetch(1); fetchStats(); }}>刷新</Button>
        </div>

        <Tabs
          defaultActiveKey="logs"
          items={[
            {
              key: "logs",
              label: "日志记录",
              children: (
                <Table<AuditLog>
                  rowKey="id"
                  dataSource={logs}
                  loading={loading}
                  columns={[
                    {
                      title: "操作",
                      dataIndex: "action",
                      width: 100,
                      render: (v: string) => <Tag color={ACTION_COLORS[v] || "default"}>{v}</Tag>,
                    },
                    {
                      title: "实体",
                      dataIndex: "entity_type",
                      width: 130,
                      render: (v: string, r: AuditLog) => (
                        <strong>{ENTITY_LABELS[v] || v}: {r.entity_repr}</strong>
                      ),
                    },
                    {
                      title: "用户",
                      dataIndex: "user_email",
                      width: 150,
                      render: (v: string, r: AuditLog) => `${v}${r.user_role ? ` (${r.user_role})` : ""}`,
                    },
                    {
                      title: "IP",
                      dataIndex: "ip_address",
                      width: 130,
                      render: (v: string) => v || "—",
                    },
                    {
                      title: "时间",
                      dataIndex: "timestamp",
                      width: 170,
                      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
                    },
                    {
                      title: "变更",
                      dataIndex: "changes",
                      render: (v: Record<string, unknown>) => {
                        if (!v || Object.keys(v).length === 0) return "—";
                        return (
                          <pre style={{
                            margin: 0, fontSize: 11, background: "#f5f5f5",
                            padding: "4px 8px", borderRadius: 4, maxHeight: 80, overflow: "auto",
                          }}>
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        );
                      },
                    },
                    {
                      title: "哈希",
                      dataIndex: "row_hash",
                      render: (v: string) => (
                        <code style={{ fontSize: 10, color: "#999" }}>
                          {v ? `${v.substring(0, 16)}...` : "—"}
                        </code>
                      ),
                    },
                  ]}
                  pagination={{
                    current: page, pageSize: 20, total, onChange: (p) => fetch(p),
                    showSizeChanger: false, showTotal: (t) => `共 ${t} 条`,
                  }}
                  scroll={{ x: 1200 }}
                />
              ),
            },
            {
              key: "stats",
              label: "统计",
              children: <AuditStatsTab stats={stats} />,
            },
          ]}
        />
      </Card>
    </DashboardLayout>
  );
}
