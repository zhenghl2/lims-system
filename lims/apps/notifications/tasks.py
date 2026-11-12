# -*- coding: utf-8 -*-
"""Celery 定时任务：NIPPT 报告到期提醒。"""
import logging

from celery import shared_task

logger = logging.getLogger("lims.notifications")


@shared_task(name="lims.apps.notifications.tasks.send_nippt_due_reminders")
def send_nippt_due_reminders():
    """每天 08:00 CST：T-3 / T-1 到期提醒，一人一封汇总。"""
    from .reminders import send

    result = send(days=(3, 1), dry_run=False)
    logger.info("nippt due reminders: sent=%s failed=%s unrouted=%s",
                len(result.get("sent", [])), len(result.get("failed", [])), result.get("unrouted"))
    return result
