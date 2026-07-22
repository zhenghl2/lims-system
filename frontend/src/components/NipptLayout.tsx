import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Layout, Menu, Typography, Avatar, Dropdown, Space, theme as antdTheme } from "antd";
import {
  DashboardOutlined, ProfileOutlined, LinkOutlined,
  InboxOutlined, ExperimentOutlined, FileTextOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, ContainerOutlined,
  UserOutlined, LogoutOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useAuthStore } from "../store/auth";
const { Sider, Header, Content, Footer } = Layout;
const { Text } = Typography;

const MENU_ITEMS = [
  { key: "/nippt/dashboard",    icon: <DashboardOutlined />,   label: "NIPPT Dashboard" },
  { key: "/nippt/cases",        icon: <ProfileOutlined />,     label: "Case Management" },
  { key: "/nippt/registration", icon: <LinkOutlined />,        label: "Sample Registration" },
  { key: "/nippt/receiving",    icon: <InboxOutlined />,       label: "Sample Receiving" },
  { key: "/nippt/preprocessing", icon: <ContainerOutlined />,   label: "Pre-Processing" },
  { key: "/nippt/workflow",     icon: <ExperimentOutlined />,  label: "Lab Workflow" },
  { key: "/nippt/reports",      icon: <FileTextOutlined />,    label: "Reports" },
];

interface Props {
  children: ReactNode;
  header?: ReactNode;
}

export default function NipptLayout({ children, header }: Props) {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { token } = antdTheme.useToken();

  const userMenuItems = [
    { key: "profile", icon: <UserOutlined />, label: user ? `${user.first_name} ${user.last_name}` : "", disabled: true },
    { type: "divider" as const },
    { key: "settings", icon: <SettingOutlined />, label: "Settings" },
    { key: "logout", icon: <LogoutOutlined />, label: "Sign Out", danger: true },
  ];

  // Match current path to menu key
  const selectedKey = MENU_ITEMS.find(item => location.pathname.startsWith(item.key))?.key || "/nippt/dashboard";

  return (
    <Layout style={{ minHeight: "calc(100vh - 46px)" }}>
      <Sider
        collapsible collapsed={collapsed}
        onCollapse={setCollapsed} theme="light"
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
        trigger={null}
      >
        <div style={{
          height: 64, display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: "0 16px",
        }}>
          <Text strong style={{ fontSize: collapsed ? 18 : 18, color: token.colorPrimary }}>
            {collapsed ? "NIPPT" : "NIPPT LIMS"}
          </Text>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS.map(item => ({
            ...item,
            label: <Link to={item.key} style={{ display: "inline" }}>{item.label}</Link>,
          }))}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: "0 24px", background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 48,
        }}>
          <Space size="middle">
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            <Text strong style={{ fontSize: 14 }}>{header || "NIPPT Subsystem"}</Text>
          </Space>

          <Space size="middle">
            {(!user?.allowed_panels || user.allowed_panels.length === 0 || user.allowed_panels.length > 1 || user.allowed_panels[0] !== "NIPPT") && (
              <a href="/" style={{ fontSize: 12, color: token.colorTextSecondary }}>
                ← Back to NIPT
              </a>
            )}
            <Dropdown menu={{ items: userMenuItems, onClick: (e) => { if (e.key === "logout") logout(); } }} trigger={["click"]}>
              <Space style={{ cursor: "pointer" }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
                <Text>{user?.first_name}</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: 16, padding: 16, background: token.colorBgContainer, borderRadius: token.borderRadiusLG, minHeight: 280 }}>
          {children}
        </Content>

        <Footer style={{ textAlign: "center", color: token.colorTextDescription, padding: "12px 50px" }}>
          NIPPT LIMS &copy; {new Date().getFullYear()}
        </Footer>
      </Layout>
    </Layout>
  );
}
