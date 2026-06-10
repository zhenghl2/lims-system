import type { ReactNode } from "react";

import { useState, useMemo } from "react";

import { Link, useLocation } from "react-router-dom";

import { Layout, Menu, Typography, Avatar, Dropdown, Space, theme as antdTheme, Badge } from "antd";

import {

  DashboardOutlined, BarcodeOutlined,

  ExperimentOutlined, FileTextOutlined, SafetyCertificateOutlined,

  ToolOutlined, MedicineBoxOutlined, BookOutlined,

  TeamOutlined, CloudServerOutlined, AuditOutlined,

  BellOutlined, InboxOutlined,

  MenuFoldOutlined, MenuUnfoldOutlined,

  UserOutlined, LogoutOutlined, SettingOutlined,

} from "@ant-design/icons";

import { useAuthStore } from "../store/auth";

import { useTranslation } from "../i18n/useTranslation";

const { Sider, Header, Content, Footer } = Layout;

const { Text } = Typography;



interface Props {

  children: ReactNode;

  header?: ReactNode;

}



export default function DashboardLayout({ children, header }: Props) {

  const { user, logout } = useAuthStore();

  const { t } = useTranslation();

  const [collapsed, setCollapsed] = useState(false);

  const location = useLocation();

  const { token } = antdTheme.useToken();



  // ── Sidebar menu items (i18n) ─────────────────────────────────

  const menuItems = useMemo(() => [

    { key: "/",              icon: <DashboardOutlined />,       label: t("nav.dashboard") },

    { key: "/samples",       icon: <BarcodeOutlined />,         label: t("nav.samples") },

    { key: "/receiving",    icon: <InboxOutlined />,           label: "Receiving" },

    { key: "/workflow",      icon: <ExperimentOutlined />,      label: t("nav.workflow") },

    { key: "/reports",       icon: <FileTextOutlined />,        label: t("nav.reports") },
    {
      key: "nipt-group",
      label: "NIPT",
      type: "group" as const,
      children: [
        { key: "/dashboard-nipt", icon: <DashboardOutlined />,     label: "NIPT Dashboard" },
        { key: "/reports-nipt",   icon: <FileTextOutlined />,      label: "NIPT Reports" },
      ],
    },
    {
      key: "quality-group",

      label: t("nav.qualityManagement"),

      type: "group" as const,

      children: [

        { key: "/qc",         icon: <SafetyCertificateOutlined />, label: t("nav.qc") },

        { key: "/documents",  icon: <BookOutlined />,              label: t("nav.documents") },

        { key: "/training",   icon: <TeamOutlined />,              label: t("nav.training") },

      ],

    },

    {

      key: "resource-group",

      label: t("nav.resourceManagement"),

      type: "group" as const,

      children: [

        { key: "/instruments", icon: <ToolOutlined />,            label: t("nav.instruments") },

        { key: "/reagents",    icon: <MedicineBoxOutlined />,     label: t("nav.reagents") },

      ],

    },

    { key: "/bioinformatics", icon: <CloudServerOutlined />,     label: t("nav.bioinformatics") },

    { key: "/audit",          icon: <AuditOutlined />,           label: t("nav.auditLog") },

    { key: "/notifications",  icon: <BellOutlined />,            label: t("nav.notifications") },

  ], [t]);



  const userMenuItems = [

    {

      key: "profile", icon: <UserOutlined />,

      label: user ? `${user.first_name} ${user.last_name}` : "",

      disabled: false as const,

    },

    { type: "divider" as const },

    { key: "settings", icon: <SettingOutlined />, label: t("nav.settings") },

    { key: "logout", icon: <LogoutOutlined />, label: t("nav.signOut"), danger: true },

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

            {collapsed ? "LIMS" : t("app.title")}


          </Text>

        </div>



        {/* Navigation */}

        <Menu

          mode="inline"

          selectedKeys={[location.pathname]}

          items={menuItems.map((item) => {

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

              aria-label={t("nav.toggleSidebar")}

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


                  { key: 'en', label: 'ð¬ð§ English' },

                  { key: 'zh', label: 'ð¨ð³ 中文' },

                  { key: 'pt', label: 'ð§ð· Português' },

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

          {t("app.title")} &copy; {new Date().getFullYear()}

        </Footer>

      </Layout>

    </Layout>

  );

}