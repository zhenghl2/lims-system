# Extend sample status choices: add REGISTERED, TESTING, ANALYZING; remove ACCEPTED
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("samples", "0006_add_sample_image"),
    ]
    operations = [
        migrations.AlterField(
            model_name="sample",
            name="status",
            field=models.CharField(
                choices=[
                    ("REGISTERED", "Registered"),
                    ("RECEIVED", "Received"),
                    ("REJECTED", "Rejected"),
                    ("IN_PROCESS", "In Process"),
                    ("TESTING", "Testing"),
                    ("ANALYZING", "Analyzing"),
                    ("COMPLETED", "Completed"),
                    ("REPORTED", "Reported"),
                    ("ARCHIVED", "Archived"),
                    ("DISPOSED", "Disposed"),
                ],
                db_index=True,
                default="REGISTERED",
                max_length=20,
            ),
        ),
    ]
