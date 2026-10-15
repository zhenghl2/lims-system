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
        HAS_RESAMPLE = "HAS_RESAMPLE", "有重采"
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
    # 报告版本（如 英文/英繁/泰国/法语…）：登记时选择，后续自动生成报告时据此选模板
    report_version = models.CharField(max_length=50, blank=True, default="", db_index=True)
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

    # ── 孕周计算方式 / 双胎类型 / 申请日期（2026-10-15 三端打通）──
    # 说明：此前 Web 端登记页有这三项 UI，但后端无对应列，值不会落库；
    #      小程序补 UI 前必须先有列，否则只是再造三个假字段。
    calculation_method = models.CharField(
        max_length=20, blank=True, default="",
        choices=[("lmp", "末次月经"), ("ultrasound", "B超")],
        help_text="孕周计算方式: lmp=末次月经, ultrasound=B超")
    twin_type = models.CharField(
        max_length=20, blank=True, default="",
        choices=[("monozygotic", "同卵"), ("dizygotic", "异卵")],
        help_text="双胎类型（仅 multiple_gestation=True 时有意义）: monozygotic=同卵, dizygotic=异卵")
    application_date = models.DateField(
        null=True, blank=True, help_text="申请日期（申请单上的日期，区别于样本采集日期 collection_date）")

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
        """从 CaseSample 实时推导 Case 状态.

        ⚠️ 全部逻辑在**已预取的 case_samples 列表**上做（原来用 .filter()/.exclude()/.values_list()
        会绕过 prefetch → 每个案例额外 ~8 条 SQL；案例管理/样本接收列表曾因此慢到 6 秒）。
        语义与旧实现逐一对应，未改变任何状态判定口径。
        """
        css = list(self.case_samples.all())      # prefetch 命中 → 0 查询
        if not css:
            return "REGISTERED"
        # 全部样本被拒收 → REJECTED（放在空检查前，兼容全拒收场景）
        if all(cs.sample.status == "REJECTED" for cs in css):
            return "REJECTED"
        active = [cs for cs in css if cs.is_active and cs.sample.status != "REJECTED"]
        if not active:
            active = [cs for cs in css if cs.sample.status != "REJECTED"]
        if not active:
            return "REGISTERED"

        # 有待签收的重采样本 → 有重采（重采样本被签收后自动转具体进度）
        if any(cs.resample_of_id and cs.sample.status == "REGISTERED" for cs in css):
            return "HAS_RESAMPLE"

        # 已被有效重采处理的原失败样本不再压状态（重采样本本身被拒收的不算已处理）
        resampled_origin_ids = set(
            cs.resample_of_id for cs in css
            if cs.resample_of_id and cs.sample.status != "REJECTED"
        )
        if any((cs.workflow_stage or "").endswith("_FAILED") for cs in active
               if cs.id not in resampled_origin_ids):
            return "HAS_FAILURE"
        stages = [cs.workflow_stage for cs in active
                  if cs.id not in resampled_origin_ids and cs.workflow_stage]
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

    def assign_supplement_test_id(self, case_sample, save=True):
        """补样登记时分配 PT 编号（用户 2026-10-13 确认：补样也要立刻有 PT 号）。

        若与同案例已有活跃样本撞号（母亲已有母亲样本、或疑父同名），
        自动改按「重采」口径加 _R{n} 后缀，避免两条样本拿到同一个 PT 号
        （例如两个 PT71890W）。撞号时会顺带写好 resample_of / resample_number。

        返回最终编号。save=False 时只改内存，由调用方自己 save。
        """
        from django.db.models import Max

        others = list(
            self.case_samples.exclude(id=case_sample.id)
            .filter(is_active=True)
            .select_related("sample")
            .order_by("created_at")
        )
        candidate = self.generate_test_sample_id(case_sample)
        if any((c.test_sample_id or "") == candidate for c in others):
            same = [c for c in others if c.role == case_sample.role]
            if case_sample.role == "ALLEGED_FATHER":
                my_name = (case_sample.sample.patient_name or "").strip()
                same_name = [c for c in same if (c.sample.patient_name or "").strip() == my_name]
                if same_name:
                    same = same_name
            # 原样本优先取「没重采过」的那条
            origin = next((c for c in same if not c.resample_number), same[0] if same else None)
            max_n = self.case_samples.filter(resample_number__isnull=False).aggregate(
                m=Max("resample_number"))["m"] or 0
            next_n = max_n + 1
            case_sample.resample_of = origin
            case_sample.resample_number = next_n
            candidate = self.generate_test_sample_id(case_sample, resample_num=next_n)
        case_sample.test_sample_id = candidate
        if save:
            case_sample.save(update_fields=["test_sample_id", "resample_of", "resample_number"])
        return candidate

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

    def is_surrogacy(self):
        """是否代孕（报告模板选择用）。

        2026-10-13：登记页「是否代孕」勾选存的是 risk_warnings（JSON 列表），
        而报告引擎原先只认「备注以代孕开头」→ 勾了却没在备注写代孕的案例会出成普通报告。
        统一到本方法：**勾选 或 备注开头**，报告引擎与报告模块共用同一口径。
        """
        for w in (self.risk_warnings or []):
            if str(w).strip().lower() == "surrogacy":
                return True
        return (self.notes or "")[:2] == "代孕"

    def mother_gender_info(self):
        """额外信息：母亲样本的 gender_info（Yes/No）。

        2026-10-13：登记页新增「额外信息 是/否」（案例管理基本信息里显示为 gender 的那一项）。
        报告引擎据此决定是否出性别报告（Yes 才出），报告模块该列也读它 —— 三处同一口径。
        ⚠️ 底层字段是 samples.gender_info（不是 samples.gender，后者全库为空）。
        """
        for cs in self.case_samples.all():
            if cs.role == "MOTHER" and cs.sample_id:
                return (cs.sample.gender_info or "").strip()
        return ""

    def origin_country(self):
        """案例级来源(国家)：优先孕妇样本，其次任一已填来源的样本；均无则返回空串。

        用于补充样本/重做/重采等「给已有案例新增样本」的场景继承原案例来源
        （Sample.sample_source 为自由文本，非枚举）。
        """
        qs = self.case_samples.select_related("sample").exclude(sample__sample_source="")
        cs = qs.filter(role=CaseSample.Role.MOTHER).first() or qs.first()
        if cs and cs.sample:
            return cs.sample.sample_source or ""
        return ""


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
    receipt_location = models.CharField(
        max_length=20, blank=True, default="",
        choices=[("XIAMEN", "厦门"), ("HONGKONG", "香港")],
        help_text="签收地: XIAMEN=厦门 / HONGKONG=香港",
    )

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
    receipt_note = models.TextField(
        blank=True, default="",
        help_text="签收备注（样本情况/与登记不一致等注意事项）"
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
    reactivated = models.BooleanField(
        default=False,
        help_text="重做激活标志：用其他样本重做时置True，出现在前处理待做列表，进入前处理批次后自动清除"
    )
    priority = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "case_samples"
        unique_together = [["case", "sample"]]
        ordering = ["role", "created_at"]

    @property
    def effective_sample_type(self):
        """现行样本类型（单一口径）：优先签收时填写的实际收到类型 actual_sample_type，
        为空回退登记时的 sample_source。

        凡「按样本类型分流/过滤/分组/显示」的逻辑都必须用本属性，不要直接比较
        self.sample_source —— 签收可以改类型，用登记值会与前处理显示、后端校验互相矛盾。
        """
        return (self.actual_sample_type or "").strip() or (self.sample_source or "").strip()

    def __str__(self):
        return f"{self.case.case_number} - {self.get_role_display()} ({self.sample.sample_id})"

    def confirm_receipt(self, user, condition="OK", photo=None):
        """Mark sample as received."""
        self.receipt_condition = condition
        self.received_at = timezone.now()
        self.received_by = user
        # 仅正常签收推进到 RECEIVED；拒收不推进工作流（由 sample.status=REJECTED 表达，
        # 否则拒收样本会错误地出现在"已签收"列表/计数中）
        if condition == "OK":
            self.workflow_stage = "RECEIVED"
        if photo:
            self.receipt_photo = photo
        self.save(update_fields=[
            "receipt_condition", "received_at", "received_by",
            "workflow_stage", "receipt_photo", "updated_at",
        ])


# ============================================================
# 辅助：案例状态同步
# ============================================================

def sync_case_status_for_samples(case_sample_ids):
    """样本阶段变化后同步关联案例的 Case.status（防案例级状态滞后）。"""
    case_ids = set(
        CaseSample.objects.filter(id__in=case_sample_ids).values_list("case_id", flat=True)
    )
    if not case_ids:
        return
    for case in Case.objects.filter(id__in=case_ids):
        case.update_status()


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
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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
        """收到样本类型：优先签收时填写的「实际收到样本类型」(actual_sample_type)，
        为空则回退登记时的 sample_source（历史数据 actual 多为空）。
        保持 case_sample_ids 顺序，重复值保留（同一 CaseSample 只取一个值）。"""
        css = CaseSample.objects.filter(id__in=self.case_sample_ids)
        by_id = {str(x.id): x for x in css}
        out = []
        for cid in (self.case_sample_ids or []):
            cs = by_id.get(str(cid))
            if not cs:
                continue
            t = cs.effective_sample_type
            if t:
                out.append(t)
        # 兜底：case_sample_ids 为空/悬空时按 case 反查（保持旧行为不丢数据）
        if not out:
            out = [t for t in css.values_list("sample_source", flat=True) if t]
        return out

    @property
    def remaining_sample_types(self):
        """Return override or computed remaining types."""
        if self.remaining_override is not None:
            return self.remaining_override
        received = self.received_sample_types
        # 男性血液可分2-3次实验：实验类型选"血液"时血液保留在剩余中（不扣除）
        if (self.experiment_sample_type
                and self.experiment_sample_type in received
                and not (self.category == "MALE_BLOOD" and self.experiment_sample_type == "BLOOD")):
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
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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
    elution_volume = models.FloatField(default=55, null=True, blank=True)
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
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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
    operator_name = models.CharField(max_length=200, blank=True, default="")
    reviewer = models.CharField(max_length=200, blank=True, default="")
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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

    class ReportStatus(models.TextChoices):
        PENDING = "PENDING", "待上传"
        TO_REVIEW = "TO_REVIEW", "待复核"
        COMPLETED = "COMPLETED", "已完成"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_number = models.CharField(max_length=30, unique=True, db_index=True)
    status = models.CharField(max_length=20, default=Status.DRAFT, choices=Status.choices, db_index=True)
    bioinfo_data = models.JSONField(default=dict, blank=True)
    # ── Reports 模块：报告批次状态 + 批次级复核/审核 ──
    report_status = models.CharField(max_length=20, default=ReportStatus.PENDING,
                                     choices=ReportStatus.choices, db_index=True)
    report_reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name="+")
    report_auditor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                       null=True, blank=True, related_name="+")
    report_reviewed_at = models.DateTimeField(null=True, blank=True)
    report_audited_at = models.DateTimeField(null=True, blank=True)
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
        last_no = (cls.objects.filter(batch_number__startswith=prefix)
                   .order_by("-batch_number").values_list("batch_number", flat=True).first())
        if last_no:
            try:
                seq = int(last_no.rsplit("-", 1)[1]) + 1
            except (ValueError, IndexError):
                seq = cls.objects.filter(batch_number__startswith=prefix).count() + 1
        else:
            seq = 1
        return f"{prefix}-{seq:03d}"


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

    # ── Reports 模块：报告文件 + 复核/审核（每配对一份报告）──
    report_file = models.FileField(upload_to="nippt_reports/%Y%m/", null=True, blank=True)
    # 2026-10-13：PDF 独立槽位 —— Word 与 PDF 可同时存在，互不覆盖
    report_file_pdf = models.FileField(upload_to="nippt_reports/%Y%m/", null=True, blank=True)
    report_pdf_stale = models.BooleanField(default=False)   # 重新生成 Word 后旧 PDF 可能过期（只提示不删）

    def has_report(self):
        """是否有报告（2026-10-13 用户口径：任一格式即算「已上传」）。"""
        return bool(self.report_file or self.report_file_pdf)
    # 报告附表：生信产出的位点表(.last)，报告正文的「附表一」大表来自它
    appendix_file = models.FileField(upload_to="nippt_appendix/%Y%m/", null=True, blank=True,
                                     verbose_name="位点附表(.last)")
    report_reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    report_auditor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    report_note = models.TextField(blank=True, default="")
    report_reviewed_at = models.DateTimeField(null=True, blank=True)
    report_audited_at = models.DateTimeField(null=True, blank=True)
    # 报告上传/替换记录：[{action: upload|replace|keep, filename, prev_filename, by, at, size}]
    report_history = models.JSONField(default=list, blank=True)

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
    # id 必须与 DB 实际的 uuid 列一致：migration 0012 误声明为 BigAutoField，
    # 导致 update_or_create 的更新分支 save(update_fields=...) 用错类型 pk → 500
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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


class NipptPlasmaTubeLog(models.Model):
    """孕妇血浆管数变动台账（前处理建档/提取使用/质控使用/重做使用 自动记录）"""
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="plasma_tube_logs")
    case_sample = models.ForeignKey(
        CaseSample, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="plasma_tube_logs"
    )
    before_count = models.PositiveSmallIntegerField(default=0)
    after_count = models.PositiveSmallIntegerField(default=0)
    reason = models.CharField(max_length=50)
    batch_number = models.CharField(max_length=30, blank=True, default="")
    operator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "nippt_plasma_tube_logs"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.case.case_number} {self.before_count}->{self.after_count} ({self.reason})"
