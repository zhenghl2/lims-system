"""NIPT 实验流程「分步批次」——阶段2：提取 + 建库。

依据：`~/.hermes/plans/nipt-step-modularization-design.md` v1.3 §15
- **只新增表**：不修改 `workflows` 现有模型，`SampleRun/RunSample` 保留为兼容镜像
- 批次号 **max+1**：`NIPT-EXT-YYYYMMDD-NNN` / `NIPT-LIB-YYYYMMDD-NNN`
- 数据 JSON 沿用现有结构（`extraction_data` / `library_data`）→ 5 个实验组件零改动
- 上游指针式汇流：`NiptLibrarySample.source_extraction_sample_id`
  → 多个提取批次的样本可以一起进同一个建库批次（M:N，无需关联表）
"""
import uuid

from django.conf import settings
from django.db import models

NIPT_PANEL_CODES = ("NIPT", "NIPT_PLUS", "NIPT_FULL", "twin_basic")


class _StepBatch(models.Model):
    """批次公共字段（抽象基类，不建表）。"""

    class Meta:
        abstract = True

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default="DRAFT", db_index=True,
                              choices=[("DRAFT", "草稿"), ("IN_PROGRESS", "进行中"),
                                       ("COMPLETED", "已完成"), ("CANCELLED", "已取消")])
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                   null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def _next_number(cls, prefix):
        """max+1（勿用 count()+1：删批次留洞后会撞已有序号）。"""
        last = (cls.objects.filter(batch_number__startswith=prefix)
                .order_by("-batch_number").values_list("batch_number", flat=True).first())
        seq = int(last.rsplit("-", 1)[1]) + 1 if last else 1
        return "%s%03d" % (prefix, seq)


class _StepSample(models.Model):
    """样本公共字段（抽象基类，不建表）。"""

    class Meta:
        abstract = True

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sample = models.ForeignKey("samples.Sample", on_delete=models.CASCADE, related_name="+")
    patient_name = models.CharField(max_length=200, blank=True, default="")
    sample_source = models.CharField(max_length=50, blank=True, default="")
    is_qc = models.BooleanField(default=False, help_text="质控品（QC）")
    well_position = models.CharField(max_length=5, blank=True, default="")
    plate_number = models.PositiveIntegerField(default=1)
    index_sequence = models.CharField(max_length=50, blank=True, default="")
    index_combo_id = models.CharField(max_length=20, blank=True, default="")
    pool_group = models.CharField(max_length=20, blank=True, default="")
    barcode = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=20, default="QUEUED", db_index=True,
                              choices=[("QUEUED", "排队"), ("IN_PROGRESS", "进行中"),
                                       ("PASSED_QC", "QC 通过"), ("FAILED_QC", "QC 失败")])
    result_summary = models.JSONField(default=dict, blank=True)
    qc_status = models.CharField(max_length=10, blank=True, default="",
                                 choices=[("", "未判"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                 null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class NiptExtractionBatch(_StepBatch):
    """提取批次（NIPT-EXT-YYYYMMDD-NNN）。"""

    extraction_data = models.JSONField(default=dict, blank=True)
    extraction_method = models.CharField(max_length=20, blank=True, default="")
    region = models.CharField(max_length=20, blank=True, default="")   # 厦门 / 香港

    class Meta:
        db_table = "nipt_extraction_batches"
        ordering = ["-created_at"]
        verbose_name = "NIPT 提取批次"

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        return cls._next_number("NIPT-EXT-%s-" % timezone.localdate().strftime("%Y%m%d"))


class NiptExtractionSample(_StepSample):
    """提取批次内的样本行（上游 = 血浆分离 / 收样样本本身）。"""

    batch = models.ForeignKey(NiptExtractionBatch, on_delete=models.CASCADE, related_name="samples")
    source_plasma_sample_id = models.UUIDField(null=True, blank=True,
                                               help_text="上游血浆分离样本行 id（阶段3 起使用）")

    class Meta:
        db_table = "nipt_extraction_samples"
        unique_together = ("batch", "sample")
        ordering = ["created_at"]


class NiptLibraryBatch(_StepBatch):
    """建库批次（NIPT-LIB-YYYYMMDD-NNN），可汇入多个提取批次的样本。"""

    library_data = models.JSONField(default=dict, blank=True)
    library_method = models.CharField(max_length=20, blank=True, default="")
    region = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        db_table = "nipt_library_batches"
        ordering = ["-created_at"]
        verbose_name = "NIPT 建库批次"

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        return cls._next_number("NIPT-LIB-%s-" % timezone.localdate().strftime("%Y%m%d"))


class NiptLibrarySample(_StepSample):
    """建库样本行；source_extraction_sample_id 是 M:N 汇流的关键（指向上游提取行）。"""

    batch = models.ForeignKey(NiptLibraryBatch, on_delete=models.CASCADE, related_name="samples")
    source_extraction_sample_id = models.UUIDField(null=True, blank=True, db_index=True)
    library_method = models.CharField(max_length=20, blank=True, default="")
    adapter_type = models.CharField(max_length=50, blank=True, default="")
    pcr_cycles = models.PositiveSmallIntegerField(null=True, blank=True)
    library_concentration = models.FloatField(null=True, blank=True)

    class Meta:
        db_table = "nipt_library_samples"
        unique_together = ("batch", "sample")
        ordering = ["created_at"]
