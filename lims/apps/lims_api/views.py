"""LIMS External API for CRM2.

Auth: API Key (X-LIMS-API-Key) + HMAC-SHA256 (X-LIMS-Signature), NOT JWT.
CRM has no LIMS accounts; crm_service system user is used internally.

Endpoints (all under /api/v1/lims/):
  POST samples/pre-receive/      — NIPT/HPV sample pre-registration (write #1)
  POST cases/pre-receive/        — NIPPT case pre-registration (write #2)
  GET  views/samples/            — read-only sample status (whitelist fields)
  GET  views/cases/              — read-only case status
  GET  views/reports/            — read-only report status
  GET  views/panels/             — test_panels directory
  POST views/reports/{uuid}/request-pdf-token/ — one-time signed PDF token
  GET  views/reports/{uuid}/pdf/?token=        — download PDF (signed, 30min)
"""
import base64
import hashlib
import hmac
import json
import time
import uuid as uuid_mod

from django.conf import settings
from django.http import JsonResponse, FileResponse, HttpResponseForbidden, HttpResponseNotFound
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

API_KEY = getattr(settings, "LIMS_API_KEY", "change-me")


def _sign(payload_str):
    return hmac.new(API_KEY.encode(), payload_str.encode(), hashlib.sha256).hexdigest()


def _verify_signature(request):
    api_key = request.headers.get("X-LIMS-API-Key", "")
    signature = request.headers.get("X-LIMS-Signature", "")
    if not api_key or not signature:
        return False
    if not hmac.compare_digest(api_key, API_KEY):
        return False
    body = request.body.decode()
    expected = _sign(body)
    return hmac.compare_digest(signature, expected)


def _auth_fail():
    return JsonResponse({"error": "Invalid or missing API credentials"}, status=403)


def _get_service_user():
    from lims.apps.users.models import User
    return User.objects.get(username="crm_service")


def _get_default_site():
    from lims.apps.organizations.models import Site
    return Site.objects.filter(is_active=True).first()


def _gen_sample_id():
    import datetime
    from lims.apps.samples.models import Sample
    today = datetime.date.today().strftime("%Y%m%d")
    count = Sample.objects.filter(sample_id__startswith=f"SMP-{today}").count() + 1
    return f"SMP-{today}-{count:04d}"


# ==================== 写入口 1：样本预登记（NIPT/HPV） ====================
@csrf_exempt
def sample_pre_receive(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not _verify_signature(request):
        return _auth_fail()

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    crm_order_id = payload.get("crm_order_id") or ""
    samples = payload.get("samples", [])
    if not samples:
        return JsonResponse({"error": "samples array is empty"}, status=400)

    from lims.apps.samples.models import Sample, SampleType, TestPanel

    svc = _get_service_user()
    default_site = _get_default_site()
    results, errors = [], []

    for s in samples:
        external_id = (s.get("external_id") or "").strip()
        sample_type_code = (s.get("sample_type_code") or "").strip()
        panel_code = (s.get("panel_code") or "").strip()

        # 幂等：同一 external_id 不重复创建
        if external_id:
            existing = Sample.objects.filter(external_id=external_id, is_deleted=False).first()
            if existing:
                results.append({
                    "external_id": external_id, "sample_id": existing.sample_id,
                    "lims_uuid": str(existing.id), "status": existing.status, "existed": True,
                })
                continue

        try:
            sample_type = SampleType.objects.get(code=sample_type_code, is_active=True)
        except SampleType.DoesNotExist:
            errors.append({"external_id": external_id, "error": f"unknown sample_type_code: {sample_type_code}"})
            continue
        try:
            panel = TestPanel.objects.get(code=panel_code, is_active=True)
        except TestPanel.DoesNotExist:
            errors.append({"external_id": external_id, "error": f"unknown panel_code: {panel_code}"})
            continue

        sample = Sample.objects.create(
            sample_id=_gen_sample_id(),
            sample_type=sample_type,
            panel=panel,
            patient_name=(s.get("patient_name") or "")[:200],
            patient_sex=(s.get("patient_sex") or "")[:1],
            patient_dob=s.get("patient_dob") or None,
            gestational_weeks=s.get("gestational_weeks") or None,
            id_card=(s.get("id_card") or "")[:50],
            external_id=external_id,
            sample_source=(s.get("sample_source") or "")[:200],
            collection_date=s.get("collection_date") or None,
            status="REGISTERED",
            receipt_date=timezone.now().date(),
            receipt_time=timezone.now().time(),
            created_by=svc,
            site=default_site,
        )
        results.append({
            "external_id": external_id, "sample_id": sample.sample_id,
            "lims_uuid": str(sample.id), "status": sample.status,
        })

    return JsonResponse({
        "crm_order_id": crm_order_id, "received": len(results), "errors": len(errors),
        "results": results, "error_details": errors or None,
        "timestamp": timezone.now().isoformat(),
    })


# ==================== 写入口 2：NIPPT case 预登记 ====================
@csrf_exempt
def case_pre_receive(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not _verify_signature(request):
        return _auth_fail()

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    case_data = payload.get("case") or {}
    subjects = payload.get("subjects") or []
    external_id = (case_data.get("external_id") or "").strip()

    # 幂等
    if external_id:
        from lims.apps.cases.models import Case
        from lims.apps.samples.models import Sample
        existing_sample = Sample.objects.filter(external_id=external_id, is_deleted=False).first()
        if existing_sample:
            cs = existing_sample.case_samples.first()
            if cs:
                return JsonResponse({
                    "case_number": cs.case.case_number, "lims_case_uuid": str(cs.case.id),
                    "existed": True,
                    "samples": [{
                        "role": cs.role, "sample_id": existing_sample.sample_id,
                        "lims_uuid": str(existing_sample.id),
                    }],
                })

    from lims.apps.cases.serializers import CaseCreateSerializer
    from types import SimpleNamespace

    svc = _get_service_user()
    # crm_service 用户需有 site（创建用户时设置）
    mother = next((s for s in subjects if s.get("role") == "MOTHER"), None)
    fathers = [s for s in subjects if s.get("role") == "ALLEGED_FATHER"]

    if not mother:
        return JsonResponse({"error": "MOTHER subject required"}, status=400)

    data = {
        "mother_name": mother.get("patient_name") or "",
        "mother_dob": mother.get("patient_dob") or None,
        "father_names": [f.get("patient_name") or "" for f in fathers],
        "father_sample_types": [[(f.get("sample_source") or "BLOOD")] for f in fathers],
        "gestational_age_weeks": case_data.get("gestational_age_weeks"),
        "gestational_age_days": case_data.get("gestational_age_days"),
        "applicant": case_data.get("applicant") or "",
        "phone": case_data.get("phone") or "",
        "email": case_data.get("email") or "",
        "clinic_name": case_data.get("clinic_name") or "",
        "sales_person": case_data.get("sales_person") or "",
        "notes": case_data.get("notes") or "",
        "is_urgent": case_data.get("is_urgent") or False,
        "external_id": external_id,
        "sample_source": case_data.get("sample_source") or "",
    }

    fake_req = SimpleNamespace(user=svc)
    serializer = CaseCreateSerializer(data=data, context={"request": fake_req})
    serializer.is_valid(raise_exception=True)
    case = serializer.save()

    out_samples = []
    for cs in case.case_samples.select_related("sample").all():
        out_samples.append({
            "role": cs.role, "sample_id": cs.sample.sample_id,
            "lims_uuid": str(cs.sample.id), "lims_case_sample_uuid": str(cs.id),
        })
    return JsonResponse({
        "case_number": case.case_number, "lims_case_uuid": str(case.id),
        "samples": out_samples,
    })


# ==================== 只读视图（白名单字段） ====================
def _require_get(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not _verify_signature(request):
        return _auth_fail()
    return None


def views_samples(request):
    err = _require_get(request)
    if err:
        return err
    from lims.apps.samples.models import Sample
    qs = Sample.objects.filter(is_deleted=False)
    external_id = request.GET.get("external_id")
    sample_id = request.GET.get("sample_id")
    updated_after = request.GET.get("updated_after")
    if external_id:
        qs = qs.filter(external_id=external_id)
    if sample_id:
        qs = qs.filter(sample_id=sample_id)
    if updated_after:
        qs = qs.filter(updated_at__gt=updated_after)
    data = [{
        "lims_uuid": str(s.id), "sample_id": s.sample_id, "status": s.status,
        "patient_name": s.patient_name, "vg_id": s.vg_id or "",
        "panel_code": s.panel.code if s.panel_id else "",
        "sample_type_code": s.sample_type.code if s.sample_type_id else "",
        "external_id": s.external_id or "",
        "updated_at": s.updated_at.isoformat(),
    } for s in qs[:500]]
    return JsonResponse({"count": len(data), "results": data})


def views_cases(request):
    err = _require_get(request)
    if err:
        return err
    from lims.apps.cases.models import Case
    qs = Case.objects.prefetch_related("case_samples__sample").all()
    case_number = request.GET.get("case_number")
    external_id = request.GET.get("external_id")
    updated_after = request.GET.get("updated_after")
    if case_number:
        qs = qs.filter(case_number=case_number)
    if external_id:
        qs = qs.filter(case_samples__sample__external_id=external_id).distinct()
    if updated_after:
        qs = qs.filter(updated_at__gt=updated_after)
    data = [{
        "lims_uuid": str(c.id), "case_number": c.case_number, "status": c.status,
        "panel_code": c.panel.code if c.panel_id else "",
        "expected_completion": c.expected_completion.isoformat() if c.expected_completion else None,
        "updated_at": c.updated_at.isoformat(),
        "samples": [{
            "sample_id": cs.sample.sample_id, "status": cs.sample.status,
            "role": cs.role, "patient_name": cs.sample.patient_name,
        } for cs in c.case_samples.all()],
    } for c in qs[:200]]
    return JsonResponse({"count": len(data), "results": data})


def views_reports(request):
    err = _require_get(request)
    if err:
        return err
    from lims.apps.reports.models import Report
    qs = Report.objects.select_related("sample").all()
    sample_id = request.GET.get("sample_id")
    updated_after = request.GET.get("updated_after")
    if sample_id:
        qs = qs.filter(sample_id=sample_id)
    if updated_after:
        qs = qs.filter(updated_at__gt=updated_after)
    data = [{
        "lims_uuid": str(r.id), "report_number": r.report_number,
        "status": r.status, "version_number": r.version_number,
        "released_at": r.released_at.isoformat() if r.released_at else None,
        "sample_id": str(r.sample_id) if r.sample_id else None,
        "sample_barcode": r.sample.sample_id if r.sample_id else "",
        "updated_at": r.updated_at.isoformat(),
    } for r in qs[:500]]
    return JsonResponse({"count": len(data), "results": data})


def views_panels(request):
    err = _require_get(request)
    if err:
        return err
    from lims.apps.samples.models import TestPanel
    data = [{
        "code": p.code, "name": p.name, "turnaround_days": p.turnaround_days,
        "is_active": p.is_active,
    } for p in TestPanel.objects.filter(is_active=True)]
    return JsonResponse({"count": len(data), "results": data})


# ==================== PDF 一次性签名下载 ====================
@csrf_exempt
def request_pdf_token(request, uuid):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not _verify_signature(request):
        return _auth_fail()
    try:
        report_uuid = uuid_mod.UUID(uuid)
    except (ValueError, TypeError):
        return JsonResponse({"error": "invalid report uuid"}, status=400)
    expiry = int(time.time()) + 1800
    raw = f"{report_uuid}|{expiry}"
    sig = _sign(raw)
    token = base64.urlsafe_b64encode(f"{sig}.{raw}".encode()).decode()
    return JsonResponse({"token": token, "expires_in": 1800})


def download_pdf(request, uuid):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    token = request.GET.get("token", "")
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        sig, raw = decoded.split(".", 1)
    except Exception:
        return HttpResponseForbidden("invalid token")
    if not hmac.compare_digest(sig, _sign(raw)):
        return HttpResponseForbidden("invalid signature")
    try:
        report_uuid_str, expiry_str = raw.split("|")
        if uuid_mod.UUID(report_uuid_str) != uuid_mod.UUID(uuid):
            return HttpResponseForbidden("uuid mismatch")
        if int(expiry_str) < int(time.time()):
            return HttpResponseForbidden("token expired")
    except Exception:
        return HttpResponseForbidden("invalid token payload")

    import os as os_mod
    from lims.apps.reports.models import Report
    try:
        report = Report.objects.get(id=uuid)
    except Report.DoesNotExist:
        return HttpResponseNotFound("report not found")
    if report.status != "RELEASED":
        return HttpResponseForbidden("report not released")
    if not report.pdf_file_path:
        return HttpResponseNotFound("pdf not generated")
    docx_path = os_mod.path.join(settings.MEDIA_ROOT, report.pdf_file_path)
    pdf_path = docx_path.replace(".docx", ".pdf")
    if not os_mod.path.exists(pdf_path):
        return HttpResponseNotFound("pdf file missing")
    return FileResponse(open(pdf_path, "rb"), content_type="application/pdf")
