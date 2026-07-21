"""Case views."""
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter, SearchFilter
from .models import Case, CaseSample
from .serializers import (
    CaseListSerializer, CaseDetailSerializer, CaseCreateSerializer,
    CaseSampleSerializer, PublicRegistrationSerializer,
    SupplementSerializer,
)
from lims.apps.samples.models import Sample, SampleType
from lims.apps.organizations.models import Site
from datetime import date
import datetime


class CaseViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ["panel", "is_urgent"]
    search_fields = ["case_number", "clinic_name", "sales_person"]
    ordering_fields = ["created_at", "case_number", "expected_completion"]

    def get_queryset(self):
        qs = Case.objects.prefetch_related("case_samples__sample").all()
        # Support comma-separated status values (e.g. ?status=REGISTERED,RECEIVING)
        status_param = self.request.query_params.get("status", "")
        if status_param:
            statuses = [s.strip() for s in status_param.split(",") if s.strip()]
            if len(statuses) == 1:
                qs = qs.filter(status=statuses[0])
            elif len(statuses) > 1:
                qs = qs.filter(status__in=statuses)
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return CaseListSerializer
        if self.action == "create":
            return CaseCreateSerializer
        return CaseDetailSerializer

    def perform_create(self, serializer):
        serializer.save()

    @action(detail=True, methods=["post"])
    def generate_token(self, request, pk=None):
        """Generate a public registration token for this case."""
        case = self.get_object()
        token = case.generate_token()
        case.save(update_fields=["registration_token", "registration_token_expires"])
        url = request.build_absolute_uri(f"/register/{token}/")
        return Response({"token": token, "url": url, "expires": case.registration_token_expires})

    @action(detail=True, methods=["post"])
    def confirm_receipt(self, request, pk=None):
        """Confirm receipt of a specific CaseSample."""
        case = self.get_object()
        sample_id = request.data.get("sample_id")
        condition = request.data.get("condition", "OK")

        cs = case.case_samples.filter(sample_id=sample_id).first()
        if not cs:
            raise NotFound("Sample not found in this case")

        cs.confirm_receipt(request.user, condition=condition)
        sample = cs.sample
        if condition == "OK":
            sample.status = "RECEIVED"
        else:
            sample.status = "REJECTED"
            sample.rejection_reason = condition
            sample.rejection_note = request.data.get("rejection_note", "")
        sample.receipt_date = timezone.now().date()
        sample.receipt_time = timezone.now().time()
        sample.save(update_fields=[
            "status", "rejection_reason", "rejection_note",
            "receipt_date", "receipt_time", "updated_at",
        ])

        # Clear prefetch cache to avoid staleness from get_queryset's prefetch_related
        if hasattr(case, '_prefetched_objects_cache'):
            case._prefetched_objects_cache.pop('case_samples', None)

        # Transition REGISTERED -> RECEIVING when at least one sample received
        if case.status == Case.Status.REGISTERED:
            case.status = Case.Status.RECEIVING
            case.save(update_fields=["status", "updated_at"])

        if case.all_samples_received:
            case.status = Case.Status.IN_PROCESS
            case.save(update_fields=["status", "updated_at"])

            # Auto-create Run with NIPPT workflow protocol
            from lims.apps.workflows.models import SampleRun, WorkflowStep, WorkflowProtocol, RunSample
            from datetime import date

            protocol = WorkflowProtocol.objects.filter(
                panel=case.panel, is_active=True
            ).order_by("-version").first()

            if protocol:
                today_str = date.today().strftime("%Y%m%d")
                prefix = f"RUN-{case.case_number}"
                count = SampleRun.objects.filter(run_number__startswith=prefix).count() + 1
                run_number = f"{prefix}-{count:04d}"

                run = SampleRun.objects.create(
                    run_number=run_number,
                    panel=case.panel,
                    protocol=protocol,
                    status="PLANNED",
                    site=case.site or request.user.site or Site.objects.first(),
                    operator=request.user,
                    notes=f"Auto-created for case {case.case_number}",
                )

                for cs in case.case_samples.select_related("sample").all():
                    rs = RunSample.objects.create(
                        run=run, sample=cs.sample, status="QUEUED"
                    )
                    for step_def in protocol.steps_definition:
                        WorkflowStep.objects.create(
                            run=run,
                            sample=cs.sample,
                            step_id=step_def.get("step_id", ""),
                            step_name=step_def.get("step_name", ""),
                            step_order=step_def.get("step_order", 0),
                            status="PENDING",
                        )

                # Activate first step
                first_step = WorkflowStep.objects.filter(
                    run=run, step_order=1
                ).first()
                if first_step:
                    first_step.status = "IN_PROGRESS"
                    first_step.started_at = timezone.now()
                    first_step.save(update_fields=["status", "started_at"])

        return Response(CaseSampleSerializer(cs).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Reject a specific CaseSample with reason."""
        case = self.get_object()
        sample_id = request.data.get("sample_id")
        rejection_reason = request.data.get("rejection_reason", "")
        rejection_note = request.data.get("rejection_note", "")

        if not rejection_reason:
            raise ValidationError("rejection_reason is required")

        cs = case.case_samples.filter(sample_id=sample_id).first()
        if not cs:
            raise NotFound("Sample not found in this case")

        cs.receipt_condition = rejection_reason
        cs.received_at = timezone.now()
        cs.received_by = request.user
        cs.save(update_fields=["receipt_condition", "received_at", "received_by", "updated_at"])

        sample = cs.sample
        sample.status = "REJECTED"
        sample.rejection_reason = rejection_reason
        sample.rejection_note = rejection_note
        sample.receipt_date = timezone.now().date()
        sample.receipt_time = timezone.now().time()
        sample.save(update_fields=[
            "status", "rejection_reason", "rejection_note",
            "receipt_date", "receipt_time", "updated_at",
        ])

        # Clear prefetch cache
        if hasattr(case, '_prefetched_objects_cache'):
            case._prefetched_objects_cache.pop('case_samples', None)

        return Response(CaseSampleSerializer(cs).data)

    @action(detail=True, methods=["post"])
    def supplement(self, request, pk=None):
        """补充样本：给已有 Case 添加新的 CaseSample (母亲或父亲补采)."""
        case = self.get_object()
        serializer = SupplementSerializer(data=request.data, context={"case": case, "request": request})
        serializer.is_valid(raise_exception=True)
        new_cs = serializer.save()
        return Response(CaseSampleSerializer(new_cs).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def resample(self, request, pk=None):
        """Create a resample for a rejected CaseSample."""
        from django.db.models import Max

        case = self.get_object()
        case_sample_id = request.data.get("case_sample_id")
        patient_name = request.data.get("patient_name", "").strip()
        sample_source = request.data.get("sample_source", "BLOOD")

        if not case_sample_id:
            raise ValidationError("case_sample_id is required")

        original_cs = case.case_samples.filter(id=case_sample_id).first()
        if not original_cs:
            raise NotFound("CaseSample not found in this case")

        # Determine next resample number
        if original_cs.resample_number:
            next_num = original_cs.resample_number + 1
        else:
            max_existing = case.case_samples.filter(
                resample_of=original_cs
            ).aggregate(m=Max("resample_number"))["m"]
            next_num = (max_existing or 1) + 1

        if not patient_name:
            patient_name = original_cs.patient_name or original_cs.sample.patient_name

        with transaction.atomic():
            sample_type = original_cs.sample.sample_type
            new_sample = Sample.objects.create(
                sample_id=f"{case.case_number}-RESAMPLE-{next_num}",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=patient_name,
                patient_sex=original_cs.sample.patient_sex,
                status="REGISTERED",
                site=case.site,
                collection_date=timezone.now().date(),
                receipt_date=timezone.now().date(),
                receipt_time=timezone.now().time(),
            )

            arrival_date = request.data.get("arrival_date")
            new_cs = CaseSample.objects.create(
                case=case,
                sample=new_sample,
                role=original_cs.role,
                sample_source=sample_source.upper(),
                ethnicity=original_cs.ethnicity,
                resample_of=original_cs,
                resample_number=next_num,
                arrival_date=arrival_date,
            )
            new_cs.test_sample_id = case.generate_test_sample_id(new_cs)
            new_cs.save(update_fields=["test_sample_id"])

        return Response(CaseSampleSerializer(new_cs).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="upload-receipt-photo")
    def upload_receipt_photo(self, request, pk=None):
        """Upload receipt photo for a CaseSample."""
        case = self.get_object()
        case_sample_id = request.data.get("case_sample_id")
        photo = request.FILES.get("photo")
        if not case_sample_id or not photo:
            raise ValidationError("case_sample_id and photo are required")
        cs = case.case_samples.filter(id=case_sample_id).first()
        if not cs:
            raise NotFound("CaseSample not found in this case")
        cs.receipt_photo = photo
        cs.save(update_fields=["receipt_photo", "updated_at"])
        return Response({
            "id": str(cs.id),
            "receipt_photo_url": request.build_absolute_uri(cs.receipt_photo.url) if cs.receipt_photo else None,
        })

    @action(detail=True, methods=["post"])
    def add_sample(self, request, pk=None):

        """Directly add a sample to a case (internal use)."""
        case = self.get_object()
        role = request.data.get("role", "ALLEGED_FATHER")
        patient_name = request.data.get("patient_name", "").strip()
        sample_source = request.data.get("sample_source", "BLOOD")
        ethnicity = request.data.get("ethnicity", "").strip()
        collection_date = request.data.get("collection_date") or timezone.now().date()
        custom_sample_id = request.data.get("sample_id", "").strip()

        if not patient_name:
            raise ValidationError("patient_name is required")

        # Validate role
        if role not in ("MOTHER", "ALLEGED_FATHER"):
            raise ValidationError("role must be MOTHER or ALLEGED_FATHER")

        with transaction.atomic():
            # Create Sample
            from lims.apps.samples.models import Sample, SampleType
            from lims.apps.organizations.models import Site
            sample_type = SampleType.objects.filter(is_active=True).first()
            if not sample_type:
                sample_type = SampleType.objects.create(
                    code="BLOOD", name="Peripheral Blood",
                    collection_tube="Streck Cell-Free DNA BCT"
                )
            sample = Sample.objects.create(
                sample_id=custom_sample_id or f"SMP-{timezone.now().strftime('%Y%m%d%H%M%S')}-{pk[:8]}",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=patient_name,
                collection_date=collection_date,
                receipt_date=timezone.now().date(),
                receipt_time=timezone.now().time(),
                status="RECEIVED",
            )
            # Create CaseSample
            cs = case.case_samples.create(
                sample=sample,
                role=role,
                sample_source=sample_source.upper(),
                ethnicity=ethnicity,
                received_at=None,  # Not yet received
            )

        from .serializers import CaseSampleSerializer
        return Response(CaseSampleSerializer(cs).data, status=status.HTTP_201_CREATED)


    @action(detail=True, methods=["post"])
    def delete_sample(self, request, pk=None):
        """Delete a sample from a case. Only allowed in REGISTERED/RECEIVING status."""
        case = self.get_object()

        if case.status not in (Case.Status.REGISTERED, Case.Status.RECEIVING):
            raise ValidationError(
                "Cannot delete samples once case is IN_PROCESS or later"
            )

        sample_id_param = request.data.get("sample_id")
        if not sample_id_param:
            raise ValidationError("sample_id is required")

        # Find CaseSample by sample UUID or CaseSample UUID
        cs = case.case_samples.filter(sample_id=sample_id_param).first()
        if not cs:
            cs = case.case_samples.filter(id=sample_id_param).first()
        if not cs:
            raise NotFound("Sample not found in this case")

        sample = cs.sample
        role_display = cs.get_role_display()

        with transaction.atomic():
            # Soft-delete the Sample
            sample.is_deleted = True
            sample.save(update_fields=["is_deleted", "updated_at"])

            # Delete the CaseSample association
            cs.delete()

        # If no samples left, keep as REGISTERED
        remaining = case.case_samples.count()
        if remaining == 0:
            case.status = Case.Status.REGISTERED
            case.save(update_fields=["status", "updated_at"])

        return Response({
            "message": f"{role_display} sample {sample.sample_id} deleted",
            "remaining_samples": remaining,
        })

    @action(detail=True, methods=["post"])
    def delete_case(self, request, pk=None):
        """Delete an entire case and all associated samples. Any status allowed for testing cleanup."""
        case = self.get_object()

        with transaction.atomic():
            # Soft-delete all associated Samples
            for cs in case.case_samples.select_related("sample").all():
                cs.sample.is_deleted = True
                cs.sample.save(update_fields=["is_deleted", "updated_at"])

            # Delete CaseSamples (CASCADE from case will handle this, but explicit is safer)
            case.case_samples.all().delete()

            # Delete the case itself
            case.delete()

        return Response({
            "message": f"Case {case.case_number} and all associated samples deleted",
        })

    @action(detail=False, methods=["get"])
    def dashboard(self, request):
        """NIPPT dashboard stats."""
        qs = self.get_queryset()

        status_counts = {}
        for s in Case.Status.values:
            status_counts[s.lower()] = qs.filter(status=s).count()

        urgent = qs.filter(is_urgent=True).count()

        now = timezone.now().date()
        deadline_2d = now + timezone.timedelta(days=2)
        near_deadline = qs.filter(
            expected_completion__lte=deadline_2d,
            status__in=[Case.Status.IN_PROCESS, Case.Status.RECEIVING],
        ).count()

        incomplete_cases = 0
        for case in qs.filter(status=Case.Status.RECEIVING):
            mother = case.mother_sample
            if mother and mother.received_at:
                fathers = case.father_samples
                if fathers.filter(received_at=None).exists():
                    incomplete_cases += 1

        today_expected = qs.filter(status=Case.Status.REGISTERED).count()

        from lims.apps.workflows.models import RunSample
        nippt_run_samples = RunSample.objects.filter(
            sample__case_sample__isnull=False,
        )
        stage_counts = {
            "queued": nippt_run_samples.filter(status="QUEUED").count(),
            "in_progress": nippt_run_samples.filter(status="IN_PROGRESS").count(),
            "sequenced": nippt_run_samples.filter(status="SEQUENCED").count(),
            "analyzed": nippt_run_samples.filter(status="ANALYZED").count(),
            "passed_qc": nippt_run_samples.filter(status="PASSED_QC").count(),
        }

        return Response({
            "case_status": status_counts,
            "urgent": urgent,
            "near_deadline": near_deadline,
            "incomplete_pairs": incomplete_cases,
            "today_expected": today_expected,
            "workflow_stages": stage_counts,
        })


# ---- Public registration (no auth) ----

@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def public_register(request, token):
    """Public registration via token link."""
    from django.core.exceptions import PermissionDenied

    case = Case.objects.filter(registration_token=token).first()
    if not case:
        raise NotFound("Invalid registration token")
    if case.registration_token_expires and case.registration_token_expires < timezone.now():
        raise PermissionDenied("Registration token has expired")

    if case.status not in (Case.Status.DRAFT, Case.Status.REGISTERED):
        return Response(
            {"error": f"Case is already {case.get_status_display()}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = PublicRegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    with transaction.atomic():
        case.gestational_age_weeks = data.get("gestational_age_weeks")
        case.clinic_name = data.get("clinic_name", "")
        case.clinic_contact = data.get("clinic_contact", "")
        case.sales_person = data.get("sales_person", "")
        case.is_urgent = data.get("is_urgent", False)
        case.notes = data.get("notes", "")
        if data.get("collection_date"):
            case.expected_completion = data["collection_date"] + timezone.timedelta(
                days=case.panel.turnaround_days
            )
        if not case.pt_number:
            case.assign_pt_number()
        case.status = Case.Status.REGISTERED
        case.save()

        today = date.today()
        now = datetime.datetime.now()
        sample_type, _ = SampleType.objects.get_or_create(
            code="PERIPHERAL_BLOOD",
            defaults={"name": "Peripheral Blood", "description": "Peripheral blood sample"},
        )

        # Check if mother already exists (created during CaseCreateSerializer)
        mother = case.case_samples.filter(role=CaseSample.Role.MOTHER).select_related("sample").first()
        if mother:
            # Update existing mother sample with registration data
            mother.sample.patient_name = data["mother_name"]
            if data.get("mother_dob"):
                mother.sample.patient_dob = data["mother_dob"]
            mother.sample.status = "REGISTERED"
            mother.sample.save(update_fields=["patient_name", "patient_dob", "status"])
            mother.ethnicity = data.get("mother_ethnicity", "")
            mother.save(update_fields=["ethnicity"])
        else:
            mother_sample = Sample.objects.create(
                sample_id=f"{case.case_number}-M",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=data["mother_name"],
                patient_dob=data.get("mother_dob"),
                patient_sex="F",
                status="REGISTERED",
                site=case.site,
                created_by=case.created_by,
                receipt_date=today,
                receipt_time=now.time(),
                collection_date=data.get("collection_date") or today,
            )
            pub_mother_cs = CaseSample.objects.create(
                case=case, sample=mother_sample, role=CaseSample.Role.MOTHER,
                ethnicity=data.get("mother_ethnicity", ""),
                sample_source=CaseSample.SampleSource.PERIPHERAL_BLOOD,
            )
            pub_mother_cs.test_sample_id = case.generate_test_sample_id(pub_mother_cs)
            pub_mother_cs.save(update_fields=["test_sample_id"])

        father_count = data.get("father_count", 1)
        for i in range(father_count):
            name = data["father_names"][i] if i < len(data["father_names"]) else f"Father {i+1}"
            ethnicity = (
                data["father_ethnicities"][i]
                if data.get("father_ethnicities") and i < len(data["father_ethnicities"])
                else ""
            )
            relationship = (
                data["father_relationships"][i]
                if data.get("father_relationships") and i < len(data["father_relationships"])
                else ""
            )
            source = (
                data["father_sample_sources"][i]
                if data.get("father_sample_sources") and i < len(data["father_sample_sources"])
                else "BLOOD"
            )

            father = Sample.objects.create(
                sample_id=f"{case.case_number}-AF{i+1}",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=name,
                patient_sex="M",
                status="REGISTERED",
                site=case.site,
                created_by=case.created_by,
                receipt_date=today,
                receipt_time=now.time(),
                collection_date=data.get("collection_date") or today,
            )
            pub_father_cs = CaseSample.objects.create(
                case=case, sample=father,
                role=CaseSample.Role.ALLEGED_FATHER,
                ethnicity=ethnicity,
                relationship_to_mother=relationship,
                sample_source=source,
            )
            pub_father_cs.test_sample_id = case.generate_test_sample_id(pub_father_cs)
            pub_father_cs.save(update_fields=["test_sample_id"])

        case.registration_token = None
        case.registration_token_expires = None
        case.save(update_fields=["registration_token", "registration_token_expires"])

    return Response({
        "case_number": case.case_number,
        "message": "Registration submitted successfully",
        "sample_count": case.case_samples.count(),
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def public_register_info(request, token):
    """Get case info for the public registration page."""
    from django.core.exceptions import PermissionDenied

    case = Case.objects.filter(registration_token=token).first()
    if not case:
        raise NotFound("Invalid registration token")
    if case.registration_token_expires and case.registration_token_expires < timezone.now():
        raise PermissionDenied("Registration token has expired")

    return Response({
        "case_number": case.case_number,
        "panel": case.panel.code,
        "panel_name": case.panel.name,
        "expires": case.registration_token_expires,
    })
