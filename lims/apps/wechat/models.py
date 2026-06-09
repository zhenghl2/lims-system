from django.conf import settings
from django.db import models


class WechatUser(models.Model):
    """微信小程序用户绑定"""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
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
