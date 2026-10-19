"""NIPT 分步批次序列化器（阶段2：提取 / 建库）。

⚠️ 关键：样本序列化字段**逐一对齐 `workflows.serializers.RunSampleSerializer`**
（`sample_barcode` / `sample_patient_name` / `well_position` / `plate_number` / …），
这样 5 个实验组件不用改一行渲染逻辑，只换接口地址。
"""
from rest_framework import serializers

from .models import (NiptBioinformaticsBatch, NiptBioinformaticsSample,
                     NiptExtractionBatch, NiptExtractionSample,
                     NiptLibraryBatch, NiptLibrarySample,
                     NiptPoolingBatch, NiptPoolingSample,
                     NiptSequencingBatch, NiptSequencingSample)


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


# ══════════════════════════════════════════════════════════════
# 阶段 3：Pooling / 测序 / 生信
# ══════════════════════════════════════════════════════════════

_BASE_SAMPLE_FIELDS = [
    "id", "batch", "sample",
    "sample_barcode", "sample_vg_id", "sample_patient_id", "sample_patient_name",
    "sample_multiple_gestation", "sample_gestational_weeks", "sample_test_option",
    "sample_status", "sample_plasma_remaining", "sample_retest_flag", "sample_report_code",
    "sample_pregnancy_history", "sample_diagnosis", "sample_fetal_fraction", "sample_ivf",
    "is_qc", "well_position", "plate_number", "index_sequence", "index_combo_id",
    "pool_group", "barcode", "status", "result_summary",
    "qc_status", "qc_note", "processed_at", "created_at",
]



# ── 阶段3 补丁：组件读的是 batch.run_samples + 上游 JSON，批次本体不够 ──

def _merge_upstream_json(model, batch_ids, field):
    """把多个上游批次的 JSON 合并成一份（dict 字段按 key 累加，其余取首个）。"""
    out = {}
    for b in model.objects.filter(id__in=list(batch_ids)).order_by("created_at"):
        for k, v in (getattr(b, field) or {}).items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                merged = dict(out[k])
                merged.update(v)
                out[k] = merged
            else:
                out.setdefault(k, v)
    return out


def _upstream_batch_ids(sample_model, ptr, row_ids):
    return list(sample_model.objects.filter(id__in=list(row_ids))
                .values_list("batch_id", flat=True).distinct())


class NiptPoolingSampleSerializer(_StepSampleSerializer):
    class Meta:
        model = NiptPoolingSample
        fields = _BASE_SAMPLE_FIELDS + ["source_library_sample_id"]
        read_only_fields = ["created_at"]


class NiptSequencingSampleSerializer(_StepSampleSerializer):
    class Meta:
        model = NiptSequencingSample
        fields = _BASE_SAMPLE_FIELDS + ["source_pooling_sample_id"]
        read_only_fields = ["created_at"]


class NiptBioinformaticsSampleSerializer(_StepSampleSerializer):
    class Meta:
        model = NiptBioinformaticsSample
        fields = _BASE_SAMPLE_FIELDS + ["source_sequencing_sample_id"]
        read_only_fields = ["created_at"]


class _BatchListBase(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    def get_sample_count(self, obj):
        return obj.samples.count()


class NiptPoolingBatchListSerializer(_BatchListBase):
    source_batch_count = serializers.SerializerMethodField()

    class Meta:
        model = NiptPoolingBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "source_batch_count", "pooling_base", "region", "operator_name",
                  "reviewer", "created_at", "updated_at"]

    def get_source_batch_count(self, obj):
        ids = [s.source_library_sample_id for s in obj.samples.all() if s.source_library_sample_id]
        if not ids:
            return 0
        return NiptLibrarySample.objects.filter(id__in=ids).values("batch_id").distinct().count()


class NiptPoolingBatchDetailSerializer(NiptPoolingBatchListSerializer):
    samples = NiptPoolingSampleSerializer(many=True, read_only=True)
    run_samples = serializers.SerializerMethodField()
    library_data = serializers.SerializerMethodField()

    class Meta(NiptPoolingBatchListSerializer.Meta):
        fields = NiptPoolingBatchListSerializer.Meta.fields + [
            "samples", "run_samples", "pooling_data", "library_data"]

    def get_run_samples(self, obj):
        return NiptPoolingSampleSerializer(obj.samples.all(), many=True).data

    def get_library_data(self, obj):
        """本批次样本来自哪些建库批次 → 合并它们的 library_data（板位/浓度靠这个）"""
        rows = [s.source_library_sample_id for s in obj.samples.all() if s.source_library_sample_id]
        if not rows:
            return {}
        ids = _upstream_batch_ids(NiptLibrarySample, "source_library_sample_id", rows)
        return _merge_upstream_json(NiptLibraryBatch, ids, "library_data")


class NiptSequencingBatchListSerializer(_BatchListBase):
    source_batch_count = serializers.SerializerMethodField()

    class Meta:
        model = NiptSequencingBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "source_batch_count", "platform", "instrument", "chip_type", "region",
                  "operator_name", "reviewer", "created_at", "updated_at"]

    def get_source_batch_count(self, obj):
        ids = [s.source_pooling_sample_id for s in obj.samples.all() if s.source_pooling_sample_id]
        if not ids:
            return 0
        return NiptPoolingSample.objects.filter(id__in=ids).values("batch_id").distinct().count()


class NiptSequencingBatchDetailSerializer(NiptSequencingBatchListSerializer):
    samples = NiptSequencingSampleSerializer(many=True, read_only=True)
    run_samples = serializers.SerializerMethodField()
    pooling_data = serializers.SerializerMethodField()
    notes = serializers.SerializerMethodField()

    class Meta(NiptSequencingBatchListSerializer.Meta):
        fields = NiptSequencingBatchListSerializer.Meta.fields + [
            "samples", "run_samples", "sequencing_data", "pooling_data", "notes"]

    def get_run_samples(self, obj):
        return NiptSequencingSampleSerializer(obj.samples.all(), many=True).data

    def get_pooling_data(self, obj):
        rows = [s.source_pooling_sample_id for s in obj.samples.all() if s.source_pooling_sample_id]
        if not rows:
            return {}
        ids = _upstream_batch_ids(NiptPoolingSample, "source_pooling_sample_id", rows)
        return _merge_upstream_json(NiptPoolingBatch, ids, "pooling_data")

    def get_notes(self, obj):
        return ""


class NiptBioinformaticsBatchListSerializer(_BatchListBase):
    source_batch_count = serializers.SerializerMethodField()

    class Meta:
        model = NiptBioinformaticsBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "source_batch_count", "pipeline", "region", "operator_name", "reviewer",
                  "created_at", "updated_at"]

    def get_source_batch_count(self, obj):
        ids = [s.source_sequencing_sample_id for s in obj.samples.all() if s.source_sequencing_sample_id]
        if not ids:
            return 0
        return NiptSequencingSample.objects.filter(id__in=ids).values("batch_id").distinct().count()


class NiptBioinformaticsBatchDetailSerializer(NiptBioinformaticsBatchListSerializer):
    samples = NiptBioinformaticsSampleSerializer(many=True, read_only=True)
    run_samples = serializers.SerializerMethodField()
    sequencing_data = serializers.SerializerMethodField()
    pooling_data = serializers.SerializerMethodField()
    library_data = serializers.SerializerMethodField()
    extraction_data = serializers.SerializerMethodField()

    class Meta(NiptBioinformaticsBatchListSerializer.Meta):
        fields = NiptBioinformaticsBatchListSerializer.Meta.fields + [
            "samples", "run_samples", "bioinformatics_data",
            "sequencing_data", "pooling_data", "library_data", "extraction_data"]

    def get_run_samples(self, obj):
        return NiptBioinformaticsSampleSerializer(obj.samples.all(), many=True).data

    # ── 沿指针链往上抓（生信→测序→Pooling→建库→提取）──
    def _seq_rows(self, obj):
        return [s.source_sequencing_sample_id for s in obj.samples.all() if s.source_sequencing_sample_id]

    def _pool_rows(self, obj):
        seq_rows = self._seq_rows(obj)
        if not seq_rows:
            return []
        return [r for r in NiptSequencingSample.objects.filter(id__in=seq_rows)
                .values_list("source_pooling_sample_id", flat=True) if r]

    def _lib_rows(self, obj):
        pool_rows = self._pool_rows(obj)
        if not pool_rows:
            return []
        return [r for r in NiptPoolingSample.objects.filter(id__in=pool_rows)
                .values_list("source_library_sample_id", flat=True) if r]

    def get_sequencing_data(self, obj):
        rows = self._seq_rows(obj)
        if not rows:
            return {}
        ids = _upstream_batch_ids(NiptSequencingSample, "source_sequencing_sample_id", rows)
        return _merge_upstream_json(NiptSequencingBatch, ids, "sequencing_data")

    def get_pooling_data(self, obj):
        rows = self._pool_rows(obj)
        if not rows:
            return {}
        ids = _upstream_batch_ids(NiptPoolingSample, "source_pooling_sample_id", rows)
        return _merge_upstream_json(NiptPoolingBatch, ids, "pooling_data")

    def get_library_data(self, obj):
        rows = self._lib_rows(obj)
        if not rows:
            return {}
        ids = _upstream_batch_ids(NiptLibrarySample, "source_library_sample_id", rows)
        return _merge_upstream_json(NiptLibraryBatch, ids, "library_data")

    def get_extraction_data(self, obj):
        rows = self._lib_rows(obj)
        if not rows:
            return {}
        ext_rows = [r for r in NiptLibrarySample.objects.filter(id__in=rows)
                    .values_list("source_extraction_sample_id", flat=True) if r]
        if not ext_rows:
            return {}
        ids = _upstream_batch_ids(NiptExtractionSample, "source_extraction_sample_id", ext_rows)
        return _merge_upstream_json(NiptExtractionBatch, ids, "extraction_data")
