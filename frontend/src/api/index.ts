import api from "./client";
import type {
  User, AuthTokens, Site, Sample, SampleStats,
  Run, RunStats, Report, TestPanel,
  Instrument, ReagentLot, Pageable,
  QCControlMaterial, QCRun, QCChart, QCEvent,
  PanelStats as _PanelStats, CaseItem, CaseDetail, CaseSample as _cs, CaseDashboard, UrgentSample,
  CaseCreatePayload, ConfirmReceiptPayload, DeleteSamplePayload, WorkflowStep, SampleRun as _sr,
} from "./types";

// ── Auth ─────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post<AuthTokens>("/login/", { username, password }),
  logout: (refresh: string) =>
    api.post("/logout/", { refresh }),
  refresh: (refresh: string) =>
    api.post<AuthTokens>("/refresh/", { refresh }),
  mfaSetup: () => api.post<{ secret: string; qr_code_url: string }>("/mfa/setup/"),
  verifyMfa: (code: string) => api.post<AuthTokens>("/mfa/verify/", { code }),
  changePassword: (current: string, password: string, confirm: string) =>
    api.post("/change-password/", {
      current_password: current, new_password: password, confirm_password: confirm,
    }),
  me: () => api.get<User>("/me/"),
};

// ── Sites ─────────────────────────────────────────────────────
export const sitesApi = {
  list: () => api.get<Site[]>("/sites/sites/"),
};

// ── Samples ───────────────────────────────────────────────────
export const samplesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<Sample>>("/samples/", { params }),
  get: (id: string) => api.get<Sample>(`/samples/${id}/`),
  create: (data: Record<string, unknown>) =>
    api.post<Sample>("/samples/", data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<Sample>(`/samples/${id}/`, data),
  reject: (id: string, reason: string, note?: string) =>
    api.post(`/samples/${id}/reject/`, {
      rejection_reason: reason, rejection_note: note,
    }),
  accept: (id: string, data?: Record<string, unknown>) =>
    api.post(`/samples/${id}/accept/`, data || {}),
  uploadImage: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    return api.post(`/samples/${id}/upload-image/`, formData);
  },
  statsByPanel: () => api.get("/samples/stats_by_panel/"),
  urgent: (params?: { days?: number }) =>
    api.get<UrgentSample[]>("/samples/urgent/", { params }),
  delete: (id: string) => api.delete(`/samples/${id}/`),
  stats: () => api.get<SampleStats>("/samples/stats/"),
  batchCreate: (data: { samples: Record<string, unknown>[] }) =>
    api.post("/samples/batch_create/", data),
  registerFromPdf: (formData: FormData) =>
    api.post("/samples/register-from-pdf/", formData),
  redo: (id: string, data?: Record<string, unknown>) =>
    api.post(`/samples/${id}/redo/`, data || {}),
  recollect: (id: string, data?: Record<string, unknown>) =>
    api.post(`/samples/${id}/recollect/`, data || {}),
};

// ── Runs ──────────────────────────────────────────────────────
export const runsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<Run>>("/runs/", { params }),
  get: (id: string) => api.get<Run>(`/runs/${id}/`),
  detail: (id: string) => api.get<Run>(`/runs/${id}/run_detail/`),
  create: (data: Record<string, unknown>) =>
    api.post<Run>("/runs/", data),
  advanceStatus: (id: string, status: string) =>
    api.post(`/runs/${id}/advance_status/`, { status }),
  addSamples: (id: string, sample_ids: string[]) =>
    api.post(`/runs/${id}/add_samples/`, { sample_ids }),
  updateResults: (id: string, results: Record<string, Record<string, unknown>>) =>
    api.post(`/runs/${id}/update_results/`, { results }),
  delete: (id: string) => api.delete(`/runs/${id}/`),
  stats: () => api.get<RunStats>("/runs/stats/"),
};

// ── Protocols ──────────────────────────────────────────────────────
export const protocolsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<any>>("/runs/protocols/", { params }),
  get: (id: string) => api.get<any>(`/runs/protocols/${id}/`),
  create: (data: Record<string, unknown>) => api.post<any>("/runs/protocols/", data),
  update: (id: string, data: Record<string, unknown>) => api.patch<any>(`/runs/protocols/${id}/`, data),
  delete: (id: string) => api.delete(`/runs/protocols/${id}/`),
};
export const stepsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<any>>("/runs/steps/", { params }),
  start: (id: string) => api.post(`/runs/steps/${id}/start/`),
  complete: (id: string, data?: Record<string, unknown>) =>
    api.post(`/runs/steps/${id}/complete/`, data),
  skip: (id: string) => api.post(`/runs/steps/${id}/skip/`),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/runs/steps/${id}/`, data),
  get: (id: string) => api.get(`/runs/steps/${id}/`),
};

// ── Reports ───────────────────────────────────────────────────
export const reportsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<Report>>("/reports/", { params }),
  get: (id: string) => api.get<Report>(`/reports/${id}/`),
  review: (id: string, data?: Record<string, unknown>) => api.post(`/reports/${id}/review/`, data),
  verify: (id: string, data?: Record<string, unknown>) => api.post(`/reports/${id}/verify/`, data),
  sign: (id: string, password: string) =>
    api.post(`/reports/${id}/sign/`, { password }),
  release: (id: string) => api.post(`/reports/${id}/release/`),
  generate: (id: string) => api.post<Report>(`/reports/${id}/generate/`),
  download: (id: string, params?: Record<string, string>) =>
    api.get(`/reports/${id}/download/`, { responseType: "blob", params }),
  delete: (id: string) => api.delete(`/reports/${id}/`),
};

// ── QC ────────────────────────────────────────────────────────
export const qcApi = {
  // Control Materials
  listMaterials: (params?: Record<string, unknown>) =>
    api.get<Pageable<QCControlMaterial>>("/qc/control-materials/", { params }),
  createMaterial: (data: Record<string, unknown>) =>
    api.post<QCControlMaterial>("/qc/control-materials/", data),
  deleteMaterial: (id: string) => api.delete(`/qc/control-materials/${id}/`),

  // QC Runs
  listRuns: (params?: Record<string, unknown>) =>
    api.get<Pageable<QCRun>>("/qc/runs/", { params }),
  createRun: (data: Record<string, unknown>) =>
    api.post<QCRun>("/qc/runs/", data),
  deleteRun: (id: string) => api.delete(`/qc/runs/${id}/`),

  // QC Charts (Levey-Jennings)
  listCharts: (params?: Record<string, unknown>) =>
    api.get<Pageable<QCChart>>("/qc/charts/", { params }),
  getChart: (id: string) =>
    api.get<QCChart>(`/qc/charts/${id}/`),
  deleteChart: (id: string) => api.delete(`/qc/charts/${id}/`),

  // QC Events (CAPA)
  listEvents: (params?: Record<string, unknown>) =>
    api.get<Pageable<QCEvent>>("/qc/events/", { params }),
  createEvent: (data: Record<string, unknown>) =>
    api.post<QCEvent>("/qc/events/", data),
  updateEventStatus: (id: string, status: string, extra?: Record<string, unknown>) =>
    api.post(`/qc/events/${id}/update_status/`, { status, ...extra }),
  deleteEvent: (id: string) => api.delete(`/qc/events/${id}/`),
};

// ── Panels, Instruments, Reagents ─────────────────────────────
export const panelsApi = {
  list: () => api.get<TestPanel[]>("/samples/panels/"),
};

export const instrumentsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<Instrument>>("/instruments/", { params }),
  create: (data: Record<string, unknown>) =>
    api.post<Instrument>("/instruments/", data),
  delete: (id: string) => api.delete(`/instruments/${id}/`),
};

export const reagentsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<ReagentLot>>("/reagents/lots/", { params }),
  create: (data: Record<string, unknown>) =>
    api.post<ReagentLot>("/reagents/lots/", data),
  delete: (id: string) => api.delete(`/reagents/lots/${id}/`),
  expiring: (days = 30) =>
    api.get<ReagentLot[]>(`/reagents/lots/expiring/?days=${days}`),
};

// ── Users ────────────────────────────────────────────────────
export const usersApi = {
  list: (params?: Record<string, unknown>) =>
    api.get("/users/", { params }),
};

// ── Cases (NIPPT) ─────────────────────────────────────────────
export const casesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<CaseItem>>("/cases/", { params }),
  get: (id: string) => api.get<CaseDetail>(`/cases/${id}/`),
  create: (data: CaseCreatePayload) =>
    api.post<CaseDetail>("/cases/", data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<CaseDetail>(`/cases/${id}/`, data),
  confirmReceipt: (id: string, data: ConfirmReceiptPayload) =>
    api.post(`/cases/${id}/confirm_receipt/`, data),
  dashboard: () => api.get<CaseDashboard>("/cases/dashboard/"),
  generateToken: (id: string) => api.post(`/cases/${id}/generate_token/`),
  supplement: (id: string, data: { role: string; patient_name: string; sample_source?: string; arrival_date?: string; external_id?: string; ethnicity?: string; relationship_to_mother?: string }) => api.post(`/cases/${id}/supplement/`, data),
  deleteCase: (id: string) => api.post(`/cases/${id}/delete_case/`),
  deleteSample: (id: string, data: DeleteSamplePayload) =>
    api.post(`/cases/${id}/delete_sample/`, data),
  consumeToken: (token: string) => api.get(`/cases/public/info/${token}/`),
  receive: (id: string, data: { sample_id: string; condition?: string }) =>
    api.post(`/cases/${id}/confirm_receipt/`, data),
  reject: (id: string, data: { sample_id: string; rejection_reason: string; rejection_note?: string }) =>
    api.post(`/cases/${id}/reject/`, data),
  resample: (id: string, data: { case_sample_id: string; patient_name?: string; sample_source?: string }) =>
    api.post(`/cases/${id}/resample/`, data),
  // NIPPT Pre-Processing
  listPreprocessingBatches: (params?: Record<string, unknown>) =>
    api.get("/cases/preprocessing/", { params }),
  getPreprocessingBatch: (id: string) =>
    api.get(`/cases/preprocessing/${id}/`),
  createPreprocessingBatch: (data: Record<string, unknown>) =>
    api.post("/cases/preprocessing/", data),
  pendingPreprocessing: () =>
    api.get("/cases/preprocessing/pending/"),
  savePreprocessing: (id: string, data: Record<string, unknown>) =>
    api.post(`/cases/preprocessing/${id}/save_processing/`, data),
  completePreprocessing: (id: string) =>
    api.post(`/cases/preprocessing/${id}/complete/`),

  listExtractionBatches: (params?: Record<string, unknown>) => api.get("/cases/extraction/", { params }),
  getExtractionBatch: (id: string) => api.get(`/cases/extraction/${id}/`),
  createExtractionBatch: (data: { case_sample_ids: string[] }) => api.post("/cases/extraction/", data),
  pendingExtraction: () => api.get("/cases/extraction/pending/"),
  getQCandidates: (search: string) => api.get(`/cases/extraction/qc_candidates/?search=${encodeURIComponent(search)}`),
  deleteExtractionBatch: (id: string) => api.delete(`/cases/extraction/${id}/`),
  saveExtraction: (id: string, data: any) => api.post(`/cases/extraction/${id}/save_processing/`, data),
  completeExtraction: (id: string) => api.post(`/cases/extraction/${id}/complete/`),

  listLibraryBatches: (params?: Record<string, unknown>) => api.get("/cases/library/", { params }),
  getLibraryBatch: (id: string) => api.get(`/cases/library/${id}/`),
  createLibraryBatch: (data: { case_sample_ids: string[] }) => api.post("/cases/library/", data),
  pendingLibrary: () => api.get("/cases/library/pending/"),
  saveLibrary: (id: string, data: any) => api.post(`/cases/library/${id}/save_processing/`, data),
  completeLibrary: (id: string) => api.post(`/cases/library/${id}/complete/`),
  deleteLibraryBatch: (id: string) => api.delete(`/cases/library/${id}/`),

  listPoolingBatches: (params?: Record<string, unknown>) => api.get("/cases/pooling/", { params }),
  getPoolingBatch: (id: string) => api.get(`/cases/pooling/${id}/`),
  createPoolingBatch: (data: { case_sample_ids: string[] }) => api.post("/cases/pooling/", data),
  pendingPooling: () => api.get("/cases/pooling/pending/"),
  savePooling: (id: string, data: any) => api.post(`/cases/pooling/${id}/save_processing/`, data),
  completePooling: (id: string) => api.post(`/cases/pooling/${id}/complete/`),
  deletePoolingBatch: (id: string) => api.delete(`/cases/pooling/${id}/`),

  listHybSeqBatches: (params?: Record<string, unknown>) => api.get("/cases/hybseq/", { params }),
  getHybSeqBatch: (id: string) => api.get(`/cases/hybseq/${id}/`),
  createHybSeqBatch: (data: { case_sample_ids: string[] }) => api.post("/cases/hybseq/", data),
  pendingHybSeqMixes: () => api.get("/cases/hybseq/pending_mixes/"),
  saveHybSeq: (id: string, data: any) => api.post(`/cases/hybseq/${id}/save_processing/`, data),
  completeHybSeq: (id: string) => api.post(`/cases/hybseq/${id}/complete/`),
  deleteHybSeqBatch: (id: string) => api.delete(`/cases/hybseq/${id}/`),

  listBioinfoBatches: (params?: Record<string, unknown>) => api.get("/cases/bioinformatics/", { params }),
  getBioinfoBatch: (id: string) => api.get(`/cases/bioinformatics/${id}/`),
  createBioinfoBatch: (data: { case_sample_ids: string[] }) => api.post("/cases/bioinformatics/", data),
  pendingBioinfo: () => api.get("/cases/bioinformatics/pending/"),
  saveBioinfo: (id: string, data: any) => api.post(`/cases/bioinformatics/${id}/save_processing/`, data),
  completeBioinfo: (id: string) => api.post(`/cases/bioinformatics/${id}/complete/`),

  uploadReceiptPhoto: (id: string, formData: FormData) =>
    api.post(`/cases/${id}/upload-receipt-photo/`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
};

// ── Public Registration (NIPPT) ───────────────────────────────
export const publicRegisterApi = {
  info: (token: string) =>
    api.get<{ case_number: string; panel: string; panel_name: string; expires: string }>(`/cases/public/info/${token}/`),
  submit: (token: string, data: { roles: string[]; patient_names: string[]; dob?: string[] }) =>
    api.post<{ case_number: string; message: string; sample_count: number }>(`/cases/public/register/${token}/`, data),
};

// ── Workflow Steps (NIPPT) ────────────────────────────────────
export const workflowStepsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Pageable<WorkflowStep>>("/runs/steps/", { params }),
  get: (id: string) => api.get<WorkflowStep>(`/runs/steps/${id}/`),
  start: (id: string) => api.post<WorkflowStep>(`/runs/steps/${id}/start/`),
  complete: (id: string, data?: Record<string, unknown>) =>
    api.post<WorkflowStep>(`/runs/steps/${id}/complete/`, data),
  qcReview: (id: string, data: { qc_result: string; qc_notes?: string }) =>
    api.post<WorkflowStep>(`/runs/steps/${id}/qc_review/`, data),
  skip: (id: string) =>
    api.post<WorkflowStep>(`/runs/steps/${id}/skip/`),
  deleteStep: (id: string) => api.post(`/runs/steps/${id}/delete_step/`),
};

// ============ NIPPT Pre-Processing ============


