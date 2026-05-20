import uuid
from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL


class HpvBatch(models.Model):
    """HPV analysis batch — groups samples through the full workflow."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)

    panel = models.ForeignKey(
        "samples.TestPanel", on_delete=models.PROTECT, related_name="hpv_batches"
    )
    site = models.ForeignKey(
        "organizations.Site", on_delete=models.PROTECT, related_name="hpv_batches"
    )

    status = models.CharField(
        max_length=20, default="PLANNED", db_index=True,
        choices=[
            ("PLANNED", "已规划"),
            ("EXTRACTION", "核酸提取中"),
            ("PCR", "PCR 扩增中"),
            ("HYBRIDIZATION", "杂交显色中"),
            ("RESULT_ENTRY", "结果录入中"),
            ("IN_REVIEW", "复核中"),
            ("REVIEWED", "已复核"),
            ("COMPLETED", "已完成"),
            ("FAILED", "已失败"),
        ],
    )

    extraction_data = models.JSONField(default=dict, blank=True)
    pcr_data = models.JSONField(default=dict, blank=True)
    hybridization_data = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="hpv_batches_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "hpv_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number


class HpvWellPosition(models.Model):
    """Maps a sample to a well position in a batch."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        HpvBatch, on_delete=models.CASCADE, related_name="well_positions"
    )
    well_label = models.CharField(max_length=6)
    sample = models.ForeignKey(
        "samples.Sample", on_delete=models.PROTECT, related_name="hpv_well_positions",
        null=True, blank=True
    )
    barcode = models.CharField(max_length=100, blank=True)
    internal_number = models.CharField(max_length=20, blank=True)
    membrane_strip_number = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "hpv_well_positions"
        unique_together = [("batch", "well_label")]
        ordering = ["well_label"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.well_label} / {self.sample.sample_id}"


class HpvResult(models.Model):
    """Per-sample HPV genotyping result matrix."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        HpvBatch, on_delete=models.CASCADE, related_name="results"
    )
    sample = models.ForeignKey(
        "samples.Sample", on_delete=models.PROTECT, related_name="hpv_results"
    )
    well_position = models.ForeignKey(
        HpvWellPosition, on_delete=models.PROTECT, null=True, blank=True
    )

    kit_type = models.CharField(
        max_length=10,
        choices=[("HPV_15", "15-Type"), ("HPV_23", "23-Type")],
    )

    genotype_results = models.JSONField(default=dict)
    ic_result = models.CharField(
        max_length=1, default="",
        choices=[("+", "阳性"), ("-", "阴性"), ("", "未判读")],
    )
    biotin_result = models.CharField(
        max_length=1, default="",
        choices=[("+", "显色"), ("-", "未显色"), ("", "未判读")],
    )

    auto_interpretation = models.CharField(max_length=30, blank=True)

    review_status = models.CharField(
        max_length=20, default="DRAFT", db_index=True,
        choices=[
            ("DRAFT", "草稿"),
            ("PENDING_REVIEW", "待复核"),
            ("REVIEWED", "已复核"),
            ("REJECTED", "退回修改"),
            ("NEEDS_RETEST", "需复查"),
        ],
    )

    reviewer_1 = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True,
        related_name="hpv_results_1st"
    )
    reviewer_2 = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True,
        related_name="hpv_results_2nd"
    )

    modification_log = models.JSONField(default=list, blank=True)
    rejection_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "hpv_results"
        unique_together = [("batch", "sample")]
        ordering = ["well_position__well_label"]

    def __str__(self):
        return f"{self.sample.sample_id} / {self.kit_type} / {self.review_status}"


class HpvMembranePhoto(models.Model):
    """Membrane strip photo — required before result entry."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        HpvBatch, on_delete=models.CASCADE, related_name="membrane_photos"
    )
    sample = models.ForeignKey(
        "samples.Sample", on_delete=models.PROTECT, related_name="hpv_membrane_photos"
    )

    image = models.ImageField(upload_to="hpv/membrane_photos/%Y/%m/")

    well_position = models.CharField(max_length=10, blank=True)

    uploaded_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="hpv_membrane_photos_uploaded"
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "hpv_membrane_photos"
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.well_position} / photo"


class HpvRetestRecord(models.Model):
    """Retest record — triggered when sample needs re-examination."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    original_sample = models.ForeignKey(
        "samples.Sample", on_delete=models.PROTECT,
        related_name="hpv_retest_originals"
    )
    original_batch = models.ForeignKey(
        HpvBatch, on_delete=models.PROTECT, related_name="retest_originals"
    )

    new_batch = models.ForeignKey(
        HpvBatch, on_delete=models.PROTECT, null=True, blank=True,
        related_name="retest_new"
    )

    retest_date = models.DateField()
    retest_reason = models.CharField(
        max_length=50,
        choices=[
            ("POSITIVE", "阳性结果复查"),
            ("IC_NO_SIGNAL", "IC 无信号"),
            ("QC_FAILURE", "质控失控"),
            ("OTHER", "其他原因"),
        ],
    )

    original_result = models.JSONField(default=dict, blank=True)
    original_interpretation = models.CharField(max_length=30, blank=True)

    retest_result = models.JSONField(default=dict, blank=True)
    retest_interpretation = models.CharField(max_length=30, blank=True)

    final_hpv_genotype = models.CharField(max_length=100, blank=True)

    report_opinion = models.CharField(
        max_length=30, blank=True,
        choices=[
            ("REPORTABLE", "可出报告"),
            ("RESAMPLE", "需重新采样"),
            ("PENDING", "待定"),
        ],
    )

    operator = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True,
        related_name="hpv_retests_operated"
    )
    reviewer = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True,
        related_name="hpv_retests_reviewed"
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hpv_retest_records"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Retest: {self.original_sample.sample_id} → {self.retest_reason}"
