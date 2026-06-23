from celery import shared_task
from lims.celery_app.celery import app

@shared_task
def check_retention_expirations():
    """Check samples past retention period and mark for disposal."""
    # TODO: Implement retention policy check
    pass
