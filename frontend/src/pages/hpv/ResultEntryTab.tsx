import { useEffect, useState } from "react";
import { Button, Card, Select, Tag, Space, Typography, message, Popconfirm } from "antd";
import { CheckCircleOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import api from "../../api/client";
import { GENOTYPE_15, GENOTYPE_23, REVIEW_STATUS_LABEL, REVIEW_STATUS_COLOR } from "./constants";

const { Title, Text } = Typography;

export default function ResultEntryTab({ batch, results, wells, photos, onRefresh }: {
  batch: any; results: any[]; wells: any[]; photos: any[]; onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"entry" | "review">("entry");

  const totalWells = wells.length;
  const totalPhotos = photos.length;
  const photoBlocked = totalPhotos < totalWells;

  const kitType = batch.pcr_data?.kit_type || "HPV_15";
  const genotypes = kitType === "HPV_23" ? GENOTYPE_23 : GENOTYPE_15;

  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({});
  const [icMatrix, setIcMatrix] = useState<Record<string, string>>({});
  const [biotinMatrix, setBiotinMatrix] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m: Record<string, Record<string, string>> = {};
    const ic: Record<string, string> = {};
    const bio: Record<string, string> = {};
    for (const r of results) {
      const wl = r.well_label || "";
      m[wl] = r.genotype_results || {};
      ic[wl] = r.ic_result || "";
      bio[wl] = r.biotin_result || "";
    }
    setMatrix(m); setIcMatrix(ic); setBiotinMatrix(bio);
  }, [results]);

  const setCell = (wl: string, gt: string, val: string) => {
    setMatrix(prev => ({ ...prev, [wl]: { ...(prev[wl] || {}), [gt]: val } }));
  };
  const setMatrixIc = (wl: string, val: string) => setIcMatrix(prev => ({ ...prev, [wl]: val }));
  const setMatrixBio = (wl: string, val: string) => setBiotinMatrix(prev => ({ ...prev, [wl]: val }));

  const fillAllNeg = () => {
    const m2: Record<string, Record<string, string>> = {};
    for (const w of wells) {
      const gtMap: Record<string, string> = {};
      for (const g of genotypes) gtMap[g] = "-";
      m2[w.well_label] = gtMap;
    }
    setMatrix(m2);
  };

  const batchUpdate = async () => {
    const payload = results.map((r: any) => {
      const wl = r.well_label || "";
      return {
        sample: r.sample_display || r.sample,
        genotype_results: matrix[wl] || {},
        ic_result: icMatrix[wl] || "",
        biotin_result: biotinMatrix[wl] || "",
      };
    });
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

  const submitReview = async (resultId: string) => {
    try {
      await api.post(`/hpv/results/${resultId}/submit_review/`);
      message.success("已提交复核"); onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "提交失败"); }
  };
  const approveResult = async (resultId: string) => {
    try {
      await api.post(`/hpv/results/${resultId}/approve/`, { comment: "复核通过" });
      message.success("复核通过"); onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "复核失败"); }
  };
  const rejectResult = async (resultId: string, reason: string) => {
    try {
      await api.post(`/hpv/results/${resultId}/reject/`, { comment: reason });
      message.success("已退回"); onRefresh();
    } catch (e: any) { message.error(e?.response?.data?.error || "退回失败"); }
  };

  if (photoBlocked) {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: 40 }}>
          <ExclamationCircleOutlined style={{ fontSize: 48, color: "#ff4d4f" }} />
          <Title level={4} type="danger" style={{ marginTop: 16 }}>
            膜条照片未上传完整
          </Title>
          <Text>当前 {totalPhotos}/{totalWells} 张，请先在杂交阶段上传所有膜条照片后再进入结果录入。</Text>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type={mode === "entry" ? "primary" : "default"} onClick={() => setMode("entry")}>结果录入</Button>
        <Button type={mode === "review" ? "primary" : "default"} onClick={() => setMode("review")}>复核（双审）</Button>
        <Button onClick={fillAllNeg}>批量填全阴</Button>
        <Button onClick={batchUpdate} type="primary" loading={saving} icon={<CheckCircleOutlined />}>保存结果</Button>
      </Space>

      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 240px)" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%", minWidth: 1200 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ position: "sticky", left: 0, background: "#fafafa", padding: "4px 6px", border: "1px solid #f0f0f0", zIndex: 2 }}>
                孔位/样本
              </th>
              {genotypes.map(gt => (
                <th key={gt} style={{ padding: "4px 2px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 42 }}>
                  {gt}
                </th>
              ))}
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", background: "#fff7e6" }}>IC</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", background: "#e6f7ff" }}>Biotin</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 80 }}>自动判读</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 80 }}>状态</th>
              <th style={{ padding: "4px 4px", border: "1px solid #f0f0f0", textAlign: "center", minWidth: 120 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {wells.map(w => {
              const wl = w.well_label;
              const result = results.find((r: any) => r.well_label === wl);
              const genotypeData = matrix[wl] || {};
              const icVal = icMatrix[wl] || result?.ic_result || "";
              const bioVal = biotinMatrix[wl] || result?.biotin_result || "";

              return (
                <tr key={wl} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{
                    position: "sticky", left: 0, background: "#fff",
                    padding: "4px 6px", border: "1px solid #f0f0f0", zIndex: 1,
                  }}>
                    <Text strong style={{ fontSize: 12 }}>{wl}</Text>
                    <br />
                    <Text style={{ fontSize: 10, color: "#8c8c8c" }}>
                      {w.sample_id_display || "\u2014"}
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
                  <td style={{ padding: 2, border: "1px solid #f0f0f0", textAlign: "center", background: icVal === "-" ? "#fff1f0" : "#fff7e6" }}>
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
                  <td style={{ padding: 2, border: "1px solid #f0f0f0", textAlign: "center", background: bioVal === "-" ? "#fff1f0" : "#e6f7ff" }}>
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
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center", fontSize: 11 }}>
                    {result?.auto_interpretation ? (
                      <Tag color={result.auto_interpretation === "NEGATIVE" ? "green" : result.auto_interpretation === "IC_INVALID" ? "red" : "orange"}>
                        {result.auto_interpretation}
                      </Tag>
                    ) : "\u2014"}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center" }}>
                    {result ? (
                      <Tag color={REVIEW_STATUS_COLOR[result.review_status] || "default"}>
                        {REVIEW_STATUS_LABEL[result.review_status] || result.review_status}
                      </Tag>
                    ) : "\u2014"}
                  </td>
                  <td style={{ padding: 4, border: "1px solid #f0f0f0", textAlign: "center" }}>
                    {result && (
                      <Space size={2}>
                        {result.review_status === "DRAFT" && (
                          <Button size="small" type="link" onClick={() => submitReview(result.id)}>提交复核</Button>
                        )}
                        {result.review_status === "PENDING_REVIEW" && mode === "review" && (
                          <>
                            <Button size="small" type="link" onClick={() => approveResult(result.id)}>通过</Button>
                            <Popconfirm title="退回原因" onConfirm={() => rejectResult(result.id, "复核不通过")}>
                              <Button size="small" type="link" danger>退回</Button>
                            </Popconfirm>
                          </>
                        )}
                      </Space>
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
