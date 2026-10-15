from django.db import migrations, models


def move_pdf_to_slot(apps, schema_editor):
    """2026-10-13：把 report_file 里的 PDF 搬到新槽位 report_file_pdf（只搬字段值，不动物理文件）"""
    Pair = apps.get_model("cases", "NipptBioinfoPair")
    moved = 0
    for p in Pair.objects.all():
        name = (getattr(p.report_file, "name", "") or "") if p.report_file else ""
        if str(name).lower().endswith(".pdf"):
            p.report_file_pdf = name
            p.report_file = ""
            p.save(update_fields=["report_file", "report_file_pdf"])
            moved += 1
    if moved:
        print("  [0036] moved %d pdf -> report_file_pdf" % moved)


def move_pdf_back(apps, schema_editor):
    Pair = apps.get_model("cases", "NipptBioinfoPair")
    for p in Pair.objects.all():
        name = (getattr(p.report_file_pdf, "name", "") or "") if p.report_file_pdf else ""
        cur = (getattr(p.report_file, "name", "") or "") if p.report_file else ""
        if name and not cur:
            p.report_file = name
            p.report_file_pdf = ""
            p.save(update_fields=["report_file", "report_file_pdf"])


class Migration(migrations.Migration):

    dependencies = [
        ("cases", "0035_nipptbioinfopair_appendix_file"),
    ]

    operations = [
        migrations.AddField(
            model_name="nipptbioinfopair",
            name="report_file_pdf",
            field=models.FileField(blank=True, null=True, upload_to="nippt_reports/%Y%m/"),
        ),
        migrations.AddField(
            model_name="nipptbioinfopair",
            name="report_pdf_stale",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(move_pdf_to_slot, move_pdf_back),
    ]
