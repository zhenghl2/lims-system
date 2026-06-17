"""Report serializers."""
from rest_framework import serializers
from .models import ReportTemplate, Report, ElectronicSignature


class ReportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportTemplate
        fields = "__all__"
        read_only_fields = ["created_by"]


class ReportListSerializer(serializers.ModelSerializer):
    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True, default="")
    sample_vg_id = serializers.CharField(source="sample.vg_id", read_only=True, default="")
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True, default="")
    panel_code = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    bio_data = serializers.SerializerMethodField()

    def get_panel_code(self, obj):
        return obj.sample.panel.code if obj.sample.panel else ""

    def get_reviewed_by_name(self, obj):
        if obj.reviewed_by:
            return f"{obj.reviewed_by.first_name} {obj.reviewed_by.last_name}".strip() or obj.reviewed_by.username
        return None

    def get_verified_by_name(self, obj):
        if obj.verified_by:
            return f"{obj.verified_by.first_name} {obj.verified_by.last_name}".strip() or obj.verified_by.username
        return None

    def get_bio_data(self, obj):
        # Get bioinformatics data from the run
        if obj.run_sample and obj.run_sample.run:
            run = obj.run_sample.run
            bio = run.bioinformatics_data or {}
            rs_id = str(obj.run_sample.id)
            return bio.get(rs_id, {})
        return {}

    class Meta:
        model = Report
        fields = [
            "id", "report_number", "sample", "sample_barcode", "sample_vg_id",
            "patient_name", "panel_code",
            "status", "version_number",
            "reviewed_by", "reviewed_by_name", "reviewed_at",
            "verified_by", "verified_by_name", "verified_at",
            "released_at", "created_at", "content", "bio_data",
        ]


class ReportSerializer(serializers.ModelSerializer):
    """Full report detail."""
    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True, default="")
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True, default="")
    panel_code = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    signed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = "__all__"
        read_only_fields = [
            "report_number", "reviewed_by", "reviewed_at",
            "verified_by", "verified_at", "signed_by", "signed_at", "released_at",
        ]

    def get_panel_code(self, obj):
        return obj.sample.panel.code if obj.sample.panel else ""

    def get_reviewed_by_name(self, obj):
        if obj.reviewed_by:
            return f"{obj.reviewed_by.first_name} {obj.reviewed_by.last_name}".strip() or obj.reviewed_by.username
        return None

    def get_verified_by_name(self, obj):
        if obj.verified_by:
            return f"{obj.verified_by.first_name} {obj.verified_by.last_name}".strip() or obj.verified_by.username
        return None

    def get_signed_by_name(self, obj):
        if obj.signed_by:
            return f"{obj.signed_by.first_name} {obj.signed_by.last_name}".strip() or obj.signed_by.username
        return None


class ReportReviewSerializer(serializers.Serializer):
    """Action serializers for review workflow."""
    pass  # No body needed, just status change


class ElectronicSignatureSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = ElectronicSignature
        fields = [
            "id", "entity_type", "entity_id", "user", "user_name",
            "action", "meaning", "signed_at", "ip_address",
        ]

    def get_user_name(self, obj):
        return f"{obj.user.first_name} {obj.user.last_name}" if obj.user else None
