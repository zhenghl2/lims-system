"""Case serializers — NIPPT."""
from rest_framework import serializers
from django.utils import timezone
import datetime
from .models import Case, CaseSample


class CaseSampleSerializer(serializers.ModelSerializer):
    sample_id = serializers.CharField(source="sample.sample_id", read_only=True)
    patient_name = serializers.CharField(source="sample.patient_name", read_only=True)
    sample_status = serializers.CharField(source="sample.status", read_only=True)
    rejection_reason = serializers.CharField(source="sample.rejection_reason", read_only=True)
    rejection_note = serializers.CharField(source="sample.rejection_note", read_only=True)
    receipt_photo_url = serializers.SerializerMethodField()
    external_id = serializers.CharField(source="sample.external_id", read_only=True)

    class Meta:
        model = CaseSample
        fields = [
            "id", "case", "sample", "sample_id", "patient_name", "sample_status",
            "role", "sample_source", "ethnicity", "relationship_to_mother",
            "receipt_condition", "received_at", "received_by",
            "collection_site", "collection_notes",
            "test_sample_id", "resample_of", "resample_number",
            "arrival_date",
            "rejection_reason", "rejection_note", "external_id",
            "receipt_photo_url",
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
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mother_name = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Case
        fields = [
            "id", "case_number", "pt_number", "panel_code", "panel_name",
            "status", "status_display", "is_urgent",
            "sample_count", "received_count", "mother_name", "progress",
            "gestational_age_weeks", "gestational_age_days",
            "clinic_name", "sales_person",
            "applicant", "registration_type",
            "expected_completion", "created_at",
        ]

    def get_mother_name(self, obj):
        ms = obj.case_samples.filter(role="MOTHER").select_related("sample").first()
        if ms and ms.sample:
            return ms.sample.patient_name or ms.sample.sample_id
        return ""

    def get_progress(self, obj):
        STATUS_WEIGHT = {
            "REGISTERED": 5, "RECEIVED": 15, "IN_PROCESS": 30,
            "TESTING": 50, "ANALYZING": 70, "COMPLETED": 90,
            "REPORTED": 100, "ARCHIVED": 100, "DISPOSED": 100,
        }
        css = obj.case_samples.select_related("sample").all()
        total_weight = 0
        count = 0
        for cs in css:
            s_status = cs.sample.status
            if s_status == "REJECTED":
                continue
            total_weight += STATUS_WEIGHT.get(s_status, 0)
            count += 1
        if count == 0:
            return 0
        return round(total_weight / count, 1)

    def get_sample_count(self, obj):
        return obj.case_samples.count()

    def get_received_count(self, obj):
        return obj.case_samples.exclude(received_at=None).count()


class CaseDetailSerializer(serializers.ModelSerializer):
    panel_code = serializers.CharField(source="panel.code", read_only=True)
    panel_name = serializers.CharField(source="panel.name", read_only=True)
    case_samples = CaseSampleSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    mother_name = serializers.SerializerMethodField()
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
            "created_at", "updated_at", "mother_name",
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

    def get_progress(self, obj):
        STATUS_WEIGHT = {
            "REGISTERED": 5, "RECEIVED": 15, "IN_PROCESS": 30,
            "TESTING": 50, "ANALYZING": 70, "COMPLETED": 90,
            "REPORTED": 100, "ARCHIVED": 100, "DISPOSED": 100,
        }
        css = obj.case_samples.select_related("sample").all()
        total_weight = 0
        count = 0
        for cs in css:
            s_status = cs.sample.status
            if s_status == "REJECTED":
                continue
            total_weight += STATUS_WEIGHT.get(s_status, 0)
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
    father_sample_type = serializers.ChoiceField(
        choices=CaseSample.SampleSource.choices,
        default=CaseSample.SampleSource.PERIPHERAL_BLOOD,
        write_only=True,
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
            "father_sample_type",
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
        father_sample_type = validated_data.pop("father_sample_type", CaseSample.SampleSource.PERIPHERAL_BLOOD)
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
        case.assign_pt_number()
        case.save(update_fields=["pt_number"])

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
        mother_cs.test_sample_id = case.generate_test_sample_id(mother_cs)
        mother_cs.save(update_fields=["test_sample_id"])

        # Create father samples
        for i, name in enumerate(father_names, 1):
            father_sample = Sample.objects.create(
                sample_id=f"{case_number}-AF{i}",
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
            arrival = male_arrivals[i-1] if i-1 < len(male_arrivals) else None
            father_cs = CaseSample.objects.create(
                case=case, sample=father_sample,
                role=CaseSample.Role.ALLEGED_FATHER,
                sample_source=father_sample_type,
                arrival_date=arrival,
            )
            father_cs.test_sample_id = case.generate_test_sample_id(father_cs)
            father_cs.save(update_fields=["test_sample_id"])

        return case


class SupplementSerializer(serializers.Serializer):
    """补充样本：给已有 Case 添加新的 CaseSample (母亲或父亲)."""
    role = serializers.ChoiceField(choices=[("MOTHER", "Mother"), ("ALLEGED_FATHER", "Alleged Father")])
    patient_name = serializers.CharField(max_length=200)
    sample_source = serializers.ChoiceField(
        choices=CaseSample.SampleSource.choices,
        default=CaseSample.SampleSource.PERIPHERAL_BLOOD,
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
        sample_source_val = validated_data.get("sample_source", "BLOOD")
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

        sample = Sample.objects.create(
            sample_id=sample_id,
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

        cs = CaseSample.objects.create(
            case=case,
            sample=sample,
            role=role,
            sample_source=sample_source_val,
            arrival_date=arrival_date,
            ethnicity=ethnicity,
            relationship_to_mother=relationship,
        )
        cs.test_sample_id = case.generate_test_sample_id(cs)
        cs.save(update_fields=["test_sample_id"])

        return cs


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
