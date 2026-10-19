"""NIPT 分步批次 API（阶段2：提取 / 建库）。

设计要点（对应方案 §15）：
- 路径平铺：`/api/v1/nipt/extraction/…`、`/api/v1/nipt/library/…`
- **不改 `SampleRun` 任何行为**：旧 `/runs/{id}/save_extraction/` 继续可用（对照/回退）
- `save_*` 的 body 与旧接口**完全一致**（`{extraction_data: {...}, extraction_method: ...}` /
  `{library_data: {...}, library_method: ...}`），只是把落点从 run 换成批次
- 签名复用 `workflows.views.SampleRunViewSet._resolve_workflow_signers`（同一套签名人+密码校验）
- 照片复用 `workflows.nipt_run_photos`（namespace `nipt_workflow/<batch_id>/<module>/`）
- `Sample.status` 只在 complete 时**向前推进**（panel 限定 + 只升不降）
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from lims.apps.samples.models import Sample
from lims.apps.workflows.nipt_run_photos import delete_run_photo, store_run_photo
from lims.apps.workflows.views import SampleRunViewSet

from .models import (NiptBioinformaticsBatch, NiptBioinformaticsSample,
                     NiptExtractionBatch, NiptExtractionSample,
                     NiptLibraryBatch, NiptLibrarySample,
                     NiptPoolingBatch, NiptPoolingSample,
                     NiptSequencingBatch, NiptSequencingSample)
from .serializers import (CreateExtractionBatchSerializer, CreateLibraryBatchSerializer,
                          NiptBioinformaticsBatchDetailSerializer, NiptBioinformaticsBatchListSerializer,
                          NiptExtractionBatchDetailSerializer, NiptExtractionBatchListSerializer,
                          NiptLibraryBatchDetailSerializer, NiptLibraryBatchListSerializer,
                          NiptPoolingBatchDetailSerializer, NiptPoolingBatchListSerializer,
                          NiptSequencingBatchDetailSerializer, NiptSequencingBatchListSerializer)

NIPT_PANELS = ("NIPT", "NIPT_PLUS", "NIPT_FULL", "twin_basic")

#: 批次完成后仍允许补改的字段（补照片）；其余字段保持锁定
PHOTO_ONLY_KEYS = {"photos", "photos_female", "photos_male"}

_LADDER = ["REGISTERED", "RECEIVING", "RECEIVED", "ACCEPTED", "PRE_PROCESSING",
           "PLASMA_SEPARATED", "EXTRACTION", "LIBRARY_PREP", "POOLING", "SEQUENCING",
           "BIOINFORMATICS", "COMPLETED"]


def _advance_sample_status(sample_ids, target):
    """把样本状态**向前**推到 target：panel 限定 NIPT*，已超过 target 的一律跳过。"""
    if not sample_ids or target not in _LADDER:
        return 0
    tgt = _LADDER.index(target)
    moved = 0
    for s in Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS).only("id", "status"):
        cur = s.status or "REGISTERED"
        if cur in _LADDER and _LADDER.index(cur) < tgt:
            Sample.objects.filter(id=s.id).update(status=target, updated_at=timezone.now())
            moved += 1
    return moved


class _StepBatchViewSet(viewsets.GenericViewSet,
                        mixins.ListModelMixin, mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin, mixins.DestroyModelMixin):
    """批次 ViewSet 公共部分：list/retrieve/create/destroy/photos/save/complete/reopen。"""

    DATA_KEY = ""          # 'extraction_data' / 'library_data'
    METHOD_KEY = ""        # 'extraction_method' / 'library_method'
    PHOTO_MODULE = ""      # 'extraction' / 'library'
    COMPLETE_STATUS = ""   # complete 后样本应推进到的 Sample.status
    PENDING_LABEL = ""

    def get_serializer_class(self):
        return self.list_serializer_class if self.action == "list" else self.detail_serializer_class

    # ── 保存实验数据（body 与旧 /runs/{id}/save_* 一致）──
    def _save_data(self, request):
        batch = self.get_object()
        body = request.data or {}
        payload = body.get(self.DATA_KEY) or {}
        if not isinstance(payload, dict):
            payload = {}
        if batch.status == "COMPLETED":
            # 完成后只允许「补照片」：payload 里除照片字段外还有内容就拒绝
            extra = set(payload.keys()) - PHOTO_ONLY_KEYS
            if extra:
                return Response({"error": "批次已完成，仅可补传实验照片；如需修改其他内容请先「撤销完成」"},
                                status=status.HTTP_400_BAD_REQUEST)

        cur = dict(getattr(batch, self.DATA_KEY) or {})
        cur.update(payload)
        setattr(batch, self.DATA_KEY, cur)

        method = body.get(self.METHOD_KEY) or ""
        if method:
            setattr(batch, self.METHOD_KEY, method)
        region = body.get("region") or ""
        if region:
            batch.region = region
        if batch.status == "DRAFT":
            batch.status = "IN_PROGRESS"
        batch.save()

        self._apply_sample_results(batch, payload.get("sample_results") or {})
        return Response(self.detail_serializer_class(batch).data)

    def _apply_sample_results(self, batch, results):
        """把组件的 sample_results（按 vgId / 条码 / sample_id 索引）落到本批次样本行的 QC 上。

        只写本批次的行与 `Sample.status` 无关 → 不影响看板，也不影响旧 run。
        """
        if not results:
            return 0
        rows = list(batch.samples.select_related("sample"))
        idx = {}
        for r in rows:
            for k in (r.sample.vg_id, r.sample.sample_id, r.barcode, str(r.sample_id)):
                if k:
                    idx[k] = r
        n = 0
        for key, val in results.items():
            r = idx.get(key) or idx.get(str(key))
            if r is None or not isinstance(val, dict):
                continue
            qc = val.get("qc") or val.get("qc_status") or ""
            note = val.get("note") or val.get("qc_note") or ""
            upd = {}
            if qc:
                passed = str(qc).upper().startswith("PASS")
                upd["qc_status"] = "PASS" if passed else "FAIL"
                upd["status"] = "PASSED_QC" if passed else "FAILED_QC"
            if note:
                upd["qc_note"] = str(note)[:2000]
            if upd:
                type(r).objects.filter(id=r.id).update(processed_at=timezone.now(), **upd)
                n += 1
        return n

    # ── 电子签名（复用 workflows 的签名人/密码校验）──
    def _sign(self, request):
        batch = self.get_object()
        role = (request.data or {}).get("role", "")
        if role not in ("operator", "reviewer"):
            return Response({"error": "role must be 'operator' or 'reviewer'."},
                            status=status.HTTP_400_BAD_REQUEST)
        sig_list, err = SampleRunViewSet._resolve_workflow_signers(request.data)
        if err:
            return err
        sig_data = sig_list if len(sig_list) > 1 else sig_list[0]
        cur = dict(getattr(batch, self.DATA_KEY) or {})
        cur["operator_signature" if role == "operator" else "reviewer_signature"] = sig_data
        setattr(batch, self.DATA_KEY, cur)
        names = [s.get("username", "") for s in sig_list]
        if role == "operator":
            batch.operator_name = ",".join(names)
        else:
            batch.reviewer = ",".join(names)
        batch.save()
        return Response(cur)

    # ── 照片 ──
    @action(detail=True, methods=["post", "delete"], parser_classes=[MultiPartParser, FormParser],
            url_path="photos")
    def photos(self, request, pk=None):
        batch = self.get_object()
        module = request.query_params.get("module") or self.PHOTO_MODULE
        if request.method == "POST":
            f = request.FILES.get("file") or request.FILES.get("photo")
            if not f:
                return Response({"detail": "缺少 file"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                url = store_run_photo(module, str(batch.id), f)
            except ValueError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"url": url, "name": url.rsplit("/", 1)[-1]})
        name = request.query_params.get("name") or ""
        if not name:
            return Response({"detail": "缺少 name"}, status=status.HTTP_400_BAD_REQUEST)
        delete_run_photo(module, str(batch.id), name)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── 完成 / 撤销完成 ──
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response(self.detail_serializer_class(batch).data)
        empty = batch.samples.filter(well_position="").count()
        if empty:
            return Response({"error": "还有 %d 个样本未排板（无孔位），不能完成" % empty},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            batch.status = "COMPLETED"
            batch.save(update_fields=["status", "updated_at"])
            moved = _advance_sample_status(
                list(batch.samples.values_list("sample_id", flat=True)), self.COMPLETE_STATUS)
        return Response({"id": str(batch.id), "status": batch.status, "samples_advanced": moved})

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        batch = self.get_object()
        batch.status = "IN_PROGRESS"
        batch.save(update_fields=["status", "updated_at"])
        return Response({"id": str(batch.id), "status": batch.status})


class NiptExtractionViewSet(_StepBatchViewSet):
    """提取批次 /api/v1/nipt/extraction/"""

    queryset = NiptExtractionBatch.objects.all()
    list_serializer_class = NiptExtractionBatchListSerializer
    detail_serializer_class = NiptExtractionBatchDetailSerializer
    DATA_KEY = "extraction_data"
    METHOD_KEY = "extraction_method"
    PHOTO_MODULE = "extraction"
    COMPLETE_STATUS = "EXTRACTION"

    def create(self, request, *args, **kwargs):
        ser = CreateExtractionBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sample_ids = ser.validated_data["sample_ids"]
        samples = list(Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS))
        if len(samples) != len(set(sample_ids)):
            return Response({"error": "部分样本不存在或不属于 NIPT panel"},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            batch = NiptExtractionBatch.objects.create(
                batch_number=NiptExtractionBatch.generate_batch_number(),
                status="DRAFT",
                created_by=request.user if request.user.is_authenticated else None,
            )
            for s in samples:
                NiptExtractionSample.objects.create(
                    batch=batch, sample=s, patient_name=s.patient_name or "",
                    sample_source=s.sample_source or "", status="QUEUED", plate_number=1,
                )
        return Response(self.detail_serializer_class(batch).data, status=status.HTTP_201_CREATED)

    def pending_queryset(self):
        """待提取：NIPT* 样本，状态在血浆已分离~提取之间，且尚未进入任何提取批次。"""
        used = list(NiptExtractionSample.objects.values_list("sample_id", flat=True))
        return (Sample.objects.filter(panel__code__in=NIPT_PANELS,
                                      status__in=["PLASMA_SEPARATED", "EXTRACTION"])
                .exclude(id__in=used).exclude(status="REJECTED")
                .order_by("receipt_date", "sample_id"))

    @action(detail=False, methods=["get"])
    def pending(self, request):
        qs = self.pending_queryset()
        return Response({"count": qs.count(), "results": [
            {"id": str(s.id), "sample_id": s.sample_id, "patient_name": s.patient_name or "",
             "sample_source": s.sample_source or "", "status": s.status,
             "plasma_remaining": s.plasma_remaining,
             "receipt_date": str(s.receipt_date or "")}
            for s in qs[:500]]})

    @action(detail=True, methods=["post"], url_path="save_extraction")
    def save_extraction(self, request, pk=None):
        return self._save_data(request)

    @action(detail=True, methods=["post"], url_path="extraction/sign")
    def sign_extraction(self, request, pk=None):
        return self._sign(request)


class NiptLibraryViewSet(_StepBatchViewSet):
    """建库批次（可汇多个提取批次的样本）/api/v1/nipt/library/"""

    queryset = NiptLibraryBatch.objects.all()
    list_serializer_class = NiptLibraryBatchListSerializer
    detail_serializer_class = NiptLibraryBatchDetailSerializer
    DATA_KEY = "library_data"
    METHOD_KEY = "library_method"
    PHOTO_MODULE = "library"
    COMPLETE_STATUS = "LIBRARY_PREP"

    def create(self, request, *args, **kwargs):
        ser = CreateLibraryBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sample_ids = list(dict.fromkeys(ser.validated_data["sample_ids"]))
        want_upstream = ser.validated_data.get("source_extraction_sample_ids") or []

        samples = list(Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS))
        if len(samples) != len(sample_ids):
            return Response({"error": "部分样本不存在或不属于 NIPT panel"},
                            status=status.HTTP_400_BAD_REQUEST)

        # 上游指针：显式给的优先，其余自动取该样本最近一条 QC 通过的提取行（M:N 自动拼接）
        upstream = {}
        if want_upstream:
            for row in NiptExtractionSample.objects.filter(id__in=want_upstream):
                upstream[row.sample_id] = row.id
        for s in samples:
            if s.id in upstream:
                continue
            row = (NiptExtractionSample.objects.filter(sample=s, qc_status="PASS")
                   .order_by("-created_at").first()
                   or NiptExtractionSample.objects.filter(sample=s).order_by("-created_at").first())
            upstream[s.id] = row.id if row else None

        with transaction.atomic():
            batch = NiptLibraryBatch.objects.create(
                batch_number=NiptLibraryBatch.generate_batch_number(), status="DRAFT",
                created_by=request.user if request.user.is_authenticated else None,
            )
            for s in samples:
                NiptLibrarySample.objects.create(
                    batch=batch, sample=s, patient_name=s.patient_name or "",
                    sample_source=s.sample_source or "", status="QUEUED", plate_number=1,
                    source_extraction_sample_id=upstream.get(s.id),
                )
        return Response(self.detail_serializer_class(batch).data, status=status.HTTP_201_CREATED)

    def pending_queryset(self):
        """待建库：提取批次里 QC 通过、且尚未被任何建库批次引用的提取行（跨批次汇流）。"""
        used = [u for u in NiptLibrarySample.objects.values_list(
            "source_extraction_sample_id", flat=True) if u]
        return (NiptExtractionSample.objects
                .filter(qc_status="PASS", batch__status="COMPLETED")   # E：上游批次必须已「完成本步」
                .exclude(status="FAILED_QC").exclude(id__in=used)
                .select_related("batch", "sample")
                .order_by("batch__batch_number", "created_at"))

    @action(detail=False, methods=["get"])
    def pending(self, request):
        qs = self.pending_queryset()
        return Response({"count": qs.count(), "results": [
            {"extraction_sample_id": str(r.id), "sample_id": str(r.sample_id),
             "sample_code": r.sample.sample_id, "patient_name": r.patient_name,
             "sample_vg_id": r.sample.vg_id, "source_batch": r.batch.batch_number,
             "source_batch_id": str(r.batch_id), "well_position": r.well_position,
             "qc_status": r.qc_status}
            for r in qs[:500]]})

    @action(detail=True, methods=["post"], url_path="save_library")
    def save_library(self, request, pk=None):
        return self._save_data(request)

    @action(detail=True, methods=["post"], url_path="library/sign")
    def sign_library(self, request, pk=None):
        return self._sign(request)


# ══════════════════════════════════════════════════════════════
# 阶段 3：Pooling / 测序 / 生信（上游一律按「行」汇流）
# ══════════════════════════════════════════════════════════════

class _ChainStepMixin:
    """三步共用的 create / pending：从上游样本行勾选，指针记谱系。"""

    UPSTREAM_MODEL = None         # 上游样本行模型
    UPSTREAM_PTR = ""             # 本表指向上游的字段名
    UPSTREAM_ORDER = "created_at" # 待处理的排序

    def create(self, request, *args, **kwargs):
        ser = CreateLibraryBatchSerializer(data=request.data)   # 结构一致：sample_ids + source_*_ids
        ser.is_valid(raise_exception=True)
        sample_ids = list(dict.fromkeys(ser.validated_data["sample_ids"]))
        want_up = (ser.validated_data.get("source_extraction_sample_ids")
                   or (request.data or {}).get("source_sample_ids") or [])

        samples = list(Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS))
        if len(samples) != len(sample_ids):
            return Response({"error": "部分样本不存在或不属于 NIPT panel"},
                            status=status.HTTP_400_BAD_REQUEST)

        ptr = {}
        if want_up:
            for row in self.UPSTREAM_MODEL.objects.filter(id__in=want_up):
                ptr[row.sample_id] = row.id
        for s in samples:
            if s.id in ptr:
                continue
            row = (self.UPSTREAM_MODEL.objects.filter(sample=s)
                   .order_by("-created_at").first())
            ptr[s.id] = row.id if row else None

        with transaction.atomic():
            batch = self.model.objects.create(
                batch_number=self.model.generate_batch_number(), status="DRAFT",
                created_by=request.user if request.user.is_authenticated else None,
            )
            for s in samples:
                self.sample_model.objects.create(
                    batch=batch, sample=s, patient_name=s.patient_name or "",
                    sample_source=s.sample_source or "", status="QUEUED", plate_number=1,
                    **{self.UPSTREAM_PTR: ptr.get(s.id)},
                )
        return Response(self.detail_serializer_class(batch).data, status=status.HTTP_201_CREATED)

    def pending_queryset(self):
        used = [u for u in self.sample_model.objects.values_list(self.UPSTREAM_PTR, flat=True) if u]
        return (self.UPSTREAM_MODEL.objects
                .exclude(id__in=used)
                .exclude(status="FAILED_QC")
                .filter(batch__status="COMPLETED")     # E：上游批次必须已「完成本步」
                .select_related("batch", "sample")
                .order_by("batch__batch_number", self.UPSTREAM_ORDER))

    @action(detail=False, methods=["get"])
    def pending(self, request):
        qs = self.pending_queryset()
        return Response({"count": qs.count(), "results": [
            {"extraction_sample_id": str(r.id), "sample_id": str(r.sample_id),
             "sample_code": r.sample.sample_id, "patient_name": r.patient_name,
             "sample_vg_id": r.sample.vg_id, "source_batch": r.batch.batch_number,
             "well_position": r.well_position, "qc_status": r.qc_status}
            for r in qs[:500]]})


class NiptPoolingViewSet(_ChainStepMixin, _StepBatchViewSet):
    """Pooling /api/v1/nipt/pooling/"""

    queryset = NiptPoolingBatch.objects.all()
    model = NiptPoolingBatch
    sample_model = NiptPoolingSample
    list_serializer_class = NiptPoolingBatchListSerializer
    detail_serializer_class = NiptPoolingBatchDetailSerializer
    DATA_KEY = "pooling_data"
    METHOD_KEY = "pooling_base"
    PHOTO_MODULE = "pooling"
    COMPLETE_STATUS = "POOLING"
    UPSTREAM_MODEL = NiptLibrarySample
    UPSTREAM_PTR = "source_library_sample_id"

    @action(detail=True, methods=["post"], url_path="save_pooling")
    def save_pooling(self, request, pk=None):
        return self._save_data(request)

    @action(detail=True, methods=["post"], url_path="pooling/sign")
    def sign_pooling(self, request, pk=None):
        return self._sign(request)


class NiptSequencingViewSet(_ChainStepMixin, _StepBatchViewSet):
    """上机测序 /api/v1/nipt/sequencing/"""

    queryset = NiptSequencingBatch.objects.all()
    model = NiptSequencingBatch
    sample_model = NiptSequencingSample
    list_serializer_class = NiptSequencingBatchListSerializer
    detail_serializer_class = NiptSequencingBatchDetailSerializer
    DATA_KEY = "sequencing_data"
    METHOD_KEY = "platform"
    PHOTO_MODULE = "sequencing"
    COMPLETE_STATUS = "SEQUENCING"
    UPSTREAM_MODEL = NiptPoolingSample
    UPSTREAM_PTR = "source_pooling_sample_id"

    @action(detail=True, methods=["post"], url_path="save_sequencing")
    def save_sequencing(self, request, pk=None):
        return self._save_data(request)

    @action(detail=True, methods=["post"], url_path="sequencing/sign")
    def sign_sequencing(self, request, pk=None):
        return self._sign(request)


class NiptBioinformaticsViewSet(_ChainStepMixin, _StepBatchViewSet):
    """生信分析 /api/v1/nipt/bioinformatics/"""

    queryset = NiptBioinformaticsBatch.objects.all()
    model = NiptBioinformaticsBatch
    sample_model = NiptBioinformaticsSample
    list_serializer_class = NiptBioinformaticsBatchListSerializer
    detail_serializer_class = NiptBioinformaticsBatchDetailSerializer
    DATA_KEY = "bioinformatics_data"
    METHOD_KEY = "pipeline"
    PHOTO_MODULE = "bioinformatics"
    COMPLETE_STATUS = "BIOINFORMATICS"
    UPSTREAM_MODEL = NiptSequencingSample
    UPSTREAM_PTR = "source_sequencing_sample_id"

    @action(detail=True, methods=["post"], url_path="save_bioinformatics")
    def save_bioinformatics(self, request, pk=None):
        return self._save_data(request)


class NiptPendingCountsView(APIView):
    """菜单角标：一次返回 5 步的待处理数量。

    只数「本次可直接进批次」的行，口径与各步 /pending/ 完全一致（复用同一批 queryset）。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        def n(vs):
            try:
                return vs().pending_queryset().count()
            except Exception:
                return 0

        return Response({
            "extraction": n(NiptExtractionViewSet),
            "library": n(NiptLibraryViewSet),
            "pooling": n(NiptPoolingViewSet),
            "sequencing": n(NiptSequencingViewSet),
            "bioinformatics": n(NiptBioinformaticsViewSet),
        })


class NiptLineageView(APIView):
    """按样本返回实验链（提取→建库→Pooling→测序→生信），供报告页展示追溯信息。

    GET /api/v1/nipt/lineage/?sample_ids=<uuid>,<uuid>
    → { "<sample_uuid>": {"steps": [{step, batch, status, at, operator, reviewer}, ...]} }

    每一步取该样本**最新**的那一行（重做/多批次时以最后一次为准）。
    """

    permission_classes = [IsAuthenticated]

    STEPS = [
        ("extraction", NiptExtractionSample),
        ("library", NiptLibrarySample),
        ("pooling", NiptPoolingSample),
        ("sequencing", NiptSequencingSample),
        ("bioinformatics", NiptBioinformaticsSample),
    ]

    def get(self, request):
        raw = request.query_params.get("sample_ids") or ""
        ids = [x.strip() for x in raw.split(",") if x.strip()][:200]
        if not ids:
            return Response({})

        out = {sid: {"steps": []} for sid in ids}
        for step, M in self.STEPS:
            latest = {}
            for row in (M.objects.filter(sample_id__in=ids)
                        .select_related("batch").order_by("created_at")):
                latest[str(row.sample_id)] = row
            for sid, row in latest.items():
                b = row.batch
                out[sid]["steps"].append({
                    "step": step,
                    "batch": b.batch_number,
                    "status": b.status,
                    "at": row.created_at.strftime("%Y-%m-%d %H:%M") if row.created_at else "",
                    "operator": b.operator_name or "",
                    "reviewer": b.reviewer or "",
                })
        return Response(out)
