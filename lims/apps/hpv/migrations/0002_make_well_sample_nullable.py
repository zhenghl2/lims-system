# Generated manually
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("hpv", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE hpv_well_positions ALTER COLUMN sample_id DROP NOT NULL;",
            reverse_sql="ALTER TABLE hpv_well_positions ALTER COLUMN sample_id SET NOT NULL;",
        ),
    ]
