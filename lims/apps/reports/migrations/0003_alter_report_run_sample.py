# Generated manually — change run_sample FK from PROTECT to SET_NULL
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("reports", "0002_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="report",
            name="run_sample",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to="workflows.runsample",
            ),
        ),
    ]
