import { useState, useEffect, useCallback } from "react";
import {
  Card, Table, Select, Tag, Button, Space, Modal, Typography,
  Descriptions, Form, Input, message, Badge, Progress, Popconfirm,
} from "antd";
import {
  PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ReloadOutlined, DashboardOutlined, DeleteOutlined,
} from "@ant-design/icons";
import { workflowStepsApi } from "../api";
import type { WorkflowStep } from "../api/types";

const { Text, Title } = Typography;

const STEP_STATUS_COLORS: Record<string, string> = {
  PENDING: "default", IN_PROGRESS: "processing", PENDING_QC: "orange",
  COMPLETED: "green", FAILED: "red", SKIPPED: "default",
};

const QC_STATUS_COLORS: Record<string, string> = {
  PENDING: "default", PASS: "green", FAIL: "red", NA: "default",
};

// ── Step Module Component ──
function StepModule({
  stepName, stepOrder, steps, onAction, onDelete, loading,
}: {
  stepName: string;
  stepOrder: number;
  steps: WorkflowStep[];
  onAction: (action: string, step: WorkflowStep) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  const total = steps.length;
  const completed = steps.filter(s => s.status === "COMPLETED" || s.qc_status === "PASS").length;
  const inProgress = steps.filter(s => s.status === "IN_PROGRESS" || s.status === "PENDING_QC").length;
  const failed = steps.filter(s => s.status === "FAILED" || s.qc_status === "FAIL").length;
  const stepStatus = completed === total ? "finish" : inProgress > 0 ? "active" : "wait";

  const columns = [
    {
      title: "Sample", dataIndex: "sample_barcode", key: "sample", width: 130,
      render: (v: string) => v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : "-",
    },
    {
      title: "Run", dataIndex: "run_number", key: "run", width: 100,
      render: (_: any, r: any) => r.run ? <Text code style={{ fontSize: 11 }}>{String(r.run).slice(0, 8)}</Text> : "-",
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 110,
      render: (v: string) => <Tag color={STEP_STATUS_COLORS[v] || "default"}>{v}</Tag>,
    },
    {
      title: "QC", dataIndex: "qc_status", key: "qc", width: 70,
      render: (v: string) => v ? <Tag color={QC_STATUS_COLORS[v] || "default"}>{v}</Tag> : "-",
    },
    {
      title: "Operator", dataIndex: "performed_by_name", key: "operator", width: 90,
      render: (v: string | null) => v || "-",
    },
    {
      title: "Started", dataIndex: "started_at", key: "started", width: 120,
      render: (v: string) => v ? new Date(v).toLocaleTimeString() : "-",
    },
    {
      title: "Action", key: "action", width: 180,
      render: (_: any, r: WorkflowStep) => (
        <Space size="small">
          {r.status === "PENDING" && (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />}
              onClick={() => onAction("start", r)}>
              Start
            </Button>
          )}
          {r.status === "IN_PROGRESS" && (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />}
              onClick={() => onAction("complete", r)}>
              Complete
            </Button>
          )}
          {r.status === "PENDING_QC" && (
            <Button size="small" icon={<DashboardOutlined />}
              onClick={() => onAction("qc", r)}>
              QC Review
            </Button>
          )}
          {r.status === "COMPLETED" && r.qc_status === "PASS" && (
            <Tag color="green">Done</Tag>
          )}
          {r.status === "FAILED" && <Tag color="red">Failed</Tag>}
          <Popconfirm
            title="Delete this step?"
            onConfirm={() => onDelete(r.id)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space>
          <Badge
            count={stepOrder}
            style={{
              backgroundColor: stepStatus === "finish" ? "#52c41a" : stepStatus === "active" ? "#1677ff" : "#d9d9d9",
            }}
          />
          <Text strong style={{ fontSize: 14 }}>{stepName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ({completed}/{total} done)
          </Text>
        </Space>
      }
      extra={
        <Progress
          percent={total ? Math.round((completed / total) * 100) : 0}
          size="small"
          style={{ width: 120 }}
          strokeColor={completed === total ? "#52c41a" : failed > 0 ? "#ff4d4f" : "#1677ff"}
        />
      }
    >
      <Table
        dataSource={steps}
        columns={columns}
        rowKey="id"
        size="small"
        loading={loading && steps.length === 0}
        pagination={false}
        scroll={{ x: 800 }}
      />
    </Card>
  );
}

// ── Main LabWorkflow Page ──
export default function LabWorkflow() {
  const [allSteps, setAllSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [activeStep, setActiveStep] = useState<WorkflowStep | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [completeForm] = Form.useForm();
  const [qcForm] = Form.useForm();

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { ordering: "step_order", limit: 500 };
      if (statusFilter) params.status = statusFilter;
      const res = await (workflowStepsApi as any).list(params);
      setAllSteps((res.data as any).results || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  const handleAction = (action: string, step: WorkflowStep) => {
    setActiveStep(step);
    if (action === "start") {
      handleStart(step.id);
    } else if (action === "complete") {
      completeForm.resetFields();
      setCompleteOpen(true);
    } else if (action === "qc") {
      qcForm.resetFields();
      setQcOpen(true);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await (workflowStepsApi as any).start(id);
      message.success("Step started");
      fetchSteps();
    } catch (e: any) {
      message.error(String(e?.response?.data?.detail || "Failed to start"));
    }
  };

  const handleComplete = async () => {
    if (!activeStep) return;
    const values = await completeForm.validateFields();
    setActionLoading(true);
    try {
      await (workflowStepsApi as any).complete(activeStep.id, {
        step_data: values,
        observations: values.observations || "",
      });
      message.success("Step completed, pending QC review");
      setCompleteOpen(false);
      fetchSteps();
    } catch (e: any) {
      message.error(String(e?.response?.data?.detail || "Failed"));
    }
    setActionLoading(false);
  };

  const handleQcReview = async (qcResult: string) => {
    if (!activeStep) return;
    const values = qcForm.getFieldsValue();
    setActionLoading(true);
    try {
      await (workflowStepsApi as any).qcReview(activeStep.id, {
        qc_result: qcResult,
        qc_notes: values.qc_notes || "",
      });
      message.success(`QC ${qcResult === "PASS" ? "Passed" : "Failed"}`);
      setQcOpen(false);
      fetchSteps();
    } catch (e: any) {
      message.error(String(e?.response?.data?.detail || "QC review failed"));
    }
    setActionLoading(false);
  };

  const handleDeleteStep = async (id: string) => {
    try {
      await (workflowStepsApi as any).deleteStep(id);
      message.success("Step deleted");
      fetchSteps();
    } catch (e: any) {
      message.error(String(e?.response?.data?.detail || "Delete failed"));
    }
  };

  // Group steps by step_name for modules
  const stepGroups: { name: string; order: number; items: WorkflowStep[] }[] = [];
  const seen = new Map<string, number>();
  allSteps.forEach(s => {
    const key = s.step_name || s.step_id;
    if (!seen.has(key)) {
      seen.set(key, stepGroups.length);
      stepGroups.push({ name: key, order: s.step_order || 0, items: [] });
    }
    stepGroups[seen.get(key)!].items.push(s);
  });
  stepGroups.sort((a, b) => a.order - b.order);

  const statusOptions = [
    { value: "", label: "All Status" },
    { value: "PENDING", label: "Pending" },
    { value: "IN_PROGRESS", label: "In Progress" },
    { value: "PENDING_QC", label: "Pending QC" },
    { value: "COMPLETED", label: "Completed" },
    { value: "FAILED", label: "Failed" },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <Title level={4} style={{ margin: 0 }}>Lab Workflow</Title>
        <Space>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 150 }}
            options={statusOptions}
            placeholder="Filter status"
          />
          <Button icon={<ReloadOutlined />} onClick={fetchSteps}>Refresh</Button>
        </Space>
      </Space>

      {stepGroups.length === 0 && !loading ? (
        <Card><Text type="secondary">No workflow steps found. Start by receiving samples.</Text></Card>
      ) : (
        stepGroups.map(g => (
          <StepModule
            key={g.name}
            stepName={g.name}
            stepOrder={g.order}
            steps={g.items}
            onAction={handleAction}
            onDelete={handleDeleteStep}
            loading={loading}
          />
        ))
      )}

      {/* Complete step modal */}
      <Modal
        title={`Complete: ${activeStep?.step_name}`}
        open={completeOpen}
        onCancel={() => setCompleteOpen(false)}
        onOk={handleComplete}
        confirmLoading={actionLoading}
      >
        <Form form={completeForm} layout="vertical">
          <Form.Item name="observations" label="Observations">
            <Input.TextArea rows={3} placeholder="Record experimental observations..." />
          </Form.Item>
          <Form.Item name="operator_notes" label="Operator Notes">
            <Input.TextArea rows={2} placeholder="Additional notes..." />
          </Form.Item>
          <Text type="secondary">After completion, the step will be sent for QC review.</Text>
        </Form>
      </Modal>

      {/* QC Review modal */}
      <Modal
        title={`QC Review: ${activeStep?.step_name}`}
        open={qcOpen}
        onCancel={() => setQcOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setQcOpen(false)}>Cancel</Button>,
          <Button
            key="fail" danger icon={<CloseCircleOutlined />}
            loading={actionLoading}
            onClick={() => handleQcReview("FAIL")}
          >
            QC Fail
          </Button>,
          <Button
            key="pass" type="primary" icon={<CheckCircleOutlined />}
            loading={actionLoading}
            onClick={() => handleQcReview("PASS")}
          >
            QC Pass
          </Button>,
        ]}
      >
        {activeStep && (
          <div>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Operator">{activeStep.performed_by_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="Completed">
                {activeStep.completed_at ? new Date(activeStep.completed_at).toLocaleString() : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="Observations" span={2}>
                {activeStep.observations || "-"}
              </Descriptions.Item>
            </Descriptions>
            {activeStep.step_data && Object.keys(activeStep.step_data).length > 0 && (
              <Card size="small" title="Experiment Data" style={{ marginBottom: 12 }}>
                {Object.entries(activeStep.step_data)
                  .filter(([k]) => k !== "operator_notes")
                  .map(([k, v]) => (
                    <Tag key={k} style={{ marginBottom: 4 }}>{k}: {String(v)}</Tag>
                  ))}
              </Card>
            )}
            <Form form={qcForm} layout="vertical">
              <Form.Item name="qc_notes" label="QC Notes">
                <Input.TextArea rows={3} placeholder="QC observations..." />
              </Form.Item>
            </Form>
            <Text type="secondary">
              PASS: mark step as completed and advance.<br />
              FAIL: mark step as failed, requires rework.
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
