"""把现有 `SampleRun`（整流程批次）迁移成 5 个分步批次（阶段 2 + 阶段 3）。

用法：
    python manage.py import_nipt_runs --dry-run     # 只看会建什么，不写库
    python manage.py import_nipt_runs               # 真写（幂等，可重复执行）

规则（对应方案 §15「迁移」）：
- **动态遍历全部 run**（不硬编码条数）
- 每一步只迁移该步 JSON **非空**的 run
- 下游行用指针记录上游行 id（提取→建库→Pooling→测序→生信），报告挂谱系也靠这条链
- 批次号带 run 尾号（`NIPT-EXT-20261016-M0001`）→ **幂等**，重复跑不产生重复批次
- 已存在的批次只**补空值 Meta**（run 级字段如 extraction_method/region），不覆盖人工改过的值
- 迁移后 `SampleRun/RunSample` 原样保留（兼容镜像，不删不退役）

实现分两段：先**纯计算**出计划（dry-run 与真跑共用同一份计划），再决定是否落库。
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from lims.apps.workflows.models import SampleRun

from ...models import (NiptBioinformaticsBatch, NiptBioinformaticsSample,
                       NiptExtractionBatch, NiptExtractionSample,
                       NiptLibraryBatch, NiptLibrarySample,
                       NiptPoolingBatch, NiptPoolingSample,
                       NiptSequencingBatch, NiptSequencingSample)

_AFTER = {
    "extraction": ("LIBRARY_PREP", "LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"),
    "library": ("LIBRARY_POOLING", "SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"),
    "pooling": ("SEQUENCING", "ANALYZING", "QC_REVIEW", "COMPLETED"),
    "sequencing": ("ANALYZING", "QC_REVIEW", "COMPLETED"),
    "bioinformatics": ("QC_REVIEW", "COMPLETED"),
}

#: 链式定义：step → (data 字段, 批次模型, 样本模型, 批次号前缀, 指向上游的字段, 上游样本模型)
CHAIN = [
    ("extraction", "extraction_data", NiptExtractionBatch, NiptExtractionSample,
     "NIPT-EXT", None, None),
    ("library", "library_data", NiptLibraryBatch, NiptLibrarySample,
     "NIPT-LIB", "source_extraction_sample_id", NiptExtractionSample),
    ("pooling", "pooling_data", NiptPoolingBatch, NiptPoolingSample,
     "NIPT-POOL", "source_library_sample_id", NiptLibrarySample),
    ("sequencing", "sequencing_data", NiptSequencingBatch, NiptSequencingSample,
     "NIPT-SEQ", "source_pooling_sample_id", NiptPoolingSample),
    ("bioinformatics", "bioinformatics_data", NiptBioinformaticsBatch, NiptBioinformaticsSample,
     "NIPT-BIO", "source_sequencing_sample_id", NiptSequencingSample),
]


DATA_FIELD = {"NIPT-EXT": "extraction_data", "NIPT-LIB": "library_data",
              "NIPT-POOL": "pooling_data", "NIPT-SEQ": "sequencing_data",
              "NIPT-BIO": "bioinformatics_data"}


def _meta(step, run, data):
    """从 run 级字段 / JSON 里取该步的展示用 Meta。"""
    region = getattr(run, "region", "") or ""
    if step == "extraction":
        return {"extraction_method": getattr(run, "extraction_method", "") or "", "region": region}
    if step == "library":
        return {"library_method": getattr(run, "library_method", "") or "", "region": region}
    if step == "pooling":
        return {"pooling_base": (data or {}).get("poolingBase", "") or "", "region": region}
    if step == "sequencing":
        d = data or {}
        return {"platform": d.get("platform", "") or "",
                "instrument": d.get("equipment", "") or "",
                "chip_type": d.get("chip", "") or "", "region": region}
    return {"pipeline": (data or {}).get("pipeline", "") or "", "region": region}


class Command(BaseCommand):
    help = "SampleRun → NIPT 五步分步批次（支持 --dry-run，可重复执行）"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")
        parser.add_argument("--step", default="", help="只迁移某一步（extraction/library/pooling/sequencing/bioinformatics）")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        only = (opts.get("step") or "").strip()
        steps = [c for c in CHAIN if not only or c[0] == only]
        if only and not steps:
            self.stderr.write("未知 step: %s" % only)
            return

        # ── 第一段：纯计算计划 ──
        plans = []
        for run in SampleRun.objects.all().order_by("created_at"):
            day = timezone.localtime(run.created_at).strftime("%Y%m%d")
            tail = str(run.run_number).replace("RUN-", "").split("-")[-1]
            rss = list(run.run_samples.select_related("sample").order_by("created_at"))
            seen, samples = set(), []
            dup = 0
            for rs in rss:
                if rs.sample_id in seen:
                    dup += 1
                    continue
                seen.add(rs.sample_id)
                samples.append(rs)

            items = []
            for (step, dkey, BM, SM, prefix, ptr, _up) in steps:
                data = getattr(run, dkey, None) or {}
                if not data:
                    continue
                num = "%s-%s-M%s" % (prefix, day, tail)
                items.append({
                    "step": step, "number": num, "prefix": prefix, "data": data,
                    "status": "COMPLETED" if run.status in _AFTER[step] else "IN_PROGRESS",
                    "exists": BM.objects.filter(batch_number=num).exists(),
                    "meta": _meta(step, run, data), "BM": BM, "SM": SM, "ptr": ptr,
                })
            plans.append({"run": run, "samples": samples, "dup": dup, "items": items})

        # ── 第二段：打印 ──
        tot = {"new_batches": 0, "new_rows": 0, "reuse_batches": 0, "dup": 0}
        for p in plans:
            run = p["run"]
            tot["dup"] += p["dup"]
            if not p["items"]:
                self.stdout.write("    %-24s 无实验数据，跳过" % run.run_number)
                continue
            for it in p["items"]:
                tot["reuse_batches" if it["exists"] else "new_batches"] += 1
                self.stdout.write("  %s %-28s %2d 样本  %-11s  %s" % (
                    "=" if it["exists"] else "+", it["number"], len(p["samples"]),
                    it["status"], it["step"]))
        self.stdout.write("")
        self.stdout.write("计划: %s" % tot)
        if dry:
            self.stdout.write(self.style.WARNING("DRY-RUN：未写库"))
            return

        # ── 第三段：落库 ──
        for p in plans:
            run = p["run"]
            # 每一步的「sample_id → 本步行 id」映射，供下游指针使用
            row_map = {}
            for it in p["items"]:
                BM, SM, ptr = it["BM"], it["SM"], it["ptr"]
                batch = BM.objects.filter(batch_number=it["number"]).first()
                if batch is None:
                    with transaction.atomic():
                        batch = BM.objects.create(
                            batch_number=it["number"], status=it["status"],
                            **{DATA_FIELD[it["prefix"]]: dict(it["data"])},
                            **it["meta"])
                else:
                    fill = {k: v for k, v in it["meta"].items()
                            if v and not getattr(batch, k, "")}
                    if fill:
                        for k, v in fill.items():
                            setattr(batch, k, v)
                        batch.save(update_fields=list(fill.keys()) + ["updated_at"])
                        self.stdout.write("      回填 %s ← %s" % (it["number"], fill))

                # 生信 JSON 的 key 是「样本行 id」：若历史数据非空，必须按新行 id 重新打 key
                if it["step"] == "bioinformatics":
                    remap_old = {str(rs.id): rs.sample_id for rs in p["samples"]}
                    it["data"] = {str(k): v for k, v in (it["data"] or {}).items()} if it["data"] else {}
                new_map = {}
                for rs in p["samples"]:
                    up_id = row_map.get(rs.sample_id)
                    defaults = dict(
                        patient_name=rs.sample.patient_name or "",
                        sample_source=rs.sample.sample_source or "",
                        is_qc=rs.is_qc,
                        well_position=rs.well_position or "",
                        plate_number=rs.plate_number or 1,
                        index_sequence=rs.index_sequence or "",
                        index_combo_id=rs.index_combo_id or "",
                        status=("PASSED_QC" if it["status"] == "COMPLETED" else "QUEUED"),
                        qc_status=("PASS" if it["status"] == "COMPLETED" else ""),
                    )
                    if ptr:
                        defaults[ptr] = up_id
                    row, _ = SM.objects.get_or_create(batch=batch, sample_id=rs.sample_id,
                                                      defaults=defaults)
                    new_map[rs.sample_id] = row.id
                    tot["new_rows"] += 1
                if it["step"] == "bioinformatics" and it["data"]:
                    # rs.id（RunSample id）→ 新行 id
                    remap = {}
                    for rs in p["samples"]:
                        nr = SM.objects.filter(batch=batch, sample_id=rs.sample_id).first()
                        if nr:
                            remap[str(rs.id)] = str(nr.id)
                    fixed = {remap.get(k, k): v for k, v in it["data"].items()}
                    batch.bioinformatics_data = fixed
                    batch.save(update_fields=["bioinformatics_data", "updated_at"])
                    self.stdout.write("      生信 JSON 已按新行 id 重新打 key（%d 条）" % len(fixed))
                row_map = new_map

        self.stdout.write(self.style.SUCCESS(
            "完成: 提取 %d/%d 行, 建库 %d/%d, Pooling %d/%d, 测序 %d/%d, 生信 %d/%d" % (
                NiptExtractionBatch.objects.count(), NiptExtractionSample.objects.count(),
                NiptLibraryBatch.objects.count(), NiptLibrarySample.objects.count(),
                NiptPoolingBatch.objects.count(), NiptPoolingSample.objects.count(),
                NiptSequencingBatch.objects.count(), NiptSequencingSample.objects.count(),
                NiptBioinformaticsBatch.objects.count(), NiptBioinformaticsSample.objects.count())))
