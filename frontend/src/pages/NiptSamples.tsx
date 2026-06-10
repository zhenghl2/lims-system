import { useEffect, useState, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Select, InputNumber, Space, Typography, message, Popconfirm, Popover, Checkbox, Switch, Upload } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red",
};

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
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileSource, setFileSource] = useState("泰国BCC");
  const [fileList, setFileList] = useState<any[]>([]);
  const [form] = Form.useForm();

  const [columnConfigs, setColumnConfigs] = useState<ColumnConfig[]>([
    { key: "sample_id", title: "Sample ID", dataIndex: "sample_id", visible: true, width: 160, render: (v: string) => <Text code>{v}</Text> },
    { key: "patient_name", title: "Patient Name", dataIndex: "patient_name", visible: true, width: 120 },
    { key: "id_card", title: "ID Card", dataIndex: "id_card", visible: true, width: 160, render: (v: string) => v || "-" },
    { key: "age", title: "Age", dataIndex: "age", visible: true, width: 60 },
    { key: "gestational_weeks", title: "Gest. Weeks", dataIndex: "gestational_weeks", visible: true, width: 80, render: (v: number) => v || "-" },
    { key: "maternal_weight", title: "Weight(kg)", dataIndex: "maternal_weight", visible: false, width: 80, render: (v: number) => v || "-" },
    { key: "maternal_bmi", title: "BMI", dataIndex: "maternal_bmi", visible: false, width: 60, render: (v: number) => v?.toFixed(1) || "-" },
    { key: "ivf_status", title: "IVF", dataIndex: "ivf_status", visible: false, width: 55, render: (v: boolean) => v ? <Tag color="purple">IVF</Tag> : "-" },
    { key: "multiple_gestation", title: "Twins", dataIndex: "multiple_gestation", visible: false, width: 60, render: (v: boolean) => v ? <Tag color="orange">Twins</Tag> : "-" },
    { key: "fetal_fraction", title: "FF%", dataIndex: "fetal_fraction", visible: false, width: 60, render: (v: number) => v ? `${v}%` : "-" },
    { key: "source_institution", title: "Source", dataIndex: "source_institution", visible: true, width: 100, render: (v: string) => v || "-" },
    { key: "external_id", title: "External ID", dataIndex: "external_id", visible: true, width: 130, render: (v: string) => v || "-" },
    { key: "clinical_diagnosis", title: "Diagnosis", dataIndex: "clinical_diagnosis", visible: false, width: 150, render: (v: string) => v || "-" },
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
      if (statusFilter) params.status = statusFilter;
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
        sample_type_id: values.sample_type_id || undefined,
        panel_code: values.panel,
        source_institution: values.source === "" ? values.source_other : values.source,
        id_card: values.id_card || "",
        external_id: values.external_id || "",
        maternal_weight: values.maternal_weight || null,
        maternal_bmi: values.maternal_bmi || null,
        ivf_status: values.ivf_status || false,
        multiple_gestation: values.multiple_gestation || false,
        fetal_fraction: values.fetal_fraction || null,
        clinical_diagnosis: values.clinical_diagnosis || "",
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
        maternal_weight: parseFloat(parts[7]) || null,
        ivf_status: parts[8]?.trim() === "Y" || parts[8]?.trim() === "true",
        multiple_gestation: parts[9]?.trim() === "Y" || parts[9]?.trim() === "true",
        clinical_diagnosis: parts[10]?.trim() || "",
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
          <Button icon={<UploadOutlined />} onClick={() => { setFileModalOpen(true); setFileList([]); }}>Register from File</Button>
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
          onChange={(v) => { setStatusFilter(v || ""); setPage(1); }}
          options={[
            { label: "All", value: "" },
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
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="patient_name" label="Patient Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. 张三" />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="age" label="Age">
              <InputNumber min={1} max={100} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item name="gestational_weeks" label="Gestational Weeks">
              <InputNumber min={1} max={45} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="maternal_weight" label="Weight (kg)">
              <InputNumber min={30} max={200} step={0.1} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="maternal_bmi" label="BMI">
              <InputNumber min={10} max={60} step={0.1} style={{ width: 90 }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="ivf_status" label="IVF" valuePropName="checked">
              <Switch checkedChildren="IVF" unCheckedChildren="Natural" />
            </Form.Item>
            <Form.Item name="multiple_gestation" label="Twins" valuePropName="checked">
              <Switch checkedChildren="Twins" unCheckedChildren="Single" />
            </Form.Item>
            <Form.Item name="fetal_fraction" label="FF%">
              <InputNumber min={0} max={100} step={0.1} style={{ width: 90 }} />
            </Form.Item>
          </Space>
          <Form.Item name="id_card" label="ID Card">
            <Input placeholder="ID card number" style={{ width: 250 }} />
          </Form.Item>
          <Form.Item name="external_id" label="External ID">
            <Input placeholder="External reference number" style={{ width: 250 }} />
          </Form.Item>
          <Form.Item name="clinical_diagnosis" label="Clinical Diagnosis / History">
            <Input.TextArea rows={2} placeholder="e.g. Adverse pregnancy history, clinical notes..." style={{ width: 400 }} />
          </Form.Item>
          <Form.Item name="panel" label="Panel" initialValue="NIPT" rules={[{ required: true }]}>
            <Select options={PANEL_OPTIONS} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sample_type_id" label="Sample Type">
            <Select style={{ width: 200 }} placeholder="Select sample type" options={[{ label: "cfDNA Plasma", value: "" }]} />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="source" label="Source">
              <Select options={SOURCE_OPTIONS} style={{ width: 180 }} placeholder="Select source" />
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
        width={750}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">Paste tab-separated data (one row per sample):</Text>
          <Text code style={{ display: "block", marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
            {"Name\tAge\tGestWeeks\tPanel\tSource\tID_Card\tExtID\tWeight\tIVF(Y/N)\tTwins(Y/N)\tDiagnosis"}
          </Text>
        </div>
        <TextArea
          rows={10}
          value={batchText}
          onChange={e => setBatchText(e.target.value)}
          placeholder={"张三\t28\t12\tNIPT\t泰国BCC\t440123199001011234\tEXT-001\t65.5\tN\tN\tG1P0"}
        />
      </Modal>

      {/* Register from File Modal */}
      <Modal
        title="Register from File"
        open={fileModalOpen}
        onCancel={() => setFileModalOpen(false)}
        width={600}
        footer={[
          <Button key="cancel" onClick={() => setFileModalOpen(false)}>Cancel</Button>,
          <Button key="submit" type="primary" disabled={fileList.length === 0} onClick={() => {
            message.info("File import implementation pending");
            setFileModalOpen(false);
          }}>Import & Register</Button>,
        ]}
      >
        <Form layout="vertical">
          <Form.Item label="Source" required>
            <Select
              value={fileSource}
              onChange={setFileSource}
              options={[
                { label: "泰国BCC", value: "泰国BCC" },
                { label: "巴西", value: "巴西" },
              ]}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item label="Select File (Directory)">
            <Upload
              fileList={fileList}
              beforeUpload={(file) => {
                setFileList([file]);
                return false;
              }}
              onRemove={() => setFileList([])}
              accept=".xlsx,.xls,.csv"
              maxCount={1}
              directory
            >
              <Button icon={<UploadOutlined />}>Choose File / Directory</Button>
            </Upload>
          </Form.Item>
          <Text type="secondary">Select the source (泰国BCC or 巴西) and upload the sample file. Supported formats: .xlsx, .csv</Text>
        </Form>
      </Modal>
    </div>
  );
}
