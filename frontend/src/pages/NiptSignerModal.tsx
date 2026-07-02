import { useState, useEffect } from "react";
import { Modal, Button, Card, Row, Col, Typography, message, Input } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import api from "../api/client";
import { useTranslation } from "../i18n/useTranslation";

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
  const { t } = useTranslation();
  const [signers, setSigners] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSingle, setSelectedSingle] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const isMulti = true;

  useEffect(() => {
    if (open) {
      setSelected([]);
      setSelectedSingle(null);
      setPassword("");
      setPasswords({});
      api.get("/plasma-separation/signers/")
        .then(r => setSigners(r.data))
        .catch(() => message.error(t("nipt.signer.failedLoad")));
    }
  }, [open]);

  const toggleSigner = (name: string) => {
    if (!isMulti) {
      setSelectedSingle(name);
      return;
    }
    setSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const updatePassword = (name: string, pwd: string) => {
    setPasswords(prev => ({ ...prev, [name]: pwd }));
  };

  const confirm = async () => {
    if (isMulti) {
      if (selected.length === 0) { message.warning(t("nipt.signer.selectSignerWarning")); return; }
      // Validate all passwords filled
      for (const name of selected) {
        if (!passwords[name]?.trim()) {
          message.warning(`${name} ${t("nipt.signer.passwordRequired")}`);
          return;
        }
      }
    } else {
      if (!selectedSingle) { message.warning(t("nipt.signer.selectSignerWarning")); return; }
      if (!password) { message.warning(t("nipt.signer.passwordRequired")); return; }
    }

    setLoading(true);
    try {
      const url = signUrl || `/plasma-separation/${batchId}/sign/`;
      const payload: any = { role };
      if (isMulti) {
        payload.signers = selected;
        payload.passwords = passwords;
      } else {
        payload.signer = selectedSingle;
        payload.password = password;
      }
      await api.post(url, payload);
      message.success(`${roleLabel}${t("nipt.signer.signComplete").replace("{role}", "")}`);
      onDone();
    } catch (e: any) {
      message.error(e?.response?.data?.error || t("nipt.signer.signFailed"));
    } finally {
      setLoading(false);
    }
  };

  const isSelected = (name: string) => isMulti ? selected.includes(name) : selectedSingle === name;

  return (
    <Modal
      title={`${t("nipt.signer.select")}${roleLabel}`}
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>{t("nipt.signer.cancel")}</Button>,
        <Button key="confirm" type="primary" loading={loading} onClick={confirm}
          disabled={isMulti ? selected.length === 0 : !selectedSingle}>
          {t("nipt.signer.confirm")}
        </Button>,
      ]}
      width={650}
    >
      <Row gutter={[12, 12]}>
        {signers.map(name => (
          <Col span={8} key={name}>
            <Card
              hoverable
              size="small"
              onClick={() => toggleSigner(name)}
              style={{
                border: isSelected(name) ? "2px solid #1890ff" : "1px solid #d9d9d9",
                textAlign: "center",
                cursor: "pointer",
                background: isSelected(name) ? "#e6f7ff" : "#fff",
              }}
              bodyStyle={{ padding: "12px 8px" }}
            >
              <div style={{ fontSize: 28, marginBottom: 4 }}>👤</div>
              <div>
                <Text strong style={{ fontSize: 14 }}>{name}</Text>
                {isSelected(name) && <CheckOutlined style={{ color: "#1890ff", marginLeft: 4 }} />}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Password fields */}
      {isMulti ? (
        <div style={{ marginTop: 16 }}>
          {selected.map(name => (
            <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, gap: 8 }}>
              <Text strong style={{ minWidth: 60, textAlign: "right" }}>{name}</Text>
              <Input.Password
                placeholder={t("nipt.signer.enterPassword")}
                value={passwords[name] || ""}
                onChange={e => updatePassword(name, e.target.value)}
                style={{ maxWidth: 180 }}
                onPressEnter={confirm}
              />
            </div>
          ))}
          {selected.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <Text type="secondary">{t("nipt.signer.selectSignerWarning")}</Text>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Input.Password
            placeholder={t("nipt.signer.enterPassword")}
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ maxWidth: 200 }}
            onPressEnter={confirm}
          />
        </div>
      )}

      {currentSigner && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Text type="secondary">{t("nipt.signer.currentSigner").replace("{role}", roleLabel).replace("{name}", currentSigner || "")}</Text>
        </div>
      )}
    </Modal>
  );
}
