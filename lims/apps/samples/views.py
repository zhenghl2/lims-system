"""Sample management views."""
import logging
import os
from datetime import date, timedelta
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


# ══════════════════════════════════════════════════════════════════
# 重号处理辅助（2026-10-15 用户口径）
#   重号时不阻断、也不静默丢弃 → 返回 409 + 明细，由前端弹窗让操作者选：
#     「继续录入」= 标记为重采样本（retest_reason/recollected_from_vg_id/experiment_history）
#     R1/R2 加在 HN 编号（vg_id）上，且推迟到收样填 HN 时自动补。
# ══════════════════════════════════════════════════════════════════
def _as_bool(v) -> bool:
    """FormData / JSON 里 'true'/'1'/True 都算真。"""
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")


def _dup_sample_payload(s) -> dict:
    """重号命中的已有样本摘要（给前端弹窗展示）。"""
    return {
        "sample_id": s.sample_id,
        "patient_name": s.patient_name or "",
        "vg_id": s.vg_id or "",
        "external_id": s.external_id or "",
        "sample_source": s.sample_source or "",
        "test_option": s.test_option or "",
        "created_at": __import__("lims.core.timefmt", fromlist=["bj"]).bj(s.created_at, "%Y-%m-%d %H:%M"),
    }


def _find_dup_by_external_id(external_id, exclude_id=None):
    ext = (external_id or "").strip()
    if not ext:
        return None
    qs = Sample.objects.filter(external_id=ext, is_deleted=False)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.order_by("created_at").first()


def _find_dup_by_vg_id(vg_id, exclude_id=None):
    v = (vg_id or "").strip()
    if not v:
        return None
    qs = Sample.objects.filter(vg_id=v, is_deleted=False)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.order_by("created_at").first()


def _next_resample_vg_id(base: str) -> str:
    """HN1111 → HN1111R1（已存在则 R2、R3…）。重采样本加 R 后缀以区别于原件。"""
    import re as _re
    b = (base or "").strip()
    m = _re.match(r"^(.*?)(R\d+)$", b, _re.I)
    core = m.group(1) if m else b
    n = 1
    while Sample.objects.filter(vg_id=f"{core}R{n}", is_deleted=False).exists():
        n += 1
    return f"{core}R{n}"


def _mark_resample(sample, original, save=True):
    """把样本标记为重采：retest_reason + recollected_from_vg_id + experiment_history(RECOLLECTED)。"""
    fields = []
    if not sample.retest_reason:
        sample.retest_reason = "重采"
        fields.append("retest_reason")
    if original and not sample.recollected_from_vg_id:
        sample.recollected_from_vg_id = original.vg_id or original.sample_id
        fields.append("recollected_from_vg_id")
    history = list(sample.experiment_history or [])
    history.append({
        "action": "RECOLLECTED",
        "reason": "编号重复，按重采录入" + (f"（原样本 {original.sample_id}）" if original else ""),
        "timestamp": timezone.now().isoformat(),
    })
    sample.experiment_history = history
    fields.append("experiment_history")
    if save:
        fields.append("updated_at")
        sample.save(update_fields=fields)
    return sample


class SampleFilter(FilterSet):
    vg_id = CharFilter(lookup_expr="icontains")

    class Meta:
        model = Sample
        fields = ["sample_type", "receipt_date", "hpv_sample_type", "test_item",
                   "patient_sex", "sample_source", "acceptance_date", "vg_id"]


def _parse_due_date(raw):
    """报告截止日期文本 → date（容错，永不抛异常）。

    支持：DD/MM/YYYY、YYYY-MM-DD、Excel 序列号（如 46339）。
    空值 / "-" / 其它脏值 → None（调用方跳过并记日志）。

    2026-11-04：原来在 SQL 里 TO_DATE(report_due_date,'DD/MM/YYYY')，
    只要库里混进一条 "46339" 或 "-"，整个 /samples/urgent/ 就 500。
    """
    import re as _re
    from datetime import date as _date, timedelta as _td

    v = str(raw or "").strip()
    if not v or v in {"-", "—", "/", "N/A", "n/a"}:
        return None
    m = _re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", v)
    if m:
        try:
            return _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = _re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if m:
        try:
            return _date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    # Excel 序列号（1900 日期系统；序列 1 = 1900-01-01，故基线 1899-12-30）
    if _re.fullmatch(r"\d{5}(\.\d+)?", v):
        try:
            return _date(1899, 12, 30) + _td(days=int(float(v)))
        except (ValueError, OverflowError):
            return None
    return None


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
        # 销售账号（小程序自助注册）：只返回本人登记的样本（与 cases 侧一致的数据隔离）
        from lims.apps.cases.views import _is_sales_scoped

        if _is_sales_scoped(self.request.user):
            qs = qs.filter(created_by=self.request.user)
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
    def update(self, request, *args, **kwargs):
        """编辑样本（含「批量填写 VG」的 PATCH）时的重号处理（2026-10-15）。

        - 只有**真的把号改成别的值**时才判重（原值未变 → 不校验，避免误报）。
        - 撞号：默认 409 + 明细（前端弹窗让操作者选）；allow_duplicates=true → 自动加 R1/R2 并标记重采。
        """
        sample = self.get_object()
        allow_dup = _as_bool(request.data.get("allow_duplicates"))
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)

        new_vg = str(data.get("vg_id") or "").strip()
        if new_vg and new_vg != (sample.vg_id or "").strip():
            dup = _find_dup_by_vg_id(new_vg, exclude_id=sample.id)
            if dup and not allow_dup:
                return Response(
                    {"duplicate": True, "field": "vg_id", "vg_id": new_vg,
                     "message": f"HN 编号 {new_vg} 已存在", "existing": _dup_sample_payload(dup)},
                    status=status.HTTP_409_CONFLICT,
                )
            if dup and allow_dup:
                data["vg_id"] = _next_resample_vg_id(new_vg)
                request._full_data = data
                resp = super().update(request, *args, **kwargs)
                sample.refresh_from_db()
                _mark_resample(sample, dup)
                return resp

        new_ext = str(data.get("external_id") or "").strip()
        if new_ext and new_ext != (sample.external_id or "").strip():
            dup2 = _find_dup_by_external_id(new_ext, exclude_id=sample.id)
            if dup2 and not allow_dup:
                return Response(
                    {"duplicate": True, "field": "external_id", "external_id": new_ext,
                     "message": f"外部编号 {new_ext} 已存在", "existing": _dup_sample_payload(dup2)},
                    status=status.HTTP_409_CONFLICT,
                )
            if dup2 and allow_dup:
                request._full_data = data
                resp = super().update(request, *args, **kwargs)
                sample.refresh_from_db()
                _mark_resample(sample, dup2)
                return resp

        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Receive a new sample.

        2026-10-15：外部编号与已有样本重复时返回 409 + 明细（不静默放行），
        由前端弹窗询问是否继续录入；继续（allow_duplicates=true）则标记为重采样本。
        """
        allow_duplicates = _as_bool(request.data.get("allow_duplicates"))
        external_id = (request.data.get("external_id") or "").strip()
        dup = _find_dup_by_external_id(external_id)
        if dup and not allow_duplicates:
            return Response(
                {
                    "duplicate": True,
                    "field": "external_id",
                    "external_id": external_id,
                    "message": f"外部编号 {external_id} 已存在",
                    "existing": _dup_sample_payload(dup),
                },
                status=status.HTTP_409_CONFLICT,
            )
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
        if dup:
            _mark_resample(sample, dup)
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
        receiver_name = (request.data.get("receiver_name") or "").strip()
        receipt_date = request.data.get("receipt_date")
        password = request.data.get("password", "")
        vg_id = request.data.get("vg_id", "").strip()
        accept_allow_dup = _as_bool(request.data.get("allow_duplicates"))
        # HN（vg_id）重复：默认 409 + 明细；allow_duplicates → 存成 HN1111R1/R2…（重采样本）
        _dup_vg = _find_dup_by_vg_id(vg_id, exclude_id=sample.id)
        if _dup_vg and not accept_allow_dup:
            return Response(
                {
                    "duplicate": True,
                    "field": "vg_id",
                    "vg_id": vg_id,
                    "message": f"HN 编号 {vg_id} 已存在",
                    "existing": _dup_sample_payload(_dup_vg),
                },
                status=status.HTTP_409_CONFLICT,
            )
        if receiver_id:
            try:
                receiver = Receiver.objects.get(id=receiver_id, is_active=True)
            except Receiver.DoesNotExist:
                return Response({"error": "签收人不存在"}, status=status.HTTP_400_BAD_REQUEST)
            if not receiver.check_password(password):
                return Response({"error": "签收人密码错误"}, status=status.HTTP_400_BAD_REQUEST)
            sample.received_by = receiver
            sample.received_by_name = receiver.name
        elif receiver_name:
            # 手选姓名（免密码）：只记录姓名，不绑定 Receiver 账号
            sample.received_by = None
            sample.received_by_name = receiver_name
        sample.status = "RECEIVED"
        if receipt_date:
            from datetime import datetime
            sample.receipt_date = datetime.strptime(receipt_date, "%Y-%m-%d").date()
        else:
            sample.receipt_date = timezone.now().date()
        update_fields = ["status", "received_by", "received_by_name", "receipt_date", "updated_at"]
        if vg_id:
            if _dup_vg:
                # 重采：HN 编号后自动加 R1/R2…，并标记重采
                vg_id = _next_resample_vg_id(vg_id)
                if not sample.retest_reason:
                    sample.retest_reason = "重采"
                    update_fields.append("retest_reason")
                if not sample.recollected_from_vg_id:
                    sample.recollected_from_vg_id = _dup_vg.vg_id or _dup_vg.sample_id
                    update_fields.append("recollected_from_vg_id")
                _hist = list(sample.experiment_history or [])
                _hist.append({
                    "action": "RECOLLECTED",
                    "reason": f"HN 编号重复，按重采录入 {vg_id}（原样本 {_dup_vg.sample_id}）",
                    "timestamp": timezone.now().isoformat(),
                })
                sample.experiment_history = _hist
                update_fields.append("experiment_history")
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
            "vg_id": sample.vg_id or "",
            "received_by": sample.received_by_name or None,
        })
    @action(detail=True, methods=["post"], url_path="upload-image", parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, pk=None):
        sample = self.get_object()
        # 兼容两种字段名：image（Web 端）/ file（微信小程序 wx.uploadFile 默认）
        image = request.FILES.get("image") or request.FILES.get("file")
        if image is None:
            return Response({"error": "No image file provided"}, status=status.HTTP_400_BAD_REQUEST)
        sample.image = image
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

        days = int(request.query_params.get("days", 2))
        today = timezone.now().date()
        deadline = today + timedelta(days=days)

        qs = self.get_queryset().filter(
            panel__code__in=["NIPT", "NIPT_PLUS", "NIPT_FULL"],
        ).exclude(
            status__in=["REJECTED", "COMPLETED", "REPORTED", "ARCHIVED", "DISPOSED"]
        ).exclude(report_due_date="")

        # 2026-11-04：候选只有百余条 → 在 Python 里解析日期，
        # 脏值（Excel 序列号 / "-" / 非法日期）跳过并记日志，不再让整个接口 500
        rows, bad = [], []
        for smp in qs:
            due = _parse_due_date(smp.report_due_date)
            if due is None:
                bad.append(smp.sample_id)
                continue
            if due <= deadline:
                smp.due_date = due
                smp.days_remaining = (due - today).days
                rows.append(smp)
        if bad:
            logging.getLogger("lims.samples").warning(
                "urgent: 跳过 %d 条无法解析的报告截止日期 %s", len(bad), bad[:5]
            )
        rows.sort(key=lambda x: x.due_date)

        serializer = self.get_serializer(rows, many=True)
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
        # 重号处理（2026-10-15）：默认跳过重复并返回明细；allow_duplicates=继续录入(标记重采)；
        # only_duplicates=第二遍只补录重复的那些行（避免把第一遍已建的再建一遍）。
        allow_duplicates = _as_bool(request.data.get("allow_duplicates"))
        # 「继续录入」时前端把用户选择继续的那些外部编号明确传过来：
        # 只录这些行（其余跳过）。不能用「凡是重复的就录」——第一遍刚建的行在第二遍也成了重复，
        # 会被再建一遍（2026-10-15 实测抓到的 bug）。
        force_ids = set()
        _raw_force = request.data.get("force_external_ids")
        if _raw_force:
            import json as _json
            try:
                _v = _json.loads(_raw_force) if str(_raw_force).strip().startswith("[") else str(_raw_force).split(",")
            except Exception:
                _v = str(_raw_force).split(",")
            force_ids = {str(x).strip() for x in _v if str(x).strip()}

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

            # Extract data from each uploaded file:
            #   泰国            → NIPT 送检单 PDF（一人一文件）
            #   巴西 .docx      → FICHA CLIENTE 送检单（一人一文件）
            #   巴西 .xlsx      → PLANILHA DE ENVIO 汇总表（一文件多样本，仅取无创 NIPT 行）
            from .pdf_extract import extract_thai_pdf, generate_excel
            from .docx_extract import extract_brazil_docx, generate_excel_brazil
            from .xlsx_extract import extract_brazil_planilha
            is_brazil = source in ("巴西", "巴西万基")
            extracted = []
            skipped_rows = []
            row_errors = []
            for fpath in pdf_paths:
                if is_brazil and fpath.lower().endswith((".xlsx", ".xlsm")):
                    infos, sk_rows, err_rows = extract_brazil_planilha(fpath, source=source)
                    extracted.extend(infos)
                    skipped_rows.extend(sk_rows)
                    row_errors.extend(err_rows)
                    continue
                if is_brazil:
                    info = extract_brazil_docx(fpath, source=source)
                else:
                    info = extract_thai_pdf(fpath, source=source)
                if info:
                    info["test_option"] = info.get("test_option", "")
                    extracted.append(info)

            if not extracted:
                return Response(
                    {
                        "error": "No valid data extracted from any file",
                        "skipped_rows": skipped_rows,
                        "row_errors": row_errors,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Create samples
            created = []
            created_ids = []          # 本次导入新建样本 id（用于方案B排序）
            errors = []
            skip = 0
            duplicates = []          # 重号明细（前端据此弹窗询问是否继续录入）

            # ── 巴西：在现有顺序规则之上，增加「Basic 先 / Plus 后」分组（2026-10-14 用户）──
            #   Basic = NIPT、Plus = NIPT_PLUS；其它档位（如 NIPT_FULL）排最后。
            #   sorted() 是稳定排序 → 同档位内保持解析出来的原顺序（文件名/表格行顺序）。
            #   说明：patient_id 按 panel 前缀各自计数，不受跨档位顺序影响。
            if is_brazil and len(extracted) > 1:
                _panel_rank = {"NIPT": 0, "NIPT_PLUS": 1}
                to_create = sorted(
                    extracted,
                    key=lambda d: _panel_rank.get(str(d.get("panel_code") or "NIPT").strip().upper(), 9),
                )
            else:
                to_create = extracted

            for i, data in enumerate(to_create):
                # Map test_option to panel_code
                test_opt = data.get("test_option", "")
                panel_code = None
                if is_brazil:
                    # 巴西使用 NIPT 无创 panel（非 NIPPT 亲子子系统）。
                    # PLANILHA 汇总表通道由解析器逐行给出档位（NIPT / NIPT_PLUS）；
                    # FICHA CLIENTE docx 通道无 panel_code → 回落 NIPT（保持原行为）。
                    panel_code = data.get("panel_code") or "NIPT"
                elif test_opt == "Basic":
                    panel_code = "NIPT"
                elif test_opt == "Basic All":
                    panel_code = "NIPT_FULL"
                elif test_opt == "Plus":
                    panel_code = "NIPT_PLUS"
                elif test_opt == "Twin":
                    panel_code = "twin_basic"

                # ── 重号处理（2026-10-15 用户口径：只提醒，由操作者决定）──
                external_id = (data.get("external_id") or "").strip()
                _dup = _find_dup_by_external_id(external_id)
                if _dup and not allow_duplicates:
                    skip += 1
                    duplicates.append({
                        "row": i,
                        "external_id": external_id,
                        "patient_name": data.get("patient_name", ""),
                        "test_option": data.get("test_option", ""),
                        "existing": _dup_sample_payload(_dup),
                    })
                    continue
                if force_ids and external_id not in force_ids:
                    # 只补录用户选择继续的那些行；其余（含第一遍已建好的）跳过
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
                    "fedex_no": fedex_no or data.get("fedex_no", ""),
                    "price": data.get("price", ""),
                    "sinal": data.get("sinal", ""),
                    "balance": data.get("balance", ""),
                    "gender_info": data.get("fetal_gender", ""),
                    "report_due_date": data.get("report_due_date", ""),
                    "panel_code": panel_code,
                    # 2026-11-12：WD/Remarks 的 10-11 DIAS ÚTEIS → 加急
                    "is_urgent": bool(data.get("is_urgent")),
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
                        if _dup:
                            _mark_resample(sample, _dup)
                        created.append(SampleListSerializer(sample).data)
                        created_ids.append(str(sample.id))
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

            # ── 方案B（用户 2026-10-13）：本次导入内部按文件顺序显示 ──
            # 列表默认 -created_at（最新在前）；把本批样本时间写成递减，
            # 文件第一行时间最新 → 列表顶部就是文件第一行，往下与文件一致。
            # 只动本批新建样本的毫秒级时间：不反向创建、不改模型 ordering、不影响其它列表。
            if is_brazil and len(created_ids) > 1:
                _base = timezone.now()
                for _i, _sid in enumerate(created_ids):
                    Sample.objects.filter(id=_sid).update(
                        created_at=_base - timedelta(milliseconds=_i)
                    )

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
                    "duplicates": duplicates,
                    "total_extracted": len(extracted),
                    "created": created,
                    "errors": errors,
                    "skipped_rows": skipped_rows,
                    "row_errors": row_errors,
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

        # CRM2 integration: notify recollection
        from lims.apps.integration.webhooks import enqueue_webhook
        enqueue_webhook("sample.recollect", {
            "sample_id": sample.sample_id,
            "lims_uuid": str(sample.id),
            "vg_id": sample.vg_id or "",
            "reason": reason,
        })

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
