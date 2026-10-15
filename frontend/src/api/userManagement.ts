import api from "./client";

// ── 用户管理模块 API ─────────────────────────────────────────
// 阶段1：账号审批（wechat/sales-applications）
// 阶段2：账号管理（users/user-management）
// 阶段3：角色权限（待实现）

export type SalesApplicationStatus = "pending" | "approved" | "rejected";

export interface SalesApplication {
  id: string;
  code: string;
  real_name: string;
  phone: string;
  status: SalesApplicationStatus;
  status_display: string;
  site_id: string;
  site_code: string;
  reviewer_name: string;
  reviewed_at: string | null;
  reject_reason: string;
  created_user_id: string | null;
  remark: string;
  // 姓名与已有账号同名时（方案A：供审核时决定"关联"还是"新建"）
  matched_user_id: string | null;
  matched_user_name: string | null;
  matched_user_username: string | null;
  matched_user_employee_id: string | null;
  matched_user_has_wechat: boolean;
  matched_note: string;
  created_at: string;
  updated_at: string;
}

export interface SalesApplicationStats {
  pending: number;
  approved: number;
  rejected: number;
  all: number;
}

export interface ApproveResult {
  status: string;
  /** linked = 关联到已有账号（不新建）；created = 新建账号 */
  mode?: "linked" | "created";
  code: string;
  username: string;
  employee_id: string;
  /** 仅在新建模式下返回（一次性明文） */
  password?: string;
  password_notice?: string;
  message?: string;
  site: { id: string; code: string };
  reviewed_at: string;
}

export interface RejectResult {
  status: string;
  code: string;
  reject_reason: string;
  resubmit_available_at: string;
  message: string;
}

export interface Paged<T> {
  count: number;
  page: number;
  results: T[];
}

// ── 账号管理 ────────────────────────────────────────────────

export interface RoleAssignment {
  assignment_id: string;
  name: string;
  site: string | null;
  expires_at: string | null;
}

export interface UserSource {
  type: "sales_wechat" | "sales" | "manual";
  label: string;
  application_code: string | null;
}

export interface ManagedUser {
  id: string;
  employee_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  site_id: string | null;
  site_code: string | null;
  roles: RoleAssignment[];
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  mfa_enabled: boolean;
  last_login: string | null;
  created_at: string;
  source: UserSource;
}

export interface UserManageStats {
  total: number;
  active: number;
  inactive: number;
  staff: number;
  roles: { name: string; count: number }[];
  sites: { id: string; code: string }[];
}

export interface ResetPasswordResult {
  username: string;
  employee_id: string;
  password: string;
  password_notice: string;
}


// ── 角色权限（阶段3）────────────────────────────────────────

export interface RoleModulePerm {
  view: boolean;
  edit: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  site_id: string | null;
  site_code: string | null;
  permissions: Record<string, RoleModulePerm>;
  module_summary: string;
  user_count: number;
  created_at: string;
}

export interface RoleListResult {
  count: number;
  results: Role[];
  admin_note: string;
}

export interface ModuleDef {
  key: string;
  label: string;
  group: string;
}

export interface ActionDef {
  key: string;
  label: string;
}

export interface RoleTemplate {
  label: string;
  description: string;
  permissions: Record<string, RoleModulePerm>;
}

export interface ModuleCatalog {
  modules: ModuleDef[];
  actions: ActionDef[];
  module_keys: string[];
  templates: Record<string, RoleTemplate>;
}

export interface UserRoleAssignment {
  assignment_id: string;
  role_id: string;
  role_name: string;
  role_is_system: boolean;
  permissions: Record<string, RoleModulePerm>;
  site: string | null;
  granted_at: string;
  granted_by: string | null;
  expires_at: string | null;
  is_expired: boolean;
}

export interface MyPermissions {
  is_superuser: boolean;
  permissions: Record<string, RoleModulePerm>;
  source: string;
  role_count?: number;
  note?: string;
}

export const userManagementApi = {
  // ① 账号审批
  applications: {
    list: (params?: Record<string, unknown>) =>
      api.get<Paged<SalesApplication>>("/wechat/sales-applications/", { params }),
    stats: () =>
      api.get<SalesApplicationStats>("/wechat/sales-applications/stats/"),
    detail: (id: string) =>
      api.get<SalesApplication>(`/wechat/sales-applications/${id}/`),
    /** 审核通过。linkToMatched=true 时关联到同名的已有账号（不新建，不产生新密码） */
    approve: (id: string, linkToMatched = false) =>
      api.post<ApproveResult>(`/wechat/sales-applications/${id}/approve/`, {
        link_to_matched: linkToMatched,
      }),
    reject: (id: string, reason: string) =>
      api.post<RejectResult>(`/wechat/sales-applications/${id}/reject/`, { reason }),
  },

  // ② 账号管理
  accounts: {
    list: (params?: Record<string, unknown>) =>
      api.get<Paged<ManagedUser>>("/user-management/users/", { params }),
    stats: () => api.get<UserManageStats>("/user-management/users/stats/"),
    detail: (id: string) => api.get<ManagedUser>(`/user-management/users/${id}/`),
    update: (id: string, data: Record<string, unknown>) =>
      api.patch<{ status: string; changed_fields: string[]; user: ManagedUser }>(
        `/user-management/users/${id}/`, data),
    toggleActive: (id: string) =>
      api.post<{ status: string; is_active: boolean; message: string }>(
        `/user-management/users/${id}/toggle-active/`),
    resetPassword: (id: string) =>
      api.post<ResetPasswordResult>(`/user-management/users/${id}/reset-password/`),
    unlockMfa: (id: string) =>
      api.post<{ status: string; message: string }>(
        `/user-management/users/${id}/unlock-mfa/`),
  },

  // ③ 角色权限
  roles: {
    catalog: () => api.get<ModuleCatalog>("/user-management/roles/modules/"),
    list: () => api.get<RoleListResult>("/user-management/roles/"),
    create: (data: Record<string, unknown>) =>
      api.post<Role>("/user-management/roles/", data),
    detail: (id: string) => api.get<Role>(`/user-management/roles/${id}/`),
    update: (id: string, data: Record<string, unknown>) =>
      api.patch<Role>(`/user-management/roles/${id}/`, data),
    remove: (id: string) =>
      api.delete<{ status: string; name: string }>(`/user-management/roles/${id}/`),
    users: (id: string) =>
      api.get<{ role: unknown; count: number; results: unknown[] }>(
        `/user-management/roles/${id}/users/`),
  },

  // 用户 ↔ 角色
  userRoles: {
    list: (userId: string) =>
      api.get<{ results: UserRoleAssignment[]; is_superuser: boolean; note: string }>(
        `/user-management/users/${userId}/roles/`),
    assign: (userId: string, roleId: string, expiresAt?: string | null) =>
      api.post<{ status: string; assignment_id: string; role_name: string; message: string }>(
        `/user-management/users/${userId}/roles/`,
        { role_id: roleId, expires_at: expiresAt ?? null }),
    remove: (userId: string, assignmentId: string) =>
      api.delete<{ status: string; role_name: string }>(
        `/user-management/users/${userId}/roles/${assignmentId}/`),
  },

  // 我的权限（前端菜单控制）
  myPermissions: () => api.get<MyPermissions>("/user-management/my-permissions/"),
};

export default userManagementApi;
