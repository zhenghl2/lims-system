import { create } from "zustand";
import { authApi } from "../api";
import type { User } from "../api/types";

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

interface AuthStore {
  // State
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  initialized: boolean;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateLocale: (locale: string) => Promise<void>;
  fetchUser: () => Promise<void>;
  setAccessToken: (token: string) => void;
  initialize: () => void;
}

// Derived selector — use this instead of get().isAuthenticated
export const selectIsAuthenticated = (state: AuthStore) => !!state.accessToken;

const getStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  accessToken: getStored(ACCESS_KEY),
  refreshToken: getStored(REFRESH_KEY),
  isLoading: false,
  initialized: false,

  initialize: () => {
    const existing = get().accessToken;
    if (existing) {
      get().fetchUser();
    } else {
      set({ initialized: true });
    }
  },

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.login(username, password);
      localStorage.setItem(ACCESS_KEY, data.access);
      localStorage.setItem(REFRESH_KEY, data.refresh);
      set({ accessToken: data.access, refreshToken: data.refresh, isLoading: false });
      await get().fetchUser();
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },


  updateLocale: async (locale: string) => {
    const token = get().accessToken;
    if (!token) return;
    try {
      const { default: api } = await import("../api/client");
      await api.patch("/me/locale/", { locale });
      const user = get().user;
      if (user) set({ user: { ...user, locale } });
    } catch { /* ignore */ }
  },

  logout: async () => {
    const refresh = get().refreshToken;
    if (refresh) {
      try { await authApi.logout(refresh); } catch { /* ignore */ }
    }
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },

  fetchUser: async () => {
    try {
      const { data } = await authApi.me();
      set({ user: data, initialized: true });
    } catch {
      // Token expired or invalid — clear
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      set({ user: null, accessToken: null, refreshToken: null, initialized: true });
    }
  },

  setAccessToken: (token) => {
    localStorage.setItem(ACCESS_KEY, token);
    set({ accessToken: token });
  },
}));
