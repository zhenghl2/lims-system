import django; django.setup()
import os; os.environ.setdefault("DJANGO_SETTINGS_MODULE", "lims.settings")
from lims.apps.cases.models import *
from lims.apps.cases.views import advance_batch

print("Backfilling...")
models = [
    (NipptPreProcessingBatch, "EXTRACTION"),
    (NipptExtractionBatch, "LIBRARY_PREP"),
    (NipptLibraryBatch, "POOLING"),
    (NipptPoolingBatch, "HYB_SEQ"),
    (NipptHybSeqBatch, "REPORT_DRAFT"),
]
for cls, nxt in models:
    for b in cls.objects.filter(status="COMPLETED"):
        advance_batch(b, nxt)
        print(f"  {cls.__name__} {b.batch_number} -> {nxt}")

print("\nFinal:")
for st in ["REGISTERED","RECEIVED","PRE_PROCESSING","EXTRACTION","LIBRARY_PREP","POOLING","HYB_SEQ"]:
    print(f"  {st}: {CaseSample.objects.filter(workflow_stage=st).count()}")
