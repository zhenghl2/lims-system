import { useEffect, useState, useMemo } from "react";
import { Card, Row, Col, Statistic, Spin, Alert } from "antd";
import {
  InboxOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FileTextOutlined, ExperimentOutlined, LoadingOutlined,
} from "@ant-design/icons";
import { samplesApi } from "../api";
import type { PanelStats } from "../api/types";
import DashboardLayout from "../components/DashboardLayout";

const STATUS_COLORS: Record<string, string> = {
  received: "#1677ff",
  accepted: "#52c41a",
  in_process: "#faad14",
  completed: "#13c2c2",
  reported: "#722ed1",
  rejected: "#ff4d4f",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  received: <InboxOutlined />,
  accepted: <CheckCircleOutlined />,
  in_process: <LoadingOutlined />,
  completed: <ExperimentOutlined />,
  reported: <FileTextOutlined />,
  rejected: <CloseCircleOutlined />,
};

/** Merge NIPT & NIPT_PLUS into one combined card on the Dashboard. */
function mergeNixtPanels(panels: PanelStats[]): PanelStats[] {
  const nipt = panels.find(p => p.panel_code === "NIPT");
  const plus = panels.find(p => p.panel_code === "NIPT_PLUS");
  if (!nipt || !plus) return panels;

  const merged: PanelStats = {
    panel_code: "NIPT",
    panel_name: "NIPT (含 NIPT_PLUS)",
    received: nipt.received + plus.received,
    accepted: nipt.accepted + plus.accepted,
    in_process: nipt.in_process + plus.in_process,
    completed: nipt.completed + plus.completed,
    reported: nipt.reported + plus.reported,
    rejected: nipt.rejected + plus.rejected,
    total: nipt.total + plus.total,
  };

  return panels
    .filter(p => p.panel_code !== "NIPT" && p.panel_code !== "NIPT_PLUS")
    .concat(merged);
}

export default function Dashboard() {
  const [panels, setPanels] = useState<PanelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    samplesApi.statsByPanel()
      .then((r: any) => { setPanels(r.data); setLoading(false); })
      .catch((err: any) => { setError(err.message); setLoading(false); });
  }, []);

  const displayPanels = useMemo(() => mergeNixtPanels(panels), [panels]);

  if (loading) {
    return (
      <DashboardLayout header="Dashboard">
        <div style={{ textAlign: "center", padding: 80 }}>
          <Spin size="large" tip="Loading dashboard..." />
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout header="Dashboard">
        <Alert type="error" message={error} showIcon closable />
      </DashboardLayout>
    );
  }

  if (displayPanels.length === 0) {
    return (
      <DashboardLayout header="Dashboard">
        <Alert type="info" message="No panels configured" description="Add test panels to see dashboard statistics." />
      </DashboardLayout>
    );
  }

  const STAT_KEYS = ["received", "in_process", "completed", "reported"] as const;

  return (
    <DashboardLayout header="Dashboard">
      <Row gutter={[16, 16]}>
        {displayPanels.map(p => (
          <Col key={p.panel_code} xs={24} sm={12} lg={8}>
            <Card
              title={
                <span style={{ fontWeight: 600 }}>
                  {p.panel_name}
                </span>
              }
              size="small"
            >
              <Row gutter={[8, 12]}>
                {STAT_KEYS.map(key => (
                  <Col key={key} span={12}>
                    <Statistic
                      title={key.replace("_", " ")}
                      value={p[key]}
                      prefix={STATUS_ICONS[key]}
                      valueStyle={{ color: STATUS_COLORS[key], fontSize: 22 }}
                    />
                  </Col>
                ))}
              </Row>
              {p.rejected > 0 && (
                <Alert
                  type="warning"
                  message={`${p.rejected} rejected`}
                  style={{ marginTop: 12 }}
                  showIcon
                />
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </DashboardLayout>
  );
}
