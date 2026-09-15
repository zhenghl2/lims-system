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

    class Meta:
        model = ThaiReportBatch
        fields = ["id", "name", "status", "total", "success", "failed", "skipped",
                  "message", "created_by_name", "created_at"]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return "{} {}".format(obj.created_by.first_name, obj.created_by.last_name).strip() or obj.created_by.username
        return ""


class ThaiReportBatchDetailSerializer(ThaiReportBatchListSerializer):
    items = ThaiReportItemSerializer(many=True, read_only=True)

    class Meta(ThaiReportBatchListSerializer.Meta):
        fields = ThaiReportBatchListSerializer.Meta.fields + ["items"]
