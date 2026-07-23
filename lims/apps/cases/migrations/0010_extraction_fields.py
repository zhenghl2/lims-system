# Generated manually: add extraction fields
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ('cases', '0009_phase1_modules'),
    ]

    operations = [
        migrations.AddField(
            model_name='nipptextractionsample',
            name='aliquot_tubes',
            field=models.PositiveSmallIntegerField(default=0, help_text='当前剩余管数'),
        ),
        migrations.AddField(
            model_name='nipptextractionsample',
            name='is_qc',
            field=models.BooleanField(default=False, help_text='是否质控样本'),
        ),
        migrations.AlterField(
            model_name='nipptextractionsample',
            name='elution_volume',
            field=models.FloatField(blank=True, default=30, null=True),
        ),
    ]
