import { useEffect, useState, useMemo, useRef } from "react";
import { Button, Card, InputNumber, message, Space, Typography, Tag } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";

const { Text } = Typography;

const DEFAULT_ELUTION_VOL = 30;
const DEFAULT_POOLING_AMOUNT = 143;
const YIELD_THRESHOLD = 60;

interface Props {
  batch: any;
  onRefresh: () => void;
}

interface SampleRow {
  idx: number;
  vgId: string;
  index: string;
  concentration: number | null;
  elutionVolume: number;
  yield: number;
  poolingAmount: number;
  poolingVolume: number;
  eliminated: boolean;
}

function getSignStatus(edata: any, role: "operator" | "reviewer") {
  const key = role === "operator" ? "operator_signature" : "reviewer_signature";
  const sig = edata?.[key];
  if (!sig || typeof sig !== "object" || !sig.username) return { signed: false, name: "", time: "" };
  return { signed: true, name: sig.username, time: sig.signed_at || "" };
}

export default function NiptPoolingTab({ batch, onRefresh }: Props) {
  const pdata = useMemo(() => batch.pooling_data || {}, [batch.pooling_data]);
  const libraryPlate = useMemo(() => batch.library_data?.library_plate || [], [batch.library_data]);

  // Extract samples from library plate in column-major order (matching library tab fill order)
  const plateSamples = useMemo(() => {
    const list: { vgId: string; index: string }[] = [];
    if (Array.isArray(libraryPlate) && libraryPlate.length > 0) {
      const rows = libraryPlate.length;
      const cols = Array.isArray(libraryPlate[0]) ? libraryPlate[0].length : 12;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cell = libraryPlate[r]?.[c];
          if (cell && cell.vgId && cell.vgId !== "-") {
            list.push({ vgId: cell.vgId, index: cell.index || "" });
          }
        }
      }
    }
    return list;
  }, [libraryPlate]);

  // Build sample rows with saved data or defaults (matched by vgId, not position)
  const buildRows = (): SampleRow[] => {
    const savedSamples = pdata.samples || [];
    const savedByVgId: Record<string, any> = {};
    for (const s of savedSamples) { savedByVgId[s.vgId] = s; }
    return plateSamples.map((ps, i) => {
      const saved = savedByVgId[ps.vgId] || {};
      const conc = saved.concentration ?? null;
      const ev = saved.elutionVolume ?? DEFAULT_ELUTION_VOL;
      const y = conc ? conc * ev : 0;
      const pa = saved.poolingAmount ?? DEFAULT_POOLING_AMOUNT;
      const pv = conc && conc > 0 ? pa / conc : 0;
      return {
        idx: i + 1,
        vgId: ps.vgId,
        index: ps.index,
        concentration: conc,
        elutionVolume: ev,
        yield: y,
        poolingAmount: pa,
        poolingVolume: pv,
        eliminated: y > 0 && y < YIELD_THRESHOLD,
      };
    });
  };

  const [rows, setRows] = useState<SampleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Load/sync rows
  useEffect(() => {
    setRows(buildRows());
  }, [batch.id, plateSamples.length]);

  const updateCell = (rowIdx: number, field: string, value: number | null) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      const row = { ...next[rowIdx] };
      (row as any)[field] = value ?? 0;

      // Recalculate yield
      row.yield = (row.concentration || 0) * row.elutionVolume;
      row.eliminated = row.yield > 0 && row.yield < YIELD_THRESHOLD;

      // Recalculate pooling volume
      if (field === "concentration" || field === "poolingAmount") {
        row.poolingVolume = row.concentration && row.concentration > 0
          ? row.poolingAmount / row.concentration : 0;
      }
      next[rowIdx] = row;
      return next;
    });
  };

  // Pooling totals
  const totals = useMemo(() => {
    let totalMass = 0;
    let totalVol = 0;
    const activeRows = rows.filter(r => !r.eliminated);
    for (const r of activeRows) {
      totalMass += r.poolingAmount;
      totalVol += r.poolingVolume;
    }
    return {
      totalMass: Math.round(totalMass * 100) / 100,
      totalVol: Math.round(totalVol * 100) / 100,
      theoryConc: totalVol > 0 ? Math.round((totalMass / totalVol) * 100) / 100 : 0,
    };
  }, [rows]);

  const save = async () => {
    try {
      setSaving(true);
      const samples = rows.map(r => ({
        vgId: r.vgId,
        index: r.index,
        concentration: r.concentration,
        elutionVolume: r.elutionVolume,
        yield: r.yield,
        poolingAmount: r.poolingAmount,
        poolingVolume: r.poolingVolume,
        eliminated: r.eliminated,
      }));
      await api.post(`/runs/${batch.id}/save_pooling/`, {
        pooling_data: {
          samples,
          totals: {
            totalMass: totals.totalMass,
            totalVol: totals.totalVol,
            theoryConc: totals.theoryConc,
          },
        },
      });
      message.success("Pooling 数据已保存");
      onRefresh();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const print = () => {
    const w = window.open("", "_blank", "width=1200,height=800");
    if (!w || !printRef.current) return;
    w.document.write(`
      <html><head><title>文库定量及Pooling</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; font-size: 12px; }
        th, td { border: 1px solid #999; padding: 4px 8px; text-align: center; }
        th { background: #d5e8d4; font-weight: 700; }
        .eliminated td { background: #fffbe6; }
        .totals td { background: #e6f7ff; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>
      ${printRef.current.innerHTML}
      </body></html>
    `);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const { signed: opSigned, name: opSigner } = getSignStatus(pdata, "operator");
  const { signed: rvSigned, name: rvSigner } = getSignStatus(pdata, "reviewer");
  const [opModal, setOpModal] = useState(false);
  const [rvModal, setRvModal] = useState(false);

  const th = { border: "1px solid #bbb", padding: "6px 8px", textAlign: "center" as const, fontWeight: 700, background: "#d5e8d4", fontSize: 12 };
  const td = { border: "1px solid #d9d9d9", padding: "4px 6px", textAlign: "center" as const, fontSize: 12 };

  if (plateSamples.length === 0) {
    return (
      <Card size="small">
        <Text type="secondary">请先在文库构建步骤中填写建库样本排布表格。</Text>
      </Card>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <Space>
            <span style={{ fontSize: 12, color: "#666" }}>
              样本数: {plateSamples.length} | 投入量/样本: {DEFAULT_POOLING_AMOUNT} ng | 淘汰阈值: &lt;{YIELD_THRESHOLD} ng
            </span>
          </Space>
        </div>
        <Space>
          <Button icon={<PrinterOutlined />} onClick={print}>打印</Button>
          <Button type="primary" onClick={save} loading={saving}>保存</Button>
        </Space>
      </div>

      {/* Signatures */}
      <div style={{ marginBottom: 12, display: "flex", gap: 16 }}>
        <Button size="small" type={opSigned ? "default" : "primary"} onClick={() => setOpModal(true)}
          style={opSigned ? { background: "#f6ffed", borderColor: "#b7eb8f", color: "#52c41a" } : {}}>
          {opSigned ? `✓ 操作人: ${opSigner}` : "操作人签名"}
        </Button>
        <Button size="small" type={rvSigned ? "default" : "primary"} onClick={() => setRvModal(true)}
          style={rvSigned ? { background: "#f6ffed", borderColor: "#b7eb8f", color: "#52c41a" } : {}}>
          {rvSigned ? `✓ 复核人: ${rvSigner}` : "复核人签名"}
        </Button>
      </div>

      {/* Printable table */}
      <div ref={printRef} style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th} rowSpan={2}>编号</th>
              <th style={th} rowSpan={2}>样本名称</th>
              <th style={th} rowSpan={2}>index</th>
              <th style={th} rowSpan={2}>浓度<br/>ng/μL</th>
              <th style={th} rowSpan={2}>洗脱体积<br/>μL</th>
              <th style={th} rowSpan={2}>产量<br/>ng</th>
              <th style={th} rowSpan={2}>pooling<br/>投入量 ng</th>
              <th style={th} rowSpan={2}>pooling<br/>投入体积 μL</th>
              <th style={th} colSpan={2}>pooling 汇总</th>
            </tr>
            <tr>
              <th style={th}>总体积 μL</th>
              <th style={th}>理论浓度 ng/μL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.eliminated ? "eliminated" : ""}
                style={{ background: r.eliminated ? "#fffbe6" : i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={td}>{r.idx}</td>
                <td style={td}>{r.vgId}</td>
                <td style={td}>{r.index}</td>
                <td style={td}>
                  <InputNumber size="small" min={0} step={0.01} value={r.concentration}
                    onChange={v => updateCell(i, "concentration", v)}
                    style={{ width: 80 }} placeholder="0" />
                </td>
                <td style={td}>
                  <InputNumber size="small" min={0} step={1} value={r.elutionVolume}
                    onChange={v => updateCell(i, "elutionVolume", v)}
                    style={{ width: 60 }} />
                </td>
                <td style={{ ...td, fontWeight: r.yield > 0 ? 600 : 400, color: r.eliminated ? "#faad14" : "#333" }}>
                  {r.yield > 0 ? r.yield.toFixed(1) : "-"}
                  {r.eliminated && <Tag color="gold" style={{ marginLeft: 4, fontSize: 10 }}>淘汰重做</Tag>}
                </td>
                <td style={td}>
                  <InputNumber size="small" min={0} step={1} value={r.poolingAmount}
                    onChange={v => updateCell(i, "poolingAmount", v)}
                    style={{ width: 70 }} />
                </td>
                <td style={{ ...td, fontFamily: "monospace" }}>{r.poolingVolume > 0 ? r.poolingVolume.toFixed(2) : "-"}</td>
                {/* Summary cells — merged for first row only */}
                {i === 0 ? (
                  <>
                    <td style={{ ...td, background: "#e6f7ff", fontWeight: 700 }} rowSpan={rows.length}>
                      {totals.totalVol.toFixed(2)}
                    </td>
                    <td style={{ ...td, background: "#e6f7ff", fontWeight: 700 }} rowSpan={rows.length}>
                      {totals.theoryConc.toFixed(2)}
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Signer modals */}
      <NiptSignerModal open={opModal} role="operator" roleLabel="操作人" batchId={batch.id}
        currentSigner={opSigner || null}
        signUrl={`/runs/${batch.id}/pooling/sign/`}
        onDone={() => { setOpModal(false); onRefresh(); }} onCancel={() => setOpModal(false)} />
      <NiptSignerModal open={rvModal} role="reviewer" roleLabel="复核人" batchId={batch.id}
        currentSigner={rvSigner || null}
        signUrl={`/runs/${batch.id}/pooling/sign/`}
        onDone={() => { setRvModal(false); onRefresh(); }} onCancel={() => setRvModal(false)} />
    </div>
  );
}
