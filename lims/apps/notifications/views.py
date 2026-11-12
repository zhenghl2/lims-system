"""Notifications views."""
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from rest_framework.filters import OrderingFilter
from .models import Notification, ReminderLog, ReminderRoute
from .serializers import ReminderRouteSerializer, ReminderLogSerializer
from .serializers import NotificationSerializer, NotificationCreateSerializer


class NotificationViewSet(viewsets.ModelViewSet):
    """In-app notifications."""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [OrderingFilter]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return NotificationCreateSerializer
        return NotificationSerializer

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        """Mark a notification as read."""
        notification = self.get_object()
        notification.is_read = True
        notification.read_at = timezone.now()
        notification.save(update_fields=["is_read", "read_at"])
        return Response({"is_read": True})

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        """Mark all notifications as read for current user."""
        self.get_queryset().filter(is_read=False).update(
            is_read=True, read_at=timezone.now()
        )
        return Response({"count": "all marked read"})

    @action(detail=False, methods=["get"])
    def unread(self, request):
        """Get only unread notifications."""
        unread = self.get_queryset().filter(is_read=False)
        page = self.paginate_queryset(unread)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        """Get count of unread notifications."""
        count = self.get_queryset().filter(is_read=False).count()
        return Response({"count": count})


class ReminderRouteViewSet(viewsets.ModelViewSet):
    """到期提醒路由（来源 → 销售账号）。"""
    queryset = ReminderRoute.objects.select_related("user").all()
    serializer_class = ReminderRouteSerializer
    permission_classes = [permissions.IsAdminUser]

    @action(detail=False, methods=["get"])
    def preview(self, request):
        """预览：谁会收到什么（不发信）。"""
        from .reminders import build_plan
        days = request.query_params.get("days", "3,1")
        try:
            day_list = tuple(sorted({int(x) for x in days.split(",") if x.strip()}, reverse=True))
        except ValueError:
            day_list = (3, 1)
        return Response(build_plan(days=day_list))

    @action(detail=False, methods=["post"])
    def send_now(self, request):
        """手动发送（dry_run=true 时只返回清单）。"""
        from .reminders import send
        dry = str(request.data.get("dry_run", "")).lower() in ("1", "true", "yes")
        days = request.data.get("days") or (3, 1)
        if isinstance(days, str):
            days = tuple(sorted({int(x) for x in days.split(",") if x.strip()}, reverse=True))
        result = send(days=tuple(days), dry_run=dry)
        return Response(result)


class ReminderLogViewSet(viewsets.ReadOnlyModelViewSet):
    """发送日志（可追溯谁在什么时候收到哪封）。"""
    queryset = ReminderLog.objects.all()
    serializer_class = ReminderLogSerializer
    permission_classes = [permissions.IsAdminUser]
    filter_backends = [OrderingFilter]
    ordering_fields = ["sent_at"]
