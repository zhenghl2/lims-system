import { StrictMode, Component } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import App from "./App";

/**
 * 部署新版本后，旧页面里还没加载的 chunk 会因为文件名 hash 变了而 404，
 * 表现就是「点进某个模块白屏，刷新一下才好」。
 * 这里统一兜住：Vite 抛 vite:preloadError 或动态 import 失败时，自动刷新一次
 * （10 秒内只刷一次，避免死循环）。
 */
const RELOAD_KEY = "chunk_reload_at";
function reloadOnceForChunkError() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 10_000) return;      // 刚刷过还失败 → 不再刷，交给 ErrorBoundary 显示提示
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage 不可用时直接刷 */
  }
  window.location.reload();
}

window.addEventListener("vite:preloadError", (e: any) => {
  e?.preventDefault?.();
  reloadOnceForChunkError();
});

window.addEventListener("unhandledrejection", (e: any) => {
  const msg = String(e?.reason?.message || e?.reason || "");
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)) {
    reloadOnceForChunkError();
  }
});

/** 兜底：渲染异常时不要白屏，给一句明确提示 + 刷新按钮 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 48, fontFamily: "system-ui, -apple-system, sans-serif", color: "#333" }}>
        <h3 style={{ marginBottom: 8 }}>页面加载失败</h3>
        <p style={{ color: "#666", marginBottom: 16, fontSize: 13 }}>
          可能是系统刚更新过。请点下面按钮刷新；若反复出现，请把这段信息发给管理员：
          <code style={{ display: "block", marginTop: 8, padding: 8, background: "#f5f5f5", fontSize: 12 }}>
            {String(this.state.error?.message || this.state.error).slice(0, 300)}
          </code>
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: "6px 16px", border: "1px solid #1677ff", background: "#1677ff", color: "#fff", borderRadius: 6, cursor: "pointer" }}
        >
          刷新页面
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
