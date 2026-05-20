import { useState, useEffect } from "react";
import { Card, Row, Col, Statistic, Table, Tag, Typography, Alert } from "antd";
import {
  ExperimentOutlined, ClockCircleOutlined,
  WarningOutlined, InboxOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import type { CaseDashboard } from "../api/types";

const { Title } = Typography;

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "Queued", color: "default" },
  in_progress: { label: "In Progress", color: "processing" },
  sequenced: { label: "Sequenced", color: "blue" },
  analyzed: { label: "Analyzed", color: "cyan" },
  passed_qc: { label: "Passed QC", color: "green" },
};

export default function NipptDashboardPage() {
  const [data, setData] = useState<CaseDashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await casesApi.dashboard();
      setData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetch(); }, []);

  const stageData = data?.workflow_stages
    ? Object.entries(data.workflow_stages).map(([k, v]) => ({
        stage: STAGE_LABELS[k]?.label || k,
        count: v,
        color: STAGE_LABELS[k]?.color || "default",
      }))
    : [];

  const stageColumns = [
    { title: "Stage", dataIndex: "stage", key: "stage",
      render: (text: string, record: any) => <Tag color={record.color}>{text}</Tag> },
    { title: "Count", dataIndex: "count", key: "count" },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>NIPPT Dashboard</Title>

      {data?.incomplete_pairs ? (
        <Alert
          type="warning" showIcon icon={<WarningOutlined />}
          message={`${data.incomplete_pairs} case(s) have incomplete sample pairs (mother received, father missing)`}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {data?.near_deadline ? (
        <Alert
          type="error" showIcon icon={<ClockCircleOutlined />}
          message={`${data.near_deadline} case(s) approaching deadline (within 2 days)`}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="Draft" value={data?.case_status?.draft || 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="Registered" value={data?.case_status?.registered || 0} valueStyle={{ color: "#1677ff" }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="Receiving" value={data?.case_status?.receiving || 0} valueStyle={{ color: "#fa8c16" }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="In Process" value={data?.case_status?.in_process || 0} valueStyle={{ color: "#1677ff" }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="Completed" value={data?.case_status?.completed || 0} valueStyle={{ color: "#13c2c2" }} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card><Statistic title="Reported" value={data?.case_status?.reported || 0} valueStyle={{ color: "#52c41a" }} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={6}>
          <Card><Statistic title="Urgent" value={data?.urgent || 0} prefix={<WarningOutlined />} valueStyle={{ color: "#ff4d4f" }} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="Incomplete Pairs" value={data?.incomplete_pairs || 0} prefix={<InboxOutlined />} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="Near Deadline" value={data?.near_deadline || 0} prefix={<ClockCircleOutlined />} valueStyle={{ color: "#ff4d4f" }} /></Card>
        </Col>
        <Col xs={24} md={6}>
          <Card><Statistic title="Expected Today" value={data?.today_expected || 0} prefix={<ExperimentOutlined />} /></Card>
        </Col>
      </Row>

      <Card title="Workflow Stages" style={{ marginTop: 16 }}>
        <Table
          dataSource={stageData}
          columns={stageColumns}
          pagination={false}
          size="small"
          rowKey="stage"
          loading={loading}
        />
      </Card>
    </div>
  );
}
