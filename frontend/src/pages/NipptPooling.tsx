import { Typography } from "antd";
import { MergeCellsOutlined } from "@ant-design/icons";
const { Title, Text } = Typography;

export default function NipptPooling() {
  return (
    <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
      <MergeCellsOutlined style={{ fontSize: 64, color: "#eb2f96" }} />
      <Title level={4} style={{ marginTop: 16 }}>🧪 文库定量及Pooling</Title>
      <Text type="secondary">模块开发中 — Library QC & Pooling</Text>
    </div>
  );
}
