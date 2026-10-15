import logging
from datetime import timedelta

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from django.utils import timezone
from lims.apps.audit.utils import log_audit
from django.db import transaction

from .models import WechatUser
from .serializers import WechatLoginSerializer, WechatRegisterSerializer

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
            "id": str(user.site.id),
            "name": getattr(user.site, "name", None)
            or getattr(user.site, "name_local", None)
            or getattr(user.site, "name_en", None)
            or user.site.code,
            "code": user.site.code,
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
                "message": "首次使用请先完善资料（姓名与手机号）",
                "openid": openid,
            },
            status=status.HTTP_200_OK,
        )

    # 4. 已绑定 → 生成 JWT + 返回用户信息
    if not wechat_user.user.is_active:
        # 待审核 / 已停用：返回 200 让小程序展示明确状态（原 403 会被前端当通用错误）
        return Response(
            {
                "bound": True,
                "status": "inactive",
                "message": "账号未启用：可能正在等待管理员审核，或已被停用。请联系管理员。",
                "user": {"name": wechat_user.user.first_name or wechat_user.user.username},
            },
            status=status.HTTP_200_OK,
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def wechat_check(request):
    """
    校验小程序登录态

    GET /api/v1/wechat/check/
    小程序冷启动时调用：token 有效返回用户信息，失效返回 401（前端据此重新登录）
    """
    user = request.user
    wechat_user = getattr(user, "wechat_user", None)
    return Response(
        {
            "bound": True,
            "user": _get_user_info(user),
            "wechat": {
                "openid": wechat_user.openid if wechat_user else None,
                "nickname": wechat_user.nickname if wechat_user else None,
                "avatar_url": wechat_user.avatar_url if wechat_user else None,
            },
        }
    )


SALES_ROLE_NAME = "sales"


def _wx_code_to_openid(code):
    """用 wx.login 的 code 换取 openid。返回 (openid, unionid, error)。"""
    appid = getattr(settings, "WECHAT_APPID", None)
    secret = getattr(settings, "WECHAT_SECRET", None)
    if not appid or not secret:
        return None, None, "微信小程序未配置 (WECHAT_APPID / WECHAT_SECRET)"
    try:
        resp = requests.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": appid,
                "secret": secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        data = resp.json()
    except requests.RequestException as e:
        logger.error(f"WeChat API request failed: {e}")
        return None, None, "微信服务暂不可用，请稍后重试"
    if data.get("errcode"):
        logger.error(f"WeChat jscode2session failed: {data}")
        return None, None, f"微信登录失败: {data.get('errmsg', '未知错误')}"
    openid = data.get("openid")
    if not openid:
        return None, None, "获取 openid 失败"
    return openid, data.get("unionid"), None


@api_view(["POST"])
@permission_classes([AllowAny])
def wechat_register(request):
    """
    销售自助注册（首次微信登录后提交姓名 + 手机号）

    POST /api/v1/wechat/register/
    Body: { "code": "...", "real_name": "张三", "phone": "13800000000" }

    流程：code → openid → 校验未绑定 / 手机号未占用 → 创建待审核用户
          （is_active=False）→ 分配 sales 角色 → 绑定 openid → 返回 pending
    审核：管理员在 Django admin 打开该用户 is_active 即可登录。
    """
    serializer = WechatRegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    code = serializer.validated_data["code"]
    real_name = serializer.validated_data["real_name"]
    phone = serializer.validated_data["phone"]

    openid, unionid, err = _wx_code_to_openid(code)
    if err:
        return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

    existing = WechatUser.objects.filter(openid=openid).first()
    if existing and existing.user_id:
        return Response(
            {"status": "already_registered", "error": "该微信已注册，请直接登录"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if User.objects.filter(username=phone).exists():
        return Response(
            {"status": "phone_taken", "error": "该手机号已注册，请联系管理员"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    import secrets as _secrets

    from lims.apps.organizations.models import Site
    from lims.apps.users.models import Role, UserRole

    # 销售账号必须挂到一个站点（DB 约束：user_roles.site_id NOT NULL）
    default_site = Site.objects.filter(is_active=True).order_by("code").first()
    if default_site is None:
        return Response(
            {"error": "系统未配置可用站点，请联系管理员"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    with transaction.atomic():
        user = User.objects.create_user(
            employee_id=f"SLS-{phone}"[:20],
            email=f"{phone}@sales.lims",
            password=_secrets.token_urlsafe(24),  # 随机密码：该账号只能用微信登录
            username=phone,
            first_name=real_name,
            phone=phone,
            site=default_site,
            is_active=False,  # 待审核
            is_staff=False,
        )
        role = Role.objects.filter(name=SALES_ROLE_NAME).first()
        if role is None:
            role = Role.objects.create(
                name=SALES_ROLE_NAME,
                description="销售（微信小程序自助注册）",
                is_system=False,
                site=default_site,
            )
        UserRole.objects.get_or_create(user=user, role=role, site=default_site)

        if existing:
            existing.user = user
            existing.nickname = real_name
            if unionid and not existing.unionid:
                existing.unionid = unionid
            existing.save(update_fields=["user", "nickname", "unionid"])
        else:
            WechatUser.objects.create(
                user=user, openid=openid, unionid=unionid, nickname=real_name
            )

    logger.info("wechat sales self-registration: %s (%s)", real_name, phone)
    return Response(
        {
            "status": "pending",
            "bound": True,
            "real_name": real_name,
            "site": {"id": str(default_site.id), "code": default_site.code},
            "message": "申请已提交，等待管理员审核通过后即可使用",
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def wechat_register_v2(request):
    """
    销售自助注册 —— 提交申请（正式做法：申请与账号分离）

    POST /api/v1/wechat/register/
    Body: { "code": "...", "real_name": "张三", "phone": "13800000000" }

    流程：code → openid
          → 校验：该 openid 已绑定账号 → 直接返回已注册
          → 校验：已存在 pending 申请 → 返回 pending（幂等）
          → 校验：冷却期内的 rejected 申请 → 429（当前冷却为 0，故不会触发）
          → 创建 SalesApplication(status=pending)
          → 返回 pending（等待管理员在「用户管理 → 账号审批」处理）

    审核通过后才会创建真实 User 账号。
    """
    from datetime import timedelta

    from .management_views import _gen_application_code
    from .models import SalesApplication

    serializer = WechatRegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    code = serializer.validated_data["code"]
    real_name = serializer.validated_data["real_name"]
    phone = serializer.validated_data["phone"]

    openid, unionid, err = _wx_code_to_openid(code)
    if err:
        return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

    # 1) 已绑定真实账号 → 已注册
    existing_binding = WechatUser.objects.filter(openid=openid, user__isnull=False).first()
    if existing_binding:
        return Response(
            {"status": "already_registered", "error": "该微信已注册，请直接登录"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 2) 已有 pending 申请 → 幂等返回
    pending = SalesApplication.objects.filter(
        openid=openid, status=SalesApplication.STATUS_PENDING
    ).first()
    if pending:
        return Response(
            {
                "status": "pending",
                "code": pending.code,
                "real_name": pending.real_name,
                "message": "申请已提交，等待管理员审核通过后即可使用",
            },
            status=status.HTTP_200_OK,
        )

    # 3) 已通过但未绑定（异常态，提示联系管理员）
    approved_no_bind = SalesApplication.objects.filter(
        openid=openid, status=SalesApplication.STATUS_APPROVED
    ).first()
    if approved_no_bind:
        return Response(
            {"status": "approved", "code": approved_no_bind.code,
             "error": "您的申请已通过，但微信绑定异常，请联系管理员"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 4) 冷却期校验（当前 RESUBMIT_COOLDOWN_HOURS=0，即立即可重新申请）
    latest_rejected = SalesApplication.objects.filter(
        openid=openid, status=SalesApplication.STATUS_REJECTED, reviewed_at__isnull=False
    ).order_by("-reviewed_at").first()
    if latest_rejected:
        available_at = latest_rejected.reviewed_at + timedelta(
            hours=SalesApplication.RESUBMIT_COOLDOWN_HOURS
        )
        if timezone.now() < available_at:
            hours_left = (available_at - timezone.now()).total_seconds() / 3600
            return Response(
                {
                    "status": "cooldown",
                    "error": (
                        f"申请被拒后需等待 {SalesApplication.RESUBMIT_COOLDOWN_HOURS} 小时"
                        f"才能重新提交，请于约 {hours_left:.1f} 小时后重试"
                    ),
                    "resubmit_available_at": available_at,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

    # 5) 手机号占用校验
    if User.objects.filter(username=phone).exists():
        return Response(
            {"status": "phone_taken", "error": "该手机号已注册，请联系管理员"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from lims.apps.organizations.models import Site

    default_site = Site.objects.filter(is_active=True).order_by("code").first()
    if default_site is None:
        return Response(
            {"error": "系统未配置可用站点，请联系管理员"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # 查同名已有账号（方案A：只记录、不自动关联）。
    # 姓名不是凭证 —— 若自动关联，任何人填「李彩娟」就能夺取她的账号。
    # 因此这里只做匹配供管理员审核时参考。
    matched = (
        User.objects.filter(first_name=real_name, is_active=True)
        .exclude(username=phone)
        .order_by("created_at")
        .first()
    )
    matched_note = ""
    if matched is not None:
        already_bound = WechatUser.objects.filter(
            user=matched, openid__isnull=False
        ).exclude(openid=openid).exists()
        matched_note = (
            f"姓名与已有账号 {matched.username}（{matched.first_name}）相同"
            + ("，但该账号已绑定其他微信，无法关联" if already_bound else "，可关联")
        )

    with transaction.atomic():
        application = SalesApplication.objects.create(
            code=_gen_application_code(),
            openid=openid,
            unionid=unionid,
            real_name=real_name,
            phone=phone,
            status=SalesApplication.STATUS_PENDING,
            site=default_site,
            matched_user=matched,
            matched_note=matched_note,
        )

        # openid 预占位（user 为空），以便后续绑定与重复提交识别
        if not WechatUser.objects.filter(openid=openid).exists():
            WechatUser.objects.create(
                user=None, openid=openid, unionid=unionid, nickname=real_name
            )

        log_audit(
            request,
            action="CREATE",
            entity=application,
            entity_type="sales_application",
            entity_repr=f"{application.code} {real_name}",
            site_id=default_site.id,
            changes={"status": {"old": None, "new": "pending"}},
        )

    logger.info("sales application submitted: %s (%s)", real_name, phone)
    return Response(
        {
            "status": "pending",
            "code": application.code,
            "real_name": real_name,
            "site": {"id": str(default_site.id), "code": default_site.code},
            "message": "申请已提交，等待管理员审核通过后即可使用",
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def wechat_register_status(request):
    """查询本微信的申请状态（小程序轮询用）。

    GET /api/v1/wechat/register/status/?code=<wx.login code>
    """
    from .models import SalesApplication

    code = request.query_params.get("code")
    if not code:
        return Response({"error": "缺少 code 参数"}, status=status.HTTP_400_BAD_REQUEST)

    openid, _unionid, err = _wx_code_to_openid(code)
    if err:
        return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

    binding = WechatUser.objects.filter(openid=openid, user__isnull=False).first()
    if binding:
        return Response({"status": "approved", "bound": True,
                         "message": "审核已通过，可直接登录"})

    app_obj = SalesApplication.objects.filter(openid=openid).order_by("-created_at").first()
    if app_obj is None:
        return Response({"status": "none", "message": "尚未提交申请"})

    return Response({
        "status": app_obj.status,
        "code": app_obj.code,
        "real_name": app_obj.real_name,
        "reject_reason": app_obj.reject_reason,
        "reviewed_at": app_obj.reviewed_at,
        "resubmit_available_at": (
            app_obj.reviewed_at + timedelta(hours=SalesApplication.RESUBMIT_COOLDOWN_HOURS)
            if app_obj.status == SalesApplication.STATUS_REJECTED and app_obj.reviewed_at
            else None
        ),
        "message": app_obj.get_status_display(),
    })
