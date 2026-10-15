import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Card, Empty, Input, Modal, Radio, Space, Table, Tag,
  Tooltip, Typography, message,
} from "antd";
import {
  CheckCircleFilled, CloseCircleFilled, CopyOutlined, LinkOutlined,
  ReloadOutlined, SearchOutlined, UserAddOutlined, EyeOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import userManagementApi, {
  SalesApplication, SalesApplicationStats, SalesApplicationStatus,
} from "../../api/userManagement";

const { Text, Paragraph } = Typography;

const STATUS_TAG: Record<SalesApplicationStatus, { color: string; text: string }> = {
  pending:  { color: "gold",   text: "待审核" },
  approved: { color: "green",  text: "已通过" },
  rejected: { color: "red",    text: "已拒绝" },
};

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
        display: "inline-block", maxWidth: width ?? 160,
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", verticalAlign: "bottom",
      }}>{v}</span>
    </Tooltip>
  );
};

export default function AccountApproval() {
  const [status, setStatus] = useState<string>("pending");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [rows, setRows] = useState<SalesApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SalesApplicationStats>({
    pending: 0, approved: 0, rejected: 0, all: 0,
  });
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  // 通过审核：受控弹窗（可显式关闭，避免命令式 confirm 残留）
  const [approveTarget, setApproveTarget] = useState<SalesApplication | null>(null);
  const [linkToMatched, setLinkToMatched] = useState(true);  // true=关联已有账号
  const [pwdResult, setPwdResult] = useState<null | {
    code: string; username: string; employee_id: string; password: string; notice: string;
    mode: "linked" | "created"; message?: string;
  }>(null);

  // 拒绝
  const [rejectTarget, setRejectTarget] = useState<SalesApplication | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const { data } = await userManagementApi.applications.stats();
      setStats(data);
    } catch { /* 统计失败不阻塞列表 */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (status) params.status = status;
      if (keyword.trim()) params.search = keyword.trim();
      const { data } = await userManagementApi.applications.list(params);
      setRows(data.results ?? []);
      setTotal(data.count ?? 0);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载申请列表失败");
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [status, keyword, page, pageSize]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadList(); }, [loadList]);

  const openApprove = (row: SalesApplication) => {
    setApproveTarget(row);
    // 有同名账号且该账号尚未绑微信 → 默认"关联"；否则默认"新建"
    setLinkToMatched(!!row.matched_user_id && !row.matched_user_has_wechat);
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    setActing(true);
    try {
      const { data } = await userManagementApi.applications.approve(
        approveTarget.id, linkToMatched
      );
      setPwdResult({
        code: data.code,
        username: data.username,
        employee_id: data.employee_id,
        password: data.password ?? "",
        notice: data.password_notice ?? "",
        mode: (data.mode as "linked" | "created") ?? "created",
        message: data.message,
      });
      setApproveTarget(null);
      message.success(
        (data.mode === "linked")
          ? `已关联到既有账号 ${data.username}`
          : "已通过审核，账号已创建"
      );
      loadList(); loadStats();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "审核失败");
    } finally {
      setActing(false);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 2) { message.warning("请填写拒绝原因（至少 2 个字）"); return; }
    setActing(true);
    try {
      await userManagementApi.applications.reject(rejectTarget.id, reason);
      message.success("已拒绝该申请，申请人可立即重新提交");
      setRejectTarget(null); setRejectReason("");
      loadList(); loadStats();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "拒绝失败");
    } finally {
      setActing(false);
    }
  };

  const columns: ColumnsType<SalesApplication> = useMemo(() => [
    {
      title: "申请编号", dataIndex: "code", width: 150, fixed: "left",
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "姓名", dataIndex: "real_name", width: 150,
      render: (v: string, r: SalesApplication) => (
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <EllipsisCell text={v} width={r.matched_user_id ? 68 : 100} />
          {r.matched_user_id && (
            <Tooltip title={r.matched_note || "与已有账号同名"} placement="topLeft">
              <Tag
                color={r.matched_user_has_wechat ? "default" : "orange"}
                icon={<LinkOutlined />}
                style={{ margin: "0 0 0 4px", fontSize: 11, lineHeight: "16px" }}
              >
                {r.matched_user_has_wechat ? "已绑" : "可关联"}
              </Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    { title: "手机号", dataIndex: "phone", width: 130 },
    {
      title: "申请时间", dataIndex: "created_at", width: 120,
      render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{fmtTime(v)}</span>,
    },
    {
      title: "状态", dataIndex: "status", width: 100,
      render: (v: SalesApplicationStatus) => {
        const t = STATUS_TAG[v] ?? { color: "default", text: v };
        return <Tag color={t.color} style={{ margin: 0 }}>{t.text}</Tag>;
      },
    },
    {
      title: "审核人", dataIndex: "reviewer_name", width: 110,
      render: (v: string) => <EllipsisCell text={v} width={90} />,
    },
    {
      title: "审核时间", dataIndex: "reviewed_at", width: 120,
      render: (v: string | null) => <span style={{ whiteSpace: "nowrap" }}>{fmtTime(v)}</span>,
    },
    {
      title: "拒绝原因", dataIndex: "reject_reason", width: 160,
      render: (v: string) => <EllipsisCell text={v} width={140} />,
    },
    {
      title: "操作", key: "action", width: 150, fixed: "right",
      render: (_: unknown, row: SalesApplication) => {
        if (row.status !== "pending") {
          return (
            <Tooltip title="该申请已完成审核">
              <Button size="small" type="text" icon={<EyeOutlined />} disabled>已处理</Button>
            </Tooltip>
          );
        }
        return (
          <Space size={6}>
            <Button
              size="small" icon={<CheckCircleFilled />}
              style={{
                background: "linear-gradient(135deg,#52c41a,#237804)",
                border: "1px solid #237804", color: "#fff", fontWeight: 600,
              }}
              onClick={() => openApprove(row)}
            >通过</Button>
            <Button
              size="small" danger icon={<CloseCircleFilled />}
              style={{
                background: "linear-gradient(135deg,#fff1f0,#ffccc7)",
                border: "1px solid #ff4d4f", color: "#cf1322", fontWeight: 600,
              }}
              onClick={() => { setRejectTarget(row); setRejectReason(""); }}
            >拒绝</Button>
          </Space>
        );
      },
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
          style={{ marginLeft: 6, backgroundColor: active ? "#fff" : "#ff4d4f",
                   color: active ? "#1677ff" : "#fff", boxShadow: "none" }} />
      </Button>
    );
  };

  return (
    <div style={{ padding: 0 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 320 }}>
          {tabBtn("pending",  "待审核", stats.pending)}
          {tabBtn("approved", "已通过", stats.approved)}
          {tabBtn("rejected", "已拒绝", stats.rejected)}
          {tabBtn("",         "全部",   stats.all)}
        </div>
        <Input allowClear prefix={<SearchOutlined />}
          placeholder="搜索姓名 / 手机号 / 申请编号"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          style={{ width: 260 }} />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} onClick={() => { loadList(); loadStats(); }} loading={loading} />
        </Tooltip>
      </div>

      <Card bodyStyle={{ padding: 0 }} bordered>
        <Table<SalesApplication>
          rowKey="id" size="small" loading={loading}
          columns={columns} dataSource={rows}
          scroll={{ x: 1200, y: "calc(100vh - 330px)" }}
          sticky
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            pageSizeOptions: ["20", "50", "100"],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            style: { marginRight: 12, marginBottom: 8 },
          }}
          locale={{
            emptyText: <Empty description={status === "pending" ? "暂无待审核申请" : "暂无数据"} />,
          }}
        />
      </Card>

      {/* ── 通过审核（受控弹窗）────────────────────────────── */}
      <Modal
        open={!!approveTarget}
        title={`通过「${approveTarget?.real_name ?? ""}」的申请`}
        onCancel={() => setApproveTarget(null)}
        onOk={submitApprove}
        okText="确认通过"
        cancelText="取消"
        confirmLoading={acting}
        width={620}
        okButtonProps={{
          style: { background: "linear-gradient(135deg,#52c41a,#237804)", borderColor: "#237804", color: "#fff" },
        }}
      >
        {approveTarget && (
          <div>
            <div style={{ marginBottom: 12, lineHeight: 1.9 }}>
              <div>手机号：<Text strong>{approveTarget.phone}</Text></div>
              <div>申请编号：<Text code>{approveTarget.code}</Text></div>
            </div>

            {approveTarget.matched_user_id ? (
              <>
                <Alert
                  type={approveTarget.matched_user_has_wechat ? "warning" : "info"}
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="系统发现同名账号"
                  description={approveTarget.matched_note
                    || `姓名与已有账号 ${approveTarget.matched_user_username} 相同`}
                />
                <Radio.Group
                  value={linkToMatched}
                  onChange={(e) => setLinkToMatched(e.target.value)}
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <Radio value={true} disabled={approveTarget.matched_user_has_wechat}>
                    <span style={{ fontWeight: 600 }}>
                      关联到已有账号 {approveTarget.matched_user_username}
                    </span>
                    <span style={{ color: "#8c8c8c" }}>
                      （{approveTarget.matched_user_name} · {approveTarget.matched_user_employee_id}）
                      —— 不新建账号，无需新密码，该微信将绑定到此账号
                    </span>
                    {approveTarget.matched_user_has_wechat && (
                      <Tag color="red" style={{ marginLeft: 6 }}>该账号已绑定其他微信，无法关联</Tag>
                    )}
                  </Radio>
                  <Radio value={false}>
                    <span style={{ fontWeight: 600 }}>仍新建账号</span>
                    <span style={{ color: "#8c8c8c" }}>
                      （用手机号 {approveTarget.phone} 建立新账号，并生成一次性初始密码）
                    </span>
                  </Radio>
                </Radio.Group>
              </>
            ) : (
              <div style={{ color: "#d46b08" }}>
                <UserAddOutlined /> 通过后将创建账号并生成初始密码，密码仅显示一次。
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── 拒绝 ─────────────────────────────────────────── */}
      <Modal
        open={!!rejectTarget}
        title={`拒绝「${rejectTarget?.real_name ?? ""}」的申请`}
        onCancel={() => { setRejectTarget(null); setRejectReason(""); }}
        onOk={submitReject}
        okText="确认拒绝" cancelText="取消"
        confirmLoading={acting}
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">手机号：{rejectTarget?.phone}</Text>
        </div>
        <Input.TextArea
          rows={4} maxLength={200} showCount
          placeholder="请填写拒绝原因（将告知申请人，并计入审计记录）"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
        <Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
          拒绝后申请记录会保留，申请人可立即重新提交。
        </Paragraph>
      </Modal>

      {/* ── 审核结果 ─────────────────────────────────────── */}
      <Modal
        open={!!pwdResult}
        title={pwdResult?.mode === "linked" ? "✅ 已关联到既有账号" : "✅ 审核通过 — 账号已创建"}
        onCancel={() => setPwdResult(null)}
        footer={[<Button key="c" type="primary" onClick={() => setPwdResult(null)}>我已保存</Button>]}
        width={520}
      >
        {pwdResult && (
          <div>
            <div style={{ marginBottom: 12, lineHeight: 2 }}>
              <div>账号：<Text strong copyable>{pwdResult.username}</Text></div>
              <div>工号：<Text code>{pwdResult.employee_id}</Text></div>
            </div>
            {pwdResult.mode === "linked" ? (
              <Alert
                type="success" showIcon
                message="该微信已绑定到此账号"
                description={pwdResult.message || "未新建账号，此前的登录密码保持不变。"}
              />
            ) : (
              <>
                <div style={{
                  background: "linear-gradient(135deg,#f6ffed,#d9f7be)",
                  border: "1px solid #b7eb8f", borderRadius: 8, padding: 16, textAlign: "center",
                }}>
                  <div style={{ fontSize: 12, color: "#389e0d", marginBottom: 6 }}>初始密码</div>
                  <div style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 24, fontWeight: 700, letterSpacing: 1, color: "#135200",
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
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
