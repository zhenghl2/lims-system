import { useEffect, useState, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Select, InputNumber, Space, Typography, message, Popconfirm, Popover, Checkbox } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red",
};

const ALL_STATUSES = "";

const PANEL_OPTIONS = [
  { label: "NIPT Basic", value: "NIPT" },
  { label: "NIPT Basic-All", value: "NIPT_PLUS" },
  { label: "NIPT Plus", value: "NIPT_FULL" },
];

const SOURCE_OPTIONS = [
  { label: "泰国BCC", value: "泰国BCC" },
  { label: "巴西", value: "巴西" },
  { label: "Other", value: "" },
];

interface ColumnConfig {
  key: string;
  title: string;
  dataIndex: string;
  visible: boolean;
  width?: number;
  render?: (val: any, record: any) => React.ReactNode;
}

export default function NiptSamples() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [form] = Form.useForm();

  // Column visibility state
  const [columnConfigs, setColumnConfigs] = useState<ColumnConfig[]>([
    { key: "sample_id", title: "Sample ID", dataIndex: "sample_id", visible: true, width: 160, render: (v: string) => <Text code>{v}</Text> },
    { key: "patient_name", title: "Patient Name", dataIndex: "patient_name", visible: true, width: 130 },
    { key: "id_card", title: "ID Card", dataIndex: "id_card", visible: true, width: 160, render: (v: string) => v || "-" },
    { key: "age", title: "Age", dataIndex: "age", visible: true, width: 70 },
    { key: "gestational_weeks", title: "Gest. Weeks", dataIndex: "gestational_weeks", visible: true, width: 90, render: (v: number) => v || "-" },
    { key: "source_institution", title: "Source", dataIndex: "source_institution", visible: true, width: 100, render: (v: string) => v || "-" },
    { key: "external_id", title: "External ID", dataIndex: "external_id", visible: true, width: 130, render: (v: string) => v || "-" },
    { key: "panel", title: "Panel", dataIndex: "panel", visible: true, width: 110, render: (v: any) => <Tag>{v?.code || "-"}</Tag> },
    { key: "sample_type", title: "Sample Type", dataIndex: "sample_type", visible: false, width: 130, render: (v: any) => v?.name || "-" },
    { key: "status", title: "Status", dataIndex: "status", visible: true, width: 100, render: (v: string) => <Tag color={STATUS_MAP[v]}>{v}</Tag> },
    { key: "receipt_date", title: "Receipt Date", dataIndex: "receipt_date", visible: false, width: 110, render: (v: string) => v || "-" },
    { key: "actions", title: "Actions", dataIndex: "actions", visible: true, width: 80,
      render: (_: any, record: any) => (
        <Popconfirm title="Delete this sample?" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]);

  const visibleColumns = columnConfigs.filter(c => c.visible);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize, panel: "NIPT,NIPT_PLUS,NIPT_FULL" };
      if (search) params.search = search;
      if (statusFilter && statusFilter !== ALL_STATUSES) params.status = statusFilter;
      const res = await samplesApi.list(params);
      setData((res.data as any).results || res.data || []);
      setTotal((res.data as any).count || 0);
    } catch {
      message.error("Failed to load samples");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRegister = async () => {
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = {
        patient_name: values.patient_name,
        age: values.age,
        gestational_weeks: values.gestational_weeks,
        sample_type_id: values.sample_type_id,
        panel_code: values.panel,
        source_institution: values.source === "" ? values.source_other : values.source,
        id_card: values.id_card || "",
        external_id: values.external_id || "",
        collection_date: values.collection_date ? dayjs(values.collection_date).format("YYYY-MM-DD") : undefined,
      };
      await samplesApi.create(payload);
      message.success("Sample registered");
      setModalOpen(false);
      form.resetFields();
      fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error("Failed to register sample");
    }
  };

  const handleBatchRegister = async () => {
    const lines = batchText.trim().split("\n").filter(l => l.trim());
    if (lines.length === 0) { message.warning("No data"); return; }
    const samples = lines.map(line => {
      const parts = line.split("\t");
      return {
        patient_name: parts[0]?.trim() || "",
        age: parseInt(parts[1]) || null,
        gestational_weeks: parseInt(parts[2]) || null,
        panel_code: parts[3]?.trim() || "NIPT",
        source_institution: parts[4]?.trim() || "",
        id_card: parts[5]?.trim() || "",
        external_id: parts[6]?.trim() || "",
      };
    });
    try {
      await samplesApi.batchCreate({ samples });
      message.success(`Registered ${samples.length} samples`);
      setBatchText("");
      setBatchMode(false);
      fetchData();
    } catch {
      message.error("Batch registration failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await samplesApi.delete(id);
      message.success("Deleted");
      fetchData();
    } catch {
      message.error("Delete failed");
    }
  };

  const toggleColumn = (key: string) => {
    setColumnConfigs(prev => prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };

  const tableColumns = visibleColumns.map(c => ({
    title: c.title,
    dataIndex: c.dataIndex,
    key: c.key,
    width: c.width,
    render: c.render,
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>NIPT Sample Registration</Title>
        <Space>
          <Popover
            trigger="click"
            title="Column Display"
            content={
              <div style={{ maxHeight: 300, overflow: "auto" }}>
                {columnConfigs.map(c => (
                  <div key={c.key} style={{ marginBottom: 4 }}>
                    <Checkbox checked={c.visible} onChange={() => toggleColumn(c.key)}>{c.title}</Checkbox>
                  </div>
                ))}
              </div>
            }
          >
            <Button icon={<SettingOutlined />}>Columns</Button>
          </Popover>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>
            Register Sample
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setBatchMode(true)}>Batch Import</Button>
        </Space>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <Input.Search
          placeholder="Search sample ID or patient name..."
          allowClear
          onSearch={(v) => { setSearch(v); setPage(1); }}
          style={{ width: 280 }}
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: 150 }}
          value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ALL_STATUSES); setPage(1); }}
          options={[
            { label: "All", value: ALL_STATUSES },
            { label: "Registered", value: "REGISTERED" },
            { label: "Received", value: "RECEIVED" },
            { label: "In Process", value: "IN_PROCESS" },
            { label: "Completed", value: "COMPLETED" },
            { label: "Reported", value: "REPORTED" },
            { label: "Rejected", value: "REJECTED" },
          ]}
        />
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={tableColumns}
        loading={loading}
        size="middle"
        scroll={{ x: "max-content" }}
        pagination={{
          current: page, pageSize, total, showTotal: t => `Total ${t}`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      {/* Register Modal */}
      <Modal
        title="Register NIPT Sample"
        open={modalOpen}
        onOk={handleRegister}
        onCancel={() => setModalOpen(false)}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="patient_name" label="Patient Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. 张三" />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="age" label="Age">
              <InputNumber min={1} max={100} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="gestational_weeks" label="Gestational Weeks">
              <InputNumber min={1} max={45} style={{ width: 130 }} />
            </Form.Item>
          </Space>
          <Form.Item name="id_card" label="ID Card">
            <Input placeholder="ID card number" style={{ width: 250 }} />
          </Form.Item>
          <Form.Item name="external_id" label="External ID">
            <Input placeholder="External reference number" style={{ width: 250 }} />
          </Form.Item>
          <Form.Item name="panel" label="Panel" initialValue="NIPT" rules={[{ required: true }]}>
            <Select options={PANEL_OPTIONS} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sample_type_id" label="Sample Type">
            <Select
              style={{ width: 200 }}
              placeholder="Select sample type"
              options={[
                { label: "cfDNA Plasma", value: "" },
              ]}
            />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="source" label="Source">
              <Select
                options={SOURCE_OPTIONS}
                style={{ width: 180 }}
                placeholder="Select source"
              />
            </Form.Item>
            <Form.Item name="source_other" label="Other Source">
              <Input placeholder="Specify other" style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="collection_date" label="Collection Date">
            <DatePicker style={{ width: 200 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch Import Modal */}
      <Modal
        title="Batch Import NIPT Samples"
        open={batchMode}
        onOk={handleBatchRegister}
        onCancel={() => { setBatchMode(false); setBatchText(""); }}
        width={700}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">Paste tab-separated data (one row per sample):</Text>
          <Text code style={{ display: "block", marginTop: 4, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {"Name\tAge\tGestWeeks\tPanel\tSource\tID_Card\tExternal_ID\n张三\t28\t12\tNIPT\t泰国BCC\t440123199001011234\tEXT-001"}
          </Text>
        </div>
        <TextArea
          rows={10}
          value={batchText}
          onChange={e => setBatchText(e.target.value)}
          placeholder={"张三\t28\t12\tNIPT\t泰国BCC\t440123199001011234\tEXT-001\n..."}
        />
      </Modal>
    </div>
  );
}
