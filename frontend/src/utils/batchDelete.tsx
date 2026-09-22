import { Modal } from "antd";
import api from "../api/client";

/**
 * 删除 NIPPT 批次前的确认。
 * 先请求后端 delete_preview：
 *   - 批次已完成 → 提示不能删
 *   - 被下游批次使用 → 提示先删下游
 *   - 否则弹确认框，说明"将有 N 个样本回退到 XXX 阶段"
 * 返回 true 表示用户确认、可以继续调用删除接口。
 */
export async function confirmBatchDelete(kind: string, id: string): Promise<boolean> {
  let d: any;
  try {
    const r = await api.get(`/cases/${kind}/${id}/delete_preview/`);
    d = r.data || {};
  } catch (e: any) {
    Modal.error({
      title: "无法删除",
      content: e?.response?.data?.detail || "获取批次信息失败，请刷新后重试",
    });
    return false;
  }
  if (d.completed) {
    Modal.error({ title: "无法删除", content: "批次已完成，不能删除。" });
    return false;
  }
  if (!d.can_delete) {
    const list = (d.blocked || [])
      .map((b: any) => `${b.batch_number}（${b.count} 个样本）`)
      .join("、");
    Modal.error({
      title: "无法删除",
      content: `该批次已被下游批次使用：${list}。请先删除下游批次后再试。`,
    });
    return false;
  }
  return new Promise<boolean>((resolve) => {
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
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export default confirmBatchDelete;
