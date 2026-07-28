// NipptRegistration.tsx — NIPPT Sample Registration (重写版)
// 2026-07-21: Complete rewrite with 首次/补充/重采 support

import { useState, useEffect, useCallback } from "react";
import {
  Card, Form, Input, Select, Button, message, Typography,
  Divider, Table, Tag, Modal, DatePicker, Row, Col,
  Radio, Space, Collapse,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, SendOutlined,
  SearchOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { casesApi } from "../api";
import dayjs from "dayjs";

const { Text } = Typography;

const SAMPLE_TYPE_OPTIONS = [
  { value: "BLOOD",      label: "血液" },
  { value: "DBS",        label: "血痕" },
  { value: "HAIR",       label: "毛发" },
  { value: "NAIL",       label: "指甲" },
  { value: "SWAB",       label: "口拭子" },
  { value: "SEMEN",      label: "精液" },
  { value: "TOOTHBRUSH", label: "牙刷" },
  { value: "CIGARETTE",  label: "烟头" },
  { value: "BOTTLE",     label: "水瓶" },
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
          father_sample_types: (values.males || []).map((m: any) => m.sample_type || ["BLOOD"]),
          gestational_age_weeks: values.gestational_age_weeks,
          gestational_age_days: values.gestational_age_days,
          clinic_name: values.clinic_name,
          sales_person: values.sales_person,
          applicant: values.applicant,
          phone: values.phone,
          email: values.email,
          multiple_gestation: values.multiple_gestation || false,
          risk_warnings: values.risk ? Object.entries(values.risk).filter(([_, v]) => v).map(([k]) => k) : [],
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
          sample_types: values.supp_sample_type || ["BLOOD"],
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
        <Card size="small" style={{ borderRadius: 8 }}>
          <Form form={form} layout="vertical" size="small"
            initialValues={{
              males: [{ sample_type: ["BLOOD"] }, { sample_type: ["BLOOD"] }],
              mother_sample_type: ["BLOOD"],
              female_arrival_date: dayjs(),
            }}>

            {/* 1 样本来源 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>1</span>
              <Text strong style={{ fontSize: 15 }}>样本来源</Text>
            </div>
            <div style={{ marginBottom: 8, color: "#999", fontSize: 11, marginLeft: 32 }}>
              1. 本室工作人员采集；2. 申请人送来；3. 邮寄样本
            </div>
            <Form.Item name="collection_method" style={{ marginLeft: 32, marginBottom: 0 }} initialValue="1">
              <Radio.Group>
                <Radio value="1">1. 本室采集</Radio>
                <Radio value="2">2. 申请人送来</Radio>
                <Radio value="3">3. 邮寄样本</Radio>
              </Radio.Group>
            </Form.Item>

            <Divider style={{ margin: "8px 0" }} />

            {/* 2 样本信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>2</span>
              <Text strong style={{ fontSize: 15 }}>样本信息</Text>
            </div>

            {/* Mother row — outside Form.List, won't disappear */}
            <Table
              dataSource={[{ key: "mother" }]}
              pagination={false}
              size="small"
              rowKey="key"
              showHeader={false}
              style={{ marginLeft: 32, marginBottom: 0 }}
              columns={[
                {
                  title: "", width: 90,
                  render: () => <Text strong style={{ fontSize: 13 }}>孕妇</Text>,
                },
                {
                  title: "", width: 120,
                  render: () => (
                    <Form.Item name="mother_name" style={{ margin: 0 }}
                      rules={[{ required: true, message: "必填" }]}>
                      <Input placeholder="孕妇姓名" size="small" bordered={false}
                        style={{ background: "#fafafa", borderRadius: 0 }} />
                    </Form.Item>
                  ),
                },
                {
                  title: "", width: 100,
                  render: () => (
                    <Form.Item name="mother_ethnicity" style={{ margin: 0 }}>
                      <Input placeholder="民族" size="small" bordered={false}
                        style={{ background: "#fafafa", borderRadius: 0 }} />
                    </Form.Item>
                  ),
                },
                {
                  title: "", width: 130,
                  render: () => (
                    <Tag color="blue" style={{ margin: 0, fontSize: 12 }}>血液</Tag>
                  ),
                },
                {
                  title: "", width: 140,
                  render: () => (
                    <Form.Item name="female_arrival_date" style={{ margin: 0 }}>
                      <DatePicker size="small" bordered={false}
                        style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                    </Form.Item>
                  ),
                },
                { title: "", width: 60, render: () => null },
              ] as any}
              locale={{ emptyText: "" }}
            />

            {/* Male rows — inside Form.List */}
            <Form.List name="males">
              {(fields, { add, remove }) => (
                <Table
                  dataSource={fields.map((f, i) => ({
                    key: f.key,
                    role: fields.length > 1 ? `疑父${i + 1}` : "疑父",
                    maleIndex: i,
                    field: f,
                  }))}
                  pagination={false}
                  size="small"
                  rowKey="key"
                  showHeader={false}
                  style={{ marginLeft: 32 }}
                  columns={[
                    {
                      title: "", width: 90,
                      render: (_r: any, row: any) => <Text strong style={{ fontSize: 13 }}>{row.role}</Text>,
                    },
                    {
                      title: "", width: 120,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "name"]} style={{ margin: 0 }}
                          rules={row.maleIndex === 0 ? [{ required: true, message: "必填" }] : []}>
                          <Input placeholder={row.maleIndex === 0 ? "姓名" : "姓名(选填)"} size="small" bordered={false}
                            style={{ background: "#fafafa", borderRadius: 0 }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: "", width: 100,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "ethnicity"]} style={{ margin: 0 }}>
                          <Input placeholder="民族" size="small" bordered={false}
                            style={{ background: "#fafafa", borderRadius: 0 }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: "", width: 150,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "sample_type"]} style={{ margin: 0 }}
                          initialValue={["BLOOD"]}>
                          <Select mode="multiple" options={SAMPLE_TYPE_OPTIONS}
                            size="small" bordered={false}
                            style={{ background: "#fafafa", minWidth: 110, borderRadius: 0 }}
                            placeholder="类型" maxTagCount={2} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: "", width: 140,
                      render: (_r: any, row: any) => (
                        <Form.Item {...row.field} name={[row.field.name, "arrival_date"]} style={{ margin: 0 }}
                          initialValue={dayjs()}>
                          <DatePicker size="small" bordered={false}
                            style={{ background: "#fafafa", width: "100%", borderRadius: 0 }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: "", width: 60,
                      render: (_r: any, row: any) => (
                        <Button type="link" danger size="small"
                          onClick={() => remove(row.field.name)}>删除</Button>
                      ),
                    },
                  ] as any}
                  locale={{ emptyText: "" }}
                  footer={() => (
                    <div style={{ padding: "6px 8px" }}>
                      <Button type="dashed" onClick={() => add({ sample_type: ["BLOOD"], arrival_date: dayjs() })} block
                        icon={<PlusOutlined />} size="small">
                        添加疑父
                      </Button>
                    </div>
                  )}
                />
              )}
            </Form.List>

            {/* Column headers row */}
            <div style={{ marginLeft: 32, marginBottom: 4, display: "flex", fontSize: 12, color: "#999", borderTop: "1px solid #f0f0f0", paddingTop: 4 }}>
              <span style={{ width: 90 }}>亲缘关系</span>
              <span style={{ width: 120 }}>姓名</span>
              <span style={{ width: 100 }}>民族</span>
              <span style={{ width: 150 }}>样本类型</span>
              <span style={{ width: 140 }}>采集日期</span>
              <span style={{ width: 60 }}>操作</span>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            {/* 3 基本信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</span>
              <Text strong style={{ fontSize: 15 }}>基本信息</Text>
            </div>

            <Row gutter={[16, 8]} style={{ marginLeft: 16 }}>
              <Col xs={24} sm={8}>
                <Form.Item name="sample_source" label="来源(国家)" style={{ marginBottom: 8 }}>
                  <Select options={SOURCE_OPTIONS} placeholder="选择来源" allowClear size="small" />
                </Form.Item>
                <Form.Item name="collection_date" label="申请日期" style={{ marginBottom: 8 }}>
                  <DatePicker style={{ width: "100%" }} size="small" placeholder="选择日期" />
                </Form.Item>
                <Form.Item name="clinic_name" label="诊所/医院" style={{ marginBottom: 0 }}>
                  <Input placeholder="诊所或医院名称" size="small" />
                </Form.Item>
              </Col>

              <Col xs={24} sm={8}>
                <Form.Item name="multiple_gestation" label="单双胎" style={{ marginBottom: 8 }}>
                  <Radio.Group defaultValue={false} size="small" optionType="button" buttonStyle="solid">
                    <Radio.Button value={false}>单</Radio.Button>
                    <Radio.Button value={true}>双</Radio.Button>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="phone" label="电话" style={{ marginBottom: 8 }}>
                  <Input placeholder="电话号码" size="small" />
                </Form.Item>
                <Form.Item name="last_menstrual_period" label="末次月经" style={{ marginBottom: 0 }}>
                  <DatePicker style={{ width: "100%" }} size="small" placeholder="选择日期" />
                </Form.Item>
              </Col>

              <Col xs={24} sm={8}>
                <Form.Item name="sales_person" label="销售/代理" style={{ marginBottom: 8 }}>
                  <Input placeholder="销售或代理名称" size="small" />
                </Form.Item>
                <Form.Item name="applicant" label="申请方" style={{ marginBottom: 8 }}>
                  <Input placeholder="申请人" size="small" />
                </Form.Item>
                <Form.Item name="fedex_no" label="快递单号" style={{ marginBottom: 8 }}>
                  <Input placeholder="快递单号" size="small" />
                </Form.Item>
                <Form.Item name="external_id" label="外部编号" style={{ marginBottom: 8 }}>
                  <Input placeholder="外部编号" size="small" />
                </Form.Item>
                <Form.Item name="email" label="邮箱" style={{ marginBottom: 0 }}>
                  <Input placeholder="邮箱地址" size="small" />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: "8px 0" }} />

            {/* 4 风险提示 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: "#1677ff", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>4</span>
              <Text strong style={{ fontSize: 15 }}>风险提示</Text>
              <Text type="danger" style={{ fontSize: 12 }}>*必填</Text>
            </div>

            <Row gutter={[24, 0]} style={{ marginLeft: 16 }}>
              {[
                { key: "transfusion", label: "是否接受过异体输血（一年内）" },
                { key: "transplant", label: "是否做过骨髓或器官移植（一年内）" },
                { key: "immunotherapy", label: "是否做过免疫治疗/干细胞治疗等引入外源DNA的治疗（一个月内）" },
                { key: "miscarriage", label: "是否有流产史（三个月内）" },
                { key: "reduction", label: "是否减胎" },
                { key: "surrogacy", label: "是否代孕" },
                { key: "ivf", label: "是否试管婴儿" },
                { key: "week5", label: "是否孕期已满5周" },
              ].map((q, idx) => (
                <Col key={q.key} xs={24} sm={12}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Text style={{ flex: 1, fontSize: 13 }}>{idx + 1}. {q.label}</Text>
                    <Form.Item name={["risk", q.key]} style={{ margin: 0 }} initialValue={false}>
                      <Radio.Group size="small">
                        <Radio value={false}>否</Radio>
                        <Radio value={true}>是</Radio>
                      </Radio.Group>
                    </Form.Item>
                  </div>
                </Col>
              ))}
            </Row>

            <div style={{ margin: "12px 0", padding: "8px 12px", background: "#fffbe6", borderRadius: 6, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
              <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.6 }}>
                异体输血、移植手术、异体细胞治疗等可能引入外源DNA影响检测结果；
                近期流产、减胎可能有残留DNA。以下情况不适合此检测：多胞胎(≥3)、
                孕妇患肿瘤/先兆子痫/先天免疫疾病。
              </Text>
            </div>

            <Form.Item name="notes" label="备注" style={{ marginBottom: 12 }}>
              <Input.TextArea rows={2} placeholder="内部备注" size="small" />
            </Form.Item>

            <Button type="primary" icon={<PlusOutlined />} loading={loading}
              onClick={handleSubmit} size="large" block>
              提交登记
            </Button>
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
                <Form.Item name="supp_sample_type" label="样本类型" initialValue={["BLOOD"]}>
                  <Select mode="multiple" options={SAMPLE_TYPE_OPTIONS}
                    placeholder="选择样本类型" maxTagCount={2} />
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
