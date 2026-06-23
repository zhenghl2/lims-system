"""Bioinformatics views."""
from django.utils import timezone
import hmac, hashlib
from django.conf import settings
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from .models import Pipeline, PipelineValidation, AnalysisJob
from .serializers import (
    PipelineSerializer, PipelineValidationSerializer,
    AnalysisJobSerializer, AnalysisJobCreateSerializer, PipelineWebhookSerializer,
)


class PipelineViewSet(viewsets.ModelViewSet):
    """Manage bioinformatics pipelines."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PipelineSerializer

    def get_queryset(self):
        qs = Pipeline.objects.all()
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        return qs


class PipelineValidationViewSet(viewsets.ModelViewSet):
    """Manage pipeline validation records."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PipelineValidationSerializer
    queryset = PipelineValidation.objects.all()


class AnalysisJobViewSet(viewsets.ModelViewSet):
    """Manage analysis jobs."""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = []  # Add filtering if needed

    def get_queryset(self):
        qs = AnalysisJob.objects.select_related("run", "pipeline")
        if self.request.user.site_id:
            qs = qs.filter(run__site=self.request.user.site)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return AnalysisJobCreateSerializer
        return AnalysisJobSerializer

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Bioinformatician reviews analysis results."""
        job = self.get_object()
        approval = request.data.get("approval")
        if approval not in ("approved", "rejected"):
            raise ValidationError({"approval": "Must be 'approved' or 'rejected'"})
        if approval == "approved":
            for rs in job.run.run_samples.all():
                if rs.status != "FAILED_QC":
                    rs.status = "ANALYZED"
                    rs.save(update_fields=["status"])
            # Trigger report generation
            # from lims.celery_app.tasks.reports import generate_report
            # for rs in job.run.run_samples.filter(status="ANALYZED"):
            #     generate_report.delay(rs.sample_id, job.run_id)
        return Response({"status": approval})

    @action(detail=False, methods=["post"], permission_classes=[permissions.AllowAny])
    def webhook(self, request):
        """Callback from pipeline executor (e.g., Nextflow)."""
        serializer = PipelineWebhookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Verify webhook signature with HMAC-SHA256
        signature = request.headers.get("X-Webhook-Signature", "")
        expected = hmac.new(
            settings.LIMS_API_KEY.encode() if hasattr(settings, "LIMS_API_KEY") else settings.SECRET_KEY.encode(),
            request.body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return Response({"error": "Invalid signature"}, status=401)

        try:
            job = AnalysisJob.objects.get(id=serializer.validated_data["job_id"])
        except AnalysisJob.DoesNotExist:
            return Response({"error": "Job not found"}, status=status.HTTP_404_NOT_FOUND)

        data = serializer.validated_data
        job.status = data["status"].upper()
        job.metrics = data.get("metrics", {})
        job.output_files = data.get("output_files", {})
        job.completed_at = data.get("completed_at", timezone.now())
        job.error_message = data.get("error_message", "")
        if data.get("pipeline_version"):
            job.pipeline.version = data["pipeline_version"]
        job.save()

        # Auto-create QC events for failed jobs
        if job.status == "FAILED":
            from lims.apps.qc.models import QCEvent
            QCEvent.objects.create(
                event_type="QC_FAILURE",
                severity="MEDIUM",
                summary=f"Analysis job {job.id} failed: {job.error_message}",
                site=job.run.site,
            )

        # Update run sample statuses
        if job.status == "COMPLETED":
            metrics = job.metrics
            for sample_key, values in metrics.items():
                # Match samples by key and update
                pass

        return Response({"status": "processed"})
