"""Notifications URLs."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import NotificationViewSet, ReminderRouteViewSet, ReminderLogViewSet

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notification")
router.register("reminder-routes", ReminderRouteViewSet, basename="reminder-route")
router.register("reminder-logs", ReminderLogViewSet, basename="reminder-log")

app_name = "notifications"

urlpatterns = [
    path("", include(router.urls)),
]
