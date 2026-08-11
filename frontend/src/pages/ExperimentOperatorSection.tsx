import { useState } from "react";
import { Card, Select, Button, Space, Typography } from "antd";

const { Text } = Typography;

export const RECEIPT_PERSONS = [
  "吴书凌", "叶丽婷", "何家宇", "胡煜敏", "付慧珠", "杜兴琼",
  "龙雨青", "张斯栋", "郭爽洁", "林琦",
];

interface Props {
  operator?: string;
  reviewer?: string;
  onSave: (data: { operator: string; reviewer: string }) => Promise<void>;
  disabled?: boolean;
}

export default function ExperimentOperatorSection({
  operator: initialOp = "",
  reviewer: initialRv = "",
  onSave,
  disabled = false,
}: Props) {
  const [operator, setOperator] = useState(initialOp);
  const [reviewer, setReviewer] = useState(initialRv);
  const [saving, setSaving] = useState(false);

  return (
    <Card size="small" title="操作记录" style={{ marginTop: 12 }}>
      <Space wrap size={12}>
        <span>
          <Text type="secondary">操作人: </Text>
          <Select size="small" placeholder="选择" style={{ width: 100 }}
            value={operator || undefined}
            onChange={setOperator}
            disabled={disabled} allowClear>
            {RECEIPT_PERSONS.map(p => (
              <Select.Option key={p} value={p}>{p}</Select.Option>
            ))}
          </Select>
        </span>
        <span>
          <Text type="secondary">审核人: </Text>
          <Select size="small" placeholder="选择" style={{ width: 100 }}
            value={reviewer || undefined}
            onChange={setReviewer}
            disabled={disabled} allowClear>
            {RECEIPT_PERSONS.map(p => (
              <Select.Option key={p} value={p}>{p}</Select.Option>
            ))}
          </Select>
        </span>

        {!disabled && (
          <Button type="primary" size="small" loading={saving}
            onClick={async () => {
              setSaving(true);
              try { await onSave({ operator, reviewer }); }
              finally { setSaving(false); }
            }}>保存</Button>
        )}
      </Space>
    </Card>
  );
}
