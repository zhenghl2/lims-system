import { Typography } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
const { Title, Text } = Typography;

export default function NipptHybSeq() {
  return (
    <div style={{ textAlign: "center", paddingTop: 100, color: "#999" }}>
      <CloudUploadOutlined style={{ fontSize: 64, color: "#1890ff" }} />
      <Title level={4} style={{ marginTop: 16 }}>🔬 杂交及测序</Title>
      <Text type="secondary">模块开发中 — Hybridization & Sequencing</Text>
    </div>
  );
}
