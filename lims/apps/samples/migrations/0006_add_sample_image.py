# Generated migration for adding image field to Sample

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("samples", "0005_rename_barcode_sample_sample_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="sample",
            name="image",
            field=models.ImageField(blank=True, null=True, upload_to="samples/"),
        ),
    ]

