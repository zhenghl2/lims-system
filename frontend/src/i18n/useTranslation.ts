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

  const t = (key: string): string => getNested(messages, key);

  return { t, locale };
}
