import { Typography } from "antd";
import { BarChartOutlined } from "@ant-design/icons";
const { Title, Text } = Typography;

export default function NipptBioinformatics() {
  return (
    <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
      <BarChartOutlined style={{ fontSize: 64, color: "#52c41a" }} />
      <Title level={4} style={{ marginTop: 16 }}>📊 生物信息分析</Title>
      <Text type="secondary">模块开发中 — Bioinformatics Analysis</Text>
    </div>
  );
}
