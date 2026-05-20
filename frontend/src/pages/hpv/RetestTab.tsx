import { useEffect, useState } from "react";
import { Table, Tag, Typography, Empty, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import api from "../../api/client";

const { Text } = Typography;

export default function RetestTab({ batch }: { batch: any }) {
  const [retests, setRetests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchRetests(); }, [batch.id]);

  const fetchRetests = async () => {
    setLoading(true);
    try {
      const r = await api.get("/hpv/retests/", { params: { batch: batch.id } });
      setRetests(r.data.results || r.data || []);
    } catch (e: any) { message.error(e?.response?.data?.error || "加载复查记录失败"); }
    finally { setLoading(false); }
  };

  const reasonLabels: Record<string, string> = {
    POSITIVE: "阳性结果复查", IC_NO_SIGNAL: "IC 无信号",
    QC_FAILURE: "质控失控", OTHER: "其他原因",
  };

  const columns: ColumnsType<any> = [
    { title: "原样本", dataIndex: "original_sample_display", key: "sample", width: 130 },
    { title: "原批次", dataIndex: "original_batch_number", key: "batch", width: 130 },
    { title: "复查日期", dataIndex: "retest_date", key: "date", width: 110 },
    { title: "原因", dataIndex: "retest_reason", key: "reason", width: 120,
      render: (v: string) => <Tag>{reasonLabels[v] || v}</Tag>,
    },
    { title: "原结果", dataIndex: "original_interpretation", key: "orig", width: 100 },
    { title: "复查结果", dataIndex: "retest_interpretation", key: "retest", width: 100,
      render: (v: string) => v || <Text type="secondary">待录入</Text>,
    },
    { title: "报告意见", dataIndex: "report_opinion", key: "opinion", width: 100,
      render: (v: string) => {
        const color = v === "REPORTABLE" ? "green" : v === "RESAMPLE" ? "red" : "default";
        return <Tag color={color}>{v === "REPORTABLE" ? "可出报告" : v === "RESAMPLE" ? "需重采样" : v || "待定"}</Tag>;
      },
    },
  ];

  return (
    <Table rowKey="id" columns={columns} dataSource={retests} loading={loading}
      size="small" pagination={{ pageSize: 10 }}
      locale={{ emptyText: <Empty description="暂无复查记录" /> }}
    />
  );
}
