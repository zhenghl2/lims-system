"""Report views."""
from django.db import transaction
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from django.utils import timezone
from .models import ReportTemplate, Report, ElectronicSignature
from .serializers import ReportTemplateSerializer, ReportSerializer, ReportListSerializer


class ReportTemplateViewSet(viewsets.ModelViewSet):
    """Manage report templates."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ReportTemplateSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["is_active"]

    def get_queryset(self):
        qs = ReportTemplate.objects.all()
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        panel_code = self.request.query_params.get("panel_code")
        if panel_code:
            codes = [c.strip() for c in panel_code.split(",") if c.strip()]
            qs = qs.filter(sample__panel__code__in=codes)
        return qs.filter(is_active=True)


class ReportViewSet(viewsets.ModelViewSet):
    """Manage reports with 21 CFR Part 11 workflow."""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "updated_at", "verified_at"]

    def get_queryset(self):
        qs = Report.objects.all()
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        panel_code = self.request.query_params.get("panel_code")
        if panel_code:
            codes = [c.strip() for c in panel_code.split(",") if c.strip()]
            qs = qs.filter(sample__panel__code__in=codes)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return ReportListSerializer
        return ReportSerializer

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Review bioinformatics results — requires reviewer name + password."""
        report = self.get_object()
        reviewer_name = request.data.get("reviewer_name", "").strip()
        password = request.data.get("password", "").strip()

        if not reviewer_name or not password:
            return Response({"error": "请选择审核人员并输入密码"}, status=400)

        # Find the reviewer user by first_name
        from lims.apps.users.models import User
        reviewer = User.objects.filter(first_name=reviewer_name, is_active=True).first()
        if not reviewer:
            return Response({"error": f"未找到审核人员: {reviewer_name}"}, status=400)
        if not reviewer.check_password(password):
            return Response({"error": "密码错误"}, status=400)

        report.status = "REVIEWED"
        report.reviewed_by = reviewer
        report.reviewed_at = timezone.now()
        report.save(update_fields=["status", "reviewed_by", "reviewed_at"])

        # Generate report DOCX after review
        try:
            from .report_generator import generate_report, generate_gender_report
            generate_report(report)
            generate_gender_report(report)
        except Exception as e:
            import logging
            logging.getLogger("lims.reports").warning(f"Report generation skipped: {e}")

        return Response(ReportListSerializer(report).data)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Verify report — requires verifier name + password. Sets RELEASED."""
        report = self.get_object()
        verifier_name = request.data.get("verifier_name", "").strip()
        password = request.data.get("password", "").strip()

        if not verifier_name or not password:
            return Response({"error": "请选择验证人员并输入密码"}, status=400)

        from lims.apps.users.models import User
        verifier = User.objects.filter(first_name=verifier_name, is_active=True).first()
        if not verifier:
            return Response({"error": f"未找到验证人员: {verifier_name}"}, status=400)
        if not verifier.check_password(password):
            return Response({"error": "密码错误"}, status=400)

        report.status = "RELEASED"
        report.verified_by = verifier
        report.verified_at = timezone.now()
        report.released_at = timezone.now()
        report.save(update_fields=["status", "verified_by", "verified_at", "released_at", "updated_at"])

        # Mark sample as REPORTED
        report.sample.status = "REPORTED"
        report.sample.save(update_fields=["status", "updated_at"])
        return Response(ReportListSerializer(report).data)

    @action(detail=True, methods=["post"])
    def sign(self, request, pk=None):
        report = self.get_object()
        password = request.data.get("password", "")
        if not password or not request.user.check_password(password):
            return Response({"error": "密码错误"}, status=400)
        report.status = "SIGNED"
        report.signed_by = request.user
        report.signed_at = timezone.now()
        report.save(update_fields=["status", "signed_by", "signed_at"])
        return Response({"status": "SIGNED"})

    @action(detail=True, methods=["post"])
    def generate(self, request, pk=None):
        """Generate / re-generate report content from linked sample & run."""
        report = self.get_object()
        sample = report.sample
        run = report.run_sample.run if report.run_sample else None
        # Pull result_summary from run_sample if available
        results_data = report.run_sample.result_summary if report.run_sample else {}

        # Also collect completed step observations from the run
        if report.run_sample and report.run_sample.run:
            steps = report.run_sample.run.steps.filter(
                sample=report.sample, status="COMPLETED"
            ).order_by("step_order")
            if steps.exists():
                step_results = {}
                for step in steps:
                    step_results[step.step_name or step.step_id] = {
                        "status": step.status,
                        "observations": step.observations or "",
                        "completed_at": str(step.completed_at) if step.completed_at else None,
                    }
                # Merge step results into result summary (step results take priority)
                results_data = {**results_data, "workflow_steps": step_results}

        content = {
            "report_number": report.report_number,
            "panel": sample.panel.code if sample.panel else "",
            "sample_barcode": sample.sample_id,
            "patient_id": sample.patient_id,
            "patient_name": sample.patient_name,
            "patient_dob": str(sample.patient_dob) if sample.patient_dob else None,
            "patient_sex": sample.patient_sex,
            "collection_date": str(sample.collection_date) if sample.collection_date else None,
            "receipt_date": str(sample.receipt_date) if sample.receipt_date else None,
            "ordering_physician": sample.ordering_physician,
            "ordering_facility": sample.ordering_facility,
            "run_number": run.run_number if run else None,
            "sequencer": run.sequencer.name if run and run.sequencer else None,
            "results": results_data,
            "status": report.status,
            "version": report.version_number,
            "generated_at": timezone.now().isoformat(),
            "generated_by": f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        }
        report.content = content
        report.save(update_fields=["content", "updated_at"])
        return Response(ReportSerializer(report).data)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """Download generated report. Use ?format=pdf for PDF, default DOCX."""
        import os, subprocess
        from django.http import FileResponse
        from django.conf import settings
        report = self.get_object()
        fmt = request.query_params.get("type", "docx").lower()
        if report.pdf_file_path:
            docx_path = os.path.join(settings.MEDIA_ROOT, report.pdf_file_path)
            if fmt == "pdf":
                pdf_path = docx_path.replace('.docx', '.pdf')
                if os.path.exists(pdf_path):
                    filename = os.path.basename(pdf_path)
                    response = FileResponse(open(pdf_path, 'rb'), content_type='application/pdf')
                    response['Content-Disposition'] = f'inline; filename="{filename}"'
                    return response
                return Response({"error": "PDF conversion failed"}, status=500)
            # Default: DOCX
            if os.path.exists(docx_path):
                filename = os.path.basename(docx_path)
                response = FileResponse(open(docx_path, 'rb'), content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                response['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response
        if not report.content:
            return Response({"error": "Report not generated yet. Review the report first."}, status=400)
        response = Response(report.content)
        response["Content-Disposition"] = f'attachment; filename="{report.report_number}.json"'
        return response

    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        report = self.get_object()
        report.status = "RELEASED"
        report.released_at = timezone.now()
        report.save(update_fields=["status", "released_at"])
        # Mark sample as REPORTED when report is released
        report.sample.status = "REPORTED"
        report.sample.save(update_fields=["status", "updated_at"])
        return Response({"status": "RELEASED"})
