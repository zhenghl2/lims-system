
"""Views for plasma separation module."""
from datetime import date, datetime
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db import transaction

from .models import PlasmaSeparationBatch, PlasmaSeparationSample, PlasmaSeparationPhoto
from .serializers import (
    PlasmaSeparationBatchListSerializer,
    PlasmaSeparationBatchDetailSerializer,
    PlasmaSeparationBatchCreateSerializer,
    PlasmaSeparationSampleSerializer,
    PlasmaSeparationPhotoSerializer,
)
from lims.apps.samples.models import Sample


QC_REASON_CHOICES = [
    ("HEMOLYSIS", "溶血"),
    ("INSUFFICIENT_PLASMA", "血浆量不足"),
    ("CLOTTED", "凝血"),
    ("LIPEMIC", "脂血"),
    ("OTHER", "其他"),
]


def _generate_batch_number():
    """Generate batch number: PS-YYYYMMDD-HHMM-NN"""
    now = datetime.now()
    date_part = now.strftime("%Y%m%d")
    time_part = now.strftime("%H%M")
    prefix = f"PS-{date_part}-{time_part}"
    count = PlasmaSeparationBatch.objects.filter(
        batch_number__startswith=f"PS-{date_part}"
    ).count() + 1
    return f"{prefix}-{count:02d}"

# NIPT plasma separation signers
NIPT_SIGNERS = [
    "杜兴琼", "龙雨青", "张斯栋", "郭爽洁",
    "林琦", "吴书凌", "叶丽婷", "付慧珠",
    "何家宇", "胡煜敏",
]
NIPT_SIGNER_PASSWORDS = {
    "杜兴琼": "123456", "龙雨青": "123456", "张斯栋": "123456", "郭爽洁": "123456",
    "林琦": "123456", "吴书凌": "123456", "叶丽婷": "123456", "付慧珠": "123456",
    "何家宇": "123456", "胡煜敏": "123456",
}

class PlasmaSeparationBatchViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    queryset = PlasmaSeparationBatch.objects.all()

    def get_serializer_class(self):
        if self.action == "list":
            return PlasmaSeparationBatchListSerializer
        if self.action == "create":
            return PlasmaSeparationBatchCreateSerializer
        return PlasmaSeparationBatchDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        # Filter by panel via sample's panel
        panel = self.request.query_params.get("panel", "")
        if panel:
            panel_codes = [p.strip() for p in panel.split(",") if p.strip()]
            from lims.apps.samples.models import TestPanel
            panels = TestPanel.objects.filter(code__in=panel_codes, is_active=True)
            qs = qs.filter(
                batch_samples__sample__panel__in=panels
            ).distinct()
        return qs

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from lims.apps.organizations.models import Site
        user = request.user
        site = user.site if user.site_id else Site.objects.filter(is_active=True).first()

        batch_number = _generate_batch_number()
        batch = PlasmaSeparationBatch.objects.create(
            batch_number=batch_number,
            experiment_date=data["experiment_date"],
            experiment_time=data["experiment_time"],
            equipment_type=data["equipment_type"],
            notes=data.get("notes", ""),
            operator=user,
            site=site,
        )

        sample_ids = data["sample_ids"]
        errors = []
        for sid in sample_ids:
            try:
                sample = Sample.objects.get(id=sid)
                if sample.status != "RECEIVED":
                    errors.append(f"{sample.sample_id}: status is {sample.status}, must be RECEIVED")
                    continue
                PlasmaSeparationSample.objects.create(
                    batch=batch,
                    sample=sample,
                    qc_result="PENDING",
                    plasma_count=data.get(f"plasma_count_{sid}", 3),
                )
                sample.status = "PRE_PROCESSING"
                sample.save(update_fields=["status"])
            except Sample.DoesNotExist:
                errors.append(f"Sample {sid} not found")

        if errors:
            # Don't rollback, but return warnings
            result = PlasmaSeparationBatchDetailSerializer(batch).data
            result["_warnings"] = errors
            return Response(result, status=status.HTTP_201_CREATED)

        result = PlasmaSeparationBatchDetailSerializer(batch)
        return Response(result.data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Cannot delete a completed batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Revert sample statuses back to RECEIVED, reset plasma
        for ps in batch.batch_samples.all():
            Sample.objects.filter(id=ps.sample_id).update(
                status="RECEIVED",
                plasma_count=3,
                plasma_remaining=3,
            )
        batch.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        """Complete the batch: validate all samples QC'd, signatures present, photos taken."""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Batch is already completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate all samples have QC result
        pending = batch.batch_samples.filter(qc_result="PENDING").count()
        if pending > 0:
            return Response(
                {"error": f"{pending} sample(s) still pending QC."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate signatures (name+password or image)
        if not batch.operator_signature_data and not batch.operator_signature:
            return Response(
                {"error": "Operator signature is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not batch.reviewer_signature_data and not batch.reviewer_signature:
            return Response(
                {"error": "Reviewer signature is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate at least one photo
        if not batch.photos.exists():
            return Response(
                {"error": "At least one photo is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Process each sample
        for ps in batch.batch_samples.select_related("sample").all():
            if ps.qc_result == "PASS":
                Sample.objects.filter(id=ps.sample_id).update(
                    status="PLASMA_SEPARATED",
                    plasma_count=ps.plasma_count,
                    plasma_remaining=ps.plasma_count,
                )
            elif ps.qc_result == "FAIL":
                reason_display = dict(QC_REASON_CHOICES).get(ps.qc_reason, ps.qc_reason)
                Sample.objects.filter(id=ps.sample_id).update(
                    status="REJECTED",
                    rejection_reason=f"血浆分离不合格: {reason_display}",
                    plasma_count=ps.plasma_count,
                    plasma_remaining=0,
                )

        batch.status = "COMPLETED"
        batch.save(update_fields=["status"])

        return Response(PlasmaSeparationBatchDetailSerializer(batch).data)

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload_photo(self, request, pk=None):
        """Upload a photo for this batch."""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Cannot add photos to a completed batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image = request.FILES.get("image")
        if not image:
            return Response(
                {"error": "No image file provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        caption = request.data.get("caption", "")
        photo = PlasmaSeparationPhoto.objects.create(
            batch=batch, image=image, caption=caption
        )
        return Response(
            PlasmaSeparationPhotoSerializer(photo).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["delete"], url_path="photos/(?P<photo_id>[^/.]+)")
    def delete_photo(self, request, pk=None, photo_id=None):
        """Delete a photo from this batch."""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Cannot remove photos from a completed batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            photo = batch.photos.get(id=photo_id)
            photo.image.delete(save=False)
            photo.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PlasmaSeparationPhoto.DoesNotExist:
            return Response(
                {"error": "Photo not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=True, methods=["patch"], url_path="samples/(?P<sample_id>[^/.]+)/qc")
    @transaction.atomic
    def set_qc(self, request, pk=None, sample_id=None):
        """Set QC result for a single sample in the batch."""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Cannot modify QC of a completed batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            ps = batch.batch_samples.get(sample_id=sample_id)
        except PlasmaSeparationSample.DoesNotExist:
            return Response(
                {"error": "Sample not found in this batch."},
                status=status.HTTP_404_NOT_FOUND,
            )

        qc_result = request.data.get("qc_result")
        qc_reason = request.data.get("qc_reason", "")
        notes = request.data.get("notes", "")

        if qc_result not in ["PASS", "FAIL"]:
            return Response(
                {"error": "qc_result must be PASS or FAIL."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if qc_result == "FAIL" and not qc_reason:
            return Response(
                {"error": "qc_reason is required when qc_result is FAIL."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ps.qc_result = qc_result
        ps.qc_reason = qc_reason
        ps.notes = notes
        # 🆕 Update plasma_count if provided
        plasma_count = request.data.get("plasma_count")
        update_fields = ["qc_result", "qc_reason", "notes"]
        if plasma_count is not None:
            ps.plasma_count = int(plasma_count)
            update_fields.append("plasma_count")
        ps.save(update_fields=update_fields)

        return Response(PlasmaSeparationSampleSerializer(ps).data)

    @staticmethod
    def _resolve_signers(request_data):
        """Resolve signer names + validate passwords. Returns (sig_list, error_response).
        
        Multi-operator mode: request sends signers=[...] + passwords={name: pwd}
        Single mode (backward compat): request sends signer + password
        """
        from django.utils import timezone
        timestamp = timezone.now().isoformat()

        signers = request_data.get("signers")
        passwords_map = request_data.get("passwords", {})

        if signers and isinstance(signers, list) and len(signers) > 0:
            sig_list = []
            for name in signers:
                name = name.strip()
                if not name:
                    return None, Response({"error": "签名人姓名不能为空"}, status=status.HTTP_400_BAD_REQUEST)
                if name not in NIPT_SIGNERS:
                    return None, Response({"error": f"无效的签名人: {name}"}, status=status.HTTP_400_BAD_REQUEST)
                pwd = passwords_map.get(name, "").strip()
                expected = NIPT_SIGNER_PASSWORDS.get(name, "")
                if not pwd or pwd != expected:
                    return None, Response({"error": f"{name} 密码错误"}, status=status.HTTP_400_BAD_REQUEST)
                sig_list.append({"username": name, "signed_at": timestamp})
            return sig_list, None
        else:
            signer_name = request_data.get("signer", "").strip()
            password = request_data.get("password", "").strip()
            if not signer_name:
                return None, Response({"error": "请选择签名人"}, status=status.HTTP_400_BAD_REQUEST)
            if signer_name not in NIPT_SIGNERS:
                return None, Response({"error": f"无效的签名人: {signer_name}"}, status=status.HTTP_400_BAD_REQUEST)
            expected = NIPT_SIGNER_PASSWORDS.get(signer_name, "")
            if not password or password != expected:
                return None, Response({"error": "密码错误"}, status=status.HTTP_400_BAD_REQUEST)
            return [{"username": signer_name, "signed_at": timestamp}], None

    @action(detail=True, methods=["post"], url_path="sign")
    @transaction.atomic
    def sign(self, request, pk=None):
        """Record electronic signature - supports multi-operator + individual passwords."""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(
                {"error": "Cannot modify signatures of a completed batch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = request.data.get("role")
        if role not in ["operator", "reviewer"]:
            return Response(
                {"error": "role must be 'operator' or 'reviewer'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sig_list, err = self._resolve_signers(request.data)
        if err:
            return err

        sig_data = sig_list if (role == "operator" and len(sig_list) > 1) else sig_list[0]

        signature_file = request.FILES.get("signature")
        update_fields = ["updated_at"]

        if role == "operator":
            batch.operator_signature_data = sig_data
            update_fields.append("operator_signature_data")
            if signature_file:
                batch.operator_signature = signature_file
                update_fields.append("operator_signature")
        else:
            batch.reviewer_signature_data = sig_data
            update_fields.append("reviewer_signature_data")
            if signature_file:
                batch.reviewer_signature = signature_file
                update_fields.append("reviewer_signature")

        batch.save(update_fields=update_fields)
        return Response(PlasmaSeparationBatchDetailSerializer(batch).data)

    @action(detail=False, methods=["get"])
    def qc_reasons(self, request):
        """Return available QC failure reasons."""
        return Response([
            {"code": code, "label": label}
            for code, label in QC_REASON_CHOICES
        ])

    @action(detail=False, methods=["get"])
    def signers(self, request):
        """Return available signers for NIPT plasma separation."""
        return Response(NIPT_SIGNERS)
