import { useEffect, useState, useRef, useCallback } from "react";
import { Button, Card, Select, Tag, Space, Typography, message, Upload } from "antd";
import { CheckCircleOutlined, UploadOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import api from "../../api/client";
import { GENOTYPE_23, REVIEW_STATUS_LABEL, REVIEW_STATUS_COLOR } from "./constants";

const { Text } = Typography;

export default function ResultEntryTab({ batch, results, wells, onRefresh }: {
  batch: any; results: any[]; wells: any[]; onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"entry" | "review">("entry");

  const kitType = batch.pcr_data?.kit_type || "HPV_15";
  const genotypes = kitType === "HPV_23" ? GENOTYPE_23 : GENOTYPE_23; // force 23

  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});
  const [icMatrix, setIcMatrix] = useState<Record<string, string>>({});
  const [biotinMatrix, setBiotinMatrix] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [localResults, setLocalResults] = useState<any[]>(results);

  // Sync localResults when results prop changes (batch switch / after save)
  useEffect(() => { setLocalResults(results); }, [results]);

  // ── Photo upload + zoom viewer ──
  const [photos, setPhotos] = useState<any[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const viewerRef = useRef<HTMLDivElement>(null);

  const loadPhotos = useCallback(async () => {
    setLoadingPhotos(true);
    try {
      const { data } = await api.get("/hpv/photos/", { params: { batch: batch.id } });
      setPhotos(data.results || data || []);
    } catch { /* silent */ }
    finally { setLoadingPhotos(false); }
  }, [batch.id]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  // Initialize matrix: load saved results, then fill defaults for all detection wells
  useEffect(() => {
    const m: Record<string, Record<string, string>> = {};
    const ic: Record<string, string> = {};
    const bio: Record<string, string> = {};

    // First, load existing results from backend
    for (const r of results) {
      const wl = r.well_label || "";
      m[wl] = r.genotype_results || {};
      ic[wl] = r.ic_result || "+";
      bio[wl] = r.biotin_result || "+";
    }

    // Then fill defaults for ALL detection wells (not controls)
    const defaultGenos: Record<string, string> = {};
    for (const g of genotypes) defaultGenos[g] = "-";

    for (const w of wells) {
      const wl = w.well_label;
      if (isControlWell(wl)) continue;
      if (!w.sample_id_display) continue;
      if (!m[wl]) m[wl] = { ...defaultGenos };
      if (!ic[wl]) ic[wl] = "+";
      if (!bio[wl]) bio[wl] = "+";
    }

    setMatrix(m);
    setIcMatrix(ic);
    setBiotinMatrix(bio);
  }, [results, wells, batch]);

  const setCell = (wl: string, gt: string, val: string) => {
    setMatrix(prev => ({ ...prev, [wl]: { ...(prev[wl] || {}), [gt]: val } }));
  };
  const setMatrixIc = (wl: string, val: string) => setIcMatrix(prev => ({ ...prev, [wl]: val }));
  const setMatrixBio = (wl: string, val: string) => setBiotinMatrix(prev => ({ ...prev, [wl]: val }));

  const isControlWell = (wl: string) => {
    const val = batch.hybridization_data?.well_assignments?.[wl] || "";
    return val.includes("对照");
  };

  // ── Auto-interpretation helper ──
  const autoInterpret = (genoData: Record<string, string>, icVal: string): string => {
    if (icVal !== "+") return "IC_INVALID";
    const positives = Object.entries(genoData).filter(([, v]) => v === "+").map(([k]) => k);
    if (positives.length === 0) return "NEGATIVE";
    if (positives.length === 1 && (positives[0] === "16" || positives[0] === "18")) return "HPV16/18_POSITIVE";
    return "OTHER_HR_POSITIVE";
  };

  // ── Positive genotype list ──
  const positiveList = (genoData: Record<string, string>): string => {
    if (!genoData) return "—";
    return Object.entries(genoData).filter(([, v]) => v === "+").map(([k]) => k).join(", ") || "—";
  };

  const batchUpdate = async () => {
    // Iterate over ALL detection wells (with sample assigned)
    const payload = wells
      .filter((w: any) => w.sample_id_display && !isControlWell(w.well_label))
      .map((w: any) => {
        const wl = w.well_label;
        const gt = matrix[wl];
        if (!gt) return null;
        return {
          sample: w.sample_id_display,
          genotype_results: gt,
          ic_result: icMatrix[wl] || "+",
          biotin_result: biotinMatrix[wl] || "+",
        };
      })
      .filter(Boolean);

    if (payload.length === 0) {
      message.warning("没有检测样本数据");
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post("/hpv/results/batch_update/", {
        batch_id: batch.id, results: payload,
      });
      const errs = data.errors || [];
      if (errs.length) message.warning(`${errs.length} 条更新失败`);
      else message.success(`保存成功 (${data.updated?.length || 0} 条)`);
      onRefresh();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "保存失败");
    } finally { setSaving(false); }
  };

  // ── QC status / Retest / Report ──
  const handleQcStatus = async (resultId: string | undefined, _wl: string, status: string) => {
    if (!status) return;
    try {
      await api.post("/hpv/results/qc_status/", { qc_status: status, well_label: _wl, batch_id: batch.id, result_id: resultId });
      message.success(status === "IN_CONTROL" ? "标记为在控" : "标记为失控");
      setLocalResults((prev: any[]) => prev.map((r: any) =>
        r.well_label === _wl ? { ...r, qc_status: status } : r
      ));
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || (e?.message || "操作失败"));
    }
  };

  const handleRetest = async (result: any) => {
    try {
      await api.post(`/hpv/results/${result.id}/mark_retest/`, { reason: "POSITIVE" });
      message.success("已标记需复查，请到 Sample Receiving 查看");
      onRefresh();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || (e?.message || "操作失败"));
    }
  };

  const handleReport = async (result: any) => {
    try {
      await api.post(`/hpv/results/${result.id}/mark_reportable/`);
      message.success("已标记可出报告");
      onRefresh();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || (e?.message || "操作失败"));
    }
  };

  // ── Photo upload ──
  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("batch", batch.id);
    try {
      await api.post("/hpv/photos/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      message.success("照片上传成功");
      loadPhotos();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.error || data?.detail || (typeof data === "object" && data !== null ? Object.values(data).flat()[0] : null);
      message.error(msg || "上传失败");
    }
    return false;
  };

  // ── Zoom / Pan handlers ──
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prev => Math.max(0.5, Math.min(5, prev + delta)));
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setDragging(false);
  const resetZoom = () => { setScale(1); setPan({ x: 0, y: 0 }); };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type={mode === "entry" ? "primary" : "default"} onClick={() => setMode("entry")}>结果录入</Button>
        <Button type={mode === "review" ? "primary" : "default"} onClick={() => setMode("review")}>复核（双审）</Button>
        <Button onClick={batchUpdate} type="primary" loading={saving} icon={<CheckCircleOutlined />}>保存结果</Button>
      </Space>

      {/* ── Photo upload + zoom viewer ── */}
      <Card
        title={`结果照片 (${photos.length})`}
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*">
            <Button icon={<UploadOutlined />} size="small">上传照片</Button>
          </Upload>
        }
      >
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto", minWidth: 120 }}>
            {photos.map((p: any) => (
              <div
                key={p.id}
                onClick={() => { setSelectedPhoto(p.image); setScale(1); setPan({ x: 0, y: 0 }); }}
                style={{
                  cursor: "pointer",
                  border: selectedPhoto === p.image ? "2px solid #1890ff" : "2px solid transparent",
                  borderRadius: 4, overflow: "hidden",
                }}
              >
                <img src={p.image} alt="" style={{ width: 100, height: 80, objectFit: "cover", display: "block" }} />
              </div>
            ))}
            {!loadingPhotos && photos.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>暂无照片</Text>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            {selectedPhoto ? (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <Button size="small" icon={<ZoomInOutlined />} onClick={() => setScale(prev => Math.min(5, prev + 0.25))}>放大</Button>
                  <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setScale(prev => Math.max(0.5, prev - 0.25))}>缩小</Button>
                  <Button size="small" onClick={resetZoom}>重置</Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(scale * 100)}%</Text>
                </Space>
                <div
                  ref={viewerRef}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{
                    width: "100%", height: 360, overflow: "hidden",
                    border: "1px solid #d9d9d9", borderRadius: 4,
                    background: "#f5f5f5",
                    cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <img
                    src={selectedPhoto} alt="预览" draggable={false}
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                      transformOrigin: "center center",
                      transition: dragging ? "none" : "transform 0.15s",
                      maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
                    }}
                  />
                </div>
              </div>
            ) : (
              <div style={{
                width: "100%", height: 360, border: "1px dashed #d9d9d9", borderRadius: 4,
                display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa",
              }}>
                <Text type="secondary">点击左侧缩略图查看大图</Text>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Genotype matrix table ── */}
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 520px)" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%", minWidth: 1400 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ padding: "4px 6px", border: "1px solid #f0f0f0", textAlign: "left", minWidth: 100, position: "sticky", top: 0, background: "#fafafa", zIndex: 3 }}>
                样本编号
              </th>
              {genotypes.map(gt => (
                <th key={gt} style={{ padding: "4px 2px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 34, position: "sticky", top: 0, background: "#fafafa" }}>
                  {gt}
                </th>
              ))}
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#fff7e6" }}>IC</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#e6f7ff" }}>Biotin</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#f6ffed", minWidth: 120 }}>阳性分型</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#fafafa", minWidth: 80 }}>自动判读</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#fafafa", minWidth: 80 }}>状态</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", position: "sticky", top: 0, background: "#fafafa", minWidth: 120 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {wells.filter(w => w.sample_id_display || isControlWell(w.well_label)).sort((a, b) => {
              const ac = isControlWell(a.well_label) ? 0 : 1;
              const bc = isControlWell(b.well_label) ? 0 : 1;
              return ac - bc;
            }).map(w => {
              const wl = w.well_label;
              const result = localResults.find((r: any) => r.well_label === wl);
              const genotypeData = matrix[wl] || {};
              const icVal = icMatrix[wl] || "";
              const bioVal = biotinMatrix[wl] || "";
              const interpretation = autoInterpret(genotypeData, icVal);
              const positives = positiveList(genotypeData);

              return (
                <tr key={wl} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "4px 6px", border: "1px solid #f0f0f0", maxWidth: 110, whiteSpace: "nowrap" }}>
                    <Text style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", display: "block", maxWidth: 100 }}>
                      {isControlWell(wl) ? (batch.hybridization_data?.well_assignments?.[wl] || wl) : (w.sample_id_display || "\u2014")}
                    </Text>
                  </td>
                  {genotypes.map(gt => (
                    <td key={gt} style={{ padding: 2, border: "1px solid #f0f0f0", textAlign: "center" }}>
                      {mode === "entry" ? (
                        <Select size="small" style={{ width: 50 }} value={genotypeData[gt] || ""}
                          onChange={(v: string) => setCell(wl, gt, v)}
                          options={[
                            { value: "", label: "" },
                            { value: "+", label: "+" },
                            { value: "-", label: "-" },
                          ]}
                        />
                      ) : (
                        <Tag color={genotypeData[gt] === "+" ? "red" : "default"} style={{ fontSize: 10, margin: 0 }}>
                          {genotypeData[gt] || "\u2014"}
                        </Tag>
                      )}
                    </td>
                  ))}
                  <td style={{ padding: 2, border: "1px solid #f0f0f0", textAlign: "center", background: icVal !== "+" ? "#fff1f0" : "#fff7e6" }}>
                    {mode === "entry" ? (
                      <Select size="small" style={{ width: 50 }} value={icVal}
                        onChange={(v: string) => setMatrixIc(wl, v)}
                        options={[{ value: "", label: "" }, { value: "+", label: "+" }, { value: "-", label: "-" }]}
                      />
                    ) : (
                      <Tag color={icVal === "+" ? "green" : icVal === "-" ? "red" : "default"} style={{ fontSize: 10, margin: 0 }}>
                        {icVal || "\u2014"}
                      </Tag>
                    )}
                  </td>
                  <td style={{ padding: 2, border: "1px solid #f0f0f0", textAlign: "center", background: bioVal !== "+" ? "#fff1f0" : "#e6f7ff" }}>
                    {mode === "entry" ? (
                      <Select size="small" style={{ width: 50 }} value={bioVal}
                        onChange={(v: string) => setMatrixBio(wl, v)}
                        options={[{ value: "", label: "" }, { value: "+", label: "+" }, { value: "-", label: "-" }]}
                      />
                    ) : (
                      <Tag color={bioVal === "+" ? "blue" : bioVal === "-" ? "red" : "default"} style={{ fontSize: 10, margin: 0 }}>
                        {bioVal || "\u2014"}
                      </Tag>
                    )}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center", fontSize: 11, background: "#f6ffed" }}>
                    {positives === "—" ? (
                      <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                    ) : (
                      <Text style={{ fontSize: 11, color: "#cf1322", fontWeight: 500 }}>{positives}</Text>
                    )}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center", fontSize: 11 }}>
                    <Tag color={interpretation === "NEGATIVE" ? "green" : interpretation === "IC_INVALID" ? "red" : "orange"}>
                      {interpretation === "NEGATIVE" ? "阴性" : interpretation === "IC_INVALID" ? "IC无效" : interpretation === "HPV16/18_POSITIVE" ? "16/18阳性" : "其他高危阳性"}
                    </Tag>
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center" }}>
                    {result ? (
                      <Tag color={REVIEW_STATUS_COLOR[result.review_status] || "default"}>
                        {REVIEW_STATUS_LABEL[result.review_status] || result.review_status}
                      </Tag>
                    ) : "\u2014"}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center" }}>
                    {isControlWell(wl) ? (
                      <Select size="small" style={{ width: 80 }}
                        value={result?.qc_status || ""}
                        onChange={(v) => handleQcStatus(result?.id, wl, v)}
                        options={[
                          { value: "IN_CONTROL", label: "在控" },
                          { value: "OUT_OF_CONTROL", label: "失控" },
                        ]}
                      />
                    ) : result ? (
                      <Space size={2}>
                        <Button size="small" onClick={() => handleRetest(result)}>复查</Button>
                        <Button size="small" type="primary" onClick={() => handleReport(result)}>报告</Button>
                      </Space>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 11 }}>请先保存</Text>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
