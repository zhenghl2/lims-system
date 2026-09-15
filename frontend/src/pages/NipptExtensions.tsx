// NipptExtensions.tsx — NIPPT 拓展功能模块（独立工具集，与主流程无关联）
import { useState } from "react";
import { Card, Typography, Tag, Modal, Space, Empty } from "antd";
import {
  FileTextOutlined, PlusOutlined, AppstoreOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

interface ExtFeature {
  key: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  status: "ready" | "dev";
}

// 已规划/已上线的功能列表（后续功能在此追加）
const FEATURES: ExtFeature[] = [
  {
    key: "thai_report",
    name: "泰国数据生成报告",
    desc: "生成泰国数据报告（具体实现待配置）",
    icon: <FileTextOutlined />,
    status: "dev",
  },
];

export default function NipptExtensions() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ExtFeature | null>(null);

  const openFeature = (f: ExtFeature) => {
    setActive(f);
    setOpen(true);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <AppstoreOutlined style={{ fontSize: 20, color: "#1677ff" }} />
        <Title level={4} style={{ margin: 0 }}>拓展功能</Title>
      </div>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        独立工具集 —— 与 NIPPT 主流程（登记 / 实验 / 测序）无关联，后续功能将在此陆续添加。
      </Paragraph>

      {/* 功能卡片区（后续功能在此扩展） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {FEATURES.map(f => (
          <Card
            key={f.key}
            hoverable
            style={{ width: 280, minHeight: 120 }}
            onClick={() => openFeature(f)}
          >
            <Space align="start" size={12}>
              <span style={{ fontSize: 24, color: "#1677ff" }}>{f.icon}</span>
              <div>
                <Text strong style={{ fontSize: 14 }}>{f.name}</Text>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{f.desc}</Text>
                </div>
                <div style={{ marginTop: 8 }}>
                  {f.status === "dev"
                    ? <Tag color="orange" style={{ fontSize: 11 }}>开发中</Tag>
                    : <Tag color="green" style={{ fontSize: 11 }}>可用</Tag>}
                </div>
              </div>
            </Space>
          </Card>
        ))}

        {/* 预留占位（后续功能位） */}
        {[1, 2, 3].map(i => (
          <Card
            key={`placeholder-${i}`}
            style={{ width: 280, minHeight: 120, borderStyle: "dashed", opacity: 0.45, background: "transparent" }}
          >
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <PlusOutlined style={{ fontSize: 20, color: "#bbb" }} />
              <div style={{ marginTop: 6 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>更多功能开发中</Text>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 功能占位弹窗（具体实现后续替换） */}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        title={active?.name}
        width={520}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div>
              <div style={{ marginBottom: 4 }}>功能框架已就绪</div>
              <Text type="secondary" style={{ fontSize: 12 }}>具体实现待后续说明后接入</Text>
            </div>
          }
        />
      </Modal>
    </>
  );
}
