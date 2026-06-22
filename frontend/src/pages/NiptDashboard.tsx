import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Table, Tag, Space, Empty } from "antd";
import { ExperimentOutlined, InboxOutlined, CheckCircleOutlined, CloseCircleOutlined, FileDoneOutlined, FilterOutlined, BuildOutlined, MergeCellsOutlined, CloudUploadOutlined, BarChartOutlined } from "@ant-design/icons";
import { samplesApi, runsApi } from "../api";

const { Title, Text } = Typography;

export default function NiptDashboard() {
  const [stats, setStats] = useState<any>({});
  const [runStats, setRunStats] = useState<any[]>([]);

  useEffect(() => {
    samplesApi.statsByPanel().then(r => {
      const panels = (r.data || []) as Array<Record<string, number|string>>;
      const nipt = panels.find(p => p.panel_code === "NIPT") || {};
      const niptPlus = panels.find(p => p.panel_code === "NIPT_PLUS") || {};
      setStats({
        total: Number(nipt.total || 0) + Number(niptPlus.total || 0),
        receiving: Number(nipt.receiving || 0) + Number(niptPlus.receiving || 0),
        received: Number(nipt.received || 0) + Number(niptPlus.received || 0),
        extraction: Number(nipt.extraction || 0) + Number(niptPlus.extraction || 0),
        library_prep: Number(nipt.library_prep || 0) + Number(niptPlus.library_prep || 0),
        pooling: Number(nipt.pooling || 0) + Number(niptPlus.pooling || 0),
        sequencing: Number(nipt.sequencing || 0) + Number(niptPlus.sequencing || 0),
        bioinformatics: Number(nipt.bioinformatics || 0) + Number(niptPlus.bioinformatics || 0),
        testing: Number(nipt.testing || 0) + Number(niptPlus.testing || 0),
        analyzing: Number(nipt.analyzing || 0) + Number(niptPlus.analyzing || 0),
        completed: Number(nipt.completed || 0) + Number(niptPlus.completed || 0),
        reported: Number(nipt.reported || 0) + Number(niptPlus.reported || 0),
        rejected: Number(nipt.rejected || 0) + Number(niptPlus.rejected || 0),
      });
    }).catch(() => {});
    runsApi.list({ panel_code: "NIPT,NIPT_PLUS", page_size: 5, ordering: "-created_at" })
      .then(r => setRunStats((r.data as any)?.results || [])).catch(() => {});
  }, []);

  const s = stats as Record<string, number>;

  const statCards = [
    { title: "Total", value: s.total || 0, icon: <ExperimentOutlined />, color: "#1677ff" },
    { title: "Received", value: s.received || 0, icon: <InboxOutlined />, color: "#faad14" },
    { title: "核酸提取", value: s.extraction || 0, icon: <FilterOutlined />, color: "#13c2c2" },
    { title: "文库构建", value: s.library_prep || 0, icon: <BuildOutlined />, color: "#1677ff" },
    { title: "Pooling", value: s.pooling || 0, icon: <MergeCellsOutlined />, color: "#2f54eb" },
    { title: "上机测序", value: s.sequencing || 0, icon: <CloudUploadOutlined />, color: "#722ed1" },
    { title: "生信分析", value: s.bioinformatics || 0, icon: <BarChartOutlined />, color: "#eb2f96" },
    { title: "Completed", value: s.completed || 0, icon: <CheckCircleOutlined />, color: "#52c41a" },
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
          <Col span={4} key={i} style={{ minWidth: 140 }}>
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
              <Text>1. Register samples in <Text strong>Sample Registration</Text>（样本登记）</Text>
              <Text>2. Receive samples in <Text strong>Receiving</Text>（样本签收）</Text>
              <Text>3. Create batch and start workflow in <Text strong>Lab Workflow</Text>（实验流程）</Text>
              <Text>4. NIPT 5-step workflow:</Text>
              <Text style={{ paddingLeft: 16 }}>① 核酸提取 → ② 文库构建 → ③ 文库定量及Pooling → ④ 上机测序 → ⑤ 生物信息分析</Text>
              <Text>5. View reports in <Text strong>Reports</Text>（报告）</Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}