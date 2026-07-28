import { useState, useEffect } from "react";
import { Card, Row, Col, Statistic, Typography } from "antd";
import { casesApi } from "../api";

const { Title } = Typography;

export default function NipptDashboardPage() {
  const [data, setData] = useState<any>(null);

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
            return (
              <Col key={k} xs={6} sm={4} md={3} lg={2}>
                <Card size="small" style={{ textAlign: "center", background: count > 0 ? "#f0f5ff" : "#fafafa" }}>
                  <Statistic title={l} value={count} valueStyle={{ fontSize: 18, color: count > 0 ? c : "#ccc" }} />
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>
    </div>
  );
}
