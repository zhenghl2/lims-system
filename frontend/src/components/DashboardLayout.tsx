import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Layout, Menu, Typography, Avatar, Dropdown, Space, theme as antdTheme, Badge } from "antd";
import {
  DashboardOutlined, BarcodeOutlined,
  ExperimentOutlined, FileTextOutlined, SafetyCertificateOutlined,
  ToolOutlined, MedicineBoxOutlined, BookOutlined,
  TeamOutlined, CloudServerOutlined, AuditOutlined,
  BellOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  UserOutlined, LogoutOutlined, SettingOutlined,
} from "@ant-design/icons";
import { useAuthStore } from "../store/auth";
const { Sider, Header, Content, Footer } = Layout;
const { Text } = Typography;

// ── Sidebar menu items (grouped) ─────────────────────────────────
const MENU_ITEMS = [
  // Core
  { key: "/",           icon: <DashboardOutlined />,       label: "Dashboard" },
  { key: "/samples",    icon: <BarcodeOutlined />,         label: "Samples" },
  { key: "/runs",       icon: <ExperimentOutlined />,      label: "Runs" },
  { key: "/protocols",  icon: <FileTextOutlined />,        label: "Protocols" },  { key: "/reports",    icon: <FileTextOutlined />,        label: "Reports" },
  // Quality
  {
    key: "quality-group",
    label: "质量管理",
    type: "group" as const,
    children: [
      { key: "/qc",         icon: <SafetyCertificateOutlined />, label: "QC" },
      { key: "/documents",  icon: <BookOutlined />,              label: "Documents" },
      { key: "/training",   icon: <TeamOutlined />,              label: "Training" },
    ],
  },
  // Resources
  {
    key: "resource-group",
    label: "资源管理",
    type: "group" as const,
    children: [
      { key: "/instruments", icon: <ToolOutlined />,            label: "Instruments" },
      { key: "/reagents",    icon: <MedicineBoxOutlined />,     label: "Reagents" },
    ],
  },
  { key: "/bioinformatics", icon: <CloudServerOutlined />,     label: "Bioinformatics" },
  // Audit & Notifications
  { key: "/audit",          icon: <AuditOutlined />,              label: "Audit Log" },
  { key: "/notifications",  icon: <BellOutlined />,               label: "Notifications" },
];

interface Props {
  children: ReactNode;
  header?: ReactNode;
}

export default function DashboardLayout({ children, header }: Props) {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { token } = antdTheme.useToken();

  const userMenuItems = [
    {
      key: "profile", icon: <UserOutlined />,
      label: user ? `${user.first_name} ${user.last_name}` : "",
      disabled: false as const,
    },
    { type: "divider" as const },
    { key: "settings", icon: <SettingOutlined />, label: "Settings" },
    { key: "logout", icon: <LogoutOutlined />, label: "Sign Out", danger: true },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* ── Sider ──────────────────────────────────────────── */}
      <Sider
        collapsible collapsed={collapsed}
        onCollapse={setCollapsed} theme="light"
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
        trigger={null}
      >
        {/* Logo area */}
        <div style={{
          height: 64, display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          padding: "0 16px",
        }}>
          <Text strong style={{ fontSize: collapsed ? 18 : 20, color: token.colorPrimary }}>
            {collapsed ? "LIMS" : "NGS LIMS"}
          </Text>
        </div>

        {/* Navigation */}
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={MENU_ITEMS.map((item) => {
            // Group headers: recurse into children, don't link the header itself
            if (item.type === "group") {
              return {
                ...item,
                children: item.children?.map((child) => ({
                  ...child,
                  label: <Link to={child.key} style={{ display: "inline" }}>{child.label}</Link>,
                })),
              };
            }
            return {
              ...item,
              label: <Link to={item.key} style={{ display: "inline" }}>{item.label}</Link>,
            };
          })}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>

      {/* ── Right side ─────────────────────────────────────── */}
      <Layout>
        {/* Header bar */}
        <Header style={{
          padding: "0 24px",
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <Space size="middle">
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
              aria-label="Toggle sidebar"
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            {header ? (
              typeof header === "string" ? <Text strong style={{ fontSize: 16 }}>{header}</Text> : header
            ) : null}
          </Space>

          <Space size="middle">
            {user && (
              <Dropdown menu={{
                items: [
                  { key: 'en', label: '🇬🇧 English' },
                  { key: 'zh', label: '🇨🇳 中文' },
                  { key: 'pt', label: '🇧🇷 Português' },
                ],
                selectedKeys: [user.locale || 'en'],
                onClick: ({ key }) => {
                  useAuthStore.getState().updateLocale(key);
                },
              }} trigger={['click']}>
                <Badge size="small" status="processing" text={user.locale?.toUpperCase()} style={{ cursor: 'pointer' }} />
              </Dropdown>
            )}
            <Dropdown menu={{ items: userMenuItems, onClick: (e) => {
              if (e.key === "logout") logout();
            }}} trigger={["click"]}>
              <Space style={{ cursor: "pointer" }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
                <Text>{user?.first_name}</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* Content */}
        <Content style={{
          margin: 24, padding: 24,
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          minHeight: 280,
        }}>
          {children}
        </Content>

        {/* Footer */}
        <Footer style={{ textAlign: "center", color: token.colorTextDescription }}>
          NGS LIMS &copy; {new Date().getFullYear()}
        </Footer>
      </Layout>
    </Layout>
  );
}
