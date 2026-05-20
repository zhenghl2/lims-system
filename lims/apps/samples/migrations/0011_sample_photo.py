# Migration 0011: add SamplePhoto model
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("samples", "0010_add_hpv_sample_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="SamplePhoto",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image", models.ImageField(upload_to="sample_photos/%Y/%m/")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("notes", models.CharField(blank=True, max_length=500)),
                ("uploaded_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddField(
            model_name="sample",
            name="receiving_photos",
            field=models.ManyToManyField(blank=True, related_name="samples", to="samples.samplephoto"),
        ),
    ]
