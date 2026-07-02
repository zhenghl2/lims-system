"""Sample management views."""
import os
from datetime import date
from django.utils import timezone
from django.db import transaction
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django_filters.rest_framework import DjangoFilterBackend, FilterSet, CharFilter
from rest_framework.filters import SearchFilter, OrderingFilter
from .models import Sample, SamplePhoto, SampleType, TestPanel, SampleMovement
from lims.apps.organizations.models import Receiver
from .serializers import (
    SamplePhotoSerializer, SamplePhotoListSerializer,
    SampleSerializer, SampleListSerializer, SampleReceiveSerializer, SampleUrgentSerializer,
    SampleRejectSerializer, SampleMovementSerializer, SampleTypeSerializer, TestPanelSerializer,
)
from lims.core.permissions import IsSiteScoped
class SampleFilter(FilterSet):
    vg_id = CharFilter(lookup_expr="icontains")

    class Meta:
        model = Sample
        fields = ["sample_type", "receipt_date", "hpv_sample_type", "test_item",
                   "patient_sex", "sample_source", "acceptance_date", "vg_id"]


class SampleViewSet(viewsets.ModelViewSet):
    """CRUD + actions for samples."""
    permission_classes = [IsAuthenticated, IsSiteScoped]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = SampleFilter
    # receipt_date range handled in get_queryset via custom filter
    search_fields = ["sample_id", "patient_id", "patient_name", "vg_id", "external_id", "id_card", "ordering_physician", "ordering_facility", "sample_source"]
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
                qs = qs.exclude(status__in=["ARCHIVED", "DISPOSED"])
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        # Date range filters
        params = self.request.query_params
        if "receipt_date__from" in params:
            qs = qs.filter(receipt_date__gte=params["receipt_date__from"])
        if "receipt_date__to" in params:
            qs = qs.filter(receipt_date__lte=params["receipt_date__to"])
        if "plasma_remaining__gt" in params:
            try:
                qs = qs.filter(plasma_remaining__gt=int(params["plasma_remaining__gt"]))
            except (ValueError, TypeError):
                pass
        return qs.select_related("sample_type", "site").prefetch_related("movements", "run_samples")
    def get_serializer_class(self):
        if self.action == "list":
            return SampleListSerializer
        if self.action == "create":
            return SampleReceiveSerializer
        if self.action == "urgent":
            return SampleUrgentSerializer
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
        vg_id = request.data.get("vg_id", "").strip()
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
        update_fields = ["status", "received_by", "receipt_date", "updated_at"]
        if vg_id:
            sample.vg_id = vg_id
            update_fields.append("vg_id")
        sample.save(update_fields=update_fields)
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
            "in_progress": qs.filter(status__in=["IN_PROCESS", "PLASMA_SEPARATED", "ACCEPTED"]).count(),
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
                registered=Count("pk", filter=Q(status="REGISTERED")),
                receiving=Count("pk", filter=Q(status="RECEIVING")),
                received=Count("pk", filter=Q(status="RECEIVED")),
                accepted=Count("pk", filter=Q(status="ACCEPTED")),
                pre_processing=Count("pk", filter=Q(status="PRE_PROCESSING")),
                in_process=Count("pk", filter=Q(status="IN_PROCESS")),
                plasma_separated=Count("pk", filter=Q(status="PLASMA_SEPARATED")),
                extraction=Count("pk", filter=Q(status="EXTRACTION")),
                library_prep=Count("pk", filter=Q(status="LIBRARY_PREP")),
                pooling=Count("pk", filter=Q(status="POOLING")),
                sequencing=Count("pk", filter=Q(status="SEQUENCING")),
                bioinformatics=Count("pk", filter=Q(status="BIOINFORMATICS")),
                testing=Count("pk", filter=Q(status="TESTING")),
                analyzing=Count("pk", filter=Q(status="ANALYZING")),
                completed=Count("pk", filter=Q(status="COMPLETED")),
                rejected=Count("pk", filter=Q(status="REJECTED")),
                reported=Count("pk", filter=Q(status="REPORTED")),
                archived=Count("pk", filter=Q(status="ARCHIVED")),
                disposed=Count("pk", filter=Q(status="DISPOSED")),
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
    @action(detail=False, methods=["get"])
    def urgent(self, request):
        """Return NIPT samples near or past their report due date."""
        from datetime import timedelta
        from django.db.models.expressions import RawSQL

        days = int(request.query_params.get("days", 2))
        today = timezone.now().date()
        deadline = today + timedelta(days=days)

        qs = self.get_queryset().filter(
            panel__code__in=["NIPT", "NIPT_PLUS", "NIPT_FULL"],
        ).exclude(
            status__in=["REJECTED", "COMPLETED", "REPORTED", "ARCHIVED", "DISPOSED"]
        ).annotate(
            due_date=RawSQL("TO_DATE(NULLIF(report_due_date, ''), 'DD/MM/YYYY')", []),
        ).filter(
            due_date__lte=deadline,
            due_date__isnull=False,
        ).exclude(
            report_due_date="",
        ).annotate(
            days_remaining=RawSQL(
                "TO_DATE(NULLIF(report_due_date, ''), 'DD/MM/YYYY') - CURRENT_DATE", []
            ),
        ).order_by("due_date")

        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

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

    @action(detail=False, methods=["post"], url_path="register-from-pdf",
            parser_classes=[MultiPartParser, FormParser])
    @transaction.atomic
    def register_from_pdf(self, request):
        """Register samples from uploaded Thai NIPT PDF files.

        POST /api/v1/samples/register-from-pdf/
        Body: multipart/form-data
          - source: string (e.g. "泰国")
          - files: one or more PDF files
        """
        source = request.data.get("source", "泰国")
        fedex_no = request.data.get("fedex_no", "")
        uploaded_files = request.FILES.getlist("files")

        if not uploaded_files:
            return Response(
                {"error": "No PDF files provided"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Create temp directory
        import tempfile, shutil
        tmpdir = tempfile.mkdtemp(prefix="nipt_pdf_")
        try:
            # Save uploaded files
            pdf_paths = []
            for f in uploaded_files:
                fpath = os.path.join(tmpdir, f.name)
                with open(fpath, "wb") as dest:
                    for chunk in f.chunks():
                        dest.write(chunk)
                pdf_paths.append(fpath)

            # Extract data from each PDF (or DOCX for Brazil)
            from .pdf_extract import extract_thai_pdf, generate_excel
            from .docx_extract import extract_brazil_docx, generate_excel_brazil
            is_brazil = source in ("巴西", "巴西万基")
            extracted = []
            for fpath in pdf_paths:
                if is_brazil:
                    info = extract_brazil_docx(fpath, source=source)
                else:
                    info = extract_thai_pdf(fpath, source=source)
                if info:
                    info["test_option"] = info.get("test_option", "")
                    extracted.append(info)

            if not extracted:
                return Response(
                    {"error": "No valid data extracted from any PDF file"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Create samples
            created = []
            errors = []
            skip = 0

            for i, data in enumerate(extracted):
                # Map test_option to panel_code
                test_opt = data.get("test_option", "")
                panel_code = None
                if is_brazil:
                    panel_code = "NIPT"  # Brazil uses NIPT panel (Basic/Plus), not NIPPT subsystem
                elif test_opt == "Basic":
                    panel_code = "NIPT"
                elif test_opt == "Basic All":
                    panel_code = "NIPT_FULL"
                elif test_opt == "Plus":
                    panel_code = "NIPT_PLUS"

                # Skip duplicates by external_id
                external_id = data.get("external_id")
                if external_id:
                    existing = Sample.objects.filter(
                        external_id=external_id, is_deleted=False
                    ).first()
                    if existing:
                        skip += 1
                        continue

                # Build sample data
                sample_data = {
                    "sample_source": data.get("sample_source") or ("BCC" if not is_brazil else source),
                    "test_option": test_opt,
                    "external_id": data.get("external_id", ""),
                    "patient_name": data.get("patient_name", ""),
                    "patient_dob": data.get("patient_dob"),
                    "age": data.get("age"),
                    "gestational_weeks": data.get("gestational_weeks"),
                    "id_card": data.get("id_card", ""),
                    "ordering_physician": data.get("ordering_physician", ""),
                    "ordering_facility": data.get("ordering_facility", ""),
                    "collection_date": data.get("collection_date"),
                    "acceptance_date": data.get("acceptance_date"),
                    "multiple_gestation": data.get("multiple_gestation", False),
                    "ivf_status": data.get("ivf_status", False),
                    "clinical_diagnosis": data.get("clinical_diagnosis", ""),
                    "fedex_no": fedex_no,
                    "price": data.get("price", ""),
                    "sinal": data.get("sinal", ""),
                    "balance": data.get("balance", ""),
                    "gender_info": data.get("fetal_gender", ""),
                    "report_due_date": data.get("report_due_date", ""),
                    "panel_code": panel_code,
                }

                # Default dates to today if missing
                today_str = date.today().strftime("%Y-%m-%d")
                if not sample_data.get("collection_date"):
                    sample_data["collection_date"] = today_str
                if not sample_data.get("acceptance_date"):
                    sample_data["acceptance_date"] = today_str

                serializer = SampleReceiveSerializer(
                    data=sample_data, context={"request": request}
                )
                if serializer.is_valid():
                    try:
                        with transaction.atomic():
                            sample = serializer.save()
                            SampleMovement.objects.create(
                                sample=sample,
                                to_location="RECEIVING",
                                reason="RECEIPT",
                                performed_by=request.user,
                            )
                        created.append(SampleListSerializer(sample).data)
                    except Exception as save_err:
                        errors.append({
                            "row": i,
                            "patient_name": data.get("patient_name", ""),
                            "errors": str(save_err),
                        })
                else:
                    errors.append({
                        "row": i,
                        "patient_name": data.get("patient_name", ""),
                        "errors": serializer.errors,
                    })

            # Generate Excel export (non-critical)
            excel_path = None
            try:
                if extracted:
                    excel_dir = "/opt/lims/exports"
                    os.makedirs(excel_dir, exist_ok=True)
                    if is_brazil:
                        excel_path = os.path.join(excel_dir, "baxi_NIPPT.xlsx")
                        generate_excel_brazil(extracted, excel_path)
                    else:
                        excel_path = os.path.join(excel_dir, "taiguoNIPT.xlsx")
                        generate_excel(extracted, excel_path)
            except Exception as e:
                print(f"Excel generation failed (non-critical): {e}")

            # Encode Excel as base64 for download
            excel_b64 = None
            if excel_path and os.path.exists(excel_path):
                import base64 as _b64
                with open(excel_path, "rb") as _ef:
                    excel_b64 = _b64.b64encode(_ef.read()).decode()

            return Response(
                {
                    "created_count": len(created),
                    "error_count": len(errors),
                    "skipped_duplicates": skip,
                    "total_extracted": len(extracted),
                    "created": created,
                    "errors": errors,
                    "excel_path": excel_path,
                    "excel_b64": excel_b64,
                },
                status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST,
            )

        except Exception as e:
            import traceback
            import logging
            logger = logging.getLogger("lims.samples")
            logger.error(f"register_from_pdf failed: {e}\n{traceback.format_exc()}")
            return Response(
                {"error": f"处理失败: {str(e)}", "detail": traceback.format_exc()[-500:]},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)



    # =====================================================
    # 🆕 Action: redo — retest using remaining plasma
    # =====================================================
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def redo(self, request, pk=None):
        """
        Retest a rejected sample using remaining plasma.
        POST /api/samples/{id}/redo/
        Body: { "reason": "文库构建失败" }  // optional
        """
        sample = Sample.objects.select_for_update().get(id=pk)

        if sample.status != "REJECTED":
            return Response(
                {"error": f"当前状态为 {sample.status}，只有已拒收的样本可以重做"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if sample.plasma_remaining <= 0:
            return Response(
                {"error": "无剩余血浆，无法重做。请使用 recollect 进行重采"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get("reason", "") or sample.rejection_reason or ""

        # Calculate retest count
        current_r = 0
        if sample.retest_flag and sample.retest_flag.startswith("R"):
            try:
                current_r = int(sample.retest_flag[1:])
            except ValueError:
                pass

        new_flag = f"R{current_r + 1}"

        # Append to experiment history
        history = list(sample.experiment_history or [])
        history.append({
            "action": "RETEST",
            "retest_flag": new_flag,
            "previous_rejection_reason": sample.rejection_reason,
            "retest_reason": reason,
            "plasma_remaining_at_retest": sample.plasma_remaining,
            "timestamp": timezone.now().isoformat(),
        })

        sample.status = "PLASMA_SEPARATED"
        sample.rejection_reason = ""
        sample.retest_flag = new_flag
        sample.retest_reason = reason
        sample.experiment_history = history
        sample.save()

        return Response({
            "status": "PLASMA_SEPARATED",
            "retest_flag": new_flag,
            "plasma_remaining": sample.plasma_remaining,
            "message": f"样本已恢复为血浆已分离状态，剩余血浆 {sample.plasma_remaining} 份",
        })

    # =====================================================
    # 🆕 Action: recollect — mark old sample as completed for recollection
    # =====================================================
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def recollect(self, request, pk=None):
        """
        Mark a sample as recollected (new blood draw).
        POST /api/samples/{id}/recollect/
        Body: { "reason": "浓度低重新采血" }  // optional
        """
        sample = Sample.objects.select_for_update().get(id=pk)

        if sample.status == "COMPLETED":
            return Response(
                {"error": "样本已完成，无需重复操作"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get("reason", "") or sample.rejection_reason or "重采"

        # Append to experiment history
        history = list(sample.experiment_history or [])
        history.append({
            "action": "RECOLLECTED",
            "reason": reason,
            "timestamp": timezone.now().isoformat(),
        })

        sample.status = "COMPLETED"
        sample.rejection_reason = ""
        sample.retest_reason = reason
        sample.experiment_history = history
        sample.save()

        return Response({
            "status": "COMPLETED",
            "vg_id": sample.vg_id,
            "message": f"样本 {sample.vg_id or sample.sample_id} 已标记为重采完成。新样本登记时请填写 recollected_from_vg_id",
        })

    # =====================================================
    # 🆕 Action: qc_redo — use completed sample as QC control
    # =====================================================
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def qc_redo(self, request, pk=None):
        sample = Sample.objects.select_for_update().get(id=pk)
        if sample.status != "COMPLETED":
            return Response(
                {"error": f"当前状态为 {sample.status}，只有已完成的样本可以做质控品"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if sample.plasma_remaining <= 0:
            return Response(
                {"error": "无剩余血浆，无法作为质控品使用"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        history = list(sample.experiment_history or [])
        history.append({
            "action": "QC_REDO",
            "plasma_remaining": sample.plasma_remaining,
            "timestamp": timezone.now().isoformat(),
        })
        sample.experiment_history = history
        sample.save(update_fields=["experiment_history"])
        return Response({
            "status": sample.status,
            "plasma_remaining": sample.plasma_remaining,
            "message": f"样本 {sample.vg_id or sample.sample_id} 已标记为质控品，新建批次时可选择",
        })

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
