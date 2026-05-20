# Generated migration for Receiver model
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0002_add_allowed_panels"),
    ]

    operations = [
        migrations.CreateModel(
            name="Receiver",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(db_index=True, max_length=100, unique=True)),
                ("password", models.CharField(max_length=128)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "receivers",
                "ordering": ["name"],
            },
        ),
    ]
