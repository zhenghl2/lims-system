import { Table,  useEffect, useState } from "react";
import { Table,  Row, Col, Card, Typography, Statistic, Typography, Table, Tag, Space, Empty } from "antd";
import { Table,  ExperimentOutlined, InboxOutlined, CheckCircleOutlined, CloseCircleOutlined, FileDoneOutlined, FilterOutlined, BuildOutlined, MergeCellsOutlined, CloudUploadOutlined, BarChartOutlined } from "@ant-design/icons";
import { Table,  samplesApi, runsApi } from "../api";
import { Table,  useTranslation } from "../i18n/useTranslation";

const { Title, Text } = Typography;

export default function NiptDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>({});
  const [runStats, setRunStats] = useState<any[]>([]);

  useEffect(() => {
    samplesApi.statsByPanel().then(r => {
      const panels = (r.data || []) as Array<Record<string, number|string>>;
      const nipt = panels.find(p => p.panel_code === "NIPT") || {};
      const niptPlus = panels.find(p => p.panel_code === "NIPT_PLUS") || {};
      const niptFull = panels.find(p => p.panel_code === "NIPT_FULL") || {};
      setStats({
        total: Number(nipt.total || 0) + Number(niptPlus.total || 0) + Number(niptFull.total || 0),
        registered: Number(nipt.registered || 0) + Number(niptPlus.registered || 0) + Number(niptFull.registered || 0),
        receiving: Number(nipt.receiving || 0) + Number(niptPlus.receiving || 0) + Number(niptFull.receiving || 0),
        received: Number(nipt.received || 0) + Number(niptPlus.received || 0) + Number(niptFull.received || 0),
        plasma_separated: Number(nipt.plasma_separated || 0) + Number(niptPlus.plasma_separated || 0) + Number(niptFull.plasma_separated || 0),
        pre_processing: Number(nipt.pre_processing || 0) + Number(niptPlus.pre_processing || 0) + Number(niptFull.pre_processing || 0),
        extraction: Number(nipt.extraction || 0) + Number(niptPlus.extraction || 0) + Number(niptFull.extraction || 0),
        library_prep: Number(nipt.library_prep || 0) + Number(niptPlus.library_prep || 0) + Number(niptFull.library_prep || 0),
        pooling: Number(nipt.pooling || 0) + Number(niptPlus.pooling || 0) + Number(niptFull.pooling || 0),
        sequencing: Number(nipt.sequencing || 0) + Number(niptPlus.sequencing || 0) + Number(niptFull.sequencing || 0),
        bioinformatics: Number(nipt.bioinformatics || 0) + Number(niptPlus.bioinformatics || 0) + Number(niptFull.bioinformatics || 0),
        testing: Number(nipt.testing || 0) + Number(niptPlus.testing || 0) + Number(niptFull.testing || 0),
        analyzing: Number(nipt.analyzing || 0) + Number(niptPlus.analyzing || 0) + Number(niptFull.analyzing || 0),
        completed: Number(nipt.completed || 0) + Number(niptPlus.completed || 0) + Number(niptFull.completed || 0),
        reported: Number(nipt.reported || 0) + Number(niptPlus.reported || 0) + Number(niptFull.reported || 0),
        rejected: Number(nipt.rejected || 0) + Number(niptPlus.rejected || 0) + Number(niptFull.rejected || 0),
      });
    }).catch(() => {});
    runsApi.list({ panel_code: "NIPT,NIPT_PLUS,NIPT_FULL", page_size: 5, ordering: "-created_at" })
      .then(r => setRunStats((r.data as any)?.results || [])).catch(() => {});
  }, []);

  const s = stats as Record<string, number>;

  const statCards = [
    { title: t("nipt.dashboard.total"), value: s.total || 0, icon: <ExperimentOutlined />, color: "#1677ff" },
    { title: t("nipt.dashboard.registered"), value: s.registered || 0, icon: <ExperimentOutlined />, color: "#8c8c8c" },
    { title: t("nipt.dashboard.received"), value: s.received || 0, icon: <InboxOutlined />, color: "#faad14" },
    { title: t("nipt.dashboard.plasmaSeparating"), value: s.pre_processing || 0, icon: <FilterOutlined />, color: "#f5a623" },
    { title: t("nipt.dashboard.plasmaSeparated"), value: s.plasma_separated || 0, icon: <FilterOutlined />, color: "#a0d911" },
    { title: t("nipt.dashboard.extraction"), value: s.extraction || 0, icon: <FilterOutlined />, color: "#13c2c2" },
    { title: t("nipt.dashboard.libraryPrep"), value: s.library_prep || 0, icon: <BuildOutlined />, color: "#1677ff" },
    { title: t("nipt.dashboard.pooling"), value: s.pooling || 0, icon: <MergeCellsOutlined />, color: "#2f54eb" },
    { title: t("nipt.dashboard.sequencing"), value: s.sequencing || 0, icon: <CloudUploadOutlined />, color: "#722ed1" },
    { title: t("nipt.dashboard.bioinformatics"), value: s.bioinformatics || 0, icon: <BarChartOutlined />, color: "#eb2f96" },
    { title: t("nipt.dashboard.completed"), value: s.completed || 0, icon: <CheckCircleOutlined />, color: "#52c41a" },
    { title: t("nipt.dashboard.reported"), value: s.reported || 0, icon: <FileDoneOutlined />, color: "#13c2c2" },
    { title: t("nipt.dashboard.rejected"), value: s.rejected || 0, icon: <CloseCircleOutlined />, color: "#ff4d4f" },
  ];

  const statusColors: Record<string, string> = {
    PLANNED: "default", LIBRARY_PREP: "blue", SEQUENCING: "purple",
    ANALYZING: "orange", COMPLETED: "green", FAILED: "red",
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>{t("nipt.dashboard.title")}</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((c, i) => (
          <Col span={4} key={i} style={{ minWidth: 140 }}>
            <Card size="small" hoverable>
              <Statistic title={c.title} value={c.value} prefix={c.icon} valueStyle={{ color: c.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title={t("nipt.dashboard.recentBatches")} size="small">
            {runStats.length > 0 ? (
              <Table rowKey="id" size="small" dataSource={runStats} pagination={false}
                columns={[
                  { title: t("nipt.workflow.runNumber"), dataIndex: "run_number", width: 150, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
                  { title: t("nipt.workflow.samples"), dataIndex: "sample_count", width: 70, align: "center" as const },
                  { title: t("nipt.workflow.status"), dataIndex: "status", width: 100, render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag> },
                  { title: t("nipt.workflow.created"), dataIndex: "created_at", width: 100, render: (v: string) => new Date(v).toLocaleDateString() },
                ]}
              />
            ) : <Empty description={t("nipt.dashboard.noBatchesYet")} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col span={12}>
          <Card title={t("nipt.dashboard.quickGuide")} size="small">
            <Space direction="vertical" size="small">
              <Typography.Text>{t("nipt.dashboard.guideStep1")}</Typography.Text>
              <Typography.Text>{t("nipt.dashboard.guideStep2")}</Typography.Text>
              <Typography.Text>{t("nipt.dashboard.guideStep3")}</Typography.Text>
              <Typography.Text>{t("nipt.dashboard.guideStep4")}</Typography.Text>
              <Typography.Text style={{ paddingLeft: 16 }}>{t("nipt.dashboard.guideStep5")}</Typography.Text>
              <Typography.Text>{t("nipt.dashboard.guideStep6")}</Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}