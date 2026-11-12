"""Notification models."""
import uuid
from django.db import models
from django.conf import settings


class Notification(models.Model):
    """In-app notification."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    notification_type = models.CharField(max_length=50)
    title = models.CharField(max_length=200)
    message = models.TextField()
    link = models.CharField(max_length=500, blank=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "is_read"])]

    def __str__(self):
        return f"[{'UNREAD' if not self.is_read else 'READ'}] {self.title}"


class ReminderRoute(models.Model):
    """到期提醒路由：样本来源 → 接收人（用户表里的账号，取其 email）。

    例：巴西 / 泰国 → 吴梦婷（wumt@vangenes.com）。精确匹配优先，其次前缀匹配。
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.CharField(max_length=50, unique=True, help_text="样本来源（巴西 / 泰国 / 巴西万基…）")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reminder_routes")
    is_active = models.BooleanField(default=True)
    note = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reminder_routes"
        ordering = ["source"]

    def __str__(self):
        return f"{self.source} → {self.user_id}"


class ReminderLog(models.Model):
    """发送日志（幂等键：subject + milestone + due_date）。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_type = models.CharField(max_length=10, default="case")
    subject_id = models.UUIDField()
    subject_repr = models.CharField(max_length=50, blank=True, default="")
    case_number = models.CharField(max_length=50, blank=True, default="", db_index=True)
    milestone = models.CharField(max_length=10)          # T3 / T1
    due_date = models.DateField()
    recipient = models.EmailField()
    status = models.CharField(max_length=10, default="SENT")   # SENT / FAILED
    error = models.TextField(blank=True, default="")
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reminder_logs"
        unique_together = [("subject_type", "subject_id", "milestone", "due_date")]
        indexes = [models.Index(fields=["due_date", "milestone"])]
        ordering = ["-sent_at"]

    def __str__(self):
        return f"{self.case_number} {self.milestone} {self.due_date} → {self.recipient}"
