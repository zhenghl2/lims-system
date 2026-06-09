import { useEffect, useState, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Select, InputNumber, Space, Typography, message, Popconfirm } from "antd";
import { PlusOutlined, MinusCircleOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red",
};

const STATUS_LABELS: Record<string, string> = {
  REGISTERED: "Registered", RECEIVING: "Receiving", RECEIVED: "Received",
  IN_PROCESS: "In Process", COMPLETED: "Completed", REPORTED: "Reported",
  REJECTED: "Rejected",
};

const SAMPLE_TYPE_MAP: Record<string, string> = {
  PLASMA_CFDNA: "cfDNA Plasma",
  PERIPHERAL_BLOOD: "Peripheral Blood",
};

const PANEL_MAP: Record<string, string> = {
  NIPT: "NIPT",
  NIPT_PLUS: "NIPT-PLUS",
};

interface BatchRow {
  key: string;
  sampleId: string;
  patientName: string;
  patientId: string;
  age: number | null;
  gestationalWeeks: number | null;
  sourceInstitution: string;
  institutionSampleId: string;
  sampleType: string;
  panelCode: string;
  collectionDate: dayjs.Dayjs;
}

let _batchKey = 0;
const newBatchRow = (): BatchRow => ({
  key: String(++_batchKey),
  sampleId: "",
  patientName: "",
  patientId: "",
  age: null,
  gestationalWeeks: null,
  sourceInstitution: "",
  institutionSampleId: "",
  sampleType: "PLASMA_CFDNA",
  panelCode: "",
  collectionDate: dayjs(),
});

function parseExcelPaste(text: string): BatchRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  const rows: BatchRow[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    rows.push({
      key: String(++_batchKey),
      sampleId: (cols[0] || "").trim(),
      patientName: (cols[1] || "").trim(),
      patientId: (cols[2] || "").trim(),
      age: cols[3] ? parseInt(cols[3].trim(), 10) || null : null,
      gestationalWeeks: cols[4] ? parseInt(cols[4].trim(), 10) || null : null,
      sourceInstitution: (cols[5] || "").trim(),
      institutionSampleId: (cols[6] || "").trim(),
      sampleType: (cols[7] || "PLASMA_CFDNA").trim(),
      panelCode: (cols[8] || "").trim(),
      collectionDate: cols[9] ? dayjs(cols[9].trim()) : dayjs(),
    });
  }
  return rows.length > 0 ? rows : [newBatchRow()];
}

const ALL_STATUSES = "REGISTERED,RECEIVING,RECEIVED,IN_PROCESS,COMPLETED,REPORTED,REJECTED";

export default function NiptSamples() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([newBatchRow()]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [excelText, setExcelText] = useState("");

  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
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

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await samplesApi.create({
        sample_id: values.sampleId || undefined,
        patient_name: values.patientName,
        patient_id: values.patientId || undefined,
        age: values.age,
        gestational_weeks: values.gestationalWeeks,
        source_institution: values.sourceInstitution,
        institution_sample_id: values.institutionSampleId,
        sample_type_code: values.sampleType,
        panel: values.panelCode || undefined,
        collection_date: values.collectionDate ? values.collectionDate.format("YYYY-MM-DD") : undefined,
      });
      message.success("Sample registered");
      setCreateOpen(false);
      form.resetFields();
      fetchData();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || "Failed to create sample");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleBatchCreate = async () => {
    const validRows = batchRows.filter(r => r.patientName.trim());
    if (validRows.length === 0) { message.warning("At least one sample with patient name is required"); return; }
    setBatchLoading(true);
    try {
      const samples = validRows.map(r => ({
        sample_id: r.sampleId || undefined,
        patient_name: r.patientName,
        patient_id: r.patientId || undefined,
        age: r.age,
        gestational_weeks: r.gestationalWeeks,
        source_institution: r.sourceInstitution,
        institution_sample_id: r.institutionSampleId,
        sample_type_code: r.sampleType,
        panel: r.panelCode || undefined,
        collection_date: r.collectionDate.format("YYYY-MM-DD"),
      }));
      await samplesApi.batchCreate({ samples });
      message.success(`${samples.length} samples registered`);
      setBatchOpen(false);
      setBatchRows([newBatchRow()]);
      setExcelText("");
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || "Batch create failed");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await samplesApi.delete(id);
      message.success("Sample deleted");
      fetchData();
    } catch {
      message.error("Delete failed");
    }
  };

  const updateBatchRow = (idx: number, field: keyof BatchRow, value: any) => {
    setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const addBatchRow = () => setBatchRows(prev => [...prev, newBatchRow()]);
  const removeBatchRow = (idx: number) => {
    if (batchRows.length <= 1) return;
    setBatchRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handlePasteParse = () => {
    if (!excelText.trim()) return;
    const parsed = parseExcelPaste(excelText);
    setBatchRows(parsed);
    message.info(`Parsed ${parsed.length} rows`);
  };

  const columns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 180, ellipsis: true },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Age", dataIndex: "age", key: "age", width: 60 },
    { title: "Gestational Weeks", dataIndex: "gestational_weeks", key: "gestational_weeks", width: 100 },
    { title: "Sample Type", dataIndex: "sample_type_code", key: "sample_type_code", width: 140, render: (v: string) => SAMPLE_TYPE_MAP[v] || v || "-" },
    { title: "Panel", dataIndex: "panel_info", key: "panel_info", width: 100, render: (v: string) => PANEL_MAP[v] || v || "-" },
    { title: "Source Institution", dataIndex: "source_institution", key: "source_institution", width: 160, ellipsis: true },
    {
      title: "Status", dataIndex: "status", key: "status", width: 110,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABELS[v] || v}</Tag>,
    },
    { title: "Receipt Date", dataIndex: "receipt_date", key: "receipt_date", width: 120, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD") : "-" },
    {
      title: "Actions", key: "action", width: 80, render: (_: any, r: any) => (
        <Popconfirm title="Delete this sample?" onConfirm={() => handleDelete(r.id)} okText="Yes" cancelText="No">
          <Button type="link" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>NIPT Sample Registration</Title>

      {/* Toolbar */}
      <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Input.Search
          placeholder="Search sample ID or patient name..."
          allowClear
          onSearch={v => { setSearch(v); setPage(1); }}
          style={{ width: 280 }}
          prefix={<SearchOutlined />}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 140 }}
          value={statusFilter === ALL_STATUSES ? undefined : statusFilter}
          onChange={v => { setStatusFilter(v || ALL_STATUSES); setPage(1); }}
          options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
        />
        <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Register Sample</Button>
        <Button icon={<PlusOutlined />} onClick={() => { setBatchRows([newBatchRow()]); setExcelText(""); setBatchOpen(true); }}>Batch Register</Button>
      </Space>

      {/* Table */}
      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); }, showSizeChanger: true, showTotal: t => `Total ${t}` }}
        scroll={{ x: 1200 }}
        size="middle"
      />

      {/* Single Create Modal */}
      <Modal title="Register NIPT Sample" open={createOpen} onOk={handleCreate} onCancel={() => { setCreateOpen(false); form.resetFields(); }} confirmLoading={createLoading} destroyOnClose width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="sampleId" label="Sample ID (auto if empty)">
            <Input placeholder="NIPT-YYYYMMDD-001" />
          </Form.Item>
          <Form.Item name="patientName" label="Patient Name" rules={[{ required: true, message: "Required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="patientId" label="Patient ID (auto if empty)">
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} size="middle">
            <Form.Item name="age" label="Age">
              <InputNumber min={0} max={100} style={{ width: 120 }} placeholder="Age" />
            </Form.Item>
            <Form.Item name="gestationalWeeks" label="Gestational Weeks">
              <InputNumber min={1} max={45} style={{ width: 140 }} placeholder="Weeks" />
            </Form.Item>
          </Space>
          <Form.Item name="sampleType" label="Sample Type" initialValue="PLASMA_CFDNA">
            <Select allowClear placeholder="Select sample type">
              <Select.Option value="PLASMA_CFDNA">cfDNA Plasma</Select.Option>
              <Select.Option value="PERIPHERAL_BLOOD">Peripheral Blood</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="panelCode" label="Test Panel">
            <Select allowClear placeholder="Select panel (optional)">
              <Select.Option value="NIPT">NIPT</Select.Option>
              <Select.Option value="NIPT_PLUS">NIPT-PLUS</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="sourceInstitution" label="Source Institution">
            <Input placeholder="Hospital / Clinic name" />
          </Form.Item>
          <Form.Item name="institutionSampleId" label="Institution Sample ID">
            <Input placeholder="External sample ID" />
          </Form.Item>
          <Form.Item name="collectionDate" label="Collection Date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch Create Modal */}
      <Modal title="Batch Register NIPT Samples" open={batchOpen} onOk={handleBatchCreate} onCancel={() => setBatchOpen(false)} confirmLoading={batchLoading} width={1300} destroyOnClose>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 4 }}>Paste from Excel</Text>
          <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
            Copy cells from Excel (columns: Sample ID, Patient Name, Patient ID, Age, Gestational Weeks, Source Institution, Inst. Sample ID, Sample Type, Panel, Collection Date) and paste below.
          </Text>
          <Space.Compact style={{ width: "100%" }}>
            <TextArea
              value={excelText}
              onChange={e => setExcelText(e.target.value)}
              placeholder={"Paste tab-separated data from Excel here...\nExample:\nNIPT-001\tZhang Min\tPID001\t32\t16\tCentral Hospital\tCH-12345\tPLASMA_CFDNA\tNIPT\t2026-05-14"}
              rows={5}
              style={{ flex: 1 }}
            />
          </Space.Compact>
          <Button type="dashed" icon={<PlusOutlined />} onClick={handlePasteParse} style={{ marginTop: 8 }} disabled={!excelText.trim()}>
            Parse & Fill Table
          </Button>
        </div>

        <div style={{ marginTop: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>Sample Rows ({batchRows.length})</Text>
          <div style={{ maxHeight: 350, overflowY: "auto", overflowX: "auto", border: "1px solid #d9d9d9", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1300 }}>
              <thead>
                <tr style={{ background: "#fafafa", position: "sticky", top: 0, zIndex: 1 }}>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 130 }}>Sample ID</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 140 }}>Patient Name *</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 110 }}>Patient ID</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 60 }}>Age</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 80 }}>Gest. Weeks</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 140 }}>Source Institution</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 130 }}>Inst. Sample ID</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 130 }}>Sample Type</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 100 }}>Panel</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 130 }}>Collection Date</th>
                  <th style={{ padding: "8px 6px", borderBottom: "2px solid #d9d9d9", width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((row, idx) => (
                  <tr key={row.key} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: 4 }}><Input size="small" value={row.sampleId} onChange={e => updateBatchRow(idx, "sampleId", e.target.value)} placeholder="Auto" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><Input size="small" value={row.patientName} onChange={e => updateBatchRow(idx, "patientName", e.target.value)} placeholder="Required" status={batchRows.filter(r => r.patientName.trim()).length === 0 && idx === batchRows.length - 1 ? "error" : undefined} style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><Input size="small" value={row.patientId} onChange={e => updateBatchRow(idx, "patientId", e.target.value)} placeholder="Auto" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><InputNumber size="small" value={row.age} onChange={v => updateBatchRow(idx, "age", v)} min={0} max={100} placeholder="Age" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><InputNumber size="small" value={row.gestationalWeeks} onChange={v => updateBatchRow(idx, "gestationalWeeks", v)} min={1} max={45} placeholder="Weeks" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><Input size="small" value={row.sourceInstitution} onChange={e => updateBatchRow(idx, "sourceInstitution", e.target.value)} placeholder="Hospital" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}><Input size="small" value={row.institutionSampleId} onChange={e => updateBatchRow(idx, "institutionSampleId", e.target.value)} placeholder="External ID" style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4 }}>
                      <Select size="small" value={row.sampleType || undefined} onChange={v => updateBatchRow(idx, "sampleType", v || "PLASMA_CFDNA")} style={{ width: "100%" }}>
                        <Select.Option value="PLASMA_CFDNA">cfDNA Plasma</Select.Option>
                        <Select.Option value="PERIPHERAL_BLOOD">Peripheral Blood</Select.Option>
                      </Select>
                    </td>
                    <td style={{ padding: 4 }}>
                      <Select size="small" value={row.panelCode || undefined} onChange={v => updateBatchRow(idx, "panelCode", v || "")} allowClear style={{ width: "100%" }} placeholder="Panel">
                        <Select.Option value="NIPT">NIPT</Select.Option>
                        <Select.Option value="NIPT_PLUS">NIPT-PLUS</Select.Option>
                      </Select>
                    </td>
                    <td style={{ padding: 4 }}><DatePicker size="small" value={row.collectionDate} onChange={v => updateBatchRow(idx, "collectionDate", v || dayjs())} style={{ width: "100%" }} /></td>
                    <td style={{ padding: 4, textAlign: "center" }}><Button type="link" danger size="small" icon={<MinusCircleOutlined />} onClick={() => removeBatchRow(idx)} disabled={batchRows.length <= 1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="dashed" icon={<PlusOutlined />} onClick={addBatchRow} style={{ marginTop: 8 }} block>Add Row</Button>
        </div>
      </Modal>
    </div>
  );
}
