"""回填 NIPT 生信批次的报告草稿。

用于：本次改动之前就已经「完成」的生信批次（当时不会自动建报告）。
幂等：已存在报告的样本会跳过；QC 质控 / 生信失败样本不出报告。

用法：
  python manage.py backfill_nipt_reports              # 所有已完成的生信批次
  python manage.py backfill_nipt_reports --batch NIPT-BIO-20261110-002
  python manage.py backfill_nipt_reports --dry-run
"""
from django.core.management.base import BaseCommand

from lims.apps.nipt_workflow.models import NiptBioinformaticsBatch
from lims.apps.nipt_workflow.views import _create_reports_for_bioinformatics
from lims.apps.reports.models import Report


class Command(BaseCommand):
    help = "为已完成的 NIPT 生信批次补建报告草稿（DRAFT）"

    def add_arguments(self, parser):
        parser.add_argument("--batch", default="", help="只处理指定批次号")
        parser.add_argument("--dry-run", action="store_true", help="只统计不改数据")

    def handle(self, *args, **opts):
        qs = NiptBioinformaticsBatch.objects.filter(status="COMPLETED").order_by("-created_at")
        if opts["batch"]:
            qs = qs.filter(batch_number=opts["batch"])
        if not qs.exists():
            self.stdout.write("没有符合条件的已完成生信批次")
            return

        from django.contrib.auth import get_user_model
        user = get_user_model().objects.filter(is_superuser=True).first()
        total = 0
        for batch in qs:
            if opts["dry_run"]:
                self.stdout.write("[dry-run] %s（样本 %d）" % (batch.batch_number, batch.samples.count()))
                continue
            created, skipped, eligible = _create_reports_for_bioinformatics(batch, user)
            total += created
            self.stdout.write("%s：新建 %d 份报告" % (batch.batch_number, created))
            for sid, why in skipped:
                self.stdout.write("    跳过 %s —— %s" % (sid, why))

        if not opts["dry_run"]:
            self.stdout.write(self.style.SUCCESS(
                "完成，共新建 %d 份报告；Report 总数 %d" % (total, Report.objects.count())))
