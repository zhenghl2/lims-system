import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Input, Button, Table, Tag, Descriptions, Space, Spin, Empty, Steps, message, Image } from "antd";
import { ExperimentOutlined, InboxOutlined, SyncOutlined, FileDoneOutlined, SearchOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, CheckOutlined } from "@ant-design/icons";
import api from "../api/client";

const { Title, Text } = Typography;

const STATUS_MAP: Record<string, string> = {
  REGISTERED: "default", RECEIVING: "processing", RECEIVED: "blue",
  IN_PROCESS: "orange", COMPLETED: "green", REPORTED: "purple",
  REJECTED: "red", ACCEPTED: "cyan",
};

const SEX_MAP: Record<string, string> = { M: "Male", F: "Female" };

const TEST_ITEM_MAP: Record<string, string> = {
  HPV_15: "HPV 15-Type",
  HPV_23: "HPV 23-Type",
};

function stepStatusToAntd(s: string): "wait" | "process" | "finish" | "error" {
  if (s === "COMPLETED") return "finish";
  if (s === "FAILED") return "error";
  if (s === "IN_PROGRESS" || s === "PENDING_QC") return "process";
  return "wait";
}

export default function HpvDashboard() {
  const [stats, setStats] = useState<any>({});
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedSample, setSelectedSample] = useState<any>(null);
  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);
  const [samplePhotos, setSamplePhotos] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    api.get("/hpv/batches/dashboard_stats/")
      .then(r => setStats(r.data))
      .catch(() => {});
  }, []);

  const s = stats as Record<string, number>;

  const handleSearch = () => {
    const q = query.trim();
    if (!q) { setSearchResults([]); return; }
    setSearching(true);
    setSelectedSample(null);
    setWorkflowSteps([]);

    api.get("/samples/", { params: { panel: "HPV", search: q } })
      .then(r => {
        const results = r.data.results || r.data;
        setSearchResults(Array.isArray(results) ? results : []);
      })
      .catch(() => message.error("Search failed"))
      .finally(() => setSearching(false));
  };

  const viewSample = (sample: any) => {
    setSelectedSample(sample);
    setLoadingDetail(true);

    api.get("/workflow-steps/", { params: { sample: sample.id } })
      .then(r => {
        const steps = r.data.results || r.data;
        setWorkflowSteps(Array.isArray(steps) ? steps : []);
      })
      .catch(() => setWorkflowSteps([]))
      .finally(() => setLoadingDetail(false));

    api.get("/photos/", { params: { sample: sample.id } })
      .then(r => {
        const photos = r.data.results || r.data;
        setSamplePhotos(Array.isArray(photos) ? photos : []);
      })
      .catch(() => setSamplePhotos([]));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const searchColumns = [
    { title: "Sample ID", dataIndex: "sample_id", key: "sample_id", width: 180, ellipsis: true },
    { title: "Patient Name", dataIndex: "patient_name", key: "patient_name", width: 150 },
    { title: "Sex", dataIndex: "patient_sex", key: "patient_sex", width: 60, render: (v: string) => SEX_MAP[v] || v || "-" },
    { title: "Age", dataIndex: "age", key: "age", width: 60 },
    { title: "Source Institution", dataIndex: "sample_source", key: "sample_source", width: 160, ellipsis: true },
    {
      title: "Receiver", dataIndex: "received_by_name", key: "received_by_name", width: 100,
      render: (v: string) => v || "-",
    },
    {
      title: "Receipt Date", dataIndex: "receipt_date", key: "receipt_date", width: 120,
      render: (d: string) => d ? d.slice(0, 10) : "-",
    },
    {
      title: "Test Item", dataIndex: "test_item", key: "test_item", width: 120,
      render: (v: string) => TEST_ITEM_MAP[v] || v || "-",
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 110,
      render: (v: string) => <Tag color={STATUS_MAP[v] || "default"}>{v}</Tag>,
    },
    {
      title: "", key: "action", width: 80,
      render: (_: any, record: any) => (
        <Button type="link" size="small" onClick={() => viewSample(record)}>
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>HPV Dashboard</Title>

      {/* Stats cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Total Samples" value={s.total || 0} prefix={<ExperimentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Pending Receiving" value={s.pending || 0} prefix={<InboxOutlined />} valueStyle={{ color: "#faad14" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Received" value={s.received || 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: "#1890ff" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Rejected" value={s.rejected || 0} prefix={<CloseCircleOutlined />} valueStyle={{ color: "#ff4d4f" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="In Process" value={s.in_progress || 0} prefix={<SyncOutlined spin={!!(s.in_progress)} />} valueStyle={{ color: "#1890ff" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Completed" value={s.completed || 0} prefix={<CheckOutlined />} valueStyle={{ color: "#52c41a" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Reported" value={s.reported || 0} prefix={<FileDoneOutlined />} valueStyle={{ color: "#52c41a" }} />
          </Card>
        </Col>
      </Row>

      {/* Sample search */}
      <Card style={{ marginTop: 16 }} title="Sample Query">
        <Space style={{ width: "100%", marginBottom: 16 }}>
          <Input
            placeholder="Search by Sample ID, Patient Name or Patient ID"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ width: 400 }}
            prefix={<SearchOutlined />}
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={searching}>
            Search
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setQuery(""); setSearchResults([]); setSelectedSample(null); setWorkflowSteps([]); }}>
            Clear
          </Button>
        </Space>

        {/* Search results table */}
        {searchResults.length > 0 && (
          <Table
            rowKey="id"
            columns={searchColumns}
            dataSource={searchResults}
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
            style={{ marginBottom: 16 }}
          />
        )}
        {query && !searching && searchResults.length === 0 && (
          <Empty description="No samples found" style={{ marginBottom: 16 }} />
        )}

        {/* Sample detail panel */}
        {selectedSample && (
          <Card
            type="inner"
            title={`Sample Detail: ${selectedSample.sample_id}`}
            extra={<Button size="small" onClick={() => setSelectedSample(null)}>Close</Button>}
            style={{ marginTop: 16 }}
          >
            <Spin spinning={loadingDetail}>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Sample ID">{selectedSample.sample_id}</Descriptions.Item>
                <Descriptions.Item label="Patient Name">{selectedSample.patient_name || "-"}</Descriptions.Item>
                <Descriptions.Item label="Patient ID">{selectedSample.patient_id || "-"}</Descriptions.Item>
                <Descriptions.Item label="Sex">{SEX_MAP[selectedSample.patient_sex] || selectedSample.patient_sex || "-"}</Descriptions.Item>
                <Descriptions.Item label="Age">{selectedSample.age ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Source Institution">{selectedSample.sample_source || "-"}</Descriptions.Item>
                <Descriptions.Item label="Institution Sample ID">{selectedSample.institution_sample_id || "-"}</Descriptions.Item>
                <Descriptions.Item label="Collection Date">{selectedSample.collection_date?.slice(0, 10) || "-"}</Descriptions.Item>
                <Descriptions.Item label="Receiver">
                  {selectedSample.received_by_name || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Receipt Date">
                  {selectedSample.receipt_date?.slice(0, 10) || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag color={STATUS_MAP[selectedSample.status] || "default"}>{selectedSample.status}</Tag>
                </Descriptions.Item>
              </Descriptions>

              {/* Experiment / Workflow Status */}
              <Title level={5} style={{ marginTop: 16 }}>Experiment Status</Title>
              {workflowSteps.length > 0 ? (
                <Steps
                  direction="horizontal"
                  size="small"
                  items={workflowSteps.map((step: any) => ({
                    title: step.step_name,
                    status: stepStatusToAntd(step.status),
                    description: (
                      <Space direction="vertical" size={0}>
                        <Tag color={
                          step.status === "COMPLETED" ? "green" :
                          step.status === "FAILED" ? "red" :
                          step.status === "IN_PROGRESS" || step.status === "PENDING_QC" ? "blue" : "default"
                        } style={{ fontSize: 11 }}>
                          {step.status}
                        </Tag>
                        {step.performed_by_name && (
                          <Text type="secondary" style={{ fontSize: 11 }}>{step.performed_by_name}</Text>
                        )}
                        {step.completed_at && (
                          <Text type="secondary" style={{ fontSize: 10 }}>{step.completed_at?.slice(0, 10)}</Text>
                        )}
                      </Space>
                    ),
                  }))}
                  style={{ overflowX: "auto" }}
                />
              ) : (
                !loadingDetail && (
                  <Text type="secondary">
                    {["REGISTERED", "RECEIVING"].includes(selectedSample.status)
                      ? "Sample has not entered lab workflow yet."
                      : "No experiment data available."}
                  </Text>
                )
              )}

              {/* Receiving Photos */}
              {samplePhotos.length > 0 && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>Receiving Photos ({samplePhotos.length})</Title>
                  <Row gutter={[8, 8]}>
                    {samplePhotos.map((photo: any) => (
                      <Col key={photo.id} xs={12} sm={8} md={6}>
                        <Image
                          src={photo.image}
                          alt={`Receiving photo ${photo.id}`}
                          style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 4 }}
                        />
                      </Col>
                    ))}
                  </Row>
                </>
              )}
            </Spin>
          </Card>
        )}
      </Card>
    </div>
  );
}
