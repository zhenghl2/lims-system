"""Notifications serializers."""
from rest_framework import serializers
from .models import Notification, ReminderLog, ReminderRoute


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
        read_only_fields = ["created_at"]


class NotificationCreateSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Notification
        fields = ["notification_type", "title", "message", "link"]
        read_only_fields = ["user"]

    def create(self, validated_data):
        validated_data["user"] = self.context["request"].user
        return super().create(validated_data)


class ReminderRouteSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.first_name", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = ReminderRoute
        fields = ["id", "source", "user", "user_name", "email", "is_active", "note",
                  "created_at", "updated_at"]


class ReminderLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReminderLog
        fields = ["id", "case_number", "milestone", "due_date", "recipient",
                  "status", "error", "sent_at"]
