"""Workflow views."""
from django.db import transaction, models
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from datetime import date
from .models import WorkflowProtocol, SampleRun, RunSample, WorkflowStep
from lims.apps.samples.models import Sample
from lims.apps.users.models import User
from lims.apps.plasma_separation.views import NIPT_SIGNERS, NIPT_SIGNER_PASSWORD
from .serializers import (
    WorkflowProtocolSerializer, RunSampleSerializer,
    SampleRunSerializer, SampleRunCreateSerializer, SampleRunDetailSerializer,
    WorkflowStepSerializer,
)


# ── Sample failure sync helper ────────────────────────────────────

STEP_LABELS = {
    "extraction": "核酸提取",
    "library": "文库构建",
    "pooling": "文库定量",
    "sequencing": "上机测序",
    "bioinformatics": "生信分析",
}

def _sync_sample_failures(run, step_key, sample_results):
    """
    Sync Sample.status based on per-sample pass/fail in sample_results.
    - fail → REJECTED with rejection_reason="[步骤名] 备注"
    - pass → revert if previously REJECTED by this same step
    """
    label = STEP_LABELS.get(step_key, step_key)
    run_samples = list(run.run_samples.all().order_by("created_at"))

    for idx_str, result in sample_results.items():
        try:
            idx = int(idx_str)
        except (ValueError, TypeError):
            continue
        if idx < 0 or idx >= len(run_samples):
            continue

        sample_id = run_samples[idx].sample_id
        status = result.get("status", "")

        if status == "fail":
            reason = f"{label}失败"
            Sample.objects.filter(id=sample_id).update(
                status="REJECTED",
                rejection_reason=reason,
            )
        elif status == "pass":
            # If previously REJECTED by this same step, revert to EXTRACTION
            Sample.objects.filter(
                id=sample_id,
                status="REJECTED",
                rejection_reason=f"{label}失败",
            ).update(status="EXTRACTION", rejection_reason="")


class WorkflowProtocolViewSet(viewsets.ModelViewSet):
    """Manage workflow protocols."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WorkflowProtocolSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ["name", "panel__code", "panel__name"]
    filterset_fields = ["is_active", "panel"]
    ordering_fields = ["created_at", "name"]

    def get_queryset(self):
        qs = WorkflowProtocol.objects.all().select_related("panel", "created_by")
        if self.request.user.site_id:
            qs = qs.filter(panel__site=self.request.user.site)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class SampleRunViewSet(viewsets.ModelViewSet):
    """Manage sequencing runs."""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ["run_number"]
    filterset_fields = ["status", "panel", "planned_date"]
    ordering_fields = ["created_at", "planned_date"]

    def get_queryset(self):
        qs = SampleRun.objects.all().select_related("panel", "sequencer", "operator")
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        params = self.request.query_params
        if "planned_date__from" in params:
            qs = qs.filter(planned_date__gte=params["planned_date__from"])
        if "planned_date__to" in params:
            qs = qs.filter(planned_date__lte=params["planned_date__to"])
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return SampleRunCreateSerializer
        if self.action in ["retrieve", "run_detail"]:
            return SampleRunDetailSerializer
        return SampleRunSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from lims.apps.organizations.models import Site

        user = request.user
        site = user.site if user.site_id else Site.objects.filter(is_active=True).first()

        # Generate run number
        from datetime import date
        today = date.today().strftime("%Y%m%d")
        prefix = f"RUN-{today}"
        count = SampleRun.objects.filter(run_number__startswith=prefix).count() + 1
        run_number = f"{prefix}-{count:04d}"

        # Resolve panel_code to panel_id if provided
        panel_id = data.get("panel")
        if not panel_id:
            panel_code = data.get("panel_code")
            if panel_code:
                try:
                    from lims.apps.samples.models import TestPanel
                    panel_obj = TestPanel.objects.get(code=panel_code, is_active=True)
                    panel_id = panel_obj.id
                except Exception:
                    pass
        if not panel_id:
            return Response({"error": "panel or panel_code is required"}, status=400)

        run = SampleRun.objects.create(
            run_number=run_number,
            panel_id=panel_id,
            protocol_id=data.get("protocol"),
            sequencer_id=data.get("sequencer"),
            planned_date=data.get("planned_date"),
            notes=data.get("notes", ""),
            site=site,
            operator=user,
        )

        sample_ids = data.get("samples", [])
        sample_assignments = data.get("sample_assignments", {})
        run_samples = []
        for sid in sample_ids:
            asgn = sample_assignments.get(str(sid), {})
            rs, _ = RunSample.objects.get_or_create(run=run, sample_id=sid)
            if asgn.get("well_position"):
                rs.well_position = asgn["well_position"]
            if asgn.get("index_sequence"):
                rs.index_sequence = asgn["index_sequence"]
            if asgn.get("pool_group"):
                rs.pool_group = asgn["pool_group"]
            if asgn.get("barcode"):
                rs.barcode = asgn["barcode"]
            if any([asgn.get("well_position"), asgn.get("index_sequence"), asgn.get("pool_group"), asgn.get("barcode")]):
                rs.save(update_fields=["well_position", "index_sequence", "pool_group", "barcode"])
            run_samples.append(rs)
            # Update sample status to IN_PROCESS
            Sample.objects.filter(id=sid).update(status="EXTRACTION")

        # Create workflow steps per sample from protocol or defaults
        # Resolve protocol: find active protocol for this panel, or auto-create default
        panel = run.panel
        protocol = run.protocol
        if not protocol and panel:
            protocol = WorkflowProtocol.objects.filter(panel=panel, is_active=True).first()
            if not protocol:
                # Auto-create a default protocol for this panel
                default_steps = [
                    {"step_id": "dna_extraction", "step_name": "DNA Extraction", "step_order": 1, "required": True},
                    {"step_id": "library_prep", "step_name": "Library Preparation", "step_order": 2, "required": True},
                    {"step_id": "sequencing", "step_name": "Sequencing", "step_order": 3, "required": True},
                    {"step_id": "data_analysis", "step_name": "Data Analysis", "step_order": 4, "required": True},
                    {"step_id": "qc_review", "step_name": "QC Review", "step_order": 5, "required": True},
                ]
                # NIPT panels (NIPT, NIPT_PLUS, NIPT_FULL, NIPPT) use the full 11-step workflow
                if panel.code in ("NIPPT", "NIPT", "NIPT_PLUS", "NIPT_FULL"):
                    default_steps = [
                        {"step_id": "sample_receiving", "step_name": "Sample Receiving", "step_order": 1, "required": True},
                        {"step_id": "plasma_separation", "step_name": "Plasma Separation", "step_order": 2, "required": True},
                        {"step_id": "cfdna_extraction", "step_name": "cfDNA Extraction", "step_order": 3, "required": True},
                        {"step_id": "library_construction", "step_name": "Library Construction", "step_order": 4, "required": True},
                        {"step_id": "hybridization", "step_name": "Hybridization", "step_order": 5, "required": True},
                        {"step_id": "purification", "step_name": "Purification", "step_order": 6, "required": True},
                        {"step_id": "library_quantification", "step_name": "Library Quantification", "step_order": 7, "required": True},
                        {"step_id": "sequencing", "step_name": "Sequencing", "step_order": 8, "required": True},
                        {"step_id": "bioinformatics_analysis", "step_name": "Bioinformatics Analysis", "step_order": 9, "required": True},
                        {"step_id": "data_interpretation", "step_name": "Data Interpretation", "step_order": 10, "required": True},
                        {"step_id": "report_generation", "step_name": "Report Generation", "step_order": 11, "required": True},
                    ]
                elif panel.code == "HPV":
                    default_steps = [
                        {"step_id": "dna_extraction", "step_name": "DNA Extraction", "step_order": 1, "required": True},
                        {"step_id": "pcr_amplification", "step_name": "PCR Amplification", "step_order": 2, "required": True},
                        {"step_id": "capillary_electrophoresis", "step_name": "Capillary Electrophoresis", "step_order": 3, "required": True},
                        {"step_id": "data_analysis", "step_name": "Data Analysis", "step_order": 4, "required": True},
                        {"step_id": "qc_review", "step_name": "QC Review", "step_order": 5, "required": True},
                    ]
                protocol = WorkflowProtocol.objects.create(
                    panel=panel,
                    name=f"{panel.code} Standard Workflow",
                    version="1.0",
                    description=f"Auto-generated default workflow for {panel.name}",
                    steps_definition=default_steps,
                    created_by=request.user,
                )
            run.protocol = protocol
            run.save(update_fields=["protocol"])

        # Build step definitions from protocol
        if protocol and protocol.steps_definition and isinstance(protocol.steps_definition, list):
            step_defs = [
                {"step_id": s.get("step_id", s.get("id", f"step_{i}")),
                 "step_name": s.get("step_name", s.get("name", f"Step {i+1}")),
                 "step_order": s.get("step_order", i + 1)}
                for i, s in enumerate(protocol.steps_definition)
            ]
        else:
            # Ultimate fallback
            step_defs = [
                {"step_id": "dna_extraction", "step_name": "DNA Extraction", "step_order": 1},
                {"step_id": "library_prep", "step_name": "Library Preparation", "step_order": 2},
                {"step_id": "sequencing", "step_name": "Sequencing", "step_order": 3},
                {"step_id": "data_analysis", "step_name": "Data Analysis", "step_order": 4},
                {"step_id": "qc_review", "step_name": "QC Review", "step_order": 5},
            ]

        # Create a WorkflowStep record for EACH sample × EACH step (matrix)
        for rs in run_samples:
            for idx, step_def in enumerate(step_defs, start=1):
                WorkflowStep.objects.create(
                    run=run,
                    sample=rs.sample,
                    step_id=step_def["step_id"],
                    step_name=step_def["step_name"],
                    step_order=idx,
                    status="PENDING",
                )

        return Response(SampleRunSerializer(run).data, status=201)

    @action(detail=True, methods=["get"])
    def run_detail(self, request, pk=None):
        """Get run with all steps and samples."""
        run = self.get_object()
        serializer = SampleRunDetailSerializer(run)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def update_results(self, request, pk=None):
        """Update result_summary for run samples."""
        run = self.get_object()
        results = request.data.get("results", {})
        updated = []
        for rs_id, rs_data in results.items():
            try:
                rs = RunSample.objects.get(id=rs_id, run=run)
                rs.result_summary = rs_data
                rs.save(update_fields=["result_summary"])
                updated.append(str(rs.id))
            except RunSample.DoesNotExist:
                continue
        return Response({"updated": len(updated), "run_sample_ids": updated})

    @action(detail=True, methods=["post"])
    def add_samples(self, request, pk=None):
        """Add samples to a run."""
        run = self.get_object()
        sample_ids = request.data.get("sample_ids", [])
        added = []
        for sid in sample_ids:
            _, created = RunSample.objects.get_or_create(run=run, sample_id=sid)
            if created:
                added.append(sid)
        return Response({"added": len(added), "sample_ids": added})

    @action(detail=True, methods=["post"])
    def advance_status(self, request, pk=None):
        """Advance run to next status (meta-level only — does NOT cascade to per-sample steps)."""
        run = self.get_object()
        new_status = request.data.get("status", "")
        valid_statuses = dict(SampleRun._meta.get_field("status").choices)
        if new_status not in valid_statuses:
            raise ValidationError(f"Invalid status. Choices: {list(valid_statuses.keys())}")
        run.status = new_status
        run.save(update_fields=["status", "updated_at"])

        # Only when COMPLETED: auto-create reports and mark all linked samples COMPLETED
        from django.utils import timezone

        # Sync sample status to match run step (for granular tracking)
        STEP_TO_SAMPLE_STATUS = {
            "PLANNED": "EXTRACTION",
            "LIBRARY_PREP": "LIBRARY_PREP",
            "LIBRARY_POOLING": "POOLING",
            "SEQUENCING": "SEQUENCING",
            "ANALYZING": "BIOINFORMATICS",
            "QC_REVIEW": "BIOINFORMATICS",
            "COMPLETED": "COMPLETED",
        }
        sample_status = STEP_TO_SAMPLE_STATUS.get(new_status)
        if sample_status:
            # Exclude REJECTED samples from advancement (they stay frozen)
            sample_ids = run.run_samples.exclude(
                sample__status="REJECTED"
            ).values_list("sample_id", flat=True)
            Sample.objects.filter(id__in=sample_ids).update(status=sample_status)

        if new_status == "COMPLETED":
            run.end_date = timezone.now()
            run.save(update_fields=["end_date"])

            # Auto-create draft reports for each sample in the run
            from lims.apps.reports.models import ReportTemplate, Report
            from datetime import date
            for rs in run.run_samples.select_related("sample"):
                sample = rs.sample
                # Skip REJECTED samples EXCEPT bioinformatics failures (they get reports)
                if sample.status == "REJECTED" and sample.rejection_reason != "生物信息分析失败":
                    continue
                if Report.objects.filter(sample=sample, run_sample=rs).exists():
                    continue
                template = ReportTemplate.objects.filter(panel=run.panel, is_active=True).first()
                if not template:
                    template = ReportTemplate.objects.create(
                        panel=run.panel,
                        code=f"{run.panel.code}_v1_en",
                        name=f"{run.panel.name} Report",
                        language="en",
                        version=1,
                        template_content={"header": f"{run.panel.name} Report", "sections": []},
                        site=run.site,
                        created_by=request.user,
                    )
                today = date.today().strftime("%Y%m%d")
                prefix = f"RPT-{today}"
                count = Report.objects.filter(report_number__startswith=prefix).count() + 1
                report_number = f"{prefix}-{count:04d}"
                # Collect workflow step results
                step_results = {}
                for step in run.steps.filter(sample=sample, status="COMPLETED").order_by("step_order"):
                    step_results[step.step_name or step.step_id] = {
                        "status": step.status,
                        "observations": step.observations or "",
                        "completed_at": str(step.completed_at) if step.completed_at else None,
                    }

                content = {
                    "run_number": run.run_number,
                    "panel": run.panel.code if run.panel else "",
                    "sample_barcode": sample.sample_id,
                    "patient_id": sample.patient_id,
                    "patient_name": sample.patient_name,
                    "patient_dob": str(sample.patient_dob) if sample.patient_dob else None,
                    "patient_sex": sample.patient_sex,
                    "collection_date": str(sample.collection_date) if sample.collection_date else None,
                    "receipt_date": str(sample.receipt_date) if sample.receipt_date else None,
                    "ordering_physician": sample.ordering_physician,
                    "ordering_facility": sample.ordering_facility,
                    "results": rs.result_summary or {},
                    "workflow_steps": step_results,
                    "status": "DRAFT",
                    "version": 1,
                    "generated_at": timezone.now().isoformat(),
                    "generated_by": f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
                }
                Report.objects.create(
                    report_number=report_number,
                    sample=sample,
                    run_sample=rs,
                    template=template,
                    site=run.site,
                    content=content,
                )
        elif new_status == "FAILED":
            sample_ids = run.run_samples.values_list("sample_id", flat=True)
            Sample.objects.filter(id__in=sample_ids).update(status="REJECTED")

        return Response({"status": new_status, "run_number": run.run_number})

    @action(detail=True, methods=["post"])
    def save_extraction(self, request, pk=None):
        """Save NIPT extraction data."""
        run = self.get_object()
        extraction_data = request.data.get("extraction_data", {})
        method = request.data.get("extraction_method", "")
        region = request.data.get("region", "")

        if method:
            run.extraction_method = method
        if region:
            run.region = region

        # Merge extraction data
        current = run.extraction_data or {}
        current.update(extraction_data)
        run.extraction_data = current
        run.save(update_fields=["extraction_data", "extraction_method", "region", "updated_at"])

        # Sync sample status: mark failed samples as REJECTED
        sample_results = extraction_data.get("sample_results", {})
        if sample_results:
            _sync_sample_failures(run, "extraction", sample_results)

        return Response({
            "extraction_method": run.extraction_method,
            "region": run.region,
            "extraction_data": run.extraction_data,
        })

    @action(detail=True, methods=["post"], url_path="extraction/sign")
    def sign_extraction(self, request, pk=None):
        """Record electronic signature for extraction step."""
        run = self.get_object()
        role = request.data.get("role", "")
        signer_name = request.data.get("signer", "").strip()
        password = request.data.get("password", "").strip()

        if role not in ["operator", "reviewer"]:
            return Response({"error": "role must be 'operator' or 'reviewer'."}, status=400)
        if not password:
            return Response({"error": "密码错误"}, status=400)

        # Validate signer name against NIPT signers or Django users
        if signer_name in NIPT_SIGNERS:
            if password != NIPT_SIGNER_PASSWORD:
                return Response({"error": "密码错误"}, status=400)
        else:
            try:
                signer_user = User.objects.get(
                    models.Q(first_name=signer_name) | models.Q(username=signer_name),
                    is_active=True,
                )
                if not signer_user.check_password(password):
                    return Response({"error": "密码错误"}, status=400)
            except User.DoesNotExist:
                return Response({"error": f"未找到签名人: {signer_name}"}, status=400)

        from django.utils import timezone
        timestamp = timezone.now().isoformat()
        sig_data = {"username": signer_name, "signed_at": timestamp}

        current = run.extraction_data or {}
        key = "operator_signature" if role == "operator" else "reviewer_signature"
        current[key] = sig_data
        run.extraction_data = current
        run.save(update_fields=["extraction_data", "updated_at"])

        return Response(current)

    @action(detail=True, methods=["post"], url_path="save_library")
    def save_library(self, request, pk=None):
        """Save NIPT library prep data."""
        run = self.get_object()
        library_data = request.data.get("library_data", {})
        method = request.data.get("library_method", "")

        if method:
            run.library_method = method

        current = run.library_data or {}
        current.update(library_data)
        run.library_data = current
        run.save(update_fields=["library_data", "library_method", "updated_at"])

        # Sync library failures
        sample_results = library_data.get("sample_results", {})
        if sample_results:
            _sync_sample_failures(run, "library", sample_results)

        return Response({
            "library_method": run.library_method,
            "library_data": run.library_data,
        })

    @action(detail=True, methods=["post"], url_path="library/sign")
    def sign_library(self, request, pk=None):
        """Record electronic signature for library prep step."""
        run = self.get_object()
        role = request.data.get("role", "")
        signer_name = request.data.get("signer", "").strip()
        password = request.data.get("password", "").strip()

        if role not in ["operator", "reviewer"]:
            return Response({"error": "role must be 'operator' or 'reviewer'."}, status=400)
        if not password:
            return Response({"error": "密码错误"}, status=400)

        # Validate signer name against NIPT signers or Django users
        if signer_name in NIPT_SIGNERS:
            if password != NIPT_SIGNER_PASSWORD:
                return Response({"error": "密码错误"}, status=400)
        else:
            try:
                signer_user = User.objects.get(
                    models.Q(first_name=signer_name) | models.Q(username=signer_name),
                    is_active=True,
                )
                if not signer_user.check_password(password):
                    return Response({"error": "密码错误"}, status=400)
            except User.DoesNotExist:
                return Response({"error": f"未找到签名人: {signer_name}"}, status=400)

        from django.utils import timezone
        timestamp = timezone.now().isoformat()
        sig_data = {"username": signer_name, "signed_at": timestamp}

        current = run.library_data or {}
        key = "operator_signature" if role == "operator" else "reviewer_signature"
        current[key] = sig_data
        run.library_data = current
        run.save(update_fields=["library_data", "updated_at"])

        return Response(current)

    @action(detail=True, methods=["post"], url_path="save_pooling")
    def save_pooling(self, request, pk=None):
        """Save NIPT library quantification & pooling data."""
        run = self.get_object()
        pooling_data = request.data.get("pooling_data", {})

        current = run.pooling_data or {}
        current.update(pooling_data)
        run.pooling_data = current
        run.save(update_fields=["pooling_data", "updated_at"])

        # Sync pooling QC failures
        samples = pooling_data.get("samples", [])
        failed_vg_ids = [s.get("vgId", "") for s in samples if s.get("qc") == "FAIL"]
        if failed_vg_ids:
            Sample.objects.filter(
                vg_id__in=failed_vg_ids,
                run_samples__run=run,
            ).update(
                status="REJECTED",
                rejection_reason="文库定量失败",
            )
        # Revert PASS samples previously REJECTED by pooling
        passed_vg_ids = [s.get("vgId", "") for s in samples if s.get("qc") == "PASS"]
        if passed_vg_ids:
            Sample.objects.filter(
                vg_id__in=passed_vg_ids,
                status="REJECTED",
                rejection_reason__startswith="文库定量失败",
            ).update(status="POOLING", rejection_reason="")

        return Response({"pooling_data": run.pooling_data})

    @action(detail=True, methods=["post"], url_path="pooling/sign")
    def sign_pooling(self, request, pk=None):
        """Record electronic signature for pooling step."""
        run = self.get_object()
        role = request.data.get("role", "")
        signer_name = request.data.get("signer", "").strip()
        password = request.data.get("password", "").strip()

        if role not in ["operator", "reviewer"]:
            return Response({"error": "role must be 'operator' or 'reviewer'."}, status=400)
        if not password:
            return Response({"error": "密码错误"}, status=400)

        # Validate signer name against NIPT signers or Django users
        if signer_name in NIPT_SIGNERS:
            if password != NIPT_SIGNER_PASSWORD:
                return Response({"error": "密码错误"}, status=400)
        else:
            try:
                signer_user = User.objects.get(
                    models.Q(first_name=signer_name) | models.Q(username=signer_name),
                    is_active=True,
                )
                if not signer_user.check_password(password):
                    return Response({"error": "密码错误"}, status=400)
            except User.DoesNotExist:
                return Response({"error": f"未找到签名人: {signer_name}"}, status=400)

        from django.utils import timezone
        timestamp = timezone.now().isoformat()
        sig_data = {"username": signer_name, "signed_at": timestamp}

        current = run.pooling_data or {}
        key = "operator_signature" if role == "operator" else "reviewer_signature"
        current[key] = sig_data
        run.pooling_data = current
        run.save(update_fields=["pooling_data", "updated_at"])

        return Response(current)

    @action(detail=True, methods=["post"], url_path="save_sequencing")
    def save_sequencing(self, request, pk=None):
        run = self.get_object()
        sequencing_data = request.data.get("sequencing_data", {})
        current = run.sequencing_data or {}
        current.update(sequencing_data)
        run.sequencing_data = current
        run.save(update_fields=["sequencing_data", "updated_at"])

        # Sync report_code / upload_id to Sample records from index_samples
        index_samples = sequencing_data.get("index_samples", [])
        updated = 0
        for item in index_samples:
            vg_id = item.get("vgId", "")
            report_code = item.get("reportCode", "")
            if vg_id and report_code:
                cnt = Sample.objects.filter(
                    vg_id=vg_id, is_deleted=False,
                    panel__code__in=["NIPT", "NIPT_PLUS", "NIPT_FULL"],
                ).update(report_code=report_code)
                updated += cnt

        return Response({
            "sequencing_data": run.sequencing_data,
            "samples_updated": updated,
        })

    @action(detail=True, methods=["post"], url_path="sequencing/sign")
    def sign_sequencing(self, request, pk=None):
        run = self.get_object()
        role = request.data.get("role", "")
        signer_name = request.data.get("signer", "").strip()
        password = request.data.get("password", "").strip()
        if role not in ["operator", "reviewer"]:
            return Response({"error": "role must be 'operator' or 'reviewer'."}, status=400)
        if not password:
            return Response({"error": "密码错误"}, status=400)

        # Validate signer name against NIPT signers or Django users
        if signer_name in NIPT_SIGNERS:
            if password != NIPT_SIGNER_PASSWORD:
                return Response({"error": "密码错误"}, status=400)
        else:
            try:
                signer_user = User.objects.get(
                    models.Q(first_name=signer_name) | models.Q(username=signer_name),
                    is_active=True,
                )
                if not signer_user.check_password(password):
                    return Response({"error": "密码错误"}, status=400)
            except User.DoesNotExist:
                return Response({"error": f"未找到签名人: {signer_name}"}, status=400)
        from django.utils import timezone
        timestamp = timezone.now().isoformat()
        sig_data = {"username": signer_name, "signed_at": timestamp}
        current = run.sequencing_data or {}
        key = "operator_signature" if role == "operator" else "reviewer_signature"
        current[key] = sig_data
        run.sequencing_data = current
        run.save(update_fields=["sequencing_data", "updated_at"])
        return Response(current)

    @action(detail=True, methods=["post"], url_path="save_bioinformatics")
    def save_bioinformatics(self, request, pk=None):
        """Save NIPT bioinformatics analysis results."""
        run = self.get_object()
        bio_data = request.data.get("bioinformatics_data", {})

        current = run.bioinformatics_data or {}
        current.update(bio_data)
        run.bioinformatics_data = current
        run.save(update_fields=["bioinformatics_data", "updated_at"])

        # Sync bioinformatics QC failures → REJECTED (but still allowed in reports)
        QC_FAIL_VALUES = {"浓度低", "高GC", "数据量不足", "多条染色体临界", "其他"}
        run_samples_map = {str(rs.id): rs for rs in run.run_samples.all()}
        for rs_id, data in bio_data.items():
            qc = (data.get("qc_status") or "").strip()
            if qc in QC_FAIL_VALUES:
                rs = run_samples_map.get(rs_id)
                if rs:
                    Sample.objects.filter(id=rs.sample_id).update(
                        status="REJECTED",
                        rejection_reason="生物信息分析失败",
                    )
            elif qc == "PASS":
                rs = run_samples_map.get(rs_id)
                if rs:
                    Sample.objects.filter(
                        id=rs.sample_id,
                        status="REJECTED",
                        rejection_reason="生物信息分析失败",
                    ).update(status="BIOINFORMATICS", rejection_reason="")

        return Response({"bioinformatics_data": run.bioinformatics_data})

    @action(detail=False, methods=["get"], url_path="last_batch_defaults")
    def last_batch_defaults(self, request):
        """Return reagent & equipment defaults from the most recent batch."""
        panel_code = request.query_params.get("panel", "")
        qs = self.get_queryset().order_by("-created_at")
        if panel_code:
            qs = qs.filter(panel__code__startswith=panel_code)

        # Exclude batches with no extraction data
        qs = qs.exclude(extraction_data__isnull=True).exclude(extraction_data__exact={})
        last_run = qs.first()
        if not last_run:
            return Response({})

        def safe_get(data, key, default=""):
            return (data or {}).get(key, default)

        return Response({
            "extraction": {
                "equipment": safe_get(last_run.extraction_data, "equipment"),
                "kit_type": safe_get(last_run.extraction_data, "kit_type"),
                "reagent_lot": safe_get(last_run.extraction_data, "reagent_lot"),
                "reagent_expiry": safe_get(last_run.extraction_data, "reagent_expiry"),
            },
            "library": {
                "equipment": safe_get(last_run.library_data, "equipment", []),
                "lib_kit": safe_get(last_run.library_data, "lib_kit"),
                "lib_kit_lot": safe_get(last_run.library_data, "lib_kit_lot"),
                "lib_kit_expiry": safe_get(last_run.library_data, "lib_kit_expiry"),
                "index_kit": safe_get(last_run.library_data, "index_kit"),
                "index_kit_lot": safe_get(last_run.library_data, "index_kit_lot"),
                "index_kit_expiry": safe_get(last_run.library_data, "index_kit_expiry"),
                "quant_kit": safe_get(last_run.library_data, "quant_kit"),
                "quant_kit_lot": safe_get(last_run.library_data, "quant_kit_lot"),
                "quant_kit_expiry": safe_get(last_run.library_data, "quant_kit_expiry"),
                "bead_kit": safe_get(last_run.library_data, "bead_kit"),
                "bead_kit_lot": safe_get(last_run.library_data, "bead_kit_lot"),
                "bead_kit_expiry": safe_get(last_run.library_data, "bead_kit_expiry"),
            },
            "sequencing": {
                "platform": safe_get(last_run.sequencing_data, "platform"),
                "equipment": safe_get(last_run.sequencing_data, "equipment", []),
                "chip": safe_get(last_run.sequencing_data, "chip"),
                "reagents": safe_get(last_run.sequencing_data, "reagents", []),
            },
        })

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Run statistics."""
        qs = self.get_queryset()
        stats = {s: qs.filter(status=s).count() for s, _ in SampleRun._meta.get_field("status").choices}
        stats["total"] = qs.count()
        return Response(stats)


class WorkflowStepViewSet(viewsets.ModelViewSet):
    """Individual workflow steps within a run."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WorkflowStepSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["status", "run", "sample"]
    ordering_fields = ["step_order"]

    def get_queryset(self):
        qs = WorkflowStep.objects.all().select_related("run", "sample", "performed_by", "instrument")
        if self.request.user.site_id:
            qs = qs.filter(run__site=self.request.user.site)
        return qs

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        step = self.get_object()
        step.status = "IN_PROGRESS"
        from django.utils import timezone
        step.started_at = timezone.now()
        step.performed_by = request.user
        step.save(update_fields=["status", "started_at", "performed_by"])
        return Response(WorkflowStepSerializer(step).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Complete experiment work - save step_data and mark PENDING_QC."""
        step = self.get_object()
        from django.utils import timezone

        step.status = "PENDING_QC"
        step.completed_at = timezone.now()
        step.performed_by = request.user

        if "performed_by" in request.data:
            try:
                step.performed_by = User.objects.get(id=request.data["performed_by"])
            except User.DoesNotExist:
                pass

        if "step_data" in request.data:
            step.step_data = request.data["step_data"]
        if "observations" in request.data:
            step.observations = request.data["observations"]
        if "reagent_lot_ids" in request.data:
            step.reagents_used = request.data["reagent_lot_ids"]
        if "instrument_id" in request.data:
            from lims.apps.instruments.models import Instrument
            try:
                step.instrument = Instrument.objects.get(id=request.data["instrument_id"])
            except Instrument.DoesNotExist:
                pass
        if "deviation_flag" in request.data:
            step.deviation_flag = request.data["deviation_flag"]
        if "deviation_note" in request.data:
            step.deviation_note = request.data["deviation_note"]

        step.save(update_fields=[
            "status", "completed_at", "performed_by", "step_data",
            "observations", "reagents_used", "instrument",
            "deviation_flag", "deviation_note",
        ])
        return Response(WorkflowStepSerializer(step).data)

    @action(detail=True, methods=["post"])
    def qc_review(self, request, pk=None):
        """QC review: pass/fail + auto-advance to next step if PASS."""
        step = self.get_object()
        from django.utils import timezone

        qc_result = request.data.get("qc_result", "PASS")
        if qc_result not in ("PASS", "FAIL"):
            raise ValidationError("qc_result must be PASS or FAIL")

        step.qc_status = qc_result
        step.qc_by = request.user
        step.qc_at = timezone.now()

        if "qc_notes" in request.data:
            existing = step.observations or ""
            step.observations = f"{existing}\n[QC: {qc_result}] {request.data['qc_notes']}"

        if qc_result == "PASS":
            step.status = "COMPLETED"
            step.save(update_fields=[
                "status", "qc_status", "qc_by", "qc_at", "observations",
            ])
            # Auto-activate next step
            next_step = WorkflowStep.objects.filter(
                run=step.run, step_order=step.step_order + 1, status="PENDING",
            ).first()
            if next_step:
                next_step.status = "IN_PROGRESS"
                next_step.started_at = timezone.now()
                next_step.save(update_fields=["status", "started_at"])
        else:
            step.status = "FAILED"
            step.save(update_fields=[
                "status", "qc_status", "qc_by", "qc_at", "observations",
            ])

        return Response(WorkflowStepSerializer(step).data)

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        step = self.get_object()
        step.status = "SKIPPED"
        step.save(update_fields=["status"])
        return Response(WorkflowStepSerializer(step).data)
    @action(detail=True, methods=["post"])
    def delete_step(self, request, pk=None):
        """Delete a workflow step. Any status allowed for testing cleanup."""
        step = self.get_object()
        step_name = step.step_name
        step.delete()
        return Response({
            "message": f"Workflow step '{step_name}' deleted",
        })
