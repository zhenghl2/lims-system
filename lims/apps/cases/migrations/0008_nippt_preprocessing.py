# Generated manually — tables created via raw SQL

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('cases', '0007_multi_sample_types'),
    ]

    operations = [
        migrations.RunSQL(
            sql="SELECT 1",  # Tables already created
            reverse_sql="DROP TABLE IF EXISTS nippt_preprocessing_samples; DROP TABLE IF EXISTS nippt_preprocessing_batches;",
        ),
    ]
