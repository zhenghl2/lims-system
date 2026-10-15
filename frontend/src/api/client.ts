import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

// Request interceptor — attach JWT access token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // For FormData, remove Content-Type so browser sets multipart boundary
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

// ── 单飞刷新：并发 401 只触发一次 /refresh/，其余请求等它完成后用新 token 重试 ──
// 背景：后端 access 15 分钟过期 + ROTATE_REFRESH_TOKENS（刷新后旧 refresh 立即作废）。
// 若并发请求各自去刷新，只有一个成功，其余 401 → 旧实现会清 token 跳登录（2026-10-13 香港故障）。
let refreshPromise: Promise<string> | null = null;

const doRefresh = (): Promise<string> => {
  if (!refreshPromise) {
    const refresh = localStorage.getItem("refresh_token");
    if (!refresh) return Promise.reject(new Error("no refresh token"));
    refreshPromise = axios
      .post("/api/v1/refresh/", { refresh })
      .then(({ data }) => {
        localStorage.setItem("access_token", data.access);
        if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
        return data.access as string;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

const forceLogout = () => {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  if (window.location.pathname !== "/login") window.location.href = "/login";
};

// Response interceptor — handle 401 with token refresh
api.interceptors.response.use(
  (resp) => resp,
  async (error) => {
    const originalRequest = error.config || {};
    const status = error.response?.status;

    // 401：先尝试（共享的）刷新，再重试一次
    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const access = await doRefresh();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${access}`;
        return api(originalRequest);
      } catch {
        forceLogout();          // 只有刷新真的失败才登出
        return Promise.reject(error);
      }
    }

    // 403：无 refresh 可用/权限不足 → 登出（保持原有行为）
    if (status === 403) {
      forceLogout();
    }
    return Promise.reject(error);
  }
);

export default api;
