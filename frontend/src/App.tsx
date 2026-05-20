import { BrowserRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, theme, Tabs } from "antd";
import { useEffect, lazy, Suspense, useMemo } from "react";
import { useAuthStore } from "./store/auth";
import AppRouter from "./pages/AppRouter";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";

const NipptRouter = lazy(() => import("./pages/NipptRouter"));
const HpvRouter = lazy(() => import("./pages/HpvRouter"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  },
});

const LOCALES: Record<string, typeof enUS> = {
  en: enUS,
  zh: zhCN,
};

// Map panel codes to tab keys
const PANEL_TO_TAB: Record<string, string> = {
  NIPT: "nipt",
  NIPT_PLUS: "nipt",
  NIPPT: "nippt",
  HPV: "hpv",
};

const TAB_LABELS: Record<string, string> = {
  nipt: "NIPT",
  nippt: "NIPPT",
  hpv: "HPV",
};

const TAB_REDIRECTS: Record<string, string> = {
  nipt: "/",
  nippt: "/nippt/dashboard",
  hpv: "/hpv/dashboard",
};

function AppContent() {
  const location = useLocation();
  const user = useAuthStore(s => s.user);
  const initialized = useAuthStore(s => s.initialized);

  // Compute available tabs based on allowed_panels
  const availableTabs = useMemo(() => {
    if (!user || !initialized) return ["nipt", "nippt", "hpv"]; // loading: show all
    const panels = user.allowed_panels;
    if (!panels || panels.length === 0) return ["nipt", "nippt", "hpv"]; // empty = all
    const tabs = new Set<string>();
    for (const code of panels) {
      const tab = PANEL_TO_TAB[code];
      if (tab) tabs.add(tab);
    }
    const result = Array.from(tabs);
    return result.length > 0 ? result : ["nipt"]; // fallback
  }, [user, initialized]);

  const isNippt = location.pathname.startsWith("/nippt");
  const isHpv = location.pathname.startsWith("/hpv");

  // Determine active tab from URL or first available
  const urlTab = isHpv ? "hpv" : isNippt ? "nippt" : "nipt";
  const activeTab = availableTabs.includes(urlTab) ? urlTab : availableTabs[0];

  const handleTabChange = (key: string) => {
    const redirect = TAB_REDIRECTS[key] || "/";
    window.location.href = redirect;
  };

  const tabItems = availableTabs.map(key => ({
    key,
    label: TAB_LABELS[key] || key.toUpperCase(),
  }));

  // If current URL's tab is not available, redirect to first available
  useEffect(() => {
    if (initialized && !availableTabs.includes(urlTab)) {
      window.location.href = TAB_REDIRECTS[availableTabs[0]] || "/";
    }
  }, [initialized, availableTabs, urlTab]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        tabBarStyle={{ margin: 0, paddingLeft: 24, background: "#fff", borderBottom: "1px solid #f0f0f0" }}
        items={tabItems}
      />
      <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 100 }}>Loading...</div>}>
        {isHpv ? <HpvRouter /> : isNippt ? <NipptRouter /> : <AppRouter />}
      </Suspense>
    </div>
  );
}

export default function App() {
  const { initialize, user } = useAuthStore();
  useEffect(() => { initialize(); }, [initialize]);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0066ff",
          borderRadius: 6,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        },
      }}
      locale={user ? LOCALES[user.locale] || LOCALES.en : LOCALES.en}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
