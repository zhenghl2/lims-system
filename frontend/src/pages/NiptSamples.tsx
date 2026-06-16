import { useEffect, useState, useCallback, useRef } from "react";
import { Table, Button, Tag, Modal, Form, Input, DatePicker, Select, InputNumber, Space, Typography, message, Popconfirm, Switch, Popover, Checkbox } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined, UploadOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi } from "../api";

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange",
  EXTRACTION: "cyan", LIBRARY_PREP: "blue", POOLING: "geekblue",
  SEQUENCING: "purple", BIOINFORMATICS: "magenta",
  COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red",
};

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "Registered", RECEIVED: "Received", IN_PROCESS: "In Process",
  EXTRACTION: "核酸提取", LIBRARY_PREP: "文库构建", POOLING: "文库定量及Pooling",
  SEQUENCING: "上机测序", BIOINFORMATICS: "生物信息分析",
  COMPLETED: "Completed", REJECTED: "Rejected",
};

const TEST_OPTIONS = [
  { label: "NIPT Basic", value: "NIPT" },
  { label: "NIPT Basic-All", value: "NIPT_PLUS" },
  { label: "NIPT Plus", value: "NIPT_FULL" },
];

const SOURCE_OPTIONS = [
  { label: "泰国", value: "泰国" },
  { label: "巴西", value: "巴西" },
  { label: "Other", value: "" },
];

const ALL_COLUMNS: Array<{key:string;title:string;dataIndex:string;width:number;visible:boolean;render?:(v:any)=>React.ReactNode}> = [
  { key: "source", title: "Source", dataIndex: "source_institution", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "test_option", title: "Test Option", dataIndex: "test_option", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "external_id", title: "Accessioning ID", dataIndex: "external_id", visible: true, width: 140, render: (v: string) => <Text code>{v || "-"}</Text> },
  { key: "collection_date", title: "Collection Date", dataIndex: "collection_date", visible: true, width: 110, render: (v: string) => v || "-" },
  { key: "acceptance_date", title: "Acceptance Date", dataIndex: "acceptance_date", visible: true, width: 110, render: (v: string) => v || "-" },
  { key: "physician", title: "Physician", dataIndex: "physician", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "patient_id", title: "Patient ID", dataIndex: "id_card", visible: true, width: 160, render: (v: string) => v || "-" },
  { key: "patient_name", title: "Name", dataIndex: "patient_name", visible: true, width: 100 },
  { key: "patient_dob", title: "DOB", dataIndex: "patient_dob", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "age", title: "Age", dataIndex: "age", visible: true, width: 60 },
  { key: "gestational_weeks", title: "Gest. Weeks", dataIndex: "gestational_weeks", visible: true, width: 80, render: (v: number) => v || "-" },
  { key: "report_code", title: "Report Code", dataIndex: "vg_id", visible: true, width: 120, render: (v: string) => v || "-" },
  { key: "send_report_id", title: "Send Report ID", dataIndex: "send_report_id", visible: true, width: 120, render: (v: string) => v || "-" },
  { key: "lmp", title: "LMP", dataIndex: "last_menstrual_period", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "twins", title: "Twin", dataIndex: "multiple_gestation", visible: true, width: 60, render: (v: boolean) => v ? <Tag color="orange">Twin</Tag> : "-" },
  { key: "ivf", title: "IVF", dataIndex: "ivf_status", visible: true, width: 60, render: (v: boolean) => v ? <Tag color="purple">IVF</Tag> : "-" },
  { key: "pregnancy_history", title: "Preg. History", dataIndex: "pregnancy_history", visible: true, width: 100, render: (v: string) => v || "-" },
  { key: "diagnosis", title: "Diagnosis", dataIndex: "clinical_diagnosis", visible: true, width: 130, render: (v: string) => v || "-" },
  { key: "fedex", title: "FedEx No.", dataIndex: "fedex_no", visible: true, width: 120, render: (v: string) => v || "-" },
  { key: "zscore_21", title: "Z21", dataIndex: "zscore_21", visible: true, width: 70, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "zscore_18", title: "Z18", dataIndex: "zscore_18", visible: true, width: 70, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "zscore_13", title: "Z13", dataIndex: "zscore_13", visible: true, width: 70, render: (v: number) => v?.toFixed(3) || "-" },
  { key: "t21", title: "T21", dataIndex: "t21", visible: true, width: 60 },
  { key: "t18", title: "T18", dataIndex: "t18", visible: true, width: 60 },
  { key: "t13", title: "T13", dataIndex: "t13", visible: true, width: 60 },
  { key: "xo", title: "XO", dataIndex: "xo", visible: true, width: 55 },
  { key: "xxx", title: "XXX", dataIndex: "xxx", visible: true, width: 55 },
  { key: "xxy", title: "XXY", dataIndex: "xxy", visible: true, width: 55 },
  { key: "xyy", title: "XYY", dataIndex: "xyy", visible: true, width: 55 },
  { key: "all_chrom", title: "All", dataIndex: "all_chrom", visible: true, width: 55 },
  { key: "fetal_fraction", title: "FF%", dataIndex: "fetal_fraction", visible: true, width: 55, render: (v: number) => v ? `${v}%` : "-" },
  { key: "gender", title: "Sex", dataIndex: "gender", visible: true, width: 55 },
  { key: "other", title: "Other", dataIndex: "other", visible: true, width: 100, render: (v: string) => v || "-" },
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
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileSource, setFileSource] = useState("泰国");
  const [fileList, setFileList] = useState<any[]>([]);
  const [fileMsg, setFileMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [colConfig, setColConfig] = useState(ALL_COLUMNS.map(c => ({...c})));
  const [form] = Form.useForm();
  const [editingKey, setEditingKey] = useState<string>("");

  const visibleCols = colConfig.filter(c => c.visible);
  const columns = [
    { key: "sample_id", title: "Sample ID", dataIndex: "sample_id", visible: true, width: 170, render: (v: string) => <Text code>{v}</Text> },
    { key: "vg_id", title: "VG ID", dataIndex: "vg_id", visible: true, width: 100, render: (v: string) => v || <Text type="secondary">-</Text> },
    ...visibleCols,
    { key: "status", title: "Status", dataIndex: "status", visible: true, width: 150, fixed: "right" as const, render: (v: string, r: any) => {
      const reason = r.rejection_reason || "";
      return (
        <span>
          <Tag color={STATUS_MAP[v] || "default"}>{STATUS_LABEL[v] || v}</Tag>
          {v === "REJECTED" && reason ? <Tag color="red" style={{ fontSize: 10, maxWidth: 120 }} title={reason}>{reason.replace("血浆分离不合格: ", "")}</Tag> : null}
        </span>
      );
    } },


    { key: "actions", title: "", width: 50, fixed: "right" as const,
      render: (_: any, record: any) => (
        <Popconfirm title="Delete?" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  // Patch send_report_id for inline editing (double-click row to edit)
  const sendReportCol = columns.find((c: any) => c.key === "send_report_id");
  if (sendReportCol) {
    // @ts-ignore — override render with record-aware inline editor
    sendReportCol.render = (v: string, record: any) =>
      record.id === editingKey
        ? <Input size="small" defaultValue={v} autoFocus
            onPressEnter={(e: any) => saveCell(record.id, "send_report_id", e.target.value)}
            onBlur={(e: any) => saveCell(record.id, "send_report_id", e.target.value)}
            style={{ width: 100 }} />
        : (v || "-");
  }

  // Patch acceptance_date for inline editing
  const acceptDateCol = columns.find((c: any) => c.key === "acceptance_date");
  if (acceptDateCol) {
    // @ts-ignore
    acceptDateCol.render = (v: string, record: any) =>
      record.id === editingKey
        ? <DatePicker size="small" defaultValue={v ? dayjs(v) : dayjs()} autoFocus
            onChange={(d: any) => { if (d) saveCell(record.id, "acceptance_date", d.format("YYYY-MM-DD")); }}
            style={{ width: 110 }} format="YYYY-MM-DD" />
        : (v || <Text type="secondary">-</Text>);
  }

  const toggleCol = (key: string) => {
    setColConfig(prev => prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };

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
    sample_type_code: "BLOOD",
    panel_code: values.panel || "NIPT",
    test_option: values.test_option || "NIPT",
    source_institution: values.source === "" ? values.source_other : values.source,
    external_id: values.external_id || "",
    vg_id: values.vg_id || "",
    collection_date: values.collection_date ? dayjs(values.collection_date).format("YYYY-MM-DD") : undefined,
    acceptance_date: values.acceptance_date ? dayjs(values.acceptance_date).format("YYYY-MM-DD") : undefined,
    physician: values.physician || "",
    id_card: values.id_card || "",
    patient_name: values.patient_name || "",
    patient_dob: values.patient_dob ? dayjs(values.patient_dob).format("YYYY-MM-DD") : undefined,
    age: values.age,
    gestational_weeks: values.gestational_weeks,
    report_code: values.vg_id || "",
    send_report_id: values.send_report_id || "",
    last_menstrual_period: values.last_menstrual_period ? dayjs(values.last_menstrual_period).format("YYYY-MM-DD") : undefined,
    multiple_gestation: values.multiple_gestation || false,
    ivf_status: values.ivf_status || false,
    pregnancy_history: values.pregnancy_history || "",
    clinical_diagnosis: values.clinical_diagnosis || "",
    fedex_no: values.fedex_no || "",
  });

  const handleFileImport = async () => {
    if (fileList.length === 0) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("source", fileSource);
      fileList.forEach((f: File) => formData.append("files", f));
      const result = await samplesApi.registerFromPdf(formData);
      setImportResult(result.data);
      setResultModalOpen(true);
      setFileModalOpen(false);
      setFileList([]);
      setFileMsg("");
      message.success(`Imported ${result.data.created_count} samples`);
      // Trigger Excel download if provided
      if (result.data.excel_b64) {
        try {
          const byteChars = atob(result.data.excel_b64);
          const byteNums = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
          const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileSource === '巴西' ? 'baxi_NIPPT.xlsx' : 'taiguoNIPT.xlsx';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (dlErr) {
          console.error('Excel download failed:', dlErr);
        }
      }
    } catch (err: any) {
      const detail = err?.response?.data || {};
      // If some samples were created despite errors, show success first
      if (detail.created_count > 0) {
        message.success(`Imported ${detail.created_count} samples`);
        if (detail.skipped_duplicates > 0) {
          message.warning(`${detail.skipped_duplicates} duplicates skipped`);
        }
      } else if (detail.skipped_duplicates > 0) {
        message.warning(`No new samples: ${detail.skipped_duplicates} duplicates skipped, ${detail.error_count || 0} errors`);
      } else {
        const errMsg = typeof detail?.error === 'object' ? JSON.stringify(detail.error) : (String(detail?.error || detail?.detail || "Import failed"));
        message.error(errMsg);
      }
    } finally {
      setImporting(false);
    }
  };

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
        patient_name: p[0]?.trim() || "", age: parseInt(p[1]) || null, gestational_weeks: parseInt(p[2]) || null,
        panel_code: p[3]?.trim() || "NIPT", source_institution: p[4]?.trim() || "", id_card: p[5]?.trim() || "",
        external_id: p[6]?.trim() || "", collection_date: p[7]?.trim() || undefined, acceptance_date: p[8]?.trim() || undefined,
        physician: p[9]?.trim() || "", patient_dob: p[10]?.trim() || undefined, report_code: p[11]?.trim() || "",
        send_report_id: p[12]?.trim() || "", last_menstrual_period: p[13]?.trim() || undefined,
        multiple_gestation: p[14]?.trim() === "Y", ivf_status: p[15]?.trim() === "Y",
        pregnancy_history: p[16]?.trim() || "", clinical_diagnosis: p[17]?.trim() || "",
        fedex_no: p[18]?.trim() || "", test_option: p[19]?.trim() || "NIPT",
      };
    });
    try {
      await samplesApi.batchCreate({ samples });
      message.success(`Registered ${samples.length}`);
      setBatchText(""); setBatchMode(false); fetchData();
    } catch { message.error("Failed"); }
  };

  const saveCell = async (id: string, field: string, value: string) => {
    if (!id || !value) return;
    setEditingKey("");
    setData(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
    try { await samplesApi.update(id, { [field]: value }); } catch { message.error("Save failed"); }
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
          <Popover trigger="click" title="Column Display" content={
              <div style={{ maxHeight: 400, overflow: "auto", minWidth: 200 }}>
                {colConfig.map(c => (
                  <div key={c.key} style={{ marginBottom: 4 }}>
                    <Checkbox checked={c.visible} onChange={() => toggleCol(c.key)}>{c.title}</Checkbox>
                  </div>
                ))}
              </div>
            }>
              <Button icon={<SettingOutlined />}>Columns</Button>
            </Popover>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>Register</Button>
          <Button icon={<PlusOutlined />} onClick={() => setBatchMode(true)}>Batch Import</Button>
          <Button icon={<UploadOutlined />} onClick={() => { setFileModalOpen(true); setFileList([]); }}>Register from File</Button>
        </Space>
      </div>
      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <Input.Search placeholder="Search..." allowClear onSearch={(v) => { setSearch(v); setPage(1); }} style={{ width: 280 }} />
        <Select placeholder="Status" allowClear style={{ width: 150 }} value={statusFilter || undefined}
          onChange={(v) => { setStatusFilter(v || ""); setPage(1); }}
          options={["", "REGISTERED", "RECEIVED", "IN_PROCESS", "COMPLETED", "REPORTED", "REJECTED"].map(v => ({ label: v || "All", value: v }))} />
      </div>
      <Table rowKey="id" dataSource={data} columns={columns} loading={loading} size="small" onRow={(record) => ({ onDoubleClick: () => { if (record.id) setEditingKey(record.id); } })}
        scroll={{ x: 4500 }}
        pagination={{ current: page, pageSize, total, showTotal: t => `Total ${t}`, onChange: (p) => setPage(p) }} />

      {/* Register Modal */}
      <Modal title="Register NIPT Sample" open={modalOpen} onOk={handleRegister} onCancel={() => setModalOpen(false)} width={700} destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="source" label="A. Source"><Select options={SOURCE_OPTIONS} style={{ width: 160 }} /></Form.Item>
            <Form.Item name="source_other" label="Other"><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="test_option" label="B. Test Option" initialValue="NIPT"><Select options={TEST_OPTIONS} style={{ width: 160 }} /></Form.Item>
            <Form.Item name="external_id" label="C. Accessioning ID"><Input style={{ width: 160 }} /></Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="collection_date" label="D. Collection Date"><DatePicker style={{ width: 160 }} /></Form.Item>
            <Form.Item name="acceptance_date" label="E. Acceptance Date" initialValue={dayjs()}><DatePicker style={{ width: 160 }} /></Form.Item>
            <Form.Item name="physician" label="G. Physician"><Input style={{ width: 160 }} /></Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="vg_id" label="VG ID"><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="id_card" label="H. Patient ID"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="patient_name" label="I. Name" rules={[{ required: true }]}><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="patient_dob" label="J. DOB"><DatePicker style={{ width: 160 }} /></Form.Item>
            <Form.Item name="age" label="K. Age"><InputNumber min={1} max={100} style={{ width: 80 }} /></Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="gestational_weeks" label="L. Gest. Weeks"><InputNumber min={1} max={45} style={{ width: 100 }} /></Form.Item>
            <Form.Item name="report_code" label="M. Report Code"><Input style={{ width: 140 }} disabled placeholder="= VG ID" /></Form.Item>
            <Form.Item name="send_report_id" label="N. Send Report ID"><Input style={{ width: 140 }} /></Form.Item>
            <Form.Item name="last_menstrual_period" label="O. LMP"><DatePicker style={{ width: 160 }} /></Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="multiple_gestation" label="P. Twin" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="ivf_status" label="Q. IVF" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="pregnancy_history" label="R. Preg. History"><Input placeholder="G/P" style={{ width: 120 }} /></Form.Item>
            <Form.Item name="clinical_diagnosis" label="S. Diagnosis"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="fedex_no" label="T. FedEx No."><Input style={{ width: 160 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Batch Import Modal */}
      <Modal title="Batch Import NIPT Samples" open={batchMode} onOk={handleBatchRegister}
        onCancel={() => { setBatchMode(false); setBatchText(""); }} width={800}>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">Paste tab-separated (A-T columns):</Text>
          <Text code style={{ display: "block", marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
            {"Name\tAge\tGestWeeks\tPanel\tSource\tIDCard\tExtID\tCollDate\tAcptDate\tPhysician\tDOB\tRptCode\tSendID\tLMP\tTwin(Y/N)\tIVF(Y/N)\tPregHist\tDiagnosis\tFedEx\tTestOpt"}
          </Text>
        </div>
        <TextArea rows={12} value={batchText} onChange={e => setBatchText(e.target.value)}
          placeholder={"Zhang Li\t28\t12\tNIPT\t泰国\t440101199801012345\tBCC-2026001\t2026-06-01\t2026-06-03\tDr.Somchai\t1998-05-15\tRPT-BCC-001\tSND001\t2026-03-01\tN\tN\tG1P0\tNormal\tFX1234567890\tNIPT"} />
      </Modal>

      {/* Register from File Modal */}
      <Modal title="Register from File" open={fileModalOpen} onCancel={() => { setFileModalOpen(false); setFileList([]); }} width={600}
        footer={[
          <Button key="cancel" onClick={() => { setFileModalOpen(false); setFileList([]); }}>Cancel</Button>,
          <Button key="submit" type="primary" loading={importing} disabled={fileList.length === 0} onClick={handleFileImport}>
            Import & Register
          </Button>,
        ]}>
        <Form layout="vertical">
          <Form.Item label="Source" required>
            <Select value={fileSource} onChange={setFileSource}
              options={[{ label: "泰国", value: "泰国" }, { label: "巴西", value: "巴西" }]}
              style={{ width: 200 }} />
          </Form.Item>
          <Form.Item label={fileSource === "泰国" ? "Select PDF Folder" : "Select File"}>
            {fileSource === "泰国" ? (
              <>
                <input
                  type="file"
                  ref={folderInputRef}
                  style={{ display: "none" }}
                  {...{ webkitdirectory: "", directory: "" } as any}
                  multiple
                  accept=".pdf"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
                    if (pdfs.length === 0) {
                      message.warning("No PDF files found in the selected folder");
                    } else {
                      setFileList(pdfs);
                      setFileMsg(`Selected ${pdfs.length} PDF file(s) from folder`);
                    }
                  }}
                />
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  multiple
                  accept=".pdf"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
                    if (pdfs.length === 0) {
                      message.warning("No PDF files selected");
                    } else {
                      setFileList(pdfs);
                      setFileMsg(`Selected ${pdfs.length} PDF file(s)`);
                    }
                  }}
                />
                <Button icon={<UploadOutlined />} onClick={() => folderInputRef.current?.click()}>
                  Choose Folder
                </Button>
                <Button icon={<UploadOutlined />} style={{ marginLeft: 8 }} onClick={() => fileInputRef.current?.click()}>
                  Choose Files
                </Button>
                {fileMsg && <Text type="secondary" style={{ marginLeft: 12 }}>{fileMsg}</Text>}
              </>
            ) : (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  multiple
                  accept=".docx"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const docxs = files.filter(f => f.name.toLowerCase().endsWith(".docx"));
                    if (docxs.length === 0) {
                      message.warning("No .docx files selected");
                    } else {
                      setFileList(docxs);
                      setFileMsg("Selected " + docxs.length + " docx file(s)");
                    }
                  }}
                />
                <input
                  type="file"
                  ref={folderInputRef}
                  style={{ display: "none" }}
                  {...{ webkitdirectory: "", directory: "" } as any}
                  multiple
                  accept=".docx"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const docxs = files.filter(f => f.name.toLowerCase().endsWith(".docx") && !f.name.startsWith("~$"));
                    if (docxs.length === 0) {
                      message.warning("No .docx files found in folder");
                    } else {
                      setFileList(docxs);
                      setFileMsg("Selected " + docxs.length + " docx file(s) from folder");
                    }
                  }}
                />
                <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
                  Choose Files
                </Button>
                <Button icon={<UploadOutlined />} style={{ marginLeft: 8 }} onClick={() => folderInputRef.current?.click()}>
                  Choose Folder
                </Button>
                {fileMsg && <Text type="secondary" style={{ marginLeft: 12 }}>{fileMsg}</Text>}
              </>
            )}
          </Form.Item>
          <Text type="secondary">
            {fileSource === "泰国"
              ? "Select a folder containing Thai NIPT registration PDF forms."
              : "Select a folder or individual .docx files from Brazil NIPPT registrations."}
          </Text>
        </Form>
      </Modal>

      {/* Import Result Modal */}
      <Modal
        title="Import Results"
        open={resultModalOpen}
        onCancel={() => setResultModalOpen(false)}
        footer={[
          <Button key="ok" type="primary" onClick={() => { setResultModalOpen(false); fetchData(); }}>
            Done
          </Button>,
        ]}
        width={550}
      >
        {importResult && (
          <div>
            <p><Text strong>Created:</Text> <Tag color="green">{importResult.created_count}</Tag> samples</p>
            {importResult.skipped_duplicates > 0 && (
              <p><Text strong>Skipped (duplicates):</Text> <Tag color="orange">{importResult.skipped_duplicates}</Tag></p>
            )}
            {importResult.error_count > 0 && (
              <p><Text strong>Errors:</Text> <Tag color="red">{importResult.error_count}</Tag></p>
            )}
            {importResult.excel_path && (
              <p><Text strong>Excel export:</Text> <Text code>{importResult.excel_path.split("/").pop()}</Text></p>
            )}
            {importResult.created?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text strong>Created samples:</Text>
                <div style={{ maxHeight: 200, overflow: "auto", marginTop: 4 }}>
                  {importResult.created.map((s: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, padding: "2px 0" }}>
                      <Tag>{s.sample_id}</Tag> {s.patient_name} | {s.panel_info || "-"}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
