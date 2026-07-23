# Generated manually
from django.db import migrations, models
class Migration(migrations.Migration):
    dependencies = [("cases", "0010_extraction_fields")]
    operations = [migrations.AddField(model_name="nipptextractionsample", name="experiment_sample_type", field=models.CharField(blank=True, default="", max_length=20, help_text="来源前处理的实验样本类型"))]
