"""用户管理模块 — 销售申请的后台兜底视图（只读）。

管理员日常走 React 前端；此处提供 Django admin 只读入口，
便于后端异常时直接查库判断。
"""
from django.contrib import admin

from .models import SalesApplication, WechatUser


@admin.register(SalesApplication)
class SalesApplicationAdmin(admin.ModelAdmin):
    list_display = [
        "code", "real_name", "phone", "status",
        "site", "reviewer_name", "reviewed_at", "created_at",
    ]
    list_filter = ["status", "site", "created_at"]
    search_fields = ["code", "real_name", "phone", "openid"]
    readonly_fields = [
        "id", "code", "openid", "unionid", "real_name", "phone", "status",
        "site", "reviewer", "reviewer_name", "reviewed_at", "reject_reason",
        "created_user", "initial_password_shown_at", "remark",
        "created_at", "updated_at",
    ]
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        # 只读：审核动作必须走前端 API（带审计）
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(WechatUser)
class WechatUserAdmin(admin.ModelAdmin):
    list_display = ["id", "openid", "nickname", "user", "created_at"]
    search_fields = ["openid", "nickname", "user__username", "user__first_name"]
    readonly_fields = ["id", "user", "openid", "unionid", "nickname", "avatar_url", "created_at"]
    ordering = ["-id"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
