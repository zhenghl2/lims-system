"""Workflow and experiment models."""
import uuid
from django.db import models
from django.conf import settings


class WorkflowProtocol(models.Model):
    """SOP-defined workflow protocol with versioned steps."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    panel = models.ForeignKey("samples.TestPanel", on_delete=models.CASCADE, related_name="protocols")
    name = models.CharField(max_length=100)
    version = models.CharField(max_length=10)  # Semver
    description = models.TextField(blank=True)
    estimated_hours = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    steps_definition = models.JSONField(help_text="JSON array of step definitions")
    validated_at = models.DateTimeField(null=True, blank=True)
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_protocols"
        unique_together = [["panel", "name", "version"]]

    def __str__(self):
        return f"{self.name} v{self.version}"


class SampleRun(models.Model):
    """A sequencing run containing multiple samples."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run_number = models.CharField(max_length=30, db_index=True)
    panel = models.ForeignKey("samples.TestPanel", on_delete=models.PROTECT, related_name="runs")
    protocol = models.ForeignKey(WorkflowProtocol, on_delete=models.PROTECT, null=True, blank=True)
    sequencer = models.ForeignKey("instruments.Instrument", on_delete=models.PROTECT, null=True, blank=True)
    status = models.CharField(
        max_length=20,
        default="PLANNED",
        choices=[
            ("PLANNED", "Planned"),
            ("LIBRARY_PREP", "Library Prep"),
            ("SEQUENCING", "Sequencing"),
            ("ANALYZING", "Analyzing"),
            ("QC_REVIEW", "QC Review"),
            ("COMPLETED", "Completed"),
            ("FAILED", "Failed"),
        ],
        db_index=True,
    )
    planned_date = models.DateField(null=True, blank=True)
    start_date = models.DateTimeField(null=True, blank=True)
    end_date = models.DateTimeField(null=True, blank=True)
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    site = models.ForeignKey("organizations.Site", on_delete=models.PROTECT, related_name="runs")
    barcode = models.CharField(max_length=50, blank=True, db_index=True)  # Run-level barcode / batch ID
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sample_runs"
        ordering = ["-created_at"]

    def __str__(self):
        return self.run_number


class RunSample(models.Model):
    """Association between a sample and a run (position, index, etc.)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(SampleRun, on_delete=models.CASCADE, related_name="run_samples")
    sample = models.ForeignKey("samples.Sample", on_delete=models.CASCADE, related_name="run_samples")
    well_position = models.CharField(max_length=5, blank=True)  # 'A01', 'B03'
    plate_number = models.PositiveIntegerField(default=1)
    index_sequence = models.CharField(max_length=50, blank=True)  # UDI combo
    index_combo_id = models.CharField(max_length=20, blank=True)
    pool_group = models.CharField(max_length=20, blank=True)
    barcode = models.CharField(max_length=50, blank=True)  # Library/barcode for this run
    status = models.CharField(
        max_length=20,
        default="QUEUED",
        choices=[
            ("QUEUED", "Queued"), ("IN_PROGRESS", "In Progress"), ("SEQUENCED", "Sequenced"),
            ("ANALYZED", "Analyzed"), ("PASSED_QC", "Passed QC"), ("FAILED_QC", "Failed QC"),
        ],
        db_index=True,
    )
    result_summary = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "run_samples"
        unique_together = [["run", "sample"]]

    def __str__(self):
        return f"{self.run.run_number} - {self.sample.sample_id}"


class WorkflowStep(models.Model):
    """Individual step execution within a run."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(SampleRun, on_delete=models.CASCADE, related_name="steps")
    sample = models.ForeignKey("samples.Sample", on_delete=models.CASCADE, null=True, blank=True, related_name="steps")
    step_id = models.CharField(max_length=50)
    step_name = models.CharField(max_length=100)
    step_order = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        default="PENDING",
        choices=[
            ("PENDING", "Pending"), ("IN_PROGRESS", "In Progress"),
            ("COMPLETED", "Completed"), ("SKIPPED", "Skipped"), ("FAILED", "Failed"),
        ],
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    reagents_used = models.JSONField(default=list, blank=True)  # List of lot IDs
    instrument = models.ForeignKey("instruments.Instrument", on_delete=models.PROTECT, null=True, blank=True)
    observations = models.TextField(blank=True)
    deviation_flag = models.BooleanField(default=False)
    deviation_note = models.TextField(blank=True)

    # NIPPT: structured step data + QC tracking
    step_data = models.JSONField(default=dict, blank=True)
    qc_status = models.CharField(
        max_length=20,
        default="PENDING",
        choices=[
            ("PENDING", "Pending QC"),
            ("PASS", "Passed QC"),
            ("FAIL", "Failed QC"),
            ("NA", "Not Applicable"),
        ],
    )
    qc_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="qc_steps"
    )
    qc_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_steps"
        ordering = ["run", "step_order"]
