# Migration 0010: add hpv_sample_type and test_item to Sample
# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("samples", "0009_add_hpv_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="sample",
            name="hpv_sample_type",
            field=models.CharField(
                blank=True,
                choices=[("CERVICAL_CELLS", "Cervical Exfoliated Cells"), ("CERVICAL_SWAB", "Cervical Swab")],
                help_text="HPV sample type: cervical exfoliated cells or cervical swab",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="sample",
            name="test_item",
            field=models.CharField(
                blank=True,
                choices=[("HPV_15", "HPV 15-Type"), ("HPV_23", "HPV 23-Type")],
                help_text="HPV test item: 15-type or 23-type panel",
                max_length=20,
            ),
        ),
    ]
