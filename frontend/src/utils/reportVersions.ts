/** 报告版本候选项：预设清单 + 库里已用过的值（后端 /cases/report-versions/） */
export const REPORT_VERSION_PRESETS = [
  "英文", "英繁", "英文-美", "泰国", "法语", "意大利",
  "西班牙", "加纳", "印度", "德语", "澳洲",
];

export async function fetchReportVersions(api: any): Promise<string[]> {
  try {
    const r = await api.get("/cases/report-versions/");
    const opts = r.data?.options;
    return Array.isArray(opts) && opts.length ? opts : REPORT_VERSION_PRESETS;
  } catch {
    return REPORT_VERSION_PRESETS;
  }
}
