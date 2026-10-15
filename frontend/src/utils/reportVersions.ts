import api from "../api/client";

/** 报告版本候选项：预设清单 + 库里已用过的值（后端 /cases/report-versions/） */
// 兜底清单（仅在接口失败时使用）。务必与后端 presets 保持同步，
// 否则接口一旦不通，用户就选不到库里在用的值（如「巴西」「国内」）。
export const REPORT_VERSION_PRESETS = [
  "英文", "英繁", "英文-美", "泰国", "法语", "意大利",
  "西班牙", "加纳", "印度", "德语", "澳洲", "巴西", "国内",
];

/**
 * 拉取报告版本候选项。
 *
 * ⚠️ 不要改回「接收外部 api 对象」的写法：历史上的写法是 fetchReportVersions(casesApi)，
 *    而 casesApi.get 的语义是「按 id 取案例详情」，于是 "/cases/report-versions/"
 *    被当成案例 id 拼成 /api/v1/cases//cases/report-versions// 而永远 404。
 *    这里直接用统一的 api client，路径语义唯一。
 */
export async function fetchReportVersions(): Promise<string[]> {
  try {
    const r = await api.get("/cases/report-versions/");
    const data = (r.data || {}) as { presets?: unknown; used?: unknown };
    // 后端返回 { presets: [...], used: [...] }（不是 options）。
    // 两者合并去重：presets 是维护好的清单，used 是库里实际用过的值
    // （库里历史值以「巴西」为主，而前端硬编码清单里并没有「巴西」，
    //   所以必须以后端为准，不能只靠兜底常量）。
    const merged: string[] = [];
    [...(Array.isArray(data.presets) ? data.presets : []),
     ...(Array.isArray(data.used) ? data.used : [])].forEach((v) => {
      const t = typeof v === "string" ? v.trim() : "";
      if (t && merged.indexOf(t) < 0) merged.push(t);
    });
    return merged.length ? merged : REPORT_VERSION_PRESETS;
  } catch {
    return REPORT_VERSION_PRESETS;
  }
}
