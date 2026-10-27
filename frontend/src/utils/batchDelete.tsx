import { Modal, Input, Typography, message } from "antd";
import api from "../api/client";

const { Text } = Typography;

export type DeleteDecision = { ok: boolean; mode?: "normal" | "force" };

/** 管理员强制删除已完成批次：必填原因 + 输入批次号二次确认，后端自动备份 + 审计 */
async function runForceDelete(kind: string, id: string, d: any): Promise<boolean> {
  let typed = "";
  let reason = "";
  return new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: `强制删除已完成批次 ${d.batch_number}`,
      width: 560,
      okText: "确认强制删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: (
        <div style={{ fontSize: 13 }}>
          <div>批次号：<b>{d.batch_number}</b>（状态：已完成）</div>
          <div style={{ marginTop: 4 }}>
            删除后 <b>{d.revert_count}</b> 个样本将回退到「
            <b>{d.to_stage_label || "已签收"}</b>」。
          </div>
          <div style={{ marginTop: 4, color: "#cf1322" }}>
            会删除该批次的实验记录并写入审计日志；删除前系统自动备份，可从备份恢复。
          </div>
          <div style={{ marginTop: 10 }}>
            <Text type="danger">*</Text> 删除原因（至少 5 个字，会写入审计）
          </div>
          <Input.TextArea rows={3} maxLength={200} showCount
            placeholder="例如：批次登记错误，样本需要重新前处理"
            onChange={(e) => { reason = e.target.value; }} />
          <div style={{ marginTop: 10 }}>
            <Text type="danger">*</Text> 二次确认：请输入批次号 <Text code>{d.batch_number}</Text>
          </div>
          <Input placeholder={d.batch_number} onChange={(e) => { typed = e.target.value; }} />
        </div>
      ),
      onOk: async () => {
        if (typed.trim() !== d.batch_number) {
          message.warning("批次号输入不一致，未删除");
          return Promise.reject(new Error("batch-number-mismatch"));
        }
        if (reason.trim().length < 5) {
          message.warning("请填写删除原因（至少 5 个字）");
          return Promise.reject(new Error("reason-too-short"));
        }
        try {
          const r = await api.post(`/cases/${kind}/${id}/force-delete/`, { reason: reason.trim() });
          message.success(r.data?.message || "已强制删除");
          resolve(true);
        } catch (e: any) {
          message.error(e?.response?.data?.detail || "强制删除失败", 8);
          return Promise.reject(e);
        }
      },
      onCancel: () => resolve(false),
    });
  });
}

/**
 * 删除 NIPPT 批次前的确认。
 * 返回 { ok, mode }：
 *   - ok=true,  mode="normal" → 调用方继续走普通删除接口
 *   - ok=false, mode="force"  → 已完成批次已被强制删除（本函数内部已调接口），调用方只需刷新
 *   - ok=false 且无 mode       → 用户取消 / 不允许
 */
export async function confirmBatchDelete(
  kind: string,
  id: string,
  onForceDone?: () => void | Promise<void>,
): Promise<DeleteDecision> {
  let d: any;
  try {
    const r = await api.get(`/cases/${kind}/${id}/delete_preview/`);
    d = r.data || {};
  } catch (e: any) {
    Modal.error({
      title: "无法删除",
      content: e?.response?.data?.detail || "获取批次信息失败，请刷新后重试",
    });
    return { ok: false };
  }

  if (d.completed) {
    if (!d.can_force) {
      Modal.error({
        title: "无法删除",
        content: d.blocked?.length
          ? `该批次已被下游批次使用：${(d.blocked || []).map((b: any) => `${b.batch_number}（${b.count} 个样本）`).join("、")}`
          : "批次已完成，不能直接删除；仅管理员可强制删除。",
      });
      return { ok: false };
    }
    const done = await runForceDelete(kind, id, d);
    if (done && onForceDone) await onForceDone();
    return { ok: false, mode: done ? "force" : undefined };
  }

  if (!d.can_delete) {
    const list = (d.blocked || [])
      .map((b: any) => `${b.batch_number}（${b.count} 个样本）`)
      .join("、");
    Modal.error({
      title: "无法删除",
      content: `该批次已被下游批次使用：${list}。请先删除下游批次后再试。`,
    });
    return { ok: false };
  }

  return new Promise<DeleteDecision>((resolve) => {
    Modal.confirm({
      title: "确认删除该批次？",
      content: (
        <div style={{ fontSize: 13 }}>
          <div>批次号：<b>{d.batch_number}</b></div>
          <div style={{ marginTop: 4 }}>
            删除后 <b>{d.revert_count}</b> 个样本将回退到
            「<b>{d.to_stage_label || d.to_stage || "上一阶段"}</b>」阶段。
          </div>
          <div style={{ marginTop: 4, color: "#999" }}>该操作会记录到审计日志。</div>
        </div>
      ),
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => resolve({ ok: true, mode: "normal" }),
      onCancel: () => resolve({ ok: false }),
    });
  });
}

export default confirmBatchDelete;
