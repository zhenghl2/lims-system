from lims.apps.cases.models import NipptPoolingBatch, NipptLibraryBatch
print("Library COMPLETED:", NipptLibraryBatch.objects.filter(status="COMPLETED").count())
print("Pooling batches:", NipptPoolingBatch.objects.count())
