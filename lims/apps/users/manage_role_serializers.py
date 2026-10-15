"""用户管理模块 — 角色权限序列化器（阶段3）。"""
from rest_framework import serializers

from .role_modules import ACTIONS, MODULES, MODULE_KEYS, normalize_permissions

from .models import Role


class RoleSerializer(serializers.ModelSerializer):
    site_code = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    permissions = serializers.JSONField(required=False)
    module_summary = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id", "name", "description", "is_system",
            "site_id", "site_code",
            "permissions", "module_summary", "user_count", "created_at",
        ]
        read_only_fields = ["id", "is_system", "created_at", "user_count", "module_summary", "site_code"]

    def get_site_code(self, obj):
        return obj.site.code if obj.site_id else None

    def get_user_count(self, obj):
        return obj.userrole_set.count() if hasattr(obj, "userrole_set") else \
            obj.user_roles.count() if hasattr(obj, "user_roles") else 0

    def get_module_summary(self, obj):
        """人类可读的权限摘要，如 '案例管理(查看) · 案例登记(查看/编辑)'"""
        perms = obj.permissions or {}
        labels = dict((k, name) for k, name, _group in MODULES)
        out = []
        for key, val in perms.items():
            if key not in labels:
                continue
            acts = []
            if val.get("view"):
                acts.append("查看")
            if val.get("edit"):
                acts.append("编辑")
            if acts:
                out.append(f"{labels[key]}({'/'.join(acts)})")
        return " · ".join(out) if out else "未授权任何模块"

    def validate_name(self, value):
        v = (value or "").strip()
        if not v:
            raise serializers.ValidationError("角色名不能为空")
        if v == "admin":
            raise serializers.ValidationError("admin 为保留名称，请换一个")
        qs = Role.objects.filter(name=v)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"角色名「{v}」已存在")
        return v

    def validate_permissions(self, value):
        return normalize_permissions(value or {})

    def validate(self, attrs):
        # 系统内置角色不允许改名（它们被代码/流程引用）
        if self.instance is not None and self.instance.is_system and "name" in attrs:
            attrs.pop("name")
        return attrs


class RoleBriefSerializer(serializers.ModelSerializer):
    """分配角色时用的精简结构。"""

    class Meta:
        model = Role
        fields = ["id", "name", "description", "is_system", "site_id"]


class AssignRoleSerializer(serializers.Serializer):
    """给用户分配角色。"""

    role_id = serializers.UUIDField()
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_expires_at(self, value):
        if value is not None:
            from django.utils import timezone
            if value <= timezone.now():
                raise serializers.ValidationError("有效期必须晚于当前时间")
        return value


class ModuleCatalogSerializer(serializers.Serializer):
    """模块清单（供前端渲染权限矩阵）。"""

    modules = serializers.ListField()
    actions = serializers.ListField()
    templates = serializers.DictField()


def module_catalog():
    """返回前端渲染权限矩阵所需的静态数据。"""
    from .role_modules import ROLE_TEMPLATES
    return {
        "modules": [
            {"key": k, "label": label, "group": group} for k, label, group in MODULES
        ],
        "actions": [{"key": k, "label": label} for k, label in ACTIONS],
        "module_keys": MODULE_KEYS,
        "templates": ROLE_TEMPLATES,
    }
