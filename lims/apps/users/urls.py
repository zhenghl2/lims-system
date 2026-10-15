"""Authentication URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from . import manage_role_views as role_mgmt
from . import manage_views as user_mgmt

from .views import (
    LoginView, LogoutView, MFASetupView, MFAVerifyView, ChangePasswordView,
    RequestPasswordResetView, MeView, UserViewSet, UpdateLocaleView,
)

app_name = "auth"

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("mfa/setup/", MFASetupView.as_view(), name="mfa_setup"),
    path("mfa/verify/", MFAVerifyView.as_view(), name="mfa_verify"),
    path("change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("request-password-reset/", RequestPasswordResetView.as_view(), name="request_password_reset"),
    path("me/locale/", UpdateLocaleView.as_view(), name="update_locale"),
    path("me/", MeView.as_view(), name="me"),
    # ── 用户管理模块（阶段2：账号管理）────────────────────────
    path("user-management/users/", user_mgmt.user_manage_list, name="um-user-list"),
    path("user-management/users/stats/", user_mgmt.user_manage_stats, name="um-user-stats"),
    path("user-management/users/<uuid:pk>/", user_mgmt.user_manage_detail, name="um-user-detail"),
    path("user-management/users/<uuid:pk>/toggle-active/", user_mgmt.user_manage_toggle_active, name="um-user-toggle"),
    path("user-management/users/<uuid:pk>/reset-password/", user_mgmt.user_manage_reset_password, name="um-user-reset-pwd"),
    path("user-management/users/<uuid:pk>/unlock-mfa/", user_mgmt.user_manage_unlock_mfa, name="um-user-unlock-mfa"),
    # ── 用户管理模块（阶段3：角色权限）─────────────────────
    path("user-management/roles/modules/", role_mgmt.role_module_catalog, name="um-role-modules"),
    path("user-management/roles/", role_mgmt.role_list, name="um-role-list"),
    path("user-management/roles/<uuid:pk>/", role_mgmt.role_detail, name="um-role-detail"),
    path("user-management/roles/<uuid:pk>/users/", role_mgmt.role_users, name="um-role-users"),
    path("user-management/users/<uuid:pk>/roles/", role_mgmt.user_roles, name="um-user-roles"),
    path("user-management/users/<uuid:pk>/roles/<uuid:assignment_id>/", role_mgmt.user_role_remove, name="um-user-role-remove"),
    path("user-management/my-permissions/", role_mgmt.my_permissions, name="um-my-perms"),
    path("", include(router.urls)),
]
