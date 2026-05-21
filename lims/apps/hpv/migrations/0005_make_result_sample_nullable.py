# Generated manually
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("hpv", "0004_add_qc_status_to_hpvresult"),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE hpv_results ALTER COLUMN sample_id DROP NOT NULL;",
            reverse_sql="ALTER TABLE hpv_results ALTER COLUMN sample_id SET NOT NULL;",
        ),
    ]
