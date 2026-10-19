"""把现有 `SampleRun`（整流程批次）迁移成提取 / 建库分步批次（阶段2）。

用法：
    python manage.py import_nipt_runs --dry-run     # 只看会建什么，不写库
    python manage.py import_nipt_runs               # 真写

规则（对应方案 §15「迁移」）：
- **动态遍历全部 run**（不硬编码条数）
- 只迁移 `extraction_data` / `library_data` **非空**的 run
- 建库行用 `source_extraction_sample_id` 指向同一 run 同一样本的提取行（上下游可追溯）
- 批次号带 run 尾号（`NIPT-EXT-20261016-M0001`）→ **幂等**，重复跑不产生重复批次
- 迁移后 `SampleRun/RunSample` 原样保留（兼容镜像，不删不退役）

实现分两段：先**纯计算**出计划（dry-run 与真跑共用同一份计划），再决定是否落库。
避免「dry 模式下批次不存在 → 每个样本都重新计数」这类数字虚高。
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from lims.apps.workflows.models import SampleRun

from ...models import (NiptExtractionBatch, NiptExtractionSample,
                       NiptLibraryBatch, NiptLibrarySample)

_AFTER_EXTRACTION = ("LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING",
                     "QC_REVIEW", "COMPLETED")
_AFTER_LIBRARY = ("LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED")


class Command(BaseCommand):
    help = "SampleRun → NIPT 提取/建库分步批次（支持 --dry-run，可重复执行）"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        runs = SampleRun.objects.all().order_by("created_at")

        # ── 第一段：纯计算计划 ──
        plans = []
        for run in runs:
            ext_data = run.extraction_data or {}
            lib_data = run.library_data or {}
            rss = list(run.run_samples.select_related("sample").order_by("created_at"))
            day = timezone.localtime(run.created_at).strftime("%Y%m%d")
            tail = str(run.run_number).replace("RUN-", "").split("-")[-1]

            plan = {"run": run, "day": day, "tail": tail,
                    "ext_number": None, "ext_status": None, "ext_exists": False,
                    "lib_number": None, "lib_status": None, "lib_exists": False,
                    "samples": [], "dup": 0}

            if ext_data:
                plan["ext_number"] = "NIPT-EXT-%s-M%s" % (day, tail)
                plan["ext_status"] = "COMPLETED" if run.status in _AFTER_EXTRACTION else "IN_PROGRESS"
                plan["ext_exists"] = NiptExtractionBatch.objects.filter(
                    batch_number=plan["ext_number"]).exists()

            if lib_data:
                plan["lib_number"] = "NIPT-LIB-%s-M%s" % (day, tail)
                plan["lib_status"] = "COMPLETED" if run.status in _AFTER_LIBRARY else "IN_PROGRESS"
                plan["lib_exists"] = NiptLibraryBatch.objects.filter(
                    batch_number=plan["lib_number"]).exists()

            seen = set()
            for rs in rss:
                if rs.sample_id in seen:
                    plan["dup"] += 1
                    continue
                seen.add(rs.sample_id)
                plan["samples"].append(rs)
            plans.append(plan)

        # ── 第二段：打印 + 落库 ──
        tot = {"ext_new": 0, "ext_rows": 0, "lib_new": 0, "lib_rows": 0,
               "ext_reuse": 0, "lib_reuse": 0, "dup": 0}
        for p in plans:
            run = p["run"]
            n = len(p["samples"])
            tot["dup"] += p["dup"]
            if p["ext_number"]:
                if p["ext_exists"]:
                    tot["ext_reuse"] += 1
                else:
                    tot["ext_new"] += 1
                self.stdout.write("  %s %-24s %2d 样本  %-11s  源 run %s%s" % (
                    "=" if p["ext_exists"] else "+", p["ext_number"], n,
                    p["ext_status"], run.run_number, "  (复用)" if p["ext_exists"] else ""))
            if p["lib_number"]:
                if p["lib_exists"]:
                    tot["lib_reuse"] += 1
                else:
                    tot["lib_new"] += 1
                self.stdout.write("  %s %-24s %2d 样本  %-11s" % (
                    "=" if p["lib_exists"] else "+", p["lib_number"], n,
                    p["lib_status"]))
            if not p["ext_number"] and not p["lib_number"]:
                self.stdout.write("    %-24s 无提取/建库数据，跳过" % run.run_number)

        self.stdout.write("")
        self.stdout.write("计划: %s" % tot)
        if dry:
            self.stdout.write(self.style.WARNING("DRY-RUN：未写库"))
            return

        for p in plans:
            run = p["run"]
            after_ext = run.status in _AFTER_EXTRACTION
            ext_batch = None
            if p["ext_number"]:
                if p["ext_exists"]:
                    ext_batch = NiptExtractionBatch.objects.get(batch_number=p["ext_number"])
                    _fill = {}
                    if not ext_batch.extraction_method and getattr(run, "extraction_method", ""):
                        _fill["extraction_method"] = run.extraction_method
                    if not ext_batch.region and getattr(run, "region", ""):
                        _fill["region"] = run.region
                    if _fill:
                        for k, v in _fill.items():
                            setattr(ext_batch, k, v)
                        ext_batch.save(update_fields=list(_fill.keys()) + ["updated_at"])
                        self.stdout.write("      回填 %s ← %s" % (p["ext_number"], _fill))
                else:
                    with transaction.atomic():
                        ext_batch = NiptExtractionBatch.objects.create(
                            batch_number=p["ext_number"], status=p["ext_status"],
                            extraction_data=dict(run.extraction_data or {}),
                            extraction_method=getattr(run, "extraction_method", "") or "",
                            region=getattr(run, "region", "") or "")
            for rs in p["samples"]:
                ext_row = None
                if ext_batch is not None:
                    ext_row, _ = NiptExtractionSample.objects.get_or_create(
                        batch=ext_batch, sample_id=rs.sample_id,
                        defaults=dict(
                            patient_name=rs.sample.patient_name or "",
                            sample_source=rs.sample.sample_source or "",
                            is_qc=rs.is_qc,
                            well_position=rs.well_position or "",
                            plate_number=rs.plate_number or 1,
                            index_sequence=rs.index_sequence or "",
                            index_combo_id=rs.index_combo_id or "",
                            status=("PASSED_QC" if after_ext else "QUEUED"),
                            qc_status=("PASS" if after_ext else ""),
                        ))
                    tot["ext_rows"] += 1

            if p["lib_number"]:
                lib_batch = None
                if p["lib_exists"]:
                    lib_batch = NiptLibraryBatch.objects.get(batch_number=p["lib_number"])
                    _fill = {}
                    if not lib_batch.library_method and getattr(run, "library_method", ""):
                        _fill["library_method"] = run.library_method
                    if not lib_batch.region and getattr(run, "region", ""):
                        _fill["region"] = run.region
                    if _fill:
                        for k, v in _fill.items():
                            setattr(lib_batch, k, v)
                        lib_batch.save(update_fields=list(_fill.keys()) + ["updated_at"])
                        self.stdout.write("      回填 %s ← %s" % (p["lib_number"], _fill))
                else:
                    with transaction.atomic():
                        lib_batch = NiptLibraryBatch.objects.create(
                            batch_number=p["lib_number"], status=p["lib_status"],
                            library_data=dict(run.library_data or {}),
                            library_method=getattr(run, "library_method", "") or "",
                            region=getattr(run, "region", "") or "")
                for rs in p["samples"]:
                    up = NiptExtractionSample.objects.filter(
                        batch=ext_batch, sample_id=rs.sample_id).first() if ext_batch else None
                    NiptLibrarySample.objects.get_or_create(
                        batch=lib_batch, sample_id=rs.sample_id,
                        defaults=dict(
                            patient_name=rs.sample.patient_name or "",
                            sample_source=rs.sample.sample_source or "",
                            is_qc=rs.is_qc,
                            well_position=rs.well_position or "",
                            plate_number=rs.plate_number or 1,
                            index_sequence=rs.index_sequence or "",
                            index_combo_id=rs.index_combo_id or "",
                            status="QUEUED",
                            source_extraction_sample_id=up.id if up else None,
                        ))
                    tot["lib_rows"] += 1

        self.stdout.write(self.style.SUCCESS(
            "完成: 提取 %d 批次 / %d 行, 建库 %d 批次 / %d 行" % (
                NiptExtractionBatch.objects.count(), NiptExtractionSample.objects.count(),
                NiptLibraryBatch.objects.count(), NiptLibrarySample.objects.count())))
