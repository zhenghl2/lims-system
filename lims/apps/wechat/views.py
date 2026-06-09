import logging

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import WechatUser
from .serializers import WechatLoginSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


def _get_jwt_for_user(user):
    """为指定用户生成 JWT token pair"""
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


def _get_user_info(user):
    """提取用户信息（安全字段）"""
    return {
        "id": str(user.id),
        "username": user.username,
        "name": getattr(user, "name", user.username),
        "site": {
            "id": str(user.site.id) if user.site else None,
            "name": user.site.name if user.site else None,
            "code": user.site.code if user.site else None,
        } if user.site else None,
    }


@api_view(["POST"])
@permission_classes([AllowAny])
def wechat_login(request):
    """
    微信小程序登录

    POST /api/v1/wechat/login/
    Body: { "code": "wx.login() 返回的 code", "nickname": "可选", "avatar_url": "可选" }

    流程：
    1. 用 code 调微信 jscode2session 获取 openid
    2. 查 WechatUser 表获取绑定的 LIMS User
    3. 未绑定 → 返回 pending 状态，由管理员后台绑定
    4. 已绑定 → 返回 JWT token + 用户信息
    """
    serializer = WechatLoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    code = serializer.validated_data["code"]
    nickname = serializer.validated_data.get("nickname", "")
    avatar_url = serializer.validated_data.get("avatar_url", "")

    # 1. 调微信接口获取 openid
    appid = getattr(settings, "WECHAT_APPID", None)
    secret = getattr(settings, "WECHAT_SECRET", None)

    if not appid or not secret:
        return Response(
            {"error": "微信小程序未配置 (WECHAT_APPID / WECHAT_SECRET)"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        wx_resp = requests.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": appid,
                "secret": secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        wx_data = wx_resp.json()
    except requests.RequestException as e:
        logger.error(f"WeChat API request failed: {e}")
        return Response(
            {"error": "微信服务暂不可用，请稍后重试"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    if "errcode" in wx_data and wx_data["errcode"] != 0:
        logger.error(f"WeChat jscode2session failed: {wx_data}")
        return Response(
            {"error": f"微信登录失败: {wx_data.get('errmsg', '未知错误')}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    openid = wx_data.get("openid")
    unionid = wx_data.get("unionid")

    if not openid:
        return Response(
            {"error": "获取 openid 失败"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 2. 查找或创建 WechatUser
    wechat_user, created = WechatUser.objects.get_or_create(
        openid=openid,
        defaults={
            "unionid": unionid,
            "nickname": nickname,
            "avatar_url": avatar_url,
        },
    )

    if not created:
        # 更新昵称和头像
        if nickname:
            wechat_user.nickname = nickname
        if avatar_url:
            wechat_user.avatar_url = avatar_url
        if unionid and not wechat_user.unionid:
            wechat_user.unionid = unionid
        wechat_user.save(update_fields=["nickname", "avatar_url", "unionid"])

    # 3. 检查是否已绑定 LIMS User
    if wechat_user.user_id is None:
        return Response(
            {
                "bound": False,
                "message": "该微信尚未绑定系统账号，请联系管理员",
                "openid": openid,
            },
            status=status.HTTP_200_OK,
        )

    # 4. 已绑定 → 生成 JWT + 返回用户信息
    if not wechat_user.user.is_active:
        return Response(
            {"error": "账号已被禁用，请联系管理员"},
            status=status.HTTP_403_FORBIDDEN,
        )

    tokens = _get_jwt_for_user(wechat_user.user)
    user_info = _get_user_info(wechat_user.user)

    return Response(
        {
            "bound": True,
            **tokens,
            "user": user_info,
        }
    )
