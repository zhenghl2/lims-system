from lims.apps.cases.models import CaseSample, WorkflowLog

# Test: set workflow_stage for a sample
cs = CaseSample.objects.first()
if cs:
    old_stage = cs.workflow_stage
    cs.workflow_stage = "PRE_PROCESSING"
    cs.save(update_fields=["workflow_stage"])
    WorkflowLog.objects.create(case_sample=cs, stage="PRE_PROCESSING", action="ENTER")
    print(f"Updated {cs.test_sample_id}: {old_stage} -> PRE_PROCESSING")
    print(f"Log count: {WorkflowLog.objects.count()}")
    
    # Reset
    cs.workflow_stage = old_stage
    cs.save(update_fields=["workflow_stage"])
print("Test OK")
