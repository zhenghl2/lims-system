# Generated migration for is_qc field
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ('workflows', '0006_add_bioinformatics_data'),
    ]
    operations = [
        migrations.AddField(
            model_name='runsample',
            name='is_qc',
            field=models.BooleanField(db_index=True, default=False, help_text='是否为质控品重做'),
        ),
    ]
