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
                # Store previous status before locking
                if not batch.lock_prev_status:
                    batch.lock_prev_status = batch.status
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
                    # Restore previous status, then clear the stored value
                    batch.status = batch.lock_prev_status or "HYBRIDIZATION"
                    batch.lock_prev_status = ""
                    batch.save()
        return Response(HpvResultSerializer(result).data)

    # ── report_html ──
    @action(detail=True, methods=["GET"])
    def report_html(self, request, pk=None):
        """Generate a printable HTML report."""
        result = self.get_object()
        sample = result.sample
        if not sample:
            return Response({"error": "No sample linked"}, status=400)

        LOW_RISK = ["6", "11", "42", "43", "81", "83"]
        HIGH_RISK = ["16", "18", "26", "31", "33", "35", "39", "45", "51", "52", "53", "56", "58", "59", "66", "68", "73", "82"]
        genotypes = result.genotype_results or {}
        positives = [k for k, v in genotypes.items() if v == "+"]
        all_neg = len(positives) == 0

        def rc(gt):
            v = genotypes.get(gt, "")
            if v == "+":
                return '<span style="color:#cf1322;font-weight:bold">' + "\u9633\u6027\uff08+\uff09" + '</span>'
            return "\u9634\u6027\uff08-\uff09"

        rows_low = ""
        for gt in LOW_RISK:
            rows_low += '<tr><td>HPV-{}'.format(gt) + '\uff08\u4f4e\u5371\u578b\uff09</td><td>PCR-\u53cd\u5411\u70b9\u6742\u4ea4\u6cd5</td><td>{}</td><td>\u9634\u6027\uff08-\uff09</td></tr>'.format(rc(gt))

        rows_high = ""
        for gt in HIGH_RISK:
            rows_high += '<tr><td>HPV-{}'.format(gt) + '\uff08\u9ad8\u5371\u578b\uff09</td><td>PCR-\u53cd\u5411\u70b9\u6742\u4ea4\u6cd5</td><td>{}</td><td>\u9634\u6027\uff08-\uff09</td></tr>'.format(rc(gt))

        if all_neg:
            summary = "\u68c0\u6d4b\u4e0a\u8ff023\u79cdHPV\u57fa\u56e0\u578b\uff0c\u7ed3\u679c\u5747\u4e3a\u9634\u6027\u3002"
        else:
            pos_list = "\u3001".join(["HPV{}".format(p) for p in positives])
            summary = "\u68c0\u6d4b\u4e0a\u8ff023\u79cdHPV\u57fa\u56e0\u578b\uff0c\u5176\u4e2d{}\u9633\u6027\uff0c\u5176\u4f59\u4e9a\u578b\u5747\u4e3a\u9634\u6027\u3002".format(pos_list)

        patient_name = sample.patient_name or ""
        sample_id = sample.sample_id or ""
        batch_number = result.batch.batch_number if result.batch else ""
        kit_type = result.kit_type or "HPV_23"
        today = timezone.now().strftime("%Y.%m.%d")
        now_str = timezone.now().strftime("%Y.%m.%d %H:%M")

        html = """<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><title>HPV Report - """ + sample_id + """</title>
<style>
@media print { body { -webkit-print-color-adjust: exact; } }
body { font-family: 'SimSun','Songti SC',serif; font-size:13px; color:#333; max-width:740px; margin:30px auto; line-height:1.6; }
.header { text-align:center; margin-bottom:8px; }
.header h1 { font-size:15px; margin:2px 0; font-weight:bold; }
.header .en { font-size:10px; color:#666; }
.title { text-align:center; font-size:16px; font-weight:bold; margin:12px 0; border-bottom:2px solid #333; padding-bottom:6px; }
table { width:100%; border-collapse:collapse; margin:8px 0; font-size:12px; }
table.info td { padding:4px 6px; border:1px solid #999; }
table.result th { background:#e6f0fa; padding:5px 6px; border:1px solid #999; text-align:center; font-weight:bold; }
table.result td { padding:4px 6px; border:1px solid #999; text-align:center; }
table.result tr.section td { background:#f0f0f0; font-weight:bold; text-align:left; }
.summary { margin:10px 0; padding:8px; border:1px solid #999; }
.interpretation { margin:10px 0; }
.interpretation h3 { font-size:13px; margin:6px 0; }
.interpretation p { margin:3px 0; }
.footer { margin-top:20px; font-size:11px; }
.footer .disclaimer { color:#999; font-size:10px; }
</style></head><body>
<div class="header"><h1>\u53a6\u95e8\u6021\u751f\u65b9\u548c\u533b\u5b66\u68c0\u9a8c\u5b9e\u9a8c\u5ba4</h1>
<div class="en">XIAMEN YISHENGFANGHE MEDICAL LABORATORY</div></div>
<div class="title">\u4eba\u4e73\u5934\u72b6\u7624\u75c5\u6bd2HPV\u57fa\u56e0\uff0823\u578b\uff09\u68c0\u9a8c\u62a5\u544a\u5355</div>
<table class="info">
<tr><td><b>\u59d3\u540d\uff1a</b>""" + patient_name + """</td><td><b>\u6807\u672c\u7c7b\u578b\uff1a</b>\u5bab\u9888\u8131\u843d\u7ec6\u80de</td><td><b>\u6837\u672c\u7f16\u53f7\uff1a</b>""" + sample_id + """</td><td><b>\u63a5\u6536\u65e5\u671f\uff1a</b></td></tr>
<tr><td><b>\u6027\u522b\uff1a</b></td><td><b>\u6807\u672c\u8bf4\u660e\uff1a</b>\u5408\u683c</td><td><b>\u5b9e\u9a8c\u7f16\u53f7\uff1a</b>""" + batch_number + """</td><td><b>\u68c0\u6d4b\u65e5\u671f\uff1a</b>""" + today + """</td></tr>
<tr><td><b>\u5e74\u9f84\uff1a</b></td><td><b>\u9001\u68c0\u673a\u6784\uff1a</b></td><td><b>\u8bd5\u5242\u76d2\uff1a</b>""" + kit_type + """</td><td></td></tr>
</table>
<table class="result">
<tr><th>\u9879\u76ee</th><th>\u68c0\u6d4b\u65b9\u6cd5</th><th>\u68c0\u6d4b\u7ed3\u679c</th><th>\u53c2\u8003\u533a\u95f4</th></tr>
<tr class="section"><td colspan="4">\u4eba\u4e73\u5934\u72b6\u7624\u75c5\u6bd2(HPV)\u4f4e\u5371\u578b\uff086\u79cd\uff09</td></tr>
""" + rows_low + """
<tr class="section"><td colspan="4">\u4eba\u4e73\u5934\u72b6\u7624\u75c5\u6bd2(HPV)\u9ad8\u5371\u578b\uff0817\u79cd\uff09</td></tr>
""" + rows_high + """
<tr><td colspan="4" style="text-align:left;padding:6px"><b>\u68c0\u6d4b\u4eea\u5668\u540d\u79f0\u53ca\u578b\u53f7\uff1a</b><br>\u5168\u81ea\u52a8\u6838\u9178\u63d0\u53d6\u4eea\uff08\u578b\u53f7YN-AP48\uff09<br>\u5168\u81ea\u52a8\u6838\u9178\u5206\u5b50\u6742\u4ea4\u4eea\uff08\u578b\u53f7YN-H48\uff09</td></tr>
</table>
<div class="summary"><span class="label">\u68c0\u6d4b\u7ed3\u679c\uff1a</span><br>""" + summary + """</div>
<div class="interpretation"><h3>\u7ed3\u679c\u5efa\u8bae\u548c\u89e3\u91ca\uff1a</h3>
<p>1. \u4eba\u4e73\u5934\u72b6\u7624\u75c5\u6bd2\uff08HPV\uff09\u57fa\u56e0\u5206\u578b\u68c0\u6d4b\u662f\u5bab\u9888\u75c5\u53d8\u53ca\u5bab\u9888\u764c\u7b5b\u67e5\u7684\u4e3b\u8981\u624b\u6bb5\u3002\u6021\u751f\u65b9\u548cHPV\u68c0\u6d4b\u901a\u8fc7\u5206\u6790\u5973\u6027\u5bab\u9888\u8131\u843d\u7ec6\u80de\u6837\u672c\uff0c\u80fd\u591f\u68c0\u6d4b\u548c\u9274\u5b9a23\u79cd\u57fa\u56e0\u578b\u7684HPV\u611f\u67d3\uff0c\u5305\u62ec6\u79cd\u4f4e\u5371\u578b\uff086\u300111\u300142\u300143\u300181\u300183\uff09\u300117\u79cd\u9ad8\u5371\u578b\uff0816\u300118\u300126\u300131\u300133\u300135\u300139\u300145\u300151\u300152\u300153\u300156\u300158\u300159\u300166\u300168\u300173\u300182\uff09\u3002</p>
<p>(1) \u9ad8\u5371\u578bHPV\u7684\u6301\u7eed\u611f\u67d3\u662f\u5f15\u8d77\u5bab\u9888\u764c\u7684\u4e3b\u8981\u539f\u56e0\u3002</p>
<p>(2) \u4f4e\u5371\u578bHPV\u7684\u611f\u67d3\u80fd\u5f15\u8d77\u5bab\u9888\u4e0a\u76ae\u4f4e\u5ea6\u75c5\u53d8\u548c\u826f\u6027\u6e7f\u75e3\u3002</p>
<p>2. HPV\u9634\u6027\u5efa\u8bae\u8bf71\u5e74\u540e\u590d\u67e5\u3002\u590d\u8bca\u7ed3\u679c\u4ecd\u4e3aHPV\u9634\u6027\uff0c\u968f\u8bbf\u95f4\u9694\u53ef\u4ee5\u5ef6\u81f33-5\u5e74\u3002</p>
<p>3. HPV\u9633\u6027\u8005\u4e0d\u8981\u6709\u592a\u5927\u7684\u5fc3\u7406\u538b\u529b\uff0c\u65e0\u8bba\u9ad8\u5371\u578b\u6216\u4f4e\u5371\u578b\uff0c\u5927\u90e8\u5206\u4ebaHPV\u611f\u67d3\u4f1a\u81ea\u884c\u6d88\u9000\uff08HPV\u81ea\u7136\u6d88\u9000\u671f8-10\u4e2a\u6708\uff09\u3002HPV\u68c0\u6d4b\u9633\u6027\u4e0d\u4ee3\u8868\u4f1a\u5f97\u764c\u75c7\uff0c\u6301\u7eed\u8ddf\u8e2a\u68c0\u6d4b\u53ef\u4ee5\u5c06\u764c\u75c7\u53d1\u751f\u6d88\u706d\u5728\u840c\u82bd\u9636\u6bb5\u3002</p>
<p>HPV\u9633\u6027\u8005\u5efa\u8bae\u8fdb\u884c\u7ec6\u80de\u5b66\u68c0\u6d4b\uff1a\u7ec6\u80de\u5b66\u68c0\u6d4b\u7ed3\u679c\u6b63\u5e38\u8005\u6bcf\u5e74\u8ddf\u8e2a\u968f\u8bca\u4e00\u6b21\uff1b\u5f02\u5e38\u8005\u8bf7\u54a8\u8be2\u533b\u751f\u8fdb\u884c\u8fdb\u4e00\u6b65\u8bca\u65ad\u4e0e\u6cbb\u7597\u3002</p>
<p>4. \u91c7\u6837\u65b9\u6cd5\u4e0d\u51c6\u786e\u6216\u6709\u672a\u7ecf\u9a8c\u8bc1\u7684\u5e72\u6270\u7269\u8d28\u6c61\u67d3\u6837\u54c1\uff0c\u53ef\u80fd\u9020\u6210\u5047\u9634\u6027\u7ed3\u679c\u3002</p></div>
<div class="footer">
<div class="signatures"><b>\u68c0\u9a8c\u8005\uff1a</b>________________&emsp;&emsp;<b>\u5ba1\u6838\u8005\uff1a</b>________________&emsp;&emsp;<b>\u65f6\u95f4\uff1a</b>""" + now_str + """</div>
<p>\u5907\u6ce8\uff1a\u672c\u68c0\u6d4b\u7ed3\u679c\u4ec5\u5bf9\u6765\u6837\u8d1f\u8d23\uff0c\u4f9b\u4e34\u5e8a\u53c2\u8003\uff0c\u5982\u6709\u7591\u95ee\u8bf7\u5728\u6536\u5230\u62a5\u544a\u540e7\u5929\u5185\u63d0\u51fa\u3002</p>
<p class="disclaimer">\u5730\u5740\uff1a\u53a6\u95e8\u706b\u70ac\u9ad8\u65b0\u533a\u521b\u4e1a\u56ed\u706b\u70ac\u4e1c\u8def11-15\u53f7\u4f1f\u4e1a\u697c\u5317\u697c305B\u5ba4</p></div>
</body></html>"""
        return Response({"html": html})


    # ── mark_reportable ──
    @action(detail=True, methods=["POST"])
    @transaction.atomic
    def mark_reportable(self, request, pk=None):
        """Mark result as reportable and create a Report record."""
        result = self.get_object()
        result.review_status = "REVIEWED"
        result.save()

        # Create Report record so it appears in Reports module
        if result.sample:
            from lims.apps.reports.models import Report, ReportTemplate
            from lims.apps.organizations.models import Site

            # Find HPV template (prefer Chinese)
            template = ReportTemplate.objects.filter(
                code__istartswith="hpv", is_active=True
            ).order_by("code").first()

            if template:
                # Generate report number: RPT-HPV-YYYYMMDD-XXXX
                today = timezone.now().strftime("%Y%m%d")
                last = Report.objects.filter(
                    report_number__startswith=f"RPT-HPV-{today}"
                ).order_by("-report_number").first()
                if last:
                    seq = int(last.report_number[-4:]) + 1
                else:
                    seq = 1
                report_number = f"RPT-HPV-{today}-{seq:04d}"

                # Get site from batch or user
                site = result.batch.site if result.batch and result.batch.site else (
                    request.user.site if hasattr(request.user, 'site') and request.user.site else Site.objects.first()
                )

                # Collect genotype results for report content
                positives = [k for k, v in (result.genotype_results or {}).items() if v == "+"]
                content = {
                    "sample_id": result.sample.sample_id,
                    "patient_name": result.sample.patient_name or "",
                    "kit_type": result.kit_type,
                    "genotype_results": result.genotype_results or {},
                    "positive_genotypes": positives,
                    "ic_result": result.ic_result,
                    "biotin_result": result.biotin_result,
                    "auto_interpretation": result.auto_interpretation,
                    "review_status": "REVIEWED",
                    "generated_at": timezone.now().isoformat(),
                }

                report, created = Report.objects.get_or_create(
                    sample=result.sample,
                    template=template,
                    defaults={
                        "report_number": report_number,
                        "site": site,
                        "content": content,
                        "status": "DRAFT",
                    }
                )
                if not created:
                    # Update existing report content
                    report.content = content
                    report.status = "DRAFT"
                    report.save()

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
