"""把 NIPT 测序批次 index 表里的 Report Code 回写到样本。

用于：本次改动之前保存过的测序批次（当时只存 sequencing_data.index_samples，
Sample.report_code 一直为空 → 报告页「Report Code」列空白）。
幂等：值相同不重复写。

用法：
  python manage.py sync_nipt_report_codes
  python manage.py sync_nipt_report_codes --batch chip7049
  python manage.py sync_nipt_report_codes --dry-run
"""
from django.core.management.base import BaseCommand

from lims.apps.nipt_workflow.models import NiptSequencingBatch
from lims.apps.nipt_workflow.views import _sync_index_report_codes
from lims.apps.samples.models import Sample


class Command(BaseCommand):
    help = "把测序批次 index 表的 Report Code 回写到样本"

    def add_arguments(self, parser):
        parser.add_argument("--batch", default="", help="只处理指定批次号")
        parser.add_argument("--dry-run", action="store_true", help="只统计不改数据")

    def handle(self, *args, **opts):
        qs = NiptSequencingBatch.objects.all().order_by("-created_at")
        if opts["batch"]:
            qs = qs.filter(batch_number=opts["batch"])

        total = 0
        for b in qs:
            idx = (b.sequencing_data or {}).get("index_samples") or []
            if not idx:
                continue
            if opts["dry_run"]:
                self.stdout.write("[dry-run] %s：index 表 %d 条" % (b.batch_number, len(idx)))
                continue
            n = _sync_index_report_codes(b)
            total += n
            self.stdout.write("%s：更新 %d 个样本的 Report Code" % (b.batch_number, n))

        if not opts["dry_run"]:
            missing = Sample.objects.filter(panel__code__startswith="NIPT", report_code="").count()
            self.stdout.write(self.style.SUCCESS(
                "完成，共更新 %d 条；仍未填 Report Code 的 NIPT 样本 %d 个" % (total, missing)))
