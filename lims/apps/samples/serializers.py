"""Sample serializers."""
import datetime
from rest_framework import serializers
from .models import Sample, SamplePhoto, SampleType, TestPanel, SampleMovement, SampleAliquot


class SampleTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SampleType
        fields = ["id", "code", "name", "collection_tube", "storage_temp", "retention_days", "is_active"]


class TestPanelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestPanel
        fields = ["id", "code", "name", "description", "turnaround_days", "report_template_code", "is_active"]


class SampleSerializer(serializers.ModelSerializer):
    """Detailed sample serializer."""
    sample_type = SampleTypeSerializer(read_only=True)
    sample_type_id = serializers.UUIDField(write_only=True)
    site_id = serializers.SerializerMethodField()
    movements_count = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Sample
        fields = [
            "id", "sample_id", "additional_barcodes", "sample_type", "sample_type_id",
            "patient_id", "patient_name", "patient_dob", "patient_sex",
            "vg_id",
            "ordering_physician", "ordering_facility",
            "age", "source_institution", "institution_sample_id",
            "hpv_sample_type", "test_item",
            "collection_date", "collection_time",
            "receipt_date", "receipt_time", "receipt_temp",
            "received_by", "received_by_name",
            "transport_time_days",
            "status", "rejection_reason", "rejection_note",
            "consent_given", "consent_date",
            "site", "site_id", "created_by", "created_at", "updated_at", "is_deleted",
            "image",
            "movements_count",
        ]
        read_only_fields = ["sample_id", "image", "transport_time_days", "status", "site", "created_by", "movements_count"]

    def get_site_id(self, obj):
        return str(obj.site_id) if obj.site else None

    def get_movements_count(self, obj):
        return obj.movements.count()

    def get_received_by_name(self, obj):
        if obj.received_by:
            return obj.received_by.name
        return None

    def create(self, validated_data):
        user = self.context["request"].user
        validated_data["created_by"] = user
        user_site = getattr(user, 'site', None)
        validated_data["site"] = user_site if user_site else self._get_default_site()
        if not validated_data.get("sample_id"):
            validated_data["sample_id"] = self._generate_sample_id()
        return super().create(validated_data)

    def _generate_barcode(self):
        today = datetime.date.today().strftime("%Y%m%d")
        count = Sample.objects.filter(sample_id__startswith=f"SMP-{today}").count() + 1
        return f"SMP-{today}-{count:04d}"

    def _get_default_site(self):
        """Get first available site for users without site assignment (e.g. super admins)."""
        from lims.apps.organizations.models import Site
        return Site.objects.filter(is_active=True).first()


class SampleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    sample_type_code = serializers.CharField(source="sample_type.code", read_only=True)
    panel_info = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    patient_name = serializers.CharField(read_only=True)
    ordering_physician = serializers.CharField(read_only=True)
    ordering_facility = serializers.CharField(read_only=True)

    def get_received_by_name(self, obj):
        if obj.received_by:
            return obj.received_by.name
        return None

    class Meta:
        model = Sample
        fields = "__all__"

    def get_panel_info(self, obj):
        if obj.panel_id:
            return obj.panel.code if obj.panel else None
        return None


class SampleReceiveSerializer(serializers.ModelSerializer):
    """Serializer for sample receipt (create + auto-barcode)."""
    sample_type_id = serializers.UUIDField(write_only=True, required=False)
    sample_type_code = serializers.CharField(write_only=True, required=False)
    panel_id = serializers.UUIDField(write_only=True, required=False)
    panel_code = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = Sample
        fields = [
            "sample_type_id", "sample_type_code", "panel_id", "panel_code",
            "patient_id", "patient_name", "patient_dob", "patient_sex",
            "vg_id",
            "age", "gestational_weeks", "test_option",
            "id_card", "external_id", "vg_id",
            "maternal_weight", "maternal_bmi", "ivf_status", "multiple_gestation",
            "fetal_fraction", "clinical_diagnosis",
            "source_institution", "institution_sample_id",
            "hpv_sample_type", "test_item",
            "ordering_physician", "ordering_facility",
            "collection_date", "collection_time", "receipt_temp", "consent_given",
            "receipt_date", "receipt_time",
            "acceptance_date",
        ]
        extra_kwargs = {
            "collection_date": {"required": False},
            "acceptance_date": {"required": False, "allow_null": True},
            "collection_time": {"required": False, "allow_null": True},
            "receipt_date": {"required": False},
            "receipt_time": {"required": False},
            "patient_dob": {"required": False, "allow_null": True},
            "patient_sex": {"required": False, "allow_blank": True},
            "age": {"required": False, "allow_null": True},
            "source_institution": {"required": False, "allow_blank": True},
            "institution_sample_id": {"required": False, "allow_blank": True},
            "hpv_sample_type": {"required": False, "allow_blank": True},
            "test_item": {"required": False, "allow_blank": True},
            "ordering_physician": {"required": False, "allow_blank": True},
            "ordering_facility": {"required": False, "allow_blank": True},
            "receipt_temp": {"required": False, "allow_blank": True},
            "consent_given": {"required": False, "allow_null": True},
        }

    def create(self, validated_data):
        user = self.context["request"].user
        now = datetime.datetime.now()

        # Pop write-only fields
        sample_type_id = validated_data.pop("sample_type_id", None)
        panel_id = validated_data.pop("panel_id", None)
        panel_code = validated_data.pop("panel_code", None)
        # Resolve panel_code to panel_id
        from .models import TestPanel
        if panel_code and not panel_id:
            try:
                panel_obj = TestPanel.objects.get(code=panel_code, is_active=True)
                panel_id = panel_obj.id
            except Exception:
                pass

        # Set receipt date/time defaults if not provided
        if "receipt_date" not in validated_data or validated_data.get("receipt_date") is None:
            validated_data["receipt_date"] = now.date()
        if "receipt_time" not in validated_data or validated_data.get("receipt_time") is None:
            validated_data["receipt_time"] = now.time()

        # Set collection date/time defaults if not provided
        if "collection_date" not in validated_data or validated_data.get("collection_date") is None:
            validated_data["collection_date"] = now.date()
        if "collection_time" not in validated_data or validated_data.get("collection_time") is None:
            validated_data["collection_time"] = now.time()

        # Auto-generate patient_id from panel prefix if blank
        if not validated_data.get("patient_id") and panel_id:
            try:
                panel = TestPanel.objects.get(id=panel_id)
                prefix = panel.code
                count = Sample.objects.filter(patient_id__startswith=prefix).count() + 1
                validated_data["patient_id"] = f"{prefix}{count:04d}"
            except TestPanel.DoesNotExist:
                pass

        # Auto-generate sample_id
        validated_data["sample_id"] = self._generate_barcode()

        # Set site from user
        user_site = getattr(user, 'site', None)
        validated_data["site"] = user_site if user_site else self._get_default_site()
        validated_data["created_by"] = user

        # Auto-assign default sample type if not provided
        if not sample_type_id:
            from .models import SampleType
            # Resolve sample_type_code if provided (popped from validated_data)
            st_code = validated_data.pop("sample_type_code", None) if "sample_type_code" in validated_data else None
            if st_code:
                try:
                    default_st = SampleType.objects.get(code=st_code, is_active=True)
                    sample_type_id = default_st.id
                except SampleType.DoesNotExist:
                    pass
            # Fallback to BLOOD, then first available
            if not sample_type_id:
                default_st = SampleType.objects.filter(code="BLOOD", is_active=True).first()
                if not default_st:
                    default_st = SampleType.objects.filter(is_active=True).first()
                if default_st:
                    sample_type_id = default_st.id
        # Create sample with sample_type_id passed directly to the FK
        if panel_id:
            validated_data["panel_id"] = panel_id
        return Sample.objects.create(sample_type_id=sample_type_id, **validated_data)

    def _generate_barcode(self):
        today = datetime.date.today().strftime("%Y%m%d")
        count = Sample.objects.filter(sample_id__startswith=f"SMP-{today}").count() + 1
        return f"SMP-{today}-{count:04d}"

    def _get_default_site(self):
        from lims.apps.organizations.models import Site
        return Site.objects.filter(is_active=True).first()


class SampleRejectSerializer(serializers.Serializer):
    """Reject a sample with reason."""
    rejection_reason = serializers.CharField(max_length=100)
    rejection_note = serializers.CharField(required=False, allow_blank=True)
    rejection_handling = serializers.CharField(required=False, allow_blank=True)
    rejection_communication = serializers.CharField(required=False, allow_blank=True)


class SampleMovementSerializer(serializers.ModelSerializer):
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SampleMovement
        fields = ["id", "from_location", "to_location", "reason", "performed_by_name", "performed_at", "notes"]
        read_only_fields = ["performed_by", "performed_at"]

    def get_performed_by_name(self, obj):
        return f"{obj.performed_by.first_name} {obj.performed_by.last_name}" if obj.performed_by else None

    def create(self, validated_data):
        validated_data["performed_by"] = self.context["request"].user
        return super().create(validated_data)


class SampleAliquotSerializer(serializers.ModelSerializer):
    class Meta:
        model = SampleAliquot
        fields = ["id", "parent_sample", "child_sample", "aliquot_type", "volume_ml", "sample_id", "created_at"]
        read_only_fields = ["created_at"]

class SamplePhotoSerializer(serializers.ModelSerializer):
    """Serializer for receiving photos with sample links."""
    uploaded_by_name = serializers.CharField(source="uploaded_by.username", read_only=True)
    sample_ids = serializers.CharField(write_only=True, required=False, allow_blank=True,
        help_text="JSON array of sample IDs to associate this photo with (e.g. '[1,2,3]')")

    class Meta:
        model = SamplePhoto
        fields = [
            "id", "image", "uploaded_by", "uploaded_by_name",
            "created_at", "notes", "sample_ids",
        ]
        read_only_fields = ["id", "uploaded_by", "uploaded_by_name", "created_at"]

    def create(self, validated_data):
        sample_ids_raw = validated_data.pop("sample_ids", "")
        validated_data["uploaded_by"] = self.context["request"].user
        photo = super().create(validated_data)
        # Parse sample_ids from JSON string or list
        if sample_ids_raw:
            try:
                import json as _json
                ids = _json.loads(sample_ids_raw) if isinstance(sample_ids_raw, str) else sample_ids_raw
                if ids:
                    from .models import Sample
                    samples = Sample.objects.filter(id__in=ids)
                    photo.samples.set(samples)
            except Exception:
                pass  # Ignore parse errors
        return photo

class SamplePhotoListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing photos."""
    uploaded_by_name = serializers.CharField(source="uploaded_by.username", read_only=True)
    sample_count = serializers.SerializerMethodField()

    class Meta:
        model = SamplePhoto
        fields = ["id", "image", "uploaded_by_name", "created_at", "notes", "sample_count"]

    def get_sample_count(self, obj):
        return obj.samples.count()

