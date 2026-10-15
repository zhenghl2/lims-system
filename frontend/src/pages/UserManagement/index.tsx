import { useState } from "react";
import { Tabs, Typography } from "antd";
import { UserAddOutlined, TeamOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

import AccountApproval from "./AccountApproval";
import AccountManage from "./AccountManage";
import RolePermission from "./RolePermission";

const { Title, Text } = Typography;

/**
 * 用户管理模块（挂在「系统设置」菜单下）
 *
 * 阶段1：账号审批（销售微信自助注册的申请队列）
 * 阶段2：账号管理（列表/详情/编辑/启停/重置密码/解锁 MFA）
 * 阶段3：角色权限（角色 × 子系统模块 × 查看/编辑）
 *
 * 三个 Tab 共享用户数据，是同一业务的三阶段（申请 → 建号 → 授权），
 * 因此合成一个模块，避免管理员在菜单间反复跳转。
 */
export default function UserManagement() {
  const [tab, setTab] = useState("approval");

  const items = [
    {
      key: "approval",
      label: (
        <span>
          <UserAddOutlined /> 账号审批
        </span>
      ),
      children: <AccountApproval />,
    },
    {
      key: "accounts",
      label: (
        <span>
          <TeamOutlined /> 账号管理
        </span>
      ),
      children: <AccountManage />,
    },
    {
      key: "roles",
      label: (
        <span>
          <SafetyCertificateOutlined /> 角色权限
        </span>
      ),
      children: <RolePermission />,
    },
  ];

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ marginBottom: 8 }}>
        <Title level={4} style={{ margin: 0 }}>用户管理</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          账号审批 · 账号管理 · 角色权限
        </Text>
      </div>
      <Tabs activeKey={tab} onChange={setTab} items={items} destroyInactiveTabPane />
    </div>
  );
}
