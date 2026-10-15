"""用户管理模块 — 账号管理序列化器（阶段2）。

独立文件，不改动 users/serializers.py。
"""
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class ManagedUserListSerializer(serializers.ModelSerializer):
    """账号列表。比 UserListSerializer 多出管理所需的字段（含停用状态）。"""

    full_name = serializers.SerializerMethodField()
    site_code = serializers.CharField(source="site.code", read_only=True, default=None)
    roles = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "employee_id", "username", "email",
            "first_name", "last_name", "full_name", "phone",
            "site_id", "site_code", "roles",
            "is_active", "is_staff", "is_superuser",
            "mfa_enabled", "last_login", "created_at", "source",
        ]
        read_only_fields = fields

    def get_full_name(self, obj):
        return (f"{obj.first_name} {obj.last_name}").strip()

    def get_roles(self, obj):
        return [
            {
                "assignment_id": str(a.id),
                "name": a.role.name,
                "site": a.site.code if a.site else None,
                "expires_at": a.expires_at,
            }
            for a in obj.role_assignments.select_related("role", "site")
        ]

    def get_source(self, obj):
        """账号来源：微信自助注册的销售 / 后台创建 / 其他"""
        app = getattr(obj, "source_application", None)
        if app is not None:
            first = app.order_by("created_at").first()
            if first is not None:
                return {
                    "type": "sales_wechat",
                    "label": "微信自助注册",
                    "application_code": first.code,
                }
        if obj.employee_id.startswith("SLS-"):
            return {"type": "sales", "label": "销售账号", "application_code": None}
        return {"type": "manual", "label": "后台创建", "application_code": None}


class ManagedUserUpdateSerializer(serializers.ModelSerializer):
    """编辑账号。刻意不允许改 username / employee_id / is_superuser。

    - username 是登录名，改它会让对方无法登录
    - employee_id 是工号，与外部系统对齐
    - is_superuser 提权必须走专门的流程（防误操作）

    注意：last_name / phone 在模型上是 CharField(blank=False)，
    但业务上很多人没有姓氏、也不登记手机号，因此这里显式放开空值，
    否则前端提交 "" 会被 DRF 拒绝（This field may not be blank）。
    """

    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)

    class Meta:
        model = User
        fields = ["first_name", "last_name", "email", "phone", "site"]

    def validate_first_name(self, value):
        v = (value or "").strip()
        if len(v) < 1:
            raise serializers.ValidationError("姓名不能为空")
        return v

    def validate_email(self, value):
        v = (value or "").strip()
        if not v:
            raise serializers.ValidationError("邮箱不能为空")
        qs = User.objects.filter(email=v)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("该邮箱已被其他账号使用")
        return v

    def validate_phone(self, value):
        return (value or "").strip()

    def validate_site(self, value):
        # site 允许为空（历史账号大多没有站点）
        return value


class ResetPasswordResultSerializer(serializers.Serializer):
    """重置密码的返回结构（一次性明文，不落库）。"""

    username = serializers.CharField()
    employee_id = serializers.CharField()
    password = serializers.CharField()
    password_notice = serializers.CharField()
