"""Cases models — NIPPT case grouping."""
import uuid
import secrets
from django.db import models
from django.conf import settings
from django.utils import timezone


WORKFLOW_ORDER = [
    "REGISTERED", "RECEIVED", "PRE_PROCESSING", "EXTRACTION",
    "LIBRARY_PREP", "POOLING", "HYB_SEQ", "BIOINFO",
    "REPORT_DRAFT", "COMPLETED"
]

class Case(models.Model):
    """A case groups mother + alleged father(s) samples for NIPPT."""

    class Status(models.TextChoices):
        REGISTERED = "REGISTERED", "已登记"
        RECEIVED = "RECEIVED", "已签收"
        PRE_PROCESSING = "PRE_PROCESSING", "前处理"
        EXTRACTION = "EXTRACTION", "提取中"
        LIBRARY_PREP = "LIBRARY_PREP", "建库中"
        POOLING = "POOLING", "Pooling"
        HYB_SEQ = "HYB_SEQ", "测序中"
        BIOINFO = "BIOINFO", "生信中"
        REPORT_DRAFT = "REPORT_DRAFT", "报告草稿"
        COMPLETED = "COMPLETED", "已完成"
        HAS_FAILURE = "HAS_FAILURE", "有失败"
        CANCELLED = "CANCELLED", "已取消"

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
        default=Status.REGISTERED,
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
    multiple_gestation = models.BooleanField(default=False, null=True, blank=True, help_text="单双胎: null=客户未填, False=单胎, True=双胎")
    collection_method = models.CharField(max_length=2, blank=True, default="3",
        choices=[("1", "本室采集"), ("2", "申请人送来"), ("3", "邮寄样本")],
        help_text="采集方式: 1=本室采集, 2=申请人送来, 3=邮寄样本")
    application_signed = models.CharField(max_length=10, blank=True, default="",
        choices=[("YES", "是"), ("NO", "否"), ("WECHAT", "微信授权")],
        help_text="申请单是否签字")
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
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    experiment_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cases"
        ordering = ["-created_at"]

    def __str__(self):
        return self.case_number

    def delete(self, *args, **kwargs):
        """删除 Case 时级联删除关联 Sample（否则父亲样本变孤儿，barcode 冲突）。"""
        for cs in self.case_samples.all():
            if cs.sample_id:
                cs.sample.delete()
        return super().delete(*args, **kwargs)

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

    @property
    def computed_status(self):
        """从 CaseSample 实时推导 Case 状态."""
        active = self.case_samples.filter(is_active=True)
        if not active.exists():
            active = self.case_samples.all()
        if not active.exists():
            return "REGISTERED"
        # 全部样本被拒收
        if all(cs.sample.status == "REJECTED" for cs in self.case_samples.all()):
            return "REJECTED"

        if active.filter(workflow_stage__endswith="_FAILED").exists():
            return "HAS_FAILURE"
        stages = [cs.workflow_stage for cs in active if cs.workflow_stage]
        if stages and all(s == "COMPLETED" for s in stages):
            return "COMPLETED"
        for stage in WORKFLOW_ORDER[:-1]:
            if any(s == stage for s in stages):
                return stage
        return "REGISTERED"

    def update_status(self):
        """同步 computed_status 到 DB status 字段."""
        new = self.computed_status
        if self.status != new:
            self.status = new
            self.save(update_fields=["status", "updated_at"])

    def generate_test_sample_id(self, case_sample, resample_num=None, redo_num=None):
        """Generate a PT test sample ID for a CaseSample.
        
        Suffix rules:
        - Mother: W, Father: H/HA/HB...
        - Resample: _R{n}, Redo: _T{n}
        - Combined: _R{n}_T{n}
        """
        if not self.pt_number:
            self.assign_pt_number()
        base = self.pt_number
        if case_sample.role == "MOTHER":
            suffix = "W"
        elif case_sample.role == "ALLEGED_FATHER":
            father_names = []
            for cs in self.case_samples.filter(
                role="ALLEGED_FATHER"
            ).order_by("created_at").select_related("sample"):
                name = cs.sample.patient_name
                if name not in father_names:
                    father_names.append(name)
            my_name = case_sample.sample.patient_name
            idx = father_names.index(my_name) if my_name in father_names else 0
            if len(father_names) == 1:
                suffix = "H"
            else:
                suffix = f"H{chr(65 + idx)}"
        else:
            suffix = "U"
        tid = f"{base}{suffix}"
        if resample_num:
            tid += f"_R{resample_num}"
        if redo_num:
            tid += f"_T{redo_num}"
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
        PERIPHERAL_BLOOD = "BLOOD",       "血液"
        DRIED_BLOOD      = "DBS",         "血痕"
        HAIR_FOLLICLE    = "HAIR",        "毛发"
        BUCCAL_SWAB      = "SWAB",        "口拭子"
        NAIL             = "NAIL",        "指甲"
        SEMEN            = "SEMEN",       "精液"
        TOOTHBRUSH       = "TOOTHBRUSH",  "牙刷"
        CIGARETTE_BUTT   = "CIGARETTE",   "烟头"
        WATER_BOTTLE     = "BOTTLE",      "水瓶"
        BEARD            = "BEARD",       "胡须"
        DENTAL_FLOSS     = "FLOSS",       "牙线"
        SEMEN_STAIN      = "SEMSTAIN",    "精斑"
        CHEWING_GUM      = "GUM",         "口香糖"

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
    received_by_name = models.CharField(max_length=50, blank=True, default="")

    # Collection info (may differ per sample in a case)
    collection_site = models.CharField(max_length=100, blank=True)
    collection_notes = models.TextField(blank=True)

    # Arrival tracking
    arrival_date = models.DateField(null=True, blank=True, help_text="到样日期")

    # Receiving metadata
    actual_sample_type = models.CharField(
        max_length=10, blank=True, default="",
        help_text="实际收到的样本类型（可能与登记不同）"
    )
    preservation_method = models.CharField(
        max_length=20, blank=True, default="",
        help_text="保温措施: 无/冰袋/暖宝宝"
    )

    # Dual-ID system
    test_sample_id = models.CharField(
        max_length=40, null=True, blank=True, db_index=True,
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
    redo_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="redos",
        help_text="Points to original CaseSample if this is a redo"
    )
    redo_count = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text="Redo sequence number: 1, 2, ..."
    )
    workflow_stage = models.CharField(max_length=30, default="REGISTERED", db_index=True)
    is_active = models.BooleanField(default=True)
    priority = models.IntegerField(default=0)

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
        self.workflow_stage = "RECEIVED"
        if photo:
            self.receipt_photo = photo
        self.save(update_fields=[
            "receipt_condition", "received_at", "received_by",
            "workflow_stage", "receipt_photo", "updated_at",
        ])


# ============================================================
# NIPPT Pre-Processing (前处理)
# ============================================================

class NipptPreProcessingBatch(models.Model):
    """NIPPT 前处理批次 — 签收后、实验前的样本处理"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(
        max_length=30, unique=True, db_index=True,
        help_text="Auto-generated: YYYYMMDD-HH-NNN"
    )
    status = models.CharField(
        max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True
    )
    processing_data = models.JSONField(default=dict, blank=True)
    pp_date = models.CharField(max_length=20, blank=True, default="")
    pp_time = models.CharField(max_length=10, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+"
    )
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    experiment_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_preprocessing_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        """Generate batch number: YYYYMMDD-HH-NNN"""
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptPreProcessingSample(models.Model):
    """前处理批次中的处理单元 — 按人分组（非按单个样本）"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        NipptPreProcessingBatch, on_delete=models.CASCADE, related_name="samples"
    )
    case = models.ForeignKey(
        Case, on_delete=models.CASCADE, related_name="preprocessing_samples"
    )
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)

    # CaseSample IDs included in this processing unit (JSON array of UUID strings)
    case_sample_ids = models.JSONField(default=list)

    # === Blood sample fields (FEMALE_BLOOD / MALE_BLOOD) ===
    sample_condition = models.CharField(max_length=20, blank=True, default="OK",
        help_text="样本情况: OK / HEMOLYZED / LOW_VOLUME / OTHER")
    aliquot_tubes = models.PositiveSmallIntegerField(default=3,
        help_text="分装管数: 女默认3, 男默认2")
    plasma_volume = models.FloatField(null=True, blank=True,
        help_text="血浆体积 (mL)")

    # === Male other sample fields (MALE_OTHER) ===
    experiment_sample_type = models.CharField(max_length=10, blank=True, default="",
        help_text="操作员选择的实验样本类型")
    remaining_override = models.JSONField(null=True, blank=True, default=None,
        help_text="Manually set remaining sample types (overrides computed)")
    elution_volume = models.FloatField(default=30, null=True, blank=True,
        help_text="洗脱体积 (uL)")
    dna_concentration = models.FloatField(null=True, blank=True,
        help_text="DNA浓度 (ng/uL)")

    # === QC ===
    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+"
    )
    processed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_preprocessing_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"

    @property
    def received_sample_types(self):
        """Get all received sample types from included CaseSamples."""
        css = CaseSample.objects.filter(id__in=self.case_sample_ids)
        return list(css.values_list("sample_source", flat=True))

    @property
    def remaining_sample_types(self):
        """Return override or computed remaining types."""
        if self.remaining_override is not None:
            return self.remaining_override
        received = self.received_sample_types
        if self.experiment_sample_type and self.experiment_sample_type in received:
            received = [t for t in received if t != self.experiment_sample_type]
        return received


# ============================================================
# NIPPT 实验模块独立化 — 5 个模块的 Batch + Sample 模型
# ============================================================

# ── DNA Extraction (核酸提取) ──

class NipptExtractionBatch(models.Model):
    """核酸提取批次"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    extraction_data = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_extraction_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptExtractionSample(models.Model):
    """核酸提取批次中的样本条目"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(NipptExtractionBatch, on_delete=models.CASCADE, related_name="samples")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="extraction_samples")
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)
    case_sample_ids = models.JSONField(default=list)
    source_preprocessing_sample_id = models.UUIDField(null=True, blank=True)
    aliquot_tubes = models.PositiveSmallIntegerField(default=0, help_text="当前剩余管数")
    is_qc = models.BooleanField(default=False, help_text="是否质控样本")

    # 提取特有字段
    extraction_method = models.CharField(max_length=20, blank=True, default="")
    well_position = models.CharField(max_length=4, blank=True, default="")
    plasma_volume = models.FloatField(null=True, blank=True)
    elution_volume = models.FloatField(default=30, null=True, blank=True)
    dna_concentration = models.FloatField(null=True, blank=True)
    experiment_sample_type = models.CharField(max_length=20, blank=True, default="", help_text="来源前处理的实验样本类型")

    # QC
    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_extraction_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"


# ── Library Preparation (文库构建) ──

class NipptLibraryBatch(models.Model):
    """文库构建批次"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    library_data = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_library_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptLibrarySample(models.Model):
    """文库构建批次中的样本条目"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(NipptLibraryBatch, on_delete=models.CASCADE, related_name="samples")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="library_samples")
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)
    case_sample_ids = models.JSONField(default=list)
    source_extraction_sample_id = models.UUIDField(null=True, blank=True)

    # 文库特有字段
    library_method = models.CharField(max_length=20, blank=True, default="")
    adapter_type = models.CharField(max_length=50, blank=True, default="")
    pcr_cycles = models.PositiveSmallIntegerField(null=True, blank=True)
    library_concentration = models.FloatField(null=True, blank=True)

    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_library_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"


# ── Library QC & Pooling (文库定量及Pooling) ──

class NipptPoolingBatch(models.Model):
    """文库定量及Pooling批次"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    pooling_data = models.JSONField(default=dict, blank=True)
    pool_date = models.CharField(max_length=20, blank=True, default="")
    pool_time = models.CharField(max_length=10, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_pooling_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptPoolingSample(models.Model):
    """文库定量及Pooling批次中的样本条目"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(NipptPoolingBatch, on_delete=models.CASCADE, related_name="samples")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="pooling_samples")
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)
    case_sample_ids = models.JSONField(default=list)
    source_library_sample_id = models.UUIDField(null=True, blank=True)

    # Pooling特有字段
    library_concentration = models.FloatField(null=True, blank=True)
    molar_concentration = models.FloatField(null=True, blank=True)
    pooling_volume = models.FloatField(null=True, blank=True)
    pool_barcode = models.CharField(max_length=50, blank=True, default="")

    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_pooling_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"


# ── Hybridization & Sequencing (杂交及测序) ──

class NipptHybSeqBatch(models.Model):
    """杂交及测序批次"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    hyb_seq_data = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_hybseq_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptHybSeqSample(models.Model):
    """杂交及测序批次中的样本条目"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(NipptHybSeqBatch, on_delete=models.CASCADE, related_name="samples")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="hybseq_samples")
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)
    case_sample_ids = models.JSONField(default=list)
    source_pooling_sample_id = models.UUIDField(null=True, blank=True)

    # 测序特有字段
    sequencer = models.CharField(max_length=50, blank=True, default="")
    chip_type = models.CharField(max_length=50, blank=True, default="")
    read_length = models.PositiveSmallIntegerField(null=True, blank=True)
    reads_count = models.BigIntegerField(null=True, blank=True)
    q30_score = models.FloatField(null=True, blank=True)

    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_hybseq_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"


# ── Bioinformatics (生物信息分析) ──

class NipptBioinfoBatch(models.Model):
    """生物信息分析批次"""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "待处理"
        IN_PROGRESS = "IN_PROGRESS", "处理中"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    bioinfo_data = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    operator_name = models.CharField(max_length=50, blank=True, default="")
    reviewer = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_bioinfo_batches"
        ordering = ["-created_at"]

    def __str__(self):
        return self.batch_number

    @classmethod
    def generate_batch_number(cls):
        from django.utils import timezone
        now = timezone.now()
        prefix = now.strftime("%Y%m%d-%H")
        count = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        return f"{prefix}-{count:03d}"


class NipptBioinfoSample(models.Model):
    """生物信息分析批次中的样本条目"""

    class SampleCategory(models.TextChoices):
        FEMALE_BLOOD = "FEMALE_BLOOD", "女性血液"
        MALE_BLOOD = "MALE_BLOOD", "男性血液"
        MALE_OTHER = "MALE_OTHER", "男性其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(NipptBioinfoBatch, on_delete=models.CASCADE, related_name="samples")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="bioinfo_samples")
    patient_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=CaseSample.Role.choices, db_index=True)
    category = models.CharField(max_length=20, choices=SampleCategory.choices, db_index=True)
    case_sample_ids = models.JSONField(default=list)
    source_hybseq_sample_id = models.UUIDField(null=True, blank=True)

    # 生信特有字段
    analysis_pipeline = models.CharField(max_length=50, blank=True, default="")
    reference_genome = models.CharField(max_length=50, blank=True, default="")
    result_file = models.CharField(max_length=200, blank=True, default="")
    cpi_values = models.JSONField(default=dict, blank=True)

    # QC flag + metrics (per-sample, before pairing)
    qc_flag = models.CharField(max_length=20, blank=True, default="",
        choices=[("MALE_LOW_LAYERS","男性层数低"),("FEMALE_LOW_LAYERS","女性层数低"),
                 ("MALE_CONTAM","男性污染"),("FEMALE_CONTAM","女性污染"),
                 ("FETAL_LOW_CONC","胎儿浓度低"),("OTHER","其他异常")])
    layers = models.FloatField(null=True, blank=True, help_text="层数")
    concentration = models.FloatField(null=True, blank=True, help_text="浓度")
    het_ratio = models.FloatField(null=True, blank=True, help_text="杂纯比")
    y_ratio = models.FloatField(null=True, blank=True, help_text="Y比例")

    qc_status = models.CharField(max_length=20, default="PASS", db_index=True,
        choices=[("PENDING", "待定"), ("PASS", "合格"), ("FAIL", "不合格")])
    qc_note = models.TextField(blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "nippt_bioinfo_samples"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.batch.batch_number} / {self.patient_name} ({self.category})"


class NipptBioinfoPair(models.Model):
    """Bioinformatics analysis pair — Mother + Father CPI unit"""

    class Result(models.TextChoices):
        INCLUSION = "INCLUSION", "支持"
        EXCLUSION = "EXCLUSION", "不支持"
        INCONCLUSIVE = "INCONCLUSIVE", "亲缘临界"

    class QCFlag(models.TextChoices):
        MALE_LOW_LAYERS = "MALE_LOW_LAYERS", "男性层数低"
        FEMALE_LOW_LAYERS = "FEMALE_LOW_LAYERS", "女性层数低"
        MALE_CONTAM = "MALE_CONTAM", "男性污染"
        FEMALE_CONTAM = "FEMALE_CONTAM", "女性污染"
        FETAL_LOW_CONC = "FETAL_LOW_CONC", "胎儿浓度低"
        OTHER = "OTHER", "其他异常"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        NipptBioinfoBatch, on_delete=models.CASCADE, related_name="pairs"
    )
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="bioinfo_pairs")

    mother_sample = models.ForeignKey(
        NipptBioinfoSample, on_delete=models.CASCADE, related_name="pairs_as_mother"
    )
    father_sample = models.ForeignKey(
        NipptBioinfoSample, on_delete=models.CASCADE, related_name="pairs_as_father"
    )

    father_label = models.CharField(max_length=10, help_text="H / HA / HB / HC...")
    is_cross_batch = models.BooleanField(default=False)
    mother_source_batch = models.CharField(max_length=30, blank=True, default="")
    father_source_batch = models.CharField(max_length=30, blank=True, default="")

    cpi = models.FloatField(null=True, blank=True)
    cpi_combined = models.FloatField(null=True, blank=True)
    result = models.CharField(
        max_length=20, blank=True, default="",
        choices=Result.choices, db_index=True,
    )

    note = models.TextField(blank=True, default="")
    report_data = models.JSONField(default=dict, blank=True)

    # QC Flag (optional)
    qc_flag = models.CharField(max_length=20, blank=True, default="", choices=QCFlag.choices, db_index=True)

    # Analysis Metrics
    mother_layers = models.FloatField(null=True, blank=True, help_text="母本层数")
    mother_concentration = models.FloatField(null=True, blank=True, help_text="母本浓度")
    mother_het_ratio = models.FloatField(null=True, blank=True, help_text="母本杂纯比")
    mother_y_ratio = models.FloatField(null=True, blank=True, help_text="母本Y比例")

    father_layers = models.FloatField(null=True, blank=True, help_text="父本层数")
    father_concentration = models.FloatField(null=True, blank=True, help_text="父本浓度")
    father_het_ratio = models.FloatField(null=True, blank=True, help_text="父本杂纯比")
    father_y_ratio = models.FloatField(null=True, blank=True, help_text="父本Y比例")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nippt_bioinfo_pairs"
        ordering = ["case__case_number", "father_label"]
        unique_together = [["batch", "mother_sample", "father_sample"]]

    def __str__(self):
        return f"{self.case.case_number} / {self.father_label} ({self.get_result_display() or 'Pending'})"


class WorkflowLog(models.Model):
    case_sample = models.ForeignKey(CaseSample, on_delete=models.CASCADE, related_name="workflow_logs")
    stage = models.CharField(max_length=30, db_index=True)
    action = models.CharField(max_length=20)
    batch_number = models.CharField(max_length=30, blank=True)
    batch_sample_id = models.CharField(max_length=40, null=True, blank=True)
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "nippt_workflow_logs"
        ordering = ["-created_at"]
