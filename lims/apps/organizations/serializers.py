"""Organization serializers."""
from rest_framework import serializers
from .models import Site, Department, Receiver


class SiteSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField(read_only=True)
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Site
        fields = [
            "id", "code", "name_en", "name_local", "country", "timezone",
            "locale", "address", "phone", "email", "cap_number", "clia_number",
            "is_active", "data_residency", "sample_count", "user_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.samples.count()

    def get_user_count(self, obj):
        return obj.users.filter(is_active=True).count()


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "site", "name", "code", "is_active", "created_at"]
        read_only_fields = ["created_at"]

class ReceiverSerializer(serializers.ModelSerializer):
    class Meta:
        model = Receiver
        fields = ["id", "name", "is_active", "created_at"]
        read_only_fields = ["created_at"]

