"""LIMS External API — sample pre-receive endpoint for CRM.

Auth: API Key (X-LIMS-API-Key header), NOT JWT.
CRM users have no LIMS accounts; this is the only bridge.
"""
import hashlib
import hmac
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from django.utils import timezone


EXPECTED_API_KEY = getattr(settings, "LIMS_API_KEY", "change-me")


def _verify_signature(request):
    """Verify HMAC-SHA256 signature from CRM."""
    api_key = request.headers.get("X-LIMS-API-Key", "")
    signature = request.headers.get("X-LIMS-Signature", "")
    if not api_key or not signature:
        return False
    if api_key != EXPECTED_API_KEY:
        return False
    # Optional strict HMAC check (Phase 3)
    body = request.body.decode()
    expected = hmac.new(
        EXPECTED_API_KEY.encode(), body.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


@csrf_exempt
def sample_pre_receive(request):
    """Receive sample pre-registration from CRM.

    CRM pushes sample orders here after payment/approval.
    LIMS creates internal sample records.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    # Auth
    if not _verify_signature(request):
        return JsonResponse({"error": "Invalid or missing API credentials"}, status=403)

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    crm_order_id = payload.get("crm_order_id")
    samples = payload.get("samples", [])

    if not crm_order_id:
        return JsonResponse({"error": "crm_order_id is required"}, status=400)
    if not samples:
        return JsonResponse({"error": "samples array is empty"}, status=400)

    received = []
    errors = []

    for s in samples:
        barcode = s.get("sample_barcode")
        test_code = s.get("test_item_code")
        sample_type = s.get("sample_type")

        if not barcode:
            errors.append({"error": "sample_barcode required", "data": s})
            continue

        # TODO Phase 3: create actual LIMS Sample record
        # For now, log and acknowledge
        received.append({
            "sample_barcode": barcode,
            "lims_id": f"LIMS-{barcode}",
            "status": "PRE_REGISTERED",
        })

    return JsonResponse({
        "crm_order_id": crm_order_id,
        "received": len(received),
        "errors": len(errors),
        "samples": received,
        "error_details": errors if errors else None,
        "timestamp": timezone.now().isoformat(),
    })
