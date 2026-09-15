"""Extensions models — 泰国数据生成报告批次."""
from django.conf import settings
from django.db import models


class ThaiReportBatch(models.Model):
    """泰国数据生成报告 — 生成批次（一次生成 = 一个批次，保留历史）."""

    STATUS_CHOICES = [
        ("PENDING", "处理中"),
        ("DONE", "已完成"),
        ("FAILED", "失败"),
    ]

    name = models.CharField(max_length=100, unique=True, verbose_name="批次名")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    patient_file = models.FileField(upload_to="extensions/thai_report/uploads/", verbose_name="样本信息表")
    result_file = models.FileField(upload_to="extensions/thai_report/uploads/", verbose_name="结果表")
    total = models.IntegerField(default=0, verbose_name="样本总数")
    success = models.IntegerField(default=0, verbose_name="成功")
    failed = models.IntegerField(default=0, verbose_name="失败")
    skipped = models.IntegerField(default=0, verbose_name="跳过")
    message = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "泰国报告批次"
        verbose_name_plural = "泰国报告批次"

    def __str__(self):
        return "{} ({})".format(self.name, self.status)


class ThaiReportItem(models.Model):
    """批次内单样本报告记录."""

    batch = models.ForeignKey(ThaiReportBatch, related_name="items", on_delete=models.CASCADE)
    sample_id = models.CharField(max_length=100)
    accession_id = models.CharField(max_length=100, blank=True, default="")
    option = models.CharField(max_length=50, blank=True, default="")
    result_filter = models.CharField(max_length=100, blank=True, default="")
    template = models.CharField(max_length=50, blank=True, default="")
    report_file = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, blank=True, default="")
    message = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["id"]
        verbose_name = "泰国报告样本"
        verbose_name_plural = "泰国报告样本"

    def __str__(self):
        return self.sample_id
