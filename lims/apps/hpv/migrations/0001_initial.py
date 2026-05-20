from django.db import migrations

class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("samples", "__first__"),
        ("organizations", "__first__"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                "CREATE TABLE hpv_batches ("
                "  id UUID PRIMARY KEY,"
                "  batch_number VARCHAR(30) UNIQUE NOT NULL,"
                "  status VARCHAR(20) DEFAULT 'PLANNED' NOT NULL,"
                "  extraction_data JSONB DEFAULT '{}' NOT NULL,"
                "  pcr_data JSONB DEFAULT '{}' NOT NULL,"
                "  hybridization_data JSONB DEFAULT '{}' NOT NULL,"
                "  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
                "  panel_id UUID NOT NULL REFERENCES test_panels(id) ON DELETE CASCADE,"
                "  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE"
                ")",
                "CREATE INDEX hpv_batches_batch_number_idx ON hpv_batches(batch_number)",
                "CREATE INDEX hpv_batches_status_idx ON hpv_batches(status)",
                "CREATE INDEX hpv_batches_created_by_idx ON hpv_batches(created_by_id)",
                "CREATE INDEX hpv_batches_panel_idx ON hpv_batches(panel_id)",

                "CREATE TABLE hpv_well_positions ("
                "  id UUID PRIMARY KEY,"
                "  well_label VARCHAR(6) NOT NULL,"
                "  barcode VARCHAR(100) DEFAULT '' NOT NULL,"
                "  internal_number VARCHAR(20) DEFAULT '' NOT NULL,"
                "  membrane_strip_number SMALLINT NULL,"
                "  batch_id UUID NOT NULL REFERENCES hpv_batches(id) ON DELETE CASCADE,"
                "  sample_id UUID NOT NULL REFERENCES samples(id) ON DELETE CASCADE,"
                "  CONSTRAINT unique_batch_well UNIQUE(batch_id, well_label)"
                ")",
                "CREATE INDEX hpv_well_positions_batch_idx ON hpv_well_positions(batch_id)",

                "CREATE TABLE hpv_results ("
                "  id UUID PRIMARY KEY,"
                "  kit_type VARCHAR(10) NOT NULL,"
                "  genotype_results JSONB DEFAULT '{}' NOT NULL,"
                "  ic_result VARCHAR(1) DEFAULT '' NOT NULL,"
                "  biotin_result VARCHAR(1) DEFAULT '' NOT NULL,"
                "  auto_interpretation VARCHAR(30) DEFAULT '' NOT NULL,"
                "  review_status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL,"
                "  modification_log JSONB DEFAULT '[]' NOT NULL,"
                "  rejection_reason TEXT DEFAULT '' NOT NULL,"
                "  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  batch_id UUID NOT NULL REFERENCES hpv_batches(id) ON DELETE CASCADE,"
                "  reviewer_1_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,"
                "  reviewer_2_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,"
                "  sample_id UUID NOT NULL REFERENCES samples(id) ON DELETE CASCADE,"
                "  well_position_id UUID NULL REFERENCES hpv_well_positions(id) ON DELETE SET NULL,"
                "  CONSTRAINT unique_batch_sample UNIQUE(batch_id, sample_id)"
                ")",
                "CREATE INDEX hpv_results_batch_idx ON hpv_results(batch_id)",
                "CREATE INDEX hpv_results_sample_idx ON hpv_results(sample_id)",
                "CREATE INDEX hpv_results_review_status_idx ON hpv_results(review_status)",

                "CREATE TABLE hpv_membrane_photos ("
                "  id UUID PRIMARY KEY,"
                "  image VARCHAR(100) NOT NULL,"
                "  well_position VARCHAR(10) DEFAULT '' NOT NULL,"
                "  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  notes TEXT DEFAULT '' NOT NULL,"
                "  batch_id UUID NOT NULL REFERENCES hpv_batches(id) ON DELETE CASCADE,"
                "  sample_id UUID NOT NULL REFERENCES samples(id) ON DELETE CASCADE,"
                "  uploaded_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE"
                ")",
                "CREATE INDEX hpv_membrane_photos_batch_idx ON hpv_membrane_photos(batch_id)",

                "CREATE TABLE hpv_retest_records ("
                "  id UUID PRIMARY KEY,"
                "  retest_date DATE NOT NULL,"
                "  retest_reason VARCHAR(50) NOT NULL,"
                "  original_result JSONB DEFAULT '{}' NOT NULL,"
                "  original_interpretation VARCHAR(30) DEFAULT '' NOT NULL,"
                "  retest_result JSONB DEFAULT '{}' NOT NULL,"
                "  retest_interpretation VARCHAR(30) DEFAULT '' NOT NULL,"
                "  final_hpv_genotype VARCHAR(100) DEFAULT '' NOT NULL,"
                "  report_opinion VARCHAR(30) DEFAULT '' NOT NULL,"
                "  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,"
                "  new_batch_id UUID NULL REFERENCES hpv_batches(id) ON DELETE SET NULL,"
                "  operator_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,"
                "  original_batch_id UUID NOT NULL REFERENCES hpv_batches(id) ON DELETE CASCADE,"
                "  original_sample_id UUID NOT NULL REFERENCES samples(id) ON DELETE CASCADE,"
                "  reviewer_id UUID NULL REFERENCES users(id) ON DELETE SET NULL"
                ")",
                "CREATE INDEX hpv_retest_records_obatch_idx ON hpv_retest_records(original_batch_id)",
            ],
            reverse_sql=[
                "DROP TABLE IF EXISTS hpv_retest_records",
                "DROP TABLE IF EXISTS hpv_membrane_photos",
                "DROP TABLE IF EXISTS hpv_results",
                "DROP TABLE IF EXISTS hpv_well_positions",
                "DROP TABLE IF EXISTS hpv_batches",
            ],
            # state_operations omitted for simplicity;
            # Django will defer to models.py for ORM operations
            # using the --fake-initial approach
        ),
    ]
