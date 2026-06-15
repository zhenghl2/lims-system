import { useState, useEffect } from "react";
import { Modal, Button, Card, Row, Col, Typography, message, Input } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import api from "../api/client";

const { Text } = Typography;

interface Props {
  open: boolean;
  role: "operator" | "reviewer";
  roleLabel: string;
  batchId: string;
  currentSigner: string | null;
  signUrl?: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function NiptSignerModal({ open, role, roleLabel, batchId, currentSigner, signUrl, onDone, onCancel }: Props) {
  const [signers, setSigners] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setPassword("");
      api.get("/plasma-separation/signers/")
        .then(r => setSigners(r.data))
        .catch(() => message.error("Failed to load signers"));
    }
  }, [open]);

  const confirm = async () => {
    if (!selected) { message.warning("请选择签名人"); return; }
    if (!password) { message.warning("请输入密码"); return; }
    setLoading(true);
    try {
      const url = signUrl || `/plasma-separation/${batchId}/sign/`;
      await api.post(url, {
        role,
        signer: selected,
        password,
      });
      message.success(`${roleLabel}签名完成`);
      onDone();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "签名失败");
    } finally {
      setLoading(false);
    }
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
      width={600}
    >
      <Row gutter={[12, 12]}>
        {signers.map(name => (
          <Col span={8} key={name}>
            <Card
              hoverable
              size="small"
              onClick={() => setSelected(name)}
              style={{
                border: selected === name ? "2px solid #1890ff" : "1px solid #d9d9d9",
                textAlign: "center",
                cursor: "pointer",
                background: selected === name ? "#e6f7ff" : "#fff",
              }}
              bodyStyle={{ padding: "12px 8px" }}
            >
              <div style={{ fontSize: 28, marginBottom: 4 }}>👤</div>
              <div>
                <Text strong style={{ fontSize: 14 }}>{name}</Text>
                {selected === name && <CheckOutlined style={{ color: "#1890ff", marginLeft: 4 }} />}
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
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Text type="secondary">当前{roleLabel}: {currentSigner}</Text>
        </div>
      )}
    </Modal>
  );
}
