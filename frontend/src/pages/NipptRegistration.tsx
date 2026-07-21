// NipptRegistration.tsx — NIPPT Sample Registration (重写版)
// 2026-07-21: Complete rewrite with 首次/补充/重采 support

import { useState, useEffect, useCallback } from "react";
import {
  Card, Form, Input, Select, Button, message, Typography,
  Divider, Table, Tag, Modal, DatePicker, Row, Col, Switch,
  Radio, Space, Collapse, Checkbox,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, SendOutlined,
  UploadOutlined, SearchOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text } = Typography;

const SAMPLE_TYPE_OPTIONS = [
  { value: "BLOOD", label: "Peripheral Blood" },
  { value: "SWAB", label: "Buccal Swab" },
  { value: "HAIR", label: "Hair Follicle" },
  { value: "DBS", label: "Dried Blood Spot" },
];

const SOURCE_OPTIONS = [
  { value: "国内", label: "国内" },
  { value: "泰国", label: "泰国" },
  { value: "巴西", label: "巴西" },
  { value: "巴西万基", label: "巴西万基" },
  { value: "韩国", label: "韩国" },
  { value: "澳洲", label: "澳洲" },
  { value: "CYJ印度", label: "CYJ印度" },
  { value: "CYJ澳洲", label: "CYJ澳洲" },
  { value: "CYJ秘鲁", label: "CYJ秘鲁" },
  { value: "CYJ美国", label: "CYJ美国" },
  { value: "澳洲经销商", label: "澳洲经销商" },
  { value: "西班牙代理", label: "西班牙代理" },
  { value: "西班牙巴塞罗那经销商", label: "西班牙巴塞罗那经销商" },
  { value: "YLH西班牙bygens", label: "YLH西班牙bygens" },
  { value: "YLH西班牙LABGENETICS", label: "YLH西班牙LABGENETICS" },
];

// Risk warning options (placeholder, to be configured later)
const RISK_WARNING_OPTIONS = [
  { value: "heparin", label: "肝素抗凝" },
  { value: "transfusion", label: "近期输血" },
  { value: "transplant", label: "器官移植史" },
  { value: "chimera", label: "嵌合体可能" },
  { value: "vanishing_twin", label: "双胎消失综合征" },
];

export default function NipptRegistration() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [regType, setRegType] = useState<string>("FIRST");
  const [ptSearch, setPtSearch] = useState("");
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  // Recent cases
  const [recentCases, setRecentCases] = useState<any[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);

  // Token modal
  const [tokenModal, setTokenModal] = useState<{
    open: boolean; url: string; expires: string; caseNumber: string;
  } | null>(null);

  // Resample target select
  const [resampleTarget, setResampleTarget] = useState<string | null>(null);

  useEffect(() => { refreshCases(); }, []);

  const refreshCases = useCallback(() => {
    setCasesLoading(true);
    (casesApi as any).list({ limit: 20, ordering: "-created_at" })
      .then((r: any) => { setRecentCases(r.data?.results || []); })
      .catch(() => {})
      .finally(() => setCasesLoading(false));
  }, []);

  // Search PT number for supplement/resample
  const handlePtSearch = async () => {
    if (!ptSearch.trim()) return;
    setSearching(true);
    try {
      const res = await (casesApi as any).list({ search: ptSearch.trim(), limit: 5 });
      const results = res.data?.results || [];
      if (results.length === 1) {
        const detail = await (casesApi as any).get(results[0].id);
        setSelectedCase(detail.data);
        fillCaseInfo(detail.data);
      } else if (results.length > 1) {
        // Show selection modal (simplified: pick first match)
        const detail = await (casesApi as any).get(results[0].id);
        setSelectedCase(detail.data);
        fillCaseInfo(detail.data);
      } else {
        message.warning("未找到匹配的 PT 号");
        setSelectedCase(null);
      }
    } catch {
      message.error("搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const fillCaseInfo = (caseData: any) => {
    form.setFieldsValue({
      sales_person: caseData.sales_person || "",
      clinic_name: caseData.clinic_name || "",
      applicant: caseData.applicant || "",
      notes: caseData.notes || "",
    });
  };

  // Generate token
  const handleGenerateToken = async (id: string, caseNumber: string) => {
    try {
      const res = await (casesApi as any).generateToken(id);
      setTokenModal({
        open: true,
        url: res.data.url,
        expires: res.data.expires,
        caseNumber,
      });
    } catch {
      message.error("Failed to generate token");
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => message.success("Link copied!"));
  };

  // Submit registration
  const handleSubmit = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      if (regType === "FIRST") {
        const payload: any = {
          mother_name: values.mother_name,
          mother_dob: values.mother_dob ? dayjs(values.mother_dob).format("YYYY-MM-DD") : undefined,
          father_names: (values.males || []).map((m: any) => m.name).filter(Boolean),
          father_sample_type: (values.males?.[0] as any)?.sample_type || "BLOOD",
          gestational_age_weeks: values.gestational_age_weeks,
          gestational_age_days: values.gestational_age_days,
          clinic_name: values.clinic_name,
          sales_person: values.sales_person,
          applicant: values.applicant,
          phone: values.phone,
          email: values.email,
          multiple_gestation: values.multiple_gestation || false,
          risk_warnings: values.risk_warnings || [],
          registration_type: "FIRST",
          sample_source: values.sample_source,
          external_id: values.external_id,
          fedex_no: values.fedex_no,
          female_arrival_date: values.female_arrival_date
            ? dayjs(values.female_arrival_date).format("YYYY-MM-DD") : undefined,
          male_arrival_dates: (values.males || []).map((m: any) =>
            m.arrival_date ? dayjs(m.arrival_date).format("YYYY-MM-DD") : null
          ).filter(Boolean),
          last_menstrual_period: values.last_menstrual_period
            ? dayjs(values.last_menstrual_period).format("YYYY-MM-DD") : undefined,
          collection_date: values.collection_date
            ? dayjs(values.collection_date).format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"),
          notes: values.notes,
        };
        const res = await (casesApi as any).create(payload);
        message.success(`Case ${res.data.case_number} created`);
      } else if (regType === "SUPPLEMENT" && selectedCase) {
        // 补充样本：极简表单一键提交
        await (casesApi as any).supplement?.(selectedCase.id, {
          role: values.supp_role,
          patient_name: values.supp_name,
          sample_source: values.supp_sample_type || "BLOOD",
          arrival_date: values.supp_arrival_date
            ? dayjs(values.supp_arrival_date).format("YYYY-MM-DD") : undefined,
        });
        message.success(`补充样本成功`);
      } else if (regType === "RESAMPLE" && selectedCase && resampleTarget) {
        // 重采样本：直接用原信息 + 新到样日期
        const cs = selectedCase.case_samples?.find((s: any) => s.id === resampleTarget);
        const res = await (casesApi as any).resample?.(selectedCase.id, {
          case_sample_id: resampleTarget,
          patient_name: cs?.patient_name || "",
          sample_source: cs?.sample_source || "BLOOD",
          arrival_date: values.supp_arrival_date
            ? dayjs(values.supp_arrival_date).format("YYYY-MM-DD") : undefined,
        });
        message.success(`重采样本已创建: ${res.data?.test_sample_id || ""}`);
      }

      form.resetFields();
      setSelectedCase(null);
      setPtSearch("");
      setResampleTarget(null);
      refreshCases();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || JSON.stringify(e?.response?.data) || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const caseColumns = [
    { title: "Case #", dataIndex: "case_number", key: "cn", width: 180,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: "PT No.", dataIndex: "pt_number", key: "pt", width: 100,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : "-" },
    { title: "Samples", dataIndex: "sample_count", key: "sc", width: 70 },
    { title: "Status", dataIndex: "status", key: "st", width: 120,
      render: (s: string) => {
        const m: Record<string, string> = { REGISTERED: "blue", DRAFT: "default", RECEIVING: "cyan", IN_PROCESS: "orange", COMPLETED: "green" };
        return <Tag color={m[s] || "default"}>{s}</Tag>;
      } },
    { title: "Created", dataIndex: "created_at", key: "ca", width: 130,
      render: (v: string) => v ? dayjs(v).format("MM-DD HH:mm") : "-" },
    { title: "Action", key: "act", width: 130,
      render: (_: any, r: any) => (
        <Button type="primary" size="small" icon={<SendOutlined />}
          onClick={() => handleGenerateToken(r.id, r.case_number)}>
          Generate Link
        </Button>
      ) },
  ];

  return (
    <div>
      {/* Registration Type Selector */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Radio.Group value={regType} onChange={(e) => {
          setRegType(e.target.value);
          form.resetFields();
          setSelectedCase(null);
          setPtSearch("");
          setResampleTarget(null);
        }} buttonStyle="solid" size="middle">
          <Radio.Button value="FIRST">首次检测</Radio.Button>
          <Radio.Button value="SUPPLEMENT">补充样本</Radio.Button>
          <Radio.Button value="RESAMPLE">重采样本</Radio.Button>
        </Radio.Group>

        {/* PT Search for supplement/resample */}
        {(regType === "SUPPLEMENT" || regType === "RESAMPLE") && (
          <div style={{ marginTop: 12 }}>
            <Space>
              <Input.Search
                placeholder="输入 PT 号搜索已有案例"
                value={ptSearch}
                onChange={(e) => setPtSearch(e.target.value)}
                onSearch={handlePtSearch}
                loading={searching}
                style={{ width: 280 }}
                enterButton={<><SearchOutlined /> 搜索</>}
              />
              {selectedCase && (
                <Tag color="green">
                  已选择: {selectedCase.case_number} ({selectedCase.pt_number})
                </Tag>
              )}
            </Space>
            {regType === "RESAMPLE" && selectedCase && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">选择重采对象：</Text>
                <Select
                  style={{ width: 300, marginLeft: 8 }}
                  placeholder="选择要重采的样本"
                  value={resampleTarget}
                  onChange={setResampleTarget}
                  options={selectedCase.case_samples?.map((cs: any) => ({
                    value: cs.id,
                    label: `${cs.test_sample_id} — ${cs.patient_name} (${cs.role === "MOTHER" ? "母亲" : "父亲"})`,
                  })) || []}
                />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* === 首次检测：完整登记表单 === */}
      {regType === "FIRST" && (
        <Card size="small">
          <Form form={form} layout="vertical" size="small">
            <Divider plain style={{ fontSize: 13, fontWeight: 500 }}>基本信息</Divider>
            <Row gutter={12}>
              <Col xs={24} sm={8}>
                <Form.Item name="sample_source" label="来源">
                  <Select options={SOURCE_OPTIONS} placeholder="选择来源" allowClear />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="sales_person" label="销售/代理">
                  <Input placeholder="销售或代理名称" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="applicant" label="申请方">
                  <Input placeholder="申请人姓名" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item name="external_id" label="样本编号(外部)">
                  <Input placeholder="外部样本编号" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="collection_date" label="申请日期">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="fedex_no" label="快递单号">
                  <Input placeholder="FedEx/USPS..." />
                </Form.Item>
              </Col>
            </Row>

            <Divider plain style={{ fontSize: 13, fontWeight: 500 }}>孕妇信息</Divider>
            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item name="mother_name" label="孕妇姓名"
                  rules={[{ required: true, message: "请输入孕妇姓名" }]}>
                  <Input placeholder="孕妇姓名" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="last_menstrual_period" label="末次月经">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={4}>
                <Form.Item name="multiple_gestation" label="单双胎" valuePropName="checked">
                  <Switch checkedChildren="双胎" unCheckedChildren="单胎" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={4}>
                <Form.Item name="phone" label="电话">
                  <Input placeholder="联系电话" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={4}>
                <Form.Item name="email" label="邮箱">
                  <Input placeholder="邮箱地址" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} sm={8}>
                <Form.Item name="female_arrival_date" label="女性到样日期">
                  <DatePicker style={{ width: "100%" }} placeholder="母亲样本到达日期" />
                </Form.Item>
              </Col>
            </Row>

            <Divider plain style={{ fontSize: 13, fontWeight: 500 }}>男性信息</Divider>
            <Form.List name="males">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Row key={key} gutter={12} style={{ marginBottom: 8 }} align="middle">
                      <Col flex="1">
                        <Form.Item {...rest} name={[name, "name"]} label="男性姓名" style={{ marginBottom: 0 }}>
                          <Input placeholder="男性姓名" />
                        </Form.Item>
                      </Col>
                      <Col style={{ width: 160 }}>
                        <Form.Item {...rest} name={[name, "sample_type"]} label="样本类型" style={{ marginBottom: 0 }}
                          initialValue="BLOOD">
                          <Select options={SAMPLE_TYPE_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col style={{ width: 180 }}>
                        <Form.Item {...rest} name={[name, "arrival_date"]} label="到样日期" style={{ marginBottom: 0 }}>
                          <DatePicker style={{ width: "100%" }} placeholder="男性到样日期" />
                        </Form.Item>
                      </Col>
                      <Col style={{ width: 40, paddingTop: 22 }}>
                        <Button type="text" danger icon={<span>✕</span>} onClick={() => remove(name)} size="small" />
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" onClick={() => add({ sample_type: "BLOOD" })} block
                    icon={<PlusOutlined />} style={{ marginBottom: 8 }}>
                    添加男性
                  </Button>
                </>
              )}
            </Form.List>

            <Divider plain style={{ fontSize: 13, fontWeight: 500 }}>其他信息</Divider>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="risk_warnings" label="影响结果的风险提示">
                  <Checkbox.Group options={RISK_WARNING_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="clinic_name" label="诊所/医院">
                  <Input placeholder="诊所或医院名称" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={24}>
                <Form.Item name="notes" label="备注">
                  <Input.TextArea rows={2} placeholder="内部备注" />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <Button type="primary" icon={<PlusOutlined />} loading={loading}
                onClick={handleSubmit} size="large">
                提交登记
              </Button>
              <Button icon={<UploadOutlined />} disabled title="批量导入功能开发中">
                批量导入 (开发中)
              </Button>
              <Button icon={<UploadOutlined />} disabled title="从文件登记功能开发中">
                从文件登记 (开发中)
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* === 补充样本：极简表单 === */}
      {regType === "SUPPLEMENT" && selectedCase && (
        <Card size="small">
          <Form form={form} layout="vertical" size="small">
            <div style={{ marginBottom: 12 }}>
              <Tag color="blue">PT: {selectedCase.pt_number}</Tag>
              <Tag>{selectedCase.case_number}</Tag>
            </div>
            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_role" label="补样对象" rules={[{ required: true }]} initialValue="ALLEGED_FATHER">
                  <Select options={[
                    { value: "MOTHER", label: "孕妇" },
                    { value: "ALLEGED_FATHER", label: "疑父" },
                  ]} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_name" label="姓名" rules={[{ required: true }]}>
                  <Input placeholder="姓名" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_sample_type" label="样本类型" initialValue="BLOOD">
                  <Select options={SAMPLE_TYPE_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_arrival_date" label="到样日期">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} loading={loading}
                onClick={handleSubmit} size="large">
                补充样本
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* === 重采样本：极简表单 === */}
      {regType === "RESAMPLE" && selectedCase && resampleTarget && (
        <Card size="small">
          <Form form={form} layout="vertical" size="small">
            <div style={{ marginBottom: 12 }}>
              <Tag color="blue">PT: {selectedCase.pt_number}</Tag>
              <Tag>{selectedCase.case_number}</Tag>
              <Tag color="purple">
                重采 →{" "}
                {(() => {
                  const cs = selectedCase.case_samples?.find((s: any) => s.id === resampleTarget);
                  if (!cs) return "";
                  const baseId = cs.test_sample_id || "";
                  const existingResamples = selectedCase.case_samples?.filter(
                    (s: any) => s.resample_of === cs.id
                  ).length || 0;
                  return `${baseId}-R${existingResamples + 1}`;
                })()}
              </Tag>
            </div>
            <Row gutter={12}>
              <Col xs={24} sm={6}>
                <Form.Item label="原编号">
                  <Input disabled value={
                    selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.test_sample_id || ""
                  } />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item label="原姓名">
                  <Input disabled value={
                    selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.patient_name || ""
                  } />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item label="身份">
                  <Input disabled value={
                    selectedCase.case_samples?.find((s: any) => s.id === resampleTarget)?.role === "MOTHER" ? "孕妇" : "疑父"
                  } />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="supp_arrival_date" label="新到样日期">
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} loading={loading}
                onClick={handleSubmit} size="large">
                确认重采
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* Recent Cases (collapsible) */}
      <Collapse style={{ marginTop: 16 }} ghost items={[{
        key: "recent",
        label: <span><ReloadOutlined style={{ marginRight: 8 }} />Recent Cases ({recentCases.length})</span>,
        children: (
          <Table
            dataSource={recentCases}
            columns={caseColumns}
            rowKey="id"
            loading={casesLoading}
            size="small"
            pagination={{ pageSize: 10, size: "small" }}
            scroll={{ x: 800 }}
          />
        ),
      }]} />

      {/* Token Modal */}
      <Modal
        title="Registration Link"
        open={tokenModal?.open || false}
        onCancel={() => setTokenModal(null)}
        footer={[
          <Button key="copy" type="primary" icon={<CopyOutlined />}
            onClick={() => copyLink(tokenModal?.url || "")}>
            Copy Link
          </Button>,
          <Button key="close" onClick={() => setTokenModal(null)}>Close</Button>,
        ]}
        width={560}
      >
        {tokenModal && (
          <div>
            <p><Text strong>Case:</Text> {tokenModal.caseNumber}</p>
            <Card size="small" style={{ background: "#f6ffed", marginBottom: 12 }}>
              <Text copyable style={{ wordBreak: "break-all", fontSize: 14 }}>
                {tokenModal.url}
              </Text>
            </Card>
            <p>
              <Text type="secondary">
                Expires: {tokenModal.expires ? dayjs(tokenModal.expires).format("YYYY-MM-DD HH:mm") : "N/A"}
              </Text>
            </p>
            <Divider />
            <Text type="secondary">
              Share this link with the family. They can register sample information without logging in.
            </Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
