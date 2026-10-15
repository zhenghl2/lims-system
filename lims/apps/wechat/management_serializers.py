"""用户管理模块 — 序列化器（阶段1：账号审批）。

独立文件，不改动 wechat/serializers.py。
"""
from rest_framework import serializers

from .models import SalesApplication, WechatUser


class SalesApplicationListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    site_code = serializers.CharField(source="site.code", read_only=True)

    # 疑似关联的已有账号（姓名相同）——供管理员在审核时决定"关联"还是"新建"
    matched_user_id = serializers.UUIDField(read_only=True)
    matched_user_name = serializers.SerializerMethodField()
    matched_user_username = serializers.SerializerMethodField()
    matched_user_employee_id = serializers.SerializerMethodField()
    matched_user_has_wechat = serializers.SerializerMethodField()

    class Meta:
        model = SalesApplication
        fields = [
            "id", "code", "real_name", "phone",
            "status", "status_display",
            "site_id", "site_code",
            "reviewer_name", "reviewed_at", "reject_reason",
            "created_user_id", "remark",
            "matched_user_id", "matched_user_name", "matched_user_username",
            "matched_user_employee_id", "matched_user_has_wechat", "matched_note",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_matched_user_name(self, obj):
        return obj.matched_user.first_name if obj.matched_user_id else None

    def get_matched_user_username(self, obj):
        return obj.matched_user.username if obj.matched_user_id else None

    def get_matched_user_employee_id(self, obj):
        return obj.matched_user.employee_id if obj.matched_user_id else None

    def get_matched_user_has_wechat(self, obj):
        """该账号是否已经绑过微信（已绑则不能再关联）。

        注意：OneToOneField 的反向访问在记录不存在时抛 RelatedObjectDoesNotExist，
        而不是返回 None，所以必须用 filter().exists() 判断。
        """
        if not obj.matched_user_id:
            return False
        return WechatUser.objects.filter(user_id=obj.matched_user_id).exists()


class SalesApplicationRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(required=True, max_length=200, allow_blank=False)

    def validate_reason(self, value):
        v = (value or "").strip()
        if len(v) < 2:
            raise serializers.ValidationError("请填写拒绝原因（至少 2 个字）")
        return v
