import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Button, Card, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Switch,
  Tag, Tooltip, Typography, message,
} from "antd";
import {
  DeleteOutlined, LockFilled, PlusOutlined, ReloadOutlined,
  SafetyCertificateOutlined, SaveOutlined, TeamOutlined, UndoOutlined,
} from "@ant-design/icons";

import userManagementApi, {
  ModuleCatalog, Role, RoleModulePerm,
} from "../../api/userManagement";

const { Paragraph } = Typography;

type PermMap = Record<string, RoleModulePerm>;

const GROUP_COLOR: Record<string, string> = {
  NIPT: "#1677ff", NIPPT: "#722ed1", HPV: "#eb2f96",
  质量管理: "#fa8c16", 资源管理: "#13c2c2", 平台: "#595959",
};

const emptyPerm = (): RoleModulePerm => ({ view: false, edit: false });

export default function RolePermission() {
  const [catalog, setCatalog] = useState<ModuleCatalog | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermMap>({});          // 当前编辑中的权限
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [dirty, setDirty] = useState(false);

  // 新建角色
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTemplate, setNewTemplate] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => roles.find((r) => r.id === selectedId) ?? null,
    [roles, selectedId]
  );

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await userManagementApi.roles.catalog();
      setCatalog(data);
    } catch {
      message.error("加载模块清单失败");
    }
  }, []);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await userManagementApi.roles.list();
      setRoles(data.results ?? []);
      setAdminNote(data.admin_note ?? "");
      // 首次自动选中第一个
      setSelectedId((cur) => cur ?? (data.results?.[0]?.id ?? null));
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载角色失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); loadRoles(); }, [loadCatalog, loadRoles]);

  // 选中角色变化 → 重置草稿
  useEffect(() => {
    if (!selected) { setDraft({}); setDraftName(""); setDraftDesc(""); setDirty(false); return; }
    setDraft(JSON.parse(JSON.stringify(selected.permissions || {})));
    setDraftName(selected.name);
    setDraftDesc(selected.description || "");
    setDirty(false);
  }, [selected]);

  const toggle = (moduleKey: string, action: "view" | "edit", val: boolean) => {
    setDraft((prev) => {
      const next = { ...prev };
      const cur = { ...(next[moduleKey] || emptyPerm()) };
      if (action === "view" && !val) {
        // 取消查看 → 编辑也必须取消
        cur.view = false; cur.edit = false;
      } else if (action === "edit" && val) {
        // 勾选编辑 → 自动勾选查看
        cur.edit = true; cur.view = true;
      } else {
        cur[action] = val;
      }
      if (!cur.view && !cur.edit) delete next[moduleKey];
      else next[moduleKey] = cur;
      return next;
    });
    setDirty(true);
  };

  const setGroupAll = (group: string, action: "view" | "edit", val: boolean) => {
    if (!catalog) return;
    setDraft((prev) => {
      const next = { ...prev };
      catalog.modules.filter((m) => m.group === group).forEach((m) => {
        const cur = { ...(next[m.key] || emptyPerm()) };
        if (action === "view") {
          cur.view = val;
          if (!val) cur.edit = false;
          if (val) { /* 只看不改 */ }
        } else {
          cur.edit = val;
          if (val) cur.view = true;
        }
        if (!cur.view && !cur.edit) delete next[m.key];
        else next[m.key] = cur;
      });
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { permissions: draft };
      // 系统角色的名称不可改，只提交描述与权限
      if (!selected.is_system) {
        payload.name = draftName.trim();
        payload.description = draftDesc;
      } else {
        payload.description = draftDesc;
      }
      await userManagementApi.roles.update(selected.id, payload);
      message.success(`角色「${selected.name}」的权限已保存`);
      setDirty(false);
      loadRoles();
    } catch (e: any) {
      const d = e?.response?.data;
      let msg = "保存失败";
      if (d?.name) msg = Array.isArray(d.name) ? d.name[0] : d.name;
      else if (d?.error) msg = d.error;
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!selected) return;
    setDraft(JSON.parse(JSON.stringify(selected.permissions || {})));
    setDirty(false);
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) { message.warning("请填写角色名"); return; }
    setCreating(true);
    try {
      const perms = newTemplate && catalog
        ? JSON.parse(JSON.stringify(catalog.templates[newTemplate]?.permissions || {}))
        : {};
      const { data } = await userManagementApi.roles.create({
        name, description: newDesc.trim(), permissions: perms,
      });
      message.success(`角色「${data.name}」已创建`);
      setCreateOpen(false); setNewName(""); setNewDesc(""); setNewTemplate(undefined);
      await loadRoles();
      setSelectedId(data.id);
    } catch (e: any) {
      const d = e?.response?.data;
      let msg = "创建失败";
      if (d?.name) msg = Array.isArray(d.name) ? d.name[0] : d.name;
      else if (d?.error) msg = d.error;
      message.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async (role: Role) => {
    try {
      await userManagementApi.roles.remove(role.id);
      message.success(`角色「${role.name}」已删除`);
      if (selectedId === role.id) setSelectedId(null);
      loadRoles();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "删除失败");
    }
  };

  // 按分组组织模块
  const groups = useMemo(() => {
    if (!catalog) return [];
    const order: string[] = [];
    const map: Record<string, typeof catalog.modules> = {};
    catalog.modules.forEach((m) => {
      if (!map[m.group]) { map[m.group] = []; order.push(m.group); }
      map[m.group].push(m);
    });
    return order.map((g) => ({ group: g, modules: map[g] }));
  }, [catalog]);

  const grantedCount = (role: Role) => Object.keys(role.permissions || {}).length;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {/* ── 左栏：角色列表 ─────────────────────────────── */}
      <Card
        title={<span><TeamOutlined /> 角色（{roles.length}）</span>}
        size="small"
        style={{ width: 300, flexShrink: 0 }}
        bodyStyle={{ padding: 8, maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}
        extra={
          <Tooltip title="刷新">
            <Button size="small" type="text" icon={<ReloadOutlined />}
              onClick={loadRoles} loading={loading} />
          </Tooltip>
        }
      >
        <Button
          type="primary" block icon={<PlusOutlined />}
          style={{
            marginBottom: 8, fontWeight: 600,
            background: "linear-gradient(135deg,#1677ff,#003eb3)",
            border: "1px solid #003eb3",
          }}
          onClick={() => { setCreateOpen(true); setNewName(""); setNewDesc(""); setNewTemplate(undefined); }}
        >新建角色</Button>

        <Spin spinning={loading}>
          {roles.length === 0 && !loading && <Empty description="暂无角色" />}
          {roles.map((r) => {
            const active = r.id === selectedId;
            return (
              <div
                key={r.id}
                onClick={() => {
                  if (dirty && !window.confirm("当前权限未保存，确定切换角色吗？")) return;
                  setSelectedId(r.id);
                }}
                style={{
                  padding: "8px 10px", marginBottom: 6, borderRadius: 6, cursor: "pointer",
                  border: active ? "1px solid #1677ff" : "1px solid #f0f0f0",
                  background: active ? "linear-gradient(135deg,#e6f4ff,#bae0ff)" : "#fff",
                  transition: "all .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontWeight: 600, flex: 1, minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.name}</span>
                  {r.is_system && (
                    <Tooltip title="系统内置角色：不可改名、不可删除，但可以调整权限">
                      <LockFilled style={{ color: "#8c8c8c", fontSize: 12 }} />
                    </Tooltip>
                  )}
                </div>
                <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Tag color={grantedCount(r) ? "blue" : "default"}
                    style={{ margin: 0, fontSize: 11, lineHeight: "16px" }}>
                    {grantedCount(r)} 模块
                  </Tag>
                  <Tag color={r.user_count ? "green" : "default"}
                    style={{ margin: 0, fontSize: 11, lineHeight: "16px" }}>
                    {r.user_count} 人
                  </Tag>
                </div>
              </div>
            );
          })}
        </Spin>
      </Card>

      {/* ── 右栏：权限矩阵 ─────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {adminNote && (
          <Alert
            type="info" showIcon icon={<SafetyCertificateOutlined />}
            style={{ marginBottom: 10 }} message={adminNote}
          />
        )}

        {!selected ? (
          <Card><Empty description="请从左侧选择一个角色" /></Card>
        ) : (
          <Card
            size="small"
            title={
              <span>
                {selected.name}
                {selected.is_system && <Tag color="default" style={{ marginLeft: 8 }}>系统内置</Tag>}
              </span>
            }
            extra={
              <Space>
                {dirty && <Tag color="orange">未保存</Tag>}
                <Button icon={<UndoOutlined />} size="small" disabled={!dirty} onClick={reset}>
                  还原
                </Button>
                <Button
                  type="primary" icon={<SaveOutlined />} size="small"
                  loading={saving} disabled={!dirty} onClick={save}
                  style={{
                    fontWeight: 600,
                    background: dirty ? "linear-gradient(135deg,#52c41a,#237804)" : undefined,
                    border: dirty ? "1px solid #237804" : undefined,
                  }}
                >保存权限</Button>
                {!selected.is_system && (
                  <Popconfirm
                    title={`删除角色「${selected.name}」？`}
                    description={selected.user_count > 0
                      ? `该角色下还有 ${selected.user_count} 个用户，需先移除分配。`
                      : "删除后不可恢复。"}
                    okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                    onConfirm={() => doDelete(selected)}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />}
                      disabled={selected.user_count > 0}>删除</Button>
                  </Popconfirm>
                )}
              </Space>
            }
          >
            {/* 基本信息 */}
            <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>
                  角色名 {selected.is_system && <Tooltip title="系统内置角色名不可修改"><LockFilled /></Tooltip>}
                </div>
                <Input
                  value={draftName} disabled={selected.is_system}
                  onChange={(e) => { setDraftName(e.target.value); setDirty(true); }}
                  maxLength={50}
                />
              </div>
              <div style={{ flex: 2, minWidth: 260 }}>
                <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>说明</div>
                <Input
                  value={draftDesc} placeholder="这个角色是做什么的"
                  onChange={(e) => { setDraftDesc(e.target.value); setDirty(true); }}
                  maxLength={200}
                />
              </div>
            </div>

            {/* 权限矩阵 */}
            <div style={{
              border: "1px solid #f0f0f0", borderRadius: 6,
              maxHeight: "calc(100vh - 460px)", overflowY: "auto",
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, zIndex: 2, background: "#fafafa" }}>
                    <th style={thStyle(true)}>模块</th>
                    <th style={thStyle(false, 90)}>查看</th>
                    <th style={thStyle(false, 90)}>编辑</th>
                    <th style={thStyle(false, 150)}>整组</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ group, modules: mods }) => {
                    const allView = mods.every((m) => draft[m.key]?.view);
                    const allEdit = mods.every((m) => draft[m.key]?.edit);
                    return (
                      <>
                        <tr key={`g-${group}`}>
                          <td colSpan={4} style={{
                            padding: "6px 12px", background: "#fafafa",
                            borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0",
                          }}>
                            <span style={{
                              fontWeight: 700,
                              color: GROUP_COLOR[group] ?? "#262626",
                            }}>{group}</span>
                          </td>
                        </tr>
                        {mods.map((m) => {
                          const p = draft[m.key] || emptyPerm();
                          return (
                            <tr key={m.key} style={{ borderBottom: "1px solid #f5f5f5" }}>
                              <td style={{ padding: "6px 12px 6px 24px" }}>{m.label}</td>
                              <td style={tdCenter}>
                                <Switch size="small" checked={p.view}
                                  onChange={(v) => toggle(m.key, "view", v)} />
                              </td>
                              <td style={tdCenter}>
                                <Switch size="small" checked={p.edit}
                                  onChange={(v) => toggle(m.key, "edit", v)} />
                              </td>
                              <td style={tdCenter}>
                                <Space size={4}>
                                  <Tooltip title="整组设为只看">
                                    <Button size="small" type="text"
                                      style={{ fontSize: 11, color: "#8c8c8c" }}
                                      disabled={allView && mods.every((x) => !draft[x.key]?.edit)}
                                      onClick={() => setGroupAll(group, "view", true)}>仅查看</Button>
                                  </Tooltip>
                                  <Tooltip title="整组可编辑">
                                    <Button size="small" type="text"
                                      style={{ fontSize: 11, color: "#389e0d" }}
                                      disabled={allEdit}
                                      onClick={() => setGroupAll(group, "edit", true)}>可编辑</Button>
                                  </Tooltip>
                                  <Tooltip title="整组取消">
                                    <Button size="small" type="text" danger
                                      style={{ fontSize: 11 }}
                                      disabled={!allView && !allEdit}
                                      onClick={() => { setGroupAll(group, "view", false); }}>清空</Button>
                                  </Tooltip>
                                </Space>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
              规则：勾选<b>编辑</b>会自动勾选<b>查看</b>；取消<b>查看</b>会同时取消<b>编辑</b>。
              未勾选的模块视为无权限（默认拒绝）。
            </Paragraph>
          </Card>
        )}
      </div>

      {/* ── 新建角色 ─────────────────────────────────── */}
      <Modal
        open={createOpen}
        title="新建角色"
        onCancel={() => setCreateOpen(false)}
        onOk={doCreate}
        okText="创建" cancelText="取消"
        confirmLoading={creating}
        width={560}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>角色名 *</div>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="如：销售 / 报告审核员" maxLength={50} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>说明</div>
          <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="这个角色能做什么" maxLength={200} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>
            从模板开始（可选，创建后仍可逐项调整）
          </div>
          <Select
            allowClear style={{ width: "100%" }}
            placeholder="不使用模板（权限全空）"
            value={newTemplate} onChange={setNewTemplate}
            options={catalog
              ? Object.entries(catalog.templates).map(([k, t]) => ({
                  value: k,
                  label: `${t.label} — ${t.description}`,
                }))
              : []}
          />
        </div>
      </Modal>
    </div>
  );
}

const thStyle = (left: boolean, w?: number): React.CSSProperties => ({
  textAlign: left ? "left" : "center",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  color: "#595959",
  borderBottom: "1px solid #f0f0f0",
  width: w,
});

const tdCenter: React.CSSProperties = { padding: "4px 8px", textAlign: "center" };
