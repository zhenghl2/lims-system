// ── User / Auth ────────────────────────────────

export interface User {
  id: string;
  employee_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  locale: string;
  timezone: string;
  mfa_enabled: boolean;
  site_id: string | null;
  allowed_panels: string[];
  roles: { name: string; expires_at: string | null }[];
  last_login: string | null;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

// ── Paginated response ──────────────────────────

export interface Meta {
  count: number;
  next: string | null;
  previous: string | null;
}

export interface Pageable<T> extends Meta {
  results: T[];
}

// ── Site ─────────────────────────────────────────

export interface Site {
  id: string;
  code: string;
  name_en: string;
  name_local: string;
  country: string;
  timezone: string;
  locale: string;
  sample_count: number;
  user_count: number;
  is_active: boolean;
}

// ── Sample ───────────────────────────────────────

export interface Sample {
  id: string;
  sample_id: string;
  patient_id: string;
  patient_name: string;
  status: string;
  sample_type_code: string;
  receipt_date: string;
  receipt_temp?: string;
  collection_date: string;
  ordering_physician?: string;
  ordering_facility?: string;
  panel_info: string | null;
  created_at: string;
  image?: string;
}

export interface SampleStats {
  total_received_today: number;
  total_in_process: number;
  total_completed: number;
  total_reported: number;
  total_rejected_today: number;
}

export interface SampleRejection {
  reason: string;
  note: string;
}

// ── Run ──────────────────────────────────────────

export interface Run {
  id: string;
  run_number: string;
  panel: string;
  panel_code: string;
  panel_name: string;
  sequencer_name: string | null;
  status: string;
  planned_date: string | null;
  sample_count: number;
  operator_name: string | null;
  barcode: string;
  protocol: string | null;
  protocol_name: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RunStats {
  total: number;
  by_status: { status: string; count: number }[];
}

// ── Report ───────────────────────────────────────

export interface Report {
  id: string;
  report_number: string;
  sample: string;
  sample_barcode: string;
  patient_name: string;
  panel_code: string;
  status: string;
  version_number: number;
  pdf_file_path?: string;
  content?: Record<string, unknown>;
  reviewed_by_name?: string;
  reviewed_at?: string;
  verified_by_name?: string;
  verified_at?: string;
  signed_by_name?: string;
  signed_at?: string;
  released_at: string | null;
  created_at: string;
  updated_at?: string;
}


// ── QC ───────────────────────────────────────────

export interface QCControlMaterial {
  id: string;
  name: string;
  material_type: string;
  manufacturer: string;
  catalog_number: string;
  lot_number: string;
  expiry_date: string | null;
  target_values: Record<string, { mean: number; sd: number }>;
  site: string;
  created_at: string;
}

export interface QCRun {
  id: string;
  run: string;
  run_number: string;
  control_material: string;
  control_material_name: string;
  measured_values: Record<string, number>;
  pass_fail: string;
  westgard_violations: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string;
  created_at: string;
}

export interface QCChart {
  id: string;
  metric_name: string;
  panel: string;
  control_material: string;
  control_material_name: string;
  target_mean: number;
  target_sd: number;
  warning_sd: number;
  action_sd: number;
  westgard_rules: string[];
  is_active: boolean;
  data_points?: { date: string; value: number; run_number: string; pass_fail: string }[];
}

// ── QC Event ─────────────────────────────────────

export interface QCEvent {
  id: string;
  event_type: string;
  severity: string;
  summary: string;
  status: string;
  target_date: string | null;
  created_at: string;
}





// ── Test Panel ───────────────────────────────────

export interface TestPanel {
  id: string;
  code: string;
  name: string;
  description: string;
  turnaround_days: number;
  report_template_code: string;
  is_active: boolean;
}


// ── Panel Stats ──────────────────────────────────

export interface PanelStats {
  panel_code: string;
  panel_name: string;
  received: number;
  accepted: number;
  in_process: number;
  completed: number;
  reported: number;
  rejected: number;
  total: number;
}

// ── Instrument ───────────────────────────────────

export interface Instrument {
  id: string;
  name: string;
  instrument_type: string;
  manufacturer: string;
  model: string;
  status: string;
  serial_number: string;
  location: string;
  asset_tag: string;
  site: string;
  iq_date: string | null;
  oq_date: string | null;
  pq_date: string | null;
  maintenance_count?: number;
  created_at: string;
  updated_at: string;
}

// ── Reagent Lot ──────────────────────────────────

export interface ReagentLot {
  id: string;
  lot_number: string;
  expiry_date: string | null;
  quality_status: string;
  reagent_name: string;
  remaining: number;
  unit: string;
}


// ── Case (NIPPT) ─────────────────────────────────

export interface CaseSample {
  id: string;
  case: string;
  sample: string;
  sample_id: string;
  sample_status: string;
  patient_name: string;
  patient_id: string;
  collection_date: string;
  role: "MOTHER" | "ALLEGED_FATHER";
  role_display: string;
  sample_source: "BLOOD" | "SWAB" | "HAIR" | "DBS";
  source_display: string;
  ethnicity: string;
  relationship_to_mother: string;
  receipt_condition: string;
  received_at: string | null;
  received_by: string | null;
  collection_site: string;
  collection_notes: string;
  test_sample_id: string | null;
  resample_of: string | null;
  resample_number: number | null;
  rejection_reason: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseItem {
  id: string;
  case_number: string;
  pt_number: string | null;
  panel_code: string;
  panel_name: string;
  status: string;
  status_display: string;
  is_urgent: boolean;
  sample_count: number;
  received_count: number;
  progress: number;
  gestational_age_weeks: number | null;
  gestational_age_days: number | null;
  mother_name: string;
  clinic_name: string;
  sales_person: string;
  expected_completion: string | null;
  created_at: string;
}

export interface CaseDetail extends CaseItem {
  panel: string;
  pt_number: string | null;
  progress: number;
  mother_name: string;
  clinic_contact: string;
  notes: string;
  registration_token: string | null;
  registration_url: string | null;
  all_samples_received: boolean;
  case_samples: CaseSample[];
  site: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface CaseDashboard {
  case_status: Record<string, number>;
  urgent: number;
  near_deadline: number;
  incomplete_pairs: number;
  today_expected: number;
  workflow_stages: Record<string, number>;
}

export interface CaseCreatePayload {
  sample_id?: string;
  mother_name: string;
  mother_dob?: string;
  father_names: string[];
  father_sample_type?: string;
  gestational_age_weeks?: number;
  gestational_age_days?: number;
  clinic_name?: string;
  clinic_contact?: string;
  sales_person?: string;
  notes?: string;
  is_urgent?: boolean;
  expected_completion?: string;
}

export interface DeleteSamplePayload {
  sample_id: string;
}

export interface ConfirmReceiptPayload {
  sample_id: string;
  condition?: string;
  rejection_note?: string;
}

export interface ReceiveSamplePayload {
  sample_id: string;
  condition?: string;
}

export interface RejectSamplePayload {
  sample_id: string;
  rejection_reason: string;
  rejection_note?: string;
}

export interface ResamplePayload {
  case_sample_id: string;
  patient_name?: string;
  sample_source?: string;
}

export const REJECTION_REASONS: Record<string, string> = {
  UNCLEAR_LABEL: "标识不清",
  BROKEN_CONTAINER: "容器破损",
  INSUFFICIENT_VOLUME: "样本量不足",
  WRONG_SAMPLE_TYPE: "样本类型不符",
  SEVERE_HEMOLYSIS: "严重溶血/凝血",
  TEMP_EXCEEDED: "运输温度超标",
  STABILITY_EXPIRED: "超过稳定性时限",
};

export const SAMPLE_STATUS_FLOW = [
  "REGISTERED", "RECEIVED", "IN_PROCESS",
  "TESTING", "ANALYZING", "COMPLETED",
  "REPORTED", "ARCHIVED", "DISPOSED",
] as const;

export const SAMPLE_STATUS_DISPLAY: Record<string, string> = {
  REGISTERED: "已登记",
  RECEIVED: "已接收",
  IN_PROCESS: "处理中",
  TESTING: "检测中",
  ANALYZING: "分析中",
  COMPLETED: "已完成",
  REPORTED: "已报告",
  ARCHIVED: "已归档",
  DISPOSED: "已销毁",
  REJECTED: "已拒收",
};


// ── Workflow (NIPPT) ──────────────────────────────────────
export interface WorkflowStep {
  id: string;
  run: string;
  sample: string | null;
  sample_barcode?: string;
  step_id: string;
  step_name: string;
  step_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  reagents_used: any[];
  instrument: string | null;
  instrument_name: string | null;
  observations: string;
  deviation_flag: boolean;
  deviation_note: string;
  step_data: Record<string, any>;
  qc_status: string;
  qc_by: string | null;
  qc_by_name: string | null;
  qc_at: string | null;
  created_at: string;
}

export interface SampleRun {
  id: string;
  run_number: string;
  panel_code: string;
  panel_name: string;
  protocol_name?: string;
  status: string;
  sample_count: number;
  operator_name?: string;
  created_at: string;
}
