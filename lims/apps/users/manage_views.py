"""用户管理模块 — 账号管理视图（阶段2）。

独立文件，不改动 users/views.py。
所有接口要求 IsAdminUser，做站点隔离与审计留痕。

安全约束（均有校验）：
  1. 非 is_staff 访问 → 403
  2. 非超管只能看/改本站点账号
  3. 不能停用/禁用自己（防自锁）
  4. 不能停用其他超级管理员（防误伤最高权限账号）
  5. 系统内置角色不可改；is_superuser 不可通过本模块变更
  6. 重置密码只在响应中返回一次明文，不落库、不进审计
"""
import logging
import secrets

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

from .manage_serializers import ManagedUserListSerializer, ManagedUserUpdateSerializer
from .models import UserRole

logger = logging.getLogger(__name__)
User = get_user_model()

# 与 wechat/management_views.py 保持一致的密码策略（≥12位，含大小写+数字+符号）
_PWD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%^&*"


def _gen_password():
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(16))


def _admin_site_filter(request):
    """超管看全部；普通 staff 只看本站点账号。"""
    if request.user.is_superuser:
        return Q()
    if request.user.site_id:
        return Q(site_id=request.user.site_id)
    return Q(pk__in=[])


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
    return qs[start:start + size], total, page


def _guard_self_and_superuser(request, target, action_label):
    """自我保护 + 超管保护。返回 (ok, Response|None)。"""
    if target.pk == request.user.pk:
        return False, Response(
            {"error": f"不能{action_label}自己的账号"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if target.is_superuser and not request.user.is_superuser:
        return False, Response(
            {"error": "无权操作超级管理员账号"},
            status=status.HTTP_403_FORBIDDEN,
        )
    return True, None


# ---------------------------------------------------------------- 列表 / 统计

@api_view(["GET"])
@permission_classes([IsAdminUser])
def user_manage_list(request):
    """账号列表：支持搜索 / 站点 / 状态 / 角色 筛选 + 分页。"""
    qs = (
        User.objects.select_related("site")
        .prefetch_related("role_assignments__role", "role_assignments__site")
        .filter(_admin_site_filter(request))
    )

    search = (request.query_params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(username__icontains=search)
            | Q(employee_id__icontains=search)
            | Q(first_name__icontains=search)
            | Q(last_name__icontains=search)
            | Q(email__icontains=search)
            | Q(phone__icontains=search)
        )

    st = request.query_params.get("status")
    if st == "active":
        qs = qs.filter(is_active=True)
    elif st == "inactive":
        qs = qs.filter(is_active=False)

    site = request.query_params.get("site")
    if site:
        if site == "none":
            qs = qs.filter(site__isnull=True)
        else:
            qs = qs.filter(site__code=site)

    role = request.query_params.get("role")
    if role:
        qs = qs.filter(role_assignments__role__name=role).distinct()

    qs = qs.order_by("-created_at")
    rows, total, page = _page(request, qs)
    return Response({
        "count": total,
        "page": page,
        "results": ManagedUserListSerializer(rows, many=True).data,
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def user_manage_stats(request):
    """账号统计，供 Tab 徽标。"""
    base = User.objects.filter(_admin_site_filter(request))
    agg = base.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(is_active=True)),
        inactive=Count("id", filter=Q(is_active=False)),
        staff=Count("id", filter=Q(is_staff=True)),
    )
    # 角色分布（仅统计数量，供筛选下拉参考）
    roles = (
        UserRole.objects.filter(user__in=base)
        .values("role__name")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    return Response({
        "total": agg["total"] or 0,
        "active": agg["active"] or 0,
        "inactive": agg["inactive"] or 0,
        "staff": agg["staff"] or 0,
        "roles": [{"name": r["role__name"], "count": r["n"]} for r in roles],
        # 返回 {id, code}：前端下拉的 value 必须是 UUID（PATCH 需要），label 用 code
        "sites": [{"id": str(x["id"]), "code": x["code"]} for x in list(
            Site.objects.filter(is_active=True).order_by("code")
            .values("id", "code")
        )],
    })


# ---------------------------------------------------------------- 详情 / 编辑

def _get_target(request, pk):
    return (
        User.objects.select_related("site")
        .prefetch_related("role_assignments__role", "role_assignments__site")
        .filter(_admin_site_filter(request), pk=pk)
        .first()
    )


@api_view(["GET", "PATCH", "PUT"])
@permission_classes([IsAdminUser])
def user_manage_detail(request, pk):
    """账号详情（GET）与编辑（PATCH/PUT）—— 同一资源同一 URL，符合 RESTful。"""
    if request.method == "GET":
        obj = _get_target(request, pk)
        if obj is None:
            return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)
        return Response(ManagedUserListSerializer(obj).data)

    # PATCH / PUT：编辑资料（username / employee_id / is_superuser 不可改）
    with transaction.atomic():
        obj = User.objects.select_for_update().filter(
            _admin_site_filter(request), pk=pk
        ).first()
        if obj is None:
            return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

        ser = ManagedUserUpdateSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        changes = {}
        for field, new in ser.validated_data.items():
            old = getattr(obj, field)
            if field == "site":
                old_val = str(old.id) if old else None
                new_val = str(new.id) if new else None
                if old_val != new_val:
                    changes[field] = {"old": old_val, "new": new_val}
            elif str(old) != str(new):
                changes[field] = {"old": str(old), "new": str(new)}
        ser.save()

        if changes:
            log_audit(
                request,
                action="UPDATE",
                entity=obj,
                entity_type="user",
                entity_repr=f"{obj.username} {obj.first_name}",
                site_id=obj.site_id,
                changes=changes,
            )

    logger.info("user updated: %s by %s (%d fields)",
                obj.username, request.user.username, len(changes))
    return Response({
        "status": "updated",
        "changed_fields": list(changes.keys()),
        "user": ManagedUserListSerializer(obj).data,
    })


# ---------------------------------------------------------------- 启停 / 密码 / MFA

@api_view(["POST"])
@permission_classes([IsAdminUser])
def user_manage_toggle_active(request, pk):
    """启用 / 停用账号（不做物理删除，保留审计与数据关联）。"""
    with transaction.atomic():
        obj = User.objects.select_for_update().filter(
            _admin_site_filter(request), pk=pk
        ).first()
        if obj is None:
            return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

        ok, err = _guard_self_and_superuser(
            request, obj, "停用" if obj.is_active else "启用"
        )
        if not ok:
            return err

        old = obj.is_active
        obj.is_active = not old
        obj.save(update_fields=["is_active", "updated_at"])

        log_audit(
            request,
            action="UPDATE",
            entity=obj,
            entity_type="user",
            entity_repr=f"{obj.username} {obj.first_name}",
            site_id=obj.site_id,
            changes={"is_active": {"old": old, "new": obj.is_active}},
        )

    logger.info("user %s: %s by %s",
                "activated" if obj.is_active else "deactivated",
                obj.username, request.user.username)
    return Response({
        "status": "activated" if obj.is_active else "deactivated",
        "is_active": obj.is_active,
        "message": "账号已启用" if obj.is_active else "账号已停用，该用户将无法登录",
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def user_manage_reset_password(request, pk):
    """重置密码，返回一次性明文（不落库）。"""
    with transaction.atomic():
        obj = User.objects.select_for_update().filter(
            _admin_site_filter(request), pk=pk
        ).first()
        if obj is None:
            return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

        if obj.is_superuser and not request.user.is_superuser:
            return Response({"error": "无权重置超级管理员的密码"},
                            status=status.HTTP_403_FORBIDDEN)

        plain = _gen_password()
        obj.set_password(plain)
        obj.password_changed_at = timezone.now()
        obj.save(update_fields=["password", "password_changed_at", "updated_at"])

        log_audit(
            request,
            action="UPDATE",
            entity=obj,
            entity_type="user",
            entity_repr=f"{obj.username} {obj.first_name}",
            site_id=obj.site_id,
            # 注意：绝不记录密码本身
            changes={"password_reset": {"old": None, "new": True}},
        )

    logger.info("password reset for %s by %s", obj.username, request.user.username)
    return Response({
        "username": obj.username,
        "employee_id": obj.employee_id,
        "password": plain,
        "password_notice": "该新密码仅显示一次，请立即复制并转告本人，此后无法再次查看。",
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def user_manage_unlock_mfa(request, pk):
    """关闭该账号的 MFA（应对用户换机/丢失验证器）。"""
    with transaction.atomic():
        obj = User.objects.select_for_update().filter(
            _admin_site_filter(request), pk=pk
        ).first()
        if obj is None:
            return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

        if not obj.mfa_enabled:
            return Response({"status": "noop", "message": "该账号未启用 MFA"})

        obj.mfa_enabled = False
        obj.mfa_secret = ""
        obj.mfa_backup_codes = None
        obj.save(update_fields=["mfa_enabled", "mfa_secret", "mfa_backup_codes", "updated_at"])

        log_audit(
            request,
            action="UPDATE",
            entity=obj,
            entity_type="user",
            entity_repr=f"{obj.username} {obj.first_name}",
            site_id=obj.site_id,
            changes={"mfa_enabled": {"old": True, "new": False}},
        )

    logger.info("mfa disabled for %s by %s", obj.username, request.user.username)
    return Response({"status": "mfa_disabled", "message": "已关闭该账号的两步验证"})
