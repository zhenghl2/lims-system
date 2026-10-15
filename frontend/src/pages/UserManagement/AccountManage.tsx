import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Card, Descriptions, Divider, Drawer, Empty, Form, Input,
  Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, message,
} from "antd";
import {
  CopyOutlined, KeyOutlined, LockOutlined, ReloadOutlined, SaveOutlined,
  SearchOutlined, SettingOutlined, UnlockOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import userManagementApi, { ManagedUser, UserManageStats } from "../../api/userManagement";

const { Text, Paragraph } = Typography;

const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const EllipsisCell = ({ text, width }: { text?: string; width?: number }) => {
  const v = (text ?? "").trim();
  if (!v) return <span style={{ color: "#bbb" }}>—</span>;
  return (
    <Tooltip title={v} placement="topLeft">
      <span style={{
        display: "inline-block", maxWidth: width ?? 150,
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", verticalAlign: "bottom",
      }}>{v}</span>
    </Tooltip>
  );
};

const SOURCE_COLOR: Record<string, string> = {
  sales_wechat: "purple",
  sales: "geekblue",
  manual: "default",
};

export default function AccountManage() {
  const [status, setStatus] = useState("");
  const [site, setSite] = useState("");
  const [role, setRole] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<UserManageStats>({
    total: 0, active: 0, inactive: 0, staff: 0, roles: [], sites: [],
  });
  const [loading, setLoading] = useState(false);

  // 抽屉
  const [drawerUser, setDrawerUser] = useState<ManagedUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [pwdResult, setPwdResult] = useState<null | {
    username: string; employee_id: string; password: string; notice: string;
  }>(null);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await userManagementApi.accounts.stats();
      setStats(data);
    } catch { /* 统计失败不阻塞列表 */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (status) params.status = status;
      if (site) params.site = site;
      if (role) params.role = role;
      if (keyword.trim()) params.search = keyword.trim();
      const { data } = await userManagementApi.accounts.list(params);
      setRows(data.results ?? []);
      setTotal(data.count ?? 0);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载账号列表失败");
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, site, role, keyword, page, pageSize]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadList(); }, [loadList]);

  const openDrawer = (u: ManagedUser) => {
    setDrawerUser(u);
    form.setFieldsValue({
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      phone: u.phone,
      site: u.site_id,
    });
  };

  const submitEdit = async () => {
    if (!drawerUser) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await userManagementApi.accounts.update(drawerUser.id, values);
      message.success("已保存");
      const { data } = await userManagementApi.accounts.detail(drawerUser.id);
      setDrawerUser(data);
      loadList();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验失败
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const doToggle = async (u: ManagedUser) => {
    try {
      const { data } = await userManagementApi.accounts.toggleActive(u.id);
      message.success(data.message);
      if (drawerUser?.id === u.id) {
        const { data: fresh } = await userManagementApi.accounts.detail(u.id);
        setDrawerUser(fresh);
      }
      loadList(); loadStats();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "操作失败");
    }
  };

  const doResetPwd = (u: ManagedUser) => {
    Modal.confirm({
      title: `重置「${u.full_name || u.username}」的密码？`,
      content: "将生成一个新的随机密码，旧密码立即失效。新密码只显示一次。",
      okText: "确认重置",
      cancelText: "取消",
      okButtonProps: {
        style: { background: "linear-gradient(135deg,#fa8c16,#d46b08)", borderColor: "#d46b08", color: "#fff" },
      },
      onOk: async () => {
        try {
          const { data } = await userManagementApi.accounts.resetPassword(u.id);
          setPwdResult({
            username: data.username, employee_id: data.employee_id,
            password: data.password, notice: data.password_notice,
          });
          // 命令式 confirm 在 async onOk 后不会可靠自销毁，会与下面的
          // "新密码"弹窗叠加；放到下一个事件循环显式销毁
          window.setTimeout(function () { Modal.destroyAll(); }, 0);
        } catch (e: any) {
          message.error(e?.response?.data?.error || "重置失败");
        }
      },
    });
  };

  const doUnlockMfa = async (u: ManagedUser) => {
    try {
      const { data } = await userManagementApi.accounts.unlockMfa(u.id);
      message.success(data.message);
      if (drawerUser?.id === u.id) {
        const { data: fresh } = await userManagementApi.accounts.detail(u.id);
        setDrawerUser(fresh);
      }
      loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "操作失败");
    }
  };

  const columns: ColumnsType<ManagedUser> = useMemo(() => [
    {
      title: "工号", dataIndex: "employee_id", width: 140, fixed: "left",
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "姓名", dataIndex: "full_name", width: 110,
      render: (v: string, r) => <EllipsisCell text={v || r.username} width={90} />,
    },
    { title: "账号", dataIndex: "username", width: 120 },
    {
      title: "站点", dataIndex: "site_code", width: 90,
      render: (v: string | null) => v
        ? <Tag color="blue" style={{ margin: 0 }}>{v}</Tag>
        : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "角色", dataIndex: "roles", width: 170,
      render: (_: unknown, r: ManagedUser) => {
        const names = (r.roles || []).map((x) => x.name);
        if (!names.length) return <span style={{ color: "#bbb" }}>—</span>;
        return (
          <Tooltip title={names.join(" / ")} placement="topLeft">
            <span style={{ display: "inline-block", maxWidth: 155, overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {names.map((n) => (
                <Tag key={n} style={{ margin: "0 4px 0 0" }}>{n}</Tag>
              ))}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "来源", dataIndex: "source", width: 120,
      render: (_: unknown, r: ManagedUser) => (
        <Tag color={SOURCE_COLOR[r.source?.type] ?? "default"} style={{ margin: 0 }}>
          {r.source?.label ?? "—"}
        </Tag>
      ),
    },
    {
      title: "状态", dataIndex: "is_active", width: 100,
      render: (_: unknown, r: ManagedUser) => (
        <Space size={4}>
          {r.is_active
            ? <Tag color="green" style={{ margin: 0 }}>在职</Tag>
            : <Tag color="default" style={{ margin: 0 }}>已停用</Tag>}
          {r.is_superuser && <Tag color="red" style={{ margin: 0 }}>超管</Tag>}
        </Space>
      ),
    },
    {
      title: "最近登录", dataIndex: "last_login", width: 120,
      render: (v: string | null) => <span style={{ whiteSpace: "nowrap" }}>{fmtTime(v)}</span>,
    },
    {
      title: "操作", key: "action", width: 80, fixed: "right",
      render: (_: unknown, r: ManagedUser) => (
        <Tooltip title="管理该账号">
          <Button size="small" icon={<SettingOutlined />} onClick={() => openDrawer(r)} />
        </Tooltip>
      ),
    },
  ], []);

  const tabBtn = (key: string, label: string, count: number) => {
    const active = status === key;
    return (
      <Button
        key={key}
        type={active ? "primary" : "default"}
        style={active
          ? { background: "linear-gradient(135deg,#1677ff,#003eb3)", border: "1px solid #003eb3", fontWeight: 600 }
          : { border: "1px solid #d9d9d9", fontWeight: 500 }}
        onClick={() => { setStatus(key); setPage(1); }}
      >
        {label}
        <Badge count={count} overflowCount={999} showZero={false}
          style={{ marginLeft: 6, backgroundColor: active ? "#fff" : "#8c8c8c",
                   color: active ? "#1677ff" : "#fff", boxShadow: "none" }} />
      </Button>
    );
  };

  // 筛选用 code（后端 ?site=<code>）；表单用 UUID（PATCH site=<id>）
  const siteFilterOptions = useMemo(
    () => (stats.sites || []).map((s) => ({ value: s.code, label: s.code })),
    [stats.sites]
  );
  const siteIdOptions = useMemo(
    () => (stats.sites || []).map((s) => ({ value: s.id, label: s.code })),
    [stats.sites]
  );

  const roleOptions = useMemo(
    () => (stats.roles || []).map((r) => ({ value: r.name, label: `${r.name} (${r.count})` })),
    [stats.roles]
  );

  return (
    <div style={{ padding: 0 }}>
      {/* 顶部：状态 Tab + 站点/角色筛选 + 搜索（同类元素一行排满） */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 340 }}>
          {tabBtn("",         "全部",   stats.total)}
          {tabBtn("active",   "在职",   stats.active)}
          {tabBtn("inactive", "已停用", stats.inactive)}
          {tabBtn("staff",    "管理员", stats.staff)}
        </div>
        <Select allowClear placeholder="站点" style={{ width: 120 }}
          value={site || undefined} options={siteFilterOptions}
          onChange={(v) => { setSite(v || ""); setPage(1); }} />
        <Select allowClear placeholder="角色" style={{ width: 160 }}
          value={role || undefined} options={roleOptions}
          onChange={(v) => { setRole(v || ""); setPage(1); }} />
        <Input allowClear prefix={<SearchOutlined />}
          placeholder="搜索姓名 / 工号 / 账号 / 手机 / 邮箱"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          style={{ width: 280 }} />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} onClick={() => { loadList(); loadStats(); }} loading={loading} />
        </Tooltip>
      </div>

      <Card bodyStyle={{ padding: 0 }} bordered>
        <Table<ManagedUser>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1250, y: "calc(100vh - 330px)" }}
          sticky
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            pageSizeOptions: ["20", "50", "100"],
            showTotal: (t) => `共 ${t} 个账号`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            style: { marginRight: 12, marginBottom: 8 },
          }}
          locale={{ emptyText: <Empty description="没有匹配的账号" /> }}
        />
      </Card>

      {/* 账号管理抽屉 */}
      <Drawer
        open={!!drawerUser}
        width={560}
        onClose={() => setDrawerUser(null)}
        title={drawerUser ? `账号管理 — ${drawerUser.full_name || drawerUser.username}` : ""}
        extra={drawerUser && (
          <Button
            type="primary" icon={<SaveOutlined />} loading={saving}
            style={{ background: "linear-gradient(135deg,#1677ff,#003eb3)", borderColor: "#003eb3" }}
            onClick={submitEdit}
          >保存修改</Button>
        )}
      >
        {drawerUser && (
          <>
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="账号">
                <Text strong copyable>{drawerUser.username}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="工号">
                <Text code>{drawerUser.employee_id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Space size={4}>
                  {drawerUser.is_active
                    ? <Tag color="green">在职</Tag>
                    : <Tag>已停用</Tag>}
                  {drawerUser.is_superuser && <Tag color="red">超级管理员</Tag>}
                  {drawerUser.mfa_enabled && <Tag color="blue">MFA 已启用</Tag>}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                <Tag color={SOURCE_COLOR[drawerUser.source?.type] ?? "default"}>
                  {drawerUser.source?.label}
                </Tag>
                {drawerUser.source?.application_code && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {drawerUser.source.application_code}
                  </Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="最近登录">{fmtTime(drawerUser.last_login)}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" style={{ margin: "8px 0 12px" }}>基本信息</Divider>
            <Form form={form} layout="vertical" size="small">
              <Form.Item name="first_name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}>
                <Input placeholder="姓名" />
              </Form.Item>
              <Form.Item name="last_name" label="姓氏（可选）">
                <Input placeholder="姓氏" />
              </Form.Item>
              <Form.Item name="email" label="邮箱"
                rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
                <Input placeholder="邮箱" />
              </Form.Item>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="手机号" />
              </Form.Item>
              <Form.Item name="site" label="所属站点">
                <Select allowClear placeholder="未指定"
                  options={siteIdOptions}
                  onChange={(v) => form.setFieldValue("site", v)} />
              </Form.Item>
            </Form>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
              账号（登录名）、工号、超管权限不可通过此页面修改 —— 这三项涉及登录与权限边界，需走专门流程。
            </Paragraph>

            <Divider orientation="left" style={{ margin: "8px 0 12px" }}>角色</Divider>
            {drawerUser.roles?.length ? (
              drawerUser.roles.map((r) => (
                <div key={r.assignment_id} style={{ marginBottom: 6 }}>
                  <Tag color="geekblue">{r.name}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.site || "全局"}
                    {r.expires_at ? ` · 至 ${fmtTime(r.expires_at)}` : ""}
                  </Text>
                </div>
              ))
            ) : (
              <Text type="secondary">该账号暂无角色分配</Text>
            )}
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              角色的分配与调整在「角色权限」页（阶段 3）实现。
            </Paragraph>

            <Divider orientation="left" style={{ margin: "8px 0 12px" }}>账号操作</Divider>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Button block icon={<KeyOutlined />}
                style={{ border: "1px solid #fa8c16", color: "#d46b08", fontWeight: 600 }}
                onClick={() => doResetPwd(drawerUser)}>
                重置密码（生成新密码，一次性显示）
              </Button>

              {drawerUser.mfa_enabled && (
                <Button block icon={<UnlockOutlined />}
                  style={{ border: "1px solid #1677ff", color: "#0958d9", fontWeight: 600 }}
                  onClick={() => doUnlockMfa(drawerUser)}>
                  关闭两步验证（MFA）
                </Button>
              )}

              <Popconfirm
                title={drawerUser.is_active ? "确认停用该账号？" : "确认启用该账号？"}
                description={drawerUser.is_active
                  ? "停用后该用户将无法登录系统（历史数据与审计保留）"
                  : "启用后该用户可以正常登录"}
                okText="确认" cancelText="取消"
                onConfirm={() => doToggle(drawerUser)}
              >
                <Button block danger={drawerUser.is_active}
                  icon={<LockOutlined />}
                  style={drawerUser.is_active
                    ? { border: "1px solid #ff4d4f", color: "#cf1322", fontWeight: 600 }
                    : { border: "1px solid #52c41a", color: "#389e0d", fontWeight: 600 }}>
                  {drawerUser.is_active ? "停用账号" : "启用账号"}
                </Button>
              </Popconfirm>
            </Space>
            <div style={{ height: 24 }} />
          </>
        )}
      </Drawer>

      {/* 一次性密码弹窗 */}
      <Modal
        open={!!pwdResult}
        title="🔑 密码已重置"
        onCancel={() => setPwdResult(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setPwdResult(null)}>我已保存</Button>,
        ]}
        width={520}
      >
        {pwdResult && (
          <div>
            <div style={{ marginBottom: 12, lineHeight: 2 }}>
              <div>账号：<Text strong copyable>{pwdResult.username}</Text></div>
              <div>工号：<Text code>{pwdResult.employee_id}</Text></div>
            </div>
            <div style={{
              background: "linear-gradient(135deg,#fff7e6,#ffe7ba)",
              border: "1px solid #ffd591", borderRadius: 8, padding: 16, textAlign: "center",
            }}>
              <div style={{ fontSize: 12, color: "#d46b08", marginBottom: 6 }}>新密码</div>
              <div style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 24, fontWeight: 700, letterSpacing: 1, color: "#874d00",
              }}>{pwdResult.password}</div>
              <Button icon={<CopyOutlined />} size="small" style={{ marginTop: 10 }}
                onClick={() => {
                  navigator.clipboard?.writeText(pwdResult.password)
                    .then(() => message.success("密码已复制"))
                    .catch(() => message.warning("复制失败，请手动选择复制"));
                }}>复制密码</Button>
            </div>
            <Paragraph type="warning" style={{ marginTop: 12, marginBottom: 0 }}>
              {pwdResult.notice}
            </Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
}
