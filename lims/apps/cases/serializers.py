"""Case serializers — NIPPT."""
from django.db import transaction
from django.db.models import F
from rest_framework import serializers
from django.utils import timezone
import datetime
from .models import Case, CaseSample, NipptPreProcessingBatch, NipptPreProcessingSample


class CaseSampleSerializer(serializers.ModelSerializer):
    sample_id = serializers.CharField(source="sample.sample_id", read_only=True)
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True)
    sample_status = serializers.CharField(source="sample.status", read_only=True)
    rejection_reason = serializers.CharField(source="sample.rejection_reason", read_only=True)
    rejection_note = serializers.CharField(source="sample.rejection_note", read_only=True)
    receipt_photo_url = serializers.SerializerMethodField()
    case_source = serializers.CharField(source="sample.sample_source", read_only=True, allow_null=True, allow_blank=True)
    collection_date = serializers.CharField(source="sample.collection_date", read_only=True, allow_null=True)
    fedex_no = serializers.CharField(source="sample.fedex_no", read_only=True, allow_null=True, allow_blank=True)
    external_id = serializers.CharField(source="sample.external_id", read_only=True)

    class Meta:
        model = CaseSample
        fields = [
            "id", "case", "sample", "sample_id", "patient_name", "sample_status",
            "role", "sample_source", "ethnicity", "relationship_to_mother",
            "receipt_condition", "received_at", "received_by",
            "collection_site", "collection_notes",
            "test_sample_id", "resample_of", "resample_number",
            "redo_of", "redo_count",
            "workflow_stage", "is_active",
            "arrival_date", "actual_sample_type", "preservation_method",
            "rejection_reason", "rejection_note", "external_id",
            "receipt_photo_url",
            "case_source",
            "collection_date", "fedex_no",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "received_at"]

    def get_receipt_photo_url(self, obj):
        if obj.receipt_photo:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.receipt_photo.url)
            return obj.receipt_photo.url
        return None


class CaseListSerializer(serializers.ModelSerializer):
    panel_code = serializers.CharField(source="panel.code", read_only=True)
    panel_name = serializers.CharField(source="panel.name", read_only=True)
    sample_count = serializers.SerializerMethodField()
    received_count = serializers.SerializerMethodField()
    workflow_status = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mother_name = serializers.SerializerMethodField()
    case_source = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    case_samples = CaseSampleSerializer(many=True, read_only=True)

    class Meta:
        model = Case
        fields = [
            "id", "case_number", "pt_number", "panel_code", "panel_name",
            "status", "status_display", "is_urgent",
            "sample_count", "received_count", "mother_name", "progress",
            "gestational_age_weeks", "gestational_age_days",
            "clinic_name", "sales_person",
            "applicant", "case_source", "registration_type",
            "expected_completion", "workflow_status", "created_at",
            "case_samples",
        ]

    def get_mother_name(self, obj):
        ms = obj.case_samples.filter(role="MOTHER").select_related("sample").first()
        if ms and ms.sample:
            return ms.sample.patient_name or ms.sample.sample_id
        return ""

    def get_case_source(self, obj):
        cs = obj.case_samples.filter(role="MOTHER").select_related("sample").first()
        if cs and cs.sample:
            return cs.sample.sample_source or ""
        return ""

    def get_can_redo(self, obj):
        """Return list of CaseSample IDs that have a FAIL workflow stage."""
        return list(obj.case_samples.filter(
            workflow_stage__endswith="_FAILED"
        ).values_list("id", flat=True))

    def get_progress(self, obj):
        WORKFLOW_WEIGHT = {
            "REGISTERED": 5, "RECEIVED": 12,
            "PRE_PROCESSING": 22, "EXTRACTION": 35,
            "LIBRARY_PREP": 48, "POOLING": 58,
            "HYB_SEQ": 70, "BIOINFO": 82,
            "REPORT_DRAFT": 92, "COMPLETED": 100,
        }
        css = obj.case_samples.all()
        total_weight = 0
        count = 0
        for cs in css:
            if not cs.is_active:
                continue
            stage = cs.workflow_stage or "REGISTERED"
            if stage.endswith("_FAILED"):
                continue
            total_weight += WORKFLOW_WEIGHT.get(stage, 0)
            count += 1
        if count == 0:
            return 0
        return round(total_weight / count, 1)

    def get_sample_count(self, obj):
        return obj.case_samples.count()

    def get_received_count(self, obj):
        return obj.case_samples.exclude(received_at=None).count()

    def get_workflow_status(self, obj):
        WORKFLOW_ORDER = [
            "REGISTERED", "RECEIVED", "PRE_PROCESSING", "EXTRACTION",
            "LIBRARY_PREP", "POOLING", "HYB_SEQ", "BIOINFO",
            "REPORT_DRAFT", "COMPLETED"
        ]
        css = obj.case_samples.filter(is_active=True)
        if not css.exists():
            css = obj.case_samples.all()
        slowest = "REGISTERED"
        slowest_idx = len(WORKFLOW_ORDER)
        for cs in css:
            stage = cs.workflow_stage or "REGISTERED"
            if stage.endswith("_FAILED"):
                continue
            if stage in WORKFLOW_ORDER:
                idx = WORKFLOW_ORDER.index(stage)
                if idx < slowest_idx:
                    slowest_idx = idx
                    slowest = stage
        return slowest


class CaseDetailSerializer(serializers.ModelSerializer):
    panel_code = serializers.CharField(source="panel.code", read_only=True)
    panel_name = serializers.CharField(source="panel.name", read_only=True)
    case_samples = CaseSampleSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mother_name = serializers.SerializerMethodField()
    can_redo = serializers.SerializerMethodField()  # list of CaseSample IDs that can be redone
    case_source = serializers.SerializerMethodField()
    all_samples_received = serializers.BooleanField(read_only=True)
    registration_url = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Case
        fields = [
            "id", "case_number", "pt_number", "panel", "panel_code", "panel_name",
            "status", "status_display", "all_samples_received", "progress",
            "gestational_age_weeks", "gestational_age_days",
            "clinic_name", "clinic_contact", "sales_person",
            "applicant", "phone", "email", "multiple_gestation",
            "risk_warnings", "registration_type",
            "notes", "is_urgent", "expected_completion",
            "registration_token", "registration_url",
            "case_samples", "site", "created_by",
            "created_at", "updated_at", "mother_name", "case_source",
            "can_redo",
        ]
        read_only_fields = [
            "id", "case_number", "pt_number", "registration_token", "created_at", "updated_at",
        ]

    def get_registration_url(self, obj):
        if obj.registration_token:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(f"/register/{obj.registration_token}/")
        return None

    def get_mother_name(self, obj):
        ms = obj.case_samples.filter(role="MOTHER").select_related("sample").first()
        if ms and ms.sample:
            return ms.sample.patient_name or ms.sample.sample_id
        return ""

    def get_case_source(self, obj):
        cs = obj.case_samples.filter(role="MOTHER").select_related("sample").first()
        if cs and cs.sample:
            return cs.sample.sample_source or ""
        return ""

    def get_can_redo(self, obj):
        """Return list of CaseSample IDs that have a FAIL workflow stage."""
        return list(obj.case_samples.filter(
            workflow_stage__endswith="_FAILED"
        ).values_list("id", flat=True))

    def get_progress(self, obj):
        WORKFLOW_WEIGHT = {
            "REGISTERED": 5, "RECEIVED": 12,
            "PRE_PROCESSING": 22, "EXTRACTION": 35,
            "LIBRARY_PREP": 48, "POOLING": 58,
            "HYB_SEQ": 70, "BIOINFO": 82,
            "REPORT_DRAFT": 92, "COMPLETED": 100,
        }
        css = obj.case_samples.all()
        total_weight = 0
        count = 0
        for cs in css:
            if not cs.is_active:
                continue
            stage = cs.workflow_stage or "REGISTERED"
            if stage.endswith("_FAILED"):
                continue
            total_weight += WORKFLOW_WEIGHT.get(stage, 0)
            count += 1
        if count == 0:
            return 0
        return round(total_weight / count, 1)


class CaseCreateSerializer(serializers.ModelSerializer):
    """Lab staff creates a case manually (supports 首次/补充/重采)."""
    # Write-only fields (not on Case model directly)
    sample_id = serializers.CharField(write_only=True, required=False, allow_blank=True)
    mother_name = serializers.CharField(write_only=True)
    mother_dob = serializers.DateField(write_only=True, required=False)
    father_names = serializers.ListField(
        child=serializers.CharField(), write_only=True, required=False, default=list
    )
    father_sample_types = serializers.ListField(
        child=serializers.ListField(
            child=serializers.ChoiceField(choices=CaseSample.SampleSource.choices)
        ),
        write_only=True, required=False, default=list,
        help_text='每个父亲的样本类型列表，如 [["BLOOD","HAIR"], ["SWAB"]]'
    )
    # New fields
    external_id = serializers.CharField(write_only=True, required=False, allow_blank=True, 
                                         help_text="外部样本编号")
    sample_source = serializers.CharField(write_only=True, required=False, allow_blank=True,
                                          help_text="样本来源")
    fedex_no = serializers.CharField(write_only=True, required=False, allow_blank=True)
    female_arrival_date = serializers.DateField(write_only=True, required=False)
    male_arrival_dates = serializers.ListField(
        child=serializers.DateField(), write_only=True, required=False, default=list
    )
    last_menstrual_period = serializers.DateField(write_only=True, required=False,
                                                   help_text="末次月经")

    class Meta:
        model = Case
        fields = [
            "sample_id", "gestational_age_weeks", "gestational_age_days",
            "clinic_name", "clinic_contact", "sales_person",
            "applicant", "phone", "email", "multiple_gestation",
            "risk_warnings", "registration_type",
            "last_menstrual_period",
            "notes", "is_urgent", "expected_completion",
            "mother_name", "mother_dob", "father_names",
            "father_sample_types",
            "external_id", "sample_source", "fedex_no",
            "female_arrival_date", "male_arrival_dates",
        ]

    def create(self, validated_data):
        from lims.apps.samples.models import Sample, SampleType, TestPanel

        request = self.context["request"]
        custom_sample_id = validated_data.pop("sample_id", "").strip()
        mother_name = validated_data.pop("mother_name")
        mother_dob = validated_data.pop("mother_dob", None)
        father_names = validated_data.pop("father_names", [])
        father_sample_types = validated_data.pop("father_sample_types", [])
        external_id = validated_data.pop("external_id", "") or ""
        sample_source = validated_data.pop("sample_source", "") or ""
        fedex_no = validated_data.pop("fedex_no", "") or ""
        female_arrival = validated_data.pop("female_arrival_date", None)
        male_arrivals = validated_data.pop("male_arrival_dates", [])
        last_menstrual_period = validated_data.pop("last_menstrual_period", None)

        panel = TestPanel.objects.filter(code="NIPPT", is_active=True).first()
        if not panel:
            raise serializers.ValidationError("NIPPT panel not found")

        today = datetime.date.today()
        now = datetime.datetime.now()

        prefix = f"NIPPT-{today.strftime('%Y%m%d')}"
        count = Case.objects.filter(case_number__startswith=prefix).count() + 1
        case_number = f"{prefix}-{count:04d}"

        case = Case.objects.create(
            case_number=case_number,
            panel=panel,
            status=Case.Status.REGISTERED,
            site=request.user.site,
            created_by=request.user,
            **validated_data,
        )
        # PT number assigned later during sample receipt confirmation

        sample_type, _ = SampleType.objects.get_or_create(
            code="PERIPHERAL_BLOOD",
            defaults={"name": "Peripheral Blood"},
        )

        # Create mother sample
        mother_sample = Sample.objects.create(
            sample_id=custom_sample_id or f"{case_number}-M",
            sample_type=sample_type,
            panel=panel,
            patient_name=mother_name,
            patient_dob=mother_dob,
            external_id=external_id,
            sample_source=sample_source,
            fedex_no=fedex_no,
            last_menstrual_period=last_menstrual_period,
            collection_date=today,
            receipt_date=today,
            receipt_time=now.time(),
            status="REGISTERED",
            site=request.user.site,
            created_by=request.user,
        )
        mother_cs = CaseSample.objects.create(
            case=case, sample=mother_sample, role=CaseSample.Role.MOTHER,
            arrival_date=female_arrival,
        )
        # test_sample_id assigned later during receipt confirmation

        # Create father samples (one CaseSample per sample type)
        for i, name in enumerate(father_names, 1):
            # 获取该父亲的样本类型列表，默认["BLOOD"]
            types = father_sample_types[i-1] if i-1 < len(father_sample_types) else ["BLOOD"]
            arrival = male_arrivals[i-1] if i-1 < len(male_arrivals) else None
            for j, st in enumerate(types, 1):
                father_sample = Sample.objects.create(
                    sample_id=f"{case_number}-AF{i}-{j}",
                    sample_type=sample_type,
                    panel=panel,
                    patient_name=name,
                    sample_source=sample_source,
                    collection_date=today,
                    receipt_date=today,
                    receipt_time=now.time(),
                    status="REGISTERED",
                    site=request.user.site,
                    created_by=request.user,
                )
                father_cs = CaseSample.objects.create(
                    case=case, sample=father_sample,
                    role=CaseSample.Role.ALLEGED_FATHER,
                    sample_source=st,
                    arrival_date=arrival,
                )
                # test_sample_id assigned later during receipt confirmation

        return case


class SupplementSerializer(serializers.Serializer):
    """补充样本：给已有 Case 添加新的 CaseSample (母亲或父亲)."""
    role = serializers.ChoiceField(choices=[("MOTHER", "Mother"), ("ALLEGED_FATHER", "Alleged Father")])
    patient_name = serializers.CharField(max_length=200)
    sample_types = serializers.ListField(
        child=serializers.ChoiceField(choices=CaseSample.SampleSource.choices),
        required=False, default=list,
        help_text="样本类型列表，男性可多选"
    )
    arrival_date = serializers.DateField(required=False)
    external_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    ethnicity = serializers.CharField(max_length=50, required=False, allow_blank=True)
    relationship_to_mother = serializers.CharField(max_length=50, required=False, allow_blank=True)

    def create(self, validated_data):
        from lims.apps.samples.models import Sample, SampleType
        case = self.context["case"]
        request = self.context["request"]

        role = validated_data["role"]
        patient_name = validated_data["patient_name"]
        sample_types = validated_data.get("sample_types", ["BLOOD"])
        if isinstance(sample_types, str):
            sample_types = [sample_types]  # 兼容旧格式
        arrival_date = validated_data.get("arrival_date")
        external_id = validated_data.get("external_id", "")
        ethnicity = validated_data.get("ethnicity", "")
        relationship = validated_data.get("relationship_to_mother", "")

        today = datetime.date.today()
        now = datetime.datetime.now()

        sample_type, _ = SampleType.objects.get_or_create(
            code="PERIPHERAL_BLOOD",
            defaults={"name": "Peripheral Blood"},
        )

        # Determine sample ID
        role_prefix = "M" if role == "MOTHER" else f"AF{case.case_samples.filter(role='ALLEGED_FATHER').count() + 1}"
        sample_id = external_id or f"{case.case_number}-{role_prefix}-SUP"

        css = []
        for st in sample_types:
            # 每个类型创建独立的 Sample + CaseSample
            s = Sample.objects.create(
                sample_id=f"{case.case_number}-SUP-{role[0]}-{len(css)+1}",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=patient_name,
                external_id=external_id,
                patient_sex="F" if role == "MOTHER" else "M",
                collection_date=today,
                receipt_date=today,
                receipt_time=now.time(),
                status="REGISTERED",
                site=case.site,
                created_by=request.user,
            )
            cs_obj = CaseSample.objects.create(
                case=case,
                sample=s,
                role=role,
                sample_source=st,
                arrival_date=arrival_date,
                ethnicity=ethnicity,
                relationship_to_mother=relationship,
            )
            css.append(cs_obj)
        # test_sample_id assigned during receipt confirmation

        return css[0] if css else None


class PublicRegistrationSerializer(serializers.Serializer):
    """Public registration form (no auth required)."""
    mother_name = serializers.CharField(max_length=200)
    mother_dob = serializers.DateField(required=False)
    mother_ethnicity = serializers.CharField(max_length=50, required=False, allow_blank=True)
    gestational_age_weeks = serializers.IntegerField(required=False, min_value=0, max_value=45)
    father_count = serializers.IntegerField(default=1, min_value=1, max_value=5)
    father_names = serializers.ListField(child=serializers.CharField(max_length=200))
    father_ethnicities = serializers.ListField(
        child=serializers.CharField(max_length=50, required=False), required=False
    )
    father_relationships = serializers.ListField(
        child=serializers.CharField(max_length=50, required=False), required=False
    )
    father_sample_sources = serializers.ListField(
        child=serializers.ChoiceField(choices=["BLOOD", "SWAB", "HAIR", "DBS"]),
        required=False,
    )
    clinic_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    clinic_contact = serializers.CharField(max_length=100, required=False, allow_blank=True)
    sales_person = serializers.CharField(max_length=100, required=False, allow_blank=True)
    collection_date = serializers.DateField(required=False)
    is_urgent = serializers.BooleanField(default=False)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)



# ============================================================
# NIPPT Pre-Processing Serializers
# ============================================================

class NipptPreProcessingSampleSerializer(serializers.ModelSerializer):
    """单个前处理样本条目"""
    received_sample_types = serializers.ListField(read_only=True)
    remaining_sample_types = serializers.ListField(read_only=True)
    test_sample_id = serializers.SerializerMethodField()

    class Meta:
        model = NipptPreProcessingSample
        fields = [
            "id", "batch", "case", "patient_name", "role", "category",
            "case_sample_ids",
            "sample_condition", "aliquot_tubes", "plasma_volume",
            "experiment_sample_type", "elution_volume", "dna_concentration",
            "remaining_override",
            "qc_status", "qc_note", "operator", "processed_at",
            "received_sample_types", "remaining_sample_types",
            "test_sample_id", "created_at",
        ]
        read_only_fields = ["id", "created_at", "received_sample_types", "remaining_sample_types"]

    def get_index(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(str(obj.source_pooling_sample_id), "")
        return ""
    def get_test_sample_id(self, obj):
        """Get the test_sample_id from the first CaseSample."""
        if obj.case_sample_ids:
            from .models import CaseSample
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs:
                return cs.test_sample_id
        return None


class NipptPreProcessingBatchListSerializer(serializers.ModelSerializer):
    """批次列表"""
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()

    class Meta:
        model = NipptPreProcessingBatch
        fields = [
            "id", "batch_number", "status", "status_display",
            "sample_count", "female_count", "male_blood_count", "male_other_count",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.samples.count()

    def get_female_count(self, obj):
        return obj.samples.filter(category="FEMALE_BLOOD").count()

    def get_male_blood_count(self, obj):
        return obj.samples.filter(category="MALE_BLOOD").count()

    def get_male_other_count(self, obj):
        return obj.samples.filter(category="MALE_OTHER").count()


class NipptPreProcessingBatchDetailSerializer(serializers.ModelSerializer):
    """批次详情（含样本分组）"""
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    female_samples = serializers.SerializerMethodField()
    male_blood_samples = serializers.SerializerMethodField()
    male_other_samples = serializers.SerializerMethodField()

    class Meta:
        model = NipptPreProcessingBatch
        fields = [
            "id", "batch_number", "status", "status_display",
            "sample_count", "female_count", "male_blood_count", "male_other_count",
            "female_samples", "male_blood_samples", "male_other_samples",
            "processing_data", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.samples.count()

    def get_female_count(self, obj):
        return obj.samples.filter(category="FEMALE_BLOOD").count()

    def get_male_blood_count(self, obj):
        return obj.samples.filter(category="MALE_BLOOD").count()

    def get_male_other_count(self, obj):
        return obj.samples.filter(category="MALE_OTHER").count()

    def get_female_samples(self, obj):
        qs = obj.samples.filter(category="FEMALE_BLOOD")
        return NipptPreProcessingSampleSerializer(qs, many=True).data

    def get_male_blood_samples(self, obj):
        qs = obj.samples.filter(category="MALE_BLOOD")
        return NipptPreProcessingSampleSerializer(qs, many=True).data

    def get_male_other_samples(self, obj):
        qs = obj.samples.filter(category="MALE_OTHER")
        return NipptPreProcessingSampleSerializer(qs, many=True).data


class NipptPreProcessingBatchCreateSerializer(serializers.ModelSerializer):
    """创建批次"""
    case_sample_ids = serializers.ListField(
        child=serializers.CharField(), write_only=True,
        help_text="要加入批次的 CaseSample UUID 列表"
    )

    class Meta:
        model = NipptPreProcessingBatch
        fields = ["id", "batch_number", "status", "case_sample_ids"]
        read_only_fields = ["id", "batch_number"]

    def create(self, validated_data):
        from .models import CaseSample
        from django.db import transaction

        request = self.context["request"]
        case_sample_ids = validated_data.pop("case_sample_ids", [])

        with transaction.atomic():
            # Generate batch number with row lock to prevent duplicates
            batch_number = NipptPreProcessingBatch.generate_batch_number()

            batch = NipptPreProcessingBatch.objects.create(
                batch_number=batch_number,
                status=NipptPreProcessingBatch.Status.DRAFT,
                created_by=request.user,
            )

            # One PP sample per CaseSample
            css = CaseSample.objects.filter(
                id__in=case_sample_ids
            ).select_related("case", "sample")

            # Group by person — one row per person with all sample types
            groups = {}
            for cs in css:
                key = (str(cs.case_id), cs.sample.patient_name)
                if key not in groups:
                    if cs.role == "MOTHER":
                        cat = "FEMALE_BLOOD"
                    elif cs.sample_source in ("BLOOD", "DBS"):
                        cat = "MALE_BLOOD"
                    else:
                        cat = "MALE_OTHER"
                    groups[key] = {"case": cs.case, "name": cs.sample.patient_name, "role": cs.role, "category": cat, "ids": []}
                groups[key]["ids"].append(str(cs.id))

            for gdata in groups.values():
                kwargs = {
                    "batch": batch,
                    "case": gdata["case"],
                    "patient_name": gdata["name"],
                    "role": gdata["role"],
                    "category": gdata["category"],
                    "case_sample_ids": gdata["ids"],
                }
                # Filter case_sample_ids by experiment_sample_type if set
                exp_type = gdata.get("experiment_sample_type", "")
                if exp_type:
                    matching = []
                    for cid in kwargs.get("case_sample_ids", []):
                        cs = CaseSample.objects.filter(id=cid).first()
                        if cs and cs.sample_source == exp_type:
                            matching.append(cid)
                    kwargs["case_sample_ids"] = matching

                if gdata["category"] == "MALE_BLOOD":
                    kwargs["aliquot_tubes"] = 2
                    kwargs["plasma_volume"] = 30.0
                elif gdata["category"] == "FEMALE_BLOOD":
                    kwargs["aliquot_tubes"] = 3
                # MALE_OTHER: no aliquot_tubes
                NipptPreProcessingSample.objects.create(**kwargs)

            CaseSample.objects.filter(id__in=case_sample_ids).update(workflow_stage="PRE_PROCESSING")
            from .models import WorkflowLog
            WorkflowLog.objects.bulk_create([
                WorkflowLog(case_sample_id=cid, stage="PRE_PROCESSING", action="ENTER", batch_number=batch_number)
                for cid in case_sample_ids
            ])

        return batch


class PendingEntrySerializer(serializers.Serializer):
    """待前处理队列条目 — 逐条CaseSample"""
    case_id = serializers.CharField()
    case_number = serializers.CharField()
    patient_name = serializers.CharField()
    role = serializers.CharField()
    category = serializers.CharField()
    sample_types = serializers.ListField(child=serializers.CharField())
    case_sample_ids = serializers.ListField(child=serializers.CharField())
    test_sample_id = serializers.CharField(allow_null=True)


# ══════════════════════════════════════════
# NIPPT Extraction (核酸提取)
# ══════════════════════════════════════════

from .models import NipptExtractionBatch, NipptExtractionSample

class NipptExtractionSampleSerializer(serializers.ModelSerializer):
    test_sample_id = serializers.SerializerMethodField()
    experiment_sample_type = serializers.SerializerMethodField()

    class Meta:
        model = NipptExtractionSample
        fields = "__all__"
        read_only_fields = ["id", "created_at"]

    def get_index(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(str(obj.source_pooling_sample_id), "")
        return ""
    def get_test_sample_id(self, obj):
        if obj.case_sample_ids:
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs:
                return cs.test_sample_id
        return None

    def get_experiment_sample_type(self, obj):
        if obj.source_preprocessing_sample_id:
            pp = NipptPreProcessingSample.objects.filter(id=obj.source_preprocessing_sample_id).first()
            if pp:
                if "BLOOD" in obj.category:
                    return "BLOOD"
                return pp.experiment_sample_type or ""
        return ""


class NipptExtractionBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()

    class Meta:
        model = NipptExtractionBatch
        fields = ["id", "batch_number", "status", "status_display", "sample_count",
                  "female_count", "male_blood_count", "male_other_count",
                  "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_sample_count(self, obj): return obj.samples.count()
    def get_female_count(self, obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self, obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self, obj): return obj.samples.filter(category="MALE_OTHER").count()


class NipptExtractionBatchDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    female_samples = serializers.SerializerMethodField()
    male_blood_samples = serializers.SerializerMethodField()
    male_other_samples = serializers.SerializerMethodField()

    class Meta:
        model = NipptExtractionBatch
        fields = ["id", "batch_number", "status", "status_display",
                  "sample_count", "female_count", "male_blood_count", "male_other_count",
                  "female_samples", "male_blood_samples", "male_other_samples",
                  "extraction_data", "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_sample_count(self, obj): return obj.samples.count()
    def get_female_count(self, obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self, obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self, obj): return obj.samples.filter(category="MALE_OTHER").count()
    def get_female_samples(self, obj): return NipptExtractionSampleSerializer(obj.samples.filter(category="FEMALE_BLOOD"), many=True).data
    def get_male_blood_samples(self, obj): return NipptExtractionSampleSerializer(obj.samples.filter(category="MALE_BLOOD"), many=True).data
    def get_male_other_samples(self, obj): return NipptExtractionSampleSerializer(obj.samples.filter(category="MALE_OTHER"), many=True).data


class NipptExtractionBatchCreateSerializer(serializers.ModelSerializer):
    case_sample_ids = serializers.ListField(child=serializers.CharField(), write_only=True)
    qc_sample_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = NipptExtractionBatch
        fields = ["id", "batch_number", "status", "case_sample_ids", "qc_sample_id"]
        read_only_fields = ["id", "batch_number"]

    def create(self, validated_data):
        request = self.context["request"]
        case_sample_ids = validated_data.pop("case_sample_ids", [])
        qc_sample_id = validated_data.pop("qc_sample_id", None)
        with transaction.atomic():
            batch_number = NipptExtractionBatch.generate_batch_number()
            batch = NipptExtractionBatch.objects.create(batch_number=batch_number, status="DRAFT", created_by=request.user)
            css = CaseSample.objects.filter(id__in=case_sample_ids).select_related("case", "sample")
            groups = {}
            for cs in css:
                if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
                elif cs.sample_source in ("BLOOD", "DBS"): cat = "MALE_BLOOD"
                else: cat = "MALE_OTHER"
                key = (str(cs.case_id), cs.sample.patient_name, cat)
                if key not in groups: groups[key] = {"case": cs.case, "ids": [], "role": cs.role}
                groups[key]["ids"].append(str(cs.id))
            for (_, name, cat), gdata in groups.items():
                pp_sample = None
                for pp in NipptPreProcessingSample.objects.filter(batch__status="COMPLETED", qc_status="PASS", category=cat):
                    if pp.case_sample_ids and any(cid in pp.case_sample_ids for cid in gdata["ids"]):
                        pp_sample = pp; break
                kwargs = {"batch": batch, "case": gdata["case"], "patient_name": name,
                          "role": gdata["role"], "category": cat, "case_sample_ids": gdata["ids"]}
                if pp_sample:
                    if pp_sample.plasma_volume: kwargs["plasma_volume"] = pp_sample.plasma_volume
                    kwargs["aliquot_tubes"] = pp_sample.aliquot_tubes
                    kwargs["source_preprocessing_sample_id"] = pp_sample.id
                es = NipptExtractionSample.objects.create(**kwargs)
                if pp_sample:
                    NipptPreProcessingSample.objects.filter(id=pp_sample.id).update(aliquot_tubes=F('aliquot_tubes') - 1)
                # ENTER WorkflowLog
                for cid in kwargs.get("case_sample_ids", []):
                    WorkflowLog.objects.create(
                        case_sample_id=cid, stage="EXTRACTION", action="ENTER",
                        batch_number=batch.batch_number, batch_sample_id=str(es.id),
                        operator=request.user)
            if qc_sample_id:
                qc = NipptPreProcessingSample.objects.filter(id=qc_sample_id).first()
                if qc:
                    NipptExtractionSample.objects.create(batch=batch, case=qc.case, patient_name=qc.patient_name+" (QC)",
                        role="MOTHER", category="FEMALE_BLOOD", case_sample_ids=qc.case_sample_ids,
                        source_preprocessing_sample_id=qc.id, aliquot_tubes=qc.aliquot_tubes, is_qc=True)
                    NipptPreProcessingSample.objects.filter(id=qc.id).update(aliquot_tubes=F('aliquot_tubes') - 1)
        return batch


# ══════════════════════════════════════════
# NIPPT Library Prep (文库构建)
# ══════════════════════════════════════════

from .models import NipptLibraryBatch, NipptLibrarySample

class NipptLibrarySampleSerializer(serializers.ModelSerializer):
    test_sample_id = serializers.SerializerMethodField()
    experiment_sample_type = serializers.SerializerMethodField()
    class Meta:
        model = NipptLibrarySample
        fields = "__all__"
        read_only_fields = ["id", "created_at"]
    def get_index(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(str(obj.source_pooling_sample_id), "")
        return ""
    def get_test_sample_id(self, obj):
        if obj.case_sample_ids:
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs: return cs.test_sample_id
        return None
    def get_experiment_sample_type(self, obj):
        if obj.source_extraction_sample_id:
            es = NipptExtractionSample.objects.filter(id=obj.source_extraction_sample_id).first()
            if es:
                if "BLOOD" in obj.category: return "BLOOD"
                return getattr(es, 'experiment_sample_type', '') or ''
        return ''

class NipptLibraryBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    class Meta:
        model = NipptLibraryBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()

class NipptLibraryBatchDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    female_samples = serializers.SerializerMethodField()
    male_blood_samples = serializers.SerializerMethodField()
    male_other_samples = serializers.SerializerMethodField()
    class Meta:
        model = NipptLibraryBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","female_samples","male_blood_samples","male_other_samples","library_data","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()
    def get_female_samples(self,obj): return NipptLibrarySampleSerializer(obj.samples.filter(category="FEMALE_BLOOD"), many=True).data
    def get_male_blood_samples(self,obj): return NipptLibrarySampleSerializer(obj.samples.filter(category="MALE_BLOOD"), many=True).data
    def get_male_other_samples(self,obj): return NipptLibrarySampleSerializer(obj.samples.filter(category="MALE_OTHER"), many=True).data

class NipptLibraryBatchCreateSerializer(serializers.ModelSerializer):
    case_sample_ids = serializers.ListField(child=serializers.CharField(), write_only=True)
    class Meta:
        model = NipptLibraryBatch
        fields = ["id","batch_number","status","case_sample_ids"]
        read_only_fields = ["id","batch_number"]
    def create(self, validated_data):
        request = self.context["request"]
        case_sample_ids = validated_data.pop("case_sample_ids",[])
        with transaction.atomic():
            batch_number = NipptLibraryBatch.generate_batch_number()
            batch = NipptLibraryBatch.objects.create(batch_number=batch_number, status="DRAFT", created_by=request.user)
            css = CaseSample.objects.filter(id__in=case_sample_ids).select_related("case","sample")
            es_map = {}
            for es in NipptExtractionSample.objects.filter(batch__status="COMPLETED", qc_status="PASS"):
                if es.case_sample_ids:
                    for cid in es.case_sample_ids: es_map[cid] = es
            groups = {}
            for cs in css:
                if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
                elif cs.sample_source in ("BLOOD","DBS"): cat = "MALE_BLOOD"
                else: cat = "MALE_OTHER"
                key = (str(cs.case_id), cs.sample.patient_name, cat)
                if key not in groups: groups[key] = {"case":cs.case,"ids":[],"role":cs.role}
                groups[key]["ids"].append(str(cs.id))
            for (_,name,cat), gdata in groups.items():
                es = None
                for cid in gdata["ids"]:
                    if cid in es_map: es = es_map[cid]; break
                kwargs = {"batch":batch,"case":gdata["case"],"patient_name":name,"role":gdata["role"],"category":cat,"case_sample_ids":gdata["ids"]}
                if es: kwargs["source_extraction_sample_id"] = es.id
                ls = NipptLibrarySample.objects.create(**kwargs)
                for cid in kwargs.get("case_sample_ids", []):
                    WorkflowLog.objects.create(
                        case_sample_id=cid, stage="LIBRARY_PREP", action="ENTER",
                        batch_number=batch.batch_number, batch_sample_id=str(ls.id),
                        operator=request.user)
        return batch


from .models import NipptPoolingBatch, NipptPoolingSample

class NipptPoolingSampleSerializer(serializers.ModelSerializer):
    test_sample_id = serializers.SerializerMethodField()
    experiment_sample_type = serializers.SerializerMethodField()
    class Meta:
        model = NipptPoolingSample
        fields = "__all__"
        read_only_fields = ["id", "created_at"]
    def get_index(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(str(obj.source_pooling_sample_id), "")
        return ""
    def get_test_sample_id(self, obj):
        if obj.case_sample_ids:
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs: return cs.test_sample_id
        return None
    def get_experiment_sample_type(self, obj):
        if "BLOOD" in obj.category: return "BLOOD"
        if obj.source_library_sample_id:
            ls = NipptLibrarySample.objects.filter(id=obj.source_library_sample_id).first()
            if ls and ls.source_extraction_sample_id:
                es = NipptExtractionSample.objects.filter(id=ls.source_extraction_sample_id).first()
                if es:
                    if es.source_preprocessing_sample_id:
                        pp = NipptPreProcessingSample.objects.filter(id=es.source_preprocessing_sample_id).first()
                        if pp and pp.experiment_sample_type: return pp.experiment_sample_type
                    if es.experiment_sample_type: return es.experiment_sample_type
        return ''

class NipptPoolingBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    class Meta:
        model = NipptPoolingBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()

class NipptPoolingBatchDetailSerializer(serializers.ModelSerializer):
    library_plate = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    female_samples = serializers.SerializerMethodField()
    male_blood_samples = serializers.SerializerMethodField()
    male_other_samples = serializers.SerializerMethodField()
    library_index_map = serializers.SerializerMethodField()
    class Meta:
        model = NipptPoolingBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","female_samples","male_blood_samples","male_other_samples","pooling_data","library_plate","library_index_map","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()
    def get_female_samples(self,obj): return NipptPoolingSampleSerializer(obj.samples.filter(category="FEMALE_BLOOD"), many=True).data
    def get_male_blood_samples(self,obj): return NipptPoolingSampleSerializer(obj.samples.filter(category="MALE_BLOOD"), many=True).data
    def get_male_other_samples(self,obj): return NipptPoolingSampleSerializer(obj.samples.filter(category="MALE_OTHER"), many=True).data
    def get_library_index_map(self, obj):
        index_map = {}
        seen_batches = set()
        for sp in obj.samples.all():
            if not sp.source_library_sample_id:
                continue
            ls = NipptLibrarySample.objects.filter(id=sp.source_library_sample_id).first()
            if not ls or not ls.batch.library_data or ls.batch.id in seen_batches:
                continue
            seen_batches.add(ls.batch.id)
            ld = ls.batch.library_data

            def extract_from_plate(plate):
                if not plate: return
                for row in plate:
                    for cell in row:
                        if isinstance(cell, dict) and cell.get("vgId") and cell.get("index"):
                            index_map[cell["vgId"]] = cell["index"]

            if ld.get("xiamen_plate"):
                extract_from_plate(ld["xiamen_plate"])
            if ld.get("female_plate"):
                extract_from_plate(ld["female_plate"])
            if ld.get("male_plate"):
                extract_from_plate(ld["male_plate"])
        return index_map

    def get_library_plate(self, obj):
        first = obj.samples.first()
        if first and first.source_library_sample_id:
            ls = NipptLibrarySample.objects.filter(id=first.source_library_sample_id).first()
            if ls and ls.batch.library_data:
                ld = ls.batch.library_data
                if ld.get("xiamen_plate"): return ld["xiamen_plate"]
                if ld.get("female_plate"): return ld["female_plate"]
                if ld.get("male_plate"): return ld["male_plate"]
        return []

class NipptPoolingBatchCreateSerializer(serializers.ModelSerializer):
    case_sample_ids = serializers.ListField(child=serializers.CharField(), write_only=True)
    class Meta:
        model = NipptPoolingBatch
        fields = ["id","batch_number","status","case_sample_ids"]
        read_only_fields = ["id","batch_number"]
    def create(self, validated_data):
        request = self.context["request"]
        case_sample_ids = validated_data.pop("case_sample_ids",[])
        with transaction.atomic():
            batch_number = NipptPoolingBatch.generate_batch_number()
            batch = NipptPoolingBatch.objects.create(batch_number=batch_number, status="DRAFT", created_by=request.user)
            css = CaseSample.objects.filter(id__in=case_sample_ids).select_related("case","sample")
            ls_map = {}
            for ls in NipptLibrarySample.objects.filter(batch__status="COMPLETED", qc_status="PASS"):
                if ls.case_sample_ids:
                    for cid in ls.case_sample_ids: ls_map[cid] = ls
            groups = {}
            for cs in css:
                if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
                elif cs.sample_source in ("BLOOD","DBS"): cat = "MALE_BLOOD"
                else: cat = "MALE_OTHER"
                key = (str(cs.case_id), cs.sample.patient_name, cat)
                if key not in groups: groups[key] = {"case":cs.case,"ids":[],"role":cs.role}
                groups[key]["ids"].append(str(cs.id))
            for (_,name,cat), gdata in groups.items():
                ls = None
                for cid in gdata["ids"]:
                    if cid in ls_map: ls = ls_map[cid]; break
                kwargs = {"batch":batch,"case":gdata["case"],"patient_name":name,"role":gdata["role"],"category":cat,"case_sample_ids":gdata["ids"]}
                if ls: kwargs["source_library_sample_id"] = ls.id
                ps = NipptPoolingSample.objects.create(**kwargs)
                for cid in kwargs.get("case_sample_ids", []):
                    WorkflowLog.objects.create(
                        case_sample_id=cid, stage="POOLING", action="ENTER",
                        batch_number=batch.batch_number, batch_sample_id=str(ps.id),
                        operator=request.user)
        return batch

from .models import NipptHybSeqBatch, NipptHybSeqSample, WorkflowLog

class NipptHybSeqSampleSerializer(serializers.ModelSerializer):
    test_sample_id = serializers.SerializerMethodField()
    experiment_sample_type = serializers.SerializerMethodField()
    index = serializers.SerializerMethodField()
    class Meta:
        model = NipptHybSeqSample
        fields = "__all__"
        read_only_fields = ["id", "created_at"]
    def get_index(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(str(obj.source_pooling_sample_id), "")
        return ""
    def get_test_sample_id(self, obj):
        if obj.case_sample_ids:
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs: return cs.test_sample_id
        return None
    def get_experiment_sample_type(self, obj):
        if obj.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=obj.source_pooling_sample_id).first()
            if ps:
                if "BLOOD" in obj.category: return "BLOOD"
                return getattr(ps, 'experiment_sample_type', '') or ''
        return ''

class NipptHybSeqBatchListSerializer(serializers.ModelSerializer):
    sample_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    class Meta:
        model = NipptHybSeqBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()

class NipptHybSeqBatchDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    female_count = serializers.SerializerMethodField()
    male_blood_count = serializers.SerializerMethodField()
    male_other_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    female_samples = serializers.SerializerMethodField()
    male_blood_samples = serializers.SerializerMethodField()
    male_other_samples = serializers.SerializerMethodField()
    mix_sources = serializers.SerializerMethodField()
    class Meta:
        model = NipptHybSeqBatch
        fields = ["id","batch_number","status","status_display","sample_count","female_count","male_blood_count","male_other_count","female_samples","male_blood_samples","male_other_samples","mix_sources","hyb_seq_data","created_by","created_at","updated_at"]
        read_only_fields = ["id","batch_number","created_at","updated_at"]
    def get_sample_count(self,obj): return obj.samples.count()
    def get_female_count(self,obj): return obj.samples.filter(category="FEMALE_BLOOD").count()
    def get_male_blood_count(self,obj): return obj.samples.filter(category="MALE_BLOOD").count()
    def get_male_other_count(self,obj): return obj.samples.filter(category="MALE_OTHER").count()
    def get_female_samples(self,obj): return NipptHybSeqSampleSerializer(obj.samples.filter(category="FEMALE_BLOOD"), many=True).data
    def get_male_blood_samples(self,obj): return NipptHybSeqSampleSerializer(obj.samples.filter(category="MALE_BLOOD"), many=True).data
    def get_male_other_samples(self,obj): return NipptHybSeqSampleSerializer(obj.samples.filter(category="MALE_OTHER"), many=True).data

    def get_mix_sources(self, obj):
        hd = obj.hyb_seq_data or {}
        # Return stored value if available
        stored = hd.get("mix_sources")
        if stored:
            return stored
        # Otherwise compute from mix_ids
        mix_ids = hd.get("mix_ids", [])
        from .models import NipptPoolingBatch
        sources = []
        for mid in mix_ids:
            try:
                pb_id, gi_str = mid.rsplit("_", 1)
                gi = int(gi_str)
                pb = NipptPoolingBatch.objects.filter(id=pb_id).first()
                if pb:
                    sources.append(f"{pb.batch_number}-mix{gi+1}")
                else:
                    sources.append(mid)
            except Exception:
                sources.append(mid)
        return sources

class NipptHybSeqBatchCreateSerializer(serializers.ModelSerializer):
    mix_ids = serializers.ListField(child=serializers.CharField(), write_only=True)
    chip_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
    mix_sources = serializers.ListField(child=serializers.CharField(), write_only=True, required=False, default=list)
    class Meta:
        model = NipptHybSeqBatch
        fields = ["id","batch_number","status","mix_ids","mix_sources","chip_number"]
        read_only_fields = ["id","batch_number"]
    def create(self, validated_data):
        request = self.context["request"]
        mix_ids = validated_data.pop("mix_ids",[])
        chip = validated_data.pop("chip_number","")
        with transaction.atomic():
            batch_number = NipptHybSeqBatch.generate_batch_number()
            pooling_batch_id = mix_ids[0].split("_")[0] if mix_ids else ""
            batch = NipptHybSeqBatch.objects.create(batch_number=batch_number, status="DRAFT", created_by=request.user)
            mix_sources = validated_data.pop("mix_sources", [])
            batch.hyb_seq_data = {"pooling_batch_id": pooling_batch_id, "mix_ids": mix_ids, "mix_sources": mix_sources, "chip_number": chip}
            batch.save(update_fields=["hyb_seq_data"])
            # Create samples only for selected mixes
            # Parse mix_ids: {pooling_batch_id}_{group_index}
            used_f_ids = set()
            used_m_ids = set()
            for mix_id in mix_ids:
                try:
                    pb_id, gi_str = mix_id.rsplit("_", 1)
                    gi = int(gi_str)
                    pb = NipptPoolingBatch.objects.get(id=pb_id, status="COMPLETED")
                    pd = pb.pooling_data or {}
                    groups = pd.get("manual_alloc") or []
                    f_all = pb.samples.filter(category="FEMALE_BLOOD", qc_status="PASS").count()
                    m_all = pb.samples.filter(qc_status="PASS").count() - f_all
                    if not groups:
                        groups = [{"female":f_all//2,"male":m_all//2},{"female":f_all-f_all//2,"male":m_all-m_all//2}]
                    if gi >= len(groups): continue
                    grp = groups[gi]
                    f_take = grp.get("female", 0)
                    m_take = grp.get("male", 0)
                    # Get all available samples, skip already assigned ones
                    f_pool = list(pb.samples.filter(category="FEMALE_BLOOD", qc_status="PASS").exclude(id__in=used_f_ids).order_by("patient_name")[:f_take])
                    m_pool = list(pb.samples.filter(category__in=["MALE_BLOOD","MALE_OTHER"], qc_status="PASS").exclude(id__in=used_m_ids).order_by("patient_name")[:m_take])
                    used_f_ids.update(ps.id for ps in f_pool)
                    used_m_ids.update(ps.id for ps in m_pool)
                    for ps in f_pool + m_pool:
                        if not NipptHybSeqSample.objects.filter(batch=batch, source_pooling_sample_id=ps.id).exists():
                            hs = NipptHybSeqSample.objects.create(
                                batch=batch, case=ps.case, patient_name=ps.patient_name,
                                role=ps.role, category=ps.category,
                                case_sample_ids=ps.case_sample_ids,
                                source_pooling_sample_id=ps.id,
                            )
                            # ENTER WorkflowLog
                            for cid in ps.case_sample_ids:
                                WorkflowLog.objects.create(
                                    case_sample_id=cid, stage="HYB_SEQ", action="ENTER",
                                    batch_number=batch.batch_number, batch_sample_id=str(hs.id),
                                    operator=request.user)
                except (ValueError, NipptPoolingBatch.DoesNotExist):
                    continue
        return batch


from .models import NipptBioinfoBatch, NipptBioinfoSample, NipptBioinfoPair, NipptHybSeqBatch, NipptHybSeqSample


# ── NIPPT Bioinformatics Serializers ──

class NipptBioinfoPairSerializer(serializers.ModelSerializer):
    mother_name = serializers.CharField(source="mother_sample.patient_name", read_only=True)
    father_name = serializers.CharField(source="father_sample.patient_name", read_only=True)
    mother_index = serializers.SerializerMethodField()
    father_index = serializers.SerializerMethodField()
    father_sample_type = serializers.SerializerMethodField()
    case_number = serializers.CharField(source="case.case_number", read_only=True)
    pt_number = serializers.CharField(source="case.pt_number", read_only=True)
    case_source = serializers.SerializerMethodField()
    result_display = serializers.CharField(source="get_result_display", read_only=True)
    qc_flag_display = serializers.CharField(source="get_qc_flag_display", read_only=True)

    class Meta:
        model = NipptBioinfoPair
        fields = [
            "id", "batch", "case", "case_number", "pt_number", "case_source",
            "mother_sample", "mother_name", "mother_index",
            "father_sample", "father_name", "father_index", "father_sample_type",
            "father_label", "is_cross_batch",
            "mother_source_batch", "father_source_batch",
            "cpi", "cpi_combined", "result", "result_display",
            "note", "report_data",
            "qc_flag", "qc_flag_display",
            "mother_layers", "mother_concentration", "mother_het_ratio", "mother_y_ratio",
            "father_layers", "father_concentration", "father_het_ratio", "father_y_ratio",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_mother_index(self, obj):
        return self._get_index(obj.mother_sample)

    def get_father_index(self, obj):
        return self._get_index(obj.father_sample)

    def get_father_sample_type(self, obj):
        return self._get_sample_type(obj.father_sample)

    def get_case_source(self, obj):
        """Get country/region source from mother's Sample"""
        if obj.mother_sample and obj.mother_sample.case_sample_ids:
            cs = CaseSample.objects.filter(
                id=obj.mother_sample.case_sample_ids[0]
            ).select_related("sample").first()
            if cs and cs.sample:
                return cs.sample.sample_source or ""
        return ""

    def _get_index(self, sample):
        if not sample or not sample.source_hybseq_sample_id:
            return ""
        from .models import NipptHybSeqSample, NipptPoolingSample
        hs = NipptHybSeqSample.objects.filter(id=sample.source_hybseq_sample_id).first()
        if hs and hs.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=hs.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(
                    str(hs.source_pooling_sample_id), ""
                )
        return ""

    def _get_sample_type(self, sample):
        if not sample or not sample.case_sample_ids:
            return ""
        cs = CaseSample.objects.filter(id=sample.case_sample_ids[0]).first()
        if cs:
            return cs.get_sample_source_display() or cs.sample_source
        return ""


class NipptBioinfoSampleSerializer(serializers.ModelSerializer):
    case_number = serializers.CharField(source="case.case_number", read_only=True)
    pt_number = serializers.CharField(source="case.pt_number", read_only=True)
    test_sample_id = serializers.SerializerMethodField()
    index = serializers.SerializerMethodField()
    sample_type = serializers.SerializerMethodField()
    qc_flag_display = serializers.CharField(source="get_qc_flag_display", read_only=True)

    class Meta:
        model = NipptBioinfoSample
        fields = [
            "id", "batch", "case", "patient_name", "role", "category",
            "case_sample_ids", "source_hybseq_sample_id",
            "test_sample_id", "index", "sample_type",
            "case_number", "pt_number",
            "qc_flag", "qc_flag_display", "layers", "concentration", "het_ratio", "y_ratio",
            "qc_status", "qc_note",
        ]

    def get_test_sample_id(self, obj):
        if obj.case_sample_ids:
            cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
            if cs:
                return cs.test_sample_id
        return None

    def get_index(self, obj):
        if not obj.source_hybseq_sample_id:
            return ""
        from .models import NipptHybSeqSample, NipptPoolingSample
        hs = NipptHybSeqSample.objects.filter(id=obj.source_hybseq_sample_id).first()
        if hs and hs.source_pooling_sample_id:
            ps = NipptPoolingSample.objects.filter(id=hs.source_pooling_sample_id).first()
            if ps and ps.batch.pooling_data:
                return ps.batch.pooling_data.get("indexes", {}).get(
                    str(hs.source_pooling_sample_id), ""
                )
        return ""

    def get_sample_type(self, obj):
        if not obj.case_sample_ids:
            return ""
        cs = CaseSample.objects.filter(id=obj.case_sample_ids[0]).first()
        if cs:
            return cs.get_sample_source_display() or cs.sample_source
        return ""


class NipptBioinfoBatchListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    pair_count = serializers.SerializerMethodField()
    completed_pair_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()

    class Meta:
        model = NipptBioinfoBatch
        fields = [
            "id", "batch_number", "status", "status_display",
            "pair_count", "completed_pair_count", "sample_count",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_pair_count(self, obj):
        return obj.pairs.count() if hasattr(obj, 'pairs') else 0

    def get_completed_pair_count(self, obj):
        return obj.pairs.exclude(result="").count() if hasattr(obj, 'pairs') else 0

    def get_sample_count(self, obj):
        return obj.samples.count() if hasattr(obj, 'samples') else 0


class NipptBioinfoBatchDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    pair_count = serializers.SerializerMethodField()
    sample_count = serializers.SerializerMethodField()
    pairs = NipptBioinfoPairSerializer(many=True, read_only=True)
    unpaired_mothers = serializers.SerializerMethodField()
    unpaired_fathers = serializers.SerializerMethodField()

    class Meta:
        model = NipptBioinfoBatch
        fields = [
            "id", "batch_number", "status", "status_display",
            "bioinfo_data", "pair_count", "sample_count",
            "pairs", "unpaired_mothers", "unpaired_fathers",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "batch_number", "created_at", "updated_at"]

    def get_pair_count(self, obj):
        return obj.pairs.count() if hasattr(obj, 'pairs') else 0

    def get_sample_count(self, obj):
        return obj.samples.count() if hasattr(obj, 'samples') else 0

    def get_unpaired_mothers(self, obj):
        if not hasattr(obj, 'pairs'):
            return []
        paired_ids = set(obj.pairs.values_list("mother_sample_id", flat=True))
        unpaired = obj.samples.filter(role="MOTHER").exclude(id__in=paired_ids)
        return NipptBioinfoSampleSerializer(unpaired, many=True).data

    def get_unpaired_fathers(self, obj):
        if not hasattr(obj, 'pairs'):
            return []
        paired_ids = set(obj.pairs.values_list("father_sample_id", flat=True))
        unpaired = obj.samples.exclude(role="MOTHER").exclude(id__in=paired_ids)
        return NipptBioinfoSampleSerializer(unpaired, many=True).data


class NipptBioinfoBatchCreateSerializer(serializers.ModelSerializer):
    hybseq_batch_id = serializers.UUIDField(write_only=True, required=False)

    class Meta:
        model = NipptBioinfoBatch
        fields = ["id", "batch_number", "hybseq_batch_id"]
        read_only_fields = ["id", "batch_number"]

    def create(self, validated_data):
        request = self.context["request"]
        hybseq_batch_id = validated_data.pop("hybseq_batch_id", None)

        # Collect already-used HybSeq batch IDs
        used_ids = set()
        for bb in NipptBioinfoBatch.objects.all():
            bid = (bb.bioinfo_data or {}).get("source_hybseq_batch_id")
            if bid:
                used_ids.add(bid)

        if hybseq_batch_id:
            if hybseq_batch_id in used_ids:
                raise serializers.ValidationError({"hybseq_batch_id": "This HybSeq batch has already been used"})
            primary_hs = NipptHybSeqBatch.objects.get(id=hybseq_batch_id, status="COMPLETED")
        else:
            primary_hs = NipptHybSeqBatch.objects.filter(
                status="COMPLETED"
            ).exclude(id__in=used_ids).order_by("-created_at").first()
            if not primary_hs:
                raise serializers.ValidationError({"hybseq_batch_id": "No completed HybSeq batch found"})

        with transaction.atomic():
            batch_number = NipptBioinfoBatch.generate_batch_number()
            batch = NipptBioinfoBatch.objects.create(
                batch_number=batch_number, status="DRAFT", created_by=request.user,
            )

            hs_samples = NipptHybSeqSample.objects.filter(
                batch=primary_hs, qc_status="PASS"
            ).select_related("case")

            created_sample_map = {}
            case_samples_map = {}

            for hs in hs_samples:
                bs = NipptBioinfoSample.objects.create(
                    batch=batch, case=hs.case,
                    patient_name=hs.patient_name, role=hs.role,
                    category=hs.category,
                    case_sample_ids=hs.case_sample_ids,
                    source_hybseq_sample_id=str(hs.id),
                )
                created_sample_map[str(hs.id)] = bs
                role_key = "MOTHER" if hs.role == "MOTHER" else "FATHER"
                case_samples_map.setdefault(hs.case_id, {"MOTHER": [], "FATHER": []})
                case_samples_map[hs.case_id][role_key].append(bs)

            cross_batch_count = 0

            # Phase 1: within-batch pairing
            for case_id, groups in case_samples_map.items():
                mothers = groups["MOTHER"]
                fathers = groups["FATHER"]
                for mother in mothers:
                    for idx, father in enumerate(fathers):
                        label = "H" if len(fathers) == 1 else f"H{chr(65 + idx)}"
                        NipptBioinfoPair.objects.create(
                            batch=batch, case_id=case_id,
                            mother_sample=mother, father_sample=father,
                            father_label=label,
                            is_cross_batch=False,
                            mother_source_batch=primary_hs.batch_number,
                            father_source_batch=primary_hs.batch_number,
                        )

            # Phase 2: cross-batch supplement
            for case_id, groups in case_samples_map.items():
                has_mother = len(groups["MOTHER"]) > 0
                has_father = len(groups["FATHER"]) > 0

                if has_mother and has_father:
                    continue

                case = Case.objects.get(id=case_id)
                all_cs = case.case_samples.filter(
                    workflow_stage__in=["HYB_SEQ", "BIOINFO", "REPORT_DRAFT", "COMPLETED"],
                    is_active=True,
                ).select_related("sample")

                if not has_mother:
                    for cs in all_cs.filter(role="MOTHER"):
                        hss = NipptHybSeqSample.objects.filter(
                            case_sample_ids__contains=[str(cs.id)],
                            batch__status="COMPLETED", qc_status="PASS",
                        ).select_related("batch").first()
                        if hss and str(hss.id) not in created_sample_map:
                            bs = NipptBioinfoSample.objects.create(
                                batch=batch, case=case,
                                patient_name=hss.patient_name, role="MOTHER",
                                category=hss.category,
                                case_sample_ids=hss.case_sample_ids,
                                source_hybseq_sample_id=str(hss.id),
                            )
                            created_sample_map[str(hss.id)] = bs
                            groups["MOTHER"].append(bs)

                if not has_father:
                    existing_names = {f.patient_name for f in groups["FATHER"]}
                    for cs in all_cs.filter(role="ALLEGED_FATHER"):
                        if cs.sample.patient_name in existing_names:
                            continue
                        hss = NipptHybSeqSample.objects.filter(
                            case_sample_ids__contains=[str(cs.id)],
                            batch__status="COMPLETED", qc_status="PASS",
                        ).select_related("batch").first()
                        if hss and str(hss.id) not in created_sample_map:
                            bs = NipptBioinfoSample.objects.create(
                                batch=batch, case=case,
                                patient_name=hss.patient_name, role="ALLEGED_FATHER",
                                category=hss.category,
                                case_sample_ids=hss.case_sample_ids,
                                source_hybseq_sample_id=str(hss.id),
                            )
                            created_sample_map[str(hss.id)] = bs
                            groups["FATHER"].append(bs)

                # Cross-batch pairing
                for mother in groups["MOTHER"]:
                    for idx, father in enumerate(groups["FATHER"]):
                        label = "H" if len(groups["FATHER"]) == 1 else f"H{chr(65 + idx)}"
                        if NipptBioinfoPair.objects.filter(
                            batch=batch, mother_sample=mother, father_sample=father,
                        ).exists():
                            continue
                        m_hs = NipptHybSeqSample.objects.filter(
                            id=mother.source_hybseq_sample_id
                        ).first()
                        f_hs = NipptHybSeqSample.objects.filter(
                            id=father.source_hybseq_sample_id
                        ).first()
                        is_cross = (
                            (m_hs and str(m_hs.batch_id) != str(primary_hs.id)) or
                            (f_hs and str(f_hs.batch_id) != str(primary_hs.id))
                        )
                        NipptBioinfoPair.objects.create(
                            batch=batch, case_id=case_id,
                            mother_sample=mother, father_sample=father,
                            father_label=label,
                            is_cross_batch=is_cross,
                            mother_source_batch=m_hs.batch.batch_number if m_hs else "",
                            father_source_batch=f_hs.batch.batch_number if f_hs else "",
                        )
                        if is_cross:
                            cross_batch_count += 1

            batch.bioinfo_data = {
                "source_hybseq_batch_id": str(primary_hs.id),
                "source_hybseq_batch_number": primary_hs.batch_number,
                "auto_paired": True,
                "cross_batch_count": cross_batch_count,
            }
            batch.save(update_fields=["bioinfo_data"])

        return batch


class WorkflowLogSerializer(serializers.ModelSerializer):
    operator_name = serializers.SerializerMethodField()
    class Meta:
        model = WorkflowLog
        fields = ["id", "stage", "action", "batch_number", "note", "created_at", "operator_name"]
    def get_operator_name(self, obj):
        return obj.operator.username if obj.operator else ""
