from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ('organizations', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='site',
            name='allowed_panels',
            field=models.JSONField(default=list, blank=True, help_text='Panel codes this site can access. Empty list = all panels accessible.'),
        ),
    ]
