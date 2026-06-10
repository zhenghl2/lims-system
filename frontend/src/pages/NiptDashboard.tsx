import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Table, Tag, Space, Empty } from "antd";
import { ExperimentOutlined, InboxOutlined, CheckCircleOutlined, CloseCircleOutlined, FileDoneOutlined, SyncOutlined } from "@ant-design/icons";
import { samplesApi, runsApi } from "../api";

const { Title, Text } = Typography;

export default function NiptDashboard() {
  const [stats, setStats] = useState<any>({});
  const [runStats, setRunStats] = useState<any[]>([]);

  useEffect(() => {
    samplesApi.statsByPanel().then(r => {
      const all = r.data || {};
      setStats(all["NIPT"] || all["NIPT_PLUS"] || {});
    }).catch(() => {});
    runsApi.list({ panel_code: "NIPT,NIPT_PLUS", page_size: 5, ordering: "-created_at" })
      .then(r => setRunStats((r.data as any)?.results || [])).catch(() => {});
  }, []);

  const s = stats as Record<string, number>;

  const statCards = [
    { title: "Total Samples", value: s.total || 0, icon: <ExperimentOutlined />, color: "#1677ff" },
    { title: "Registered", value: (s.total_received_today || 0) + (s.pending || 0), icon: <InboxOutlined />, color: "#faad14" },
    { title: "In Process", value: s.total_in_process || 0, icon: <SyncOutlined spin />, color: "#722ed1" },
    { title: "Completed", value: s.total_completed || 0, icon: <CheckCircleOutlined />, color: "#52c41a" },
    { title: "Reported", value: s.reported || 0, icon: <FileDoneOutlined />, color: "#13c2c2" },
    { title: "Rejected", value: s.rejected || 0, icon: <CloseCircleOutlined />, color: "#ff4d4f" },
  ];

  const statusColors: Record<string, string> = {
    PLANNED: "default", LIBRARY_PREP: "blue", SEQUENCING: "purple",
    ANALYZING: "orange", COMPLETED: "green", FAILED: "red",
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>NIPT Dashboard</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((c, i) => (
          <Col span={4} key={i}>
            <Card size="small" hoverable>
              <Statistic title={c.title} value={c.value} prefix={c.icon} valueStyle={{ color: c.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="Recent Batches" size="small">
            {runStats.length > 0 ? (
              <Table rowKey="id" size="small" dataSource={runStats} pagination={false}
                columns={[
                  { title: "Run #", dataIndex: "run_number", width: 150, render: (v: string) => <Text code>{v}</Text> },
                  { title: "Samples", dataIndex: "sample_count", width: 70, align: "center" as const },
                  { title: "Status", dataIndex: "status", width: 100, render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag> },
                  { title: "Created", dataIndex: "created_at", width: 100, render: (v: string) => new Date(v).toLocaleDateString() },
                ]}
              />
            ) : <Empty description="No batches yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Quick Guide" size="small">
            <Space direction="vertical" size="small">
              <Text>1. Register samples in <Text strong>Sample Registration</Text></Text>
              <Text>2. Receive samples in <Text strong>Sample Receiving</Text></Text>
              <Text>3. Create batches and run workflow in <Text strong>Workflow</Text></Text>
              <Text>4. NGS-NIPT: 核酸提取 → 文库构建 → 上机测序 → 生物信息分析</Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}