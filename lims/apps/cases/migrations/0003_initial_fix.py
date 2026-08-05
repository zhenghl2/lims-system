# Generated and applied, file was lost — reconstructed

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('cases', '0002_add_dual_id_system'),
    ]

    operations = [
        migrations.AddField(
            model_name='casesample',
            name='workflow_stage',
            field=models.CharField(db_index=True, default='REGISTERED', max_length=30),
        ),
        migrations.AddField(
            model_name='casesample',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='casesample',
            name='priority',
            field=models.IntegerField(default=0),
        ),
    ]
