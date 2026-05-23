from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [("hpv", "0007_retest_original_batch_nullable")]
    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE hpv_batches ADD COLUMN IF NOT EXISTS result_data jsonb NOT NULL DEFAULT '{}';",
            reverse_sql="ALTER TABLE hpv_batches DROP COLUMN IF EXISTS result_data;",
        ),
    ]
