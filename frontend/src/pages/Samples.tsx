import { useState, useEffect } from "react";
import {
  Table, Card, Button, Space, Tag, Typography, Input,
  Modal, Form, Select, message, Tooltip, DatePicker, Popconfirm,
} from "antd";
import {
  PlusOutlined, SearchOutlined, BarcodeOutlined,
  ReloadOutlined, CheckOutlined, CloseOutlined, EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { samplesApi, panelsApi } from "../api";
import type { Sample } from "../api/types";
import { usePaginated } from "../hooks/useList";
import DashboardLayout from "../components/DashboardLayout";

const { Text } = Typography;
const { Search } = Input;
const { RangePicker } = DatePicker;

// ── Status colors ─────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  RECEIVED: "blue",
  ACCEPTED: "green",
  REJECTED: "red",
  IN_PROCESS: "processing",
  COMPLETED: "cyan",
  REPORTED: "purple",
  ARCHIVED: "default",
  DISPOSED: "default",
};

const STATUS_OPTIONS = [
  { value: "RECEIVED", label: "Received" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "IN_PROCESS", label: "In Process" },
  { value: "COMPLETED", label: "Completed" },
  { value: "REPORTED", label: "Reported" },
];

const SAMPLE_TYPE_OPTIONS = [
  { value: "d64f2a8f-19ce-47f4-8a92-9bbc3019e52c", label: "Maternal Plasma (cfDNA)" },
  { value: "326ae28b-6a71-4ec6-b816-c1cb2d93a484", label: "Cervical Swab" },
  { value: "4c30b9d5-9d17-45f0-bc7c-7bee88d1f5c6", label: "Liquid-Based Cytology" },
];

export default function Samples() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSample, setEditSample] = useState<Sample | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectSample, setRejectSample] = useState<Sample | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [panels, setPanels] = useState<{ id: string; code: string; name: string }[]>([]);

  // ── Filters ──────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [panelFilter, setPanelFilter] = useState<string | null>(null);
  const [sampleTypeFilter, setSampleTypeFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);

  const filters: Record<string, unknown> = {};
  if (statusFilter) filters.status = statusFilter;
  if (panelFilter) filters.panel = panelFilter;
  if (sampleTypeFilter) filters.sample_type = sampleTypeFilter;
  if (dateRange[0]) filters.receipt_date__from = dateRange[0];
  if (dateRange[1]) filters.receipt_date__to = dateRange[1];

  const { items, total, page, loading, fetch, setPage, setSearch, search } =
    usePaginated(
      samplesApi.list,
      { autoFetch: true, ordering: "-receipt_date", filters }
    );

  // Load panels for receive form + filter
  useEffect(() => {
    panelsApi.list().then(res => {
      const data = (res.data as any).results || res.data || [];
      setPanels(Array.isArray(data) ? data : []);
    }).catch(() => setPanels([]));
  }, []);

  const handleDelete = async (record: Sample) => {
    try {
      await samplesApi.delete(record.id);
      message.success(`Deleted ${record.sample_id}`);
      fetch();
    } catch {
      message.error("Failed to delete sample");
    }
  };

  const columns = [
    {
      title: "Sample ID",
      dataIndex: "sample_id",
      key: "sample_id",
      width: 180,
      fixed: "left" as const,
      render: (t: string) => (
        <Space size={4}>
          <BarcodeOutlined style={{ color: "#1677ff" }} />
          <Text copyable={{ text: t }} style={{ fontWeight: 500 }}>{t}</Text>
        </Space>
      ),
    },
    { title: "Patient ID", dataIndex: "patient_id", key: "patient_id", width: 130,
      render: (t: string) => t || "-"
    },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150,
      render: (t: string) => t || "-"
    },
    { title: "Sample Type", dataIndex: "sample_type_code", key: "sample_type_code", width: 140 },
    { title: "Panel", dataIndex: "panel_info", key: "panel_info", width: 100,
      render: (t: string) => t ? <Tag>{t}</Tag> : "-"
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (s: string) => (
        <Tag color={STATUS_COLOR[s] || "default"}>
          {s.replace(/_/g, " ")}
        </Tag>
      ),
    },
    {
      title: "Received Date",
      dataIndex: "receipt_date",
      key: "receipt_date",
      width: 120,
      render: (d: string) => dayjs(d).format("YYYY-MM-DD"),
    },
    {
      title: "Actions",
      key: "actions",
      width: 220,
      fixed: "right" as const,
      render: (_: unknown, record: Sample) => (
        <Space size="small">
          <Tooltip title="Edit">
            <Button
              icon={<EditOutlined />} size="small" type="text"
              onClick={() => {
                setEditSample(record);
                editForm.setFieldsValue({
                  patient_id: record.patient_id || "",
                  patient_name: record.patient_name || "",
                  ordering_physician: record.ordering_physician || "",
                  ordering_facility: record.ordering_facility || "",
                  collection_date: record.collection_date ? dayjs(record.collection_date) : null,
                  receipt_temp: record.receipt_temp || "",
                });
                setEditOpen(true);
              }}
            />
          </Tooltip>
          {record.status === "RECEIVED" && (
            <>
              <Tooltip title="Accept">
                <Button
                  icon={<CheckOutlined />} size="small" type="text"
                  style={{ color: "#52c41a" }}
                  onClick={async () => {
                    try {
                      await samplesApi.accept(record.id);
                      message.success(`Accepted ${record.sample_id}`);
                      fetch();
                    } catch {
                      message.error("Failed to accept sample");
                    }
                  }}
                />
              </Tooltip>
              <Tooltip title="Reject">
                <Button
                  icon={<CloseOutlined />} size="small" type="text" danger
                  onClick={() => {
                    setRejectSample(record);
                    rejectForm.resetFields();
                    setRejectOpen(true);
                  }}
                />
              </Tooltip>
            </>
          )}
          <Popconfirm
            title="Delete sample?"
            description={`This will delete ${record.sample_id}. Confirm?`}
            onConfirm={() => handleDelete(record)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete">
              <Button icon={<DeleteOutlined />} size="small" type="text" danger />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleRejectSubmit = async () => {
    if (!rejectSample) return;
    try {
      const values = await rejectForm.validateFields();
      const reason = values.reason || "OTHER";
      const note = values.note || "";
      await samplesApi.reject(rejectSample.id, reason, note);
      message.warning(`Rejected ${rejectSample.sample_id}`);
      setRejectOpen(false);
      rejectForm.resetFields();
      setRejectSample(null);
      fetch();
    } catch (e: any) {
      if (e?.errorFields) {
        message.error("Please select a rejection reason");
      } else if (e?.response?.data) {
        const detail = e.response.data;
        const msgs = Object.entries(detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
        message.error(msgs.join("; "));
      } else if (e instanceof Error) {
        message.error("Failed to reject sample");
      }
    }
  };

  const handleReceive = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const typeMap: Record<string, string> = {
        "plasma-cfdna": "d64f2a8f-19ce-47f4-8a92-9bbc3019e52c",
        "cervical-swab": "326ae28b-6a71-4ec6-b816-c1cb2d93a484",
        "lbc": "4c30b9d5-9d17-45f0-bc7c-7bee88d1f5c6",
      };
      const sampleTypeId = typeMap[values.sample_type_id as string];
      if (!sampleTypeId) {
        message.error("请选择有效的样本类型");
        setSubmitting(false);
        return;
      }

      const collectionDate = values.collection_date
        ? (values.collection_date as dayjs.Dayjs).format("YYYY-MM-DD")
        : null;

      await samplesApi.create({
        patient_id: values.patient_id || "",
        patient_name: (values.patient_name as string) || "",
        ordering_physician: (values.ordering_physician as string) || "",
        ordering_facility: (values.ordering_facility as string) || "",
        collection_date: collectionDate,
        receipt_temp: (values.receipt_temp as string) || "",
        sample_type_id: sampleTypeId,
        panel_id: values.panel_id || undefined,
        receipt_date: dayjs().format("YYYY-MM-DD"),
        receipt_time: dayjs().format("HH:mm:ss"),
      });
      message.success("样本接收成功");
      setReceiveOpen(false);
      form.resetFields();
      fetch();
    } catch (err) {
      message.error("样本接收失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (values: Record<string, unknown>) => {
    if (!editSample) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      if (values.patient_id !== undefined) payload.patient_id = values.patient_id || "";
      if (values.patient_name !== undefined) payload.patient_name = values.patient_name || "";
      if (values.ordering_physician !== undefined) payload.ordering_physician = values.ordering_physician || "";
      if (values.ordering_facility !== undefined) payload.ordering_facility = values.ordering_facility || "";
      if (values.receipt_temp !== undefined) payload.receipt_temp = values.receipt_temp || "";
      if (values.collection_date) {
        payload.collection_date = (values.collection_date as dayjs.Dayjs).format("YYYY-MM-DD");
      }
      await samplesApi.update(editSample.id, payload);
      message.success("Sample updated");
      setEditOpen(false);
      setEditSample(null);
      editForm.resetFields();
      fetch();
    } catch (err: any) {
      const detail = err?.response?.data;
      if (detail && typeof detail === "object") {
        const msgs = Object.entries(detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
        message.error(msgs.join("; "));
      } else {
        message.error("Failed to update sample");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout header="Samples">
      {/* ── Toolbar ────────────────────────────────────────── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Space wrap>
            <Search
              placeholder="Search sample ID or patient ID..."
              prefix={<SearchOutlined />}
              style={{ width: 280 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onSearch={() => fetch()}
              allowClear
            />
            <Select
              placeholder="Status"
              allowClear
              style={{ width: 140 }}
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
            <Select
              placeholder="Sample Type"
              allowClear
              style={{ width: 180 }}
              options={SAMPLE_TYPE_OPTIONS}
              value={sampleTypeFilter}
              onChange={(v) => setSampleTypeFilter(v)}
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
            <Button
              icon={<ReloadOutlined />}
              onClick={() => { fetch(); message.success("Refreshed"); }}
            >
              Refresh
            </Button>
          </Space>
          <Space>
            <Text type="secondary">{total} total</Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setReceiveOpen(true)}>
              Receive Sample
            </Button>
          </Space>
        </div>
      </Card>

      {/* ── Table ──────────────────────────────────────────── */}
      <Card>
        <Table<Sample>
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          size="middle"
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: 50,
            total,
            showSizeChanger: false,
            showTotal: (t) => `Total ${t} samples`,
            onChange: setPage,
          }}
        />
      </Card>

      {/* ── Receive Sample Modal ───────────────────────────── */}
      <Modal
        title={
          <Space>
            <BarcodeOutlined style={{ color: "#1677ff" }} />
            Receive New Sample
          </Space>
        }
        open={receiveOpen}
        onCancel={() => setReceiveOpen(false)}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleReceive} style={{ marginTop: 16 }}>
          <Form.Item name="sample_type_id" label="Sample Type" rules={[{ required: true, message: "Please select a sample type" }]}>
            <Select placeholder="Select..." options={[
              { label: "Maternal Plasma (cfDNA) — Streck BCT", value: "plasma-cfdna" },
              { label: "Cervical Swab — PreservCyt", value: "cervical-swab" },
              { label: "Liquid-Based Cytology — SurePath", value: "lbc" },
            ]} />
          </Form.Item>

          <Form.Item name="panel_id" label="Test Panel">
            <Select placeholder="Select test panel (optional)" allowClear options={panels.map(p => ({
              value: p.id, label: `${p.code} — ${p.name}`,
            }))} />
          </Form.Item>

          <Form.Item name="patient_id" label="Patient ID">
            <Input placeholder="Leave blank to auto-generate" />
          </Form.Item>

          <Form.Item name="patient_name" label="Patient Name">
            <Input />
          </Form.Item>

          <Form.Item name="collection_date" label="Collection Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>

          <Form.Item name="ordering_physician" label="Ordering Physician">
            <Input />
          </Form.Item>

          <Form.Item name="ordering_facility" label="Ordering Facility">
            <Input />
          </Form.Item>

          <Form.Item name="receipt_temp" label="Transport Temperature">
            <Input placeholder="e.g. 4C, ambient" />
          </Form.Item>

          <div style={{ textAlign: "right", marginTop: 8 }}>
            <Space>
              <Button onClick={() => setReceiveOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Receive
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>

      {/* ── Edit Sample Modal ──────────────────────────────── */}
      <Modal
        title={`Edit Sample: ${editSample?.sample_id || ""}`}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditSample(null); editForm.resetFields(); }}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="patient_id" label="Patient ID">
            <Input />
          </Form.Item>
          <Form.Item name="patient_name" label="Patient Name">
            <Input />
          </Form.Item>
          <Form.Item name="collection_date" label="Collection Date">
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="ordering_physician" label="Ordering Physician">
            <Input />
          </Form.Item>
          <Form.Item name="ordering_facility" label="Ordering Facility">
            <Input />
          </Form.Item>
          <Form.Item name="receipt_temp" label="Transport Temperature">
            <Input placeholder="e.g. 4C, ambient" />
          </Form.Item>
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <Space>
              <Button onClick={() => { setEditOpen(false); setEditSample(null); editForm.resetFields(); }}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>Save</Button>
            </Space>
          </div>
        </Form>
      </Modal>

      {/* ── Reject Sample Modal ────────────────────────────── */}
      <Modal
        title={`Reject sample ${rejectSample?.sample_id || ""}`}
        open={rejectOpen}
        onCancel={() => {
          setRejectOpen(false);
          rejectForm.resetFields();
          setRejectSample(null);
        }}
        onOk={handleRejectSubmit}
        okText="Reject"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Form form={rejectForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Select placeholder="Select a reason" options={[
              { value: "HEMOLYZED", label: "Hemolyzed" },
              { value: "INSUFFICIENT_VOLUME", label: "Insufficient volume" },
              { value: "WRONG_CONTAINER", label: "Wrong container" },
              { value: "LABELING_ERROR", label: "Labeling error" },
              { value: "TEMPERATURE_EXCURSION", label: "Temperature excursion" },
              { value: "EXPIRED_TRANSPORT", label: "Expired transport time" },
            ]} />
          </Form.Item>
          <Form.Item name="note" label="Additional notes (optional)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
