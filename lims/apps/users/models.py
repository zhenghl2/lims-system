"""User models for LIMS."""
import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils import timezone
from django.conf import settings


class UserManager(BaseUserManager):
    """Custom manager for LIMS User model."""
    def create_user(self, employee_id, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(employee_id=employee_id, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, employee_id, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        return self.create_user(employee_id, email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Custom user model for LIMS."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee_id = models.CharField(max_length=20, unique=True, db_index=True)
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField(max_length=254, unique=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    site = models.ForeignKey(
        "organizations.Site",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )
    phone = models.CharField(max_length=30, blank=True)
    locale = models.CharField(max_length=10, default="en")
    timezone = models.CharField(max_length=50, default="UTC")
    mfa_secret = models.CharField(max_length=255, blank=True, default="")
    mfa_enabled = models.BooleanField(default=False)
    mfa_backup_codes = models.JSONField(null=True, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    last_login = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["employee_id", "email", "first_name", "last_name"]

    objects = UserManager()

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.employee_id})"

    class Meta:
        db_table = "users"
        indexes = [
            models.Index(fields=["employee_id"]),
            models.Index(fields=["email"]),
            models.Index(fields=["site", "is_active"]),
        ]


class Role(models.Model):
    """Roles for RBAC."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=False)
    site = models.ForeignKey(
        "organizations.Site",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="roles",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # 模块权限：{"模块key": {"view": bool, "edit": bool}}
    # 清单见 users/role_modules.py；superuser 恒为全权限，不依赖此字段
    permissions = models.JSONField(default=dict, blank=True, verbose_name="模块权限")

    def __str__(self):
        site_name = self.site.code if self.site else "global"
        return f"{self.name} ({site_name})"

    class Meta:
        db_table = "roles"
        unique_together = [["name", "site"]]
        indexes = [models.Index(fields=["name", "site"])]


class UserRole(models.Model):
    """Many-to-many user-role assignments with site scoping and optional expiry."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="role_assignments")
    role = models.ForeignKey(Role, on_delete=models.CASCADE)
    site = models.ForeignKey("organizations.Site", on_delete=models.CASCADE)
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    expires_at = models.DateTimeField(null=True, blank=True)

    def is_expired(self):
        return self.expires_at and self.expires_at < timezone.now()

    class Meta:
        db_table = "user_roles"
        unique_together = [["user", "role", "site"]]
        indexes = [models.Index(fields=["user", "site"])]
