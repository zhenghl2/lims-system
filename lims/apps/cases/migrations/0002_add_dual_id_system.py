# Add dual-ID system fields to Case and CaseSample (RunSQL)
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("cases", "0001_initial"),
    ]
    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE cases ADD COLUMN IF NOT EXISTS pt_number varchar(20) NULL UNIQUE;
                CREATE INDEX IF NOT EXISTS cases_pt_number_idx ON cases (pt_number);
            """,
            reverse_sql="ALTER TABLE cases DROP COLUMN IF EXISTS pt_number;",
        ),
        migrations.RunSQL(
            sql="""
                ALTER TABLE case_samples ADD COLUMN IF NOT EXISTS test_sample_id varchar(40) NULL UNIQUE;
                CREATE INDEX IF NOT EXISTS case_samples_test_sample_id_idx ON case_samples (test_sample_id);
            """,
            reverse_sql="ALTER TABLE case_samples DROP COLUMN IF EXISTS test_sample_id;",
        ),
        migrations.RunSQL(
            sql="""
                ALTER TABLE case_samples ADD COLUMN IF NOT EXISTS resample_of_id uuid NULL;
                ALTER TABLE case_samples ADD CONSTRAINT fk_casesample_resample_of
                    FOREIGN KEY (resample_of_id) REFERENCES case_samples(id)
                    ON DELETE SET NULL;
            """,
            reverse_sql="""
                ALTER TABLE case_samples DROP CONSTRAINT IF EXISTS fk_casesample_resample_of;
                ALTER TABLE case_samples DROP COLUMN IF EXISTS resample_of_id;
            """,
        ),
        migrations.RunSQL(
            sql="""
                ALTER TABLE case_samples ADD COLUMN IF NOT EXISTS resample_number smallint NULL;
            """,
            reverse_sql="ALTER TABLE case_samples DROP COLUMN IF EXISTS resample_number;",
        ),
    ]
