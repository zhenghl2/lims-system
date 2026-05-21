from rest_framework import viewsets, status, permissions, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from .models import HpvBatch, HpvWellPosition, HpvResult, HpvMembranePhoto, HpvRetestRecord
from .serializers import (
    HpvBatchSerializer,
    HpvBatchCreateSerializer,
    HpvBatchAddSamplesSerializer,
    HpvWellPositionSerializer,
    HpvResultSerializer,
    HpvResultBatchUpdateSerializer,
    HpvResultReviewSerializer,
    HpvMembranePhotoSerializer,
    HpvRetestRecordSerializer,
)

from lims.apps.samples.models import Sample

# ─── Permissions ────────────────────────────────────────────────────

class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user and request.user.is_authenticated
        return request.user and request.user.is_authenticated

# ─── Batch ViewSet ───────────────────────────────────────────────────

class HpvBatchViewSet(viewsets.ModelViewSet):
    queryset = HpvBatch.objects.prefetch_related("well_positions__sample").all()
    serializer_class = HpvBatchSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        qs = qs.annotate(
            _result_count=Count("results", distinct=True),
            _membrane_photo_count=Count("membrane_photos", distinct=True),
        )
        user = self.request.user

        # Site isolation
        if hasattr(user, "site") and user.site:
            qs = qs.filter(site=user.site)

        # Filters
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter.upper())

        batch_number = self.request.query_params.get("batch_number")
        if batch_number:
            qs = qs.filter(batch_number__icontains=batch_number)

        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return HpvBatchCreateSerializer
        return HpvBatchSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    # ── add_samples ──

    @action(detail=True, methods=["POST"])
    @transaction.atomic
    def add_samples(self, request, pk=None):
        """Add samples to a batch. Optionally specify sample->well mappings."""
        batch = self.get_object()
        if batch.status not in ("PLANNED", "EXTRACTION"):
            return Response(
                {"error": f"当前状态 '{batch.status}' 不允许添加样本"}, status=400
            )

        serializer = HpvBatchAddSamplesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sample_ids = serializer.validated_data["sample_ids"]
        sample_assignments = serializer.validated_data.get("sample_assignments", {})

        # Fetch samples
        samples = Sample.objects.filter(sample_id__in=sample_ids)
        if len(samples) != len(sample_ids):
            found = set(s.sample_id for s in samples)
            missing = set(sample_ids) - found
            return Response({"error": f"样本不存在: {missing}"}, status=400)

        sample_map = {s.sample_id: s for s in samples}
        existing_wells = set(
            batch.well_positions.values_list("well_label", flat=True)
        )
        all_wells = [f"{r}{c}" for r in "ABCDEFGH" for c in range(1, 7)]  # A1-H6
        available = set(w for w in all_wells if w not in existing_wells)

        # Validate manual assignments
        for sid, wl in sample_assignments.items():
            if wl in existing_wells:
                return Response(
                    {"error": f"孔位 {wl} 已被占用"}, status=400
                )
            if wl not in all_wells:
                return Response(
                    {"error": f"无效孔位: {wl}, 应为 A1-H6"}, status=400
                )

        wells_created = []
        assigned_wells = set()
        for sample_id in sample_ids:
            sample = sample_map[sample_id]

            # Use manual assignment if provided, otherwise auto-assign
            if sample_id in sample_assignments:
                well_label = sample_assignments[sample_id]
            else:
                auto = list(available - assigned_wells)
                if not auto:
                    return Response(
                        {"error": f"孔位不足, 样本 {sample_id} 无法分配"}, status=400
                    )
                well_label = auto[0]

            if well_label in existing_wells or well_label in assigned_wells:
                return Response(
                    {"error": f"孔位 {well_label} 重复分配"}, status=400
                )

            assigned_wells.add(well_label)
            well = HpvWellPosition.objects.create(
                batch=batch,
                well_label=well_label,
                sample=sample,
                barcode=sample.sample_id,
            )
            wells_created.append(well)

        serializer_out = HpvWellPositionSerializer(wells_created, many=True)
        return Response(serializer_out.data, status=201)

    # ── save_extraction ──

    @action(detail=True, methods=["POST"])
    def save_extraction(self, request, pk=None):
        """Save extraction stage data."""
        batch = self.get_object()
        if batch.status not in ("PLANNED", "EXTRACTION"):
            return Response(
                {"error": f"当前状态 '{batch.status}' 不可保存提取数据"}, status=400
            )

        data = request.data
        required_fields = ["extraction_date"]
        for field in required_fields:
            if field not in data:
                return Response({"error": f"缺少必填字段: {field}"}, status=400)

        batch.extraction_data = {
            "extraction_date": data["extraction_date"],
            "extraction_time": data.get("extraction_time", ""),
            "biosafety_cabinet": data.get("biosafety_cabinet", ""),
            "extraction_instrument": data.get("extraction_instrument", ""),
            "kit_type": data.get("kit_type", ""),
            "reagent_lot": data.get("reagent_lot", ""),
            "reagent_expiry": data.get("reagent_expiry", ""),
            "step_confirmations": data.get("step_confirmations", {
                "uv_15min": False,
                "reagent_prep": False,
                "sample_add_400ul": False,
                "load_magnet": False,
                "cleanup_uv_30min": False,
            }),
            "operator_signature": data.get("operator"),
            "reviewer_signature": data.get("reviewer"),
            "saved_by": request.user.username,
            "saved_at": timezone.now().isoformat(),
        }

        if batch.status == "PLANNED":
            batch.status = "EXTRACTION"

        batch.save()
        return Response(HpvBatchSerializer(batch).data)

    # ── save_pcr ──

    @action(detail=True, methods=["POST"])
    def save_pcr(self, request, pk=None):
        """Save PCR stage data."""
        batch = self.get_object()
        if batch.status not in ("EXTRACTION", "PCR"):
            return Response(
                {"error": f"当前状态 '{batch.status}' 不可保存 PCR 数据"}, status=400
            )

        data = request.data
        required = ["pcr_date", "kit_type", "pcr_instrument"]
        for field in required:
            if not data.get(field):
                return Response({"error": f"缺少必填字段: {field}"}, status=400)

        batch.pcr_data = {
            "pcr_date": data.get("pcr_date", ""),
            "pcr_time": data.get("pcr_time", ""),
            "biosafety_cabinet": data.get("biosafety_cabinet", ""),
            "pcr_instrument": data.get("pcr_instrument", ""),
            "kit_type": data.get("kit_type", ""),
            "reagent_lot": data.get("reagent_lot", ""),
            "reagent_expiry": data.get("reagent_expiry", ""),
            "negative_control": data.get("negative_control", {}),
            "positive_control": data.get("positive_control", {}),
            "weak_positive_control": data.get("weak_positive_control"),
            "pcr_program": data.get("pcr_program", ""),
            "step_confirmations": data.get("step_confirmations", {
                "reaction_equilibration": False,
                "label_numbering": False,
                "add_sample_5ul": False,
                "centrifuge": False,
                "transfer": False,
                "program_run": False,
                "denaturation": False,
            }),
            "operator_signature": data.get("operator"),
            "reviewer_signature": data.get("reviewer"),
            "saved_by": request.user.username,
            "saved_at": timezone.now().isoformat(),
        }

        if batch.status == "EXTRACTION":
            batch.status = "PCR"

        batch.save()
        return Response(HpvBatchSerializer(batch).data)

    # ── save_hybridization ──

    @action(detail=True, methods=["POST"])
    def save_hybridization(self, request, pk=None):
        """Save hybridization stage data."""
        batch = self.get_object()
        if batch.status not in ("PCR", "HYBRIDIZATION"):
            return Response(
                {"error": f"当前状态 '{batch.status}' 不可保存杂交数据"}, status=400
            )

        data = request.data
        required = ["hybridization_date"]
        for field in required:
            if not data.get(field):
                return Response({"error": f"缺少必填字段: {field}"}, status=400)

        batch.hybridization_data = {
            "hybridization_date": data.get("hybridization_date", ""),
            "hybridization_time": data.get("hybridization_time", ""),
            "hybridization_instrument": data.get("hybridization_instrument", ""),
            "reagents": {
                "sds_1pct_date": data.get("sds_1pct_date", ""),
                "h2o2_3pct_date": data.get("h2o2_3pct_date", ""),
            },
            "self_prepared_reagent_dates": data.get("self_prepared_reagent_dates", {}),
            "strip_placement_order": data.get("strip_placement_order", ""),
            "hybridization_params": data.get("hybridization_params", {
                "temperature": "51℃",
                "shake_mix": "2min",
            }),
            "denatured_product_added": data.get("denatured_product_added", False),
            "post_experiment_notes": data.get("post_experiment_notes", ""),
            "well_assignments": data.get("well_assignments", {}),
            "operator_signature": data.get("operator"),
            "reviewer_signature": data.get("reviewer"),
            "saved_by": request.user.username,
            "saved_at": timezone.now().isoformat(),
        }

        if batch.status == "PCR":
            batch.status = "HYBRIDIZATION"

        batch.save()
        return Response(HpvBatchSerializer(batch).data)

    # ── advance_status ──

    @action(detail=True, methods=["POST"])
    def advance_status(self, request, pk=None):
        """Advance batch to the next status with guard checks."""
        batch = self.get_object()
        target = request.data.get("target_status", "").upper()

        valid_transitions = {
            "PLANNED": ["EXTRACTION"],
            "EXTRACTION": ["PCR", "FAILED"],
            "PCR": ["HYBRIDIZATION", "FAILED"],
            "HYBRIDIZATION": ["RESULT_ENTRY", "FAILED"],
            "RESULT_ENTRY": ["IN_REVIEW"],
            "IN_REVIEW": ["REVIEWED", "RESULT_ENTRY"],
            "REVIEWED": ["COMPLETED"],
        }
        allowed = valid_transitions.get(batch.status, [])
        if target not in allowed:
            return Response(
                {"error": f"无效转换: {batch.status} → {target}. 允许: {allowed}"},
                status=400,
            )

        # Guards
        if target == "RESULT_ENTRY":
            total_wells = batch.well_positions.count()
            total_photos = batch.membrane_photos.count()
            if total_photos < total_wells:
                return Response(
                    {"error": f"膜条照片未上传完整: {total_photos}/{total_wells}"},
                    status=400,
                )
        if target == "IN_REVIEW":
            total = batch.results.count()
            if total == 0:
                return Response(
                    {"error": "无结果数据，至少需录入一条"}, status=400
                )

        batch.status = target
        batch.save()
        return Response(HpvBatchSerializer(batch).data)

    # ── sign ──

    @action(detail=True, methods=["POST"])
    def sign(self, request, pk=None):
        """Record electronic signatures for the current stage."""
        batch = self.get_object()
        stage = request.data.get("stage", "")
        role = request.data.get("role", "")  # operator / reviewer
        signer_name = request.data.get("signer", "").strip()
        password = request.data.get("password", "").strip()
        if not password or password != "123456":
            return Response({"error": "密码错误"}, status=400)
        username = signer_name if signer_name else request.user.username
        timestamp = timezone.now().isoformat()

        stage_map = {
            "extraction": "extraction_data",
            "pcr": "pcr_data",
            "hybridization": "hybridization_data",
        }

        data_key = stage_map.get(stage)
        if not data_key:
            return Response({"error": f"未知阶段: {stage}"}, status=400)

        stage_data = getattr(batch, data_key, {}) or {}
        sig_key = "operator_signature" if role == "operator" else "reviewer_signature"
        stage_data[sig_key] = {
            "username": username,
            "signed_at": timestamp,
        }
        setattr(batch, data_key, stage_data)
        batch.save()
        return Response(HpvBatchSerializer(batch).data)

    # ── well_positions list ──

    @action(detail=True, methods=["GET"])
    def wells(self, request, pk=None):
        """Get all well positions for a batch."""
        batch = self.get_object()
        wells = batch.well_positions.prefetch_related("sample").all()
        return Response(HpvWellPositionSerializer(wells, many=True).data)

    def destroy(self, request, *args, **kwargs):
        """Delete a batch. Nullifies retest FK references to avoid PROTECT errors."""
        batch = self.get_object()

        # Nullify retest record references to this batch
        batch.retest_originals.update(original_batch=None)
        batch.retest_new.update(new_batch=None)

        # Cascade will handle: well_positions, results, membrane_photos
        batch.delete()

        return Response(
            {"detail": f"批次 {batch.batch_number} 已删除"},
            status=status.HTTP_200_OK,
        )


# ─── Result ViewSet ──────────────────────────────────────────────────

class HpvResultViewSet(viewsets.ModelViewSet):
    queryset = HpvResult.objects.select_related("sample", "well_position", "batch").all()
    serializer_class = HpvResultSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        batch_id = self.request.query_params.get("batch")
        if batch_id:
            qs = qs.filter(batch_id=batch_id)
        review_status = self.request.query_params.get("review_status")
        if review_status:
            qs = qs.filter(review_status=review_status.upper())
        return qs

    # ── batch_update ──

    @action(detail=False, methods=["POST"])
    @transaction.atomic
    def batch_update(self, request):
        """Bulk update genotype results for multiple samples."""
        serializer = HpvResultBatchUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        batch_id = serializer.validated_data["batch_id"]
        results_data = serializer.validated_data["results"]

        updated = []
        errors = []
        for item in results_data:
            sample_id = item.get("sample")
            if not sample_id:
                errors.append({"error": "missing sample", "item": item})
                continue

            try:
                sample_obj = Sample.objects.get(sample_id=sample_id)
            except Sample.DoesNotExist:
                errors.append({"error": f"sample not found: {sample_id}", "item": item})
                continue
            well = HpvWellPosition.objects.filter(batch_id=batch_id, sample=sample_obj).first()
            if not well:
                errors.append({"error": f"well not found for sample: {sample_id}", "item": item})
                continue
            result, _created = HpvResult.objects.get_or_create(
                batch_id=batch_id,
                well_position=well,
                defaults={
                    "sample": sample_obj,
                    "kit_type": "HPV_15",
                    "review_status": "DRAFT",
                }
            )

            # Update genotype_results
            if "genotype_results" in item:
                result.genotype_results = item["genotype_results"]
            if "ic_result" in item:
                result.ic_result = item["ic_result"]
                if item["ic_result"] != "+":
                    result.review_status = "NEEDS_RETEST"
            if "biotin_result" in item:
                result.biotin_result = item["biotin_result"]

            # Soft Biotin warning
            biotin = item.get("biotin_result", result.biotin_result)
            if biotin == "-":
                log_entry = {
                    "action": "biotin_warning",
                    "message": "Biotin 未显色，Biotin 未显色，怀疑试剂或操作问题",
                    "timestamp": timezone.now().isoformat(),
                    "user": request.user.username,
                }
                if isinstance(result.modification_log, list):
                    result.modification_log.append(log_entry)
                else:
                    result.modification_log = [log_entry]

            # Auto-interpret
            from .serializers import auto_interpret
            result.auto_interpretation = auto_interpret(
                result.genotype_results, result.ic_result
            )

            result.save()
            updated.append(HpvResultSerializer(result).data)

        return Response({"updated": updated, "errors": errors})

    # ── submit_review ──

    @action(detail=True, methods=["POST"])
    def submit_review(self, request, pk=None):
        """Submit result for peer review."""
        result = self.get_object()
        if result.review_status != "DRAFT":
            return Response(
                {"error": f"当前状态 '{result.review_status}' 不可提交复核"}, status=400
            )

        result.review_status = "PENDING_REVIEW"
        result.reviewer_1 = request.user
        result.save()
        return Response(HpvResultSerializer(result).data)

    # ── approve ──

    @action(detail=True, methods=["POST"])
    def approve(self, request, pk=None):
        """Second reviewer approves the result."""
        result = self.get_object()
        if result.review_status != "PENDING_REVIEW":
            return Response(
                {"error": f"当前状态 '{result.review_status}' 不可审批"}, status=400
            )

        serializer = HpvResultReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result.review_status = "REVIEWED"
        result.reviewer_2 = request.user

        log_entry = {
            "action": "approved",
            "comment": serializer.validated_data.get("comment", ""),
            "timestamp": timezone.now().isoformat(),
            "user": request.user.username,
        }
        if isinstance(result.modification_log, list):
            result.modification_log.append(log_entry)
        else:
            result.modification_log = [log_entry]

        result.save()
        return Response(HpvResultSerializer(result).data)

    # ── reject ──

    @action(detail=True, methods=["POST"])
    def reject(self, request, pk=None):
        """Reject a result, sending it back for revision."""
        result = self.get_object()
        if result.review_status != "PENDING_REVIEW":
            return Response(
                {"error": f"当前状态 '{result.review_status}' 不可退回"}, status=400
            )

        serializer = HpvResultReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result.review_status = "REJECTED"
        result.rejection_reason = serializer.validated_data.get("comment", "")
        result.reviewer_2 = request.user

        log_entry = {
            "action": "rejected",
            "comment": serializer.validated_data.get("comment", ""),
            "timestamp": timezone.now().isoformat(),
            "user": request.user.username,
        }
        if isinstance(result.modification_log, list):
            result.modification_log.append(log_entry)
        else:
            result.modification_log = [log_entry]

        result.save()
        return Response(HpvResultSerializer(result).data)

    # ── mark_retest ──

    @action(detail=True, methods=["POST"])
    @transaction.atomic
    def mark_retest(self, request, pk=None):
        """Mark a sample as needing retest and create a RetestRecord."""
        result = self.get_object()

        reason = request.data.get("reason", "OTHER")
        if reason not in dict(HpvRetestRecord._meta.get_field("retest_reason").choices):
            return Response({"error": f"无效复查原因: {reason}"}, status=400)

        result.review_status = "NEEDS_RETEST"
        result.save()

        retest = HpvRetestRecord.objects.create(
            original_sample=result.sample,
            original_batch=result.batch,
            retest_date=timezone.now().date(),
            retest_reason=reason,
            original_result=result.genotype_results,
            original_interpretation=result.auto_interpretation,
            operator=request.user,
        )

        return Response({
            "result": HpvResultSerializer(result).data,
            "retest_record": HpvRetestRecordSerializer(retest).data,
        })
    # ── qc_status ──
    @action(detail=False, methods=["POST"], url_path="qc_status")
    def qc_status(self, request):
        """Set QC status. Auto-creates result if needed."""
        status = request.data.get("qc_status", "")
        if status not in ("IN_CONTROL", "OUT_OF_CONTROL"):
            return Response({"error": "无效状态"}, status=400)

        batch_id = request.data.get("batch_id")
        well_label = request.data.get("well_label")
        result_id = request.data.get("result_id")

        if result_id:
            result = self.get_queryset().get(pk=result_id)
        elif batch_id and well_label:
            well = HpvWellPosition.objects.get(batch_id=batch_id, well_label=well_label)
            result, _ = HpvResult.objects.get_or_create(
                batch_id=batch_id, well_position=well,
                defaults={"sample": well.sample, "kit_type": "HPV_15", "review_status": "DRAFT"}
            )
        else:
            return Response({"error": "缺少 result_id 或 batch_id+well_label"}, status=400)

        result.qc_status = status
        result.save()
        if status == "OUT_OF_CONTROL":
            batch = result.batch
            if batch.status not in ("LOCKED", "COMPLETED"):
                batch.status = "LOCKED"
                batch.save()
        else:
            # If this was the last OUT_OF_CONTROL well, unlock the batch
            batch = result.batch
            if batch.status == "LOCKED":
                still_locked = HpvResult.objects.filter(
                    batch=batch, qc_status="OUT_OF_CONTROL"
                ).exists()
                if not still_locked:
                    batch.status = "HYBRIDIZATION"
                    batch.save()
        return Response(HpvResultSerializer(result).data)

    # ── mark_reportable ──
    @action(detail=True, methods=["POST"])
    def mark_reportable(self, request, pk=None):
        """Mark result as reportable."""
        result = self.get_object()
        result.review_status = "REVIEWED"
        result.save()
        return Response(HpvResultSerializer(result).data)



# ─── Membrane Photo ViewSet ──────────────────────────────────────────

class HpvMembranePhotoViewSet(viewsets.ModelViewSet):
    queryset = HpvMembranePhoto.objects.select_related("batch", "sample").all()
    serializer_class = HpvMembranePhotoSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        batch_id = self.request.query_params.get("batch")
        if batch_id:
            qs = qs.filter(batch_id=batch_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


# ─── Retest ViewSet ──────────────────────────────────────────────────

class HpvRetestViewSet(mixins.ListModelMixin,
                       mixins.RetrieveModelMixin,
                       mixins.UpdateModelMixin,
                       viewsets.GenericViewSet):
    queryset = HpvRetestRecord.objects.select_related(
        "original_sample", "original_batch", "new_batch"
    ).all()
    serializer_class = HpvRetestRecordSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        reason = self.request.query_params.get("reason")
        if reason:
            qs = qs.filter(retest_reason=reason.upper())
        return qs

    @action(detail=True, methods=["POST"])
    def complete(self, request, pk=None):
        """Complete a retest record with final results."""
        retest = self.get_object()
        retest.retest_result = request.data.get("retest_result", {})
        retest.retest_interpretation = request.data.get("retest_interpretation", "")
        retest.final_hpv_genotype = request.data.get("final_hpv_genotype", "")
        retest.report_opinion = request.data.get("report_opinion", "PENDING")
        retest.reviewer = request.user
        retest.save()
        return Response(HpvRetestRecordSerializer(retest).data)
