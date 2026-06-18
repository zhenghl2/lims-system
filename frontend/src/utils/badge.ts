// Shared badge/color utilities for NIPT tabs
// Single source of truth — used by NiptExtractionTab, NiptPoolingTab

export interface BadgeInfo {
  text: string;
  bg?: string;
}

// ── Color constants ──
export const COLOR_PLUS       = "#e6f4ff";
export const COLOR_BASIC      = "#f6ffed";
export const COLOR_BASIC_ALL  = "#e8d5f5";
export const COLOR_DEFAULT    = "#e8f5e9";
export const COLOR_EMPTY      = "#fafafa";
export const COLOR_FAIL       = "#fff1f0";

// ── Legend border colors ──
export const BORDER_PLUS      = "#91caff";
export const BORDER_BASIC     = "#b7eb8f";
export const BORDER_BASIC_ALL = "#c9a2e0";

// ── Sample badge helper ──
export function getSampleBadge(s: any): BadgeInfo {
  if (!s) return { text: "" };
  const isTwin = s?.sample_multiple_gestation === true;
  const testOpt = (s?.sample_test_option || "").trim().toLowerCase();
  const twinMark = isTwin ? "👶👶 " : "";
  if (testOpt === "plus" || testOpt === "nipt_plus") {
    return { text: twinMark, bg: COLOR_PLUS };
  }
  if (testOpt === "basic_all" || testOpt === "basic all" || testOpt === "nipt_full") {
    return { text: twinMark, bg: COLOR_BASIC_ALL };
  }
  if (testOpt === "basic" || testOpt === "nipt") {
    return { text: twinMark, bg: COLOR_BASIC };
  }
  if (isTwin) {
    return { text: "👶👶 ", bg: undefined };
  }
  return { text: "", bg: undefined };
}

// ── Cell background helper ──
export function getCellBg(idx: number | undefined, samples: any[]): string {
  if (idx === undefined) return COLOR_EMPTY;
  const badge = getSampleBadge(samples[idx]);
  return badge.bg || (samples[idx] ? COLOR_DEFAULT : COLOR_EMPTY);
}

// ── Compute pooling amount ──
export function calcPoolingAmount(baseAmount: number, testOpt: string, isTwin: boolean): number {
  const opt = testOpt.toLowerCase();
  if (opt === "plus" || opt === "nipt_plus") {
    return Math.round(baseAmount * 2.5 * 100) / 100;
  }
  if (isTwin) {
    return Math.round(baseAmount * 2 * 100) / 100;
  }
  return baseAmount;
}
