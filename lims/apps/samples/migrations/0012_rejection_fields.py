# Migration 0012: add rejection_handling and rejection_communication to Sample
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("samples", "0011_sample_photo"),
    ]

    operations = [
        migrations.AddField(
            model_name="sample",
            name="rejection_handling",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="sample",
            name="rejection_communication",
            field=models.TextField(blank=True),
        ),
    ]
