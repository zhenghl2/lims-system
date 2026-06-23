"""Report serializers."""
from rest_framework import serializers
from .models import ReportTemplate, Report, ElectronicSignature


class ReportSampleFieldsMixin(serializers.Serializer):
    """Shared sample fields for report serializers."""
    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True, default="")
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True, default="")
    sample_source = serializers.CharField(source="sample.sample_source", read_only=True, default="")
    test_option = serializers.CharField(source="sample.test_option", read_only=True, default="")
    external_id = serializers.CharField(source="sample.external_id", read_only=True, default="")
    collection_date = serializers.DateField(source="sample.collection_date", read_only=True, default=None)
    acceptance_date = serializers.DateField(source="sample.acceptance_date", read_only=True, default=None)
    physician = serializers.CharField(source="sample.ordering_physician", read_only=True, default="")
    id_card = serializers.CharField(source="sample.id_card", read_only=True, default="")
    patient_dob = serializers.DateField(source="sample.patient_dob", read_only=True, default=None)
    gestational_weeks = serializers.IntegerField(source="sample.gestational_weeks", read_only=True, default=None)
    report_code = serializers.CharField(source="sample.report_code", read_only=True, default="")
    send_report_id = serializers.CharField(source="sample.send_report_id", read_only=True, default="")
    age = serializers.IntegerField(source="sample.age", read_only=True, default=None)
    multiple_gestation = serializers.BooleanField(source="sample.multiple_gestation", read_only=True, default=False)
    ivf_status = serializers.BooleanField(source="sample.ivf_status", read_only=True, default=False)
    pregnancy_history = serializers.CharField(source="sample.pregnancy_history", read_only=True, default="")
    clinical_diagnosis = serializers.CharField(source="sample.clinical_diagnosis", read_only=True, default="")
    last_menstrual_period = serializers.DateField(source="sample.last_menstrual_period", read_only=True, default=None)
    ordering_facility = serializers.CharField(source="sample.ordering_facility", read_only=True, default="")
    panel_code = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()

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


class ReportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportTemplate
        fields = "__all__"


class ReportListSerializer(ReportSampleFieldsMixin, serializers.ModelSerializer):
    sample_vg_id = serializers.CharField(source="sample.vg_id", read_only=True, default="")
    bio_data = serializers.SerializerMethodField()

    def get_bio_data(self, obj):
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
            "patient_name", "sample_source", "test_option", "external_id",
            "collection_date", "acceptance_date", "physician", "id_card",
            "patient_dob", "gestational_weeks", "report_code", "send_report_id",
            "age", "multiple_gestation", "ivf_status", "pregnancy_history",
            "clinical_diagnosis", "last_menstrual_period", "ordering_facility", "panel_code",
            "status", "version_number",
            "reviewed_by", "reviewed_by_name", "reviewed_at",
            "verified_by", "verified_by_name", "verified_at",
            "released_at", "created_at", "content", "pdf_file_path", "bio_data",
        ]


class ReportSerializer(ReportSampleFieldsMixin, serializers.ModelSerializer):
    """Full report detail."""
    signed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = "__all__"
        read_only_fields = [
            "report_number", "reviewed_by", "reviewed_at",
            "verified_by", "verified_at", "signed_by", "signed_at", "released_at",
        ]

    def get_signed_by_name(self, obj):
        if obj.signed_by:
            return f"{obj.signed_by.first_name} {obj.signed_by.last_name}".strip() or obj.signed_by.username
        return None


class ReportReviewSerializer(serializers.Serializer):
    """Action serializers for review workflow."""
    pass


class ElectronicSignatureSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = ElectronicSignature
        fields = "__all__"
        read_only_fields = ["signed_at", "ip_address"]

    def get_user_name(self, obj):
        return f"{obj.user.first_name} {obj.user.last_name}".strip() or obj.user.username
