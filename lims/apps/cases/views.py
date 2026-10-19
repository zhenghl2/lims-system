"""Case views."""
from django.db import transaction
from django.http import HttpResponse
from django.db.models import Q, F
from django.db.models.functions import Length
from django.utils import timezone
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.exceptions import ValidationError, NotFound
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter, SearchFilter
from .models import Case, CaseSample, WorkflowLog, NipptPreProcessingBatch, NipptPreProcessingSample, NipptExtractionBatch, NipptExtractionSample, NipptLibraryBatch, NipptLibrarySample, NipptPoolingBatch, NipptPoolingSample, NipptHybSeqBatch, NipptHybSeqSample, NipptBioinfoBatch, NipptBioinfoSample
from lims.apps.audit.utils import log_audit
from .nippt_photos import NipptPhotosMixin, purge_nippt_photos
from .report_gen import service as report_service
from .serializers import (
    CaseListSerializer, CaseDetailSerializer, CaseCreateSerializer,
    CaseSampleSerializer, PublicRegistrationSerializer,
    NipptPreProcessingBatchListSerializer, NipptPreProcessingBatchDetailSerializer,
    NipptPreProcessingBatchCreateSerializer, NipptPreProcessingSampleSerializer,
    PendingEntrySerializer,
    SupplementSerializer,
    NipptBatchImportSerializer,
    NipptCnBatchImportSerializer,
    NipptVnBatchImportSerializer,
)
from lims.apps.samples.models import Sample, SampleType
from lims.apps.organizations.models import Site
import os
from datetime import date
import datetime


def _classify_supplement_kind(text):
    """巴西补样备注判定: MOTHER=补孕妇 / FATHER=补疑父 / FATHER2=补疑父二 / DUPLICATE=重复"""
    t = (text or "").upper()
    t = t.replace("º", "º").replace("°", "º")
    if "RECOLETA DA GESTANTE" in t or "RECOLETA GESTANTE" in t:
        return "MOTHER"
    if ("2º SUPOSTO PAI" in t or "2O SUPOSTO PAI" in t or "2 SUPOSTO PAI" in t
            or "SEGUNDO SUPOSTO PAI" in t or "SEGUNDA SUPOSTO PAI" in t):
        return "FATHER2"
    if "SUPOSTO PAI" in t:
        return "FATHER"
    return "DUPLICATE"


def _is_sales_scoped(user):
    """销售账号判定（小程序自助注册）：数据范围限本人登记的案例。

    仅当用户「只」持有 sales 角色且非 staff/superuser 时成立 ——
    实验室角色（technologist / bioinformatician / site_director / ...）与管理端不受影响。
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if user.is_superuser or user.is_staff:
        return False
    from lims.apps.users.models import UserRole

    roles = set(UserRole.objects.filter(user=user).values_list("role__name", flat=True))
    return roles == {"sales"}


class CaseViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ["panel", "is_urgent"]
    search_fields = []
    ordering_fields = ["created_at", "case_number", "expected_completion"]

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(case_number__icontains=search)
                | Q(pt_number__icontains=search)
                | Q(clinic_name__icontains=search)
                | Q(sales_person__icontains=search)
                | Q(case_samples__sample__patient_name__icontains=search)
            ).distinct()
        wf = self.request.query_params.get("workflow_status", "").strip()
        if wf:
            qs = qs.filter(case_samples__workflow_stage=wf).distinct()
        return qs

    def get_serializer_context(self):
        """列表接口预置 plasma_tubes_map：一条 SQL 覆盖整页孕妇样本的前处理记录，
        避免 CaseSampleSerializer.plasma_tubes 逐样本查询（原每样本 1 条 SQL）。"""
        ctx = super().get_serializer_context()
        if getattr(self, "action", None) == "list":
            try:
                from .models import NipptPreProcessingSample
                case_ids = list(self.filter_queryset(self.get_queryset()).values_list("id", flat=True))
                m = {}
                if case_ids:
                    rows = (NipptPreProcessingSample.objects
                            .filter(case_id__in=case_ids)
                            .only("case_sample_ids", "aliquot_tubes", "created_at")
                            .order_by("created_at"))          # 升序 → 后者覆盖前者 = 取最新
                    for r in rows:
                        for cid in (r.case_sample_ids or []):
                            m[str(cid)] = r.aliquot_tubes
                ctx["plasma_tubes_map"] = m
            except Exception:
                pass    # 兜底：失败则回退为逐样本查询，不影响功能
        return ctx

    def get_queryset(self):
        qs = Case.objects.prefetch_related("case_samples__sample").select_related("panel").all()
        # ?receiving=1 —— 样本签收页专用：只回「含待签收/已签收/拒收样本」的 case。
        # 这三个条件恰好覆盖签收页三个 Tab（REGISTERED / 工序=RECEIVED / REJECTED），
        # 所以「Tab 计数与列表同源」的设计不受影响；不传该参数的其他页面行为完全不变。
        if str(self.request.query_params.get("receiving", "")).lower() in ("1", "true", "yes"):
            from django.db.models import Q
            qs = qs.filter(
                Q(case_samples__sample__status="REGISTERED")
                | Q(case_samples__workflow_stage="RECEIVED")
                | Q(case_samples__sample__status="REJECTED")
            ).distinct()
        # Support comma-separated status values (e.g. ?status=REGISTERED,RECEIVING)
        status_param = self.request.query_params.get("status", "")
        if status_param:
            statuses = [s.strip() for s in status_param.split(",") if s.strip()]
            # 按样本级状态过滤（避免 Case 状态与样本状态不一致导致拒收样本泄漏）
            qs = qs.filter(case_samples__sample__status__in=statuses).distinct()
        # ?case_status= —— 按【案例级】状态过滤（小程序案例列表用）。
        # 语义区分：?status= 是「样本状态」口径（签收页沿用）；?workflow_status= 是「样本工序阶段」；
        # 本参数过滤 Case.status，支持逗号多值（如 ?case_status=REGISTERED,RECEIVED）。
        case_status_param = self.request.query_params.get("case_status", "").strip()
        if case_status_param:
            case_statuses = [v.strip() for v in case_status_param.split(",") if v.strip()]
            qs = qs.filter(status__in=case_statuses)
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

        # 签收时间过滤（按首个样本 received_at）
        received_after = self.request.query_params.get("received_after", "").strip()
        if received_after:
            qs = qs.filter(case_samples__received_at__date__gte=received_after).distinct()
        received_before = self.request.query_params.get("received_before", "").strip()
        if received_before:
            qs = qs.filter(case_samples__received_at__date__lte=received_before).distinct()

        # 有重采样本的 Case
        has_resample = self.request.query_params.get("has_resample", "").strip().lower()
        if has_resample == "true":
            qs = qs.filter(case_samples__resample_of__isnull=False).distinct()
        elif has_resample == "false":
            qs = qs.exclude(case_samples__resample_of__isnull=False).distinct()
        if self.request.user.site_id:
            qs = qs.filter(site=self.request.user.site)
        # 销售账号（小程序自助注册）：只返回本人登记的案例（数据隔离）
        if _is_sales_scoped(self.request.user):
            qs = qs.filter(created_by=self.request.user)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return CaseListSerializer
        if self.action == "create":
            return CaseCreateSerializer
        return CaseDetailSerializer

    def perform_create(self, serializer):
        # 销售自助注册账号登记时，自动补上 sales_person（供 Web 端展示）
        extra = {}
        if _is_sales_scoped(self.request.user) and not serializer.validated_data.get(
            "sales_person"
        ):
            extra["sales_person"] = self.request.user.first_name or self.request.user.username
        case = serializer.save(**extra)
        log_audit(self.request, "CREATE", case, changes={
            "case_number": {"old": "", "new": case.case_number},
            "pt_number": {"old": "", "new": case.pt_number or ""},
        }, entity_type="case", entity_repr=str(case))

    # ── 案例管理编辑：可编辑白名单与锁定判定 ──────────────────────────
    # Case 级可编辑字段（编号/状态/流程/site/created_by/时间戳 绝不放开）
    CASE_EDITABLE_FIELDS = [
        "gestational_age_weeks", "gestational_age_days", "multiple_gestation",
        "clinic_name", "clinic_contact", "sales_person",
        "applicant", "phone", "email", "report_version",
        "collection_method", "application_signed", "expected_completion",
        "risk_warnings", "registration_type", "notes", "is_urgent",
        # 2026-10-15 三端打通：登记/编辑均可维护这三项
        "calculation_method", "twin_type", "application_date",
    ]
    # 样本级可编辑字段（实际写入 cs.sample）
    SAMPLE_EDITABLE_FIELDS = ["patient_name", "collection_date"]
    # 备注：任何状态都可改
    NOTE_FIELDS = ["collection_notes", "receipt_note"]
    STAGE_DISPLAY = {
        "REGISTERED": "已登记", "PRE_PROCESSING": "前处理", "EXTRACTION": "提取",
        "LIBRARY": "文库构建", "POOLING": "定量Pooling", "HYB_SEQ": "杂交测序",
        "BIOINFO": "生信分析", "REPORT_DRAFT": "报告草稿", "COMPLETED": "已完成",
    }

    def _sample_lock_reason(self, case, cs):
        """样本锁定原因：None=可编辑；否则返回中文原因。

        ① 已匹配：同 case 内存在共享同一 external_id 的另一 CaseSample（导入补样合并过）
        ② 已进实验：workflow_stage != REGISTERED
        """
        ext = (getattr(cs.sample, "external_id", "") or "").strip()
        if ext:
            dup = CaseSample.objects.filter(
                case=case, sample__external_id=ext
            ).exclude(id=cs.id).exists()
            if dup:
                return "已与导入样本匹配"
        stage = cs.workflow_stage or "REGISTERED"
        if stage != "REGISTERED":
            return "已进实验（%s）" % self.STAGE_DISPLAY.get(stage, stage)
        return None

    def _sample_matched_reason(self, case, cs):
        """只判「已与导入样本匹配」这一条锁（外部编号专用）。

        外部编号改动只避开这一条：同案例内已有另一条共享同一编号（导入补样合并过），
        改了会破坏匹配关系。已进实验/已出报告仍允许改（修正录入错误，用户 2026-10-13）。
        """
        ext = (getattr(cs.sample, "external_id", "") or "").strip()
        if ext and CaseSample.objects.filter(
            case=case, sample__external_id=ext
        ).exclude(id=cs.id).exists():
            return "已与导入样本匹配（同案例共享同一编号）"
        return None

    def _external_id_target(self, case):
        """外部编号在界面上是「案例级」展示，实际落在样本上。

        取法必须与案例列表「外部编号」列一致：母亲样本 → 任一有值的样本 → 第一条。
        """
        css = list(case.case_samples.select_related("sample").order_by("role", "created_at"))
        for cs in css:
            if cs.role == "MOTHER":
                return cs
        for cs in css:
            if (cs.sample.external_id or "").strip():
                return cs
        return css[0] if css else None

    @action(detail=False, methods=["get"], url_path="report-versions")
    def report_versions(self, request):
        """报告版本候选项：预设清单 + 库里已用过的值（登记时可自由输入新增）"""
        presets = ["英文", "英繁", "英文-美", "泰国", "法语", "意大利",
                   "西班牙", "加纳", "印度", "德语", "澳洲", "巴西"]
        used = list(
            Case.objects.exclude(report_version="").exclude(report_version__isnull=True)
            .values_list("report_version", flat=True).distinct()
        )
        return Response({"presets": presets, "used": used,
                         "options": presets + [u for u in used if u not in presets]})

    @action(detail=True, methods=["get"])
    def notes_summary(self, request, pk=None):
        """实时汇总各工序的样本级备注（qc_note / note），只读。

        设计：不改工序模块、不冗余写库 —— 读取时从各工序样本表实时聚合，
        天然带「工序名 + 时间 + 操作人」，工序备注改了自动同步。
        """
        case = self.get_object()
        cs_list = list(case.case_samples.select_related("sample").all())
        id2label = {}
        for cs in cs_list:
            id2label[str(cs.id)] = "%s (%s)" % (cs.sample.sample_id, cs.sample.patient_name or "")

        MODELS = [
            ("前处理", NipptPreProcessingSample),
            ("提取", NipptExtractionSample),
            ("文库构建", NipptLibrarySample),
            ("定量Pooling", NipptPoolingSample),
            ("杂交测序", NipptHybSeqSample),
            ("生信分析", NipptBioinfoSample),
        ]
        out = []
        for label, M in MODELS:
            if M is None:
                continue
            try:
                recs = M.objects.exclude(case_sample_ids=[]).order_by("-processed_at", "-id")
            except Exception:
                try:
                    recs = M.objects.all().order_by("-processed_at", "-id")
                except Exception:
                    continue
            for rec in recs:
                ids = rec.case_sample_ids or []
                if not isinstance(ids, list):
                    continue
                hits = [str(i) for i in ids if str(i) in id2label]
                if not hits:
                    continue
                note = (getattr(rec, "qc_note", "") or "").strip()
                if not note:
                    continue
                op = getattr(rec, "operator", None)
                out.append({
                    "stage": label,
                    "sample_ids": id2label[hits[0]] if len(hits) == 1 else "%d 个样本" % len(hits),
                    "note": note,
                    "time": rec.processed_at.strftime("%Y-%m-%d %H:%M") if getattr(rec, "processed_at", None) else "",
                    "operator": (
                        getattr(op, "real_name", None)
                        or (op.get_full_name() if hasattr(op, "get_full_name") else None)
                        or getattr(op, "username", None)
                        or ""
                    ) if op else "",
                })
        out.sort(key=lambda x: x["time"] or "", reverse=True)
        return Response({"count": len(out), "results": out})

    @action(detail=True, methods=["get"])
    def editable_state(self, request, pk=None):
        """返回该案例的可编辑状态：案例级是否可编辑 + 每个样本的锁定原因。"""
        case = self.get_object()
        samples = []
        for cs in case.case_samples.select_related("sample").order_by("role", "created_at"):
            samples.append({
                "id": str(cs.id),
                "sample_id": cs.sample.sample_id,
                "patient_name": cs.sample.patient_name or "",
                "collection_date": str(cs.sample.collection_date) if cs.sample.collection_date else "",
                "collection_notes": cs.collection_notes or "",
                "role": cs.role,
                "workflow_stage": cs.workflow_stage,
                "locked": bool(self._sample_lock_reason(case, cs)),
                "lock_reason": self._sample_lock_reason(case, cs) or "",
            })
        case_locked = all(s["locked"] for s in samples) if samples else False
        # 外部编号（案例级）：写在目标样本上，单独一把更宽松的锁
        _tgt = self._external_id_target(case)
        _ext_reason = self._sample_matched_reason(case, _tgt) if _tgt else None
        return Response({
            "case_editable": not case_locked,
            "case_locked_reason": "全部样本均已锁定" if case_locked else "",
            "external_id": (_tgt.sample.external_id or "") if _tgt else "",
            "external_id_locked": bool(_ext_reason),
            "external_id_lock_reason": _ext_reason or "",
            "external_id_target": (_tgt.sample.sample_id if _tgt else ""),
            "samples": samples,
        })

    def _apply_case_edit(self, request, case):
        """案例管理编辑：edited_by 必填；G1 案例级 + G2/G3 样本级 + 备注。"""
        from lims.apps.audit.utils import log_audit

        edited_by = (request.data.get("edited_by") or "").strip()
        if not edited_by:
            raise ValidationError({"edited_by": "请填写编辑人"})

        changes = {}
        # ── 阶段一：全量校验（先不写，避免部分成功）──
        sample_plan = []          # [(cs, {field: (old, new)})]
        for item in (request.data.get("case_samples") or []):
            cs_id = item.get("id")
            if not cs_id:
                raise ValidationError({"case_samples": "缺少样本 id"})
            cs = case.case_samples.filter(id=cs_id).select_related("sample").first()
            if not cs:
                raise ValidationError({"case_samples": "样本不属于该案例: %s" % cs_id})

            reason = self._sample_lock_reason(case, cs)
            plan = {}
            # 受锁字段（姓名/采集日期）
            for f in self.SAMPLE_EDITABLE_FIELDS:
                if f not in item:
                    continue
                if reason:
                    raise ValidationError({
                        "case_samples": "%s 已锁定（%s），不可修改 %s" % (cs.sample.sample_id, reason, f)
                    })
                new = item.get(f)
                if f == "patient_name":
                    new = (new or "").strip()
                    if not new:
                        raise ValidationError({"case_samples": "姓名不能为空"})
                    old = cs.sample.patient_name or ""
                else:  # collection_date（必填，不允许清空）
                    if not new:
                        raise ValidationError({"case_samples": "采集日期不能为空（必填字段）"})
                    old = str(cs.sample.collection_date) if cs.sample.collection_date else ""
                if str(old) != str(new):
                    plan[f] = (old, new)
            # 备注：任何状态都可改
            for f in self.NOTE_FIELDS:
                if f not in item:
                    continue
                new = item.get(f)
                if new is None:
                    continue
                old = getattr(cs, f, "") or ""
                if str(old) != str(new):
                    plan[f] = (old, new)
            if plan:
                sample_plan.append((cs, plan))

        case_plan = {}
        for f in self.CASE_EDITABLE_FIELDS:
            if f not in request.data:
                continue
            new = request.data.get(f)
            old = getattr(case, f)
            # 空字符串归一（数值/布尔字段除外）
            if isinstance(new, str):
                new = new.strip()
                if f in ("gestational_age_weeks", "gestational_age_days", "expected_completion") and new == "":
                    new = None
            if str(old) != str(new):
                case_plan[f] = (old, new)

        # 外部编号（案例级展示 → 写入目标样本；只避开"已匹配"锁）
        ext_plan = None
        if "external_id" in request.data:
            _tgt = self._external_id_target(case)
            if _tgt is None:
                raise ValidationError({"external_id": "该案例下没有样本，无法写入外部编号"})
            _new = (request.data.get("external_id") or "").strip()
            _old = (_tgt.sample.external_id or "").strip()
            # ⚠️ 2026-10-15 修复：锁定检查必须放在「值真的变了」**之后**。
            # 原顺序先查锁定 → 而前端每次保存都会带 external_id（哪怕没改），
            # 于是只要案例属于「同案例共享同一编号」（导入补样合并过）的受保护情形，
            # 改任何别的字段都会被误拦成 400（且错误挂在 external_id 键下，
            # 前端读不到 → 只显示 AxiosError: 400，用户完全看不出原因）。
            # 本方法注释写的是「外部编号**改动**只避开这一条锁」——没改动就不该拦。
            if _new != _old:
                _reason = self._sample_matched_reason(case, _tgt)
                if _reason:
                    raise ValidationError({
                        "external_id": "%s 已锁定（%s），不可修改外部编号" % (_tgt.sample.sample_id, _reason)
                    })
                ext_plan = (_tgt, _old, _new)

        if not case_plan and not sample_plan and not ext_plan:
            return Response({"updated": 0, "changes": {}, "message": "没有变更"})

        # ── 阶段二：写入 ──
        with transaction.atomic():
            if case_plan:
                for f, (old, new) in case_plan.items():
                    setattr(case, f, new)
                case.save(update_fields=list(case_plan.keys()) + ["updated_at"])
                for f, (old, new) in case_plan.items():
                    changes[f] = {"old": "" if old is None else str(old),
                                  "new": "" if new is None else str(new)}
            for cs, plan in sample_plan:
                sample_updates = {}
                cs_updates = {}
                # 审计键加样本标识前缀，避免同案例多样本互相覆盖
                prefix = cs.sample.sample_id or str(cs.id)
                for f, (old, new) in plan.items():
                    if f in self.SAMPLE_EDITABLE_FIELDS:
                        setattr(cs.sample, f, new)
                        sample_updates[f] = True
                    else:
                        setattr(cs, f, new)
                        cs_updates[f] = True
                    changes["%s.%s" % (prefix, f)] = {
                        "old": "" if old is None else str(old),
                        "new": "" if new is None else str(new),
                    }
                if sample_updates:
                    cs.sample.save(update_fields=list(sample_updates.keys()) + ["updated_at"])
                if cs_updates:
                    cs.save(update_fields=list(cs_updates.keys()) + ["updated_at"])

            if ext_plan:
                _tgt, _old, _new = ext_plan
                _tgt.sample.external_id = _new
                _tgt.sample.save(update_fields=["external_id", "updated_at"])
                changes["external_id"] = {"old": _old, "new": _new}

            changes["edited_by"] = {"old": "", "new": edited_by}
            changes["source"] = {"old": "", "new": "case_manage_edit"}
            log_audit(
                request, "UPDATE", case, changes=changes,
                entity_type="case", entity_repr=case.case_number,
            )

        return Response({"updated": len(case_plan) + sum(len(p) for _, p in sample_plan)
                         + (1 if ext_plan else 0),
                         "changes": changes})

    def partial_update(self, request, *args, **kwargs):
        """行内编辑保存：请求带 case_sample_id 时，更新指定样本的可编辑字段。
        （原实现被 DRF 默认逻辑忽略，导致签收页行内编辑静默不保存）

        案例管理编辑：带 edited_by / case_samples 时走 _apply_case_edit。
        """
        cs_id = request.data.get("case_sample_id")
        if cs_id:
            case = self.get_object()
            cs = case.case_samples.filter(id=cs_id).first()
            if not cs:
                raise NotFound("Sample not found in this case")
            EDITABLE = ["receipt_note", "actual_sample_type", "preservation_method",
                        "collection_notes"]
            updated = []
            for field in EDITABLE:
                if field in request.data:
                    setattr(cs, field, request.data.get(field) or "")
                    updated.append(field)
            if updated:
                cs.save(update_fields=updated + ["updated_at"])
            return self.retrieve(request, *args, **kwargs)

        # 案例管理编辑（带编辑人）
        if "edited_by" in request.data or "case_samples" in request.data:
            case = self.get_object()
            return self._apply_case_edit(request, case)

        # 堵漏：请求若含可编辑字段却没带 edited_by，说明绕过了编辑流程 → 拒绝
        # （is_urgent 是「加急」按钮独立调用，不在此列）
        guarded = set(self.CASE_EDITABLE_FIELDS) - {"is_urgent"}
        touched = [f for f in guarded if f in request.data]
        if touched:
            raise ValidationError({
                "edited_by": "请填写编辑人后再保存（涉及字段: %s）" % ", ".join(sorted(touched))
            })

        return super().partial_update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser, JSONParser])
    def parse_nippt_docs(self, request):
        """巴西送检单 Word 解析：上传多个 .docx，解析并查重，不创建数据。"""
        from .nippt_docx_parser import parse_docx_bytes, NipptDocxParseError
        from .nippt_xlsx_parser import parse_xlsx_bytes as parse_xlsx

        files = request.FILES.getlist("files")
        if not files:
            raise ValidationError("请上传至少一个文件（.docx 或 .xlsx）")

        cases = []
        nipt_files = []
        error_files = []
        duplicate_files = []
        seen_seq_files = {}

        for f in files:
            fname = f.name
            lower = fname.lower()
            try:
                data = f.read()
                if len(data) > 20 * 1024 * 1024:
                    raise ValidationError("文件超过 20MB")
                if lower.endswith(".xlsx"):
                    parsed_cases, nipt_rows = parse_xlsx(data, fname)
                    for nr in nipt_rows:
                        nipt_files.append({"file": fname, "test_item": nr.get("test_item", "")})
                    for r in parsed_cases:
                        seq = r["seq"]
                        if seq in seen_seq_files:
                            duplicate_files.append({"file": fname, "seq": seq, "merged_with": seen_seq_files[seq]})
                            existing = next((c for c in cases if c["seq"] == seq), None)
                            if existing:
                                existing["fathers"].extend(r["fathers"])
                            continue
                        seen_seq_files[seq] = fname
                        cases.append(r)
                    continue
                if not lower.endswith(".docx"):
                    error_files.append({"file": fname, "error": "仅支持 .docx / .xlsx 文件"})
                    continue
                r = parse_docx_bytes(data, fname)
            except NipptDocxParseError as e:
                error_files.append({"file": fname, "error": str(e)})
                continue
            except Exception as e:
                error_files.append({"file": fname, "error": f"解析异常: {str(e)[:200]}"})
                continue

            if r.get("_nipt"):
                nipt_files.append({"file": fname, "test_item": r.get("test_item", "")})
                continue

            seq = r["seq"]
            if seq in seen_seq_files:
                # 同批内重复 Seq：合并疑父
                duplicate_files.append({"file": fname, "seq": seq, "merged_with": seen_seq_files[seq]})
                existing = next((c for c in cases if c["seq"] == seq), None)
                if existing:
                    existing["fathers"].extend(r["fathers"])
                continue
            seen_seq_files[seq] = fname
            cases.append(r)

        # 查重：库中已存在的 Seq（附补样判定）
        existing_seqs = []
        existing_info = []
        if cases:
            seqs = [c["seq"] for c in cases]
            existing_seqs = list(
                Sample.objects.filter(external_id__in=seqs).values_list("external_id", flat=True)
            )
            existing_set = set(existing_seqs)
            for c in cases:
                if c["seq"] not in existing_set:
                    continue
                cs = CaseSample.objects.filter(
                    sample__external_id=c["seq"]
                ).select_related("case").first()
                if not cs:
                    continue
                kind = _classify_supplement_kind(c.get("remarks_raw") or c.get("notes") or "")
                existing_info.append({
                    "seq": c["seq"], "kind": kind,
                    "case_number": cs.case.case_number,
                })

        return Response({
            "cases": cases,
            "nipt_files": nipt_files,
            "error_files": error_files,
            "duplicate_files": duplicate_files,
            "existing": existing_seqs,
            "existing_info": existing_info,
            "case_count": len(cases),
            "nipt_count": len(nipt_files),
            "error_count": len(error_files),
        })

    @action(detail=False, methods=["post"])
    def batch_import_nippt(self, request):
        """巴西送检单批量导入：按 Seq 分组的 Case 列表，事务创建（防重：external_id）。"""
        from datetime import datetime

        serializer = NipptBatchImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        dry_run = str(request.data.get("dry_run", "")).lower() in ("true", "1", "yes")
        if dry_run:
            existing = [
                item["seq"] for item in serializer.validated_data["cases"]
                if Sample.objects.filter(external_id=item["seq"]).exists()
            ]
            return Response({"dry_run": True, "existing": existing})

        def parse_d(d):
            """DD/MM/YYYY -> date, 失败返回 None"""
            if not d:
                return None
            try:
                return datetime.strptime(d.strip(), "%d/%m/%Y").date()
            except (ValueError, AttributeError):
                try:
                    return datetime.strptime(d.strip(), "%d-%m-%Y").date()
                except (ValueError, AttributeError):
                    return None

        created, skipped, errors, merged = [], [], [], []
        for item in serializer.validated_data["cases"]:
            seq = item["seq"]
            merge_kind = (item.get("merge_kind") or "").strip()
            if Sample.objects.filter(external_id=seq).exists():
                if not merge_kind:
                    skipped.append({"seq": seq, "reason": "exists"})
                    continue
                # ── 补样/重采合并到原 Case ──
                try:
                    with transaction.atomic():
                        existing_cs = CaseSample.objects.filter(
                            sample__external_id=seq
                        ).select_related("case").first()
                        if not existing_cs:
                            skipped.append({"seq": seq, "reason": "exists"})
                            continue
                        case = existing_cs.case
                        kind = merge_kind
                        if kind == "FORCE":
                            kind = "MOTHER" if (item.get("mother_name") or "").strip() else "FATHER"
                        created_father = 0
                        if kind == "MOTHER":
                            sup = SupplementSerializer(data={
                                "role": "MOTHER",
                                "patient_name": item["mother_name"],
                                "sample_types": ["BLOOD"],
                                "external_id": seq,
                                "notes": item.get("notes") or "",
                            }, context={"case": case, "request": request})
                            sup.is_valid(raise_exception=True)
                            sup.save()
                        else:
                            for f in item["fathers"]:
                                if not f["name"] or f["name"] == "-":
                                    continue
                                sup = SupplementSerializer(data={
                                    "role": "ALLEGED_FATHER",
                                    "patient_name": f["name"],
                                    "sample_types": f.get("sample_types") or ["BLOOD"],
                                    "external_id": seq,
                                    "notes": item.get("notes") or "",
                                }, context={"case": case, "request": request})
                                sup.is_valid(raise_exception=True)
                                sup.save()
                                created_father += 1
                        merged.append({"seq": seq, "case_number": case.case_number, "kind": kind})
                except Exception as e:
                    errors.append({"seq": seq, "error": str(e)[:300]})
                continue
            try:
                with transaction.atomic():
                    father_names = [f["name"] for f in item["fathers"] if f["name"] and f["name"] != "-"]
                    father_sample_types = [
                        f["sample_types"] or ["BLOOD"]
                        for f in item["fathers"] if f["name"] and f["name"] != "-"
                    ]
                    mother_dob = parse_d(item["mother_dob"])
                    create_data = {
                        "mother_name": item["mother_name"],
                        "father_names": father_names,
                        "father_sample_types": father_sample_types,
                        "gestational_age_weeks": item.get("gestational_age_weeks"),
                        "sample_source": "巴西",
                        "report_version": "巴西",
                        "sales_person": item["sales_person"],
                        "notes": item["notes"],
                        "external_id": seq,
                        "registration_type": "FIRST",
                    }
                    if mother_dob:
                        create_data["mother_dob"] = mother_dob.isoformat()
                    create_serializer = CaseCreateSerializer(data=create_data, context={"request": request})
                    create_serializer.is_valid(raise_exception=True)
                    case = create_serializer.save()

                    # 附加字段：母亲
                    mother_cs = case.case_samples.filter(role=CaseSample.Role.MOTHER).select_related("sample").first()
                    if mother_cs:
                        m = mother_cs.sample
                        m.id_card = item["mother_id_card"] or ""
                        m.tube_no = item.get("mother_tube_no", "") or ""
                        m.price = item["price"] or ""
                        m.balance = item["balance"] or ""
                        m.gender_info = item["gender_info"] or ""
                        cd = parse_d(item["collection_date"])
                        if cd:
                            m.collection_date = cd
                        fx = item.get("fedex_no", "") or ""
                        if fx:
                            m.fedex_no = fx
                        m.save(update_fields=[
                            "id_card", "tube_no", "price", "balance", "gender_info",
                            "collection_date", "fedex_no", "updated_at",
                        ])
                    # 采集地点存母亲 CaseSample.collection_site
                    site = item.get("collection_site", "") or ""
                    if site and mother_cs:
                        mother_cs.collection_site = site
                        mother_cs.save(update_fields=["collection_site", "updated_at"])
                    # 附加字段：疑父 id_card
                    for f in item["fathers"]:
                        f_id = f.get("id_card") or ""
                        f_tube = f.get("tube_no") or ""
                        if not f["name"] or f["name"] == "-" or (not f_id and not f_tube):
                            continue
                        fcss = case.case_samples.filter(
                            role=CaseSample.Role.ALLEGED_FATHER,
                            sample__patient_name=f["name"],
                        ).select_related("sample")
                        for cs in fcss:
                            cs.sample.id_card = f_id
                            cs.sample.tube_no = f_tube
                            if fx:
                                cs.sample.fedex_no = fx
                            cs.sample.save(update_fields=["id_card", "tube_no", "fedex_no", "updated_at"])
                    # 报告截止日期
                    due = parse_d(item["expected_completion"])
                    if due:
                        case.expected_completion = due
                        case.save(update_fields=["expected_completion", "updated_at"])

                    created.append({"seq": seq, "case_number": case.case_number})
                    log_audit(request, "CREATE", case, changes={
                        "source": {"old": "", "new": "batch_import_nippt"},
                        "seq": {"old": "", "new": seq},
                    }, entity_type="case", entity_repr=str(case))
            except Exception as e:
                errors.append({"seq": seq, "error": str(e)[:300]})

        return Response({
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "merged": merged,
            "created_count": len(created),
            "skipped_count": len(skipped),
            "error_count": len(errors),
            "merged_count": len(merged),
        })

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser, JSONParser])
    def parse_cn_docs(self, request):
        """国内送检表解析：上传 .xlsx，解析并查重（孕妇+疑父姓名），不创建数据。"""
        from .nippt_cn_xlsx_parser import parse_cn_xlsx_bytes, NipptCnParseError

        files = request.FILES.getlist("files")
        if not files:
            raise ValidationError("请上传至少一个文件（.xlsx）")

        cases, error_files = [], []
        for f in files:
            fname = f.name
            if not fname.lower().endswith(".xlsx"):
                error_files.append({"file": fname, "error": "仅支持 .xlsx 文件"})
                continue
            try:
                data = f.read()
                if len(data) > 20 * 1024 * 1024:
                    raise ValidationError("文件超过 20MB")
                parsed, row_errors = parse_cn_xlsx_bytes(data, fname)
                for r in parsed:
                    r["file"] = fname
                cases.extend(parsed)
                for e in row_errors:
                    error_files.append({"file": fname, "row_no": e["row_no"], "error": e["error"]})
            except NipptCnParseError as e:
                error_files.append({"file": fname, "error": str(e)})
            except Exception as e:
                error_files.append({"file": fname, "error": f"解析异常: {str(e)[:200]}"})

        # 查重：孕妇姓名 + 疑父姓名 组合（在已有 NIPPT Case 中查找）
        existing_info = []
        if cases:
            mnames = {c["mother_name"] for c in cases if c["mother_name"]}
            pairs = []
            if mnames:
                qs = CaseSample.objects.filter(
                    sample__patient_name__in=mnames,
                    role=CaseSample.Role.MOTHER,
                    case__case_number__startswith="NIPPT",
                ).select_related("case", "sample").prefetch_related("case__case_samples__sample")
                for cs in qs:
                    for fcs in cs.case.case_samples.all():
                        if fcs.role == CaseSample.Role.ALLEGED_FATHER:
                            pairs.append((cs.sample.patient_name, fcs.sample.patient_name, cs.case.case_number))
            for c in cases:
                hit = next((p for p in pairs if p[0] == c["mother_name"] and p[1] == c["father_name"]), None)
                if hit:
                    existing_info.append({"row_no": c["row_no"], "file": c.get("file", ""), "case_number": hit[2]})

        return Response({
            "cases": cases,
            "errors": error_files,
            "existing_info": existing_info,
            "case_count": len(cases),
        })

    @action(detail=False, methods=["post"])
    def batch_import_cn(self, request):
        """国内送检表批量导入：逐行创建 Case（孕妇+单疑父），查重（孕妇+疑父姓名）。"""
        from datetime import datetime as _dt

        serializer = NipptCnBatchImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def parse_iso(d):
            if not d:
                return None
            try:
                return _dt.strptime(d.strip(), "%Y-%m-%d").date()
            except (ValueError, AttributeError):
                return None

        created, skipped, errors = [], [], []
        for item in serializer.validated_data["cases"]:
            mother = (item["mother_name"] or "").strip()
            father = (item["father_name"] or "").strip()
            if not mother and not father:
                skipped.append({"row_no": item.get("row_no"), "reason": "empty"})
                continue
            # 查重：孕妇+疑父 组合
            dup = None
            if mother:
                qs2 = CaseSample.objects.filter(
                    sample__patient_name=mother, role=CaseSample.Role.MOTHER,
                    case__case_number__startswith="NIPPT",
                ).select_related("case").prefetch_related("case__case_samples__sample")
                for cs in qs2:
                    for fcs in cs.case.case_samples.all():
                        if fcs.role == CaseSample.Role.ALLEGED_FATHER and fcs.sample.patient_name == father:
                            dup = cs.case.case_number
                            break
                    if dup:
                        break
            if dup:
                skipped.append({"row_no": item.get("row_no"), "reason": "exists", "case_number": dup})
                continue
            try:
                with transaction.atomic():
                    create_data = {
                        "mother_name": mother,
                        "father_names": [father] if father else [],
                        "father_sample_types": [[item["father_sample_type"] or "BLOOD"]] if father else [],
                        "sample_source": "国内",
                        "report_version": "国内",
                        "sales_person": item["sales_person"] or "",
                        "notes": item["notes"] or "",
                        "external_id": item["external_id"] or "",
                        "applicant": item["applicant"] or "",
                        "phone": item["phone"] or "",
                        "registration_type": "FIRST",
                    }
                    due = parse_iso(item["expected_completion"])
                    if due:
                        create_data["expected_completion"] = due
                    if item["gestational_age_weeks"] is not None:
                        create_data["gestational_age_weeks"] = item["gestational_age_weeks"]
                        create_data["gestational_age_days"] = item["gestational_age_days"] or 0
                    create_serializer = CaseCreateSerializer(data=create_data, context={"request": request})
                    create_serializer.is_valid(raise_exception=True)
                    case = create_serializer.save()
                    # 母样本采集日期 = 申请日期
                    cd = parse_iso(item["collection_date"])
                    if cd:
                        mother_cs = case.case_samples.filter(role=CaseSample.Role.MOTHER).select_related("sample").first()
                        if mother_cs:
                            mother_cs.sample.collection_date = cd
                            mother_cs.sample.save(update_fields=["collection_date", "updated_at"])
                    created.append({"row_no": item.get("row_no"), "case_number": case.case_number})
                    log_audit(request, "CREATE", case, changes={
                        "source": {"old": "", "new": "batch_import_cn"},
                        "row_no": {"old": "", "new": item.get("row_no")},
                    }, entity_type="case", entity_repr=str(case))
            except Exception as e:
                errors.append({"row_no": item.get("row_no"), "error": str(e)[:300]})

        return Response({
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "created_count": len(created),
            "skipped_count": len(skipped),
            "error_count": len(errors),
        })

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser, JSONParser])
    def parse_vn_docs(self, request):
        """越南客户信息表解析：上传 .xlsx，解析并按 S/N 编号查重，不创建数据。"""
        from .nippt_vn_xlsx_parser import (
            parse_vn_xlsx_bytes, NipptVnParseError, repair_truncated_zip, missing_tail_bytes,
        )

        files = request.FILES.getlist("files")
        if not files:
            raise ValidationError("请上传至少一个文件（.xlsx）")

        cases, error_files = [], []
        for f in files:
            fname = f.name
            if not fname.lower().endswith((".xlsx", ".xlsm", ".xls")):
                error_files.append({"file": fname, "error": "仅支持 .xlsx 文件（当前文件扩展名不是 .xlsx/.xlsm/.xls）"})
                continue
            data = b""
            try:
                data = f.read()
                if len(data) > 20 * 1024 * 1024:
                    error_files.append({"file": fname, "error": "文件超过 20MB"})
                    continue
                # ── 内容体检：openpyxl 对 .xls / 空文件 / HTML 都只报同一句 BadZipFile（File is not a zip file），
                #    这里先按文件头把真实原因讲清楚，避免"看不到病因"。 ──
                magic = data[:4]
                if len(data) == 0:
                    error_files.append({
                        "file": fname,
                        "error": "文件内容为空（0 字节）：可能只是快捷方式/别名，或拖拽时没有真正读取到文件"})
                    continue
                if magic[:2] != b"PK":
                    if magic == b"\xd0\xcf\x11\xe0":
                        tip = ("这是 Excel 97-2003 格式（.xls）；越南导入只支持 .xlsx："
                               "请用 Excel/WPS 打开后「另存为 → Excel 工作簿 (*.xlsx)」再上传")
                    elif data[:200].lstrip()[:1] in (b"<", b"{", b"["):
                        tip = ("文件内容看着是网页/文本（不是 Excel）：请确认文件已完整下载"
                               "（微信、邮件里有时给出的是预览页而非原文件）")
                    else:
                        tip = ("文件头不是 PK（.xlsx 的 zip 标志）：文件可能损坏，或不是 Excel 文件")
                    error_files.append({
                        "file": fname,
                        "error": f"{tip}（大小 {len(data)} 字节，文件头 {magic.hex(' ')}）"})
                    continue
                # 尾部截断（微信下载/另存时结尾 0x00 被丢）→ 补 0x00 修复
                # 仅当 EOCD 缺 ≤4 字节且补完能通过 zip 完整性校验（testzip）才接受
                repaired, padded = repair_truncated_zip(data)
                repair_note = ""
                if padded:
                    data = repaired
                    repair_note = f"已修复尾部缺失的 {padded} 字节（数据未受影响）"
                parsed, row_errors = parse_vn_xlsx_bytes(data, fname)
                for r in parsed:
                    r["file"] = fname
                    if repair_note:
                        r["file_repaired"] = repair_note
                cases.extend(parsed)
                for e in row_errors:
                    error_files.append({"file": fname, "row_no": e["row_no"], "error": e["error"]})
            except NipptVnParseError as e:
                error_files.append({"file": fname, "error": str(e)})
            except Exception as e:
                miss = missing_tail_bytes(data)
                tail_hint = (f"；zip 结尾记录缺 {miss} 字节 → 文件被截断，请重新获取/另存该文件"
                             if miss else "")
                error_files.append({
                    "file": fname,
                    "error": f"解析异常: {str(e)[:200]}{tail_hint}（大小 {len(data)} 字节，文件头 {data[:4].hex(' ')}）"})

        # 查重：按 S/N 编号（落在母样本 Sample.external_id 上，Case 本身无此字段）
        from lims.apps.samples.models import Sample
        existing_info = []
        sns = [c.get("external_id") for c in cases if c.get("external_id")]
        if sns:
            hit = {}
            qs = (Sample.objects.filter(external_id__in=sns)
                  .select_related("case_sample__case"))
            for smp in qs:
                cs = getattr(smp, "case_sample", None)
                if cs and cs.case and str(cs.case.case_number).startswith("NIPPT"):
                    hit.setdefault(smp.external_id, cs.case.case_number)
            for c in cases:
                sn = c.get("external_id")
                if sn and sn in hit:
                    existing_info.append({"row_no": c["row_no"], "file": c.get("file", ""), "case_number": hit[sn]})

        return Response({
            "cases": cases,
            "errors": error_files,
            "existing_info": existing_info,
            "case_count": len(cases),
        })

    @action(detail=False, methods=["post"])
    def batch_import_vn(self, request):
        """越南客户信息表批量导入：逐行创建 Case（孕妇 + 单疑父，疑父可多样本），按 S/N 编号查重。"""
        from datetime import datetime as _dt

        serializer = NipptVnBatchImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        def parse_iso(d):
            if not d:
                return None
            try:
                return _dt.strptime(str(d).strip(), "%Y-%m-%d").date()
            except (ValueError, AttributeError):
                return None

        created, skipped, errors = [], [], []
        for item in serializer.validated_data["cases"]:
            mother = (item["mother_name"] or "").strip()
            father = (item["father_name"] or "").strip()
            sn = (item["external_id"] or "").strip()
            if not mother and not father:
                skipped.append({"row_no": item.get("row_no"), "reason": "empty"})
                continue
            # 查重：S/N 编号（与预览口径一致）
            dup = None
            if sn:
                from lims.apps.samples.models import Sample as _Smp
                dup_smp = (_Smp.objects
                           .filter(external_id=sn, case_sample__case__case_number__startswith="NIPPT")
                           .select_related("case_sample__case").first())
                if dup_smp:
                    dup = dup_smp.case_sample.case.case_number
            if dup:
                skipped.append({"row_no": item.get("row_no"), "reason": "exists", "case_number": dup})
                continue
            try:
                with transaction.atomic():
                    ftypes = [t for t in (item["father_sample_types"] or []) if t] or ["BLOOD"]
                    create_data = {
                        "mother_name": mother,
                        "father_names": [father] if father else [],
                        "father_sample_types": [ftypes] if father else [],
                        "sample_source": "越南",
                        "report_version": "英文",
                        "sales_person": item["sales_person"] or "",
                        "notes": item["notes"] or "",
                        "external_id": sn,
                        "applicant": item["applicant"] or "",
                        "registration_type": "FIRST",
                    }
                    due = parse_iso(item.get("expected_completion"))
                    if due:
                        create_data["expected_completion"] = due
                    if item["gestational_age_weeks"] is not None:
                        create_data["gestational_age_weeks"] = item["gestational_age_weeks"]
                        create_data["gestational_age_days"] = item["gestational_age_days"] or 0
                    create_serializer = CaseCreateSerializer(data=create_data, context={"request": request})
                    create_serializer.is_valid(raise_exception=True)
                    case = create_serializer.save()
                    # 采集日期：孕妇（E 列）、疑父（I 列）分别写入
                    mcd = parse_iso(item.get("mother_collection_date"))
                    if mcd:
                        mother_cs = case.case_samples.filter(role=CaseSample.Role.MOTHER).select_related("sample").first()
                        if mother_cs:
                            mother_cs.sample.collection_date = mcd
                            mother_cs.sample.save(update_fields=["collection_date", "updated_at"])
                    fcd = parse_iso(item.get("father_collection_date"))
                    if fcd:
                        for fcs in case.case_samples.filter(role=CaseSample.Role.ALLEGED_FATHER).select_related("sample"):
                            fcs.sample.collection_date = fcd
                            fcs.sample.save(update_fields=["collection_date", "updated_at"])
                    created.append({"row_no": item.get("row_no"), "case_number": case.case_number})
                    log_audit(request, "CREATE", case, changes={
                        "source": {"old": "", "new": "batch_import_vn"},
                        "row_no": {"old": "", "new": item.get("row_no")},
                        "external_id": {"old": "", "new": sn},
                    }, entity_type="case", entity_repr=str(case))
            except Exception as e:
                errors.append({"row_no": item.get("row_no"), "error": str(e)[:300]})

        return Response({
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "created_count": len(created),
            "skipped_count": len(skipped),
            "error_count": len(errors),
        })

    @action(detail=False, methods=["get"])
    def latest_pt(self, request):
        """最新（数字最大）PT 编号 + 全部已用编号：供签收页手编 PT 参考，避免位数错/重复。"""
        import re as _re
        latest_pt, latest_num = "", 0
        existing = set()
        for pt in Case.objects.exclude(pt_number__isnull=True).exclude(pt_number="").values_list("pt_number", flat=True):
            m = _re.search(r"(\d+)", pt or "")
            if not m:
                continue
            n = int(m.group(1))
            existing.add(n)                      # 归一化（去前导零）：02260 与 2260 视为同号
            if n > latest_num:
                latest_num = n
                latest_pt = pt
        return Response({
            "latest_pt": latest_pt,
            "latest_number": latest_num,
            "next_number": latest_num + 1 if latest_num else None,
            "existing": sorted(existing),        # 供前端查重（只提醒不拦）
        })

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

        # ── 强制校验：签收人 + PT 编号 + 图片（签收与拒收均要求）──
        received_by_name = (request.data.get("received_by_name") or "").strip()
        if not received_by_name:
            raise ValidationError("请先选择签收人")
        receipt_location = (request.data.get("receipt_location") or "").strip()
        if not receipt_location:
            raise ValidationError("请先选择签收地")
        if receipt_location not in ("XIAMEN", "HONGKONG"):
            raise ValidationError("签收地无效（仅支持 厦门/香港）")
        pt_number = (request.data.get("pt_number") or "").strip()
        if not pt_number and not case.pt_number:
            raise ValidationError("请先填写 PT 编号")
        has_photo = case.case_samples.exclude(receipt_photo__isnull=True).exclude(receipt_photo="").exists()
        if not has_photo:
            raise ValidationError("请先上传样本图片")

        # Accept receiving metadata
        actual_sample_type = request.data.get("actual_sample_type", "")
        preservation_method = request.data.get("preservation_method", "")

        # Save user-provided PT number to Case (before auto-assign fallback)
        if pt_number and not case.pt_number:
            case.pt_number = pt_number
            case.save(update_fields=["pt_number", "updated_at"])

        cs.confirm_receipt(request.user, condition=condition)
        # 生成样本级 test_sample_id（若缺失）：case.pt_number 手填/自动已存在时，
        # 原逻辑因 all_samples_received and not case.pt_number 条件永不进入，
        # 导致手填 PT 的样本 test_sample_id 永远为空。此处补生成。
        if case.pt_number and not cs.test_sample_id:
            cs.test_sample_id = case.generate_test_sample_id(cs)
            cs.save(update_fields=["test_sample_id"])
        # Save new receiving fields
        if received_by_name:
            cs.received_by_name = received_by_name
            cs.save(update_fields=["received_by_name"])
        if receipt_location:
            cs.receipt_location = receipt_location
            cs.save(update_fields=["receipt_location"])
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

        # Sync Case status from CaseSample states
        case.update_status()

        if case.all_samples_received and not case.pt_number:
            case.assign_pt_number()
            case.save(update_fields=["pt_number", "updated_at"])
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
                last_run = (SampleRun.objects.filter(run_number__startswith=prefix)
                            .order_by("-run_number").values_list("run_number", flat=True).first())
                if last_run:
                    try:
                        seq = int(last_run.rsplit("-", 1)[1]) + 1
                    except (ValueError, IndexError):
                        seq = SampleRun.objects.filter(run_number__startswith=prefix).count() + 1
                else:
                    seq = 1
                run_number = f"{prefix}-{seq:04d}"

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

        log_audit(request, "RECEIVE", cs, changes={
            "receipt_condition": {"old": "", "new": cs.receipt_condition or ""},
            "received_by_name": {"old": "", "new": cs.received_by_name or ""},
            "receipt_location": {"old": "", "new": cs.receipt_location or ""},
            "test_sample_id": {"old": "", "new": cs.test_sample_id or ""},
        }, entity_type="casesample", entity_repr="%s/%s" % (case.case_number, cs.sample_id))

        return Response(CaseSampleSerializer(cs).data)

    @staticmethod
    def _unique_supplement_sample_id(case, role, type_code):
        """补样样本编号：{case_number}-SUP-{M|F}-{类型码}，冲突自动加序号。"""
        prefix = f"{case.case_number}-SUP-{'M' if role == 'MOTHER' else 'F'}-{type_code}"
        sid = prefix
        i = 1
        while Sample.objects.filter(sample_id=sid).exists():
            i += 1
            sid = f"{prefix}-{i}"
        return sid

    @action(detail=True, methods=["post"], url_path="receipt-supplement")
    def receipt_supplement(self, request, pk=None):
        """签收时补录「实收比登记多出」的样本类型 → 按补样新建 CaseSample，并直接计为已签收。

        仅限疑父（ALLEGED_FATHER）；母亲样本走登记/补充样本入口。
        幂等：该人已存在的类型进 skipped，不重复建档。
        新样本 Sample.status=RECEIVED → 直接进入前处理待处理。
        """
        case = self.get_object()
        src_id = (request.data.get("case_sample_id") or "").strip()
        types = request.data.get("sample_types") or []
        if isinstance(types, str):
            types = [types]
        types = list(dict.fromkeys(str(t).strip() for t in types if str(t or "").strip()))
        received_by_name = (request.data.get("received_by_name") or "").strip()
        receipt_location = (request.data.get("receipt_location") or "").strip()
        pt_number = (request.data.get("pt_number") or "").strip()

        if not src_id:
            raise ValidationError("case_sample_id is required")
        if not types:
            raise ValidationError("请至少选择一个实收样本类型")
        invalid = [t for t in types if t not in CaseSample.SampleSource.values]
        if invalid:
            raise ValidationError("无效的样本类型：%s" % "、".join(invalid))
        if not received_by_name:
            raise ValidationError("请先选择签收人")
        if receipt_location not in ("XIAMEN", "HONGKONG"):
            raise ValidationError("请先选择签收地（厦门/香港）")

        src_cs = case.case_samples.filter(id=src_id).select_related("sample").first()
        if not src_cs:
            raise NotFound("CaseSample not found in this case")
        if src_cs.role != CaseSample.Role.ALLEGED_FATHER:
            raise ValidationError("仅疑父样本支持补录实收类型，母亲样本请在登记/补充样本入口处理")
        if src_cs.receipt_condition == "REJECTED" or src_cs.sample.status == "REJECTED":
            raise ValidationError("该样本已拒收，无法补录实收类型")

        # PT 编号（与签收口径一致：行上填的优先，写回案例）
        if pt_number and not case.pt_number:
            case.pt_number = pt_number
            case.save(update_fields=["pt_number", "updated_at"])
        if not case.pt_number:
            raise ValidationError("请先填写 PT 编号再补录实收类型")

        # 该人（同 role + 同姓名）已有的类型集合 → 只有「未登记」的类型才建档
        person_css = list(
            case.case_samples.filter(
                role=src_cs.role, sample__patient_name=src_cs.sample.patient_name
            ).select_related("sample")
        )
        existing = set()
        for cs_x in person_css:
            if (cs_x.sample_source or "").strip():
                existing.add(cs_x.sample_source.strip())
            if cs_x.effective_sample_type:
                existing.add(cs_x.effective_sample_type)
        extras = [t for t in types if t not in existing]
        skipped = [t for t in types if t in existing]

        created = []
        if extras:
            sample_type, _ = SampleType.objects.get_or_create(
                code="BLOOD", defaults={"name": "Peripheral Blood"}
            )
            now = timezone.now()
            with transaction.atomic():
                for t in extras:
                    sid = self._unique_supplement_sample_id(case, src_cs.role, t)
                    s = Sample.objects.create(
                        sample_id=sid,
                        sample_type=sample_type,
                        panel=case.panel,
                        patient_name=src_cs.sample.patient_name,
                        patient_sex=src_cs.sample.patient_sex,
                        patient_dob=src_cs.sample.patient_dob,
                        external_id=src_cs.sample.external_id,
                        fedex_no=src_cs.sample.fedex_no,
                        sample_source=case.origin_country(),
                        collection_date=now.date(),
                        receipt_date=now.date(),
                        receipt_time=now.time(),
                        status="RECEIVED",
                        site=case.site,
                        created_by=request.user,
                    )
                    new_cs = CaseSample.objects.create(
                        case=case,
                        sample=s,
                        role=src_cs.role,
                        sample_source=t,
                        actual_sample_type=t,
                        workflow_stage="RECEIVED",
                        received_at=now,
                        received_by=request.user,
                        received_by_name=received_by_name,
                        receipt_location=receipt_location,
                        receipt_condition="OK",
                        arrival_date=now.date(),
                        collection_notes=f"签收补录实收类型（签收人：{received_by_name}）",
                    )
                    # 与补样登记同一口径：撞号自动按重采给 _R{n}
                    case.assign_supplement_test_id(new_cs, save=False)
                    new_cs.save(update_fields=["test_sample_id", "resample_of", "resample_number"])
                    created.append(new_cs)

                labels = "、".join(
                    (cs.get_sample_source_display() or cs.sample_source) for cs in created
                )
                case.notes = (case.notes + "\n" if case.notes else "") + \
                    f"[签收补登] 实收多出 {labels}（签收人：{received_by_name}）"
                case.save(update_fields=["notes", "updated_at"])
                case.update_status()

        for nc in created:
            log_audit(request, "CREATE", nc, changes={
                "sample_source": {"old": "", "new": nc.sample_source},
                "actual_sample_type": {"old": "", "new": nc.actual_sample_type or ""},
                "test_sample_id": {"old": "", "new": nc.test_sample_id or ""},
                "received_by_name": {"old": "", "new": nc.received_by_name or ""},
                "来源": {"old": "", "new": "签收补录"},
            }, entity_type="casesample",
                entity_repr="%s/%s" % (case.case_number, nc.sample_id))

        return Response({
            "created": [{
                "cs_id": str(cs.id),
                "sample_id": cs.sample.sample_id,
                "sample_source": cs.sample_source,
                "sample_source_display": cs.get_sample_source_display() or cs.sample_source,
                "test_sample_id": cs.test_sample_id or "",
            } for cs in created],
            "skipped": skipped,
        }, status=status.HTTP_201_CREATED)

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

        # Sync Case status from CaseSample states
        case.update_status()

        log_audit(request, "REJECT", cs, changes={
            "rejection_reason": {"old": "", "new": rejection_reason},
            "rejection_note": {"old": "", "new": rejection_note},
            "status": {"old": "", "new": "REJECTED"},
        }, entity_type="casesample", entity_repr="%s/%s" % (case.case_number, cs.sample_id))

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
    def redo(self, request, pk=None):
        """重做：创建新 CaseSample (T后缀) + 管道记录，进入目标模块 pending 列表."""
        from django.db.models import Max, F
        from django.db import transaction
        from lims.apps.samples.models import Sample
        
        case = self.get_object()
        original_cs_id = request.data.get("original_case_sample_id")
        target_stage = request.data.get("target_stage") or "PRE_PROCESSING"
        sample_source = request.data.get("sample_source", "BLOOD")
        use_cs_id = request.data.get("use_case_sample_id")
        
        if not original_cs_id:
            raise ValidationError("original_case_sample_id required")
        
        original_cs = case.case_samples.filter(id=original_cs_id).first()
        if not original_cs:
            raise NotFound("CaseSample not found")

        # ── 方式二：用该男性的其他样本做 —— 激活目标样本进入前处理待做，原失败样本保持显示并失活 ──
        if use_cs_id:
            target_cs = case.case_samples.filter(id=use_cs_id).exclude(id=original_cs.id).first()
            if not target_cs:
                raise ValidationError("use_case_sample_id not found in this case")
            with transaction.atomic():
                target_cs.reactivated = True
                target_cs.workflow_stage = "PRE_PROCESSING"
                target_cs.save(update_fields=["reactivated", "workflow_stage", "updated_at"])
                if target_cs.sample and target_cs.sample.status == "PRE_PROCESSED":
                    target_cs.sample.status = "RECEIVED"
                    target_cs.sample.save(update_fields=["status", "updated_at"])
                original_cs.is_active = False
                original_cs.save(update_fields=["is_active"])
                WorkflowLog.objects.create(
                    case_sample=target_cs, stage="PRE_PROCESSING", action="REACTIVATE",
                    operator=request.user,
                    note=f"重做：由 {original_cs.test_sample_id or original_cs.sample_id} 激活进入前处理"
                )
                case.update_status()
            return Response(CaseSampleSerializer(target_cs).data, status=201)
        
        # 检查血液管数
        if sample_source in ("BLOOD", "DBS"):
            pp_sample = NipptPreProcessingSample.objects.filter(
                case_sample_ids__contains=[str(original_cs.id)]
            ).order_by("-created_at").first()
            if not pp_sample or pp_sample.aliquot_tubes <= 0:
                raise ValidationError("No remaining blood tubes available")
            before_tubes = pp_sample.aliquot_tubes
            pp_sample.aliquot_tubes = F("aliquot_tubes") - 1
            pp_sample.save(update_fields=["aliquot_tubes"])
            if pp_sample.role == "MOTHER":
                from .models import NipptPlasmaTubeLog
                NipptPlasmaTubeLog.objects.create(
                    case=case, case_sample=original_cs,
                    before_count=before_tubes, after_count=max(0, before_tubes - 1),
                    reason="重做使用", operator=request.user,
                )
        
        max_n = CaseSample.objects.filter(redo_of=original_cs).aggregate(m=Max("redo_count"))["m"]
        next_n = (max_n or 0) + 1
        
        with transaction.atomic():
            new_sample = Sample.objects.create(
                sample_id=f"{case.case_number}-REDO-T{next_n}",
                sample_type=original_cs.sample.sample_type,
                panel=case.panel, patient_name=original_cs.sample.patient_name,
                patient_sex=original_cs.sample.patient_sex,
                sample_source=(original_cs.sample.sample_source or case.origin_country()),
                status="RECEIVED", site=case.site,
                collection_date=timezone.now().date(),
                receipt_date=timezone.now().date(),
                receipt_time=timezone.now().time(),
                created_by=request.user,
            )
            new_cs = CaseSample.objects.create(
                case=case, sample=new_sample, role=original_cs.role,
                sample_source=sample_source,
                redo_of=original_cs, redo_count=next_n,
                workflow_stage=target_stage,
                # 重做沿用原样本的签收地，否则候选列表/批次里看不到 📍 标签
                receipt_location=original_cs.receipt_location,
            )
            new_cs.test_sample_id = case.generate_test_sample_id(
                new_cs, resample_num=original_cs.resample_number, redo_num=next_n)
            new_cs.save(update_fields=["test_sample_id"])
            
            register_redo_samples(original_cs, target_stage, new_cs, request.user, sample_source)

            original_cs.is_active = False
            original_cs.save(update_fields=["is_active"])
            case.update_status()
            
            WorkflowLog.objects.create(
                case_sample=new_cs, stage=target_stage, action="REDO",
                operator=request.user,
                note=f"Redo #{next_n} from {original_cs.test_sample_id or 'unknown'}"
            )
        
        return Response(CaseSampleSerializer(new_cs).data, status=201)

    @action(detail=True, methods=["get"])
    def audit_logs(self, request, pk=None):
        """案例的审计日志：case 级 + 其所有样本(casesample)级合并，最新在上。"""
        from django.db.models import Q
        from lims.apps.audit.models import AuditLog

        case = self.get_object()
        cs_ids = [cs.id for cs in case.case_samples.all()]

        ACTION_DISPLAY = {
            "CREATE": "登记建档", "RECEIVE": "签收", "REJECT": "拒收",
            "UPDATE": "修改", "DELETE": "删除", "IMPORT": "批量导入",
        }

        qs = AuditLog.objects.filter(
            Q(entity_type="case", entity_id=case.id)
            | Q(entity_type__in=["casesample", "case_sample"], entity_id__in=cs_ids)
        )
        # 站点隔离（与 AuditLogViewSet 一致）
        if getattr(request.user, "site_id", None):
            qs = qs.filter(Q(site_id=request.user.site_id) | Q(site_id__isnull=True))

        out = []
        for a in qs.order_by("-timestamp", "-id")[:500]:
            label = ACTION_DISPLAY.get(a.action, a.action)
            # 批量导入的 CREATE 更准确地标为「批量导入」
            src = (a.changes or {}).get("source", {})
            src_val = src.get("new") if isinstance(src, dict) else None
            if a.action == "CREATE" and src_val in ("batch_import_nippt", "batch_import_cn"):
                label = "批量导入"

            changes = []
            for field, delta in (a.changes or {}).items():
                if field in ("source", "seq", "row_no"):
                    continue
                if isinstance(delta, dict):
                    old, new = delta.get("old"), delta.get("new")
                else:
                    old, new = None, delta
                changes.append({
                    "field": field,
                    "old": "" if old is None else str(old),
                    "new": "" if new is None else str(new),
                })

            out.append({
                "id": a.id,
                "action": a.action,
                "action_display": label,
                "timestamp": a.timestamp,
                "user": a.user_email or "",
                "user_role": a.user_role or "",
                "entity_type": a.entity_type,
                "entity_repr": a.entity_repr or "",
                "entity_id": str(a.entity_id),
                "changes": changes,
                "row_hash": a.row_hash,
                "previous_hash": a.previous_hash,
            })
        return Response({"count": len(out), "results": out})

    @action(detail=True, methods=["get"])
    def sample_history(self, request, pk=None):
        """返回 Case 下每个 CaseSample 的实验历史."""
        from collections import defaultdict
        from .models import WorkflowLog
        case = self.get_object()
        logs = WorkflowLog.objects.filter(
            case_sample__case=case
        ).select_related("case_sample").order_by("created_at")
        
        history = {}
        # 1. Prep：签收记录作为第一条 stage
        for cs in case.case_samples.all():
            if cs.received_at is None:
                continue
            cs_id = str(cs.id)
            history[cs_id] = {
                "test_sample_id": cs.test_sample_id or "",
                "stages": [{
                    "stage": "RECEIVED", "action": cs.receipt_condition or "签收",
                    "timestamp": str(cs.received_at), "batch_number": "",
                    "pt_number": cs.test_sample_id or cs.case.pt_number or "",
                    "receipt_photo_url": cs.receipt_photo.url if cs.receipt_photo else "",
                    "received_by": cs.received_by_name or (cs.received_by.username if cs.received_by else ""),
                    "condition": cs.receipt_condition or "OK",
                    "receipt_note": cs.receipt_note or "",
                    "receipt_location": cs.get_receipt_location_display() if cs.receipt_location else "",
                }]
            }

        # 2. 追加 WorkflowLog 条目（同 阶段+动作+批次 合并，保留最后一次）
        merged = {}          # (cs_id, stage, action, batch_number) -> [第一/最后时间戳, 次数]
        for log in logs:
            cs_id = str(log.case_sample_id)
            if cs_id not in history:
                history[cs_id] = {"test_sample_id": log.case_sample.test_sample_id or "", "stages": []}
            bn = (log.batch_number or "").strip()
            key = (cs_id, log.stage, log.action, bn)
            if key in merged:
                rec = merged[key]
                rec["count"] += 1
                rec["last_ts"] = str(log.created_at)
            else:
                extra = self._stage_extras(log)
                rec = {
                    "count": 1,
                    "first_ts": str(log.created_at),
                    "last_ts": str(log.created_at),
                    "entry": {
                        "stage": log.stage, "action": log.action,
                        "batch_number": bn,
                        "timestamp": str(log.created_at),
                        **extra,
                    },
                }
                merged[key] = rec
                history[cs_id]["stages"].append(rec)

        # 3. 收尾：把内部记录展开成响应结构（含重复次数、首次时间、孤儿批次标注）
        for cs_id, h in history.items():
            stages = []
            for rec in h["stages"]:
                if "entry" not in rec:
                    # 签收记录等直接构造的条目：补默认字段后原样保留
                    rec.setdefault("repeat_count", 1)
                    rec.setdefault("first_timestamp", rec.get("timestamp", ""))
                    rec.setdefault("batch_deleted", False)
                    stages.append(rec)
                    continue
                e = rec["entry"]
                e["repeat_count"] = rec["count"]
                e["first_timestamp"] = rec["first_ts"]
                # 孤儿批次：日志引用的批次已不存在（批次被删除，未清理日志）
                if e.get("batch_number"):
                    e["batch_deleted"] = self._batch_missing(e["stage"], e["batch_number"])
                else:
                    e["batch_deleted"] = False
                stages.append(e)
            h["stages"] = stages
        return Response(history)

    def _batch_missing(self, stage, batch_number):
        """该 stage 下的 batch_number 是否已不存在（批次被删除）。"""
        from .models import (NipptPreProcessingBatch, NipptExtractionBatch,
                             NipptLibraryBatch, NipptPoolingBatch,
                             NipptHybSeqBatch, NipptBioinfoBatch)
        MAP = {
            "PRE_PROCESSING": NipptPreProcessingBatch,
            "EXTRACTION": NipptExtractionBatch,
            "LIBRARY_PREP": NipptLibraryBatch,
            "POOLING": NipptPoolingBatch,
            "HYB_SEQ": NipptHybSeqBatch,
            "BIOINFO": NipptBioinfoBatch,
        }
        M = MAP.get(stage)
        if M is None:
            return False
        try:
            return not M.objects.filter(batch_number=batch_number).exists()
        except Exception:
            return False

    def _stage_extras(self, log):
        """各步骤的质控结果/备注/实验人/审核人/照片（前处理/提取/文库按样本取，混样步骤批次级）"""
        from .models import (NipptPreProcessingBatch, NipptExtractionBatch,
                             NipptLibraryBatch, NipptPoolingBatch,
                             NipptHybSeqBatch, NipptBioinfoBatch)
        out = {"qc_status": "", "qc_note": "", "operator": "", "reviewer": "", "photos": []}
        cs = log.case_sample
        is_mother = bool(cs and cs.role == "MOTHER")
        bn = (log.batch_number or "").strip()
        if not bn:
            return out
        csid = str(cs.id) if cs else ""

        def _find_sp(batch):
            for x in batch.samples.all():
                ids = x.case_sample_ids or []
                if csid and csid in [str(i) for i in ids]:
                    return x
            return None

        try:
            if log.stage == "PRE_PROCESSING":
                b = NipptPreProcessingBatch.objects.filter(batch_number=bn).first()
                if b:
                    pd = b.processing_data or {}
                    sp = _find_sp(b)
                    if sp:
                        out["qc_status"] = sp.qc_status or ""
                        out["qc_note"] = sp.qc_note or ""
                    out["operator"] = ((pd.get("operator_female") if is_mother else pd.get("operator_male")) or b.operator_name or "")
                    out["reviewer"] = ((pd.get("reviewer_female") if is_mother else pd.get("reviewer_male")) or b.reviewer or "")
                    out["photos"] = list((pd.get("photos_female") if is_mother else pd.get("photos_male")) or pd.get("photos") or [])
            elif log.stage == "EXTRACTION":
                b = NipptExtractionBatch.objects.filter(batch_number=bn).first()
                if b:
                    ed = b.extraction_data or {}
                    sp = _find_sp(b)
                    if sp:
                        out["qc_status"] = sp.qc_status or ""
                        out["qc_note"] = sp.qc_note or ""
                    out["operator"] = ((ed.get("operator_female") if is_mother else ed.get("operator_male")) or b.operator_name or "")
                    out["reviewer"] = ((ed.get("reviewer_female") if is_mother else ed.get("reviewer_male")) or b.reviewer or "")
                    out["photos"] = list((ed.get("photos_female") if is_mother else ed.get("photos_male")) or ed.get("photos") or [])
            elif log.stage == "LIBRARY_PREP":
                b = NipptLibraryBatch.objects.filter(batch_number=bn).first()
                if b:
                    ld = b.library_data or {}
                    sp = _find_sp(b)
                    if sp:
                        out["qc_status"] = sp.qc_status or ""
                        out["qc_note"] = sp.qc_note or ""
                    out["operator"] = ((ld.get("operator_female") if is_mother else ld.get("operator_male")) or b.operator_name or "")
                    out["reviewer"] = ((ld.get("reviewer_female") if is_mother else ld.get("reviewer_male")) or b.reviewer or "")
                    out["photos"] = list((ld.get("photos_female") if is_mother else ld.get("photos_male")) or ld.get("photos") or [])
            else:
                # 混样/下游步骤：批次级实验人/审核人
                for M in (NipptPoolingBatch, NipptHybSeqBatch, NipptBioinfoBatch):
                    b = M.objects.filter(batch_number=bn).first()
                    if b:
                        out["operator"] = getattr(b, "operator_name", "") or ""
                        out["reviewer"] = getattr(b, "reviewer", "") or ""
                        break
        except Exception:
            pass
        return out

    @action(detail=True, methods=["post"])
    def resample(self, request, pk=None):
        """Create a resample for a rejected CaseSample."""
        from django.db.models import Max, Q

        case = self.get_object()
        case_sample_id = request.data.get("case_sample_id")
        patient_name = request.data.get("patient_name", "").strip()
        sample_source = request.data.get("sample_source", "BLOOD")
        notes = (request.data.get("notes", "") or "").strip()
        ga_weeks = request.data.get("gestational_age_weeks")
        ga_days = request.data.get("gestational_age_days")

        # 兼容多类型：sample_source 可能是列表（重采换类型，如血液→口拭子）
        if isinstance(sample_source, list):
            sample_source = sample_source[0] if sample_source else "BLOOD"

        if not case_sample_id:
            raise ValidationError("case_sample_id is required")

        original_cs = case.case_samples.filter(id=case_sample_id).first()
        if not original_cs:
            raise NotFound("CaseSample not found in this case")

        # Determine next resample number — Case 级全局唯一
        # （sample_id 为 {case_number}-RESAMPLE-{n}，不同原样本的重采也必须全局递增，否则撞唯一键）
        max_existing = case.case_samples.filter(
            resample_number__isnull=False
        ).aggregate(m=Max("resample_number"))["m"]
        next_num = (max_existing or 0) + 1

        if not patient_name:
            patient_name = (original_cs.sample.patient_name or "") if original_cs.sample else ""

        # 孕妇重采：孕周更新 Case（旧值轨迹记入备注，便于统计重采时孕周）
        ga_note = ""
        if original_cs.role == "MOTHER" and ga_weeks is not None:
            old_ga = f"{case.gestational_age_weeks or 0}周{case.gestational_age_days or 0}天"
            new_ga = f"{ga_weeks}周{ga_days or 0}天"
            if old_ga != new_ga:
                ga_note = f"[重采] 孕周 {old_ga} → {new_ga}"
                case.gestational_age_weeks = ga_weeks
                case.gestational_age_days = ga_days or 0
                case.save(update_fields=["gestational_age_weeks", "gestational_age_days"])

        final_notes = " | ".join(x for x in [notes, ga_note] if x)

        with transaction.atomic():
            sample_type = original_cs.sample.sample_type
            new_sample = Sample.objects.create(
                sample_id=f"{case.case_number}-RESAMPLE-{next_num}",
                sample_type=sample_type,
                panel=case.panel,
                patient_name=patient_name,
                patient_sex=original_cs.sample.patient_sex,
                sample_source=(original_cs.sample.sample_source or case.origin_country()),
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
                collection_notes=final_notes,
            )
            new_cs.test_sample_id = case.generate_test_sample_id(new_cs, resample_num=next_num)
            new_cs.save(update_fields=["test_sample_id"])
            # 备注同步案例级 Case.notes（签收页"登记备注"列与案例管理共用）
            if final_notes:
                case.notes = (case.notes + "\n" if case.notes else "") + f"[重采] {final_notes}"
                case.save(update_fields=["notes", "updated_at"])

        case.update_status()
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

        if case.status not in ("REGISTERED", "RECEIVED"):
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
            status__in=["PRE_PROCESSING","EXTRACTION","LIBRARY_PREP","POOLING","HYB_SEQ","BIOINFO","REPORT_DRAFT","RECEIVED"],
        ).count()
        incomplete_cases = 0
        for case in qs.filter(status="RECEIVED"):
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
            "rejected": all_css.filter(sample__status="REJECTED").count(),
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
        # Stage detail: top 20 samples per stage
        stage_detail = {}
        for stage in ["REGISTERED","RECEIVED","PRE_PROCESSING","EXTRACTION",
                       "LIBRARY_PREP","POOLING","HYB_SEQ","BIOINFO","REPORT_DRAFT","COMPLETED"]:
            css = all_css.filter(workflow_stage=stage, is_active=True).select_related("case","sample")[:100]
            stage_detail[stage] = [{
                "case_id": str(cs.case_id), "case_number": cs.case.case_number,
                "pt_number": cs.case.pt_number or "", "patient_name": cs.sample.patient_name or "",
                "sample_source": cs.sample_source, "test_sample_id": cs.test_sample_id or "",
                "updated_at": str(cs.updated_at),
            } for cs in css]
        # Rejected
        rj = all_css.filter(sample__status="REJECTED").select_related("case","sample")[:100]
        stage_detail["REJECTED"] = [{
            "case_id": str(cs.case_id), "case_number": cs.case.case_number,
            "patient_name": cs.sample.patient_name or "", "sample_source": cs.sample_source,
            "test_sample_id": cs.test_sample_id or "", "updated_at": str(cs.updated_at),
        } for cs in rj]

        # Urgent / near-deadline detail (top 20)
        def _case_brief(c):
            m = c.mother_sample
            return {
                "case_id": str(c.id), "case_number": c.case_number,
                "pt_number": c.pt_number or "", "status": c.status,
                "mother_name": (m.sample.patient_name if m and m.sample else "") or "",
                "expected_completion": str(c.expected_completion or ""),
                "created_at": str(c.created_at),
            }
        urgent_detail = [_case_brief(c) for c in qs.filter(is_urgent=True).order_by("-created_at")[:20]]
        deadline_detail = [_case_brief(c) for c in qs.filter(
            expected_completion__lte=now + timezone.timedelta(days=2),
            status__in=["PRE_PROCESSING","EXTRACTION","LIBRARY_PREP","POOLING","HYB_SEQ","BIOINFO","REPORT_DRAFT","RECEIVED"],
        ).order_by("expected_completion")[:20]]

        return Response({
            "total_cases": qs.count(),
            "total_samples": CaseSample.objects.count(),
            "case_status": status_counts,
            "urgent": urgent,
            "near_deadline": near_deadline,
            "incomplete_pairs": incomplete_cases,
            "today_expected": today_expected,
            "workflow_stages": stage_counts,
            "stage_detail": stage_detail,
            "urgent_detail": urgent_detail,
            "deadline_detail": deadline_detail,
        })

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """可筛选统计：时间范围(登记/签收) x 维度(孕周/销售/来源/单双胎/状态)"""
        from django.db.models import Count
        qs = self.get_queryset()
        dim = (request.query_params.get("dimension") or "gestational_age").strip()
        time_type = (request.query_params.get("time_type") or "created").strip()
        start = (request.query_params.get("start") or "").strip()
        end = (request.query_params.get("end") or "").strip()

        if start or end:
            if time_type == "received":
                if start: qs = qs.filter(case_samples__received_at__date__gte=start).distinct()
                if end: qs = qs.filter(case_samples__received_at__date__lte=end).distinct()
            else:
                if start: qs = qs.filter(created_at__date__gte=start)
                if end: qs = qs.filter(created_at__date__lte=end)

        total = qs.count()
        STATUS_MAP = {"REGISTERED":"已登记","RECEIVED":"已签收","PRE_PROCESSING":"前处理",
            "EXTRACTION":"提取中","LIBRARY_PREP":"建库中","POOLING":"Pooling",
            "HYB_SEQ":"测序中","BIOINFO":"生信中","REPORT_DRAFT":"报告草稿",
            "COMPLETED":"已完成","HAS_FAILURE":"有失败","HAS_RESAMPLE":"有重采","REJECTED":"已拒收","CANCELLED":"已取消"}

        if dim == "sales_person":
            rows = qs.values("sales_person").annotate(n=Count("id")).order_by("-n")
            buckets = [{"label": (r["sales_person"] or "未填写"), "count": r["n"]} for r in rows]
        elif dim == "case_source":
            rows = qs.filter(case_samples__role="MOTHER").values(
                "case_samples__sample__sample_source"
            ).annotate(n=Count("id", distinct=True)).order_by("-n")
            buckets = [{"label": (r["case_samples__sample__sample_source"] or "未填写"), "count": r["n"]} for r in rows]
        elif dim == "multiple_gestation":
            rows = qs.values("multiple_gestation").annotate(n=Count("id")).order_by("-n")
            buckets = [{"label": {True: "双胎", False: "单胎"}.get(r["multiple_gestation"], "未填写"), "count": r["n"]} for r in rows]
        elif dim == "status":
            rows = qs.values("status").annotate(n=Count("id")).order_by("-n")
            buckets = [{"label": STATUS_MAP.get(r["status"], r["status"] or "未填写"), "count": r["n"]} for r in rows]
        else:  # gestational_age
            rows = qs.values("gestational_age_weeks").annotate(n=Count("id")).order_by("-n")
            buckets = [{"label": f"{r['gestational_age_weeks']}周" if r["gestational_age_weeks"] is not None else "未填写", "count": r["n"]} for r in rows]

        return Response({"total": total, "dimension": dim, "buckets": buckets})


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

    if case.status not in ("REGISTERED", "RECEIVED"):
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
    # ⚠️ 普通阶段推进只作用于 is_active=True 的样本：
    # 被重做/重采替代的样本（is_active=False）已经退出主流程，批次重建/重入时
    # 不应再把它们的阶段重置（曾把 POOLING_FAILED 覆盖成 POOLING，失败模块查不到）。
    # 失败标记 *_FAILED 例外——照写，保证"哪个模块失败"始终可追溯（用户 2026-10-13）。
    _qs = CaseSample.objects.filter(id__in=case_sample_ids)
    if not stage.endswith("_FAILED"):
        _qs = _qs.filter(is_active=True)
    _ids = list(_qs.values_list("id", flat=True))
    if _ids:
        CaseSample.objects.filter(id__in=_ids).update(workflow_stage=stage)
        WorkflowLog.objects.bulk_create([
            WorkflowLog(case_sample_id=cid, stage=stage, action=action, batch_number=batch_num, operator=operator)
            for cid in _ids
        ])
    if stage == "COMPLETED":
        for cs in CaseSample.objects.filter(id__in=case_sample_ids).select_related("case"):
            if cs.role == "MOTHER":
                CaseSample.objects.filter(case=cs.case, role="ALLEGED_FATHER", workflow_stage="PENDING_ACTIVATION").update(
                    workflow_stage="CANCELLED", is_active=False
                )
    # Sync Case status（样本阶段变化后同步案例级状态）
    from .models import sync_case_status_for_samples
    sync_case_status_for_samples(case_sample_ids)

def register_redo_samples(case_sample, target_stage, new_cs, operator, sample_source):
    """Create upstream module Sample records so the redo'd sample appears in pending lists."""
    from .models import (
        NipptPreProcessingBatch, NipptPreProcessingSample,
        NipptExtractionBatch, NipptExtractionSample,
        NipptLibraryBatch, NipptLibrarySample,
        NipptPoolingBatch, NipptPoolingSample,
        NipptHybSeqBatch, NipptHybSeqSample,
        WorkflowLog,
    )
    def _find_batch(model_class, fallback_cls):
        obj = model_class.objects.filter(
            case_sample_ids__contains=[str(case_sample.id)]
        ).order_by("-created_at").first()
        if obj:
            return obj.batch
        return fallback_cls.objects.filter(status="COMPLETED").first()

    base = dict(
        case=case_sample.case,
        patient_name=case_sample.sample.patient_name,
        role=case_sample.role,
        case_sample_ids=[str(new_cs.id)],
        qc_status="PASS",
        category="FEMALE_BLOOD" if case_sample.role=="MOTHER"
                 else ("MALE_BLOOD" if sample_source == "BLOOD" else "MALE_OTHER"),
    )
    logs = []

    if target_stage == "PRE_PROCESSING":
        # 重做回前处理：不预建记录（样本经 sample.status=RECEIVED 出现在前处理待做列表），
        # 由实验人员实际建批次时录入；主流程已写 REDO 日志。reactivated 标志在入批次时清除。
        pass

    elif target_stage == "EXTRACTION":
        pp = NipptPreProcessingSample.objects.create(
            batch=_find_batch(NipptPreProcessingSample, NipptPreProcessingBatch),
            experiment_sample_type=sample_source, aliquot_tubes=1, **base)
        logs.append(WorkflowLog(case_sample=new_cs, stage="PRE_PROCESSING",
            action="ENTER", batch_number=pp.batch.batch_number,
            batch_sample_id=str(pp.id), operator=operator))
    
    elif target_stage == "LIBRARY_PREP":
        pp = NipptPreProcessingSample.objects.create(
            batch=_find_batch(NipptPreProcessingSample, NipptPreProcessingBatch),
            experiment_sample_type=sample_source, aliquot_tubes=0, **base)
        es = NipptExtractionSample.objects.create(
            batch=_find_batch(NipptExtractionSample, NipptExtractionBatch),
            source_preprocessing_sample_id=pp.id,
            **{k:v for k,v in base.items() if k!="batch"})
        logs.append(WorkflowLog(case_sample=new_cs, stage="PRE_PROCESSING",
            action="ENTER", batch_number=pp.batch.batch_number,
            batch_sample_id=str(pp.id), operator=operator))
        logs.append(WorkflowLog(case_sample=new_cs, stage="EXTRACTION",
            action="ENTER", batch_number=es.batch.batch_number,
            batch_sample_id=str(es.id), operator=operator))
    
    elif target_stage == "POOLING":
        pp = NipptPreProcessingSample.objects.create(
            batch=_find_batch(NipptPreProcessingSample, NipptPreProcessingBatch),
            experiment_sample_type=sample_source, aliquot_tubes=0, **base)
        es = NipptExtractionSample.objects.create(
            batch=_find_batch(NipptExtractionSample, NipptExtractionBatch),
            source_preprocessing_sample_id=pp.id,
            **{k:v for k,v in base.items() if k!="batch"})
        ls = NipptLibrarySample.objects.create(
            batch=_find_batch(NipptLibrarySample, NipptLibraryBatch),
            source_extraction_sample_id=es.id,
            **{k:v for k,v in base.items() if k!="batch"})
        for s, stage in [(pp,"PRE_PROCESSING"),(es,"EXTRACTION"),(ls,"LIBRARY_PREP")]:
            logs.append(WorkflowLog(case_sample=new_cs, stage=stage,
                action="ENTER", batch_number=s.batch.batch_number,
                batch_sample_id=str(s.id), operator=operator))
    
    elif target_stage == "HYB_SEQ":
        pp = NipptPreProcessingSample.objects.create(
            batch=_find_batch(NipptPreProcessingSample, NipptPreProcessingBatch),
            experiment_sample_type=sample_source, aliquot_tubes=0, **base)
        es = NipptExtractionSample.objects.create(
            batch=_find_batch(NipptExtractionSample, NipptExtractionBatch),
            source_preprocessing_sample_id=pp.id,
            **{k:v for k,v in base.items() if k!="batch"})
        ls = NipptLibrarySample.objects.create(
            batch=_find_batch(NipptLibrarySample, NipptLibraryBatch),
            source_extraction_sample_id=es.id,
            **{k:v for k,v in base.items() if k!="batch"})
        ps = NipptPoolingSample.objects.create(
            batch=_find_batch(NipptPoolingSample, NipptPoolingBatch),
            source_library_sample_id=ls.id,
            **{k:v for k,v in base.items() if k!="batch"})
        for s, stage in [(pp,"PRE_PROCESSING"),(es,"EXTRACTION"),
                         (ls,"LIBRARY_PREP"),(ps,"POOLING")]:
            logs.append(WorkflowLog(case_sample=new_cs, stage=stage,
                action="ENTER", batch_number=s.batch.batch_number,
                batch_sample_id=str(s.id), operator=operator))
    
    elif target_stage == "BIOINFO":
        pp = NipptPreProcessingSample.objects.create(
            batch=_find_batch(NipptPreProcessingSample, NipptPreProcessingBatch),
            experiment_sample_type=sample_source, aliquot_tubes=0, **base)
        es = NipptExtractionSample.objects.create(
            batch=_find_batch(NipptExtractionSample, NipptExtractionBatch),
            source_preprocessing_sample_id=pp.id,
            **{k:v for k,v in base.items() if k!="batch"})
        ls = NipptLibrarySample.objects.create(
            batch=_find_batch(NipptLibrarySample, NipptLibraryBatch),
            source_extraction_sample_id=es.id,
            **{k:v for k,v in base.items() if k!="batch"})
        ps = NipptPoolingSample.objects.create(
            batch=_find_batch(NipptPoolingSample, NipptPoolingBatch),
            source_library_sample_id=ls.id,
            **{k:v for k,v in base.items() if k!="batch"})
        hs = NipptHybSeqSample.objects.create(
            batch=_find_batch(NipptHybSeqSample, NipptHybSeqBatch),
            source_pooling_sample_id=ps.id,
            **{k:v for k,v in base.items() if k!="batch"})
        for s, stage in [(pp,"PRE_PROCESSING"),(es,"EXTRACTION"),
                         (ls,"LIBRARY_PREP"),(ps,"POOLING"),(hs,"HYB_SEQ")]:
            logs.append(WorkflowLog(case_sample=new_cs, stage=stage,
                action="ENTER", batch_number=s.batch.batch_number,
                batch_sample_id=str(s.id), operator=operator))
    
    if logs:
        WorkflowLog.objects.bulk_create(logs)


def advance_batch(batch, next_stage, operator=None, failed_stage=None):
    passed, failed = [], []
    for s in batch.samples.all():
        if not s.case_sample_ids: continue
        ids = list(s.case_sample_ids)
        if s.qc_status == "PASS": passed.extend(ids)
        else: failed.extend(ids)
    if passed: update_wf(passed, next_stage, "COMPLETE", batch.batch_number, operator)
    if failed: update_wf(failed, f"{failed_stage or next_stage}_FAILED", "FAIL", batch.batch_number, operator)
    # Sync Case status
    all_ids = set(passed + failed)
    if all_ids:
        case_ids = set(CaseSample.objects.filter(id__in=all_ids).values_list("case_id", flat=True))
        for cid in case_ids:
            try: Case.objects.get(id=cid).update_status()
            except Case.DoesNotExist: pass

# ══════════════════════════════════════════
# NIPPT 批次删除：阶段回退 + 下游引用保护 + 审计
# ══════════════════════════════════════════

NIPPT_STAGE_BEFORE = {
    "EXTRACTION": "PRE_PROCESSING",
    "LIBRARY_PREP": "EXTRACTION",
    "POOLING": "LIBRARY_PREP",
    "HYB_SEQ": "POOLING",
    "BIOINFO": "HYB_SEQ",
}
NIPPT_STAGE_LABEL = {
    "REGISTERED": "已登记", "RECEIVED": "已签收",
    "PRE_PROCESSING": "前处理", "EXTRACTION": "核酸提取",
    "LIBRARY_PREP": "文库构建", "POOLING": "文库定量及 Pooling",
    "HYB_SEQ": "杂交测序", "BIOINFO": "生物信息",
}
# 各阶段样本被下游表用哪个字段引用（删之前必须检查，避免悬空引用）
NIPPT_DOWNSTREAM_REF = {
    "EXTRACTION": ("NipptLibrarySample", "source_extraction_sample_id"),
    "LIBRARY_PREP": ("NipptPoolingSample", "source_library_sample_id"),
    "POOLING": ("NipptHybSeqSample", "source_pooling_sample_id"),
    "HYB_SEQ": ("NipptBioinfoSample", "source_hybseq_sample_id"),
    "BIOINFO": None,
}


class NipptBatchDeleteMixin:
    """批次删除统一行为：先查下游引用，再回退阶段，最后删。

    子类需设置：
        nippt_stage      : 本批次所属阶段（EXTRACTION / LIBRARY_PREP / ...）
        nippt_revert_to  : 回退目标阶段（默认取 NIPPT_STAGE_BEFORE[nippt_stage]）
        nippt_photos_ns  : 照片命名空间（有则清理）
    可选覆盖 nippt_before_delete() 做额外处理（如回退血浆管数）。
    """

    nippt_stage = None
    nippt_revert_to = None

    # ── 工具 ──
    def _nippt_photos_ns(self):
        return getattr(self, "photos_namespace", None)
    def _nippt_case_sample_ids(self, batch):
        ids = []
        for sp in batch.samples.all():
            ids.extend(sp.case_sample_ids or [])
        return list(dict.fromkeys(ids))

    def _nippt_missing(self, batch, stage):
        """引用了未知阶段的子类 → 返回 None 表示不处理。"""
        if stage is None or stage not in NIPPT_STAGE_BEFORE:
            return None
        return True

    def nippt_blocked_by_downstream(self, batch, stage):
        """返回被下游引用的 [(下游批次号, 样本数)]；空表示可以删。"""
        ref = NIPPT_DOWNSTREAM_REF.get(stage)
        if not ref:
            return []
        model_name, field = ref
        Model = globals().get(model_name)
        if Model is None:
            return []
        sample_ids = [sp.id for sp in batch.samples.all()]
        if not sample_ids:
            return []
        qs = Model.objects.filter(**{field + "__in": sample_ids})
        out = {}
        for obj in qs.select_related("batch"):
            bn = getattr(getattr(obj, "batch", None), "batch_number", "") or "(未知批次)"
            out[bn] = out.get(bn, 0) + 1
        return sorted(out.items())

    def nippt_revert_stage(self, batch, stage, to_stage, request):
        """回退批次内样本的 workflow_stage，返回回退的 CaseSample id 列表。"""
        csids = self._nippt_case_sample_ids(batch)
        if not csids:
            return []
        # 只回退"当前正处于本阶段或更靠后"的样本，避免把已失败的样本拉回正常流程
        qs = CaseSample.objects.filter(id__in=csids)
        if to_stage == "RECEIVED":
            qs = qs.exclude(workflow_stage="REGISTERED")
        else:
            qs = qs.exclude(workflow_stage__in=["REGISTERED", "RECEIVED", "POOLING_FAILED"])
        touched = list(qs.values_list("id", flat=True))
        if touched:
            CaseSample.objects.filter(id__in=touched).update(workflow_stage=to_stage)
            from .models import sync_case_status_for_samples
            sync_case_status_for_samples(touched)
        return touched

    def nippt_before_delete(self, request, batch):
        """钩子：子类可覆盖做额外清理（返回 Response 表示中断删除）。"""
        return None

    # ── 共用 destroy ──
    def destroy(self, request, *args, **kwargs):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"detail": "Cannot delete completed batch"}, status=400)
        stage = self.nippt_stage
        to_stage = self.nippt_revert_to or NIPPT_STAGE_BEFORE.get(stage)

        # ① 下游引用保护：已被下游批次使用 → 拒绝
        blocked = self.nippt_blocked_by_downstream(batch, stage)
        if blocked:
            detail = "该批次已被下游批次使用，请先删除下游批次：%s" % "、".join(
                "%s（%d 个样本）" % (bn, n) for bn, n in blocked)
            return Response({"detail": detail, "blocked": [{"batch_number": b, "count": n} for b, n in blocked]},
                            status=400)

        # ② 子类额外处理
        err = self.nippt_before_delete(request, batch)
        if err is not None:
            return err

        # ③ 回退阶段
        reverted = self.nippt_revert_stage(batch, stage, to_stage, request) if to_stage else []

        # ④ 审计留痕
        try:
            from ..audit.utils import log_audit
            log_audit(request, "DELETE", batch,
                      changes={
                          "batch_number": {"old": batch.batch_number, "new": None},
                          "stage": {"old": stage, "new": None},
                          "reverted_samples": {"old": None, "new": len(reverted)},
                          "revert_to": {"old": None, "new": to_stage},
                      },
                      entity_type="batch", entity_repr=batch.batch_number)
        except Exception as _ex:
            print("[audit] batch delete log failed:", _ex)

        # ⑤ 清理照片 + 删除
        bn = batch.batch_number
        ns = self._nippt_photos_ns()
        if ns:
            try:
                purge_nippt_photos(ns, batch.id)
            except Exception as _ex:
                print("[photos] purge failed:", _ex)
        batch.delete()
        return Response({
            "message": "已删除批次 %s" % bn,
            "reverted": len(reverted),
            "to_stage": to_stage or "",
            "to_stage_label": NIPPT_STAGE_LABEL.get(to_stage or "", to_stage or ""),
            "blocked": [],
        })

    # ── 删除预览（前端确认框用）──
    @action(detail=True, methods=["get"], url_path="delete_preview")
    def delete_preview(self, request, pk=None):
        batch = self.get_object()
        stage = self.nippt_stage
        to_stage = self.nippt_revert_to or NIPPT_STAGE_BEFORE.get(stage)
        blocked = self.nippt_blocked_by_downstream(batch, stage)
        csids = self._nippt_case_sample_ids(batch)
        return Response({
            "batch_number": batch.batch_number,
            "status": batch.status,
            "can_delete": batch.status != "COMPLETED" and not blocked,
            "completed": batch.status == "COMPLETED",
            "stage": stage or "",
            "stage_label": NIPPT_STAGE_LABEL.get(stage or "", stage or ""),
            "to_stage": to_stage or "",
            "to_stage_label": NIPPT_STAGE_LABEL.get(to_stage or "", to_stage or ""),
            "revert_count": len(csids),
            "blocked": [{"batch_number": b, "count": n} for b, n in blocked],
        })


class NipptPreProcessingViewSet(NipptPhotosMixin, NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = None
    nippt_revert_to = "RECEIVED"
    """NIPPT 前处理批次管理"""
    photos_namespace = "nippt_preprocessing"
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
        # 被重做激活的样本（reactivated）即使进过批次，也要重新出现在前处理待处理列表
        reactivated_ids = set(
            str(x) for x in CaseSample.objects.filter(reactivated=True).values_list("id", flat=True)
        )
        excluded_ids = set()
        all_batches = NipptPreProcessingBatch.objects.all().prefetch_related("samples")
        for b in all_batches:
            for sp in b.samples.all():
                if not sp.case_sample_ids:
                    continue
                ids = [i for i in sp.case_sample_ids if i not in reactivated_ids]
                if b.status in ("DRAFT", "IN_PROGRESS"):
                    excluded_ids.update(ids)
                elif b.status == "COMPLETED" and sp.qc_status == "PASS":
                    excluded_ids.update(ids)

        # is_active=True：已被重做取代的失效样本不再进入候选（否则原始+重做会被合并处理）
        qs = CaseSample.objects.filter(
            sample__status="RECEIVED", is_active=True
        ).exclude(
            id__in=list(excluded_ids)[:10000] if excluded_ids else []
        ).select_related("case", "sample").order_by("case__case_number", "sample__patient_name")

        # Group males by person — one row per person with all sample types
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER":
                cat = "FEMALE_BLOOD"
            elif cs.effective_sample_type == "BLOOD":
                cat = "MALE_BLOOD"
            else:
                cat = "MALE_OTHER"

            key = (str(cs.case_id), cs.sample.patient_name, cs.sample_source)
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
                    "receipt_location": cs.receipt_location or "",
                }
            g = groups[key]
            _rsp = (cs.actual_sample_type or "").strip() or (cs.sample_source or "").strip()
            if _rsp and _rsp not in g["sample_types"]:
                g["sample_types"].append(_rsp)
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

        # 校验：所有样本必须填写实验样本类型
        no_type = [sd for sd in samples_data if not (sd.get("experiment_sample_type") or "").strip()]
        if no_type:
            return Response({"detail": "存在未填写实验样本类型的样本，请填写后再保存"}, status=400)

        # 校验：实验样本类型必须来自该样本「收到样本类型」（母亲不校验——女样本均为血液，类型不影响流转）
        invalid = []
        for sd in samples_data:
            if not sd.get("id"):
                continue
            sp = batch.samples.filter(id=sd.get("id")).first()
            if not sp or sp.category == "FEMALE_BLOOD":
                continue
            et = (sd.get("experiment_sample_type") or "").strip()
            rec = [t for t in (sp.received_sample_types or []) if t]
            if et and rec and et not in rec:
                invalid.append((sp.patient_name or "", et, rec))
        if invalid:
            details = "；".join(
                "%s 选了 %s，但收到的是 %s" % (nm or "样本", et, "/".join(rec))
                for nm, et, rec in invalid[:5]
            )
            more = "等 %d 个" % len(invalid) if len(invalid) > 5 else ""
            return Response({
                "detail": "实验样本类型必须是该样本收到的样本类型之一：%s%s" % (details, more)
            }, status=400)

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
            # 允许手动指定「剩余样本类型」（2026-10-13）：
            #   显式给列表（含空列表 []）= 实验室人工值 → 原样存 remaining_override
            #   给 null / 不传        = 交回默认（收到 − 实验用）
            # 说明：原实现是 `or None`，会把"清空=没有剩余"误判成"用默认"。
            if "remaining_sample_types" in sd:
                _rv = sd.get("remaining_sample_types")
                sp.remaining_override = list(_rv) if isinstance(_rv, (list, tuple)) else None
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
        from django.db import transaction

        batch = self.get_object()
        if batch.status == NipptPreProcessingBatch.Status.COMPLETED:
            raise ValidationError("Batch already completed")

        # ── 完成前校验：有样本的侧必须已保存（实验照片+操作人+审核人）──
        pd = batch.processing_data or {}
        missing = []
        if batch.samples.filter(category="FEMALE_BLOOD").exists():
            if not (pd.get("operator_female") and pd.get("reviewer_female") and (pd.get("photos_female") or [])):
                missing.append("女性")
        if batch.samples.filter(category__in=["MALE_BLOOD", "MALE_OTHER"]).exists():
            if not (pd.get("operator_male") and pd.get("reviewer_male") and (pd.get("photos_male") or [])):
                missing.append("男性")
        if missing:
            raise ValidationError(f"请先保存{'、'.join(missing)}实验数据（实验照片+操作人+审核人）后再完成批次")

        with transaction.atomic():
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

        advance_batch(batch, "EXTRACTION", request.user, failed_stage="PRE_PROCESSING")
        return Response({"message": f"Batch {batch.batch_number} completed"})



    def nippt_before_delete(self, request, batch):
        # 前处理批次删除：血浆管数无需回退（前处理本身就是管数产生点）
        return None

    # destroy 由 NipptBatchDeleteMixin 提供（回退到 RECEIVED）


# ══════════════════════════════════════════
# NIPPT Extraction ViewSet (核酸提取)
# ══════════════════════════════════════════

from .serializers import (
    NipptExtractionBatchListSerializer, NipptExtractionBatchDetailSerializer,
    NipptExtractionBatchCreateSerializer, NipptExtractionSampleSerializer,
)

class NipptExtractionViewSet(NipptPhotosMixin, NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = "EXTRACTION"
    photos_namespace = "nippt_extraction"
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
            if not pp.case_sample_ids:
                continue
            exp_type = pp.experiment_sample_type or ""
            # 女性全进；男性只进"实验样本类型"对应的样本（类型通用：BLOOD/NAIL/HAIR/DBS...）
            for _cs in CaseSample.objects.filter(id__in=pp.case_sample_ids):
                if _cs.role == "MOTHER":
                    passed_ids.add(str(_cs.id))
                elif exp_type and _cs.effective_sample_type == exp_type:
                    passed_ids.add(str(_cs.id))
        excluded_ids = set()
        for b in NipptExtractionBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT", "IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status == "COMPLETED" and sp.qc_status == "PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        # is_active=True：已被重做取代的失效样本不再进入候选
        qs = CaseSample.objects.filter(id__in=valid_ids, is_active=True).select_related("case","sample").order_by("case__case_number","sample__patient_name")
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            else:
                if cs.effective_sample_type == "BLOOD": cat = "MALE_BLOOD"
                else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cs.sample_source)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id,"receipt_location":cs.receipt_location or "","redo_count":0}
            g = groups[key]
            _rsp = cs.effective_sample_type
            if _rsp and _rsp not in g["sample_types"]: g["sample_types"].append(_rsp)
            g["case_sample_ids"].append(str(cs.id))
            if not g["test_sample_id"]: g["test_sample_id"] = cs.test_sample_id
            if cs.redo_count and cs.redo_count > g["redo_count"]: g["redo_count"] = cs.redo_count
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
        # ── 完成前校验：有样本的侧必须已保存（实验照片+操作人+审核人）──
        ed = batch.extraction_data or {}
        missing = []
        # 实验照片**不再是完成前提**：允许先完成、之后再补传（前端保存时会弹窗提醒）
        if batch.samples.filter(category="FEMALE_BLOOD").exists():
            if not (ed.get("operator_female") and ed.get("reviewer_female")):
                missing.append("女性")
        if batch.samples.filter(category__in=["MALE_BLOOD", "MALE_OTHER"]).exists():
            if not (ed.get("operator_male") and ed.get("reviewer_male")):
                missing.append("男性")
        if missing:
            raise ValidationError(f"请先保存{'、'.join(missing)}实验数据（操作人+审核人）后再完成批次")
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "LIBRARY_PREP", request.user, failed_stage="EXTRACTION")
        return Response({"message": f"Completed {batch.samples.count()} samples"})



    def nippt_before_delete(self, request, batch):
        # 提取批次删除：退回被消耗的血浆管数
        for sp in batch.samples.all():
            if sp.source_preprocessing_sample_id:
                NipptPreProcessingSample.objects.filter(
                    id=sp.source_preprocessing_sample_id
                ).update(aliquot_tubes=F("aliquot_tubes") + 1)
        return None

    # destroy 由 NipptBatchDeleteMixin 提供（回退到 PRE_PROCESSING）


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

class NipptLibraryViewSet(NipptPhotosMixin, NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = "LIBRARY_PREP"

    photos_namespace = "nippt_library"
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
        exp_type_map = {}
        for es in NipptExtractionSample.objects.filter(batch__status="COMPLETED", qc_status="PASS"):
            if es.case_sample_ids:
                for cid in es.case_sample_ids:
                    passed_ids.add(cid); id2es[cid] = es
                    exp_type = es.experiment_sample_type or ""
                    if exp_type:
                        exp_type_map[cid] = exp_type
        excluded_ids = set()
        for b in NipptLibraryBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT","IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status=="COMPLETED" and sp.qc_status=="PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        # is_active=True：已被重做取代的失效样本不再进入候选
        qs = CaseSample.objects.filter(id__in=valid_ids, is_active=True).select_related("case","sample").order_by(Length("case__pt_number"), "case__pt_number", "sample__patient_name")
        groups = {}
        for cs in qs:
            es = id2es.get(str(cs.id))
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            elif cs.effective_sample_type == "BLOOD": cat = "MALE_BLOOD"
            else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cs.sample_source)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id,
                    "receipt_location":cs.receipt_location or "",
                    "dna_concentration":es.dna_concentration if es else None,
                    "extraction_sample_id":str(es.id) if es else None}
            g = groups[key]
            _rsp = cs.effective_sample_type
            if _rsp and _rsp not in g["sample_types"]: g["sample_types"].append(_rsp)
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
        advance_batch(batch, "POOLING", request.user, failed_stage="LIBRARY_PREP")
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    # destroy 由 NipptBatchDeleteMixin 提供



class NipptPoolingViewSet(NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = "POOLING"
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
                for cid in ls.case_sample_ids:
                    passed_ids.add(cid)
        excluded_ids = set()
        for b in NipptPoolingBatch.objects.all().prefetch_related("samples"):
            for sp in b.samples.all():
                if not sp.case_sample_ids: continue
                if b.status in ("DRAFT","IN_PROGRESS"): excluded_ids.update(sp.case_sample_ids)
                elif b.status=="COMPLETED" and sp.qc_status=="PASS": excluded_ids.update(sp.case_sample_ids)
        valid_ids = passed_ids - excluded_ids
        if not valid_ids:
            return Response({"female_count":0,"male_blood_count":0,"male_other_count":0,"total_pending":0,"entries":[]})
        # is_active=True：已被重做取代的失效样本不再进入候选
        qs = CaseSample.objects.filter(id__in=valid_ids, is_active=True).select_related("case","sample").order_by("case__case_number","sample__patient_name")
        groups = {}
        for cs in qs:
            if cs.role == "MOTHER": cat = "FEMALE_BLOOD"
            else:
                if cs.effective_sample_type == "BLOOD": cat = "MALE_BLOOD"
                else: cat = "MALE_OTHER"
            key = (str(cs.case_id), cs.sample.patient_name, cs.sample_source)
            if key not in groups:
                groups[key] = {"case_id":str(cs.case_id),"case_number":cs.case.case_number,
                    "patient_name":cs.sample.patient_name,"role":cs.role,"category":cat,
                    "expected_completion": cs.case.expected_completion.isoformat() if cs.case.expected_completion else "",
                    "sample_types":[],"case_sample_ids":[],"test_sample_id":cs.test_sample_id,"receipt_location":cs.receipt_location or ""}
            g = groups[key]
            _rsp = cs.effective_sample_type
            if _rsp and _rsp not in g["sample_types"]: g["sample_types"].append(_rsp)
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
        advance_batch(batch, "HYB_SEQ", request.user, failed_stage="POOLING")
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    # destroy 由 NipptBatchDeleteMixin 提供（回退阶段）


class NipptHybSeqViewSet(NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = "HYB_SEQ"
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
            # 与「写杂交」共用同一套分配：mix 个数/结构与 Pooling 页一致（manual_alloc），
            # 但每组只统计实际会进杂交的 PASS 样本（FAIL 样本停在 Pooling 不进下一步）
            from .serializers import nippt_pool_mix_lanes, nippt_pool_mix_groups
            lanes = nippt_pool_mix_lanes(pb, pd)
            _targets = nippt_pool_mix_groups(pb, pd)
            _failed_total = pb.samples.filter(qc_status="FAIL").count()
            for gi, (f_list, m_list) in enumerate(lanes):
                mid = f"{pb.id}_{gi}"
                if mid in used_mix_ids: continue
                nf, nm = len(f_list), len(m_list)
                _tgt = _targets[gi] if gi < len(_targets) else {}
                _target_total = int(_tgt.get("female", 0) or 0) + int(_tgt.get("male", 0) or 0)
                _missing = max(0, _target_total - (nf + nm))
                mixes.append({
                    "id": mid,
                    "pooling_batch_id": str(pb.id),
                    "pooling_batch_number": pb.batch_number,
                    "mix_name": f"{pb.batch_number}-mix{gi+1}",
                    "female": nf,
                    "male": nm,
                    "data_amount": (nf*2 + nm*1),
                    # 该 mix 相对于 Pooling 分组目标少掉的样本数（因质检失败未进入杂交）
                    "missing": _missing,
                    "target_total": _target_total,
                    "pooling_failed_total": _failed_total,
                })
        return Response({"mixes": mixes})

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        sd = request.data.get("hyb_seq_data", {})
        # 保留创建时的元数据键（前端保存 payload 不含，防被清空）
        old = batch.hyb_seq_data or {}
        for k in ("mix_ids", "mix_sources", "pooling_batch_id", "pooling_batch_ids", "chip_number", "chip", "read_type"):
            if k not in sd and k in old:
                sd[k] = old[k]
        if sd: batch.hyb_seq_data = sd; batch.save(update_fields=["hyb_seq_data","updated_at"])
        return Response({"message":"Saved"})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED": return Response({"message":"Already"}, status=400)
        batch.status = "COMPLETED"; batch.save(update_fields=["status","updated_at"])
        advance_batch(batch, "BIOINFO", request.user, failed_stage="HYB_SEQ")
        return Response({"message": f"Completed {batch.samples.count()} samples"})

    # destroy 由 NipptBatchDeleteMixin 提供（回退阶段）


from .models import NipptBioinfoBatch, NipptBioinfoSample, NipptBioinfoPair
from .serializers import (
    NipptBioinfoBatchListSerializer, NipptBioinfoBatchDetailSerializer,
    NipptBioinfoBatchCreateSerializer, NipptBioinfoPairSerializer,
    NipptBioinfoSampleSerializer,
)


# ── NIPPT 生信：模板结果字母 ↔ 库内枚举 ↔ CPI 派生规则 ──
# 模板里 auto_result / result 两列都用字母；库内 result 仍是 INCLUSION/EXCLUSION/INCONCLUSIVE
NIPPT_RESULT_LETTER = {"INCLUSION": "Y", "EXCLUSION": "N", "INCONCLUSIVE": "O"}
NIPPT_LETTER_RESULT = {
    "Y": "INCLUSION", "N": "EXCLUSION", "O": "INCONCLUSIVE",
    # 中文（人工填 result 时常用；与页面下拉文案一致）
    "支持": "INCLUSION", "不支持": "EXCLUSION", "临界": "INCONCLUSIVE", "亲缘临界": "INCONCLUSIVE",
    # 兼容旧模板（字母约定启用前下载的那批用全称）
    "INCLUSION": "INCLUSION", "EXCLUSION": "EXCLUSION", "INCONCLUSIVE": "INCONCLUSIVE",
}


def nippt_pipeline_parse_name(h_val, w_val):
    """从管线文件名解析 (父方 PT 号, 父标签, 母方 PT 号)。

    例：H='H_chip7028_020_PT71839H.unif', W='W_chip7028_006_PT71839W.unif'
        → ('PT71839', 'H', 'PT71839')
    解析不出 PT 号时返回 ('', '', '')。
    """
    import re as _re

    def _pt(s):
        m = _re.search(r"PT\s*(\d+)", str(s or ""), _re.I)
        return ("PT" + m.group(1)) if m else ""

    h = str(h_val or "")
    m = _re.search(r"PT\s*(\d+)\s*([A-Za-z0-9]*)", h, _re.I)
    pt_h = ("PT" + m.group(1)) if m else ""
    label = (m.group(2) or "").upper() if m else ""
    return pt_h, label, _pt(w_val)


def nippt_pt_norm(s):
    """PT 号归一化（去空白、转大写）用于匹配比较。"""
    import re as _re
    return _re.sub(r"\s+", "", str(s or "")).upper()


# 管线/表格里的"无数据"占位符（大小写不敏感）一律当空处理
NIPPT_EMPTY_TOKENS = {"", "na", "n/a", "n.a.", "nan", "null", "none", "nil", "-", "--", "—", "－"}


def nippt_cell_norm(v):
    """单元格归一化：na / N/A / nan / null / none / - / 空 → ""（不覆盖原值、不报错）。"""
    if v is None:
        return ""
    if isinstance(v, str):
        t = v.strip()
    else:
        t = str(v).strip()
    return "" if t.lower() in NIPPT_EMPTY_TOKENS else t


def nippt_parse_metric_number(raw):
    """解析指标数值：支持小数('0.09')与百分号('9%' / '9％')两种写法。

    百分号按小数换算（9% → 0.09），与库内既有口径一致（库内指标均为小数）；
    无法解析时抛 ValueError，由调用方记为该行错误。
    """
    t = str(raw or "").strip().replace(" ", "").replace("％", "%")
    if t.endswith("%"):
        return float(t[:-1]) / 100.0
    return float(t)
# cpi 不再由文件/页面提供，一律由 result 自动派生：支持=10000 / 不支持=0.0001 / 临界与无结果=空
NIPPT_CPI_BY_RESULT = {"INCLUSION": 10000.0, "EXCLUSION": 0.0001, "INCONCLUSIVE": None, "": None}


class NipptBioinfoViewSet(NipptBatchDeleteMixin, viewsets.ModelViewSet):
    nippt_stage = "BIOINFO"
    """NIPPT Bioinformatics — pair-based CPI analysis"""
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ["batch_number"]
    ordering_fields = ["created_at", "batch_number"]

    def get_queryset(self):
        return NipptBioinfoBatch.objects.prefetch_related("samples", "pairs").all()

    def get_serializer_class(self):
        if self.action == "list":
            return NipptBioinfoBatchListSerializer
        if self.action == "create":
            return NipptBioinfoBatchCreateSerializer
        return NipptBioinfoBatchDetailSerializer

    @action(detail=False, methods=["get"])
    def pending_info(self, request):
        # Exclude HybSeq batches already used in bioinfo batches
        used_hs_ids = set()
        for bb in NipptBioinfoBatch.objects.all():
            bid = (bb.bioinfo_data or {}).get("source_hybseq_batch_id")
            if bid:
                used_hs_ids.add(bid)
        
        latest_hs = NipptHybSeqBatch.objects.filter(
            status="COMPLETED"
        ).exclude(id__in=used_hs_ids).order_by("-created_at").first()
        
        if not latest_hs:
            return Response({"available": False, "message": "No completed HybSeq batch available"})
        hs_samples = NipptHybSeqSample.objects.filter(batch=latest_hs, qc_status="PASS").select_related("case")
        cases_in_batch = {}
        for hs in hs_samples:
            cases_in_batch.setdefault(hs.case_id, {"mother": False, "fathers": []})
            if hs.role == "MOTHER":
                cases_in_batch[hs.case_id]["mother"] = True
            else:
                cases_in_batch[hs.case_id]["fathers"].append(hs.patient_name)
        batch_internal = sum(1 for c in cases_in_batch.values() if c["mother"] and c["fathers"])
        total_pairs = sum(len(c["fathers"]) for c in cases_in_batch.values() if c["mother"])
        all_hs = NipptHybSeqBatch.objects.filter(status="COMPLETED").exclude(id__in=used_hs_ids).order_by("-created_at")[:20]
        return Response({
            "available": True,
            "primary_batch": {"id": str(latest_hs.id), "batch_number": latest_hs.batch_number, "created_at": latest_hs.created_at, "sample_count": hs_samples.count()},
            "pairing_summary": {"batch_internal_cases": batch_internal, "batch_internal_pairs": total_pairs},
            "all_hybseq_batches": [{"id": str(hb.id), "batch_number": hb.batch_number} for hb in all_hs],
        })

    @action(detail=True, methods=["post"])
    def save_processing(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"error": "Batch already completed"}, status=400)
        pairs_data = request.data.get("pairs", [])
        METRIC_FIELDS = [
            "mother_layers", "mother_concentration", "mother_het_ratio", "mother_y_ratio",
            "father_layers", "father_concentration", "father_het_ratio", "father_y_ratio",
        ]
        for pd in pairs_data:
            pair_id = pd.get("id")
            if not pair_id: continue
            result_val = pd.get("result", "") or ""
            updates = {
                # cpi 由 result 自动派生（前端 CPI 列已改为只读展示）：支持=10000 / 不支持=0.0001 / 临界与空=空
                "cpi": NIPPT_CPI_BY_RESULT.get(result_val),
                "cpi_combined": pd.get("cpi_combined"),
                "result": result_val, "note": pd.get("note", ""),
                "report_data": pd.get("report_data", {}), "updated_at": timezone.now(),
            }
            # 修复：此前 pairs 不接受 qc_flag → 页面上设的 QC 标记保存后被静默丢弃
            if "qc_flag" in pd:
                updates["qc_flag"] = pd.get("qc_flag") or ""
            for f in METRIC_FIELDS:
                if f in pd and pd[f] is not None:
                    updates[f] = pd[f]
            NipptBioinfoPair.objects.filter(id=pair_id, batch=batch).update(**updates)
        # ── 未配对样本的指标保存（前端 editingSamples → samples 数组）──
        # 修复：此前只处理 pairs，samples 被静默丢弃 → 未配对样本指标填完刷新就没了
        samples_data = request.data.get("samples", [])
        SAMPLE_METRIC_FIELDS = ["layers", "concentration", "het_ratio", "y_ratio"]
        samples_updated = 0
        for sd2 in samples_data:
            sid = sd2.get("id")
            if not sid:
                continue
            supd = {"processed_at": timezone.now()}
            for f in SAMPLE_METRIC_FIELDS:
                if f in sd2 and sd2[f] is not None:
                    supd[f] = sd2[f]
            if "qc_flag" in sd2:
                supd["qc_flag"] = sd2.get("qc_flag") or ""
            samples_updated += NipptBioinfoSample.objects.filter(id=sid, batch=batch).update(**supd)
        sd = request.data.get("bioinfo_data", {})
        if sd:
            batch.bioinfo_data = sd
            batch.save(update_fields=["bioinfo_data", "updated_at"])
        # 2026-10-16：「最后保存」用 batch.updated_at 呈现。前端只传 {pairs, samples}，
        # 走的是 .update()（不触发 auto_now）→ 此前批次时间戳几乎不变，必须显式戳一次。
        batch.save(update_fields=["updated_at"])
        return Response({"message": "Saved", "samples_updated": samples_updated})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """完成批次前的准入：pair 有结果 且 QC 为 normal → 进报告；否则退回（需重做/重采）。

        · 不满足条件的 pair 不能进报告（报告需要男女双方数据齐全）
        · 按 QC 标记判断"有问题的那侧"：男性* → 疑父；女性* / 胎儿* → 母亲
          → 该侧样本 workflow_stage=BIOINFO_FAILED（需重做/重采）
          → 另一侧退回 BIOINFO（在生信等待对方重做/重采结果，双方齐了再一起进报告）
        · QC 为空（只是没结果）→ 两侧都判 FAIL
        · Case 级状态由 update_wf → sync_case_status_for_samples 自动同步为「有失败」
        """
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"error": "Already completed"}, status=400)

        MALE_FLAGS = {"MALE_LOW_LAYERS", "MALE_CONTAM"}
        FEMALE_FLAGS = {"FEMALE_LOW_LAYERS", "FEMALE_CONTAM", "FETAL_LOW_CONC"}
        passed_ids, failed_ids, held_ids = [], [], []
        bad_pairs = []
        ok_count = 0
        for pair in batch.pairs.select_related("mother_sample", "father_sample", "case"):
            m_smp, f_smp = pair.mother_sample, pair.father_sample
            qc = (pair.qc_flag or "").strip()
            m_ids = [str(x) for x in (m_smp.case_sample_ids or [])]
            f_ids = [str(x) for x in (f_smp.case_sample_ids or [])]
            ok = bool((pair.result or "").strip()) and not qc
            if ok:
                ok_count += 1
                passed_ids += m_ids + f_ids
                NipptBioinfoSample.objects.filter(id__in=[m_smp.id, f_smp.id]).update(qc_status="PASS")
                continue
            if qc in MALE_FLAGS:
                fail_ids, hold_ids, side = f_ids, m_ids, "疑父"
            elif qc in FEMALE_FLAGS:
                fail_ids, hold_ids, side = m_ids, f_ids, "母亲"
            else:
                fail_ids, hold_ids, side = m_ids + f_ids, [], "双方"
            failed_ids += fail_ids
            held_ids += hold_ids
            NipptBioinfoSample.objects.filter(id=m_smp.id).update(
                qc_status="FAIL" if (m_ids and m_ids[0] in fail_ids) else "PASS")
            NipptBioinfoSample.objects.filter(id=f_smp.id).update(
                qc_status="FAIL" if (f_ids and f_ids[0] in fail_ids) else "PASS")
            bad_pairs.append({"case_number": pair.case.case_number,
                              "pt_number": pair.case.pt_number or "",
                              "result": pair.result or "", "qc_flag": qc, "fail_side": side})

        with transaction.atomic():
            batch.status = "COMPLETED"
            batch.save(update_fields=["status", "updated_at"])
            if passed_ids:
                update_wf(passed_ids, "REPORT_DRAFT", "COMPLETE", batch.batch_number, request.user)
            if failed_ids:
                update_wf(failed_ids, "BIOINFO_FAILED", "FAIL", batch.batch_number, request.user)
            if held_ids:
                # 在生信阶段等待对方重做/重采结果
                update_wf(held_ids, "BIOINFO", "HOLD", batch.batch_number, request.user)
            # 统一再同步一次案例状态（避免分组调用顺序影响结果）
            all_ids = list({*passed_ids, *failed_ids, *held_ids})
            if all_ids:
                from .models import sync_case_status_for_samples
                sync_case_status_for_samples(all_ids)

        msg = f"完成：{ok_count} 个 pair 进入报告"
        if bad_pairs:
            msg += f"；{len(bad_pairs)} 个未进报告（需重做/重采）"
        return Response({
            "message": msg,
            "ok_pairs": ok_count,
            "bad_pair_count": len(bad_pairs),
            "bad_pairs": bad_pairs[:50],
            "failed_samples": len(failed_ids),
            "held_samples": len(held_ids),
        })
    @action(detail=True, methods=["post"], url_path="set-sample-qc")
    def set_sample_qc(self, request, pk=None):
        """未配对样本的 QC 标记 / 备注（2026-10-16）。

        独立于 save_processing 的原因：
          · save_processing 在批次 COMPLETED 后整体返回 400，而"没配对的样本也可能要重做/重采"
            → 操作者需要能在完成后仍补上 QC 标记/备注，以便提前通知实验室。
          · 作用域限定"未配对样本"：已配对样本的 QC 走配对行（pair.qc_flag）与完成流程。
        """
        batch = self.get_object()
        sid = request.data.get("sample_id")
        if not sid:
            return Response({"error": "sample_id required"}, status=400)
        sp = NipptBioinfoSample.objects.filter(id=sid, batch=batch).first()
        if not sp:
            return Response({"error": "sample not found in this batch"}, status=404)
        if NipptBioinfoPair.objects.filter(batch=batch).filter(
                Q(mother_sample=sp) | Q(father_sample=sp)).exists():
            return Response({"error": "该样本已配对，请在配对行上修改"}, status=400)
        upd = {}
        if "qc_flag" in request.data:
            upd["qc_flag"] = (request.data.get("qc_flag") or "").strip()
        if "qc_note" in request.data:
            upd["qc_note"] = request.data.get("qc_note") or ""
        if not upd:
            return Response({"error": "nothing to update"}, status=400)
        upd["processed_at"] = timezone.now()
        NipptBioinfoSample.objects.filter(id=sp.id).update(**upd)
        batch.save(update_fields=["updated_at"])   # QC/备注也算一次保存 → 刷新「最后保存」
        return Response({
            "ok": True, "sample_id": str(sp.id),
            "qc_flag": upd.get("qc_flag", sp.qc_flag or ""),
            "qc_note": upd.get("qc_note", sp.qc_note or ""),
        })

    @action(detail=True, methods=["post"], url_path="set-surrogacy")
    def set_surrogacy(self, request, pk=None):
        """报告模块直接勾/取消「代孕」（写 Case.risk_warnings，口径同报告引擎）。

        body: {"pair_ids": ["..."], "is_surrogacy": true}
        注意：代孕是**案例级**属性 → 会作用于该案例的全部配对（防止之前漏写）。
        """
        batch = self.get_object()
        ids = request.data.get("pair_ids") or []
        val = bool(request.data.get("is_surrogacy"))
        qs = batch.pairs.select_related("case")
        if ids:
            qs = qs.filter(id__in=ids)
        touched = []
        for pair in qs:
            case = pair.case
            if case is None or str(case.id) in touched:
                continue
            rw = [str(x) for x in (case.risk_warnings or [])]
            has = any(x.strip().lower() == "surrogacy" for x in rw)
            if val == has:
                continue                      # 状态没变 → 不写库
            touched.append(str(case.id))
            old = list(case.risk_warnings or [])
            new_rw = rw + ["surrogacy"] if val else [x for x in rw if x.strip().lower() != "surrogacy"]
            case.risk_warnings = new_rw
            case.save(update_fields=["risk_warnings", "updated_at"])
            try:
                log_audit(request, "UPDATE", case, changes={"risk_warnings": {"old": old, "new": new_rw}})
            except Exception:
                pass
        return Response({"updated_cases": touched, "is_surrogacy": val})

    @action(detail=True, methods=["post"], url_path="set-report-info")
    def set_report_info(self, request, pk=None):
        """报告模块行内编辑：报告版本 / 报告日期。

        body: {"pair_ids": ["..."], "report_version": "巴西", "report_date": "2026-10-19"}
        - 报告版本 = Case.report_version（同时决定用哪个语种模板生成报告）
        - 报告日期 = Case.expected_completion（报告模板里的「检测日期/预计出报告时间」也取它）
        两者都是案例级 → 同一案例的全部配对一起变。
        锁定：报告批次已完成 / 该配对已审核 → 拒绝。
        """
        from datetime import date as _date
        batch = self.get_object()
        ids = request.data.get("pair_ids") or []
        pairs = list(batch.pairs.select_related("case").filter(id__in=ids)) if ids else []
        if not pairs:
            return Response({"error": "Pair not found"}, status=404)
        if batch.report_status == "COMPLETED":
            return Response({"error": "报告批次已完成，报告版本/报告日期已锁定"}, status=400)
        audited = [p for p in pairs if p.report_audited_at]
        if audited:
            return Response({"error": "配对已审核，报告版本/报告日期已锁定：%s"
                                      % "、".join((p.case.pt_number or str(p.id)) for p in audited)},
                            status=400)

        has_ver = "report_version" in request.data
        has_date = "report_date" in request.data
        if not (has_ver or has_date):
            return Response({"error": "没有要更新的字段（report_version / report_date）"}, status=400)

        version = str(request.data.get("report_version") or "").strip()[:50]
        new_date = None
        if has_date:
            raw = str(request.data.get("report_date") or "").strip()
            if raw:
                try:
                    new_date = _date.fromisoformat(raw[:10])
                except ValueError:
                    return Response({"error": "报告日期格式应为 YYYY-MM-DD"}, status=400)

        updated = []
        seen = set()
        for pair in pairs:
            case = pair.case
            if case is None or str(case.id) in seen:
                continue
            seen.add(str(case.id))
            changes = {}
            if has_ver and (case.report_version or "") != version:
                changes["report_version"] = {"old": case.report_version or "", "new": version}
                case.report_version = version
            if has_date and case.expected_completion != new_date:
                changes["expected_completion"] = {
                    "old": str(case.expected_completion or ""),
                    "new": new_date.isoformat() if new_date else "",
                }
                case.expected_completion = new_date
            if not changes:
                continue
            case.save(update_fields=list(changes.keys()) + ["updated_at"])
            try:
                log_audit(request, "UPDATE", case, changes=changes)
            except Exception:
                pass
            updated.append(case.case_number)

        return Response({
            "updated_cases": updated,
            "report_version": version if has_ver else None,
            "report_date": (new_date.isoformat() if new_date else "") if has_date else None,
        })

    @action(detail=True, methods=["post"], url_path="set-gender-info")
    def set_gender_info(self, request, pk=None):
        """报告模块直接改「额外信息」——案例管理基本信息里显示为 gender 的那一项。

        body: {"pair_ids": ["..."], "gender_info": "Yes" | "No" | ""}
        存在母亲样本的 gender_info（Yes/No）；案例级属性 → 作用于该案例的全部配对。
        报告引擎据此决定是否出性别报告（Yes 才出）。
        """
        batch = self.get_object()
        ids = request.data.get("pair_ids") or []
        raw = str(request.data.get("gender_info") or "").strip()
        val = raw if raw in ("Yes", "No") else ""          # 只接受 Yes / No / 空
        qs = batch.pairs.select_related("case")
        if ids:
            qs = qs.filter(id__in=ids)
        touched = []
        for pair in qs:
            case = pair.case
            if case is None or str(case.id) in touched:
                continue
            cs = case.case_samples.filter(role="MOTHER").select_related("sample").first()
            if not cs or not cs.sample_id:
                continue
            sp = cs.sample
            old = (sp.gender_info or "").strip()
            if old == val:
                continue                                    # 幂等：没变不写库
            touched.append(str(case.id))
            sp.gender_info = val
            sp.save(update_fields=["gender_info", "updated_at"])
            try:
                log_audit(request, "UPDATE", case, changes={"gender_info": {"old": old, "new": val}})
            except Exception:
                pass
        return Response({"updated_cases": touched, "gender_info": val})

    # ══════════════════════════════════════════════════════════════════
    # 报告生成（2026-10-12）：生信模块上传附表 .last → 报告模块按需生成
    # ══════════════════════════════════════════════════════════════════
    @action(detail=True, methods=["post"], url_path="upload-appendices")
    def upload_appendices(self, request, pk=None):
        """上传报告附表(.last)：按文件名里的 PT 号 + 父标签匹配本批次配对，存到 pair.appendix_file。"""
        import os as _os
        import re as _re

        batch = self.get_object()
        files = request.FILES.getlist("files")
        if not files and request.FILES.get("file"):
            files = [request.FILES["file"]]
        if not files:
            raise ValidationError("请选择至少一个 .last 文件")
        # 只收 .last（2026-10-13）：以前非 .last 也返回 200，只是进 failed 清单，容易让人误以为"传上去了"
        _bad = [getattr(f, "name", "") or "" for f in files
                if not (getattr(f, "name", "") or "").lower().endswith(".last")]
        if _bad:
            return Response({"error": "只支持 .last 附表文件，请重新选择：%s" % "、".join(_bad[:3])},
                            status=400)

        # 本批次配对索引：(归一化PT号, 父标签) → [pair]
        idx = {}
        for p in batch.pairs.select_related("mother_sample", "father_sample"):
            ids = list(p.mother_sample.case_sample_ids or []) + list(p.father_sample.case_sample_ids or [])
            labels = [(p.father_label or "").upper()]
            for cs in CaseSample.objects.filter(id__in=ids):
                m = _re.search(r"(PT\s*\d+)", cs.test_sample_id or "", _re.I)
                if not m:
                    continue
                key = (nippt_pt_norm(m.group(1)), labels[0])
                idx.setdefault(key, [])
                if p not in idx[key]:
                    idx[key].append(p)

        matched, failed = [], []
        for f in files:
            fname = getattr(f, "name", "") or ""
            parts = _re.split(r"\.unif", fname, flags=_re.I)
            h_val = parts[1] if len(parts) > 1 else fname
            w_val = parts[0] if len(parts) > 1 else ""
            pt_h, label, _ptw = nippt_pipeline_parse_name(h_val, w_val)
            if not pt_h:
                failed.append({"file": fname, "reason": "文件名里解析不出 PT 号"})
                continue
            cands = idx.get((nippt_pt_norm(pt_h), (label or "").upper())) or []
            if not cands:   # 标签对不上时退一步：只看 PT 号
                cands = [p for k, ps in idx.items() if k[0] == nippt_pt_norm(pt_h) for p in ps]
            if not cands:
                failed.append({"file": fname, "reason": "本批次没有匹配的配对（PT=%s 标签=%s）" % (pt_h, label)})
                continue
            if len(cands) > 1:
                failed.append({"file": fname, "reason": "匹配到 %d 个配对（同 PT 多疑父时请在文件名里带 HA/HB）" % len(cands)})
                continue
            pair = cands[0]
            pair.appendix_file.save(_os.path.basename(fname), f, save=True)
            matched.append({"file": fname, "pair_id": str(pair.id), "pt": pt_h, "label": label,
                            "case": pair.case.case_number if pair.case else ""})
        return Response({"matched": len(matched), "failed": len(failed),
                         "details": matched, "errors": failed})

    def _pair_brief(self, pair):
        """给前端的结果行：配对的可读标识。"""
        pt = ""
        try:
            ids = list(pair.mother_sample.case_sample_ids or []) or list(pair.father_sample.case_sample_ids or [])
            cs = CaseSample.objects.filter(id__in=ids).first() if ids else None
            pt = cs.test_sample_id if cs else ""
        except Exception:      # noqa: BLE001
            pass
        return {"pair_id": str(pair.id), "pt": pt,
                "case": pair.case.case_number if pair.case else "",
                "patient": getattr(pair.mother_sample, "patient_name", "") or "",
                "father_label": pair.father_label or "",
                "result": pair.result or ""}

    @action(detail=True, methods=["post"], url_path="generate-reports")
    def generate_reports(self, request, pk=None):
        """生成报告：body {"pair_ids": [...]}；ids 为空 = 本批次全部可出报告的配对。"""
        import tempfile as _tempfile

        batch = self.get_object()
        ids = request.data.get("pair_ids") or request.data.get("ids") or []
        qs = batch.pairs.select_related("case", "mother_sample", "father_sample")
        if ids:
            qs = qs.filter(id__in=ids)
        out_dir = _tempfile.mkdtemp(prefix="nippt_report_")
        generated, skipped = [], []
        for pair in qs:
            base = self._pair_brief(pair)
            files, why = report_service.generate_and_save(pair, out_dir, request.user)
            if files:
                generated.append(dict(base, files=files))
            else:
                skipped.append(dict(base, reason=why))
        try:
            log_audit(request, "GENERATE_REPORTS", batch,
                      {"generated": len(generated), "skipped": len(skipped)})
        except Exception:      # 审计失败不影响报告生成
            pass
        return Response({"batch": batch.batch_number, "generated": generated, "skipped": skipped,
                         "count": len(generated), "skipped_count": len(skipped)})

    @action(detail=True, methods=["get"], url_path="report-zip")
    def report_zip(self, request, pk=None):
        """把本批次已生成的报告打包下载（可选 pair_ids 过滤）。"""
        import os as _os
        import tempfile as _tempfile
        import zipfile as _zipfile

        batch = self.get_object()
        from django.db.models import Q
        _has = (Q(report_file__isnull=False) & ~Q(report_file="")) | \
               (Q(report_file_pdf__isnull=False) & ~Q(report_file_pdf=""))
        qs = batch.pairs.filter(_has)
        ids = request.query_params.get("pair_ids", "")
        if ids:
            qs = qs.filter(id__in=[x for x in ids.split(",") if x])
        if not qs.exists():
            raise ValidationError("本批次还没有已生成的报告")
        tmp = _tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        used = set()
        with _zipfile.ZipFile(tmp.name, "w", _zipfile.ZIP_DEFLATED) as z:
            for p in qs:
                # 2026-10-13：Word / PDF 两个槽位都收（每对有哪份放哪份）
                for _f in (p.report_file, p.report_file_pdf):
                    if not _f:
                        continue
                    try:
                        name = _os.path.basename(_f.name)
                        if name in used:
                            name = "%s_%s" % (str(p.id)[:8], name)
                        used.add(name)
                        with _f.open("rb") as fh:
                            z.writestr(name, fh.read())
                    except Exception:     # noqa: BLE001
                        continue
        with open(tmp.name, "rb") as fh:
            data = fh.read()
        _os.unlink(tmp.name)
        resp = HttpResponse(data, content_type="application/zip")
        resp["Content-Disposition"] = 'attachment; filename="nippt_reports_%s.zip"' % batch.batch_number
        return resp

    @action(detail=True, methods=["post"], url_path="set-review")
    def set_review(self, request, pk=None):
        """Reports：复核/审核/报告备注（下拉选人 + 自动记录日期）"""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        batch = self.get_object()
        pair = batch.pairs.filter(id=request.data.get("pair_id")).first()
        if not pair:
            return Response({"error": "Pair not found"}, status=404)
        act = request.data.get("action_type")
        if act in ("review", "audit"):
            qc = (pair.qc_flag or "").strip()
            if not (pair.result or "").strip() or qc:
                return Response({"error": "该配对未达标（无结果/QC异常），不需要复核/审核"}, status=400)
        if act == "review":
            rid = request.data.get("reviewer_id")
            pair.report_reviewer = User.objects.filter(id=rid).first() if rid else None
            pair.report_reviewed_at = timezone.now() if pair.report_reviewer else None
            pair.save(update_fields=["report_reviewer", "report_reviewed_at", "updated_at"])
        elif act == "audit":
            aid = request.data.get("auditor_id")
            pair.report_auditor = User.objects.filter(id=aid).first() if aid else None
            pair.report_audited_at = timezone.now() if pair.report_auditor else None
            pair.save(update_fields=["report_auditor", "report_audited_at", "updated_at"])
        elif act == "note":
            pair.report_note = (request.data.get("report_note") or "").strip()
            pair.save(update_fields=["report_note", "updated_at"])
        return Response(NipptBioinfoPairSerializer(pair, context={"request": request}).data)

    @staticmethod
    def _reportable_pairs(batch):
        """达标（可出报告）= 有结果 且 QC 为 normal"""
        return [p for p in batch.pairs.all()
                if (p.result or "").strip() and not (p.qc_flag or "").strip()]

    def _recompute_report_status(self, batch):
        """达标配对是否都已上传报告 → 待复核；否则 待上传。已完成的不动。"""
        if batch.report_status == "COMPLETED":
            return
        todo = self._reportable_pairs(batch)
        done = [p for p in todo if p.report_file]
        new = "TO_REVIEW" if len(done) == len(todo) else "PENDING"
        if new != batch.report_status:
            batch.report_status = new
            batch.save(update_fields=["report_status", "updated_at"])

    @action(detail=True, methods=["post"], url_path="upload-report")
    def upload_report(self, request, pk=None):
        """Reports：上传/替换某个配对的报告文件（PDF 或 Word(.docx)）。

        multipart/form-data: file=<file>, pair_id=<uuid>, mode=overwrite|keep
        · 未达标（结果未填 或 QC 非 normal）的配对不允许上传报告（前后端两层都拦）
        · mode=keep：保留原报告，只记一条「保留」记录
        · 每次都写 pair.report_history（谁/何时/文件名/动作/大小）并落审计
        """
        batch = self.get_object()
        pair = batch.pairs.filter(id=request.data.get("pair_id")).first()
        if not pair:
            return Response({"error": "Pair not found"}, status=404)

        qc = (pair.qc_flag or "").strip()
        if not (pair.result or "").strip() or qc:
            reason = "结果未填" if not (pair.result or "").strip() else f"QC异常：{(pair.get_qc_flag_display() or qc)}"
            return Response({"error": f"该配对未达标（{reason}），不能上传报告"}, status=400)

        f = request.FILES.get("file")
        if not f:
            return Response({"error": "未选择文件"}, status=400)
        # 2026-10-13：允许 PDF 或 Word(.docx) 两种格式；单文件上限 20MB
        _ext = os.path.splitext(str(f.name or ""))[1].lower()
        if _ext not in (".pdf", ".docx"):
            return Response({"error": "只支持 PDF 或 Word（.docx）文件"}, status=400)
        if f.size and f.size > 20 * 1024 * 1024:
            return Response({"error": "文件超过 20MB 上限，请压缩后上传"}, status=400)

        mode = (request.data.get("mode") or "overwrite").strip().lower()
        if mode not in ("overwrite", "keep"):
            mode = "overwrite"
        # 2026-10-13：按扩展名分流 —— Word 与 PDF 各占一个槽位，互不覆盖
        slot = "report_file" if _ext == ".docx" else "report_file_pdf"
        fmt = "word" if _ext == ".docx" else "pdf"
        cur = getattr(pair, slot)
        prev_name = str(cur.name).rsplit("/", 1)[-1] if cur else ""
        now = timezone.now()

        if mode == "keep" and prev_name:
            entry = {"action": "keep", "filename": f.name, "prev_filename": prev_name, "format": fmt,
                     "by": getattr(request.user, "username", ""), "at": now.isoformat(), "size": f.size}
            hist = list(pair.report_history or [])
            hist.append(entry)
            pair.report_history = hist[-50:]
            pair.save(update_fields=["report_history", "updated_at"])
            log_audit(request, "UPDATE", pair,
                      {slot: {"old": prev_name, "new": prev_name,
                              "note": f"保留原有 {fmt.upper()} 未替换；本次上传 {f.name}"}})
            self._recompute_report_status(batch)
            data = NipptBioinfoPairSerializer(pair, context={"request": request}).data
            return Response({"message": f"已保留原 {fmt.upper()} 报告（仅记录本次上传）",
                             "mode": "keep", "format": fmt, "pair": data})

        action = "replace" if prev_name else "upload"
        setattr(pair, slot, f)
        fields = [slot, "report_history", "updated_at"]
        if slot == "report_file_pdf":
            pair.report_pdf_stale = False        # 新 PDF 上传 → 清除「可能过期」标记
            fields.append("report_pdf_stale")
        entry = {"action": action, "filename": f.name, "prev_filename": prev_name, "format": fmt,
                 "by": getattr(request.user, "username", ""), "at": now.isoformat(), "size": f.size}
        hist = list(pair.report_history or [])
        hist.append(entry)
        pair.report_history = hist[-50:]
        pair.save(update_fields=fields)
        log_audit(request, "UPDATE", pair, {slot: {"old": prev_name, "new": f.name}})
        self._recompute_report_status(batch)
        data = NipptBioinfoPairSerializer(pair, context={"request": request}).data
        return Response({"message": (f"{fmt.upper()} 报告已上传" if action == "upload" else f"{fmt.upper()} 报告已替换"),
                         "mode": mode, "format": fmt, "pair": data})

    @action(detail=True, methods=["post"], url_path="complete-report")
    def complete_report(self, request, pk=None):
        """Reports：完成报告批次。

        · 准入：所有达标配对（有结果且 QC normal）都已上传报告 + 已选复核人/审核人
        · 完成时把达标配对两侧样本的 workflow_stage 置 COMPLETED
          → 案例管理里对应的 case 变成「已完成」
        · 未达标配对不参与（其 case 保持「有失败」，需重做/重采）
        """
        from django.contrib.auth import get_user_model
        User = get_user_model()
        batch = self.get_object()
        if batch.report_status == "COMPLETED":
            return Response({"error": "该批次报告已完成"}, status=400)

        todo = self._reportable_pairs(batch)
        missing = [p for p in todo if not p.has_report()]      # 任一格式即算已上传（2026-10-13）
        if missing:
            names = "、".join((p.case.pt_number or p.case.case_number) for p in missing)
            return Response({"error": f"以下配对还未上传报告：{names}"}, status=400)

        rid, aid = request.data.get("reviewer_id"), request.data.get("auditor_id")
        reviewer = User.objects.filter(id=rid).first() if rid else None
        auditor = User.objects.filter(id=aid).first() if aid else None
        if not reviewer or not auditor:
            return Response({"error": "请先选择复核人和审核人"}, status=400)

        now = timezone.now()
        ids = []
        for p in todo:
            ids += [str(x) for x in (p.mother_sample.case_sample_ids or [])]
            ids += [str(x) for x in (p.father_sample.case_sample_ids or [])]
        ids = list(dict.fromkeys(ids))

        # ── 备用样本：同一 test_sample_id（同一孕妇/同一疑父）但不属于任何配对的样本
        #    → is_active=False 退出 case 状态计算（阶段保持不动，与“重做替代”样本的处理一致）
        #    ⚠️ 不同疑父（HA/HB，test_id 不同）不受影响 → 必须等各自配对都完成，case 才算完成
        referenced = set()
        for pp in NipptBioinfoPair.objects.select_related("mother_sample", "father_sample"):
            referenced |= {str(x) for x in (pp.mother_sample.case_sample_ids or [])}
            referenced |= {str(x) for x in (pp.father_sample.case_sample_ids or [])}
        spare_ids = []
        for p in todo:
            own = {str(x) for x in (p.mother_sample.case_sample_ids or [])}
            own |= {str(x) for x in (p.father_sample.case_sample_ids or [])}
            tids = set(CaseSample.objects.filter(id__in=own).exclude(test_sample_id="")
                       .values_list("test_sample_id", flat=True))
            if not tids:
                continue
            for cs in CaseSample.objects.filter(case=p.case, is_active=True, test_sample_id__in=tids):
                if str(cs.id) not in referenced:
                    spare_ids.append(str(cs.id))
        spare_ids = list(dict.fromkeys(spare_ids))

        with transaction.atomic():
            if spare_ids:
                CaseSample.objects.filter(id__in=spare_ids).update(is_active=False)
            batch.report_reviewer = reviewer
            batch.report_auditor = auditor
            batch.report_reviewed_at = now
            batch.report_audited_at = now
            batch.report_status = "COMPLETED"
            batch.save(update_fields=["report_reviewer", "report_auditor", "report_reviewed_at",
                                      "report_audited_at", "report_status", "updated_at"])
            if ids:
                # COMPLETED 分支内部会同步案例级状态（sync_case_status_for_samples）
                update_wf(ids, "COMPLETED", "COMPLETE", batch.batch_number, request.user)

        log_audit(request, "UPDATE", batch, {"report_status": {"old": "TO_REVIEW", "new": "COMPLETED",
                                                              "note": f"复核 {reviewer.username} / 审核 {auditor.username}"}})
        return Response({"message": f"报告批次已完成（{len(todo)} 个达标配对，{len(ids)} 个样本转入已完成）",
                         "advanced_samples": len(ids), "report_status": "COMPLETED"})

    @action(detail=True, methods=["post"])
    def add_manual_pair(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"error": "Batch already completed"}, status=400)
        mid = request.data.get("mother_sample_id")
        fid = request.data.get("father_sample_id")
        if not mid or not fid:
            return Response({"error": "mother_sample_id and father_sample_id required"}, status=400)
        try:
            mother = NipptBioinfoSample.objects.get(id=mid, batch=batch)
            father = NipptBioinfoSample.objects.get(id=fid, batch=batch)
        except NipptBioinfoSample.DoesNotExist as e:
            return Response({"error": str(e)}, status=404)
        if mother.role != "MOTHER":
            return Response({"error": "mother must be MOTHER"}, status=400)
        label = request.data.get("father_label") or ""
        if not label:
            existing = NipptBioinfoPair.objects.filter(batch=batch, mother_sample=mother).count()
            label = "H" if existing == 0 else f"H{chr(65 + existing)}"
        pair = NipptBioinfoPair.objects.create(
            batch=batch, case=mother.case, mother_sample=mother,
            father_sample=father, father_label=label, is_cross_batch=True)
        return Response(NipptBioinfoPairSerializer(pair).data, status=201)

    @action(detail=True, methods=["get"])
    def export_template(self, request, pk=None):
        """Download CSV template with pair info pre-filled (including metric columns)"""
        batch = self.get_object()
        pairs = batch.pairs.select_related("case").order_by("case__case_number", "father_label")
        import csv, io
        output = io.StringIO()
        writer = csv.writer(output)
        # 14 列：不再含 cpi / cpi_combined（cpi 由 result 自动派生）；result 前新增 auto_result
        # auto_result = 分析系统自动生成的结果（人工从分析系统转录，不落库，仅用于上传时核对）
        writer.writerow([
            "case_number", "pt_number", "father_label",
            "auto_result", "result", "note",
            # 指标列顺序：layers → het_ratio → y_ratio → concentration（母、父各 4）
            "mother_layers", "mother_het_ratio", "mother_y_ratio", "mother_concentration",
            "father_layers", "father_het_ratio", "father_y_ratio", "father_concentration",
        ])
        for p in pairs:
            writer.writerow([
                p.case.case_number, p.case.pt_number or "", p.father_label,
                "", NIPPT_RESULT_LETTER.get(p.result, ""), p.note or "",
                p.mother_layers or "", p.mother_het_ratio or "", p.mother_y_ratio or "", p.mother_concentration or "",
                p.father_layers or "", p.father_het_ratio or "", p.father_y_ratio or "", p.father_concentration or "",
            ])
        response = HttpResponse(output.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="bioinfo_{batch.batch_number}_template.csv"'
        return response

    @action(detail=True, methods=["post"])
    def import_cpi(self, request, pk=None):
        """Import result (Y/N/O) + metrics from CSV or Excel file.

- result / auto_result 取值 Y=支持 N=不支持 O=临界（兼容旧模板全称）
- auto_result 与 result 同时有值且不一致 → **整批中止**，不写入任何行
- cpi 不再从文件读取，按 result 自动派生（支持=10000 / 不支持=0.0001 / 临界与空=空）
- auto_result 不落库，仅用于核对
"""
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"error": "Batch already completed"}, status=400)
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "No file uploaded"}, status=400)
        # Parse（2026-10-13 加固：坏文件 / 非 UTF-8 编码 / 老版 .xls 一律 400 友好提示，不再 500）
        rows = []
        fname = uploaded.name.lower()
        try:
            if fname.endswith(".csv"):
                import csv, io
                content_bytes = uploaded.read()
                content_str = None
                for _enc in ("utf-8-sig", "gbk", "latin-1"):   # 编码逐级兜底（GBK 的化验单很常见）
                    try:
                        content_str = content_bytes.decode(_enc)
                        break
                    except UnicodeDecodeError:
                        continue
                if content_str is None:
                    return Response({"error": "CSV 编码无法识别，请另存为 UTF-8 后上传"}, status=400)
                reader = csv.DictReader(io.StringIO(content_str))
                rows = list(reader)
            elif fname.endswith(".xls"):
                # openpyxl 只支持 .xlsx；老版 .xls 以前会直接 500，这里给出明确指引
                return Response({"error": "不支持老版 .xls，请用 Excel 另存为 .xlsx 后上传"}, status=400)
            elif fname.endswith(".xlsx"):
                import openpyxl
                wb = openpyxl.load_workbook(uploaded, read_only=True)
                ws = wb.active
                headers = [str(cell.value or "") for cell in next(ws.iter_rows(min_row=1, max_row=1))]
                for row in ws.iter_rows(min_row=2, values_only=True):
                    rows.append(dict(zip(headers, [str(v) if v is not None else "" for v in row])))
            else:
                return Response({"error": "Unsupported format. Use .csv or .xlsx"}, status=400)
        except Exception as exc:
            return Response({"error": "文件无法解析（可能已损坏、被加密或格式不符）：%s" % exc}, status=400)
        # ── 单元格归一化：na / N/A / nan / - / null 等一律视为空（不覆盖原值、不报错）──
        rows = [{k: nippt_cell_norm(v) for k, v in r.items()} for r in rows]

        # Build pair index（模板格式：三键精确匹配）
        pair_index = {}
        # Build PT index（管线格式：按 PT 号自动匹配，仅限本批次）
        pt_index = {}
        paired_sample_ids = set()
        for p in batch.pairs.select_related("case"):
            key = (p.case.case_number, p.case.pt_number or "", p.father_label)
            pair_index[key] = p
            pt_index.setdefault(nippt_pt_norm(p.case.pt_number or ""), []).append(p)
            paired_sample_ids.add(str(p.mother_sample_id))
            paired_sample_ids.add(str(p.father_sample_id))
        # 未配对样本索引（按 PT 号）：只有一侧数据时写到样本行指标
        unpaired_mother_index = {}
        unpaired_father_index = {}
        for s in batch.samples.select_related("case"):
            if str(s.id) in paired_sample_ids:
                continue
            k = nippt_pt_norm(s.case.pt_number or "")
            (unpaired_mother_index if s.role == "MOTHER" else unpaired_father_index).setdefault(k, []).append(s)

        # ── 格式判定：管线原始格式（W/H 文件名列）还是标准 14 列模板 ──
        _hdr = {str(k).strip().lower() for k in (rows[0].keys() if rows else [])}
        is_pipeline = ("w" in _hdr and "h" in _hdr and "case_number" not in _hdr)

        def _row_get(row, name):
            """按列名取值（忽略大小写/空白）"""
            for k, v in row.items():
                if str(k).strip().lower() == name:
                    return v
            return ""
        METRIC_FIELDS = [
            "mother_layers", "mother_concentration", "mother_het_ratio", "mother_y_ratio",
            "father_layers", "father_concentration", "father_het_ratio", "father_y_ratio",
        ]
        # ── Pass 1：解析 + 校验 + 收集 auto_result/result 不一致 ──
        parsed = []       # [(pair, upd, result_enum|None)]
        errors = []
        mismatches = []
        warnings = []
        matched = []      # 管线模式：自动匹配成功的行（配对）
        sample_matched = []   # 只有一侧数据时落到"未配对样本"的行
        for i, row in enumerate(rows, start=2):
            # ── 行身份：PT 号（pt_number 列 或 W/H 文件名）+ 父标签 ──
            h_raw = str(_row_get(row, "h") or "")
            w_raw = str(_row_get(row, "w") or "")
            pt_h, label_file, pt_w = nippt_pipeline_parse_name(h_raw, w_raw)
            pt_col = nippt_pt_norm(_row_get(row, "pt_number"))
            pt_key = pt_col or nippt_pt_norm(pt_h) or nippt_pt_norm(pt_w)
            label = str(_row_get(row, "father_label") or "").strip().upper() or label_file
            if not pt_key:
                errors.append(
                    f"行 {i}: 无法确定 PT 号（H 列='{h_raw}'，W 列='{w_raw}'，pt_number 列="
                    f"'{_row_get(row, 'pt_number')}'）")
                continue

            # 两侧是否有数据：该侧文件名叫得出 PT、该侧任一指标非空，或（模板格式）填了 father_label
            # 注意：模板行可能"只填 result 不填指标"，此时 father_label='H' 说明这是配对行，不能当"只有孕妇"
            f_side = ["father_layers", "father_concentration", "father_het_ratio", "father_y_ratio"]
            m_side = ["mother_layers", "mother_concentration", "mother_het_ratio", "mother_y_ratio"]
            label_col = str(_row_get(row, "father_label") or "").strip()
            has_f = (bool(pt_h) or bool(label_col)
                     or any(str(_row_get(row, f) or "").strip() for f in f_side))
            has_m = bool(pt_w) or any(str(_row_get(row, f) or "").strip() for f in m_side)

            auto_raw = str(_row_get(row, "auto_result") or "").strip().upper()
            result_raw = str(_row_get(row, "result") or "").strip().upper()
            auto_enum = NIPPT_LETTER_RESULT.get(auto_raw) if auto_raw else None
            result_enum = NIPPT_LETTER_RESULT.get(result_raw) if result_raw else None
            if auto_raw and not auto_enum:
                errors.append(f"行 {i}: invalid auto_result '{auto_raw}'（允许 Y/N/O 或 支持/不支持/临界）")
                continue
            if result_raw and not result_enum:
                errors.append(f"行 {i}: invalid result '{result_raw}'（允许 Y/N/O 或 支持/不支持/临界）")
                continue

            pair = None
            target_sample = None
            write_result = False
            if has_f:
                # ── 有疑父数据：按 PT 找配对（同 PT 多父时用文件名标签缩小）──
                cands = pt_index.get(pt_key, [])
                if len(cands) == 1:
                    pair = cands[0]
                elif len(cands) > 1:
                    narrowed = [p for p in cands if (p.father_label or "").upper() == label]
                    if len(narrowed) != 1:
                        errors.append(
                            f"行 {i}: PT={pt_key} 在本批次有 {len(cands)} 个疑父样本，标签='{label}' 无法唯一确定 → 已跳过")
                        continue
                    pair = narrowed[0]
                else:
                    s_cands = unpaired_father_index.get(pt_key, [])
                    if len(s_cands) == 1:
                        target_sample = s_cands[0]
                    elif len(s_cands) > 1:
                        errors.append(f"行 {i}: PT={pt_key} 在本批次有 {len(s_cands)} 个未配对疑父样本 → 已跳过")
                        continue
                    else:
                        errors.append(
                            f"行 {i}: 本批次没有 PT={pt_key} 的配对或未配对样本（H 文件名='{h_raw}'）→ 已跳过")
                        continue
                if pair is not None:
                    write_result = True
                    if pt_w and pt_h and nippt_pt_norm(pt_w) != nippt_pt_norm(pt_h):
                        warnings.append(
                            f"行 {i}: 母/父文件名 PT 号不一致（W={pt_w} / H={pt_h}），已按 H 列匹配")
                    matched.append({"row": i, "case_number": pair.case.case_number,
                                    "pt_number": pair.case.pt_number or "",
                                    "father_label": pair.father_label, "h_file": h_raw})
                else:
                    if result_raw:
                        warnings.append(
                            f"行 {i}: 未配对样本没有 CPI 结果字段，文件里的 result='{result_raw}' 已忽略")
                    sample_matched.append({"row": i, "kind": "未配对疑父样本",
                                           "case_number": target_sample.case.case_number,
                                           "pt_number": target_sample.case.pt_number or "",
                                           "name": target_sample.patient_name})
            else:
                # ── 只有孕妇（H 为 na/空）：先找未配对母样本，再找配对；只写母侧指标，不动 result/cpi ──
                s_cands = unpaired_mother_index.get(pt_key, [])
                p_cands = pt_index.get(pt_key, [])
                if len(s_cands) == 1 and not p_cands:
                    target_sample = s_cands[0]
                elif len(p_cands) == 1 and not s_cands:
                    pair = p_cands[0]
                elif not s_cands and not p_cands:
                    errors.append(f"行 {i}: 本批次没有 PT={pt_key} 的样本或配对（W 文件名='{w_raw}'）→ 已跳过")
                    continue
                else:
                    errors.append(
                        f"行 {i}: PT={pt_key} 匹配不唯一（未配对母样本 {len(s_cands)} 个、配对 {len(p_cands)} 个）"
                        f" → 已跳过，请人工确认")
                    continue
                if result_raw:
                    warnings.append(
                        f"行 {i}: 只有孕妇的行不含 CPI 结果，文件里的 result='{result_raw}' 已忽略")
                if pair is not None:
                    matched.append({"row": i, "case_number": pair.case.case_number,
                                    "pt_number": pair.case.pt_number or "",
                                    "father_label": pair.father_label, "h_file": h_raw,
                                    "mother_only": True})
                else:
                    sample_matched.append({"row": i, "kind": "未配对母样本",
                                           "case_number": target_sample.case.case_number,
                                           "pt_number": target_sample.case.pt_number or "",
                                           "name": target_sample.patient_name})

            # 一致性核对：仅对会写入 result 的配对行生效（只有孕妇的行不含 CPI，不参与核对）
            if write_result and auto_enum and result_enum and auto_enum != result_enum:
                mismatches.append({
                    "row": i, "case_number": pair.case.case_number,
                    "pt_number": pair.case.pt_number or "", "father_label": pair.father_label,
                    "auto_result": auto_raw, "result": result_raw,
                })
                continue

            upd = {"updated_at": timezone.now()}
            if pair is not None:
                note_s = str(_row_get(row, "note") or "").strip()
                if note_s:
                    upd["note"] = note_s
                fields = METRIC_FIELDS
            else:
                # 未配对样本：该侧指标 → 样本行字段（father_layers → layers 等）；样本无 note 字段、无 updated_at
                fields = m_side if (target_sample.role == "MOTHER") else f_side
                upd = {"processed_at": timezone.now()}
            bad = False
            for f in fields:
                val_s = str(_row_get(row, f) or "").strip()
                if val_s:
                    try:
                        v = nippt_parse_metric_number(val_s)
                    except (ValueError, TypeError):
                        errors.append(f"行 {i}: invalid {f} '{val_s}'")
                        bad = True
                        break
                    upd[f if pair is not None else f.split("_", 1)[1]] = v
            if bad:
                continue
            parsed.append((pair, target_sample, upd, result_enum, write_result))

        # 有不一致 → 整批中止，一行都不写入
        if mismatches:
            return Response({
                "error": f"导入已中止：auto_result 与 result 不一致 {len(mismatches)} 行，请核对后再上传",
                "aborted": True,
                "mismatch_count": len(mismatches),
                "mismatches": mismatches[:20],
                "errors": errors[:20],
                "total_rows": len(rows),
            }, status=400)

        # ── Pass 2：写入（配对：cpi 由 result 自动派生；未配对样本：只写该侧指标）──
        updated = 0
        samples_updated = 0
        for pair, target_sample, upd, result_enum, write_result in parsed:
            if pair is not None:
                if write_result:
                    # 文件里 result 为空 → 结果就为空（低浓度样本可能没有结果），不再保留库内原值
                    final_result = result_enum if result_enum is not None else ""
                    upd["result"] = final_result
                    upd["cpi"] = NIPPT_CPI_BY_RESULT.get(final_result)
                NipptBioinfoPair.objects.filter(id=pair.id).update(**upd)
                updated += 1
            else:
                NipptBioinfoSample.objects.filter(id=target_sample.id, batch=batch).update(**upd)
                samples_updated += 1
        skipped = len(errors)
        if is_pipeline or samples_updated or matched or sample_matched:
            msg = f"导入完成：配对更新 {updated} 行"
            if samples_updated:
                msg += f"、未配对样本更新 {samples_updated} 行"
            msg += f"，跳过 {skipped} 行"
        else:
            msg = f"Updated {updated}, skipped {skipped}"
        return Response({
            "message": msg,
            "mode": "pipeline" if is_pipeline else "template",
            "updated": updated, "samples_updated": samples_updated, "skipped": skipped,
            "errors": errors[:20], "total_rows": len(rows), "mismatches": [],
            "matched": matched[:50], "sample_matched": sample_matched[:50], "warnings": warnings[:20],
        })

    # destroy 由 NipptBatchDeleteMixin 提供



