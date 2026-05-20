from rest_framework import serializers
from datetime import date
from django.utils import timezone
from lims.apps.samples.models import TestPanel
from lims.apps.organizations.models import Site
from .models import HpvBatch, HpvWellPosition, HpvResult, HpvMembranePhoto, HpvRetestRecord

# ─── Genotype Labels ────────────────────────────────────────────────

HPV_15_TYPES = [
    "16","18","31","33","35","39","45","51","52","53","56","58","59","66","68"
]

HPV_23_HIGH = [
    "16","18","31","33","35","39","45","51","52","53","56","58","59","66","68","73","82"
]
HPV_23_LOW = ["6","11","42","43","81","83"]
HPV_23_TYPES = HPV_23_HIGH + HPV_23_LOW

STATUS_CHOICES = dict(HpvBatch._meta.get_field("status").choices)

# ─── Well Position ──────────────────────────────────────────────────

class HpvWellPositionSerializer(serializers.ModelSerializer):
    sample_id_display = serializers.CharField(source="sample.sample_id", read_only=True)

    class Meta:
        model = HpvWellPosition
        fields = [
            "id", "batch", "well_label", "sample", "barcode",
            "internal_number", "membrane_strip_number", "sample_id_display",
        ]
        read_only_fields = ["id"]  # batch set via nested context

    def validate_well_label(self, value):
        """Validate well_label format: letter A-H followed by digit 1-6."""
        import re
        value = value.upper()
        if not re.match(r'^[A-H][1-6]$', value):
            raise serializers.ValidationError(
                f"孔位编号格式错误: '{value}'，应为 A1-H6"
            )
        return value


class HpvWellPositionBriefSerializer(serializers.ModelSerializer):
    """Read-only brief serializer for nested listing."""
    sample_id_display = serializers.CharField(source="sample.sample_id", read_only=True)

    class Meta:
        model = HpvWellPosition
        fields = ["id", "well_label", "sample", "barcode", "internal_number",
                  "membrane_strip_number", "sample_id_display"]


# ─── Batch ──────────────────────────────────────────────────────────

class HpvBatchSerializer(serializers.ModelSerializer):
    well_positions = HpvWellPositionBriefSerializer(many=True, read_only=True)
    result_count = serializers.SerializerMethodField()
    membrane_photo_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = HpvBatch
        fields = [
            "id", "batch_number", "panel", "site",
            "status", "status_display",
            "extraction_data", "pcr_data", "hybridization_data",
            "well_positions", "result_count", "membrane_photo_count",
            "created_by", "created_by_name",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_result_count(self, obj):
        return getattr(obj, "_result_count", obj.results.count())

    def get_membrane_photo_count(self, obj):
        return getattr(obj, "_membrane_photo_count", obj.membrane_photos.count())


class HpvBatchCreateSerializer(serializers.ModelSerializer):
    """Serializer for batch creation — allows setting created_by from context."""
    batch_number = serializers.CharField(
        max_length=30, required=False, allow_blank=True,
        help_text="Leave empty to auto-generate as YYYYMMDD-NN"
    )
    well_labels = serializers.ListField(
        child=serializers.CharField(max_length=6), write_only=True, required=False,
        help_text="Pre-generate well labels without samples"
    )
    planned_count = serializers.IntegerField(
        write_only=True, required=False, min_value=1, max_value=48,
        help_text="Number of pending samples to auto-assign to this batch"
    )

    class Meta:
        model = HpvBatch
        fields = ["id", "batch_number", "well_labels", "planned_count"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        well_labels = validated_data.pop("well_labels", [])
        planned_count = validated_data.pop("planned_count", None)
        user = self.context["request"].user

        # Auto-generate batch number if not provided
        if not validated_data.get("batch_number"):
            today = date.today().strftime("%Y%m%d")
            count = HpvBatch.objects.filter(batch_number__startswith=today).count()
            validated_data["batch_number"] = f"{today}-{count + 1:02d}"

        # Auto-populate panel: all batches on this endpoint are HPV
        if "panel_id" not in validated_data and "panel" not in validated_data:
            from lims.apps.samples.models import TestPanel, Sample
            panel = TestPanel.objects.filter(code="HPV", is_active=True).first()
            if not panel:
                from rest_framework import serializers as _srz
                raise _srz.ValidationError({"panel": "No active HPV panel found"})
            validated_data["panel"] = panel

        # Auto-populate site: use user's site or default to first active site
        if "site_id" not in validated_data and "site" not in validated_data:
            site = getattr(user, "site", None)
            if not site:
                site = Site.objects.filter(is_active=True).first()
            if not site:
                from rest_framework import serializers as _srz
                raise _srz.ValidationError({"site": "No active site configured"})
            validated_data["site"] = site

        batch = HpvBatch.objects.create(**validated_data)

        # ── Auto-assign pending samples if planned_count provided ──
        if planned_count and planned_count > 0:
            from lims.apps.samples.models import Sample
            from .models import HpvResult

            # 1. Get retest samples (复查先检)
            retest_results = HpvResult.objects.filter(
                review_status="NEEDS_RETEST"
            ).select_related('sample').order_by('sample__receipt_date', 'sample__created_at')

            retest_sample_ids = []
            retest_samples = []
            for r in retest_results:
                if r.sample_id not in retest_sample_ids:
                    retest_sample_ids.append(r.sample_id)
                    retest_samples.append(r.sample)

            # 2. Get RECEIVED samples not already in a batch (先到先检)
            # Exclude samples already assigned to any well position
            batched_ids = HpvWellPosition.objects.filter(
                sample__isnull=False
            ).values_list('sample_id', flat=True).distinct()

            received_samples = list(Sample.objects.filter(
                panel=panel, status="RECEIVED"
            ).exclude(
                id__in=retest_sample_ids
            ).exclude(
                id__in=batched_ids
            ).order_by('receipt_date', 'created_at'))

            # 3. Combine: retest first, then received by receipt_date
            selected = retest_samples + received_samples
            selected = selected[:planned_count]

            # 4. Generate column-major well labels: A1,B1,...,H1, A2,B2,...,H6
            rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
            cols = [1, 2, 3, 4, 5, 6]
            all_labels = [f"{r}{c}" for c in cols for r in rows]  # column-major

            # 5. Create well positions with assigned samples
            wells = []
            for i, sample in enumerate(selected):
                if i < len(all_labels):
                    wells.append(HpvWellPosition(
                        batch=batch,
                        well_label=all_labels[i],
                        sample=sample
                    ))

            if wells:
                HpvWellPosition.objects.bulk_create(wells)

            # 6. Create remaining empty wells (to fill 48)
            remaining = len(all_labels) - len(wells)
            if remaining > 0:
                empty_wells = [
                    HpvWellPosition(batch=batch, well_label=all_labels[i], sample=None)
                    for i in range(len(wells), len(all_labels))
                ]
                HpvWellPosition.objects.bulk_create(empty_wells)
        elif well_labels:
            # Original behavior: create empty wells with provided labels
            wells = [HpvWellPosition(batch=batch, well_label=wl.upper(), sample=None)
                     for wl in well_labels]
            HpvWellPosition.objects.bulk_create(wells)

        return batch


class HpvBatchAddSamplesSerializer(serializers.Serializer):
    """Serializer for the add_samples action."""
    sample_ids = serializers.ListField(
        child=serializers.CharField(), min_length=1, max_length=48,
        help_text="List of sample IDs"
    )
    sample_assignments = serializers.DictField(
        required=False, default=dict,
        help_text="Optional mapping of sample_id to well_label",
        child=serializers.CharField(max_length=6)
    )


# ─── Result ─────────────────────────────────────────────────────────

def get_genotype_labels(kit_type):
    """Return the list of genotype labels for a given kit type."""
    if kit_type == "HPV_15":
        return HPV_15_TYPES
    return HPV_23_TYPES


def auto_interpret(genotype_results, ic_result):
    """Compute auto_interpretation from genotype results and IC."""
    if ic_result != "+":
        return "IC_INVALID"
    positives = [k for k, v in genotype_results.items() if v == "+"]
    if not positives:
        return "NEGATIVE"
    if len(positives) == 1:
        return f"SINGLE_{positives[0]}"
    return "MIXED"


def validate_genotype_results(kit_type, data):
    """Validate genotype_results matches the expected keys for the kit type."""
    expected = set(get_genotype_labels(kit_type))
    provided = set(data.keys()) if data else set()
    bad = provided - expected
    if bad:
        raise serializers.ValidationError(
            f"Unknown genotypes for {kit_type}: {sorted(bad)}. Expected: {sorted(expected)}"
        )
    return data


class HpvResultSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_review_status_display", read_only=True)
    sample_display = serializers.CharField(source="sample.sample_id", read_only=True)
    well_label = serializers.CharField(source="well_position.well_label", read_only=True)

    class Meta:
        model = HpvResult
        fields = [
            "id", "batch", "sample", "sample_display",
            "well_position", "well_label",
            "kit_type", "genotype_results",
            "ic_result", "biotin_result",
            "auto_interpretation", "review_status", "status_display",
            "reviewer_1", "reviewer_2",
            "modification_log", "rejection_reason",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "auto_interpretation", "reviewer_1", "reviewer_2",
                            "modification_log", "created_at", "updated_at"]

    def validate(self, data):
        kit_type = data.get("kit_type", self.instance.kit_type if self.instance else None)

        if "genotype_results" in data and kit_type:
            validate_genotype_results(kit_type, data["genotype_results"])

        # IC validation on save
        ic = data.get("ic_result", self.instance.ic_result if self.instance else None)
        if ic == "-":
            raise serializers.ValidationError({"ic_result": "IC 无信号，结果不可信，样本需复查"})

        # Biotin warning (soft — log to modification_log but don't block)
        biotin = data.get("biotin_result", self.instance.biotin_result if self.instance else None)
        if biotin == "-":
            # We'll handle the soft warning in the view
            pass

        # Auto-interpret
        genotype = data.get("genotype_results", self.instance.genotype_results if self.instance else {})
        ic = ic or ""
        data["auto_interpretation"] = auto_interpret(genotype, ic)

        return data


class HpvResultBatchUpdateSerializer(serializers.Serializer):
    """Bulk update genotype_results for multiple samples in a batch."""
    batch_id = serializers.UUIDField()
    results = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField(allow_blank=True))
    )


class HpvResultReviewSerializer(serializers.Serializer):
    """Submit / approve / reject a result."""
    comment = serializers.CharField(required=False, allow_blank=True)


# ─── Membrane Photo ─────────────────────────────────────────────────

class HpvMembranePhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = HpvMembranePhoto
        fields = ["id", "batch", "sample", "image", "well_position",
                  "uploaded_by", "uploaded_at", "notes"]
        read_only_fields = ["id", "uploaded_by", "uploaded_at"]


# ─── Retest Record ──────────────────────────────────────────────────

class HpvRetestRecordSerializer(serializers.ModelSerializer):
    original_sample_display = serializers.CharField(
        source="original_sample.sample_id", read_only=True
    )
    original_batch_number = serializers.CharField(
        source="original_batch.batch_number", read_only=True
    )

    class Meta:
        model = HpvRetestRecord
        fields = [
            "id", "original_sample", "original_sample_display",
            "original_batch", "original_batch_number",
            "new_batch",
            "retest_date", "retest_reason",
            "original_result", "original_interpretation",
            "retest_result", "retest_interpretation",
            "final_hpv_genotype", "report_opinion",
            "operator", "reviewer",
            "created_at",
        ]
        read_only_fields = ["id", "original_result", "original_interpretation",
                            "created_at"]
