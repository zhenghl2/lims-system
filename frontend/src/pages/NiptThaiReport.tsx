// NiptThaiReport.tsx — 泰国数据生成报告（NIPT 拓展功能）
// 上传结果表 + 样本信息表 → 服务器生成 docx 报告 → 批次历史/预览/批量下载
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, Typography, Input, Button, Table, Tag, Space, message, Modal,
  Upload, Popconfirm, Spin, Empty,
} from "antd";
import {
  UploadOutlined, FileTextOutlined, DownloadOutlined, DeleteOutlined,
  EyeOutlined, ArrowLeftOutlined, PlusOutlined, FileDoneOutlined,
} from "@ant-design/icons";
import { extensionsApi } from "../api";
import { renderAsync } from "docx-preview";

const { Title, Text } = Typography;

interface ParsedTable {
  cols: string[];
  rows: Record<string, string>[];
  sep: string;
}

interface BatchItem {
  id: number;
  name: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  message: string;
  created_by_name: string;
  created_at: string;
}

// ── 文件解析（UTF-8 文本；自动识别 tab/逗号；支持引号内分隔符）──
const splitLine = (line: string, sep: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === sep) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
};

const parseTextTable = (text: string): ParsedTable => {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { cols: [], rows: [], sep: "," };
  const sep = lines[0].split("\t").length > lines[0].split(",").length ? "\t" : ",";
  const cols = splitLine(lines[0], sep);
  const rows = lines.slice(1).map(line => {
    const vals = splitLine(line, sep);
    const obj: Record<string, string> = {};
    cols.forEach((c, i) => { obj[c] = vals[i] ?? ""; });
    return obj;
  });
  return { cols, rows, sep };
};

// 草稿缓存：SPA 内切换页面后返回时保留已填内容（刷新丢失）
let draftCache: {
  name: string;
  patientFile: File | null;
  resultFile: File | null;
  patientTable: ParsedTable | null;
  resultTable: ParsedTable | null;
} | null = null;

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file, "utf-8");
  });

// ── 标色规则（用户确认的三条）──
const isNotProcessable = (rf: string) => {
  const u = (rf || "").toUpperCase();
  return !u.includes("PASS") && !u.includes("NOCALL");
};
const zAbnormal = (v: string) => {
  const n = parseFloat(v);
  return !isNaN(n) && (n > 3 || n < -3);
};

export default function NiptThaiReport() {
  const navigate = useNavigate();

  // ── 新建区 ──
  const [name, setName] = useState<string>(() => draftCache?.name || "");
  const [patientFile, setPatientFile] = useState<File | null>(() => draftCache?.patientFile || null);
  const [resultFile, setResultFile] = useState<File | null>(() => draftCache?.resultFile || null);
  const [patientTable, setPatientTable] = useState<ParsedTable | null>(() => draftCache?.patientTable || null);
  const [resultTable, setResultTable] = useState<ParsedTable | null>(() => draftCache?.resultTable || null);
  const [hoverKey, setHoverKey] = useState<string>("");
  const lastAutoName = useRef<string>("");
  const [generating, setGenerating] = useState(false);

  // ── 预览 ──
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSide, setPreviewSide] = useState<"result" | "patient">("result");

  // ── 历史 ──
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailBatch, setDetailBatch] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 服务器源文件预览（详情内复核）
  const [sourcePreview, setSourcePreview] = useState<{ title: string; table: ParsedTable; side: "patient" | "result" } | null>(null);

  // 报告预览（docx 渲染）
  const [reportPreview, setReportPreview] = useState<{ title: string; loading: boolean } | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);

  const previewSourceFile = async (batchId: number, which: "patient" | "result", filename: string) => {
    try {
      const resp: any = await extensionsApi.thaiReport.sourceFile(String(batchId), which);
      const text = await (resp.data as Blob).text();
      const parsed = parseTextTable(text);
      setSourcePreview({ title: filename, table: parsed, side: which });
    } catch (e: any) {
      message.error("预览失败: " + (e.message || e));
    }
  };

  const downloadSourceFile = async (batchId: number, which: "patient" | "result", filename: string) => {
    try {
      const resp: any = await extensionsApi.thaiReport.sourceFile(String(batchId), which);
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error("下载失败: " + (e.message || e));
    }
  };

  const openReportPreview = async (batchId: number, item: any) => {
    setReportPreview({ title: item.report_file || "报告预览", loading: true });
    try {
      const resp: any = await extensionsApi.thaiReport.reportFile(String(batchId), item.id);
      const blob = new Blob([resp.data]);
      setReportPreview({ title: item.report_file || "报告预览", loading: false });
      setTimeout(async () => {
        if (reportRef.current) {
          reportRef.current.innerHTML = "";
          await renderAsync(blob, reportRef.current, undefined, { inWrapper: true, ignoreWidth: false });
        }
      }, 50);
    } catch (e: any) {
      setReportPreview(null);
      message.error("预览失败: " + (e.message || e));
    }
  };

  const sampleIdOf = (t: ParsedTable) => {
    const col = t.cols.find(c => ["sampleid", "sample"].includes(c.toLowerCase().replace(/[ _]/g, "")));
    return col || "SampleID";
  };

  const fetchBatches = async () => {
    setListLoading(true);
    try {
      const r: any = await extensionsApi.thaiReport.list();
      setBatches(r.data?.results || r.data || []);
    } catch (e: any) {
      message.error("加载历史批次失败: " + (e.message || e));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => { fetchBatches(); }, []);

  // 变更即写草稿缓存（切页保留）
  useEffect(() => {
    draftCache = { name, patientFile, resultFile, patientTable, resultTable };
  }, [name, patientFile, resultFile, patientTable, resultTable]);

  // ── 上传处理（前端解析预览，不自动上传）──
  const handlePick = async (side: "patient" | "result", file: File) => {
    const isTxt = /\.(txt|csv|tsv)$/i.test(file.name);
    if (!isTxt) {
      message.warning("仅支持 .txt / .csv 文本文件（与脚本一致）");
      return false;
    }
    try {
      const text = await readFileText(file);
      const parsed = parseTextTable(text);
      if (!parsed.cols.length) {
        message.error("文件为空或无法解析: " + file.name);
        return false;
      }
      // 格式校验（防传混）
      const colSet = new Set(parsed.cols.map(c => c.toLowerCase().replace(/[ _]/g, "")));
      if (side === "result") {
        const looksResult = colSet.has("resultfilter") || colSet.has("zscore21") || colSet.has("t21");
        const looksPatient = colSet.has("patientname") || colSet.has("accessionid");
        if (!looksResult || looksPatient) {
          message.error(`「${file.name}」看起来不是结果表${looksPatient ? "（它更像样本信息表，是不是传混了？）" : "（缺少 ResultFilter 列）"}`);
          return false;
        }
      } else {
        const looksPatient = colSet.has("patientname") || colSet.has("accessionid") || colSet.has("twin type") || colSet.has("twintype");
        const looksResult = colSet.has("resultfilter") || colSet.has("zscore21");
        if (!looksPatient || looksResult) {
          message.error(`「${file.name}」看起来不是样本信息表${looksResult ? "（它更像结果表，是不是传混了？）" : "（缺少 PatientName/AccessionID 列）"}`);
          return false;
        }
      }
      // 从文件名自动提取批次名（如 260904 / 20260904）；未手动改过时自动填
      const m = file.name.match(/(20\d{6}|\d{6})/);
      if (m) {
        const extracted = m[1];
        setName(prev => (!prev.trim() || prev === lastAutoName.current) ? extracted : prev);
        lastAutoName.current = extracted;
      }
      if (side === "patient") { setPatientFile(file); setPatientTable(parsed); }
      else { setResultFile(file); setResultTable(parsed); }
      return true;
    } catch (e: any) {
      message.error("解析失败: " + (e.message || e));
      return false;
    }
  };

  // ── 生成 ──
  const handleGenerate = async () => {
    if (!name.trim()) { message.warning("请填写批次名"); return; }
    if (!patientFile || !resultFile) { message.warning("请上传结果表和样本信息表两个文件"); return; }
    setGenerating(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("patient_file", patientFile);
      fd.append("result_file", resultFile);
      const r: any = await extensionsApi.thaiReport.create(fd);
      const b = r.data;
      if (b.status === "FAILED") {
        message.error("生成失败: " + (b.message || "未知错误"));
      } else {
        message.success(`生成完成：成功 ${b.success} / 失败 ${b.failed} / 跳过 ${b.skipped}`);
        setName(""); setPatientFile(null); setResultFile(null);
        setPatientTable(null); setResultTable(null);
        setDetailBatch(b);
        setPreviewOpen(false);
      }
      fetchBatches();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e.message || e;
      message.error("生成失败: " + detail);
    } finally {
      setGenerating(false);
    }
  };

  // ── 历史操作 ──
  const handleDelete = async (id: number) => {
    try {
      await extensionsApi.thaiReport.remove(String(id));
      message.success("已删除");
      fetchBatches();
    } catch (e: any) {
      message.error("删除失败: " + (e.message || e));
    }
  };

  const handleDownload = async (b: BatchItem) => {
    try {
      const resp: any = await extensionsApi.thaiReport.download(String(b.id));
      const blob = new Blob([resp.data], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${b.name}-reports.zip`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("报告包已开始下载");
    } catch (e: any) {
      message.error("下载失败: " + (e.message || e));
    }
  };

  const handleDetail = async (b: BatchItem) => {
    setDetailLoading(true);
    setDetailBatch({ ...b, items: [] });
    try {
      const r: any = await extensionsApi.thaiReport.get(String(b.id));
      setDetailBatch(r.data);
    } catch (e: any) {
      message.error("加载详情失败: " + (e.message || e));
    } finally {
      setDetailLoading(false);
    }
  };

  // ── 预览表格（含标色）──
  const sampleIds = useMemo(() => {
    const m = { result: new Set<string>(), patient: new Set<string>() };
    if (resultTable) {
      const c = sampleIdOf(resultTable);
      resultTable.rows.forEach(r => { const v = (r[c] || "").trim(); if (v) m.result.add(v); });
    }
    if (patientTable) {
      const c = sampleIdOf(patientTable);
      patientTable.rows.forEach(r => { const v = (r[c] || "").trim(); if (v) m.patient.add(v); });
    }
    return m;
  }, [resultTable, patientTable]);

  const previewColumns = (t: ParsedTable, side: "result" | "patient") =>
    t.cols.map(c => ({
      title: c,
      dataIndex: c,
      key: c,
      width: 110,
      ellipsis: true,
      render: (v: string) => {
        const val = v ?? "";
        if (side !== "result") return val; // 显著标记仅针对结果表
        // 标红：Z 值超 ±3
        if (["Zscore21", "Zscore18", "Zscore13"].includes(c) && zAbnormal(val)) {
          return <span style={{ color: "#cf1322", fontWeight: 700 }}>{val}</span>;
        }
        // 标红：SampleID 两表对不上
        if (["sampleid", "sample"].includes(c.toLowerCase().replace(/[ _]/g, ""))) {
          if (val && sampleIds.patient.size > 0 && !sampleIds.patient.has(val.trim())) {
            return <span style={{ background: "#ffccc7", padding: "0 2px" }}>{val}</span>;
          }
        }
        return val;
      },
    }));

  const previewRowClass = (side: "result" | "patient", row: Record<string, string>) => {
    if (side !== "result") return {};
    const rf = (row["ResultFilter"] || "").toUpperCase();
    // 优先级：绿(FF<4%) > 黄(非PASS/NOCALL) > 灰(NOCALL)
    const ff = parseFloat(String(row["FetalFraction"] || "").replace("%", ""));
    if (!isNaN(ff) && ff < 4) return { background: "#f6ffed" };
    if (isNotProcessable(rf)) return { background: "#fffbe6" };
    if (rf.includes("NOCALL")) return { background: "#f5f5f5" };
    return {};
  };

  const effectiveSide = sourcePreview ? sourcePreview.side : previewSide;
  const previewData = sourcePreview ? sourcePreview.table : (previewSide === "result" ? resultTable : patientTable);

  const hoverStyle = (
    <style>{`.thai-row-hover > td { background: #e6f4ff !important; }`}</style>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} size="small" onClick={() => navigate("/extensions")}>返回</Button>
        <Title level={4} style={{ margin: 0 }}><FileDoneOutlined style={{ color: "#1677ff", marginRight: 8 }} />泰国数据生成报告</Title>
      </div>

      {/* ① 新建生成 */}
      <Card size="small" title="① 新建生成" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Space wrap size={16}>
            <Space size={8}>
              <Text strong>批次名：</Text>
              <Input placeholder="例如 260904" style={{ width: 180 }} value={name}
                onChange={e => setName(e.target.value)} />
            </Space>
            <Upload showUploadList={false} accept=".txt,.csv,.tsv" beforeUpload={(f) => { handlePick("result", f as File); return false; }}>
              <Button icon={<UploadOutlined />}>上传结果表{resultFile ? `（${resultFile.name}）` : ""}</Button>
            </Upload>
            <Upload showUploadList={false} accept=".txt,.csv,.tsv" beforeUpload={(f) => { handlePick("patient", f as File); return false; }}>
              <Button icon={<UploadOutlined />}>上传样本信息表{patientFile ? `（${patientFile.name}）` : ""}</Button>
            </Upload>
          </Space>

          <Space wrap size={12}>
            <Button size="small" icon={<EyeOutlined />} disabled={!resultTable}
              onClick={() => { setPreviewSide("result"); setPreviewOpen(true); }}>预览结果表</Button>
            <Button size="small" icon={<EyeOutlined />} disabled={!patientTable}
              onClick={() => { setPreviewSide("patient"); setPreviewOpen(true); }}>预览样本信息表</Button>
            {resultTable && patientTable && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                结果 {resultTable.rows.length} 行 / 信息 {patientTable.rows.length} 行
              </Text>
            )}
          </Space>

          <div>
            <Button type="primary" icon={<FileDoneOutlined />} loading={generating}
              disabled={!name.trim() || !patientFile || !resultFile}
              onClick={handleGenerate}>生成报告</Button>
            {generating && <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>正在生成，请稍候（几十秒内）…</Text>}
          </div>
        </Space>
      </Card>

      {/* ② 历史批次 */}
      <Card size="small" title="② 历史批次（保留生成记录，可删除）" extra={<Button size="small" icon={<PlusOutlined />} onClick={fetchBatches}>刷新</Button>}>
        <Table
          dataSource={batches}
          rowKey="id"
          size="small"
          loading={listLoading}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无生成记录" /> }}
          columns={[
            { title: "批次名", dataIndex: "name", width: 140, render: (v: string) => <Text strong>{v}</Text> },
            {
              title: "状态", dataIndex: "status", width: 90,
              render: (v: string) => v === "DONE"
                ? <Tag color="green">已完成</Tag>
                : v === "FAILED" ? <Tag color="red">失败</Tag> : <Tag color="blue">处理中</Tag>,
            },
            { title: "总数", dataIndex: "total", width: 70 },
            { title: "成功", dataIndex: "success", width: 70, render: (v: number) => <Text style={{ color: "#389e0d" }}>{v}</Text> },
            { title: "失败", dataIndex: "failed", width: 70, render: (v: number) => v > 0 ? <Text style={{ color: "#cf1322" }}>{v}</Text> : v },
            { title: "跳过", dataIndex: "skipped", width: 70 },
            { title: "操作人", dataIndex: "created_by_name", width: 100, ellipsis: true },
            { title: "时间", dataIndex: "created_at", width: 150, render: (v: string) => v ? new Date(v).toLocaleString() : "-" },
            {
              title: "操作", key: "op", width: 240,
              render: (_: any, b: BatchItem) => (
                <Space size={4}>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => handleDetail(b)}>详情</Button>
                  <Button size="small" type="primary" ghost icon={<DownloadOutlined />}
                    disabled={b.status !== "DONE" || b.success === 0} onClick={() => handleDownload(b)}>下载报告包</Button>
                  <Popconfirm title={`确定删除批次 ${b.name}？报告文件将一并删除`} onConfirm={() => handleDelete(b.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 预览 Modal（含标色） */}
      <Modal
        open={previewOpen || !!sourcePreview}
        onCancel={() => { setPreviewOpen(false); setSourcePreview(null); }}
        footer={null}
        width="92%"
        title={
          <Space>
            <FileTextOutlined /> {sourcePreview ? sourcePreview.title : (previewSide === "result" ? "结果表预览" : "样本信息表预览")}
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              绿底=FetalFraction&lt;4%；黄底=不可出报告；灰底=NOCALL；红字=Z值超±3；红底=SampleID不匹配
            </Text>
          </Space>
        }
      >
        {hoverStyle}
        {previewData ? (
          <Table
            dataSource={previewData.rows.map((r, i) => ({ ...r, __k: String(i) }))}
            rowKey="__k"
            size="small"
            pagination={{ pageSize: 100, showSizeChanger: false }}
            scroll={{ x: "max-content", y: 480 }}
            columns={previewColumns(previewData, effectiveSide)}
            rowClassName={(row) => hoverKey === String((row as any).__k) ? "thai-row-hover" : ""}
            onRow={(row) => ({
              style: previewRowClass(effectiveSide, row as Record<string, string>),
              onMouseEnter: () => setHoverKey(String((row as any).__k)),
              onMouseLeave: () => setHoverKey(""),
            })}
          />
        ) : <Empty />}
      </Modal>

      {/* 报告预览 Modal */}
      <Modal
        open={!!reportPreview}
        onCancel={() => setReportPreview(null)}
        footer={null}
        width="90%"
        title={<Space><FileTextOutlined />{reportPreview?.title}</Space>}
        styles={{ body: { maxHeight: "75vh", overflow: "auto", background: "#f0f2f5", padding: 12 } }}
      >
        {reportPreview?.loading ? (
          <div style={{ textAlign: "center", padding: 60 }}><Spin tip="加载报告…" /></div>
        ) : (
          <div ref={reportRef} style={{ background: "#fff", padding: "12px 8px" }} />
        )}
      </Modal>

      {/* 批次详情 Modal */}
      <Modal
        open={!!detailBatch}
        onCancel={() => setDetailBatch(null)}
        footer={null}
        width="90%"
        title={detailBatch ? `批次 ${detailBatch.name} — 生成明细` : ""}
      >
        {detailLoading ? <div style={{ textAlign: "center", padding: 40 }}><Spin /></div> : detailBatch && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color="green">成功 {detailBatch.success}</Tag>
              <Tag color="red">失败 {detailBatch.failed}</Tag>
              <Tag>跳过 {detailBatch.skipped}</Tag>
              <Button size="small" type="primary" ghost icon={<DownloadOutlined />}
                disabled={detailBatch.status !== "DONE" || !detailBatch.success}
                onClick={() => handleDownload(detailBatch)}>下载报告包（zip）</Button>
            </Space>
            <div style={{ marginBottom: 12, padding: "6px 10px", background: "#fafafa", borderRadius: 4, fontSize: 12 }}>
              <Space wrap size={16}>
                <Text type="secondary">上传文件（存档）：</Text>
                {detailBatch.patient_filename ? (
                  <Space size={6}>
                    <FileTextOutlined />
                    <Text>{detailBatch.patient_filename}</Text>
                    <a onClick={() => previewSourceFile(detailBatch.id, "patient", detailBatch.patient_filename)}>预览</a>
                    <a onClick={() => downloadSourceFile(detailBatch.id, "patient", detailBatch.patient_filename)}>下载</a>
                  </Space>
                ) : <Text type="secondary">样本信息表缺失</Text>}
                {detailBatch.result_filename ? (
                  <Space size={6}>
                    <FileTextOutlined />
                    <Text>{detailBatch.result_filename}</Text>
                    <a onClick={() => previewSourceFile(detailBatch.id, "result", detailBatch.result_filename)}>预览</a>
                    <a onClick={() => downloadSourceFile(detailBatch.id, "result", detailBatch.result_filename)}>下载</a>
                  </Space>
                ) : <Text type="secondary">结果表缺失</Text>}
              </Space>
            </div>
            <Table
              dataSource={detailBatch.items || []}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 50 }}
              scroll={{ y: 420 }}
              columns={[
                { title: "SampleID", dataIndex: "sample_id", width: 130 },
                { title: "AccessionID", dataIndex: "accession_id", width: 160 },
                { title: "Option", dataIndex: "option", width: 90 },
                { title: "ResultFilter", dataIndex: "result_filter", width: 110 },
                { title: "模板", dataIndex: "template", width: 100 },
                {
                  title: "报告文件", dataIndex: "report_file", width: 260, ellipsis: true,
                  render: (v: string, it: any) => v ? (
                    <Space size={4}>
                      <a onClick={() => detailBatch && openReportPreview(detailBatch.id, it)}>
                        <EyeOutlined style={{ marginRight: 2 }} />{v}
                      </a>
                    </Space>
                  ) : "-",
                },
                {
                  title: "状态", dataIndex: "status", width: 90,
                  render: (v: string) => v === "OK" ? <Tag color="green">OK</Tag>
                    : v === "SKIPPED" ? <Tag color="orange">跳过</Tag> : <Tag color="red">失败</Tag>,
                },
                { title: "消息", dataIndex: "message", ellipsis: true },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
