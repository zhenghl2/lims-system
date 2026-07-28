from lims.apps.cases.models import (
    NipptPreProcessingBatch, NipptExtractionBatch, NipptLibraryBatch,
    NipptPoolingBatch, NipptHybSeqBatch, CaseSample, WorkflowLog
)

def backfill():
    pipeline = [
        (NipptPreProcessingBatch, "EXTRACTION"),
        (NipptExtractionBatch, "LIBRARY_PREP"),
        (NipptLibraryBatch, "POOLING"),
        (NipptPoolingBatch, "HYB_SEQ"),
        (NipptHybSeqBatch, "REPORT_DRAFT"),
    ]
    total = 0
    for model_cls, next_stage in pipeline:
        for batch in model_cls.objects.filter(status="COMPLETED"):
            passed = []
            for s in batch.samples.filter(qc_status="PASS"):
                if s.case_sample_ids:
                    passed.extend([cid for cid in s.case_sample_ids if CaseSample.objects.filter(id=cid, workflow_stage="REGISTERED").exists()])
            if passed:
                CaseSample.objects.filter(id__in=passed).update(workflow_stage=next_stage)
                WorkflowLog.objects.bulk_create([
                    WorkflowLog(case_sample_id=cid, stage=next_stage, action="COMPLETE", batch_number=batch.batch_number)
                    for cid in passed
                ])
                total += len(passed)
                print(f"  {model_cls.__name__} {batch.batch_number}: {len(passed)} samples -> {next_stage}")
    print(f"Backfilled {total} samples")

backfill()
print("Final counts:")
for s in ["REGISTERED","RECEIVED","PRE_PROCESSING","EXTRACTION","LIBRARY_PREP","POOLING","HYB_SEQ"]:
    print(f"  {s}: {CaseSample.objects.filter(workflow_stage=s).count()}")
