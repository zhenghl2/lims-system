import re

from rest_framework import serializers


class WechatLoginSerializer(serializers.Serializer):
    code = serializers.CharField(required=True, help_text="wx.login() 返回的临时 code")
    nickname = serializers.CharField(required=False, allow_blank=True)
    avatar_url = serializers.CharField(required=False, allow_blank=True)


class WechatUserInfoSerializer(serializers.Serializer):
    """返回给小程序端的用户信息（含 JWT token）"""
    access = serializers.CharField()
    refresh = serializers.CharField()
    user = serializers.DictField()


class WechatRegisterSerializer(serializers.Serializer):
    """销售自助注册：微信 code + 真实姓名 + 手机号（手机号作唯一标识）"""

    code = serializers.CharField(required=True, help_text="wx.login() 返回的临时 code")
    real_name = serializers.CharField(required=True, max_length=32, help_text="真实姓名")
    phone = serializers.CharField(required=True, max_length=20, help_text="手机号（唯一标识）")

    def validate_real_name(self, value):
        v = (value or "").strip()
        if len(v) < 2:
            raise serializers.ValidationError("请填写真实姓名（至少 2 个字）")
        return v

    def validate_phone(self, value):
        v = (value or "").strip().replace(" ", "").replace("-", "")
        if not re.match(r"^\+?\d{6,20}$", v):
            raise serializers.ValidationError("手机号格式不正确")
        return v
