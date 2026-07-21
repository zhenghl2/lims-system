"""Cases models — NIPPT case grouping."""
import uuid
import secrets
from django.db import models
from django.conf import settings
from django.utils import timezone


class Case(models.Model):
    """A case groups mother + alleged father(s) samples for NIPPT."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        REGISTERED = "REGISTERED", "Registered"
        RECEIVING = "RECEIVING", "Receiving"
        IN_PROCESS = "IN_PROCESS", "In Process"
        COMPLETED = "COMPLETED", "Completed"
        REPORTED = "REPORTED", "Reported"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case_number = models.CharField(max_length=30, unique=True, db_index=True)
    pt_number = models.CharField(
        max_length=20, unique=True, null=True, blank=True, db_index=True,
        help_text="Auto-assigned PT sequential number, e.g. PT00123"
    )
    panel = models.ForeignKey(
        "samples.TestPanel", on_delete=models.PROTECT, related_name="cases"
    )
    status = models.CharField(
        max_length=20,
        default=Status.DRAFT,
        choices=Status.choices,
        db_index=True,
    )

    # Case-level metadata
    gestational_age_weeks = models.PositiveIntegerField(null=True, blank=True)
    gestational_age_days = models.PositiveIntegerField(null=True, blank=True)
    clinic_name = models.CharField(max_length=200, blank=True)
    clinic_contact = models.CharField(max_length=100, blank=True)
    sales_person = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    is_urgent = models.BooleanField(default=False)
    expected_completion = models.DateField(null=True, blank=True)

    # Registration metadata
    multiple_gestation = models.BooleanField(default=False, help_text="单双胎: False=单胎, True=双胎")
    applicant = models.CharField(max_length=200, blank=True, default="", help_text="申请方")
    phone = models.CharField(max_length=30, blank=True, default="", help_text="联系电话")
    email = models.EmailField(max_length=200, blank=True, default="", help_text="邮箱")
    risk_warnings = models.JSONField(default=list, blank=True, help_text="影响结果的风险提示")
    registration_type = models.CharField(max_length=20, default="FIRST", choices=[("FIRST","首次检测"),("SUPPLEMENT","补充样本"),("RESAMPLE","重采样本")])

    # Public registration token
    registration_token = models.CharField(
        max_length=64, unique=True, null=True, blank=True, db_index=True
    )
    registration_token_expires = models.DateTimeField(null=True, blank=True)

    site = models.ForeignKey(
        "organizations.Site", on_delete=models.PROTECT, related_name="cases",
        null=True, blank=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cases"
        ordering = ["-created_at"]

    def __str__(self):
        return self.case_number

    PT_PREFIX = "PT"

    def generate_token(self):
        """Generate a one-time registration token (72h expiry)."""
        self.registration_token = secrets.token_urlsafe(32)
        self.registration_token_expires = timezone.now() + timezone.timedelta(hours=72)
        return self.registration_token

    def assign_pt_number(self):
        """Assign the next PT sequential number (global, date-independent)."""
        last = Case.objects.exclude(pt_number=None).order_by("-pt_number").first()
        if last and last.pt_number and last.pt_number.startswith(self.PT_PREFIX):
            try:
                num = int(last.pt_number[2:]) + 1
            except ValueError:
                num = Case.objects.count()
        else:
            num = Case.objects.count() or 1
        self.pt_number = f"{self.PT_PREFIX}{num:05d}"
        return self.pt_number

    def generate_test_sample_id(self, case_sample, resample_num=None):
        """Generate a PT test sample ID for a CaseSample."""
        if not self.pt_number:
            self.assign_pt_number()
        base = self.pt_number
        if case_sample.role == "MOTHER":
            suffix = "M"
        elif case_sample.role == "ALLEGED_FATHER":
            existing = self.case_samples.filter(
                role="ALLEGED_FATHER"
            ).exclude(id=case_sample.id).count()
            suffix = f"F{chr(97 + existing)}"  # a, b, c ...
        else:
            suffix = "U"
        tid = f"{base}{suffix}"
        if resample_num:
            tid += f"R{resample_num}"
        return tid

    @property
    def mother_sample(self):
        return self.case_samples.filter(role=CaseSample.Role.MOTHER).first()

    @property
    def father_samples(self):
        return self.case_samples.exclude(role=CaseSample.Role.MOTHER)

    @property
    def all_samples_received(self):
        samples = self.case_samples.exclude(sample__status="REJECTED")
        if not samples.exists():
            return False
        return all(s.received_at is not None for s in samples)


class CaseSample(models.Model):
    """Association between a Case and a Sample with NIPPT-specific metadata."""

    class Role(models.TextChoices):
        MOTHER = "MOTHER", "Mother"
        ALLEGED_FATHER = "ALLEGED_FATHER", "Alleged Father"

    class SampleSource(models.TextChoices):
        PERIPHERAL_BLOOD = "BLOOD", "Peripheral Blood"
        BUCCAL_SWAB = "SWAB", "Buccal Swab"
        HAIR_FOLLICLE = "HAIR", "Hair Follicle"
        DRIED_BLOOD_SPOT = "DBS", "Dried Blood Spot"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="case_samples")
    sample = models.OneToOneField(
        "samples.Sample", on_delete=models.CASCADE, related_name="case_sample"
    )
    role = models.CharField(max_length=20, choices=Role.choices, db_index=True)
    sample_source = models.CharField(
        max_length=10, choices=SampleSource.choices, default=SampleSource.PERIPHERAL_BLOOD
    )
    ethnicity = models.CharField(max_length=50, blank=True)
    relationship_to_mother = models.CharField(max_length=50, blank=True)

    # Receipt tracking
    receipt_photo = models.ImageField(upload_to="cases/receipts/", null=True, blank=True)
    receipt_condition = models.CharField(max_length=30, blank=True)  # OK/HEMOLYZED/LOW_VOLUME/BROKEN
    received_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+"
    )

    # Collection info (may differ per sample in a case)
    collection_site = models.CharField(max_length=100, blank=True)
    collection_notes = models.TextField(blank=True)

    # Arrival tracking
    arrival_date = models.DateField(null=True, blank=True, help_text="到样日期")

    # Dual-ID system
    test_sample_id = models.CharField(
        max_length=40, unique=True, null=True, blank=True, db_index=True,
        help_text="PT test sample ID, e.g. PT00123M, PT00123Fa"
    )
    resample_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="resamples",
        help_text="Points to original CaseSample if this is a resample"
    )
    resample_number = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Resample sequence number: 1, 2, ..."
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "case_samples"
        unique_together = [["case", "sample"]]
        ordering = ["role", "created_at"]

    def __str__(self):
        return f"{self.case.case_number} - {self.get_role_display()} ({self.sample.sample_id})"

    def confirm_receipt(self, user, condition="OK", photo=None):
        """Mark sample as received."""
        self.receipt_condition = condition
        self.received_at = timezone.now()
        self.received_by = user
        if photo:
            self.receipt_photo = photo
        self.save(update_fields=[
            "receipt_condition", "received_at", "received_by",
            "receipt_photo", "updated_at",
        ])
