import { useEffect, useState, useCallback } from "react";
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Select, InputNumber, Space, Typography, message, Popconfirm, Switch } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red",
};

const TEST_OPTIONS = [
  { label: "NIPT Basic", value: "NIPT" },
  { label: "NIPT Basic-All", value: "NIPT_PLUS" },
  { label: "NIPT Plus", value: "NIPT_FULL" },
];

const SOURCE_OPTIONS = [
  { label: "泰国BCC", value: "泰国BCC" },
  { label: "巴西", value: "巴西" },
  { label: "Other", value: "" },
];

// All table columns (A-T + analysis fields U-AH)
const ALL_COLUMNS = [
  // A: Sample_source
  { key: "source", title: "Source", dataIndex: "source_institution", width: 100, render: (v: string) => v || "-" },
  // B: Test_Option
  { key: "test_option", title: "Test Option", dataIndex: "test_option", width: 100, render: (v: string) => v || "-" },
  // C: Accessioning_ID (External ID)
  { key: "external_id", title: "Accessioning ID", dataIndex: "external_id", width: 140, render: (v: string) => <Text code>{v || "-"}</Text> },
  // D: Collection_Date
  { key: "collection_date", title: "Collection Date", dataIndex: "collection_date", width: 110, render: (v: string) => v || "-" },
  // E: Acceptance_Date
  { key: "acceptance_date", title: "Acceptance Date", dataIndex: "acceptance_date", width: 110, render: (v: string) => v || "-" },
  // F: Hospital_or_Clinic (use source_institution)
  { key: "hospital", title: "Hospital/Clinic", dataIndex: "source_institution", width: 130, render: (v: string) => v || "-" },
  // G: Physician
  { key: "physician", title: "Physician", dataIndex: "physician", width: 100, render: (v: string) => v || "-" },
  // H: Patient_ID
  { key: "patient_id", title: "Patient ID/ID Card", dataIndex: "id_card", width: 160, render: (v: string) => v || "-" },
  // I: Name
  { key: "patient_name", title: "Name", dataIndex: "patient_name", width: 100 },
  // J: DOB
  { key: "patient_dob", title: "DOB", dataIndex: "patient_dob", width: 100, render: (v: string) => v || "-" },
  // K: age
  { key: "age", title: "Age", dataIndex: "age", width: 60 },
  // L: Gestational_Week
  { key: "gestational_weeks", title: "Gest. Weeks", dataIndex: "gestational_weeks", width: 80, render: (v: number) => v || "-" },
  // M: Report_code (泰国编号)
  { key: "report_code", title: "Report Code", dataIndex: "report_code", width: 120, render: (v: string) => v || "-" },
  // N: send_report_id
  { key: "send_report_id", title: "Send Report ID", dataIndex: "send_report_id", width: 120, render: (v: string) => v || "-" },
  // O: Last_Menstrual_Period
  { key: "lmp", title: "LMP", dataIndex: "last_menstrual_period", width: 100, render: (v: string) => v || "-" },
  // P: Single/Twin
  { key: "twins", title: "Single/Twin", dataIndex: "multiple_gestation", width: 90, render: (v: boolean) => v ? <Tag color="orange">Twin</Tag> : "Single" },
  // Q: IVF
  { key: "ivf", title: "IVF", dataIndex: "ivf_status", width: 60, render: (v: boolean) => v ? <Tag color="purple">IVF</Tag> : "-" },
  // R: Pregnancy_History
  { key: "pregnancy_history", title: "Pregnancy History", dataIndex: "pregnancy_history", width: 130, render: (v: string) => v || "-" },
  // S: Previous_Medical_History
  { key: "diagnosis", title: "Clinical Diagnosis", dataIndex: "clinical_diagnosis", width: 150, render: (v: string) => v || "-" },
  // T: FedEx_No
  { key: "fedex", title: "FedEx No.", dataIndex: "fedex_no", width: 120, render: (v: string) => v || "-" },
  // ---- Analysis fields (U-AH) ----
  { key: "zscore_21", title: "Zscore 21", dataIndex: "zscore_21", width: 80, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "zscore_18", title: "Zscore 18", dataIndex: "zscore_18", width: 80, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "zscore_13", title: "Zscore 13", dataIndex: "zscore_13", width: 80, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "t21", title: "T21", dataIndex: "t21", width: 70 },
  { key: "t18", title: "T18", dataIndex: "t18", width: 70 },
  { key: "t13", title: "T13", dataIndex: "t13", width: 70 },
  { key: "xo", title: "XO", dataIndex: "xo", width: 60 },
  { key: "xxx", title: "XXX", dataIndex: "xxx", width: 60 },
  { key: "xxy", title: "XXY", dataIndex: "xxy", width: 60 },
  { key: "xyy", title: "XYY", dataIndex: "xyy", width: 60 },
  { key: "all_chrom", title: "All Chrom", dataIndex: "all_chrom", width: 80 },
  { key: "fetal_fraction", title: "FF%", dataIndex: "fetal_fraction", width: 60, render: (v: number) => v ? `${v}%` : "-" },
  { key: "gender", title: "Gender", dataIndex: "gender", width: 70 },
  { key: "other", title: "Other", dataIndex: "other", width: 120, render: (v: string) => v || "-" },
];

export default function NiptSamples() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [modalOpen, setModalOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [form] = Form.useForm();

  const columns = [
    { key: "sample_id", title: "Sample ID", dataIndex: "sample_id", width: 170, render: (v: string) => <Text code>{v}</Text> },
    ...ALL_COLUMNS,
    { key: "status", title: "Status", dataIndex: "status", width: 100, render: (v: string) => <Tag color={STATUS_MAP[v]}>{v}</Tag> },
    { key: "actions", title: "", width: 50, fixed: "right" as const,
      render: (_: any, record: any) => (
        <Popconfirm title="Delete?" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize, panel: "NIPT,NIPT_PLUS,NIPT_FULL" };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await samplesApi.list(params);
      setData((res.data as any).results || res.data || []);
      setTotal((res.data as any).count || 0);
    } catch { message.error("Failed"); } finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const buildPayload = (values: any) => ({
    panel_code: values.panel || "NIPT",
    test_option: values.test_option || "NIPT",
    source_institution: values.source === "" ? values.source_other : values.source,
    external_id: values.external_id || "",
    collection_date: values.collection_date ? dayjs(values.collection_date).format("YYYY-MM-DD") : undefined,
    acceptance_date: values.acceptance_date ? dayjs(values.acceptance_date).format("YYYY-MM-DD") : undefined,
    physician: values.physician || "",
    id_card: values.id_card || "",
    patient_name: values.patient_name || "",
    patient_dob: values.patient_dob ? dayjs(values.patient_dob).format("YYYY-MM-DD") : undefined,
    age: values.age,
    gestational_weeks: values.gestational_weeks,
    report_code: values.report_code || "",
    send_report_id: values.send_report_id || "",
    last_menstrual_period: values.last_menstrual_period ? dayjs(values.last_menstrual_period).format("YYYY-MM-DD") : undefined,
    multiple_gestation: values.multiple_gestation || false,
    ivf_status: values.ivf_status || false,
    pregnancy_history: values.pregnancy_history || "",
    clinical_diagnosis: values.clinical_diagnosis || "",
    fedex_no: values.fedex_no || "",
  });

  const handleRegister = async () => {
    try {
      const values = await form.validateFields();
      await samplesApi.create(buildPayload(values));
      message.success("Registered");
      setModalOpen(false); form.resetFields(); fetchData();
    } catch (e: any) { if (e?.errorFields) return; message.error("Failed"); }
  };

  const handleBatchRegister = async () => {
    const lines = batchText.trim().split("\n").filter(l => l.trim());
    if (lines.length === 0) { message.warning("No data"); return; }
    const samples = lines.map(line => {
      const p = line.split("\t");
      return {
        patient_name: p[0]?.trim() || "",
        age: parseInt(p[1]) || null,
        gestational_weeks: parseInt(p[2]) || null,
        panel_code: p[3]?.trim() || "NIPT",
        source_institution: p[4]?.trim() || "",
        id_card: p[5]?.trim() || "",
        external_id: p[6]?.trim() || "",
        collection_date: p[7]?.trim() || undefined,
        acceptance_date: p[8]?.trim() || undefined,
        physician: p[9]?.trim() || "",
        patient_dob: p[10]?.trim() || undefined,
        report_code: p[11]?.trim() || "",
        send_report_id: p[12]?.trim() || "",
        last_menstrual_period: p[13]?.trim() || undefined,
        multiple_gestation: p[14]?.trim() === "Y" || p[14]?.trim() === "true",
        ivf_status: p[15]?.trim() === "Y" || p[15]?.trim() === "true",
        pregnancy_history: p[16]?.trim() || "",
        clinical_diagnosis: p[17]?.trim() || "",
        fedex_no: p[18]?.trim() || "",
        test_option: p[19]?.trim() || "NIPT",
      };
    });
    try {
      await samplesApi.batchCreate({ samples });
      message.success(`Registered ${samples.length}`);
      setBatchText(""); setBatchMode(false); fetchData();
    } catch { message.error("Failed"); }
  };

  const handleDelete = async (id: string) => {
    try { await samplesApi.delete(id); message.success("Deleted"); fetchData(); } catch { message.error("Failed"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>NIPT Sample Registration</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>Register</Button>
          <Button icon={<PlusOutlined />} onClick={() => setBatchMode(true)}>Batch Import</Button>
        </Space>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <Input.Search placeholder="Search..." allowClear onSearch={(v) => { setSearch(v); setPage(1); }} style={{ width: 280 }} />
        <Select placeholder="Status" allowClear style={{ width: 150 }} value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ""); setPage(1); }}
          options={["", "REGISTERED", "RECEIVED", "IN_PROCESS", "COMPLETED", "REPORTED", "REJECTED"].map(v => ({ label: v || "All", value: v }))} />
      </div>

      <Table rowKey="id" dataSource={data} columns={columns} loading={loading} size="small"
        scroll={{ x: 5000 }}
        pagination={{ current: page, pageSize, total, showTotal: t => `Total ${t}`, onChange: (p) => setPage(p) }} />

      {/* Register Modal - columns A through T */}
      <Modal title="Register NIPT Sample" open={modalOpen} onOk={handleRegister} onCancel={() => setModalOpen(false)} width={700} destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="source" label="A. Source">
              <Select options={SOURCE_OPTIONS} style={{ width: 160 }} placeholder="Select" />
            </Form.Item>
            <Form.Item name="source_other" label="Other">
              <Input placeholder="Other source" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="test_option" label="B. Test Option" initialValue="NIPT">
              <Select options={TEST_OPTIONS} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="external_id" label="C. Accessioning ID">
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="collection_date" label="D. Collection Date">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="acceptance_date" label="E. Acceptance Date">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="physician" label="G. Physician">
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="id_card" label="H. Patient ID/ID Card">
              <Input style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="patient_name" label="I. Name" rules={[{ required: true }]}>
              <Input style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="patient_dob" label="J. DOB">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="age" label="K. Age">
              <InputNumber min={1} max={100} style={{ width: 80 }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="gestational_weeks" label="L. Gest. Weeks">
              <InputNumber min={1} max={45} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="report_code" label="M. Report Code">
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="send_report_id" label="N. Send Report ID">
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="last_menstrual_period" label="O. LMP">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="multiple_gestation" label="P. Single/Twin" valuePropName="checked">
              <Switch checkedChildren="Twin" unCheckedChildren="Single" />
            </Form.Item>
            <Form.Item name="ivf_status" label="Q. IVF" valuePropName="checked">
              <Switch checkedChildren="IVF" unCheckedChildren="Natural" />
            </Form.Item>
            <Form.Item name="pregnancy_history" label="R. Preg. History">
              <Input placeholder="G/P" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="clinical_diagnosis" label="S. Diagnosis">
              <Input style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="fedex_no" label="T. FedEx No.">
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Batch Import Modal - columns A through T */}
      <Modal title="Batch Import NIPT Samples" open={batchMode} onOk={handleBatchRegister}
        onCancel={() => { setBatchMode(false); setBatchText(""); }} width={800}>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">Paste tab-separated (A-T columns):</Text>
          <Text code style={{ display: "block", marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
            {"Name\tAge\tGestWeeks\tPanel\tSource\tIDCard\tExtID\tCollDate\tAcptDate\tPhysician\tDOB\tRptCode\tSendID\tLMP\tTwin(Y/N)\tIVF(Y/N)\tPregHist\tDiagnosis\tFedEx\tTestOpt"}
          </Text>
        </div>
        <TextArea rows={12} value={batchText} onChange={e => setBatchText(e.target.value)}
          placeholder={"张三\t28\t12\tNIPT\t泰国BCC\t440123199001011234\tEXT001\t2026-06-01\t2026-06-03\tDr.Li\t1998-05-15\tRPT001\tSND001\t2026-03-01\tN\tN\tG1P0\tNormal\t1234567890\tNIPT"} />
      </Modal>
    </div>
  );
}
