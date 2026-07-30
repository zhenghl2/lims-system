import os,django;os.environ.setdefault('DJANGO_SETTINGS_MODULE','lims.config.settings.base');import django;django.setup()
from lims.apps.cases.models import NipptHybSeqBatch
for b in NipptHybSeqBatch.objects.all():
    d = b.hyb_seq_data or {}
    print(b.batch_number, 'mix_sources:', d.get('mix_sources','N/A'), 'chip:', d.get('chip_number','N/A'))
