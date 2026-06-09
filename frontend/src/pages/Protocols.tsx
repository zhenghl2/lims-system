import { useState, useEffect } from "react";
import { Table, Button, Space, Tag, Typography, Modal, Form, Select, Input,
  message, Switch, Popconfirm, InputNumber,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  OrderedListOutlined,
} from "@ant-design/icons";
import DashboardLayout from "../components/DashboardLayout";
import { protocolsApi, panelsApi } from "../api";
import type { TestPanel } from "../api/types";

const { Text } = Typography;
const { TextArea } = Input;

interface StepDef {
  step_id: string;
  step_name: string;
  step_order: number;
  required?: boolean;
  description?: string;
}

interface Protocol {
  id: string;
  panel: string;
  panel_code: string;
  panel_name: string;
  name: string;
  version: string;
  description: string;
  estimated_hours: number | null;
  is_active: boolean;
  steps_definition: StepDef[];
  step_count: number;
  created_by_name: string | null;
  created_at: string;
}

// NGS-NIPT Standard Workflow Steps
const NGS_NIPT_STEPS: StepDef[] = [
  { step_id: "dna_extraction",    step_name: "Nucleic Acid Extraction",    step_order: 1, required: true,  description: "cfDNA extraction from maternal plasma (Streck BCT)" },
  { step_id: "library_prep",      step_name: "Library Preparation",        step_order: 2, required: true,  description: "End repair, A-tailing, adapter ligation, PCR amplification" },
  { step_id: "sequencing",        step_name: "Sequencing",                 step_order: 3, required: true,  description: "NGS sequencing on Illumina/MGI platform" },
  { step_id: "bioinformatics",    step_name: "Bioinformatics Analysis",    step_order: 4, required: true,  description: "Read alignment, GC correction, z-score calculation" },
  { step_id: "report_generation", step_name: "Report Generation",          step_order: 5, required: true,  description: "Risk assessment, report drafting, review & sign-off" },
];

export default function Protocols() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [panels, setPanels] = useState<TestPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [panelFilter, setPanelFilter] = useState<string | null>(null);

  // Steps editor state
  const [steps, setSteps] = useState<StepDef[]>([...NGS_NIPT_STEPS]);

  const fetchProtocols = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (panelFilter) params.panel = panelFilter;
      const res = await protocolsApi.list(params);
      setProtocols((res.data.results ?? res.data) as Protocol[]);
    } catch {
      message.error("Failed to load protocols");
    } finally {
      setLoading(false);
    }
  };

  const fetchPanels = async () => {
    try {
      const res = await panelsApi.list();
      setPanels(((res.data as any).results ?? res.data) as TestPanel[]);
    } catch {
      message.error("Failed to load panels");
    }
  };

  useEffect(() => {
    fetchProtocols();
    fetchPanels();
  }, [panelFilter]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await protocolsApi.create({
        ...values,
        steps_definition: steps.map(s => ({ step_id: s.step_id, step_name: s.step_name, step_order: s.step_order })),
        estimated_hours: values.estimatedHours,
      });
      message.success("Protocol created");
      setCreateOpen(false);
      form.resetFields();
      setSteps([...NGS_NIPT_STEPS]);
      fetchProtocols();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error("Failed to create protocol");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (protocol: Protocol) => {
    setSelectedProtocol(protocol);
    editForm.setFieldsValue({
      name: protocol.name,
      version: protocol.version,
      description: protocol.description,
      panel: protocol.panel,
      estimatedHours: protocol.estimated_hours,
      is_active: protocol.is_active,
    });
    setSteps(protocol.steps_definition?.length > 0 ? protocol.steps_definition : [...NGS_NIPT_STEPS]);
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!selectedProtocol) return;
    try {
      const values = await editForm.validateFields();
      setSubmitting(true);
      await protocolsApi.update(selectedProtocol.id, {
        ...values,
        steps_definition: steps.map(s => ({ step_id: s.step_id, step_name: s.step_name, step_order: s.step_order })),
        estimated_hours: values.estimatedHours,
      });
      message.success("Protocol updated");
      setEditOpen(false);
      fetchProtocols();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error("Failed to update protocol");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await protocolsApi.delete(id);
      message.success("Protocol deleted");
      fetchProtocols();
    } catch {
      message.error("Delete failed");
    }
  };

  // Steps management
  const updateStep = (idx: number, field: keyof StepDef, value: any) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addStep = () => {
    const maxOrder = steps.reduce((max, s) => Math.max(max, s.step_order), 0);
    setSteps(prev => [...prev, { step_id: "", step_name: "", step_order: maxOrder + 1 }]);
  };

  const removeStep = (idx: number) => {
    setSteps(prev => prev.filter((_, i) => i !== idx));
  };

  const resetToNgsNipt = () => {
    setSteps([...NGS_NIPT_STEPS]);
    message.info("Reset to NGS-NIPT standard workflow");
  };

  const columns = [
    { title: "Name", dataIndex: "name", key: "name", width: 220, render: (v: string, r: Protocol) => <><Text strong>{v}</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>v{r.version}</Text></> },
    { title: "Panel", dataIndex: "panel_code", key: "panel_code", width: 100, render: (v: string) => <Tag>{v || "-"}</Tag> },
    { title: "Steps", dataIndex: "step_count", key: "step_count", width: 70, align: "center" as const },
    { title: "Est. Hours", dataIndex: "estimated_hours", key: "estimated_hours", width: 90, align: "center" as const, render: (v: number | null) => v ? `${v}h` : "-" },
    { title: "Active", dataIndex: "is_active", key: "is_active", width: 70, align: "center" as const, render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Yes" : "No"}</Tag> },
    { title: "Description", dataIndex: "description", key: "description", width: 300, ellipsis: true },
    { title: "Created By", dataIndex: "created_by_name", key: "created_by_name", width: 120, render: (v: string | null) => v || "-" },
    { title: "Created", dataIndex: "created_at", key: "created_at", width: 110, render: (v: string) => new Date(v).toLocaleDateString() },
    {
      title: "Actions", key: "action", width: 120, render: (_: any, r: Protocol) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} />
          <Popconfirm title="Delete this protocol?" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <DashboardLayout>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Protocols — NGS-NIPT Workflow</Typography.Title>
          <Text type="secondary">Standard workflow: Nucleic Acid Extraction → Library Prep → Sequencing → Bioinformatics → Report</Text>
        </div>
        <Space>
          <Select allowClear placeholder="Filter by panel" style={{ width: 160 }} value={panelFilter} onChange={setPanelFilter} options={panels.map(p => ({ value: p.id, label: p.code }))} />
          <Button icon={<ReloadOutlined />} onClick={fetchProtocols} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setSteps([...NGS_NIPT_STEPS]); setCreateOpen(true); }}>
            New Protocol
          </Button>
        </Space>
      </div>

      <Table dataSource={protocols} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20, showTotal: t => `Total ${t}` }} size="middle" />

      {/* Create Modal */}
      <Modal title="Create Protocol" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} confirmLoading={submitting} width={700} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Protocol Name" rules={[{ required: true }]}>
            <Input placeholder="e.g., NGS-NIPT Standard Workflow" />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle">
            <Form.Item name="version" label="Version" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="1.0.0" />
            </Form.Item>
            <Form.Item name="panel" label="Test Panel" style={{ flex: 1 }}>
              <Select allowClear placeholder="Select panel" options={panels.map(p => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
            </Form.Item>
            <Form.Item name="estimatedHours" label="Est. Hours" style={{ flex: 1 }}>
              <InputNumber min={1} max={500} style={{ width: "100%" }} placeholder="e.g., 120" />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Protocol description..." />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>

          {/* Steps Editor */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text strong><OrderedListOutlined /> Workflow Steps</Text>
              <Space>
                <Button size="small" onClick={resetToNgsNipt}>Reset to NGS-NIPT</Button>
                <Button size="small" icon={<PlusOutlined />} onClick={addStep}>Add Step</Button>
              </Space>
            </div>
            <div style={{ maxHeight: 250, overflowY: "auto", border: "1px solid #d9d9d9", borderRadius: 6, padding: 8 }}>
              {steps.map((step, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <Tag color="blue" style={{ minWidth: 28, textAlign: "center" }}>{step.step_order}</Tag>
                  <Input size="small" placeholder="Step ID (e.g. dna_extraction)" value={step.step_id} onChange={e => updateStep(idx, "step_id", e.target.value)} style={{ width: 170 }} />
                  <Input size="small" placeholder="Step Name" value={step.step_name} onChange={e => updateStep(idx, "step_name", e.target.value)} style={{ flex: 1 }} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeStep(idx)} disabled={steps.length <= 1} />
                </div>
              ))}
            </div>
          </div>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title="Edit Protocol" open={editOpen} onOk={handleUpdate} onCancel={() => setEditOpen(false)} confirmLoading={submitting} width={700} destroyOnClose>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="Protocol Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle">
            <Form.Item name="version" label="Version" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="panel" label="Test Panel" style={{ flex: 1 }}>
              <Select allowClear options={panels.map(p => ({ value: p.id, label: `${p.code} - ${p.name}` }))} />
            </Form.Item>
            <Form.Item name="estimatedHours" label="Est. Hours" style={{ flex: 1 }}>
              <InputNumber min={1} max={500} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text strong><OrderedListOutlined /> Workflow Steps</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={addStep}>Add Step</Button>
            </div>
            <div style={{ maxHeight: 250, overflowY: "auto", border: "1px solid #d9d9d9", borderRadius: 6, padding: 8 }}>
              {steps.map((step, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <Tag color="blue" style={{ minWidth: 28, textAlign: "center" }}>{step.step_order}</Tag>
                  <Input size="small" placeholder="Step ID" value={step.step_id} onChange={e => updateStep(idx, "step_id", e.target.value)} style={{ width: 170 }} />
                  <Input size="small" placeholder="Step Name" value={step.step_name} onChange={e => updateStep(idx, "step_name", e.target.value)} style={{ flex: 1 }} />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeStep(idx)} disabled={steps.length <= 1} />
                </div>
              ))}
            </div>
          </div>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
