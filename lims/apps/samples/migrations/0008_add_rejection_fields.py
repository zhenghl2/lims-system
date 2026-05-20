# Add rejection_reason and rejection_note to Sample (RunSQL)
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("samples", "0007_extend_sample_status"),
    ]
    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE samples ADD COLUMN IF NOT EXISTS rejection_reason varchar(100) NOT NULL DEFAULT '';
                ALTER TABLE samples ADD COLUMN IF NOT EXISTS rejection_note text NOT NULL DEFAULT '';
            """,
            reverse_sql="""
                ALTER TABLE samples DROP COLUMN IF EXISTS rejection_reason;
                ALTER TABLE samples DROP COLUMN IF EXISTS rejection_note;
            """,
        ),
    ]
