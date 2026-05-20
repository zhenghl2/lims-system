# Generated migration: add age, source_institution, institution_sample_id to samples
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("samples", "0008_add_rejection_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="sample",
            name="age",
            field=models.PositiveSmallIntegerField(blank=True, help_text="Age in years", null=True),
        ),
        migrations.AddField(
            model_name="sample",
            name="source_institution",
            field=models.CharField(blank=True, help_text="Source institution", max_length=200),
        ),
        migrations.AddField(
            model_name="sample",
            name="institution_sample_id",
            field=models.CharField(blank=True, help_text="Institution sample ID", max_length=100),
        ),
        migrations.AlterField(
            model_name="sample",
            name="patient_sex",
            field=models.CharField(blank=True, choices=[("M", "Male"), ("F", "Female")], max_length=1),
        ),
    ]
