from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [("hpv", "0006_add_result_data_to_batch")]
    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE hpv_retest_records ALTER COLUMN original_batch_id DROP NOT NULL;",
            reverse_sql="ALTER TABLE hpv_retest_records ALTER COLUMN original_batch_id SET NOT NULL;",
        ),
    ]
