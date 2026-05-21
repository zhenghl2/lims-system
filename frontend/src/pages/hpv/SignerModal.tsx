import { useState, useEffect } from "react";
import { Modal, Button, Card, Row, Col, Typography, message, Input } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import api from "../../api/client";

const { Text } = Typography;

interface Signer {
  name: string;
  image: string;
}

const SIGNERS: Signer[] = [
  { name: "陈菊玲", image: "/signatures/陈菊玲.png" },
  { name: "李彩娟", image: "/signatures/李彩娟.png" },
  { name: "杨思婷", image: "/signatures/杨思婷.jpg" },
];

interface Props {
  open: boolean;
  role: "operator" | "reviewer";
  roleLabel: string;
  batchId: string;
  stage: string;
  currentSigner: string | null;
  onDone: () => void;
  onCancel: () => void;
}

export default function SignerModal({ open, role, roleLabel, batchId, stage, currentSigner, onDone, onCancel }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setSelected(null); setPassword(""); }, [open]);

  const confirm = async () => {
    if (!selected) { message.warning("请选择签名人"); return; }
    if (!password) { message.warning("请输入密码"); return; }
    setLoading(true);
    try {
      await api.post(`/hpv/batches/${batchId}/sign/`, { stage, role, signer: selected, password });
      message.success(`${roleLabel}签名完成`);
      onDone();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "签名失败");
    } finally { setLoading(false); }
  };

  return (
    <Modal
      title={`选择${roleLabel}`}
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button key="confirm" type="primary" loading={loading} onClick={confirm} disabled={!selected}>
          确认签名
        </Button>,
      ]}
      width={560}
    >
      <Row gutter={[16, 16]}>
        {SIGNERS.map(s => (
          <Col span={8} key={s.name}>
            <Card
              hoverable
              size="small"
              onClick={() => setSelected(s.name)}
              style={{
                border: selected === s.name ? "2px solid #1890ff" : "1px solid #d9d9d9",
                textAlign: "center",
                cursor: "pointer",
              }}
              bodyStyle={{ padding: 8 }}
            >
              <img
                src={s.image}
                alt={s.name}
                style={{ width: "100%", height: 80, objectFit: "contain", marginBottom: 4 }}
              />
              <div>
                <Text strong style={{ fontSize: 13 }}>{s.name}</Text>
                {selected === s.name && <CheckOutlined style={{ color: "#1890ff", marginLeft: 4 }} />}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Input.Password
          placeholder="请输入签名密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ maxWidth: 200 }}
          onPressEnter={confirm}
        />
      </div>
      {currentSigner && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Text type="secondary">当前{roleLabel}: {currentSigner}</Text>
        </div>
      )}
    </Modal>
  );
}
