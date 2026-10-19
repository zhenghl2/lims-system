"""NIPT 分步批次 API（阶段2：提取 / 建库）。

设计要点（对应方案 §15）：
- 路径平铺，与现有风格一致：`/api/v1/nipt/extraction/…`、`/api/v1/nipt/library/…`
- **不改 `SampleRun` 任何行为**：旧 `/runs/{id}/save_extraction/` 继续可用（对照/回退）
- `Sample.status` 只在 complete 时**向前推进**（panel 限定 + 只升不降），绝不回退已有状态
- 照片直接复用 `workflows.nipt_run_photos`（namespace `nipt_workflow/<batch_id>/<module>/`）
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from lims.apps.samples.models import Sample
from lims.apps.workflows.nipt_run_photos import delete_run_photo, store_run_photo

from .models import (NiptExtractionBatch, NiptExtractionSample,
                     NiptLibraryBatch, NiptLibrarySample)
from .serializers import (CreateExtractionBatchSerializer, CreateLibraryBatchSerializer,
                          NiptExtractionBatchDetailSerializer, NiptExtractionBatchListSerializer,
                          NiptLibraryBatchDetailSerializer, NiptLibraryBatchListSerializer)

NIPT_PANELS = ("NIPT", "NIPT_PLUS", "NIPT_FULL", "twin_basic")

#: Sample.status 的 NIPT 阶梯（complete 时只前进、不回退）
_LADDER = ["REGISTERED", "RECEIVING", "RECEIVED", "ACCEPTED", "PRE_PROCESSING",
           "PLASMA_SEPARATED", "EXTRACTION", "LIBRARY_PREP", "POOLING", "SEQUENCING",
           "BIOINFORMATICS", "COMPLETED"]


def _advance_sample_status(sample_ids, target):
    """把样本状态**向前**推到 target：panel 限定 NIPT*，已超过 target 的样本一律跳过。"""
    if not sample_ids:
        return 0
    try:
        tgt_idx = _LADDER.index(target)
    except ValueError:
        return 0
    moved = 0
    qs = Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS)
    for s in qs.only("id", "status"):
        cur = s.status or "REGISTERED"
        if cur in _LADDER and _LADDER.index(cur) < tgt_idx:
            Sample.objects.filter(id=s.id).update(status=target, updated_at=timezone.now())
            moved += 1
    return moved


class _StepBatchViewSet(viewsets.GenericViewSet,
                        mixins.ListModelMixin, mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin, mixins.DestroyModelMixin):
    """两个批次 ViewSet 的公共部分（list/retrieve/create/destroy/photos/complete/reopen）。"""

    PHOTO_MODULE = ""
    BATCH_PREFIX = ""
    DETAIL_MODEL = None
    SAMPLE_MODEL = None

    def get_serializer_class(self):
        return self.list_serializer_class if self.action == "list" else self.detail_serializer_class

    # ── 待处理（各步自己实现）──
    @action(detail=False, methods=["get"])
    def pending(self, request):
        raise NotImplementedError

    # ── 保存实验数据（JSON 合并，组件 body 结构不变）──
    def _save_data(self, request, pk, field):
        batch = self.get_object()
        if batch.status == "COMPLETED":
            return Response({"detail": "批次已完成，如需修改请先「撤销完成」"},
                            status=status.HTTP_400_BAD_REQUEST)
        payload = request.data or {}
        data = dict(getattr(batch, field) or {})
        data.update(payload)
        setattr(batch, field, data)
        if batch.status == "DRAFT":
            batch.status = "IN_PROGRESS"
        # 操作人/复核人：组件把签名信息放在顶层字段里
        if payload.get("operator_name") is not None:
            batch.operator_name = payload.get("operator_name") or ""
        if payload.get("reviewer") is not None:
            batch.reviewer = payload.get("reviewer") or ""
        batch.save()
        return Response(self.detail_serializer_class(batch).data)

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
            return Response({"detail": "还有 %d 个样本未排板（无孔位），不能完成" % empty},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            batch.status = "COMPLETED"
            batch.save(update_fields=["status", "updated_at"])
            moved = _advance_sample_status(
                list(batch.samples.values_list("sample_id", flat=True)), self.COMPLETE_STATUS)
        return Response({"id": str(batch.id), "status": batch.status,
                         "samples_advanced": moved})

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        batch = self.get_object()
        batch.status = "IN_PROGRESS"
        batch.save(update_fields=["status", "updated_at"])
        return Response({"id": str(batch.id), "status": batch.status})


class NiptExtractionViewSet(_StepBatchViewSet):
    """提取批次。"""

    queryset = NiptExtractionBatch.objects.all()
    list_serializer_class = NiptExtractionBatchListSerializer
    detail_serializer_class = NiptExtractionBatchDetailSerializer
    PHOTO_MODULE = "extraction"
    COMPLETE_STATUS = "EXTRACTION"

    def create(self, request, *args, **kwargs):
        ser = CreateExtractionBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sample_ids = ser.validated_data["sample_ids"]
        samples = list(Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS)
                       .select_related("panel"))
        if len(samples) != len(set(sample_ids)):
            return Response({"detail": "部分样本不存在或不属于 NIPT panel"},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            batch = NiptExtractionBatch.objects.create(
                batch_number=NiptExtractionBatch.generate_batch_number(),
                status="DRAFT", created_by=request.user if request.user.is_authenticated else None,
            )
            for s in samples:
                NiptExtractionSample.objects.create(
                    batch=batch, sample=s, patient_name=s.patient_name or "",
                    sample_source=s.sample_source or "", is_qc=False,
                    status="QUEUED", plate_number=1,
                )
        return Response(self.detail_serializer_class(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def pending(self, request):
        """待提取：NIPT* 样本，状态在血浆已分离~提取之间，且尚未进入任何提取批次。"""
        used = NiptExtractionSample.objects.values_list("sample_id", flat=True)
        qs = (Sample.objects.filter(panel__code__in=NIPT_PANELS,
                                    status__in=["PLASMA_SEPARATED", "EXTRACTION"])
              .exclude(id__in=list(used)).exclude(status="REJECTED")
              .order_by("receipt_date", "sample_id"))
        return Response({"count": qs.count(), "results": [
            {"id": str(s.id), "sample_id": s.sample_id, "patient_name": s.patient_name or "",
             "sample_source": s.sample_source or "", "status": s.status,
             "plasma_remaining": s.plasma_remaining, "receipt_date": s.receipt_date}
            for s in qs[:500]
        ]})

    @action(detail=True, methods=["post"], url_path="save_extraction")
    def save_extraction(self, request, pk=None):
        return self._save_data(request, pk, "extraction_data")


class NiptLibraryViewSet(_StepBatchViewSet):
    """建库批次（可汇多个提取批次的样本）。"""

    queryset = NiptLibraryBatch.objects.all()
    list_serializer_class = NiptLibraryBatchListSerializer
    detail_serializer_class = NiptLibraryBatchDetailSerializer
    PHOTO_MODULE = "library"
    COMPLETE_STATUS = "LIBRARY_PREP"

    def create(self, request, *args, **kwargs):
        ser = CreateLibraryBatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        sample_ids = list(dict.fromkeys(ser.validated_data["sample_ids"]))
        want_upstream = ser.validated_data.get("source_extraction_sample_ids") or []

        samples = list(Sample.objects.filter(id__in=sample_ids, panel__code__in=NIPT_PANELS))
        if len(samples) != len(sample_ids):
            return Response({"detail": "部分样本不存在或不属于 NIPT panel"},
                            status=status.HTTP_400_BAD_REQUEST)

        # 上游指针：显式给就用给的；否则取该样本最近一条 QC 通过的提取行（M:N 自动拼接）
        upstream_map = {}
        if want_upstream:
            for row in NiptExtractionSample.objects.filter(id__in=want_upstream):
                upstream_map[row.sample_id] = row.id
        for s in samples:
            if s.id in upstream_map:
                continue
            row = (NiptExtractionSample.objects.filter(sample=s, qc_status="PASS")
                   .order_by("-created_at").first())
            if row is None:
                row = NiptExtractionSample.objects.filter(sample=s).order_by("-created_at").first()
            upstream_map[s.id] = row.id if row else None

        with transaction.atomic():
            batch = NiptLibraryBatch.objects.create(
                batch_number=NiptLibraryBatch.generate_batch_number(),
                status="DRAFT", created_by=request.user if request.user.is_authenticated else None,
            )
            for s in samples:
                NiptLibrarySample.objects.create(
                    batch=batch, sample=s, patient_name=s.patient_name or "",
                    sample_source=s.sample_source or "", is_qc=False,
                    status="QUEUED", plate_number=1,
                    source_extraction_sample_id=upstream_map.get(s.id),
                )
        return Response(self.detail_serializer_class(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def pending(self, request):
        """待建库：提取批次里 QC 通过、且尚未进入任何建库批次的提取行。"""
        used = NiptLibrarySample.objects.values_list("source_extraction_sample_id", flat=True)
        qs = (NiptExtractionSample.objects
              .filter(qc_status="PASS").exclude(status="FAILED_QC")
              .exclude(id__in=[u for u in used if u])
              .select_related("batch", "sample")
              .order_by("batch__batch_number", "created_at"))
        return Response({"count": qs.count(), "results": [
            {"extraction_sample_id": str(r.id), "sample_id": str(r.sample_id),
             "sample_code": r.sample.sample_id, "patient_name": r.patient_name,
             "source_batch": r.batch.batch_number, "well_position": r.well_position,
             "dna_concentration": (r.result_summary or {}).get("dna_concentration"),
             "qc_status": r.qc_status}
            for r in qs[:500]
        ]})

    @action(detail=True, methods=["post"], url_path="save_library")
    def save_library(self, request, pk=None):
        return self._save_data(request, pk, "library_data")
