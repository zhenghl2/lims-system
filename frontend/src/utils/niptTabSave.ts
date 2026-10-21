// utils/niptTabSave.ts — 让「完成本步」在提交前先触发当前页签的保存（2026-10-21）
// 背景：各步骤页的填写只存在组件 state，点「完成本步」不会先保存 → 未保存的填写丢失。
type Saver = () => Promise<boolean>;

let currentSaver: Saver | null = null;

export function registerTabSaver(fn: Saver | null) {
  currentSaver = fn;
}

/** 执行当前页签的保存；没有注册视为无需保存 */
export async function runTabSave(): Promise<boolean> {
  if (!currentSaver) return true;
  try {
    return await currentSaver();
  } catch {
    return false;
  }
}
