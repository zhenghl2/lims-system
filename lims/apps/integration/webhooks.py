"""Outbound webhook to CRM2 (thread + retry, non-blocking)."""
import json
import threading
import time
import urllib.request

from django.conf import settings

CRM_WEBHOOK_URL = getattr(settings, "CRM_WEBHOOK_URL", "")
CRM_WEBHOOK_KEY = getattr(settings, "CRM_WEBHOOK_KEY", "")


def _sign(body: str) -> str:
    import hashlib
    import hmac as hmac_mod
    return hmac_mod.new(CRM_WEBHOOK_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()


def _send_once(event_type, payload):
    body = json.dumps({"event_type": event_type, "payload": payload}, ensure_ascii=False)
    req = urllib.request.Request(
        CRM_WEBHOOK_URL,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-CRM-API-Key": CRM_WEBHOOK_KEY,
            "X-CRM-Signature": _sign(body),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        if resp.status != 200:
            raise RuntimeError(f"CRM responded {resp.status}")
        return resp.read()


def _worker(event_type, payload):
    for attempt in range(3):
        try:
            _send_once(event_type, payload)
            return
        except Exception as e:
            if attempt == 2:
                # 最终失败：仅记日志，由 CRM 轮询兜底
                try:
                    import logging
                    logging.getLogger("lims.integration").warning(
                        "webhook failed after 3 retries: %s %s", event_type, e
                    )
                except Exception:
                    pass
                return
            time.sleep(2 ** attempt)


def enqueue_webhook(event_type, payload):
    """非阻塞发送 webhook（后台线程，3 次重试）。"""
    if not CRM_WEBHOOK_URL or not CRM_WEBHOOK_KEY:
        return
    t = threading.Thread(target=_worker, args=(event_type, payload), daemon=True)
    t.start()
