// Shared constants for NIPT tabs
// Used by NiptExtractionTab, NiptLibraryTab

export const ROWS_8 = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const COLS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// Aliases for backward compat
export const ROW_LABELS = ROWS_8;
export const COL_COUNT = 12;

export const REGIONS = [
  { value: "THAILAND", label: "泰国" },
  { value: "XIAMEN",   label: "厦门" },
  { value: "HONGKONG", label: "香港" },
  { value: "BRAZIL",   label: "巴西" },
];

export const STEPS = [
  { key: "uv_prep",       label: "设备准备（紫外 30min）" },
  { key: "reagent_prep",  label: "试剂准备（混匀、离心）" },
  { key: "sample_prep",   label: "样本准备" },
  { key: "on_machine",    label: "上机" },
  { key: "cleanup",       label: "实验结束（清洁台面、紫外 30min）" },
];

// ── Extraction reagent kits by region ──
export const EXTRACTION_KITS: Record<string, { value: string; label: string }[]> = {
  THAILAND: [
    { value: "ZEC601-T96", label: "MagPure Circulating DNA TL Kit (1.2ml, 48ch) - ZEC601-T96" },
    { value: "ZEC601",     label: "MagPure Circulating DNA Kit (0.4ml) - ZEC601" },
  ],
  XIAMEN: [
    { value: "MD5432-TL-06C", label: "磁珠法游离DNA提取试剂盒 - MD5432-TL-06C" },
    { value: "12919w-480",    label: "磁珠法游离DNA提取试剂盒 - 12919w-480" },
  ],
  HONGKONG: [
    { value: "MD5432-RB", label: "磁珠法游离DNA提取试剂盒 (圆底) - MD5432-TL-06C" },
    { value: "MD5432-CB", label: "磁珠法游离DNA提取试剂盒 (锥底) - MD5432-TL-06C" },
  ],
  BRAZIL: [{ value: "TBD", label: "待定" }],
};

// ── VG ID helper ──
export function getVgId(s: any): string {
  return s?.sample_vg_id || s?.sample_barcode || s?.vg_id || s?.sample_id || "-";
}
