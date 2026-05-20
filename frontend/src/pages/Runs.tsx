import { useState, useEffect, useMemo } from "react";
import { Table, Card, Button, Space, Tag, Typography, Modal, Form, Select, Input, message, Transfer, DatePicker, Tabs, Badge, Tooltip, Popconfirm, Dropdown, Checkbox } from "antd";
import type { TransferItem } from "antd/es/transfer";
import { PlusOutlined, ReloadOutlined, EyeOutlined, ArrowRightOutlined, StepForwardOutlined, CheckCircleOutlined, PlayCircleOutlined, FileTextOutlined, MinusCircleOutlined, DeleteOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import DashboardLayout from "../components/DashboardLayout";
import { runsApi, samplesApi, panelsApi, instrumentsApi, stepsApi, usersApi } from "../api";
import type { Run, Sample, TestPanel, Instrument, User } from "../api/types";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

const { Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

const STATUS_COLORS: Record<string, string> = {
  PLANNED: "default", LIBRARY_PREP: "blue", SEQUENCING: "purple",
  ANALYZING: "orange", QC_REVIEW: "gold", COMPLETED: "green", FAILED: "red",
};

const STEP_STATUS_COLORS: Record<string, string> = {
  PENDING: "default", IN_PROGRESS: "blue", COMPLETED: "green", SKIPPED: "orange", FAILED: "red",
};

const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Planned" },
  { value: "LIBRARY_PREP", label: "Library Prep" },
  { value: "SEQUENCING", label: "Sequencing" },
  { value: "ANALYZING", label: "Analyzing" },
  { value: "QC_REVIEW", label: "QC Review" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
];

const STATUS_FLOW = ["PLANNED", "LIBRARY_PREP", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"];

export default function Runs() {
  const [form] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [stepsVisible, setStepsVisible] = useState(false);
  const [tableLoading, setTableLoading] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [panelFilter, setPanelFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);

  const fetchRuns = async () => {
    setTableLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (statusFilter) params.status = statusFilter;
      if (panelFilter) params.panel = panelFilter;
      if (dateRange[0]) params.planned_date__from = dateRange[0];
      if (dateRange[1]) params.planned_date__to = dateRange[1];
      const res = await runsApi.list(params);
      setRuns(res.data.results ?? res.data);
    } catch {
      message.error("Failed to load runs");
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => { fetchRuns(); }, [statusFilter, panelFilter, dateRange]);

  const handleDelete = async (record: Run) => {
    try {
      await runsApi.delete(record.id);
      message.success(`Deleted ${record.run_number}`);
      fetchRuns();
    } catch {
      message.error("Failed to delete run");
    }
  };

  // ── Samples Transfer ───────────────────────────────────────
  const [availableSamples, setAvailableSamples] = useState<TransferItem[]>([]);
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

  // Sample detail map (for assignment table)
  const [sampleDetailMap, setSampleDetailMap] = useState<Record<string, Sample>>({});
  // Assignments: { sampleId: { well_position, index_sequence, pool_group, barcode } }
  const [sampleAssignments, setSampleAssignments] = useState<Record<string, { well_position?: string; index_sequence?: string; pool_group?: string; barcode?: string }>>({});

  // ── Panels & Instruments ───────────────────────────────────────
  const [panels, setPanels] = useState<TestPanel[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);

  const fetchCreateData = async () => {
    setSamplesLoading(true);
    try {
      const [samplesRes, panelsRes, instRes] = await Promise.all([
        samplesApi.list({ status: "ACCEPTED", limit: 200 }),
        panelsApi.list(),
        instrumentsApi.list(),
      ]);

      const samples: Sample[] = (samplesRes.data.results ?? samplesRes.data) as Sample[];
      const detailMap: Record<string, Sample> = {};
      samples.forEach((s) => { detailMap[s.id] = s; });
      setSampleDetailMap(detailMap);
      setAvailableSamples(samples.map((s) => ({
        key: s.id,
        title: `${s.sample_id}-${s.patient_id || "N/A"}`,
        description: `Type: ${s.sample_type_code} | Received: ${s.receipt_date}`,
      })));

      const panelData: TestPanel[] = ((panelsRes.data as any).results ?? panelsRes.data) as TestPanel[];
      setPanels(panelData.filter((p) => p.is_active));

      const instData: Instrument[] = (instRes.data.results ?? instRes.data) as Instrument[];
      setInstruments(instData.filter((i) => i.status === "ACTIVE" && i.instrument_type === "SEQUENCER"));
    } catch {
      message.error("Failed to load create data");
    } finally {
      setSamplesLoading(false);
    }
  };

  useEffect(() => {
    if (createOpen) {
      fetchCreateData();
      setSelectedSamples([]);
      setSampleAssignments({});
    }
  }, [createOpen]);

  // ── Run detail ──────────────────────────────────────────
  const [runDetail, setRunDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stepRecordModal, setStepRecordModal] = useState(false);
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const [stepForm] = Form.useForm();
  const [stepSubmitting, setStepSubmitting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState("matrix");
  // Result entry state { runSampleId: { field: value } }
  const [resultEntries, setResultEntries] = useState<Record<string, Record<string, unknown>>>({});
  const [savingResults, setSavingResults] = useState(false);

  const fetchRunDetail = async (runId: string) => {
    setDetailLoading(true);
    try {
      const res = await runsApi.detail(runId);
      setRunDetail(res.data);
    } catch {
      message.error("Failed to load run details");
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await usersApi.list({ limit: 200 });
      setUsers((res.data.results ?? res.data) as User[]);
    } catch { /* silent */ }
  };

  const openSteps = (run: Run) => {
    setSelectedRun(run);
    setStepsVisible(true);
    setActiveTab("matrix");
    fetchRunDetail(run.id);
    fetchUsers();
  };

  // ── Matrix helpers ────────────────────────────────────────
  const matrixSteps = useMemo(() => {
    const allSteps: any[] = runDetail?.steps || [];
    const map = new Map<string, any>();
    allSteps.forEach((s: any) => {
      const key = s.step_id ?? s.step_name;
      if (!map.has(key) || (s.step_order ?? 0) < (map.get(key)?.step_order ?? Infinity)) {
        map.set(key, s);
      }
    });
    return Array.from(map.values()).sort(
      (a, b) => (a.step_order ?? 0) - (b.step_order ?? 0)
    );
  }, [runDetail?.steps]);

  const samplesInRun = useMemo(() => {
    return (runDetail?.run_samples || []) as any[];
  }, [runDetail?.run_samples]);

  const getStepForSample = (sampleId: string, stepId: string) => {
    const allSteps: any[] = runDetail?.steps || [];
    return allSteps.find(
      (s: any) => s.sample === sampleId && (s.step_id ?? s.step_name) === stepId
    );
  };

  // sample_id → Sample ID mapping for lookup
  const sampleIdBySampleId = useMemo(() => {
    const map: Record<string, string> = {};
    (runDetail?.run_samples || []).forEach((rs: any) => {
      if (rs.sample_barcode && rs.sample) {
        map[rs.sample_barcode] = rs.sample;
      }
    });
    return map;
  }, [runDetail?.run_samples]);

  const handleAssignPerformer = async (stepId: string, userId: string | undefined) => {
    try {
      await stepsApi.update(stepId, { performed_by: userId || null });
      if (selectedRun) fetchRunDetail(selectedRun.id);
    } catch {
      message.error("Failed to update performer");
    }
  };

  const handleStepStart = async (step: any) => {
    try {
      await stepsApi.start(step.id);
      message.success(`Step "${step.step_name}" started`);
      if (selectedRun) fetchRunDetail(selectedRun.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || "Failed to start step");
    }
  };

  const handleStepComplete = async (values: any) => {
    if (!selectedStep) return;
    setStepSubmitting(true);
    try {
      const data: any = {};
      if (values.observations) data.observations = values.observations;
      if (values.reagent_lot_ids) data.reagent_lot_ids = values.reagent_lot_ids;
      if (values.instrument_id) data.instrument_id = values.instrument_id;
      if (values.performed_by) data.performed_by = values.performed_by;
      if (values.deviation_flag) data.deviation_flag = true;
      if (values.deviation_note) data.deviation_note = values.deviation_note;

      await stepsApi.complete(selectedStep.id, data);
      message.success(`Step "${selectedStep.step_name}" completed`);
      setStepRecordModal(false);
      stepForm.resetFields();
      setSelectedStep(null);
      if (selectedRun) fetchRunDetail(selectedRun.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || "Failed to complete step");
    } finally {
      setStepSubmitting(false);
    }
  };

  const handleStepSkip = async (step: any) => {
    try {
      await stepsApi.skip(step.id);
      message.success(`Step "${step.step_name}" skipped`);
      if (selectedRun) fetchRunDetail(selectedRun.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || "Failed to skip step");
    }
  };

  const [batchLoading, setBatchLoading] = useState<string | null>(null);

  const handleBatchStart = async (stepId: string) => {
    setBatchLoading(stepId);
    const allSteps = (runDetail?.steps || []) as any[];
    const targetSteps = allSteps.filter(
      (s: any) => (s.step_id ?? s.step_name) === stepId && s.status === "PENDING"
    );
    let ok = 0, fail = 0;
    for (const s of targetSteps) {
      try { await stepsApi.start(s.id); ok++; }
      catch { fail++; }
    }
    setBatchLoading(null);
    if (ok > 0 && fail === 0) message.success(`Started ${ok} step(s)`);
    else if (ok > 0) message.warning(`Started ${ok}, failed ${fail}`);
    else message.error("No pending steps to start");
    if (selectedRun) fetchRunDetail(selectedRun.id);
  };

  const handleBatchSkip = async (stepId: string) => {
    setBatchLoading(stepId);
    const allSteps = (runDetail?.steps || []) as any[];
    const targetSteps = allSteps.filter(
      (s: any) => (s.step_id ?? s.step_name) === stepId && s.status === "PENDING"
    );
    let ok = 0, fail = 0;
    for (const s of targetSteps) {
      try { await stepsApi.skip(s.id); ok++; }
      catch { fail++; }
    }
    setBatchLoading(null);
    if (ok > 0 && fail === 0) message.success(`Skipped ${ok} step(s)`);
    else if (ok > 0) message.warning(`Skipped ${ok}, failed ${fail}`);
    else message.error("No pending steps to skip");
    if (selectedRun) fetchRunDetail(selectedRun.id);
  };

  const handleRowBatchStart = async (sampleId: string) => {
    setBatchLoading(`row_${sampleId}`);
    const allSteps = (runDetail?.steps || []) as any[];
    const targetSteps = allSteps.filter(
      (s: any) => s.sample === sampleId && s.status === "PENDING"
    );
    let ok = 0, fail = 0;
    for (const s of targetSteps) {
      try { await stepsApi.start(s.id); ok++; }
      catch { fail++; }
    }
    setBatchLoading(null);
    if (ok > 0 && fail === 0) message.success(`Started ${ok} step(s) for sample`);
    else if (ok > 0) message.warning(`Started ${ok}, failed ${fail}`);
    else message.error("No pending steps to start");
    if (selectedRun) fetchRunDetail(selectedRun.id);
  };

  const handleSaveResults = async () => {
    if (!selectedRun || !runDetail) return;
    setSavingResults(true);
    try {
      const results: Record<string, Record<string, unknown>> = {};
      (runDetail.run_samples || []).forEach((rs: any) => {
        const entry = resultEntries[rs.id];
        if (entry && Object.keys(entry).length > 0) {
          results[rs.id] = entry;
        }
      });
      if (Object.keys(results).length === 0) {
        message.warning("No results to save");
        return;
      }
      await runsApi.updateResults(selectedRun.id, results);
      message.success("Results saved");
      setResultEntries({});
      if (selectedRun) fetchRunDetail(selectedRun.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || "Failed to save results");
    } finally {
      setSavingResults(false);
    }
  };

  const resultColumns = useMemo(() => {
    const makeInput = (key: string, placeholder: string, width = 100) => ({
      title: placeholder,
      key,
      width,
      render: (_: any, record: any) => (
        <Input
          size="small"
          placeholder={placeholder}
          value={String(resultEntries[record.id]?.[key] ?? record.result_summary?.[key] ?? "")}
          onChange={(e) => setResultEntries((prev) => ({
            ...prev,
            [record.id]: { ...prev[record.id], [key]: e.target.value },
          }))}
        />
      ),
    });
    const makeSelect = (key: string, placeholder: string, opts: {value: string; label: string}[], width = 120) => ({
      title: placeholder,
      key,
      width,
      render: (_: any, record: any) => (
        <Select
          size="small"
          placeholder={placeholder}
          value={resultEntries[record.id]?.[key] ?? record.result_summary?.[key] ?? undefined}
          onChange={(v) => setResultEntries((prev) => ({
            ...prev,
            [record.id]: { ...prev[record.id], [key]: v },
          }))}
          options={opts}
          allowClear
          style={{ width }}
        />
      ),
    });

    const panelCode = runDetail?.panel_code;
    const baseCols: any[] = [
      { title: "Sample ID", dataIndex: "sample_barcode", key: "sample_id", width: 140, render: (t: string) => <Text strong>{t}</Text> },
      { title: "Patient", dataIndex: "sample_patient_id", key: "patient", width: 120, render: (t: string) => t || "—" },
    ];

    if (panelCode === "HPV") {
      return [
        ...baseCols,
        makeSelect("overall_result", "Result", [
          { value: "NEGATIVE", label: "NEGATIVE" },
          { value: "POSITIVE", label: "POSITIVE" },
        ]),
        makeSelect("hpv_16", "HPV16", [
          { value: "NEGATIVE", label: "NEGATIVE" },
          { value: "POSITIVE", label: "POSITIVE" },
        ], 90),
        makeSelect("hpv_18", "HPV18", [
          { value: "NEGATIVE", label: "NEGATIVE" },
          { value: "POSITIVE", label: "POSITIVE" },
        ], 90),
        makeInput("notes", "Notes", 150),
      ];
    }
    if (panelCode === "NIPT" || panelCode === "NIPT_PLUS") {
      const getVal = (record: any, key: string) =>
        resultEntries[record.id]?.[key] ?? record.result_summary?.[key];
      const zInput = (key: string, title: string, w = 100) => ({
        title,
        key,
        width: w,
        render: (_: any, record: any) => {
          const v = String(getVal(record, key) ?? "");
          const num = parseFloat(v);
          const alert = !isNaN(num) && num > 3;
          return (
            <Input size="small" placeholder={title} value={v}
              onChange={(e) => setResultEntries((prev) => ({
                ...prev, [record.id]: { ...prev[record.id], [key]: e.target.value },
              }))}
              style={alert ? { borderColor: "#ff4d4f", backgroundColor: "#fff1f0" } : undefined}
            />
          );
        },
      });
      return [
        ...baseCols,
        {
          title: "Result", key: "result", width: 130,
          render: (_: any, record: any) => {
            const val = getVal(record, "result");
            return (
              <Select size="small" placeholder="Result" value={val}
                onChange={(v) => setResultEntries((prev) => ({
                  ...prev, [record.id]: { ...prev[record.id], result: v },
                }))}
                options={[
                  { value: "LOW_RISK", label: "LOW RISK" },
                  { value: "HIGH_RISK", label: "⚠ HIGH RISK" },
                ]}
                allowClear
                style={{ width: 130 }}
                status={val === "HIGH_RISK" ? "error" : undefined}
              />
            );
          },
        },
        zInput("z_score_13", "Z-Score 13"),
        zInput("z_score_18", "Z-Score 18"),
        zInput("z_score_21", "Z-Score 21"),
        {
          title: "FF %", key: "fetal_fraction", width: 90,
          render: (_: any, record: any) => {
            const v = String(getVal(record, "fetal_fraction") ?? "");
            const num = parseFloat(v);
            const low = !isNaN(num) && num < 4 && v !== "";
            return (
              <Input size="small" placeholder="FF%" value={v}
                onChange={(e) => setResultEntries((prev) => ({
                  ...prev, [record.id]: { ...prev[record.id], fetal_fraction: e.target.value },
                }))}
                status={low ? "warning" : undefined}
              />
            );
          },
        },
        makeSelect("fetal_sex", "Sex", [
          { value: "Male", label: "Male" },
          { value: "Female", label: "Female" },
        ], 100),
        makeInput("notes", "Notes", 150),
      ];
    }
    return [...baseCols, makeInput("result_notes", "Result Notes", 200)];
  }, [runDetail?.panel_code, resultEntries]);

  const matrixColumns = useMemo(() => {
    const baseCols: any[] = [
      {
        title: "Sample",
        key: "sample",
        fixed: "left",
        width: 220,
        render: (_: unknown, record: any) => (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Text strong copyable={{ text: record.sample_barcode }}>
                {record.sample_barcode}
              </Text>
              <Tooltip title="Start all pending steps for this sample">
                <Button
                  size="small"
                  type="text"
                  icon={<PlayCircleOutlined />}
                  loading={batchLoading === `row_${record.sample}`}
                  onClick={(e) => { e.stopPropagation(); handleRowBatchStart(record.sample); }}
                  style={{ color: "#1677ff", padding: "0 2px", minWidth: 20, height: 20 }}
                />
              </Tooltip>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.sample_patient_id || "—"}
            </Text>
          </div>
        ),
      },
    ];
    const stepCols = matrixSteps.map((step: any) => {
      const sid = step.step_id ?? step.step_name;
      return {
        title: (
          <Dropdown
            menu={{
              items: [
                { key: "start", label: "Start All", icon: <PlayCircleOutlined />, onClick: () => handleBatchStart(sid) },
                { key: "skip", label: "Skip All", icon: <MinusCircleOutlined />, onClick: () => handleBatchSkip(sid) },
              ],
            }}
            trigger={["contextMenu"]}
          >
            <Tooltip title={`Step ${step.step_order}: ${step.step_name}` + " (right-click for batch)"}>
              <span style={{ writingMode: "vertical-rl", textOrientation: "mixed", fontSize: 12, cursor: "context-menu" }}>
                {batchLoading === sid ? "…" : step.step_name}
              </span>
            </Tooltip>
          </Dropdown>
        ),
        key: sid,
        width: 80,
        align: "center" as const,
        render: (_: unknown, record: any) => {
          const sampleId = sampleIdBySampleId[record.sample_barcode] || record.sample;
          const s = getStepForSample(sampleId, sid);
          const status = s?.status || "PENDING";
          const color = STEP_STATUS_COLORS[status] || "default";
          return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Tag color={color} style={{ fontSize: 10, padding: "0 4px" }}>
                {status === "COMPLETED" ? "✓" : status === "SKIPPED" ? "⊘" : status === "IN_PROGRESS" ? "▶" : "○"}
              </Tag>
              {status === "PENDING" && (
                <Button.Group size="small">
                  <Tooltip title="Start">
                    <Button icon={<PlayCircleOutlined />} onClick={() => handleStepStart(s)} />
                  </Tooltip>
                  <Tooltip title="Skip">
                    <Button icon={<MinusCircleOutlined />} onClick={() => handleStepSkip(s)} />
                  </Tooltip>
                </Button.Group>
              )}
              {status === "IN_PROGRESS" && (
                <Button size="small" type="primary" style={{ fontSize: 10 }}
                  onClick={() => { setSelectedStep(s); setStepRecordModal(true); }}
                >
                  Done
                </Button>
              )}
              {status === "COMPLETED" && s.completed_at && (
                <Tooltip title={`${s.performed_by_name || '—'} · ${dayjs(s.completed_at).format('MM-DD HH:mm')}`}>
                  <Text type="secondary" style={{ fontSize: 9, lineHeight: '12px' }}>
                    {s.performed_by_name ? s.performed_by_name.split(' ').map((n: string) => n[0]).join('') : '?'}
                    <br />{dayjs(s.completed_at).format('HH:mm')}
                  </Text>
                </Tooltip>
              )}
            </div>
          );
        },
      };
    });
    return [...baseCols, ...stepCols];
  }, [matrixSteps, runDetail]);

  const columns = [
    { title: "Run #", dataIndex: "run_number", key: "run_number", width: 200,
      render: (t: string) => <Text strong>{t}</Text> },
    { title: "Batch ID", dataIndex: "barcode", key: "barcode", width: 150,
      render: (t: string) => t || <Text type="secondary">—</Text> },
    { title: "Panel", dataIndex: "panel_code", key: "panel_code", width: 120,
      render: (t: string) => <Tag color="blue">{t}</Tag> },
    { title: "Sequencer", dataIndex: "sequencer_name", key: "sequencer_name", width: 150,
      render: (t: string) => t || <Text type="secondary">Not assigned</Text> },
    { title: "Samples", dataIndex: "sample_count", key: "sample_count", width: 100 },
    {
      title: "Status", dataIndex: "status", key: "status", width: 160,
      render: (s: string) => (
        <Tag color={STATUS_COLORS[s]} style={{ borderRadius: 6 }}>
          <ArrowRightOutlined style={{ marginRight: 4, fontSize: 10 }} />
          {s.replace(/_/g, " ")}
        </Tag>
      ),
    },
    {
      title: "Planned", dataIndex: "planned_date", key: "planned_date", width: 130,
      render: (d: string) => d || "-",
    },
    {
      title: "Actions", key: "actions", width: 280,
      render: (_: unknown, record: Run) => {
        const canAdvance = record.status !== "COMPLETED" && record.status !== "FAILED";
        const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(record.status) + 1];
        const isLast = record.status === "QC_REVIEW";
        return (
          <Space size="small">
            <Button icon={<EyeOutlined />} size="small" type="text"
              onClick={() => openSteps(record)} />
            {canAdvance && nextStatus && !isLast && (
              <Button icon={<StepForwardOutlined />} size="small"
                onClick={async () => {
                  try {
                    await runsApi.advanceStatus(record.id, nextStatus);
                    message.success(`Advanced to ${nextStatus.replace(/_/g, " ")}`);
                    fetchRuns();
                  } catch (err: any) {
                    const msg = err?.response?.data?.error || err?.response?.data?.detail || "Failed to advance status";
                    message.error(msg);
                  }
                }}>
                {nextStatus.replace(/_/g, " ")}
              </Button>
            )}
            {isLast && (
              <Button icon={<CheckCircleOutlined />} size="small" type="primary"
                onClick={async () => {
                  try {
                    await runsApi.advanceStatus(record.id, "COMPLETED");
                    message.success("Run completed");
                    fetchRuns();
                  } catch (err: any) {
                    const msg = err?.response?.data?.error || err?.response?.data?.detail || "Failed to complete run";
                    message.error(msg);
                  }
                }}>
                Complete
              </Button>
            )}
            <Popconfirm
              title="Delete run?"
              description={`This will delete ${record.run_number}. Confirm?`}
              onConfirm={() => handleDelete(record)}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Button icon={<DeleteOutlined />} size="small" type="text" danger />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const handleCreate = async (values: Record<string, unknown>) => {
    if (selectedSamples.length === 0) {
      message.error("Please assign at least one sample to the run");
      return;
    }
    setSubmitting(true);
    try {
      const plannedDate = values.planned_date
        ? (values.planned_date as Dayjs).format("YYYY-MM-DD")
        : undefined;

      const payload: Record<string, unknown> = {
        panel: values.panel,
        samples: selectedSamples,
        sample_assignments: sampleAssignments,
        planned_date: plannedDate,
        notes: values.notes || "",
      };
      if (values.sequencer) {
        payload.sequencer = values.sequencer;
      }
      if (values.barcode) {
        payload.barcode = values.barcode;
      }
      await runsApi.create(payload);
      message.success("Run created successfully");
      setCreateOpen(false);
      form.resetFields();
      setSelectedSamples([]);
      setSampleAssignments({});
      fetchRuns();
    } catch (err: any) {
      const detail = err?.response?.data;
      if (detail && typeof detail === "object") {
        const msgs = Object.entries(detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
        message.error(msgs.join("; "));
      } else {
        message.error("Failed to create run");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout header="Sequencing Runs">
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space wrap>
            <Input.Search placeholder="Search run number..." style={{ width: 250 }} allowClear />
            <Select
              placeholder="Filter by status"
              allowClear
              style={{ width: 160 }}
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
            />
            <Select
              placeholder="Panel"
              allowClear
              style={{ width: 180 }}
              options={panels.map(p => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
              value={panelFilter}
              onChange={(v) => setPanelFilter(v)}
            />
            <RangePicker
              placeholder={["From", "To"]}
              style={{ width: 240 }}
              format="YYYY-MM-DD"
              value={[
                dateRange[0] ? dayjs(dateRange[0]) : null,
                dateRange[1] ? dayjs(dateRange[1]) : null,
              ]}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([
                    dates[0].format("YYYY-MM-DD"),
                    dates[1].format("YYYY-MM-DD"),
                  ]);
                } else {
                  setDateRange([null, null]);
                }
              }}
              allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={fetchRuns}>Refresh</Button>
          </Space>
          <Space>
            <Text type="secondary">{runs.length} total</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Create Run
            </Button>
          </Space>
        </div>
      </Card>

      <Card>
        <Table<Run>
          columns={columns}
          dataSource={runs}
          rowKey="id"
          loading={tableLoading}
          pagination={{ showTotal: (t) => `Total ${t} runs` }}
        />
      </Card>

      {/* Create Run Modal */}
      <Modal
        title={<span><PlusOutlined style={{ marginRight: 8, color: "#1677ff" }} /> Create New Run</span>}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item name="panel" label="Test Panel" rules={[{ required: true, message: "Please select a test panel" }]}>
            <Select
              placeholder="Select test panel"
              options={panels.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
            />
          </Form.Item>

          <Form.Item name="sequencer" label="Sequencer">
            <Select
              placeholder="Select sequencer (optional)"
              allowClear
              options={instruments.map((i) => ({ value: i.id, label: `${i.name} (${i.model})` }))}
            />
          </Form.Item>

          <Form.Item name="barcode" label="Run Barcode / Batch ID">
            <Input placeholder="Optional barcode for this run (e.g. BATCH-20241201)" />
          </Form.Item>

          <Form.Item name="planned_date" label="Planned Date">
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>

          <Form.Item label="Assign Samples" required>
            {samplesLoading ? <Text type="secondary">Loading samples...</Text> : (
              <Transfer
                dataSource={availableSamples}
                targetKeys={selectedSamples}
                onChange={(keys) => setSelectedSamples(keys as string[])}
                titles={["Available Samples", "In This Run"]}
                listStyle={{ width: 260, height: 300 }}
                render={(item) => item.title ?? ""}
              />
            )}
          </Form.Item>

          {selectedSamples.length > 0 && (
            <Form.Item label="Sample Configuration">
              <Table
                size="small"
                pagination={false}
                dataSource={selectedSamples.map((sid) => {
                  const s = sampleDetailMap[sid];
                  const a = sampleAssignments[sid] || {};
                  return {
                    sample_id: sid,
                    sample_code: s?.sample_id || sid.slice(0, 8),
                    barcode: a.barcode || "",
                    patient_name: s?.patient_name || "N/A",
                    well_position: a.well_position || "",
                    index_sequence: a.index_sequence || "",
                    pool_group: a.pool_group || "",
                  };
                })}
                rowKey="sample_id"
                columns={[
                  { title: "Sample ID", dataIndex: "sample_code", key: "sample_code", width: 140, render: (t: string) => <Text code copyable={{ text: t }}>{t}</Text> },
                  { title: "Barcode", dataIndex: "barcode", key: "barcode", width: 140, render: (_: any, r: any) => (
                    <Input size="small" placeholder="Scan barcode" value={r.barcode} onChange={(e) => setSampleAssignments((prev) => ({ ...prev, [r.sample_id]: { ...prev[r.sample_id], barcode: e.target.value } }))} />
                  )},
                  { title: "Patient", dataIndex: "patient_name", key: "patient", width: 100, render: (t: string) => t || "—" },
                  { title: "Well", dataIndex: "well_position", key: "well", width: 90, render: (_: any, r: any) => (
                    <Input size="small" placeholder="A01" value={r.well_position} onChange={(e) => setSampleAssignments((prev) => ({ ...prev, [r.sample_id]: { ...prev[r.sample_id], well_position: e.target.value } }))} />
                  )},
                  { title: "Index", dataIndex: "index_sequence", key: "index", width: 130, render: (_: any, r: any) => (
                    <Input size="small" placeholder="N701+S501" value={r.index_sequence} onChange={(e) => setSampleAssignments((prev) => ({ ...prev, [r.sample_id]: { ...prev[r.sample_id], index_sequence: e.target.value } }))} />
                  )},
                  { title: "Pool", dataIndex: "pool_group", key: "pool", width: 100, render: (_: any, r: any) => (
                    <Input size="small" placeholder="Pool-A" value={r.pool_group} onChange={(e) => setSampleAssignments((prev) => ({ ...prev, [r.sample_id]: { ...prev[r.sample_id], pool_group: e.target.value } }))} />
                  )},
                ]}
              />
            </Form.Item>
          )}

          <Form.Item name="notes" label="Notes">
            <TextArea rows={2} placeholder="Run notes..." />
          </Form.Item>

          <div style={{ textAlign: "right" }}>
            <Space>
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Create Run
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>

      {/* Run Detail Modal */}
      <Modal
        title={`Run: ${selectedRun?.run_number}`}
        open={stepsVisible}
        onCancel={() => setStepsVisible(false)}
        footer={<Button onClick={() => setStepsVisible(false)}>Close</Button>}
        width={900}
      >
        {selectedRun && (
          <div style={{ marginBottom: 16 }}>
            <Space wrap size="large" style={{ marginBottom: 4 }}>
              <span><strong>Panel:</strong> {selectedRun.panel_name}</span>
              {selectedRun.protocol_name && <span><strong>Protocol:</strong> {selectedRun.protocol_name}</span>}
              <span><strong>Sequencer:</strong> {selectedRun.sequencer_name || "Not assigned"}</span>
              <span><strong>Samples:</strong> {selectedRun.sample_count}</span>
              <span><strong>Status:</strong> <Tag color={STATUS_COLORS[selectedRun.status]}>{selectedRun.status.replace(/_/g, " ")}</Tag></span>
            </Space>
            <div style={{ fontSize: 12, color: "#888" }}>
              {selectedRun.barcode && <span style={{ marginRight: 16 }}><strong>Barcode:</strong> {selectedRun.barcode}</span>}
              {selectedRun.operator_name && <span style={{ marginRight: 16 }}><strong>Operator:</strong> {selectedRun.operator_name}</span>}
              {selectedRun.planned_date && <span style={{ marginRight: 16 }}><strong>Planned:</strong> {selectedRun.planned_date}</span>}
              {selectedRun.start_date && <span style={{ marginRight: 16 }}><strong>Started:</strong> {dayjs(selectedRun.start_date).format("YYYY-MM-DD HH:mm")}</span>}
              {selectedRun.end_date && <span style={{ marginRight: 16 }}><strong>Ended:</strong> {dayjs(selectedRun.end_date).format("YYYY-MM-DD HH:mm")}</span>}
              {selectedRun.notes && <span><strong>Notes:</strong> {selectedRun.notes}</span>}
            </div>
          </div>
        )}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "matrix",
              label: (
                <span>
                  <FileTextOutlined style={{ marginRight: 4 }} />
                  Matrix
                </span>
              ),
              children: detailLoading ? (
                <Text type="secondary">Loading matrix...</Text>
              ) : (
                <Table
                  size="small"
                  scroll={{ x: matrixSteps.length * 90 + 220 }}
                  dataSource={samplesInRun}
                  rowKey="id"
                  pagination={false}
                  columns={matrixColumns}
                  locale={{ emptyText: "No samples in this run" }}
                />
              ),
            },
            {
              key: "samples",
              label: (
                <span>
                  Samples
                  <Badge
                    count={samplesInRun.length}
                    style={{ marginLeft: 8, backgroundColor: "#1677ff" }}
                  />
                </span>
              ),
              children: detailLoading ? (
                <Text type="secondary">Loading samples...</Text>
              ) : (
                <Table
                  size="small"
                  dataSource={samplesInRun}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    { title: "Sample ID", dataIndex: "sample_barcode", key: "sample_id", render: (t: string) => <Text strong copyable={{ text: t }}>{t}</Text> },
                    { title: "Patient ID", dataIndex: "sample_patient_id", key: "patient_id", render: (t: string) => t || "—" },
                    { title: "Well", dataIndex: "well_position", key: "well", width: 80, render: (t: string) => t || "—" },
                    { title: "Index", dataIndex: "index_sequence", key: "index", width: 120, render: (t: string) => t || "—" },
                    { title: "Pool", dataIndex: "pool_group", key: "pool", width: 100, render: (t: string) => t || "—" },
                    { title: "Status", dataIndex: "status", key: "status", width: 120, render: (s: string) => (
                      <Tag color={s === "PASSED_QC" ? "green" : s === "FAILED_QC" ? "red" : s === "SEQUENCED" ? "blue" : s === "ANALYZED" ? "cyan" : "default"}>
                        {s.replace(/_/g, " ")}
                      </Tag>
                    )},
                  ]}
                  locale={{ emptyText: "No samples in this run" }}
                />
              ),
            },
            {
              key: "steps",
              label: "Workflow Steps",
              children: detailLoading ? (
                <Text type="secondary">Loading steps...</Text>
              ) : (
                <Table
                  size="small"
                  dataSource={runDetail?.steps || []}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    { title: "Step", dataIndex: "step_name", key: "name", render: (t: string, r: any) => (
                      <span>{r.step_order}. {t}</span>
                    )},
                    { title: "Sample", dataIndex: "sample_barcode", key: "sample", width: 140, render: (t: string) => (
                      <Text strong copyable={{ text: t }}>{t}</Text>
                    )},
                    { title: "Status", dataIndex: "status", key: "status", width: 100, render: (s: string) => (
                      <Tag color={STEP_STATUS_COLORS[s] || "default"}>{s.replace(/_/g, " ")}</Tag>
                    )},
                    { title: "Started", dataIndex: "started_at", key: "started", width: 130, render: (t: string) => t ? dayjs(t).format("MM-DD HH:mm") : "—" },
                    { title: "Completed", dataIndex: "completed_at", key: "completed", width: 130, render: (t: string) => t ? dayjs(t).format("MM-DD HH:mm") : "—" },
                    { title: "Duration", key: "duration", width: 90, render: (_: any, r: any) => {
                      if (r.started_at && r.completed_at) {
                        const dur = dayjs(r.completed_at).diff(dayjs(r.started_at), "minute");
                        return dur >= 60 ? Math.floor(dur / 60) + "h " + (dur % 60) + "m" : dur + "m";
                      }
                      return "—";
                    }},
                    { title: "Performed By", dataIndex: "performed_by_name", key: "performer", width: 160, render: (_t: string, r: any) => (
    <Select
      size="small"
      style={{ width: 140 }}
      placeholder="-"
      value={r.performed_by || undefined}
      allowClear
      showSearch
      optionFilterProp="label"
      options={users.map((u: any) => ({ value: u.id, label: `${u.first_name} ${u.last_name}`.trim() || u.username }))}
      onChange={(val) => handleAssignPerformer(r.id, val)}
      onClick={(e) => e.stopPropagation()}
    />
  ) },
                    { title: "Instrument", dataIndex: "instrument_name", key: "instrument", width: 120, render: (t: string) => t || "-" },
                    { title: "Observations", dataIndex: "observations", key: "obs", render: (t: string) => (
                      <Text type="secondary" style={{ fontSize: 12 }}>{t || "-"}</Text>
                    )},
                    { title: "Dev", key: "dev", width: 50, align: "center" as const, render: (_: any, r: any) =>
                      r.deviation_flag
                        ? <Tooltip title={r.deviation_note || 'Deviation reported'}><ExclamationCircleOutlined style={{ color: '#faad14' }} /></Tooltip>
                        : <Text type="secondary">—</Text>
                    },
                  ]}
                  locale={{ emptyText: "No workflow steps found" }}
                />
              ),
            },
            {
              key: "results",
              label: (
                <span>
                  Results
                  <Badge count={samplesInRun.length} style={{ marginLeft: 8, backgroundColor: "#52c41a" }} />
                </span>
              ),
              children: detailLoading ? (
                <Text type="secondary">Loading results...</Text>
              ) : (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Panel: <strong>{runDetail?.panel_code}</strong> — Enter test results for each sample
                    </Text>
                    <Button type="primary" size="small" loading={savingResults} onClick={handleSaveResults}>
                      Save Results
                    </Button>
                  </div>
                  <Table
                    size="small"
                    dataSource={samplesInRun}
                    rowKey="id"
                    pagination={false}
                    scroll={{ x: 800 }}
                    rowClassName={(_: any, index: number) => {
                      const record = samplesInRun[index];
                      const result = record?.result_summary?.result;
                      return result === "HIGH_RISK" ? "row-high-risk" : "";
                    }}
                    columns={[
                      ...resultColumns,
                      {
                        title: "Saved Results",
                        key: "saved",
                        width: 120,
                        render: (_: any, record: any) => {
                          const hasResults = record.result_summary && Object.keys(record.result_summary).length > 0;
                          return hasResults ? (
                            <Tag color="green" style={{ fontSize: 10 }}>✓ Saved</Tag>
                          ) : (
                            <Tag color="default" style={{ fontSize: 10 }}>Unsaved</Tag>
                          );
                        },
                      },
                    ]}
                    locale={{ emptyText: "No samples in this run" }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* Step Record Modal */}
      <Modal
        title={`Record: ${selectedStep?.step_name || ""} — ${selectedStep?.sample_barcode || ""}`}
        open={stepRecordModal}
        onCancel={() => { setStepRecordModal(false); stepForm.resetFields(); setSelectedStep(null); }}
        footer={null}
        width={500}
      >
        <Form form={stepForm} layout="vertical" onFinish={handleStepComplete} style={{ marginTop: 16 }}>
          <Form.Item name="observations" label="Observations / Notes">
            <TextArea rows={3} placeholder="e.g. DNA concentration 45 ng/μL, OD260/280 1.85" />
          </Form.Item>
          <Form.Item name="reagent_lot_ids" label="Reagent Lot IDs">
            <Input placeholder="e.g. KIT-202406-A, ENZ-202405-B" />
          </Form.Item>
          <Form.Item name="instrument_id" label="Instrument Used">
            <Select
              placeholder="Select instrument"
              allowClear
              options={instruments.map((i) => ({ value: i.id, label: `${i.name} (${i.model})` }))}
            />
          </Form.Item>
          <Form.Item name="performed_by" label="Performed By">
            <Select
              placeholder="Select technician (default: you)"
              allowClear
              showSearch
              optionFilterProp="label"
              options={users.map((u: any) => ({ value: u.id, label: `${u.first_name} ${u.last_name}`.trim() || u.username }))}
            />
          </Form.Item>
          <Form.Item name="deviation_flag" valuePropName="checked">
            <Checkbox>Deviation / Exception occurred</Checkbox>
          </Form.Item>
          <Form.Item name="deviation_note" label="Deviation Note">
            <TextArea rows={2} placeholder="Describe any deviation from SOP..." />
          </Form.Item>
          <div style={{ textAlign: "right" }}>
            <Space>
              <Button onClick={() => { setStepRecordModal(false); stepForm.resetFields(); setSelectedStep(null); }}>
                Cancel
              </Button>
              <Button type="primary" htmlType="submit" loading={stepSubmitting}>
                Complete Step
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
