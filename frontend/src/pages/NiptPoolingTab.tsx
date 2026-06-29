import { useEffect, useState, useMemo, useRef } from "react";
import { Button, Card, InputNumber, message, Space, Typography, Tag } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import api from "../api/client";
import NiptSignerModal from "./NiptSignerModal";
import { getSampleBadge, calcPoolingAmount } from "../utils/badge";
import { getSignStatus } from "../utils/sign";
import { useTranslation } from "../i18n/useTranslation";

const { Text } = Typography;

// getSampleBadge imported from ../utils/badge

const DEFAULT_ELUTION_VOL = 30;
const DEFAULT_POOLING_AMOUNT = 143;
const YIELD_THRESHOLD = 60;

// calcPoolingAmount imported from ../utils/badge

interface Props {
  batch: any;
  onRefresh: () => void;
}

interface SampleRow {
  idx: number;
  vgId: string;
  index: string;
  badge: { text: string; bg?: string };
  testOpt: string;
  isTwin: boolean;
  concentration: number | null;
  elutionVolume: number;
  yield: number;
  poolingAmount: number;
  poolingVolume: number;
  eliminated: boolean;
}

// getSignStatus imported from ../utils/sign

export default function NiptPoolingTab({ batch, onRefresh }: Props) {
  const { t } = useTranslation();
  const pdata = useMemo(() => batch.pooling_data || {}, [batch.pooling_data]);
  const libraryPlate = useMemo(() => batch.library_data?.library_plate || [], [batch.library_data]);

  // Extract samples from library plate in column-major order, with metadata from run_samples
  const plateSamples = useMemo(() => {
    const list: { vgId: string; index: string; badge: { text: string; bg?: string }; testOpt: string; isTwin: boolean }[] = [];
    // Build lookup map from run_samples by vgId for badge info
    const runSamples = batch.run_samples || [];
    const sampleByVgId: Record<string, any> = {};
    for (const rs of runSamples) {
      const id = rs.sample_vg_id || rs.sample_barcode || rs.vg_id || rs.sample_id || "";
      if (id) sampleByVgId[id] = rs;
    }
    if (Array.isArray(libraryPlate) && libraryPlate.length > 0) {
      const rows = libraryPlate.length;
      const cols = Array.isArray(libraryPlate[0]) ? libraryPlate[0].length : 12;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cell = libraryPlate[r]?.[c];
          if (cell && cell.vgId && cell.vgId !== "-") {
            const sampleMeta = sampleByVgId[cell.vgId];
            const isTwin = sampleMeta?.sample_multiple_gestation === true;
            const testOpt = (sampleMeta?.sample_test_option || "").trim().toLowerCase();
            list.push({
              vgId: cell.vgId,
              index: cell.index || "",
              badge: getSampleBadge(sampleMeta),
              testOpt,
              isTwin,
            });
          }
        }
      }
    }
    return list;
  }, [libraryPlate, batch.run_samples]);

  // Build sample rows with saved data or defaults (matched by vgId, not position)
  const buildRows = (): SampleRow[] => {
    // Use ref to always get latest poolingBase without creating a dependency
    const base = poolingBaseRef.current;
    const savedSamples = pdata.samples || [];
    const savedByVgId: Record<string, any> = {};
    for (const s of savedSamples) { savedByVgId[s.vgId] = s; }
    return plateSamples.map((ps, i) => {
      const saved = savedByVgId[ps.vgId] || {};
      const conc = saved.concentration ?? null;
      const ev = saved.elutionVolume ?? DEFAULT_ELUTION_VOL;
      const y = conc ? conc * ev : 0;
      const defaultPA = calcPoolingAmount(base, ps.testOpt, ps.isTwin);
      const pa = saved.poolingAmount ?? defaultPA;
      const pv = conc && conc > 0 ? pa / conc : 0;
      return {
        idx: i + 1,
        vgId: ps.vgId,
        index: ps.index,
        badge: ps.badge,
        testOpt: ps.testOpt,
        isTwin: ps.isTwin,
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
  const [poolingBase, setPoolingBase] = useState(pdata.poolingBase ?? DEFAULT_POOLING_AMOUNT);
  const [globalElutionVol, setGlobalElutionVol] = useState(pdata.globalElutionVol ?? DEFAULT_ELUTION_VOL);
  const printRef = useRef<HTMLDivElement>(null);
  // Ref to capture latest poolingBase for buildRows without stale closure
  const poolingBaseRef = useRef(poolingBase);
  poolingBaseRef.current = poolingBase;

  // Load/sync rows
  useEffect(() => {
    setRows(buildRows());
  }, [batch.id, plateSamples.length]);

  // Recalculate pooling amounts when base input changes
  useEffect(() => {
    setRows(prev => prev.map(r => {
      const defaultPA = calcPoolingAmount(poolingBase, r.testOpt, r.isTwin);
      const pv = r.concentration && r.concentration > 0 ? defaultPA / r.concentration : 0;
      return { ...r, poolingAmount: defaultPA, poolingVolume: pv };
    }));
  }, [poolingBase]);

  // Sync global elution volume to all rows
  useEffect(() => {
    setRows(prev => prev.map(r => {
      const y = (r.concentration || 0) * globalElutionVol;
      return { ...r, elutionVolume: globalElutionVol, yield: y, eliminated: y > 0 && y < YIELD_THRESHOLD };
    }));
  }, [globalElutionVol]);

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
          poolingBase,
          globalElutionVol,
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
      <html><head><title>{t("nipt.common.poolingStatus")}</title>
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
  const td = { border: "1px solid #d9d9d9", padding: "4px 6px", textAlign: "center" as const, fontSize: 12, background: "#e8f5e9" };

  if (plateSamples.length === 0) {
    return (
      <Card size="small">
        <Text type="secondary">{t("nipt.pooling.noDataHint")}</Text>
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
              样本数: {plateSamples.length} | 淘汰阈值: &lt;{YIELD_THRESHOLD} ng
            </span>
          </Space>
        </div>
        <Space>
          <Button icon={<PrinterOutlined />} onClick={print}>{t("nipt.pooling.print")}</Button>
          <Button type="primary" onClick={save} loading={saving}>{t("nipt.common.save")}</Button>
        </Space>
      </div>

      {/* Color legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 12, color: "#666" }}>
        <span>{t("nipt.pooling.legend")}</span>
        <span style={{ background: "#e6f4ff", padding: "2px 8px", borderRadius: 3, border: "1px solid #91caff" }}>{t("nipt.extraction.legendPlus")}</span>
        <span style={{ background: "#f6ffed", padding: "2px 8px", borderRadius: 3, border: "1px solid #b7eb8f" }}>{t("nipt.extraction.legendBasic")}</span>
        <span style={{ background: "#e8d5f5", padding: "2px 8px", borderRadius: 3, border: "1px solid #c9a2e0" }}>{t("nipt.extraction.legendBasicAll")}</span>
        <span>{t("nipt.extraction.legendTwin")}</span>
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

      {/* Pooling base input */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, fontSize: 12 }}>
        <span style={{ color: "#666" }}>{t("nipt.pooling.poolingAmount")}</span>
        <InputNumber
          size="small"
          min={1}
          step={1}
          value={poolingBase}
          onChange={v => v !== null && setPoolingBase(v)}
          style={{ width: 80 }}
        />
        <span style={{ color: "#999" }}>{t("nipt.pooling.legendTwinPlus")}</span>
        <span style={{ color: "#666" }}>洗脱体积 (μL):</span>
        <InputNumber
          size="small"
          min={1}
          step={1}
          value={globalElutionVol}
          onChange={v => v !== null && setGlobalElutionVol(v)}
          style={{ width: 70 }}
        />
      </div>

      {/* Printable table */}
      <div ref={printRef} style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th} rowSpan={2}>编号</th>
              <th style={th} rowSpan={2}>{t("nipt.pooling.sampleName")}</th>
              <th style={th} rowSpan={2}>{t("nipt.pooling.index")}</th>
              <th style={th} rowSpan={2}>浓度<br/>ng/μL</th>
              <th style={th} rowSpan={2}>洗脱体积<br/>μL</th>
              <th style={th} rowSpan={2}>产量<br/>ng</th>
              <th style={th} rowSpan={2}>pooling<br/>投入量 ng</th>
              <th style={th} rowSpan={2}>pooling<br/>{t("nipt.pooling.poolingVolume")}</th>
              <th style={th} colSpan={2}>{t("nipt.pooling.poolingSummary")}</th>
            </tr>
            <tr>
              <th style={th}>{t("nipt.pooling.totalVolume")}</th>
              <th style={th}>理论浓度 ng/μL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.eliminated ? "eliminated" : ""}
                style={{ background: r.eliminated ? "#fffbe6" : i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={td}>{r.idx}</td>
                <td style={{ ...td, background: r.badge.bg || "#e8f5e9", fontWeight: r.badge.bg && r.badge.bg !== "#e8f5e9" ? 600 : 400 }}>
                  {r.badge.text ? r.badge.text + " " : ""}{r.vgId}
                </td>
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
