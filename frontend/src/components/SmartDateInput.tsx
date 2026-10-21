// SmartDateInput.tsx — 可打字识别的日期输入（2026-10-21）
// 目的：NIPPT 登记页出生日期，老年客户不方便点日历；支持直接输入：
//   14.01.2005 / 14/01/2005 / 14-01-2005 / 2005-01-14 / 27 Feb 1997 / 27 February 1997
//   14 de janeiro de 2005（葡语）/ 14 janvier 2005（法语，可选）
// 右侧日历图标仍可打开 antd 日期选择器；识别失败给红框 + 提示，不写脏值。
import { useEffect, useRef, useState } from "react";
import { DatePicker, Input, Tooltip } from "antd";
import { CalendarOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";

const MONTH_ALIASES: Record<string, number> = {
  jan: 1, january: 1, janeiro: 1, janvier: 1, enero: 1,
  feb: 2, february: 2, fevereiro: 2, fevrier: 2, février: 2, febrero: 2,
  mar: 3, march: 3, marco: 3, março: 3, mars: 3, marzo: 3,
  apr: 4, april: 4, abril: 4, avril: 4,
  may: 5, maio: 5, mai: 5, mayo: 5,
  jun: 6, june: 6, junho: 6, juin: 6, junio: 6,
  jul: 7, july: 7, julho: 7, juillet: 7, julio: 7,
  aug: 8, august: 8, agosto: 8, aout: 8, août: 8,
  sep: 9, sept: 9, september: 9, setembro: 9, septembre: 9, septiembre: 9,
  oct: 10, october: 10, outubro: 10, octobre: 10, octubre: 10,
  nov: 11, november: 11, novembro: 11, novembre: 11, noviembre: 11,
  dec: 12, december: 12, dezembro: 12, decembre: 12, décembre: 12, diciembre: 12,
};

function build(y: number, m: number, d: number): Dayjs | null {
  if (!y || !m || !d) return null;
  if (y < 1900 || y > dayjs().year()) return null;
  const dt = dayjs(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  if (!dt.isValid()) return null;
  if (dt.year() !== y || dt.month() + 1 !== m || dt.date() !== d) return null;   // 2 月 30 日之类
  if (dt.isAfter(dayjs(), "day")) return null;
  return dt;
}

/** 把用户输入解析成日期；无法识别返回 null */
export function parseDateText(raw: string): Dayjs | null {
  const s = (raw || "").trim().replace(/\s+/g, " ");
  if (!s) return null;

  // ① 纯数字：14.01.2005 / 14/01/2005 / 14-01-2005 / 14 01 2005
  let m = s.match(/^(\d{1,2})[.\/\-\s](\d{1,2})[.\/\-\s](\d{4})$/);
  if (m) return build(+m[3], +m[2], +m[1]);

  // ② 年在前：2005-01-14 / 2005.01.14 / 2005/01/14
  m = s.match(/^(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);

  // ③ 中文：2005年1月14日
  m = s.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (m) return build(+m[1], +m[2], +m[3]);

  // ④ 带月份名：27 Feb 1997 / 27 de fevereiro de 1997 / 14 janvier 2005
  m = s.match(/^(\d{1,2})\s*(?:de\s+)?([A-Za-zÀ-ÿ.]+)\s*(?:de\s+)?(\d{4})$/i);
  if (m) {
    const key = m[2].toLowerCase().replace(/\./g, "");
    const mon = MONTH_ALIASES[key] || MONTH_ALIASES[key.slice(0, 4)] || MONTH_ALIASES[key.slice(0, 3)];
    if (mon) return build(+m[3], mon, +m[1]);
  }

  // ⑤ 紧排数字：14012005 / 140105
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return build(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return build(2000 + +m[3] > dayjs().year() ? 1900 + +m[3] : 2000 + +m[3], +m[2], +m[1]);

  return null;
}

type Props = {
  value?: Dayjs | null;
  onChange?: (v: Dayjs | null) => void;
  placeholder?: string;
  size?: "small" | "middle";
  bordered?: boolean;
  style?: React.CSSProperties;
};

export default function SmartDateInput({ value, onChange, placeholder = "如 14.01.2005 或 27 Feb 1997", size = "small", bordered = false, style }: Props) {
  const [text, setText] = useState(value ? value.format("YYYY-MM-DD") : "");
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const lastValueRef = useRef<string>(value ? value.format("YYYY-MM-DD") : "");

  // 外部（日历选择）改变值时同步显示
  useEffect(() => {
    const next = value ? value.format("YYYY-MM-DD") : "";
    if (next !== lastValueRef.current) {
      lastValueRef.current = next;
      setText(next);
      setBad(false);
    }
  }, [value]);

  const commit = (raw: string) => {
    const t = (raw || "").trim();
    if (!t) { setBad(false); lastValueRef.current = ""; onChange?.(null); return; }
    const dt = parseDateText(t);
    if (dt) {
      setBad(false);
      lastValueRef.current = dt.format("YYYY-MM-DD");
      setText(dt.format("YYYY-MM-DD"));
      onChange?.(dt);
    } else {
      setBad(true);
    }
  };

  return (
    <div style={{ position: "relative", ...style }}>
      <Tooltip title={bad ? "无法识别，试试 14.01.2005 / 14/01/2005 / 27 Feb 1997" : "可直接输入日期，或点右侧日历选择"}>
        <Input
          size={size}
          bordered={bordered}
          status={bad ? "error" : undefined}
          value={text}
          placeholder={placeholder}
          style={{ background: "#fafafa", borderRadius: 0, paddingRight: 24 }}
          onChange={(e) => { setText(e.target.value); if (bad) setBad(false); }}
          onBlur={(e) => commit(e.target.value)}
          onPressEnter={(e: any) => commit(e.currentTarget.value)}
        />
      </Tooltip>
      <CalendarOutlined
        onClick={() => setOpen(true)}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "#999", cursor: "pointer", fontSize: 12 }}
      />
      <DatePicker
        open={open}
        value={value || null}
        onChange={(d) => { setOpen(false); onChange?.(d || null); }}
        onOpenChange={(o) => setOpen(o)}
        style={{ position: "absolute", left: 0, top: 24, width: 1, height: 1, padding: 0, border: 0, opacity: 0, pointerEvents: "none" }}
        popupClassName="smart-date-popup"
        getPopupContainer={(trigger) => trigger.parentElement || document.body}
      />
    </div>
  );
}
