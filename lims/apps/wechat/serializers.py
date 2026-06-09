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
