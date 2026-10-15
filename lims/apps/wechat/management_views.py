"""用户管理模块 — 视图（阶段1：账号审批）。

独立文件，不改动 wechat/views.py。
所有接口要求 IsAdminUser（is_staff=True），并做站点隔离与审计留痕。
"""
import logging
import secrets
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from lims.apps.audit.utils import log_audit
from lims.apps.organizations.models import Site
from lims.apps.users.models import Role, UserRole

from .management_serializers import (
    SalesApplicationListSerializer,
    SalesApplicationRejectSerializer,
)
from .models import SalesApplication, WechatUser

logger = logging.getLogger(__name__)
User = get_user_model()

SALES_ROLE_NAME = "sales"


# ---------------------------------------------------------------- 权限与工具

def _admin_site_filter(request):
    """超管看全部；普通 staff 只看本站点。"""
    if request.user.is_superuser:
        return Q()
    if request.user.site_id:
        return Q(site_id=request.user.site_id)
    return Q(pk__in=[])


def _guard_site(request, obj):
    """非超管不得操作非本站点数据。"""
    if request.user.is_superuser:
        return True
    return str(obj.site_id) == str(request.user.site_id)


def _gen_application_code():
    """AP-YYYYMMDD-NNNN，当日流水。调用方须在事务内。"""
    today = timezone.localtime().strftime("%Y%m%d")
    prefix = f"AP-{today}-"
    last = (
        SalesApplication.objects.select_for_update()
        .filter(code__startswith=prefix)
        .order_by("-code")
        .values_list("code", flat=True)
        .first()
    )
    seq = int(last.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def _gen_password():
    """强密码：≥12 位，含大小写+数字+符号（不含易混字符）。"""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(16))


def _page(request, qs):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = min(200, max(1, int(request.query_params.get("page_size", 20))))
    except (TypeError, ValueError):
        size = 20
    total = qs.count()
    start = (page - 1) * size
    return qs[start:start + size], total


# ---------------------------------------------------------------- ① 账号审批

@api_view(["GET"])
@permission_classes([IsAdminUser])
def sales_application_list(request):
    """待审核/已通过/已拒绝 申请列表。支持 status / search / 分页。"""
    qs = SalesApplication.objects.select_related("site", "created_user").filter(
        _admin_site_filter(request)
    )

    st = request.query_params.get("status")
    if st in dict(SalesApplication.STATUS_CHOICES):
        qs = qs.filter(status=st)

    search = (request.query_params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(real_name__icontains=search)
            | Q(phone__icontains=search)
            | Q(code__icontains=search)
        )

    qs = qs.order_by("-created_at")
    rows, total = _page(request, qs)
    return Response({
        "count": total,
        "page": int(request.query_params.get("page", 1) or 1),
        "results": SalesApplicationListSerializer(rows, many=True).data,
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def sales_application_stats(request):
    """各状态计数，供前端 Tab 徽标。"""
    agg = (
        SalesApplication.objects.filter(_admin_site_filter(request))
        .values("status")
        .annotate(n=Count("id"))
    )
    counts = {row["status"]: row["n"] for row in agg}
    pending = counts.get(SalesApplication.STATUS_PENDING, 0)
    approved = counts.get(SalesApplication.STATUS_APPROVED, 0)
    rejected = counts.get(SalesApplication.STATUS_REJECTED, 0)
    return Response({
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "all": pending + approved + rejected,
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def sales_application_detail(request, pk):
    obj = SalesApplication.objects.select_related("site", "created_user").filter(
        _admin_site_filter(request), pk=pk
    ).first()
    if obj is None:
        return Response({"error": "申请不存在"}, status=status.HTTP_404_NOT_FOUND)
    return Response(SalesApplicationListSerializer(obj).data)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def sales_application_approve(request, pk):
    """通过申请：创建账号 + 绑定微信 + 分配 sales 角色 + 审计。

    返回一次性明文密码（不落库）。
    """
    with transaction.atomic():
        obj = (
            SalesApplication.objects.select_for_update()
            .select_related("site")
            .filter(_admin_site_filter(request), pk=pk)
            .first()
        )
        if obj is None:
            return Response({"error": "申请不存在"}, status=status.HTTP_404_NOT_FOUND)

        if obj.status != SalesApplication.STATUS_PENDING:
            return Response(
                {"error": f"该申请当前状态为「{obj.get_status_display()}」，不可重复审核",
                 "status": obj.status},
                status=status.HTTP_409_CONFLICT,
            )

        # ── 方案A：可关联到同名的已有账号（不新建）────────────────
        link_to_matched = str(request.data.get("link_to_matched", "")).lower() in ("1", "true", "yes")
        if link_to_matched and obj.matched_user_id:
            target = User.objects.filter(pk=obj.matched_user_id).first()
            if target is None:
                return Response({"error": "疑似关联的账号已不存在，请改为新建"},
                                status=status.HTTP_409_CONFLICT)
            if WechatUser.objects.filter(user=target).exists():
                return Response(
                    {"error": f"账号 {target.username} 已绑定其他微信，无法关联；请改为新建"},
                    status=status.HTTP_409_CONFLICT,
                )
            # 绑定微信到已有账号
            existing = WechatUser.objects.filter(openid=obj.openid).first()
            if existing:
                existing.user = target
                existing.nickname = obj.real_name
                existing.save(update_fields=["user", "nickname"])
            else:
                WechatUser.objects.create(
                    user=target, openid=obj.openid, unionid=obj.unionid, nickname=obj.real_name
                )
            obj.status = SalesApplication.STATUS_APPROVED
            obj.reviewer = request.user
            obj.reviewer_name = request.user.first_name or request.user.username
            obj.reviewed_at = timezone.now()
            obj.created_user = target
            obj.save(update_fields=[
                "status", "reviewer", "reviewer_name", "reviewed_at",
                "created_user", "updated_at",
            ])
            log_audit(
                request,
                action="APPROVE",
                entity=obj,
                entity_type="sales_application",
                entity_repr=f"{obj.code} {obj.real_name}",
                site_id=obj.site_id,
                changes={
                    "status": {"old": "pending", "new": "approved"},
                    "linked_existing_user": {"old": None, "new": target.username},
                },
            )
            logger.info("sales application linked to existing user: %s → %s by %s",
                        obj.code, target.username, request.user.username)
            return Response({
                "status": "approved",
                "mode": "linked",
                "code": obj.code,
                "username": target.username,
                "employee_id": target.employee_id,
                "site": {"id": str(obj.site_id), "code": obj.site.code if obj.site else None},
                "reviewed_at": obj.reviewed_at,
                "message": f"已将该微信关联到既有账号 {target.username}（未新建账号，无需新密码）",
            }, status=status.HTTP_200_OK)

        # ── 默认：新建账号 ───────────────────────────────────────
        # 手机号占用校验
        if User.objects.filter(username=obj.phone).exists():
            return Response(
                {"error": "该手机号已有账号，请先在「账号管理」核实处理"},
                status=status.HTTP_409_CONFLICT,
            )
        if User.objects.filter(employee_id=f"SLS-{obj.phone}"[:20]).exists():
            return Response(
                {"error": "该销售工号已存在，请先在「账号管理」核实处理"},
                status=status.HTTP_409_CONFLICT,
            )

        site = obj.site or Site.objects.filter(is_active=True).order_by("code").first()
        if site is None:
            return Response({"error": "系统未配置可用站点"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        plain_password = _gen_password()
        user = User.objects.create_user(
            employee_id=f"SLS-{obj.phone}"[:20],
            email=f"{obj.phone}@sales.lims",
            password=plain_password,
            username=obj.phone,
            first_name=obj.real_name,
            last_name="",
            phone=obj.phone,
            site=site,
            is_active=True,
            is_staff=False,
        )

        role = Role.objects.filter(name=SALES_ROLE_NAME).first()
        if role is None:
            role = Role.objects.create(
                name=SALES_ROLE_NAME,
                description="销售（微信小程序自助注册）",
                is_system=False,
                site=site,
            )
        UserRole.objects.get_or_create(
            user=user, role=role, site=site, defaults={"granted_by": request.user}
        )

        # 绑定微信（若 openid 已被占用则改绑到新账号）
        existing = WechatUser.objects.filter(openid=obj.openid).first()
        if existing:
            existing.user = user
            existing.nickname = obj.real_name
            existing.save(update_fields=["user", "nickname"])
        else:
            WechatUser.objects.create(
                user=user, openid=obj.openid, unionid=obj.unionid, nickname=obj.real_name
            )

        obj.status = SalesApplication.STATUS_APPROVED
        obj.reviewer = request.user
        obj.reviewer_name = request.user.first_name or request.user.username
        obj.reviewed_at = timezone.now()
        obj.created_user = user
        obj.initial_password_shown_at = timezone.now()
        obj.save(update_fields=[
            "status", "reviewer", "reviewer_name", "reviewed_at",
            "created_user", "initial_password_shown_at", "updated_at",
        ])

        log_audit(
            request,
            action="APPROVE",
            entity=obj,
            entity_type="sales_application",
            entity_repr=f"{obj.code} {obj.real_name}",
            site_id=site.id,
            changes={
                "status": {"old": "pending", "new": "approved"},
                "created_user": {"old": None, "new": user.username},
                "employee_id": {"old": None, "new": user.employee_id},
                "role": {"old": None, "new": SALES_ROLE_NAME},
            },
        )

    logger.info("sales application approved: %s → user %s by %s",
                obj.code, user.username, request.user.username)

    return Response({
        "status": "approved",
        "code": obj.code,
        "username": user.username,
        "employee_id": user.employee_id,
        "password": plain_password,          # 仅此一次返回，不落库
        "password_notice": "该初始密码仅显示一次，请立即复制并转告本人，此后无法再次查看。",
        "site": {"id": str(site.id), "code": site.code},
        "reviewed_at": obj.reviewed_at,
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def sales_application_reject(request, pk):
    """拒绝申请：保留记录 + 记原因 + 解绑微信（可重新申请）+ 审计。

    冷却间隔由 SalesApplication.RESUBMIT_COOLDOWN_HOURS 控制（当前 0 = 立即）。
    """
    ser = SalesApplicationRejectSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    reason = ser.validated_data["reason"]

    with transaction.atomic():
        obj = (
            SalesApplication.objects.select_for_update()
            .select_related("site")
            .filter(_admin_site_filter(request), pk=pk)
            .first()
        )
        if obj is None:
            return Response({"error": "申请不存在"}, status=status.HTTP_404_NOT_FOUND)

        if obj.status != SalesApplication.STATUS_PENDING:
            return Response(
                {"error": f"该申请当前状态为「{obj.get_status_display()}」，不可重复审核",
                 "status": obj.status},
                status=status.HTTP_409_CONFLICT,
            )

        obj.status = SalesApplication.STATUS_REJECTED
        obj.reviewer = request.user
        obj.reviewer_name = request.user.first_name or request.user.username
        obj.reviewed_at = timezone.now()
        obj.reject_reason = reason
        obj.save(update_fields=[
            "status", "reviewer", "reviewer_name", "reviewed_at",
            "reject_reason", "updated_at",
        ])

        # 解绑微信，允许该微信号重新提交（冷却期由 register 侧按常量校验）
        WechatUser.objects.filter(openid=obj.openid, user__isnull=False).update(user=None)

        log_audit(
            request,
            action="REJECT",
            entity=obj,
            entity_type="sales_application",
            entity_repr=f"{obj.code} {obj.real_name}",
            site_id=obj.site_id,
            changes={
                "status": {"old": "pending", "new": "rejected"},
                "reject_reason": {"old": "", "new": reason},
            },
        )

    logger.info("sales application rejected: %s by %s (%s)",
                obj.code, request.user.username, reason)

    return Response({
        "status": "rejected",
        "code": obj.code,
        "reject_reason": reason,
        "resubmit_available_at": obj.reviewed_at + timedelta(
            hours=SalesApplication.RESUBMIT_COOLDOWN_HOURS
        ),
        "message": (
            "已拒绝。该申请人可立即重新提交申请。"
            if SalesApplication.RESUBMIT_COOLDOWN_HOURS <= 0
            else f"已拒绝。该申请人可在 {SalesApplication.RESUBMIT_COOLDOWN_HOURS} 小时后重新提交申请。"
        ),
    }, status=status.HTTP_200_OK)
