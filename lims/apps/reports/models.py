"""Report management models."""
import uuid
from django.db import models
from django.conf import settings


class ReportTemplate(models.Model):
    """Configurable report template per panel and language."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    panel = models.ForeignKey("samples.TestPanel", on_delete=models.CASCADE, related_name="report_templates")
    code = models.CharField(max_length=50)  # 'nipt_v2_en'
    name = models.CharField(max_length=100)
    language = models.CharField(max_length=10)  # 'en', 'zh', 'pt', 'th'
    version = models.PositiveIntegerField(default=1)
    template_content = models.JSONField(default=dict)  # {"header":..., "sections":..., "footer":...}
    site = models.ForeignKey("organizations.Site", on_delete=models.PROTECT, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "report_templates"
        ordering = ["panel_id", "-version"]

    def __str__(self):
        return f"{self.code} v{self.version}"


class Report(models.Model):
    """Generated report."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report_number = models.CharField(max_length=30, unique=True, db_index=True)
    sample = models.ForeignKey("samples.Sample", on_delete=models.PROTECT, related_name="reports")
    run_sample = models.ForeignKey("workflows.RunSample", on_delete=models.SET_NULL, null=True, blank=True)
    template = models.ForeignKey(ReportTemplate, on_delete=models.PROTECT)
    content = models.JSONField(default=dict)  # Report data fields
    pdf_file_path = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, default="DRAFT", choices=[
        ("DRAFT","Draft"),("REVIEWED","Reviewed"),("VERIFIED","Verified"),
        ("SIGNED","Signed"),("RELEASED","Released"),("AMENDED","Amended"),
    ], db_index=True)
    version_number = models.PositiveIntegerField(default=1)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="reports_reviewed")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="reports_verified")
    verified_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="reports_signed")
    signed_at = models.DateTimeField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    amendment_reason = models.TextField(blank=True)
    original_report = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="amendments")
    site = models.ForeignKey("organizations.Site", on_delete=models.PROTECT, related_name="reports")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "reports"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.report_number} ({self.status})"


class ElectronicSignature(models.Model):
    """21 CFR Part 11 electronic signatures."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entity_type = models.CharField(max_length=50)  # 'report', 'sop', 'deviation'
    entity_id = models.UUIDField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=50)  # 'REVIEW', 'VERIFY', 'SIGN', 'AMEND'
    meaning = models.CharField(max_length=200)
    re_auth_timestamp = models.DateTimeField(auto_now_add=True)
    signed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    document_hash = models.CharField(max_length=128, blank=True)  # SHA-512 of signed content

    class Meta:
        db_table = "electronic_signatures"
        ordering = ["-signed_at"]
