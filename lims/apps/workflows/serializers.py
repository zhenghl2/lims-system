"""Workflow serializers."""
from rest_framework import serializers
from .models import WorkflowProtocol, SampleRun, RunSample, WorkflowStep


class WorkflowProtocolSerializer(serializers.ModelSerializer):
    panel_code = serializers.CharField(source="panel.code", read_only=True)
    panel_name = serializers.CharField(source="panel.name", read_only=True)
    step_count = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowProtocol
        fields = [
            "id", "panel", "panel_code", "panel_name", "name", "version",
            "description", "estimated_hours", "is_active", "steps_definition",
            "step_count", "validated_at", "validated_by", "created_by", "created_by_name",
            "created_at", "updated_at",
        ]
        read_only_fields = ["validated_at", "validated_by", "created_by", "created_by_name", "created_at", "updated_at"]

    def get_step_count(self, obj):
        steps = obj.steps_definition
        return len(steps) if isinstance(steps, list) else 0

    def get_created_by_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip() or obj.created_by.username
        return None


class WorkflowProtocolDetailSerializer(WorkflowProtocolSerializer):
    """Add parsed steps for detailed view."""
    run_count = serializers.SerializerMethodField()

    def get_run_count(self, obj):
        return obj.runs.count()


class RunSampleSerializer(serializers.ModelSerializer):
    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True)
    sample_vg_id = serializers.CharField(source="sample.vg_id", read_only=True, default="")
    sample_patient_id = serializers.CharField(source="sample.patient_id", read_only=True, default="")

    class Meta:
        model = RunSample
        fields = [
            "id", "run", "sample", "sample_barcode", "sample_vg_id", "sample_patient_id",
            "well_position", "plate_number", "index_sequence", "index_combo_id",
            "pool_group", "barcode", "status", "result_summary", "created_at",
        ]
        read_only_fields = ["created_at"]


class SampleRunSerializer(serializers.ModelSerializer):
    panel_code = serializers.CharField(source="panel.code", read_only=True)
    panel_name = serializers.CharField(source="panel.name", read_only=True)
    sequencer_name = serializers.CharField(source="sequencer.name", read_only=True)
    protocol_name = serializers.CharField(source="protocol.name", read_only=True, default=None)
    sample_count = serializers.SerializerMethodField()
    operator_name = serializers.SerializerMethodField()

    class Meta:
        model = SampleRun
        fields = [
            "id", "run_number", "barcode", "panel", "panel_code", "panel_name",
            "protocol", "protocol_name", "sequencer", "sequencer_name", "status",
            "planned_date", "start_date", "end_date",
            "operator", "operator_name", "notes",
            "sample_count", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_sample_count(self, obj):
        return obj.run_samples.count()

    def get_operator_name(self, obj):
        if obj.operator:
            return f"{obj.operator.first_name} {obj.operator.last_name}"
        return None


class SampleRunCreateSerializer(serializers.Serializer):
    """Create a new run and assign samples."""
    panel = serializers.UUIDField(required=False)
    panel_code = serializers.CharField(required=False)
    protocol = serializers.UUIDField(required=False)
    sequencer = serializers.UUIDField(required=False)
    samples = serializers.ListField(child=serializers.UUIDField())
    planned_date = serializers.DateField(required=False)
    sample_assignments = serializers.DictField(required=False)
    # e.g. {"uuid-1": {"well_position": "A01", "index_sequence": "N701+S501", "pool_group": "Pool-A"}}
    notes = serializers.CharField(required=False)


class SampleRunDetailSerializer(SampleRunSerializer):
    """Nested data for detailed view."""
    run_samples = RunSampleSerializer(many=True, read_only=True)
    steps = serializers.SerializerMethodField()

    class Meta(SampleRunSerializer.Meta):
        fields = SampleRunSerializer.Meta.fields + ["run_samples", "steps"]

    def get_steps(self, obj):
        return WorkflowStepSerializer(obj.steps.all(), many=True).data


class WorkflowStepSerializer(serializers.ModelSerializer):
    sample_barcode = serializers.CharField(source="sample.sample_id", read_only=True, default=None)
    performed_by_name = serializers.SerializerMethodField()
    instrument_name = serializers.SerializerMethodField()
    qc_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowStep
        fields = [
            "id", "run", "sample", "sample_barcode",
            "step_id", "step_name", "step_order", "status",
            "started_at", "completed_at", "performed_by", "performed_by_name",
            "reagents_used", "instrument", "instrument_name", "observations",
            "deviation_flag", "deviation_note",
            "step_data", "qc_status", "qc_by", "qc_by_name", "qc_at",
            "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_performed_by_name(self, obj):
        if obj.performed_by:
            return f"{obj.performed_by.first_name} {obj.performed_by.last_name}".strip() or obj.performed_by.username
        return None

    def get_instrument_name(self, obj):
        return obj.instrument.name if obj.instrument else None

    def get_qc_by_name(self, obj):
        if obj.qc_by:
            return f"{obj.qc_by.first_name} {obj.qc_by.last_name}".strip() or obj.qc_by.username
        return None


class WorkflowStepUpdateSerializer(serializers.Serializer):
    """Update a step's status and results."""
    status = serializers.ChoiceField(choices=["IN_PROGRESS", "COMPLETED", "SKIPPED", "FAILED"])
    observations = serializers.CharField(required=False, allow_blank=True)
    reagent_lot_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list,
    )
    instrument_id = serializers.UUIDField(required=False)


class AddSamplesToRunSerializer(serializers.Serializer):
    """Add samples to an existing run."""
    samples = serializers.ListField(child=serializers.UUIDField())
    assignments = serializers.ListField(child=serializers.DictField(), required=False)
