"""Model signals → CRM2 webhook events (status-change only, no spam)."""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .webhooks import enqueue_webhook

_pre_save_status = {}


def _record_status(sender, instance, field="status"):
    _pre_save_status[(sender.__name__, instance.pk)] = getattr(instance, field)


def _pop_old_status(sender, instance, field="status"):
    key = (sender.__name__, instance.pk)
    old = _pre_save_status.pop(key, None)
    current = getattr(instance, field)
    return old, current


# ---- Sample ----
@receiver(pre_save, sender="samples.Sample")
def sample_pre_save(sender, instance, **kwargs):
    _record_status(sender, instance, "status")


@receiver(post_save, sender="samples.Sample")
def sample_post_save(sender, instance, created, **kwargs):
    if created:
        enqueue_webhook("sample.registered", {
            "sample_id": instance.sample_id,
            "lims_uuid": str(instance.id),
            "external_id": instance.external_id or "",
            "status": instance.status,
        })
        return
    old, new = _pop_old_status(sender, instance, "status")
    if old and old != new:
        enqueue_webhook("sample.status_changed", {
            "sample_id": instance.sample_id,
            "lims_uuid": str(instance.id),
            "status": new,
            "from": old,
        })


# ---- Case ----
@receiver(pre_save, sender="cases.Case")
def case_pre_save(sender, instance, **kwargs):
    _record_status(sender, instance, "status")


@receiver(post_save, sender="cases.Case")
def case_post_save(sender, instance, created, **kwargs):
    if created:
        return  # case 创建通过样本登记通知
    old, new = _pop_old_status(sender, instance, "status")
    if old and old != new:
        enqueue_webhook("case.status_changed", {
            "case_number": instance.case_number,
            "lims_uuid": str(instance.id),
            "status": new,
            "from": old,
        })


# ---- Report ----
@receiver(pre_save, sender="reports.Report")
def report_pre_save(sender, instance, **kwargs):
    _record_status(sender, instance, "status")


@receiver(post_save, sender="reports.Report")
def report_post_save(sender, instance, created, **kwargs):
    if created:
        return
    old, new = _pop_old_status(sender, instance, "status")
    if old and old != new and new == "RELEASED":
        payload = {
            "report_number": instance.report_number,
            "lims_uuid": str(instance.id),
            "sample_id": str(instance.sample_id) if instance.sample_id else None,
            "sample_barcode": instance.sample.sample_id if instance.sample_id else "",
            "version_number": instance.version_number,
            "released_at": instance.released_at.isoformat() if instance.released_at else None,
        }
        enqueue_webhook("report.released", payload)


# ---- CaseSample resample（NIPPT 重采）----
@receiver(post_save, sender="cases.CaseSample")
def casesample_post_save(sender, instance, created, **kwargs):
    if created and instance.resample_of_id:
        enqueue_webhook("case.resample", {
            "case_number": instance.case.case_number,
            "lims_case_uuid": str(instance.case_id),
            "case_sample_id": str(instance.id),
            "resample_number": instance.resample_number,
            "role": instance.role,
        })
