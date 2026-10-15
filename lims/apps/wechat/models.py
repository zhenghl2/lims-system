import uuid

from django.conf import settings
from django.db import models


class WechatUser(models.Model):
    """微信小程序用户绑定"""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="wechat_user",
    )
    openid = models.CharField(max_length=64, unique=True)
    unionid = models.CharField(max_length=64, null=True, blank=True)
    nickname = models.CharField(max_length=128, null=True, blank=True)
    avatar_url = models.URLField(max_length=512, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wechat_users"
        verbose_name = "微信用户"
        verbose_name_plural = "微信用户"

    def __str__(self):
        return f"{self.user.username} → {self.openid[:12]}..."


class SalesApplication(models.Model):
    """销售自助注册申请。

    正式做法：申请与账号分离。
      - 申请记录永久保留（含拒绝的），形成完整申请历史
      - 只有审核通过才创建 User，保证 users 表只放真实可用账号
    """

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_PENDING, "待审核"),
        (STATUS_APPROVED, "已通过"),
        (STATUS_REJECTED, "已拒绝"),
    ]

    # 被拒后重新申请的冷却小时数。当前为 0 = 可立即重新提交
    # （同事首次登记容易输错姓名/手机号，需要即时改正后重提；
    #   若日后要防恶意重复提交，把这里改回小时数即可，校验逻辑会自动生效）
    RESUBMIT_COOLDOWN_HOURS = 0

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=32, unique=True, db_index=True, verbose_name="申请编号")
    openid = models.CharField(max_length=64, db_index=True)
    unionid = models.CharField(max_length=64, null=True, blank=True)
    real_name = models.CharField(max_length=150, verbose_name="姓名")
    phone = models.CharField(max_length=30, db_index=True, verbose_name="手机号")
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    site = models.ForeignKey(
        "organizations.Site", on_delete=models.PROTECT, related_name="sales_applications"
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_applications",
    )
    reviewer_name = models.CharField(max_length=150, blank=True, verbose_name="审核人姓名快照")
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name="审核时间")
    reject_reason = models.TextField(blank=True, verbose_name="拒绝原因")
    created_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="source_application",
        verbose_name="审核通过后创建的账号",
    )
    initial_password_shown_at = models.DateTimeField(
        null=True, blank=True, verbose_name="初始密码查看时间"
    )
    # 姓名与已有账号同名时记录下来，供管理员在审核时决定"关联"还是"新建"
    # （方案A：绝不自动关联 —— 姓名不是凭证，自动关联等于任何人填同名即可夺取账号）
    matched_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="matched_application",
        verbose_name="疑似关联的已有账号",
    )
    matched_note = models.CharField(
        max_length=200, blank=True, verbose_name="疑似关联说明"
    )
    remark = models.TextField(blank=True, verbose_name="管理员备注")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "wechat_sales_applications"
        verbose_name = "销售注册申请"
        verbose_name_plural = "销售注册申请"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["phone"]),
            models.Index(fields=["openid"]),
        ]

    def __str__(self):
        return f"{self.code} {self.real_name} ({self.get_status_display()})"

    @property
    def is_final(self):
        return self.status in (self.STATUS_APPROVED, self.STATUS_REJECTED)
