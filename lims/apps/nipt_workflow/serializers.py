"""NIPT 分步批次序列化器（阶段2：提取 / 建库）。

⚠️ 关键：样本序列化字段**逐一对齐 `workflows.serializers.RunSampleSerializer`**
（`sample_barcode` / `sample_patient_name` / `well_position` / `plate_number` / …），
这样 5 个实验组件不用改一行渲染逻辑，只换接口地址。
"""
from rest_framework import serializers

from .models import (NiptExtractionBatch, NiptExtractionSample,
                     NiptLibraryBatch, NiptLibrarySample)


class _StepSampleSerializer(serializers.ModelSerializer):
    """与 RunSampleSerializer 同构的样本输出。"""

    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True)
    sample_vg_id = serializers.CharField(source="sample.vg_id", read_only=True, default="")
    sample_patient_id = serializers.CharField(source="sample.patient_id", read_only=True, default="")
    sample_patient_name = serializers.SerializerMethodField()
    sample_multiple_gestation = serializers.BooleanField(source="sample.multiple_gestation",
                                                         read_only=True, default=False)
    sample_gestational_weeks = serializers.IntegerField(source="sample.gestational_weeks",
                                                        read_only=True, default=None)
    sample_test_option = serializers.CharField(source="sample.test_option", read_only=True, default="")
    sample_status = serializers.CharField(source="sample.status", read_only=True, default="")
    sample_plasma_remaining = serializers.IntegerField(source="sample.plasma_remaining",
                                                       read_only=True, default=0)
    sample_retest_flag = serializers.CharField(source="sample.retest_flag", read_only=True, default="")
    sample_report_code = serializers.CharField(source="sample.report_code", read_only=True, default="")
    sample_pregnancy_history = serializers.SerializerMethodField()
    sample_diagnosis = serializers.CharField(source="sample.clinical_diagnosis", read_only=True, default="")
    sample_fetal_fraction = serializers.FloatField(source="sample.fetal_fraction", read_only=True, default=None)
    sample_ivf = serializers.BooleanField(source="sample.ivf_status", read_only=True, default=False)

    def get_sample_patient_name(self, obj):
        return obj.patient_name or getattr(obj.sample, "patient_name", "") or ""

    def get_sample_pregnancy_history(self, obj):
        s = obj.sample
        return getattr(s, "pregnancy_history", "") or getattr(s, "clinical_diagnosis", "") or ""


class NiptExtractionSampleSerializer(_StepSampleSerializer):
    class Meta:
        model = NiptExtractionSample
        fields = [
            "id", "batch", "sample",
            "sample_barcode", "sample_vg_id", "sample_patient_id", "sample_patient_name",
            "sample_multiple_gestation", "sample_gestational_weeks", "sample_test_option",
            "sample_status", "sample_plasma_remaining", "sample_retest_flag", "sample_report_code",
            "sample_pregnancy_history", "sample_diagnosis", "sample_fetal_fraction", "sample_ivf",
            "is_qc", "well_position", "plate_number", "index_sequence", "index_combo_id",
            "pool_group", "barcode", "status", "result_summary",
            "qc_status", "qc_note", "processed_at", "created_at",
        ]
        read_only_fields = ["created_at"]


class NiptLibrarySampleSerializer(_StepSampleSerializer):
    class Meta:
        model = NiptLibrarySample
        fields = [
            "id", "batch", "sample",
            "sample_barcode", "sample_vg_id", "sample_patient_id", "sample_patient_name",
            "sample_multiple_gestation", "sample_gestational_weeks", "sample_test_option",
            "sample_status", "sample_plasma_remaining", "sample_retest_flag", "sample_report_code",
            "sample_pregnancy_history", "sample_diagnosis", "sample_fetal_fraction", "sample_ivf",
            "is_qc", "well_position", "plate_number", "index_sequence", "index_combo_id",
            "pool_group", "barcode", "status", "result_summary",
            "qc_status", "qc_note", "processed_at", "created_at",
            "source_extraction_sample_id", "library_method", "adapter_type",
            "pcr_cycles", "library_concentration",
        ]
        read_only_fields = ["created_at"]


# ────────────────────────── 批次 ──────────────────────────

class NiptExtractionBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = NiptExtractionBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "operator_name", "reviewer", "region", "created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.samples.count()


class NiptExtractionBatchDetailSerializer(NiptExtractionBatchListSerializer):
    samples = NiptExtractionSampleSerializer(many=True, read_only=True)
    upstream_batch_count = serializers.SerializerMethodField()

    class Meta(NiptExtractionBatchListSerializer.Meta):
        fields = NiptExtractionBatchListSerializer.Meta.fields + [
            "samples", "extraction_data", "extraction_method", "upstream_batch_count",
        ]

    def get_upstream_batch_count(self, obj):
        return 0   # 提取的上游是收样/血浆分离，不按批次汇流


class NiptLibraryBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    source_extraction_batch_count = serializers.SerializerMethodField()

    class Meta:
        model = NiptLibraryBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "source_extraction_batch_count",
                  "operator_name", "reviewer", "region", "created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.samples.count()

    def get_source_extraction_batch_count(self, obj):
        """来源提取批次数 = 本批次样本指向上游的不同提取批次数（M:N 汇流的直观指标）。"""
        ids = [s.source_extraction_sample_id for s in obj.samples.all() if s.source_extraction_sample_id]
        if not ids:
            return 0
        return NiptExtractionSample.objects.filter(id__in=ids).values("batch_id").distinct().count()


class NiptLibraryBatchDetailSerializer(NiptLibraryBatchListSerializer):
    samples = NiptLibrarySampleSerializer(many=True, read_only=True)
    source_extraction_batches = serializers.SerializerMethodField()

    class Meta(NiptLibraryBatchListSerializer.Meta):
        fields = NiptLibraryBatchListSerializer.Meta.fields + [
            "samples", "library_data", "library_method", "source_extraction_batches",
        ]

    def get_source_extraction_batches(self, obj):
        ids = [s.source_extraction_sample_id for s in obj.samples.all() if s.source_extraction_sample_id]
        if not ids:
            return []
        bids = NiptExtractionSample.objects.filter(id__in=ids).values_list("batch_id", flat=True).distinct()
        return list(NiptExtractionBatch.objects.filter(id__in=list(bids))
                    .values("id", "batch_number", "created_at"))


# ────────────────────────── 创建批次 ──────────────────────────

class CreateExtractionBatchSerializer(serializers.Serializer):
    """body: {sample_ids: [...], notes?: str} —— 从待处理队列勾选样本建批次。"""

    sample_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class CreateLibraryBatchSerializer(serializers.Serializer):
    """body: {sample_ids: [...], source_extraction_sample_ids?: [...]}。

    只给 sample_ids 时，后端按「该样本最近一条 PASS 的提取行」自动补上游指针
    （自带 M:N：不同样本可来自不同提取批次）。
    """

    sample_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
    source_extraction_sample_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list)
    notes = serializers.CharField(required=False, allow_blank=True)
