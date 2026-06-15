
"""Serializers for plasma separation module."""
from rest_framework import serializers
from .models import PlasmaSeparationBatch, PlasmaSeparationSample, PlasmaSeparationPhoto


class PlasmaSeparationPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlasmaSeparationPhoto
        fields = ["id", "image", "caption", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]


class PlasmaSeparationSampleSerializer(serializers.ModelSerializer):
    sample_id = serializers.CharField(source="sample.sample_id", read_only=True)
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True)
    panel_name = serializers.SerializerMethodField()

    class Meta:
        model = PlasmaSeparationSample
        fields = [
            "id", "sample", "sample_id", "patient_name", "panel_name",
            "qc_result", "qc_reason", "notes",
        ]
        read_only_fields = ["id"]

    def get_panel_name(self, obj):
        if obj.sample.panel:
            return obj.sample.panel.name
        return ""


class PlasmaSeparationBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    operator_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PlasmaSeparationBatch
        fields = [
            "id", "batch_number", "experiment_date", "experiment_time",
            "equipment_type", "status", "status_display",
            "sample_count", "operator_name", "notes", "created_at",
        ]

    def get_sample_count(self, obj):
        return obj.batch_samples.count()

    def get_operator_name(self, obj):
        if obj.operator:
            return f"{obj.operator.first_name} {obj.operator.last_name}".strip() or obj.operator.username
        return ""


class PlasmaSeparationBatchDetailSerializer(serializers.ModelSerializer):
    batch_samples = PlasmaSeparationSampleSerializer(many=True, read_only=True)
    photos = PlasmaSeparationPhotoSerializer(many=True, read_only=True)
    operator_name = serializers.SerializerMethodField()
    reviewer_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PlasmaSeparationBatch
        fields = [
            "id", "batch_number", "experiment_date", "experiment_time",
            "equipment_type", "status", "status_display",
            "operator", "operator_name", "operator_signature", "operator_signature_data",
            "reviewer", "reviewer_name", "reviewer_signature", "reviewer_signature_data",
            "notes", "batch_samples", "photos", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_operator_name(self, obj):
        if obj.operator:
            return f"{obj.operator.first_name} {obj.operator.last_name}".strip() or obj.operator.username
        return ""

    def get_reviewer_name(self, obj):
        if obj.reviewer:
            return f"{obj.reviewer.first_name} {obj.reviewer.last_name}".strip() or obj.reviewer.username
        return ""


class PlasmaSeparationBatchCreateSerializer(serializers.ModelSerializer):
    sample_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True
    )

    class Meta:
        model = PlasmaSeparationBatch
        fields = [
            "experiment_date", "experiment_time", "equipment_type",
            "sample_ids", "notes",
        ]

    def validate_sample_ids(self, value):
        if not value:
            raise serializers.ValidationError("At least one sample is required.")
        return value
