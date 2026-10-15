"""用户管理模块 — 角色权限视图（阶段3）。

独立文件，不改动 users/views.py。
全部接口要求 IsAdminUser。

权限模型：角色 = { 模块: {view: bool, edit: bool} }
  - superuser（admin）恒为全权限，不依赖角色配置
  - 未配置的模块 = 无权限（默认拒绝）
  - 这些权限当前只驱动前端菜单/按钮显示，后端不做硬校验（避免误伤既有功能）
"""
import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from lims.apps.audit.utils import log_audit

from .manage_role_serializers import (
    AssignRoleSerializer,
    RoleBriefSerializer,
    RoleSerializer,
    module_catalog,
)
from .models import Role, UserRole
from .role_modules import all_permissions, normalize_permissions

logger = logging.getLogger(__name__)
User = get_user_model()


class _DeletedSnapshot:
    """已删除对象的审计快照。

    log_audit 需要从 entity 上取 pk / site_id 写入 NOT NULL 的 AuditLog.entity_id。
    删除后原对象已不可用，传 entity=None 会让 INSERT 违反非空约束；
    而 log_audit 内部 try/except 吞掉该异常后，PostgreSQL 的事务已处于 aborted 状态，
    外层 transaction.atomic() 退出时会连主业务一起回滚（该删的没删，却返回 200）。
    所以删除类操作必须传这个快照，而不是 None。
    """

    __slots__ = ("pk", "site_id", "_repr")

    def __init__(self, pk, site_id=None, repr_=""):
        self.pk = pk
        self.site_id = site_id
        self._repr = repr_

    def __str__(self):
        return self._repr


def _admin_site_filter(request):
    if request.user.is_superuser:
        return Q()
    if request.user.site_id:
        return Q(site_id=request.user.site_id)
    return Q(pk__in=[])


# ---------------------------------------------------------------- 模块清单

@api_view(["GET"])
@permission_classes([IsAdminUser])
def role_module_catalog(request):
    """模块清单 + 操作清单 + 角色模板（供前端渲染权限矩阵）。"""
    return Response(module_catalog())


# ---------------------------------------------------------------- 角色 CRUD

@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def role_list(request):
    if request.method == "GET":
        qs = (
            Role.objects.select_related("site")
            .filter(_admin_site_filter(request))
            .annotate(user_count_ann=Count("userrole", distinct=True))
            .order_by("-is_system", "name")
        )
        rows = []
        for r in qs:
            item = RoleSerializer(r).data
            item["user_count"] = r.user_count_ann
            rows.append(item)
        return Response({
            "count": len(rows),
            "results": rows,
            "admin_note": "超级管理员（admin）恒为全部模块的全部权限，不受角色配置影响。",
        })

    # POST：新建角色
    ser = RoleSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    with transaction.atomic():
        role = ser.save(is_system=False)
        log_audit(
            request,
            action="CREATE",
            entity=role,
            entity_type="role",
            entity_repr=role.name,
            site_id=role.site_id,
            changes={
                "name": {"old": None, "new": role.name},
                "permissions": {"old": None, "new": len(role.permissions or {})},
            },
        )
    logger.info("role created: %s by %s", role.name, request.user.username)
    return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "PUT", "DELETE"])
@permission_classes([IsAdminUser])
def role_detail(request, pk):
    role = Role.objects.filter(_admin_site_filter(request), pk=pk).first()
    if role is None:
        return Response({"error": "角色不存在"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(RoleSerializer(role).data)

    if request.method == "DELETE":
        if role.is_system:
            return Response({"error": f"「{role.name}」是系统内置角色，不可删除"},
                            status=status.HTTP_409_CONFLICT)
        n = UserRole.objects.filter(role=role).count()
        if n > 0:
            return Response(
                {"error": f"该角色下还有 {n} 个用户，请先移除这些分配后再删除"},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            name = role.name
            role_pk = role.pk
            perms = role.permissions or {}
            snap = _DeletedSnapshot(role_pk, None, name)
            role.delete()
            log_audit(
                request,
                action="DELETE",
                entity=snap,
                entity_type="role",
                entity_repr=name,
                site_id=None,
                changes={"name": {"old": name, "new": None},
                         "permissions": {"old": len(perms), "new": None}},
            )
        logger.info("role deleted: %s by %s", name, request.user.username)
        return Response({"status": "deleted", "name": name})

    # PATCH / PUT：改说明 / 权限（系统角色的名称不可改，由序列化器处理）
    with transaction.atomic():
        ser = RoleSerializer(role, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        old_perms = role.permissions or {}
        role = ser.save()
        new_perms = role.permissions or {}
        changes = {}
        if old_perms != new_perms:
            changes["permissions"] = {
                "old": len(old_perms),
                "new": len(new_perms),
            }
        if changes:
            log_audit(
                request,
                action="UPDATE",
                entity=role,
                entity_type="role",
                entity_repr=role.name,
                site_id=role.site_id,
                changes=changes,
            )
    logger.info("role updated: %s by %s", role.name, request.user.username)
    return Response(RoleSerializer(role).data)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def role_users(request, pk):
    """该角色下的用户列表。"""
    role = Role.objects.filter(_admin_site_filter(request), pk=pk).first()
    if role is None:
        return Response({"error": "角色不存在"}, status=status.HTTP_404_NOT_FOUND)
    assignments = (
        UserRole.objects.filter(role=role)
        .select_related("user", "site")
        .order_by("-granted_at")
    )
    return Response({
        "role": RoleBriefSerializer(role).data,
        "count": assignments.count(),
        "results": [
            {
                "assignment_id": str(a.id),
                "user_id": str(a.user_id),
                "username": a.user.username,
                "full_name": (a.user.first_name or a.user.username),
                "employee_id": a.user.employee_id,
                "site": a.site.code if a.site_id else None,
                "granted_at": a.granted_at,
                "expires_at": a.expires_at,
            }
            for a in assignments
        ],
    })


# ---------------------------------------------------------------- 用户 ↔ 角色

@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def user_roles(request, pk):
    """查询/分配某个用户的角色。"""
    user = User.objects.filter(_admin_site_filter(request), pk=pk).first()
    if user is None:
        return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        assignments = (
            UserRole.objects.filter(user=user)
            .select_related("role", "site")
            .order_by("-granted_at")
        )
        return Response({
            "user_id": str(user.id),
            "username": user.username,
            "full_name": user.first_name or user.username,
            "is_superuser": user.is_superuser,
            "note": "超级管理员的权限由系统固定，不依赖角色分配。" if user.is_superuser else "",
            "results": [
                {
                    "assignment_id": str(a.id),
                    "role_id": str(a.role_id),
                    "role_name": a.role.name,
                    "role_is_system": a.role.is_system,
                    "permissions": a.role.permissions or {},
                    "site": a.site.code if a.site_id else None,
                    "granted_at": a.granted_at,
                    "granted_by": a.granted_by.username if a.granted_by_id else None,
                    "expires_at": a.expires_at,
                    "is_expired": a.is_expired(),
                }
                for a in assignments
            ],
        })

    # POST：分配
    ser = AssignRoleSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    role = Role.objects.filter(pk=ser.validated_data["role_id"]).first()
    if role is None:
        return Response({"error": "角色不存在"}, status=status.HTTP_404_NOT_FOUND)

    site = role.site or user.site
    if site is None:
        from lims.apps.organizations.models import Site
        site = Site.objects.filter(is_active=True).order_by("code").first()
    if site is None:
        return Response({"error": "系统未配置可用站点"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    existing = UserRole.objects.filter(user=user, role=role, site=site).first()
    if existing:
        return Response(
            {"error": f"该用户已拥有角色「{role.name}」"},
            status=status.HTTP_409_CONFLICT,
        )

    with transaction.atomic():
        assignment = UserRole.objects.create(
            user=user,
            role=role,
            site=site,
            granted_by=request.user,
            expires_at=ser.validated_data.get("expires_at"),
        )
        log_audit(
            request,
            action="CREATE",
            entity=assignment,
            entity_type="user_role",
            entity_repr=f"{user.username} ← {role.name}",
            site_id=site.id,
            changes={
                "role": {"old": None, "new": role.name},
                "expires_at": {"old": None, "new": str(assignment.expires_at)},
            },
        )
    logger.info("role %s assigned to %s by %s", role.name, user.username, request.user.username)
    return Response({
        "status": "assigned",
        "assignment_id": str(assignment.id),
        "role_name": role.name,
        "message": f"已为 {user.first_name or user.username} 分配角色「{role.name}」",
    }, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def user_role_remove(request, pk, assignment_id):
    """移除某用户的一条角色分配。"""
    user = User.objects.filter(_admin_site_filter(request), pk=pk).first()
    if user is None:
        return Response({"error": "账号不存在"}, status=status.HTTP_404_NOT_FOUND)

    assignment = UserRole.objects.filter(pk=assignment_id, user=user).select_related("role", "site").first()
    if assignment is None:
        return Response({"error": "该角色分配不存在"}, status=status.HTTP_404_NOT_FOUND)

    # 自我保护：不能移除自己最后一个管理类角色（防止把自己锁在外面）
    if user.pk == request.user.pk:
        remaining = UserRole.objects.filter(user=user).exclude(pk=assignment.pk).count()
        if remaining == 0 and not user.is_superuser:
            return Response(
                {"error": "不能移除自己最后一个角色（会导致失去访问权限）"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        role_name = assignment.role.name
        site_code = assignment.site.code if assignment.site_id else None
        snap = _DeletedSnapshot(
            assignment.pk, user.site_id, "%s ✕ %s" % (user.username, role_name)
        )
        assignment.delete()
        log_audit(
            request,
            action="DELETE",
            entity=snap,
            entity_type="user_role",
            entity_repr="%s ✕ %s" % (user.username, role_name),
            site_id=user.site_id,
            changes={"role": {"old": role_name, "new": None}, "site": {"old": site_code, "new": None}},
        )
    logger.info("role %s removed from %s by %s", role_name, user.username, request.user.username)
    return Response({"status": "removed", "role_name": role_name})


# ---------------------------------------------------------------- 我的权限

@api_view(["GET"])
@permission_classes([IsAdminUser])
def my_permissions(request):
    """当前登录用户的生效权限（供前端菜单控制）。

    - superuser → 全部模块全权限
    - 其他用户 → 其所有未过期角色权限的并集
    """
    user = request.user
    if user.is_superuser:
        return Response({
            "is_superuser": True,
            "permissions": all_permissions(),
            "source": "superuser",
            "note": "超级管理员拥有全部权限",
        })

    perms = {}
    now = timezone.now()
    assignments = (
        UserRole.objects.filter(user=user).select_related("role").prefetch_related()
    )
    for a in assignments:
        if a.expires_at and a.expires_at < now:
            continue  # 已过期
        for key, val in normalize_permissions(a.role.permissions).items():
            cur = perms.setdefault(key, {"view": False, "edit": False})
            cur["view"] = cur["view"] or bool(val.get("view"))
            cur["edit"] = cur["edit"] or bool(val.get("edit"))
    return Response({
        "is_superuser": False,
        "permissions": perms,
        "source": "roles",
        "role_count": len([a for a in assignments if not (a.expires_at and a.expires_at < now)]),
    })
