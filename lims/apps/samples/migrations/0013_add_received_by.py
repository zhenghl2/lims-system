# Generated migration for Sample.received_by FK
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("samples", "0012_rejection_fields"),
        ("organizations", "0003_receiver"),
    ]

    operations = [
        migrations.AddField(
            model_name="sample",
            name="received_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="received_samples",
                to="organizations.receiver",
            ),
        ),
    ]
