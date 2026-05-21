# Generated manually
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("hpv", "0003_make_membrane_photo_sample_nullable"),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE hpv_results ADD COLUMN IF NOT EXISTS qc_status varchar(20) NOT NULL DEFAULT 'IN_CONTROL';",
            reverse_sql="ALTER TABLE hpv_results DROP COLUMN IF EXISTS qc_status;",
        ),
    ]
