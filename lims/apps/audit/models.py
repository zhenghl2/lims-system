"""Audit trail models — append-only, tamper-evident."""
import hashlib
import json
import uuid

from django.db import models
from django.utils import timezone


class AuditLog(models.Model):
    """Immutable audit log with hash chain integrity."""
    id = models.BigAutoField(primary_key=True)

    action = models.CharField(max_length=20, db_index=True)  # CREATE, UPDATE, DELETE, LOGIN, SIGN, etc.
    user_id = models.UUIDField(db_index=True)
    user_email = models.CharField(max_length=254)
    user_role = models.CharField(max_length=100, blank=True)

    entity_type = models.CharField(max_length=50, db_index=True)  # 'sample', 'report', etc.
    entity_id = models.UUIDField(db_index=True)
    entity_repr = models.CharField(max_length=500, blank=True)  # Human-readable

    changes = models.JSONField(default=dict, blank=True)  # {"field": {"old": "A", "new": "B"}}

    site_id = models.UUIDField(db_index=True, null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    session_id = models.CharField(max_length=100, blank=True)
    request_id = models.CharField(max_length=50, blank=True)
    timestamp = models.DateTimeField(db_index=True, default=timezone.now)

    # Tamper-evident hash chain
    previous_hash = models.CharField(max_length=128, blank=True, default="")
    row_hash = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        db_table = "audit_logs"
        ordering = ["timestamp"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["user_id"]),
            models.Index(fields=["action"]),
        ]

    @staticmethod
    def compute_row_hash(action, user_email, entity_type, entity_id, changes, timestamp, previous_hash):
        """单条记录的哈希。changes 用 sort_keys 保证 dict 顺序不影响结果。"""
        changes_repr = json.dumps(changes or {}, sort_keys=True, ensure_ascii=False, default=str)
        payload = f"{action}|{user_email}|{entity_type}|{entity_id}|{changes_repr}|{timestamp}|{previous_hash}"
        return hashlib.sha512(payload.encode()).hexdigest()

    def save(self, *args, **kwargs):
        """Auto-compute hash on save（串链：previous_hash 取上一条的 row_hash）。"""
        if not self.timestamp:
            self.timestamp = timezone.now()
        if not self.previous_hash:
            last = AuditLog.objects.order_by("-timestamp", "-id").first()
            self.previous_hash = last.row_hash if last else "0" * 128  # Genesis
        self.row_hash = self.compute_row_hash(
            self.action, self.user_email, self.entity_type, self.entity_id,
            self.changes, self.timestamp, self.previous_hash,
        )
        super().save(*args, **kwargs)


def verify_audit_chain():
    """Verify entire audit log chain integrity. Returns list of broken row ids."""
    broken = []
    prev_hash = "0" * 128
    for log in AuditLog.objects.order_by("timestamp", "id"):
        if log.previous_hash != prev_hash:
            broken.append(log.id)
        expected = AuditLog.compute_row_hash(
            log.action, log.user_email, log.entity_type, log.entity_id,
            log.changes, log.timestamp, prev_hash,
        )
        if log.row_hash != expected:
            broken.append(log.id)
        prev_hash = log.row_hash
    return broken
