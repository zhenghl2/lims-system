#!/usr/bin/env python3
"""Create test data for NIPPT Case Management demo."""
import os, sys, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
sys.path.insert(0, '/opt/lims/lims')
django.setup()

from lims.apps.cases.models import Case, CaseSample
from lims.apps.samples.models import Sample, TestPanel
from datetime import date, timedelta
import random

# Ensure NIPPT panel exists
panel, _ = TestPanel.objects.get_or_create(
    code="NIPPT",
    defaults={"name": "NIPPT", "description": "Non-Invasive Prenatal Paternity Test", "is_active": True}
)

# Helper: create a sample
def make_sample(patient_name, status, sample_id, rejection_reason=None, rejection_note=None):
    s = Sample.objects.create(
        sample_id=sample_id,
        patient_name=patient_name,
        status=status,
        panel=panel,
        collection_date=date.today() - timedelta(days=random.randint(0, 5)),
        rejection_reason=rejection_reason,
        rejection_note=rejection_note,
    )
    return s

# Helper: create a case
def make_case(case_number, pt_num, status, is_urgent=False):
    c = Case.objects.create(
        case_number=case_number,
        pt_number=pt_num,
        panel=panel,
        status=status,
        is_urgent=is_urgent,
        clinic_name=random.choice(["北京协和医院", "上海瑞金医院", "广州中山一院", "华西医院", "浙江大学附属第一医院", "武汉同济医院"]),
        sales_person=random.choice(["张三", "李四", "王五", "赵六"]),
        gestational_age_weeks=random.randint(10, 24),
        gestational_age_days=random.randint(0, 6),
        clinic_contact=f"010-{random.randint(10000000,99999999)}",
        notes=random.choice(["", "高龄孕妇，需加急处理", "双胎妊娠", "IVF妊娠"]),
        expected_completion=date.today() + timedelta(days=random.randint(5, 14)),
    )
    return c

# Clean existing test data
Case.objects.filter(case_number__startswith="NIPPT-TEST").delete()
Sample.objects.filter(sample_id__startswith="TEST-").delete()
print("Cleaned old test data")

# ============ Case 1: In progress with mixed sample statuses ============
c1 = make_case("NIPPT-20260510-0001", "PT10001", "IN_PROCESS")
s1a = make_sample("王芳", "IN_PROCESS", "TEST-001-M")
s1b = make_sample("李明", "RECEIVED", "TEST-001-F1")
s1c = make_sample("张伟", "REGISTERED", "TEST-001-F2")
cs1a = CaseSample.objects.create(case=c1, sample=s1a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10001M")
cs1b = CaseSample.objects.create(case=c1, sample=s1b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10001Fa")
cs1c = CaseSample.objects.create(case=c1, sample=s1c, role="ALLEGED_FATHER", sample_source="SWAB", test_sample_id="PT10001Fb")

# ============ Case 2: Completed successfully ============
c2 = make_case("NIPPT-20260509-0002", "PT10002", "COMPLETED")
s2a = make_sample("刘雪", "COMPLETED", "TEST-002-M")
s2b = make_sample("陈刚", "COMPLETED", "TEST-002-F1")
cs2a = CaseSample.objects.create(case=c2, sample=s2a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10002M")
cs2b = CaseSample.objects.create(case=c2, sample=s2b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10002Fa")

# ============ Case 3: Has rejected sample + resample ============
c3 = make_case("NIPPT-20260511-0003", "PT10003", "RECEIVING")
s3a = make_sample("赵敏", "RECEIVED", "TEST-003-M")
s3b = make_sample("周杰", "REJECTED", "TEST-003-F1", rejection_reason="INSUFFICIENT_VOLUME", rejection_note="采血管仅2ml，不足5ml要求")
cs3a = CaseSample.objects.create(case=c3, sample=s3a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10003M")
cs3b = CaseSample.objects.create(case=c3, sample=s3b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10003Fa")

# Resample for cs3b
s3c = make_sample("周杰", "REGISTERED", "TEST-003-F1R1")
cs3c = CaseSample.objects.create(
    case=c3, sample=s3c, role="ALLEGED_FATHER", sample_source="BLOOD",
    test_sample_id="PT10003FaR1", resample_of=cs3b, resample_number=1
)

# ============ Case 4: All registered (urgent) ============
c4 = make_case("NIPPT-20260512-0004", "PT10004", "REGISTERED", is_urgent=True)
s4a = make_sample("孙丽", "REGISTERED", "TEST-004-M")
s4b = make_sample("吴强", "REGISTERED", "TEST-004-F1")
cs4a = CaseSample.objects.create(case=c4, sample=s4a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10004M")
cs4b = CaseSample.objects.create(case=c4, sample=s4b, role="ALLEGED_FATHER", sample_source="HAIR", test_sample_id="PT10004Fa")

# ============ Case 5: Testing stage ============
c5 = make_case("NIPPT-20260508-0005", "PT10005", "TESTING")
s5a = make_sample("郑华", "TESTING", "TEST-005-M")
s5b = make_sample("冯涛", "IN_PROCESS", "TEST-005-F1")
cs5a = CaseSample.objects.create(case=c5, sample=s5a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10005M")
cs5b = CaseSample.objects.create(case=c5, sample=s5b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10005Fa")

# ============ Case 6: Reported ============
c6 = make_case("NIPPT-20260505-0006", "PT10006", "REPORTED")
s6a = make_sample("黄蕾", "REPORTED", "TEST-006-M")
s6b = make_sample("曹磊", "REPORTED", "TEST-006-F1")
cs6a = CaseSample.objects.create(case=c6, sample=s6a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10006M")
cs6b = CaseSample.objects.create(case=c6, sample=s6b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10006Fa")

# ============ Case 7: Multiple fathers + rejected ============
c7 = make_case("NIPPT-20260512-0007", "PT10007", "RECEIVING")
s7a = make_sample("林欣", "RECEIVED", "TEST-007-M")
s7b = make_sample("彭浩", "RECEIVED", "TEST-007-F1")
s7c = make_sample("徐东", "REJECTED", "TEST-007-F2", rejection_reason="SEVERE_HEMOLYSIS", rejection_note="严重溶血，无法提取DNA")
s7d = make_sample("徐东", "REGISTERED", "TEST-007-F2R1")
cs7a = CaseSample.objects.create(case=c7, sample=s7a, role="MOTHER", sample_source="BLOOD", test_sample_id="PT10007M")
cs7b = CaseSample.objects.create(case=c7, sample=s7b, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10007Fa")
cs7c = CaseSample.objects.create(case=c7, sample=s7c, role="ALLEGED_FATHER", sample_source="SWAB", test_sample_id="PT10007Fb")
cs7d = CaseSample.objects.create(case=c7, sample=s7d, role="ALLEGED_FATHER", sample_source="BLOOD", test_sample_id="PT10007FbR1", resample_of=cs7c, resample_number=1)

print(f"Created 7 cases with {CaseSample.objects.filter(case__case_number__startswith='NIPPT-TEST').count()} case_samples")
print("Done!")
for c in Case.objects.filter(case_number__startswith="NIPPT-TEST").order_by("case_number"):
    cs = c.case_samples.all()
    statuses = ", ".join(f"{cs2.test_sample_id}:{cs2.sample.status}" for cs2 in cs)
    urgent = "🔥" if c.is_urgent else "  "
    print(f"  {urgent} {c.case_number} [{c.status}] {c.clinic_name} — {statuses}")
