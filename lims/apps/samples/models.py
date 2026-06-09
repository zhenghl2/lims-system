"""Sample management models."""
import uuid
from django.db import models
from django.conf import settings
from lims.apps.organizations.models import Receiver


class SampleType(models.Model):
    """Type of sample (plasma, cervical swab, etc.)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)  # 'PLASMA_CFDNA', 'CERVICAL_SWAB'
    name = models.CharField(max_length=100)
    collection_tube = models.CharField(max_length=200, blank=True)  # 'Streck Cell-Free DNA BCT'
    storage_temp = models.CharField(max_length=20, blank=True)  # '-80C', '4C'
    retention_days = models.PositiveIntegerField(default=365)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "sample_types"

    def __str__(self):
        return self.name


class TestPanel(models.Model):
    """NGS test panel definition."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, db_index=True)  # 'NIPT', 'NIPT_PLUS', 'HPV'
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    sop_document = models.ForeignKey(
        "documents.Document",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    turnaround_days = models.PositiveIntegerField(default=7)
    report_template_code = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    site = models.ForeignKey(
        "organizations.Site",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="test_panels",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "test_panels"
        unique_together = [["code", "site"]]

    def __str__(self):
        return f"{self.code} - {self.name}"


class Sample(models.Model):
    """Main sample record."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sample_id = models.CharField(max_length=50, unique=True, db_index=True)
    additional_barcodes = models.JSONField(default=list, blank=True)
    sample_type = models.ForeignKey(SampleType, on_delete=models.PROTECT)
    patient_id = models.CharField(max_length=50, blank=True, db_index=True)
    patient_name = models.CharField(max_length=200, blank=True)
    patient_dob = models.DateField(null=True, blank=True)
    gestational_weeks = models.PositiveSmallIntegerField(null=True, blank=True)
    patient_sex = models.CharField(max_length=1, blank=True, choices=[("M", "Male"), ("F", "Female")])
    age = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Age in years")
    source_institution = models.CharField(max_length=200, blank=True, help_text="Source institution")
    institution_sample_id = models.CharField(max_length=100, blank=True, help_text="Institution sample ID")
    hpv_sample_type = models.CharField(
        max_length=20, blank=True,
        choices=[("CERVICAL_CELLS", "Cervical Exfoliated Cells"), ("CERVICAL_SWAB", "Cervical Swab")],
        help_text="HPV sample type: cervical exfoliated cells or cervical swab",
    )
    test_item = models.CharField(
        max_length=20, blank=True,
        choices=[("HPV_15", "HPV 15-Type"), ("HPV_23", "HPV 23-Type")],
        help_text="HPV test item: 15-type or 23-type panel",
    )
    ordering_physician = models.CharField(max_length=200, blank=True)
    ordering_facility = models.CharField(max_length=200, blank=True)
    panel = models.ForeignKey(
        "TestPanel",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="samples",
    )
    collection_date = models.DateField()
    collection_time = models.TimeField(null=True, blank=True)
    receipt_date = models.DateField()
    receipt_time = models.TimeField()
    receipt_temp = models.CharField(max_length=10, blank=True)
    received_by = models.ForeignKey(Receiver, on_delete=models.SET_NULL, null=True, blank=True, related_name="received_samples")
    transport_time_days = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    status = models.CharField(
        max_length=20,
        default="REGISTERED",
        choices=[
            ("REGISTERED", "Registered"),
            ("RECEIVED", "Received"),
            ("REJECTED", "Rejected"),
            ("IN_PROCESS", "In Process"),
            ("TESTING", "Testing"),
            ("ANALYZING", "Analyzing"),
            ("COMPLETED", "Completed"),
            ("REPORTED", "Reported"),
            ("ARCHIVED", "Archived"),
            ("DISPOSED", "Disposed"),
        ],
        db_index=True,
    )
    rejection_reason = models.CharField(max_length=100, blank=True)
    rejection_note = models.TextField(blank=True)
    rejection_handling = models.TextField(blank=True)
    rejection_communication = models.TextField(blank=True)
    consent_given = models.BooleanField(null=True, blank=True)
    consent_date = models.DateField(null=True, blank=True)
    site = models.ForeignKey("organizations.Site", on_delete=models.PROTECT, related_name="samples", null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Soft delete support
    is_deleted = models.BooleanField(default=False, db_index=True)
    image = models.ImageField(upload_to="samples/", null=True, blank=True)

    class Meta:
        db_table = "samples"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["site", "is_deleted", "status"]),
            models.Index(fields=["site", "receipt_date"]),
            models.Index(fields=["patient_id", "site"]),
        ]

    def __str__(self):
        return f"{self.sample_id} ({self.status})"


class SamplePhoto(models.Model):
    """Photo taken during sample receiving — can link to multiple samples."""
    image = models.ImageField(upload_to="sample_photos/%Y/%m/")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Photo {self.id} — {self.created_at:%Y-%m-%d %H:%M}"


class SampleMovement(models.Model):
    """Chain of custody — every sample movement is logged."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sample = models.ForeignKey(Sample, on_delete=models.CASCADE, related_name="movements")
    from_location = models.CharField(max_length=200, blank=True)
    to_location = models.CharField(max_length=200)
    reason = models.CharField(max_length=100)  # 'PROCESSING', 'STORAGE', 'DISPOSAL'
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    performed_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "sample_movements"
        ordering = ["performed_at"]

    def __str__(self):
        return f"{self.sample.sample_id}: {self.from_location} → {self.to_location}"


class SampleAliquot(models.Model):
    """Aliquots derived from parent samples."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent_sample = models.ForeignKey(Sample, on_delete=models.CASCADE, related_name="aliquots")
    child_sample = models.ForeignKey(Sample, on_delete=models.CASCADE, related_name="parent_of")
    aliquot_type = models.CharField(max_length=50)  # 'PLASMA', 'EXTRACTED_DNA', 'LIBRARY'
    volume_ml = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    sample_id = models.CharField(max_length=50, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sample_aliquots"
