"""Sample management views."""
from datetime import date
from django.utils import timezone
from django.db import transaction
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from .models import Sample, SamplePhoto, SampleType, TestPanel, SampleMovement
from lims.apps.organizations.models import Receiver
from .serializers import (
    SamplePhotoSerializer, SamplePhotoListSerializer,
    SampleSerializer, SampleListSerializer, SampleReceiveSerializer,
    SampleRejectSerializer, SampleMovementSerializer, SampleTypeSerializer, TestPanelSerializer,
)
from rest_framework import status
from lims.core.permissions import IsSiteScoped
class SampleViewSet(viewsets.ModelViewSet):
    """CRUD + actions for samples."""
    permission_classes = [IsAuthenticated, IsSiteScoped]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sample_type", "receipt_date", "hpv_sample_type", "test_item", "patient_sex", "source_institution"]
    # receipt_date range handled in get_queryset via custom filter
    search_fields = ["sample_id", "patient_id", "patient_name"]
    ordering_fields = ["receipt_date", "created_at", "sample_id"]
    def get_queryset(self):
        qs = Sample.objects.filter(is_deleted=False)
        # Exclude NIPPT samples — these belong to the NIPPT subsystem (Cases API)
        qs = qs.exclude(panel__code="NIPPT")
        # Support ?panel=CODE — resolve to panel_id
        panel_code = self.request.query_params.get("panel")
        if panel_code:
            try:
                from .models import TestPanel
                codes = [c.strip() for c in panel_code.split(",") if c.strip()]
                panels = TestPanel.objects.filter(code__in=codes, is_active=True)
                if panels.exists():
                    qs = qs.filter(panel__in=panels)
            except Exception:
                pass
        elif self.action == "list":
            # Exclude NIPPT and HPV samples when no panel filter is specified and listing
            qs = qs.exclude(panel__code="NIPPT")
            qs = qs.exclude(panel__code="HPV")
        # 默认排除终态样本（仅列表视图），除非明确指定了 status 过滤
        # NOTE: retrieve/update/destroy actions are NOT filtered by status
        if self.action == "list":
            status_param = self.request.query_params.get("status")
            if status_param:
                if "," in status_param:
                    statuses = [s.strip() for s in status_param.split(",") if s.strip()]
                    if statuses:
                        qs = qs.filter(status__in=statuses)
                else:
                    qs = qs.filter(status=status_param)
            else:
                qs = qs.exclude(status__in=["REJECTED", "ARCHIVED", "DISPOSED"])
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        # Date range filters
        params = self.request.query_params
        if "receipt_date__from" in params:
            qs = qs.filter(receipt_date__gte=params["receipt_date__from"])
        if "receipt_date__to" in params:
            qs = qs.filter(receipt_date__lte=params["receipt_date__to"])
        return qs.select_related("sample_type", "site").prefetch_related("movements", "run_samples")
    def get_serializer_class(self):
        if self.action == "list":
            return SampleListSerializer
        if self.action == "create":
            return SampleReceiveSerializer
        return SampleSerializer
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Receive a new sample."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sample = serializer.save()
        # Log movement
        SampleMovement.objects.create(
            sample=sample,
            to_location="RECEIVING",
            reason="RECEIPT",
            performed_by=request.user,
        )
        return Response(SampleSerializer(sample).data, status=status.HTTP_201_CREATED)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Reject a sample."""
        sample = self.get_object()
        serializer = SampleRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sample.status = "REJECTED"
        sample.rejection_reason = serializer.validated_data["rejection_reason"]
        sample.rejection_note = serializer.validated_data.get("rejection_note", "")
        sample.rejection_handling = serializer.validated_data.get("rejection_handling", "")
        sample.rejection_communication = serializer.validated_data.get("rejection_communication", "")
        sample.save(update_fields=["status", "rejection_reason", "rejection_note", "rejection_handling", "rejection_communication", "updated_at"])
        SampleMovement.objects.create(
            sample=sample, to_location="REJECTED",
            reason="REJECTION", performed_by=request.user,
        )
        return Response({"status": "REJECTED", "sample_id": sample.sample_id})
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """Accept a sample with receiver verification."""
        sample = self.get_object()
        receiver_id = request.data.get("receiver_id")
        receipt_date = request.data.get("receipt_date")
        password = request.data.get("password", "")
        if receiver_id:
            try:
                receiver = Receiver.objects.get(id=receiver_id, is_active=True)
            except Receiver.DoesNotExist:
                return Response({"error": "签收人不存在"}, status=status.HTTP_400_BAD_REQUEST)
            if not receiver.check_password(password):
                return Response({"error": "签收人密码错误"}, status=status.HTTP_400_BAD_REQUEST)
            sample.received_by = receiver
        sample.status = "RECEIVED"
        if receipt_date:
            from datetime import datetime
            sample.receipt_date = datetime.strptime(receipt_date, "%Y-%m-%d").date()
        else:
            sample.receipt_date = timezone.now().date()
        sample.save(update_fields=["status", "received_by", "receipt_date", "updated_at"])
        SampleMovement.objects.create(
            sample=sample, to_location="RECEIVING",
            reason="RECEIPT", performed_by=request.user,
        )
        return Response({
            "status": "RECEIVED",
            "sample_id": sample.sample_id,
            "received_by": receiver.name if receiver_id and sample.received_by else None,
        })
    @action(detail=True, methods=["post"], url_path="upload-image", parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, pk=None):
        sample = self.get_object()
        if "image" not in request.FILES:
            return Response({"error": "No image file provided"}, status=status.HTTP_400_BAD_REQUEST)
        sample.image = request.FILES["image"]
        sample.save(update_fields=["image", "updated_at"])
        return Response({"detail": "Image uploaded", "image": request.build_absolute_uri(sample.image.url) if sample.image else None})
    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """Record sample movement."""
        sample = self.get_object()
        serializer = SampleMovementSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        movement = serializer.save()
        return Response(SampleMovementSerializer(movement).data, status=status.HTTP_201_CREATED)
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get sample statistics for dashboard."""
        today = date.today()
        qs = self.get_queryset()
        stats = {
            "total": qs.count(),
            "pending": qs.filter(status="REGISTERED").count() + qs.filter(status="RECEIVING").count(),
            "received": qs.filter(status="RECEIVED").count(),
            "in_progress": qs.filter(status__in=["IN_PROCESS", "ACCEPTED"]).count(),
            "completed": qs.filter(status="COMPLETED").count(),
            "reported": qs.filter(status="REPORTED").count(),
            "rejected": qs.filter(status="REJECTED").count(),
            "total_received_today": qs.filter(receipt_date=today).count(),
            "total_in_process": qs.filter(status="IN_PROCESS").count(),
            "total_completed": qs.filter(status="COMPLETED").count(),
            "total_reported": qs.filter(status="REPORTED").count(),
            "total_rejected_today": qs.filter(receipt_date=today, status="REJECTED").count(),
        }
        return Response(stats)
    @action(detail=False, methods=["get"])
    def stats_by_panel(self, request):
        """Get sample statistics grouped by test panel for dashboard."""
        from django.db.models import Count, Q
        qs = self.get_queryset()
        panels = TestPanel.objects.filter(is_active=True)
        results = []
        from lims.apps.reports.models import Report
        for panel in panels:
            samples = qs.filter(panel=panel)
            aggregations = samples.aggregate(
                received=Count("pk", filter=Q(status="RECEIVED")),
                accepted=Count("pk", filter=Q(status="ACCEPTED")),
                in_process=Count("pk", filter=Q(status="IN_PROCESS")),
                completed=Count("pk", filter=Q(status="COMPLETED")),
                rejected=Count("pk", filter=Q(status="REJECTED")),
                total=Count("pk"),
            )
            # Actual report count per panel (from reports table)
            report_count = Report.objects.filter(
                sample__panel=panel, sample__is_deleted=False
            ).count()
            results.append({
                "panel_code": panel.code,
                "panel_name": panel.name,
                "reported": report_count,
                **aggregations,
            })
        return Response(results)
    @action(detail=False, methods=["post"])
    def batch_create(self, request):
        """Create multiple samples in batch. Accepts {"samples": [{...}, ...]}."""
        samples_data = request.data.get("samples", [])
        if not samples_data or not isinstance(samples_data, list):
            return Response(
                {"error": "Expected 'samples' array"}, status=status.HTTP_400_BAD_REQUEST
            )
        created = []
        errors = []
        for i, data in enumerate(samples_data):
            serializer = SampleReceiveSerializer(data=data, context={"request": request})
            if serializer.is_valid():
                with transaction.atomic():
                    sample = serializer.save()
                    SampleMovement.objects.create(
                        sample=sample,
                        to_location="RECEIVING",
                        reason="RECEIPT",
                        performed_by=request.user,
                    )
                created.append(SampleListSerializer(sample).data)
            else:
                errors.append({"row": i, "errors": serializer.errors})
        status_code = status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST
        return Response({"created": created, "errors": errors, "total": len(samples_data)}, status=status_code)
    def destroy(self, request, *args, **kwargs):
        """Soft-delete sample."""
        sample = self.get_object()
        sample.is_deleted = True
        sample.save(update_fields=["is_deleted", "updated_at"])
        return Response({"detail": "Sample deleted."}, status=status.HTTP_204_NO_CONTENT)
class SampleTypeViewSet(viewsets.ReadOnlyModelViewSet):
    """List sample types."""
    permission_classes = [IsAuthenticated]
    serializer_class = SampleTypeSerializer
    queryset = SampleType.objects.filter(is_active=True)
class TestPanelViewSet(viewsets.ReadOnlyModelViewSet):
    """List available test panels."""
    permission_classes = [IsAuthenticated, IsSiteScoped]
    serializer_class = TestPanelSerializer
    def get_queryset(self):
        qs = TestPanel.objects.filter(is_active=True)
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        return qs
class SamplePhotoViewSet(viewsets.ModelViewSet):
    """Upload and manage sample receiving photos."""
    permission_classes = [IsAuthenticated, IsSiteScoped]
    http_method_names = ["get", "post", "delete"]
    def get_serializer_class(self):
        if self.action == "list" or self.action == "retrieve":
            return SamplePhotoListSerializer
        return SamplePhotoSerializer
    def get_queryset(self):
        qs = SamplePhoto.objects.all()
        # Filter by sample if requested
        sample_id = self.request.query_params.get("sample")
        if sample_id:
            qs = qs.filter(samples__id=sample_id)
        return qs.select_related("uploaded_by").prefetch_related("samples")
