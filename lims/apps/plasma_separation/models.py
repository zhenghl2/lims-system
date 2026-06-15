
"""Plasma separation pre-processing module for NIPT samples."""
import uuid
from django.db import models
from django.conf import settings


class PlasmaSeparationBatch(models.Model):
    """A batch of samples processed together for plasma separation (centrifugation)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    experiment_date = models.DateField()
    experiment_time = models.TimeField()
    equipment_type = models.CharField(
        max_length=50, blank=True, default="HIGH_SPEED",
        help_text="Comma-separated: HIGH_SPEED,LOW_SPEED"
    )
    status = models.CharField(
        max_length=20,
        default="IN_PROGRESS",
        choices=[
            ("IN_PROGRESS", "In Progress"),
            ("COMPLETED", "Completed"),
        ],
        db_index=True,
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True, related_name="plasma_batches_operated"
    )
    operator_signature = models.ImageField(upload_to="plasma_separation/signatures/", null=True, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True, related_name="plasma_batches_reviewed"
    )
    reviewer_signature = models.ImageField(upload_to="plasma_separation/signatures/", null=True, blank=True)
    operator_signature_data = models.JSONField(default=dict, blank=True, help_text="operator {username, signed_at}")
    reviewer_signature_data = models.JSONField(default=dict, blank=True, help_text="reviewer {username, signed_at}")
    notes = models.TextField(blank=True, default="")
    site = models.ForeignKey(
        "organizations.Site", on_delete=models.PROTECT,
        related_name="plasma_batches", null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "plasma_separation_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number


class PlasmaSeparationSample(models.Model):
    """Association between a batch and a sample with individual QC result."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        PlasmaSeparationBatch, on_delete=models.CASCADE,
        related_name="batch_samples"
    )
    sample = models.ForeignKey(
        "samples.Sample", on_delete=models.CASCADE,
        related_name="plasma_separation_results"
    )
    qc_result = models.CharField(
        max_length=20,
        default="PENDING",
        choices=[
            ("PENDING", "Pending"),
            ("PASS", "Pass"),
            ("FAIL", "Fail"),
        ],
    )
    qc_reason = models.CharField(max_length=50, blank=True, default="")
    notes = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        db_table = "plasma_separation_samples"
        unique_together = [["batch", "sample"]]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.sample.sample_id}"


class PlasmaSeparationPhoto(models.Model):
    """Photos documenting the plasma separation batch."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        PlasmaSeparationBatch, on_delete=models.CASCADE,
        related_name="photos"
    )
    image = models.ImageField(upload_to="plasma_separation/photos/")
    caption = models.CharField(max_length=100, blank=True, default="")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "plasma_separation_photos"

    def __str__(self):
        return f"Photo {self.id} for {self.batch.batch_number}"
