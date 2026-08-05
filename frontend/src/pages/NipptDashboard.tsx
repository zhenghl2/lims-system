import { useState, useEffect } from "react";
import { Card, Row, Col, Statistic, Typography, Tag } from "antd";
import { casesApi } from "../api";

const { Title, Text } = Typography;

const STAGE_COLORS: Record<string, string> = {
  REGISTERED: "default", RECEIVED: "blue", REJECTED: "red",
  PRE_PROCESSING: "orange", EXTRACTION: "gold", LIBRARY_PREP: "purple",
  POOLING: "magenta", HYB_SEQ: "cyan", BIOINFO: "geekblue",
  REPORT_DRAFT: "lime", COMPLETED: "green",
};

export default function NipptDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [activeStage, setActiveStage] = useState<string>("");
  const [stageSamples, setStageSamples] = useState<any[]>([]);

  useEffect(() => {
    casesApi.dashboard().then((res: any) => {
      const d = res.data;
      d.workflow_stages = d.workflow_stages || {};
      setData(d);
    });
  }, []);

  const stageItems = [
    { k: "REGISTERED", l: "登记", c: "default" },
    { k: "RECEIVED", l: "签收", c: "blue" },
    { k: "REJECTED", l: "拒收", c: "red" },
    { k: "PRE_PROCESSING", l: "前处理", c: "orange" },
    { k: "EXTRACTION", l: "提取", c: "gold" },
    { k: "LIBRARY_PREP", l: "建库", c: "purple" },
    { k: "POOLING", l: "Pooling", c: "magenta" },
    { k: "HYB_SEQ", l: "测序", c: "cyan" },
    { k: "BIOINFO", l: "生信", c: "geekblue" },
    { k: "REPORT_DRAFT", l: "报告", c: "lime" },
    { k: "COMPLETED", l: "完成", c: "green" },
  ];

  const handleStageClick = (stageKey: string) => {
    if (activeStage === stageKey) {
      setActiveStage("");
      setStageSamples([]);
      return;
    }
    setActiveStage(stageKey);
    // Use stage_detail from dashboard data (already loaded)
    const samples = data?.stage_detail?.[stageKey] || [];
    setStageSamples(samples.map((s: any, i: number) => ({ ...s, key: s.case_id + '_' + i })));
  };

  const stageColumns = [
    { title: "Case#", dataIndex: "case_number", key: "cn", width: 160 },
    { title: "PT#", dataIndex: "pt_number", key: "pt", width: 80 },
    { title: "PT ID", dataIndex: "test_sample_id", key: "tid", width: 100 },
    { title: "姓名", dataIndex: "patient_name", key: "name", width: 80 },
    { title: "样本类型", dataIndex: "sample_source", key: "st", width: 80, render: (v: string) => <Tag>{v}</Tag> },
    { title: "日期", dataIndex: "updated_at", key: "dt", width: 100 },
  ];

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
          <Card size="small" style={{ background: "#fff2f0" }}>
            <Statistic title="紧急" value={data?.urgent ?? 0} valueStyle={{ color: "#cf1322" }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ background: "#fffbe6" }}>
            <Statistic title="即将到期" value={data?.near_deadline ?? 0} />
          </Card>
        </Col>
      </Row>
      <Card title="样本流水线状态" size="small">
        <Row gutter={[8, 8]}>
          {stageItems.map(({ k, l, c }) => {
            const count = data?.workflow_stages?.[k.toLowerCase()] || data?.workflow_stages?.[k] || 0;
            const isActive = activeStage === k;
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
        {activeStage && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ marginBottom: 8, display: "block" }}>
              {stageItems.find(s => s.k === activeStage)?.l} ({stageSamples.length})
            </Text>
            <Table
              columns={stageColumns}
              dataSource={stageSamples}
              size="small"
              pagination={{ pageSize: 10, showTotal: (t: number) => `共 ${t} 条` }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
