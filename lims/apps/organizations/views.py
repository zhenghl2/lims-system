"""Organization views."""
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Site, Department, Receiver
from .serializers import SiteSerializer, DepartmentSerializer, ReceiverSerializer


class SitePermission(permissions.BasePermission):
    """Global admins can CRUD, users can read own site."""
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.is_staff


class SiteViewSet(viewsets.ModelViewSet):
    """Manage laboratory sites."""
    permission_classes = [permissions.IsAuthenticated, SitePermission]
    serializer_class = SiteSerializer
    queryset = Site.objects.filter(is_active=True)

    def get_queryset(self):
        qs = Site.objects.filter(is_active=True)
        # Global staff see all, others see only their site
        if not self.request.user.is_superuser:
            qs = qs.filter(id=self.request.user.site_id)
        return qs


class DepartmentViewSet(viewsets.ModelViewSet):
    """Manage departments within sites."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DepartmentSerializer

    def get_queryset(self):
        qs = Department.objects.filter(is_active=True)
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        return qs

class ReceiverViewSet(viewsets.ReadOnlyModelViewSet):
    """List receivers (no password exposure)."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ReceiverSerializer
    queryset = Receiver.objects.filter(is_active=True)

    @action(detail=False, methods=["post"])
    def verify(self, request):
        """Verify receiver password. Body: {receiver_id, password}."""
        from django.contrib.auth.hashers import check_password
        receiver_id = request.data.get("receiver_id")
        password = request.data.get("password", "")

        if not receiver_id or not password:
            return Response({"valid": False, "error": "receiver_id and password are required"}, status=400)

        try:
            receiver = Receiver.objects.get(id=receiver_id, is_active=True)
        except Receiver.DoesNotExist:
            return Response({"valid": False, "error": "Receiver not found"}, status=404)

        valid = check_password(password, receiver.password)
        if valid:
            return Response({"valid": True, "receiver_name": receiver.name})
        return Response({"valid": False, "error": "密码错误"}, status=400)

