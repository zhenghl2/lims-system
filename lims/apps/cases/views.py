"""Case views."""
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter, SearchFilter
from .models import Case, CaseSample, NipptPreProcessingBatch, NipptPreProcessingSample, NipptExtractionBatch, NipptExtractionSample, NipptLibraryBatch, NipptLibrarySample, NipptPoolingBatch, NipptPoolingSample, NipptHybSeqBatch, NipptHybSeqSample
from .serializers import (
    CaseListSerializer, CaseDetailSerializer, CaseCreateSerializer,
    CaseSampleSerializer, PublicRegistrationSerializer,
    NipptPreProcessingBatchListSerializer, NipptPreProcessingBatchDetailSerializer,
    NipptPreProcessingBatchCreateSerializer, NipptPreProcessingSampleSerializer,
    PendingEntrySerializer,
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
    search_fields = ["case_number", "pt_number", "clinic_name", "sales_person"]
    ordering_fields = ["created_at", "case_number", "expected_completion"]

    def filter_queryset(self, request, queryset, view):
        qs = super().filter_queryset(request, queryset, view)
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(case_number__icontains=search)
                | Q(pt_number__icontains=search)
                | Q(clinic_name__icontains=search)
                | Q(sales_person__icontains=search)
                | Q(case_samples__sample__patient_name__icontains=search)
            ).distinct()
        wf = request.query_params.get("workflow_status", "").strip()
        if wf:
            qs = qs.filter(case_samples__workflow_stage=wf).distinct()
        return qs

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
        # Source/applicant filter
        applicant = self.request.query_params.get("applicant", "").strip()
        if applicant:
            qs = qs.filter(case_samples__sample__sample_source__icontains=applicant).distinct()
        # Date range filter
        date_after = self.request.query_params.get("created_after", "").strip()
        if date_after:
            qs = qs.filter(created_at__date__gte=date_after)
        date_before = self.request.query_params.get("created_before", "").strip()
        if date_before:
            qs = qs.filter(created_at__date__lte=date_before)
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

        # Accept receiving metadata
        pt_number = request.data.get("pt_number", "").strip()
        actual_sample_type = request.data.get("actual_sample_type", "")
        preservation_method = request.data.get("preservation_method", "")

        # Save user-provided PT number to Case (before auto-assign fallback)
        if pt_number and not case.pt_number:
            case.pt_number = pt_number
            case.save(update_fields=["pt_number", "updated_at"])

        cs.confirm_receipt(request.user, condition=condition)
        # Save new receiving fields
        if actual_sample_type:
            cs.actual_sample_type = actual_sample_type
            cs.save(update_fields=["actual_sample_type"])
        if preservation_method:
            cs.preservation_method = preservation_method
            cs.save(update_fields=["preservation_method"])

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
            # PT number should be provided by user via confirm_receipt
            # If not set yet, auto-assign as fallback
            if not case.pt_number:
                case.assign_pt_number()
                case.save(update_fields=["status", "updated_at", "pt_number"])
            else:
                case.save(update_fields=["status", "updated_at"])
            # Generate test_sample_id suffix if not already set
            # 按 patient_name 分組父亲，同一父亲多样本共用后缀
            father_css = list(case.case_samples.filter(
                role="ALLEGED_FATHER"
            ).order_by("created_at").select_related("sample"))
            father_names = []
            for fcs in father_css:
                name = fcs.sample.patient_name
                if name not in father_names:
                    father_names.append(name)

            for cs in case.case_samples.all():
                if not cs.test_sample_id:
                    base = case.pt_number
                    if cs.role == "MOTHER":
                        suffix = "W"
                    elif cs.role == "ALLEGED_FATHER":
                        my_name = cs.sample.patient_name
                        idx = father_names.index(my_name) if my_name in father_names else 0
                        if len(father_names) == 1:
                            suffix = "H"
                        else:
                            suffix = f"H{chr(65 + idx)}"  # HA, HB, HC...
                    else:
                        suffix = "U"
                    cs.test_sample_id = f"{base}{suffix}"
                    cs.save(update_fields=["test_sample_id"])

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
        from django.db.models import Max, Q

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
        qs = self.get_queryset()
        status_counts = {}
        for s in Case.Status.values:
            status_counts[s.lower()] = qs.filter(status=s).count()
        urgent = qs.filter(is_urgent=True).count()
        now = timezone.now().date()
        near_deadline = qs.filter(
            expected_completion__lte=now + timezone.timedelta(days=2),
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
        # Module-based stage counts from CaseSample workflow_stage
        all_css = CaseSample.objects.all()
        stage_counts = {
            "registered": all_css.filter(workflow_stage="REGISTERED").count(),
            "received": all_css.filter(workflow_stage="RECEIVED").count(),
            "rejected": all_css.filter(workflow_stage="REJECTED").count(),
            "pre_processing": all_css.filter(workflow_stage="PRE_PROCESSING").count(),
            "extraction": all_css.filter(workflow_stage="EXTRACTION").count(),
            "library_prep": all_css.filter(workflow_stage="LIBRARY_PREP").count(),
            "pooling": all_css.filter(workflow_stage="POOLING").count(),
            "hyb_seq": all_css.filter(workflow_stage="HYB_SEQ").count(),
            "bioinfo": all_css.filter(workflow_stage="BIOINFO").count(),
            "report_draft": all_css.filter(workflow_stage="REPORT_DRAFT").count(),
            "completed": all_css.filter(workflow_stage="COMPLETED").count(),
            "failed": all_css.filter(workflow_stage__endswith="_FAILED").count(),
        }
        return Response({
            "total_cases": qs.count(),
            "total_samples": CaseSample.objects.count(),
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



# ============================================================
# NIPPT Pre-Processing ViewSet
# ============================================================


# ═══ Workflow tracking helper ═══

WORKFLOW_ORDER = [
    "REGISTERED", "RECEIVED", "PRE_PROCESSING", "EXTRACTION",
    "LIBRARY_PREP", "POOLING", "HYB_SEQ", "BIOINFO",
    "REPORT_DRAFT", "COMPLETED"
]

def sync_case_status(case_sample_ids):
    """Sync Case workflow_status from the slowest (most behind) active sample."""
    if not case_sample_ids:
        return
    case_ids = set()
    for cs in CaseSample.objects.filter(id__in=case_sample_ids).select_related("case"):
        if cs.case:
            case_ids.add(cs.case_id)
    for case in Case.objects.filter(id__in=case_ids):
        all_css = case.case_samples.filter(is_active=True)
        if not all_css.exists():
            all_css = case.case_samples.all()
        slowest = "COMPLETED"
        slowest_idx = len(WORKFLOW_ORDER)
        for cs in all_css:
            stage = cs.workflow_stage or "REGISTERED"
            if stage.endswith("_FAILED"):
                continue
            if stage in WORKFLOW_ORDER:
                idx = WORKFLOW_ORDER.index(stage)
                if idx < slowest_idx:
                    slowest_idx = idx
                    slowest = stage
        # Only update if the Case is past RECEIVING
        if case.status in ("IN_PROCESS", "COMPLETED") and slowest_idx < len(WORKFLOW_ORDER):
            case.workflow_status = slowest
            case.save(update_fields=["updated_at"])

def update_wf(case_sample_ids, stage, action, batch_num="", operator=None):
    from .models import WorkflowLog
    if not case_sample_ids: return
    CaseSample.objects.filter(id__in=case_sample_ids).update(workflow_stage=stage)
    WorkflowLog.objects.bulk_create([
        WorkflowLog(case_sample_id=cid, stage=stage, action=action, batch_number=batch_num, operator=operator)
        for cid in case_sample_ids
    ])
    if stage == "COMPLETED":
        for cs in CaseSample.objects.filter(id__in=case_sample_ids).select_related("case"):
            if cs.role == "MOTHER":
                CaseSample.objects.filter(case=cs.case, role="ALLEGED_FATHER", workflow_stage="PENDING_ACTIVATION").update(
                    workflow_stage="CANCELLED", is_active=False
                )

def advance_batch(batch, next_stage, operator=None):
    passed, failed = [], []
    for s in batch.samples.all():
        if not s.case_sample_ids: continue
        ids = list(s.case_sample_ids)
        if s.qc_status == "PASS": passed.extend(ids)
        else: failed.extend(ids)
    if passed: update_wf(passed, next_stage, "COMPLETE", batch.batch_number, operator)
    if failed: update_wf(failed, f"{next_stage}_FAILED", "FAIL", batch.batch_number, operator)

class NipptPreProcessingViewSet(viewsets.ModelViewSet):
    """NIPPT 前处理批次管理"""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptPreProcessingBatch.objects.prefetch_related("samples").all()

    def get_serializer_class(self):
        if self.action == "list":
            return NipptPreProcessingBatchListSerializer
        if self.action == "create":
            return NipptPreProcessingBatchCreateSerializer
        return NipptPreProcessingBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending(self, request):
        """Return samples waiting for pre-processing, grouped by person."""
        # Collect case_sample_ids that should be excluded:
        # - DRAFT/IN_PROGRESS: exclude ALL (being actively processed)
        # - COMPLETED+PASS: exclude (successfully processed)
        # - COMPLETED+FAIL: NOT excluded (allow re-processing)
        excluded_ids = set()
        all_batches = NipptPreProcessingBatch.objects.all().prefetch_related("samples")
        for b in all_batches:
            for sp in b.samples.all():
                if not sp.case_sample_ids:
                    continue
                if b.status in ("DRAFT", "IN_PROGRESS"):
                    excluded_ids.update(sp.case_sample_ids)
                elif b.status == "COMPLETED" and sp.qc_status == "PASS":
                    excluded_ids.update(sp.case_sample_ids)

        qs = CaseSample.objects.filter(
            sample__status="RECEIVED"
        ).exclude(
            id__in=list(excluded_ids)[:10000] if excluded_ids else []
        ).select_related("case", "sample").order_by("case__case_number", "sample__patient_name")

        # Group males by person — one row per person with all sample types
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER":
                cat = "FEMALE_BLOOD"
            elif cs.sample_source in ("BLOOD", "DBS"):
                cat = "MALE_BLOOD"
            else:
                cat = "MALE_OTHER"

            key = (str(cs.case_id), cs.sample.patient_name)
            if key not in groups:
                groups[key] = {
                    "case_id": str(cs.case_id),
                    "case_number": cs.case.case_number,
                    "patient_name": cs.sample.patient_name,
                    "role": cs.role,
                    "category": cat,
                    "sample_types": [],
                    "case_sample_ids": [],
                    "test_sample_id": cs.test_sample_id,
                }
            g = groups[key]
            if cs.sample_source not in g["sample_types"]:
                g["sample_types"].append(cs.sample_source)
            g["case_sample_ids"].append(str(cs.id))
            if not g["test_sample_id"]:
                g["test_sample_id"] = cs.test_sample_id

        entries = list(groups.values())
        female_count = sum(1 for e in entries if e["role"] == "MOTHER")
        male_blood_count = sum(1 for e in entries if e["role"] != "MOTHER")
        male_other_count = 0

        serializer = PendingEntrySerializer(entries, many=True)
        return Response({
            "female_count": female_count,
            "male_blood_count": male_blood_count,
            "male_other_count": male_other_count,
            "total_pending": len(entries),
            "entries": serializer.data,
        })

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        """Save processing data for all samples in the batch."""
        batch = self.get_object()
        samples_data = request.data.get("samples", [])

        for sd in samples_data:
            sample_id = sd.get("id")
            if not sample_id:
                continue
            sp = batch.samples.filter(id=sample_id).first()
            if not sp:
                continue
            for field in ["sample_condition", "aliquot_tubes", "plasma_volume",
                          "experiment_sample_type", "elution_volume",
                          "dna_concentration", "qc_status", "qc_note"]:
                if field in sd:
                    setattr(sp, field, sd[field])
            sp.operator = request.user
            sp.processed_at = timezone.now()
            sp.save()

        # Save batch processing_data
        if "processing_data" in request.data:
            batch.processing_data = request.data["processing_data"]
        if batch.status == NipptPreProcessingBatch.Status.DRAFT:
            batch.status = NipptPreProcessingBatch.Status.IN_PROGRESS
        batch.save()

        return Response(NipptPreProcessingBatchDetailSerializer(batch).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Mark batch as complete. PASS samples advance to lab workflow."""
        from django.db import transaction as db_transaction

        batch = self.get_object()
        if batch.status == NipptPreProcessingBatch.Status.COMPLETED:
            raise ValidationError("Batch already completed")

        with db_transaction.atomic():
            batch.status = NipptPreProcessingBatch.Status.COMPLETED
            batch.save(update_fields=["status", "updated_at"])

            # For PASS samples, update CaseSample/Sample status
            for sp in batch.samples.filter(qc_status="PASS"):
                # Update the linked CaseSamples to mark them as pre-processed
                if sp.case_sample_ids:
                    CaseSample.objects.filter(id__in=sp.case_sample_ids).update(
                        updated_at=timezone.now()
                    )
                    # Update associated Samples
                    Sample.objects.filter(
                        case_sample__id__in=sp.case_sample_ids
                    ).update(status="PRE_PROCESSED", updated_at=timezone.now())

        return Response({"message": f"Batch {batch.batch_number} completed"})

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"detail": "Cannot delete completed batch"}, status=400)
        # Revert workflow_stage for all samples back to RECEIVED
        for sp in batch.samples.all():
            if sp.case_sample_ids:
                CaseSample.objects.filter(id__in=sp.case_sample_ids).update(workflow_stage="RECEIVED")
        batch.delete()
        return Response({"message": "Batch deleted, samples returned to pending"})


# ══════════════════════════════════════════
# NIPPT Extraction ViewSet (核酸提取)
# ══════════════════════════════════════════

from .serializers import (
    NipptExtractionBatchListSerializer, NipptExtractionBatchDetailSerializer,
    NipptExtractionBatchCreateSerializer, NipptExtractionSampleSerializer,
)

class NipptExtractionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptExtractionBatch.objects.prefetch_related("samples").all()

    def get_serializer_class(self):
        if self.action == "list":
            return NipptExtractionBatchListSerializer
        if self.action == "create":
            return NipptExtractionBatchCreateSerializer
        return NipptExtractionBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending(self, request):
        from .models import NipptExtractionBatch, NipptExtractionSample
        passed_ids = set()
        for pp in NipptPreProcessingSample.objects.filter(batch__status="COMPLETED", qc_status="PASS", aliquot_tubes__gte=1):
            if pp.case_sample_ids:
                passed_ids.update(pp.case_sample_ids)
        excluded_ids = set()
        for b in NipptExtractionBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT", "IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status == "COMPLETED" and sp.qc_status == "PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        qs = CaseSample.objects.filter(id__in=valid_ids).select_related("case","sample").order_by("case__case_number","sample__patient_name")
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            elif cs.sample_source in ("BLOOD","DBS"): cat = "MALE_BLOOD"
            else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cat)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id}
            g = groups[key]
            if cs.sample_source not in g["sample_types"]: g["sample_types"].append(cs.sample_source)
            g["case_sample_ids"].append(str(cs.id))
            if not g["test_sample_id"]: g["test_sample_id"] = cs.test_sample_id
        entries = list(groups.values())
        return Response({"female_count":sum(1 for e in entries if e["category"]=="FEMALE_BLOOD"),
            "male_blood_count":sum(1 for e in entries if e["category"]=="MALE_BLOOD"),
            "male_other_count":sum(1 for e in entries if e["category"]=="MALE_OTHER"),
            "total_pending":len(entries),"entries":entries})

    @action(detail=False, methods=["get"])
    def qc_candidates(self, request):
        search = request.query_params.get("search", "")
        qs = NipptPreProcessingSample.objects.filter(batch__status="COMPLETED", qc_status="PASS", category="FEMALE_BLOOD", aliquot_tubes__gte=1)
        if search:
            qs = qs.filter(models.Q(patient_name__icontains=search) | models.Q(case__case_number__icontains=search))
        results = [{"id":str(pp.id),"patient_name":pp.patient_name,"case_number":pp.case.case_number,
            "test_sample_id":CaseSample.objects.filter(id__in=pp.case_sample_ids).first().test_sample_id if pp.case_sample_ids else None,
            "aliquot_tubes":pp.aliquot_tubes} for pp in qs[:20]]
        return Response({"results":results})

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        ed = request.data.get("extraction_data", {})
        if ed:
            batch.extraction_data = ed
            batch.save(update_fields=["extraction_data","updated_at"])
        for sd in request.data.get("samples", []):
            NipptExtractionSample.objects.filter(id=sd.get("id")).update(
                qc_status=sd.get("qc_status","PASS"), qc_note=sd.get("qc_note",""),
                dna_concentration=sd.get("dna_concentration"), elution_volume=sd.get("elution_volume"),
                plasma_volume=sd.get("plasma_volume"), well_position=sd.get("well_position",""),
                extraction_method=sd.get("extraction_method",""), processed_at=timezone.now(), operator=request.user)
        return Response({"message":"Saved"})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"message":"Already"}, status=400)
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "EXTRACTION", request.user)
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"detail":"Cannot delete completed batch"}, status=400)
        for sp in batch.samples.all():
            if sp.source_preprocessing_sample_id:
                NipptPreProcessingSample.objects.filter(id=sp.source_preprocessing_sample_id).update(aliquot_tubes=F('aliquot_tubes')+1)
        batch.delete()
        return Response({"message":"Deleted"})


# ══════════════════════════════════════════
# NIPPT Library ViewSet (文库构建)
# ══════════════════════════════════════════

from .serializers import (
    NipptLibraryBatchListSerializer, NipptLibraryBatchDetailSerializer,
    NipptLibraryBatchCreateSerializer, NipptLibrarySampleSerializer,
    NipptPoolingBatchListSerializer, NipptPoolingBatchDetailSerializer,
    NipptPoolingBatchCreateSerializer, NipptPoolingSampleSerializer,
    NipptHybSeqBatchListSerializer, NipptHybSeqBatchDetailSerializer,
    NipptHybSeqBatchCreateSerializer, NipptHybSeqSampleSerializer,
)

class NipptLibraryViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptLibraryBatch.objects.prefetch_related("samples").all()

    def get_serializer_class(self):
        if self.action == "list": return NipptLibraryBatchListSerializer
        if self.action == "create": return NipptLibraryBatchCreateSerializer
        return NipptLibraryBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending(self, request):
        passed_ids = set()
        id2es = {}
        for es in NipptExtractionSample.objects.filter(batch__status="COMPLETED", qc_status="PASS"):
            if es.case_sample_ids:
                for cid in es.case_sample_ids:
                    passed_ids.add(cid); id2es[cid] = es
        excluded_ids = set()
        for b in NipptLibraryBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT","IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status=="COMPLETED" and sp.qc_status=="PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        qs = CaseSample.objects.filter(id__in=valid_ids).select_related("case","sample").order_by("case__case_number","sample__patient_name")
        groups = {}
        for cs in qs:
            es = id2es.get(str(cs.id))
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            elif cs.sample_source in ("BLOOD","DBS"): cat = "MALE_BLOOD"
            else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cat)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id,
                    "dna_concentration":es.dna_concentration if es else None,
                    "extraction_sample_id":str(es.id) if es else None}
            g = groups[key]
            if cs.sample_source not in g["sample_types"]: g["sample_types"].append(cs.sample_source)
            g["case_sample_ids"].append(str(cs.id))
            if not g["test_sample_id"]: g["test_sample_id"] = cs.test_sample_id
        entries = list(groups.values())
        return Response({"female_count":sum(1 for e in entries if e["category"]=="FEMALE_BLOOD"),
            "male_blood_count":sum(1 for e in entries if e["category"]=="MALE_BLOOD"),
            "male_other_count":sum(1 for e in entries if e["category"]=="MALE_OTHER"),
            "total_pending":len(entries),"entries":entries})

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        ed = request.data.get("library_data", {})
        if ed:
            batch.library_data = ed; batch.save(update_fields=["library_data","updated_at"])
        for sd in request.data.get("samples", []):
            NipptLibrarySample.objects.filter(id=sd.get("id")).update(
                qc_status=sd.get("qc_status","PASS"), qc_note=sd.get("qc_note",""),
                processed_at=timezone.now(), operator=request.user)
        return Response({"message":"Saved"})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"message":"Already"}, status=400)
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "LIBRARY_PREP", request.user)
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"detail":"Cannot delete"}, status=400)
        batch.delete(); return Response({"message":"Deleted"})


class NipptPoolingViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptPoolingBatch.objects.prefetch_related("samples").all()

    def get_serializer_class(self):
        if self.action == "list": return NipptPoolingBatchListSerializer
        if self.action == "create": return NipptPoolingBatchCreateSerializer
        return NipptPoolingBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending(self, request):
        passed_ids = set()
        for ls in NipptLibrarySample.objects.filter(batch__status="COMPLETED", qc_status="PASS"):
            if ls.case_sample_ids:
                for cid in ls.case_sample_ids: passed_ids.add(cid)
        excluded_ids = set()
        for b in NipptPoolingBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT","IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status=="COMPLETED" and sp.qc_status=="PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        qs = CaseSample.objects.filter(id__in=valid_ids).select_related("case","sample").order_by("case__case_number","sample__patient_name")
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            elif cs.sample_source in ("BLOOD","DBS"): cat = "MALE_BLOOD"
            else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cat)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id}
            g = groups[key]
            if cs.sample_source not in g["sample_types"]: g["sample_types"].append(cs.sample_source)
            g["case_sample_ids"].append(str(cs.id))
            if not g["test_sample_id"]: g["test_sample_id"] = cs.test_sample_id
        entries = list(groups.values())
        return Response({"female_count":sum(1 for e in entries if e["category"]=="FEMALE_BLOOD"),
            "male_blood_count":sum(1 for e in entries if e["category"]=="MALE_BLOOD"),
            "male_other_count":sum(1 for e in entries if e["category"]=="MALE_OTHER"),
            "total_pending":len(entries),"entries":entries})

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        pd = request.data.get("pooling_data", {})
        if pd: batch.pooling_data = pd; batch.save(update_fields=["pooling_data","updated_at"])
        for sd in request.data.get("samples", []):
            NipptPoolingSample.objects.filter(id=sd.get("id")).update(
                qc_status=sd.get("qc_status","PASS"), qc_note=sd.get("qc_note",""),
                processed_at=timezone.now(), operator=request.user)
        return Response({"message":"Saved"})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"message":"Already"}, status=400)
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "LIBRARY_PREP", request.user)
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"detail":"Cannot delete"}, status=400)
        batch.delete(); return Response({"message":"Deleted"})


class NipptHybSeqViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptHybSeqBatch.objects.prefetch_related("samples").all()

    def get_serializer_class(self):
        if self.action == "list": return NipptHybSeqBatchListSerializer
        if self.action == "create": return NipptHybSeqBatchCreateSerializer
        return NipptHybSeqBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending_mixes(self, request):
        used_mix_ids = set()
        for hb in NipptHybSeqBatch.objects.all():
            for mid in hb.hyb_seq_data.get("mix_ids", []):
                used_mix_ids.add(mid)
        mixes = []
        for pb in NipptPoolingBatch.objects.filter(status="COMPLETED").prefetch_related("samples"):
            if not pb.pooling_data: continue
            pd = pb.pooling_data
            rows = pd.get("rows",[])
            groups = pd.get("manual_alloc") or []
            f_samples = pb.samples.filter(category="FEMALE_BLOOD").count()
            m_samples = pb.samples.count() - f_samples
            if not groups:
                groups = [{"female":f_samples//2,"male":m_samples//2},{"female":f_samples-f_samples//2,"male":m_samples-m_samples//2}]
            for gi, grp in enumerate(groups):
                mid = f"{pb.id}_{gi}"
                if mid in used_mix_ids: continue
                mixes.append({
                    "id": mid,
                    "pooling_batch_id": str(pb.id),
                    "pooling_batch_number": pb.batch_number,
                    "mix_name": f"{pb.batch_number}-mix{gi+1}",
                    "female": grp.get("female",0),
                    "male": grp.get("male",0),
                    "data_amount": (grp.get("female",0)*2 + grp.get("male",0)*1),
                })
        return Response({"mixes": mixes})

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        sd = request.data.get("hyb_seq_data", {})
        if sd: batch.hyb_seq_data = sd; batch.save(update_fields=["hyb_seq_data","updated_at"])
        return Response({"message":"Saved"})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"message":"Already"}, status=400)
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "HYB_SEQ", request.user)
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"detail":"Cannot delete"}, status=400)
        batch.delete(); return Response({"message":"Deleted"})
