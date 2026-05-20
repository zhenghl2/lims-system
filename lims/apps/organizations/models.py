"""Organization and Site models."""
import uuid
from django.db import models

class Site(models.Model):
    """Represents a laboratory site."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=10, unique=True, db_index=True)  # 'US-LA', 'CN-SH'
    name_en = models.CharField(max_length=200)
    name_local = models.CharField(max_length=200, blank=True)
    country = models.CharField(max_length=2)  # ISO 3166-1 alpha-2
    timezone = models.CharField(max_length=50, default="UTC")
    locale = models.CharField(max_length=10, default="en")
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    cap_number = models.CharField(max_length=20, blank=True)
    clia_number = models.CharField(max_length=20, blank=True)
    allowed_panels = models.JSONField(default=list, blank=True, help_text="Panel codes this site can access. Empty list = all panels accessible.")
    is_active = models.BooleanField(default=True)
    data_residency = models.CharField(max_length=20, default="central")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.code} - {self.name_en}"

    class Meta:
        db_table = "sites"
        ordering = ["code"]

class Department(models.Model):
    """Department within a site."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name="departments")
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "departments"
        unique_together = [["site", "code"]]

class Receiver(models.Model):
    """Sample receiving personnel with password verification."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, db_index=True)
    password = models.CharField(max_length=128)  # hashed with make_password
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = "receivers"
        ordering = ["name"]

