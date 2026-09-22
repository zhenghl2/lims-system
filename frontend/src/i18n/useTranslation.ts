import { useMemo } from "react";
import { useAuthStore } from "../store/auth";
import en from "../i18n/en.json";
import zh from "../i18n/zh.json";
import pt from "../i18n/pt.json";

type Translations = typeof en;

const LOCALE_MAP: Record<string, Translations> = { en, zh, pt };

function getNested(obj: Record<string, unknown>, path: string): string {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return path; // fallback: return the key path itself
  }, obj) as string || path;
}

export function useTranslation() {
  const locale = useAuthStore((s) => s.user?.locale || "en");
  const messages = useMemo(() => LOCALE_MAP[locale] || en, [locale]);

  // 支持可选的插值参数：t("a.b", { n: 3 }) 会把文案里的 {n} 替换为 3。
  // 不传 vars 时行为与以前完全一致（向后兼容）。
  const t = (key: string, vars?: Record<string, string | number>): string => {
    const raw = getNested(messages, key);
    if (!vars || typeof raw !== "string") return raw;
    let out = raw;
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v));
    }
    return out;
  };

  return { t, locale };
}
