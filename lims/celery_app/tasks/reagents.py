from celery import shared_task
from lims.celery_app.celery import app

@shared_task
def check_reagent_expirations():
    """Check reagent expiry dates and send alerts."""
    # TODO: Implement reagent expiry notifications
    pass
