// HPV constants — shared across workflow tabs
export const STATUS_COLOR: Record<string, string> = {
  PLANNED: "default", EXTRACTION: "blue", PCR: "cyan",
  HYBRIDIZATION: "geekblue", RESULT_ENTRY: "orange",
  IN_REVIEW: "purple", REVIEWED: "green", COMPLETED: "success",
  FAILED: "red",
};
export const STATUS_LABEL: Record<string, string> = {
  PLANNED: "已规划", EXTRACTION: "核酸提取", PCR: "PCR扩增",
  HYBRIDIZATION: "杂交显色", RESULT_ENTRY: "结果录入", IN_REVIEW: "复核中",
  REVIEWED: "已复核", COMPLETED: "已完成", FAILED: "已失败",
};
export const REVIEW_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", PENDING_REVIEW: "待复核", REVIEWED: "已复核",
  REJECTED: "退回修改", NEEDS_RETEST: "需复查",
};
export const REVIEW_STATUS_COLOR: Record<string, string> = {
  DRAFT: "default", PENDING_REVIEW: "blue", REVIEWED: "green",
  REJECTED: "red", NEEDS_RETEST: "orange",
};

export const GENOTYPE_15 = ["16","18","31","33","35","39","45","51","52","53","56","58","59","66","68"];
export const GENOTYPE_23 = ["16","18","31","33","35","39","45","51","52","53","56","58","59","66","68","73","82","6","11","42","43","81","83"];
export const ROWS_48 = ["A","B","C","D","E","F","G","H"];
export const COLS_48 = [1,2,3,4,5,6];

export const EXTRACTION_STEPS = [
  { key: "uv_15min", label: "设备准备（紫外 15min）" },
  { key: "reagent_prep", label: "试剂准备（混匀、离心）" },
  { key: "sample_add_400ul", label: "样本准备（加 400μl）" },
  { key: "load_magnet", label: "上机（磁棒套）" },
  { key: "cleanup_uv_30min", label: "实验结束（清洁、紫外 30min）" },
];
export const PCR_STEPS = [
  { key: "reaction_equilibration", label: "反应液平衡" },
  { key: "label_numbering", label: "标记编号" },
  { key: "add_sample_5ul", label: "加样 5μL" },
  { key: "centrifuge", label: "离心" },
  { key: "transfer", label: "传递" },
  { key: "program_run", label: "程序运行" },
  { key: "denaturation", label: "产物变性（95℃ 10min→冰盒10min→2-8℃备用）" },
];
export const KIT_TYPES = [
  { value: "PN-16E", label: "PN-16E" },
  { value: "PN-96E", label: "PN-96E" },
];
export const HPV_KIT_TYPES = [
  { value: "HPV_15", label: "15 型" },
  { value: "HPV_23", label: "23 型" },
];

export function wellLabel(r: string, c: number) { return `${r}${c}`; }

/** Parse signature from stage data. Returns {signed: bool, name: string, time: string}. */
export function getSignStatus(stageData: any, role: "operator" | "reviewer") {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = stageData?.[key];
  if (!sig || typeof sig !== "object" || !sig.username) {
    return { signed: false, name: "", time: "" };
  }
  return { signed: true, name: sig.username, time: sig.signed_at || "" };
}

/** Signer name → signature image path. */
export const SIGNER_IMAGES: Record<string, string> = {
  "陈菊玲": "/signatures/陈菊玲.png",
  "李彩娟": "/signatures/李彩娟.png",
  "杨思婷": "/signatures/杨思婷.jpg",
};
export const SIGNER_NAMES = Object.keys(SIGNER_IMAGES);
export function getSignerImage(name: string) { return SIGNER_IMAGES[name] || ""; }
