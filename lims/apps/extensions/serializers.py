"""Extensions serializers."""
from rest_framework import serializers

from .models import ThaiReportBatch, ThaiReportItem


class ThaiReportItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ThaiReportItem
        fields = ["id", "sample_id", "accession_id", "option", "result_filter",
                  "template", "report_file", "status", "message"]


class ThaiReportBatchListSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    patient_filename = serializers.SerializerMethodField()
    result_filename = serializers.SerializerMethodField()

    class Meta:
        model = ThaiReportBatch
        fields = ["id", "name", "status", "total", "success", "failed", "skipped",
                  "message", "created_by_name", "created_at",
                  "patient_filename", "result_filename"]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return "{} {}".format(obj.created_by.first_name, obj.created_by.last_name).strip() or obj.created_by.username
        return ""

    @staticmethod
    def _clean_name(f):
        import os as _os
        import re as _re
        name = _os.path.basename(f.name) if f and f.name else ""
        return _re.sub(r"_[A-Za-z0-9]{7}(\.[A-Za-z0-9]+)$", r"\1", name)

    def get_patient_filename(self, obj):
        return self._clean_name(obj.patient_file)

    def get_result_filename(self, obj):
        return self._clean_name(obj.result_file)


class ThaiReportBatchDetailSerializer(ThaiReportBatchListSerializer):
    items = ThaiReportItemSerializer(many=True, read_only=True)

    class Meta(ThaiReportBatchListSerializer.Meta):
        fields = ThaiReportBatchListSerializer.Meta.fields + ["items"]
