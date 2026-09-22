"""Audit helpers — 统一写入审计日志（append-only + hash 链）。

用法：
    from lims.apps.audit.utils import log_audit
    log_audit(request, "CREATE", case, changes={"case_number": {"old": "", "new": "N-1"}})
"""
import logging

from django.contrib.auth import get_user_model

from .models import AuditLog

logger = logging.getLogger(__name__)


def _client_ip(request):
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_audit(request, action, entity, changes=None, entity_type=None, entity_repr="", site_id=None):
    """写一条审计记录。

    request   : DRF/Django request（可为 None，用于脚本/管理命令）
    action    : CREATE / UPDATE / DELETE / RECEIVE / REJECT / IMPORT ...
    entity    : 模型实例或 UUID
    changes   : {"字段": {"old": ..., "new": ...}}
    """
    try:
        entity_id = getattr(entity, "pk", entity)
        if entity_type is None:
            entity_type = entity.__class__.__name__.lower() if hasattr(entity, "__class__") else "unknown"
        if not entity_repr and hasattr(entity, "__str__"):
            try:
                entity_repr = str(entity)[:500]
            except Exception:
                entity_repr = ""
        if site_id is None:
            site_id = getattr(entity, "site_id", None)

        user = getattr(request, "user", None) if request else None
        is_authed = bool(user and getattr(user, "is_authenticated", False))

        AuditLog.objects.create(
            action=action,
            user_id=getattr(user, "id", None) or __import__("uuid").UUID(int=0),
            user_email=(getattr(user, "email", "") or getattr(user, "username", ""))[:254] if is_authed else "",
            user_role=(getattr(user, "role", "") or "")[:100] if is_authed else "",
            entity_type=(entity_type or "unknown")[:50],
            entity_id=entity_id,
            entity_repr=(entity_repr or "")[:500],
            changes=changes or {},
            site_id=site_id,
            ip_address=_client_ip(request) if request else None,
            user_agent=(request.META.get("HTTP_USER_AGENT", "") if request else "")[:2000],
            request_id=(request.META.get("HTTP_X_REQUEST_ID", "") if request else "")[:50],
        )
    except Exception as exc:  # 审计失败绝不能影响主业务
        logger.warning("log_audit failed: %s", exc)


def diff_changes(instance, before, fields):
    """对比改动前后，生成 changes 结构。before 是 {field: old_value} 快照。"""
    out = {}
    for f in fields:
        old = before.get(f)
        new = getattr(instance, f, None)
        if str(old) != str(new):
            out[f] = {"old": old, "new": new}
    return out
