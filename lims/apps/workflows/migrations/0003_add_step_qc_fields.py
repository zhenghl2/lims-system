# Generated migration for WorkflowStep QC fields
from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("workflows", "0002_runsample_barcode_samplerun_barcode"),
    ]

    operations = [
        migrations.AddField(
            model_name="workflowstep",
            name="step_data",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="workflowstep",
            name="qc_status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending QC"),
                    ("PASS", "Passed QC"),
                    ("FAIL", "Failed QC"),
                    ("NA", "Not Applicable"),
                ],
                default="PENDING",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="workflowstep",
            name="qc_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="qc_steps",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="workflowstep",
            name="qc_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
