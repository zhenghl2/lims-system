# -*- coding: utf-8 -*-
"""NIPPT 报告到期提醒（邮件）

规则（用户 2026-11-12 确认）：
- 只做 NIPPT 子系统；里程碑 T-3（到期前 3 天）与 T-1（到期前 1 天），首版不发逾期
- 一人一封汇总邮件，按「样本来源」路由到销售（例：巴西 / 泰国 → 吴梦婷）
- 幂等：ReminderLog 唯一键 (case, milestone, due_date) —— 同一案例同一里程碑当天只发一次
- 已完成 / 已取消 的案例不提醒

入口：
- Celery 定时任务：apps.notifications.tasks.send_nippt_due_reminders（每天 08:00 CST）
- 手动：POST /api/v1/reminder-routes/send/  （支持 dry_run 预览，不发信）
"""
from __future__ import annotations

import datetime
from collections import defaultdict

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from lims.apps.cases.models import Case

from .models import ReminderLog, ReminderRoute

MILESTONES = {3: "T3", 1: "T1"}
EXCLUDE_STATUS = ("COMPLETED", "CANCELLED")


# ── 收集 ──────────────────────────────────────────────
def collect_due_cases(days=(3, 1)):
    """返回 [(case, milestone, days_left)]，只含未完成案例。"""
    today = timezone.localdate()
    due_dates = {today + datetime.timedelta(days=d): d for d in days}
    qs = (
        Case.objects.filter(expected_completion__in=list(due_dates.keys()))
        .exclude(status__in=EXCLUDE_STATUS)
        .prefetch_related("case_samples__sample")
        .order_by("expected_completion", "case_number")
    )
    out = []
    for case in qs:
        left = (case.expected_completion - today).days
        milestone = MILESTONES.get(left)
        if not milestone:
            continue
        out.append((case, milestone, left))
    return out


def _route_map():
    """来源 → (user, route)；精确匹配优先，其次前缀匹配（'巴西万基' 命中 '巴西'）。"""
    exact, prefix = {}, []
    for r in ReminderRoute.objects.select_related("user").filter(is_active=True):
        src = (r.source or "").strip()
        if not src:
            continue
        exact[src] = r
        prefix.append((src, r))
    return exact, prefix


def _resolve_route(source, exact, prefix):
    src = (source or "").strip()
    if not src:
        return None
    if src in exact:
        return exact[src]
    for key, r in prefix:
        if src.startswith(key):
            return r
    return None


# ── 渲染 ──────────────────────────────────────────────
def _case_line(case):
    """一行 = 一个案例。外部编号/收样日期取母样本，缺失时退到任一有值的样本。"""
    mother = ""
    mother_sample = None
    fallback_sample = None
    for cs in case.case_samples.all():
        if not cs.sample:
            continue
        if cs.role == "MOTHER":
            mother = cs.sample.patient_name or ""
            mother_sample = cs.sample
            break
        if fallback_sample is None and cs.sample.external_id:
            fallback_sample = cs.sample
    src = mother_sample or fallback_sample
    external_id = (src.external_id if src and src.external_id else "")
    receipt = src.receipt_date if src and src.receipt_date else None
    return {
        "case_number": case.case_number,
        "external_id": external_id or "-",
        "pt_number": case.pt_number or "",
        "mother": mother,
        "source": case.origin_country() or "-",
        "receipt_date": receipt.isoformat() if receipt else "-",
        "status": case.get_status_display(),
        "due": case.expected_completion.isoformat() if case.expected_completion else "",
        "urgent": bool(getattr(case, "is_urgent", False)),
    }


def _render(recipient_name, milestone, items):
    if milestone == "T3":
        title = "【报告到期提醒】3 天后到期"
        when = "3 天后（T-3）"
    else:
        title = "【报告到期提醒】明天到期"
        when = "明天（T-1）"
    subject = f"{title} · 共 {len(items)} 个案例"

    lines = [
        f"{recipient_name}，您好：",
        "",
        f"以下 {len(items)} 个 NIPPT 案例的报告将于{when}到期，请及时跟进：",
        "",
    ]
    for idx, i in enumerate(items, 1):
        lines += [
            f"{idx}) {i['case_number']}    外部编号：{i['external_id']}    "
            f"PT编号：{i['pt_number'] or '-'}    加急：{'是' if i['urgent'] else '否'}",
            f"   孕妇：{i['mother'] or '-'}（{i['source']}）",
            f"   收样日期：{i['receipt_date']}    当前状态：{i['status']}    "
            f"报告截止：{i['due']}",
            "",
        ]
    lines += [
        "",
        "说明：本邮件由 LIMS 系统自动发送（每天 08:00），仅在 T-3 / T-1 提醒；"
        "逾期案例不在本邮件范围。如需调整提醒规则，请联系实验室管理员。",
    ]
    text = "\n".join(lines)

    rows = "".join(
        "<tr>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['case_number']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap;font-family:monospace'>{i['external_id']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['pt_number'] or '-'}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd'>{i['mother'] or '-'}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['source']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['receipt_date']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['status']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{i['due']}</td>"
        f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>{'<b style=color:#c00>是</b>' if i['urgent'] else '否'}</td>"
        "</tr>"
        for i in items
    )
    html = (
        f"<p>{recipient_name}，您好：</p>"
        f"<p>以下 <b>{len(items)}</b> 个 NIPPT 案例的报告将于<b>{when}</b>到期，请及时跟进：</p>"
        "<table style='border-collapse:collapse;font-size:12px;width:100%'>"
        "<thead><tr style='background:#f5f5f5'>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>案例编号</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>外部编号</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>PT编号</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>孕妇姓名</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>来源</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>收样日期</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>当前状态</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>截止日期</th>"
        "<th style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>加急</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
        "<p style='color:#888;font-size:12px'>本邮件由 LIMS 自动发送（每天 08:00），仅在 T-3 / T-1 提醒；"
        "逾期案例不在本邮件范围。</p>"
    )
    return subject, text, html


# ── 主流程 ────────────────────────────────────────────
def build_plan(days=(3, 1), ignore_logs=False):
    """生成待发清单（不发信）：按 (销售, 里程碑) 聚合。"""
    exact, prefix = _route_map()
    today = timezone.localdate()
    groups = defaultdict(list)
    unrouted = defaultdict(int)
    skipped_already = 0

    for case, milestone, left in collect_due_cases(days):
        route = _resolve_route(case.origin_country(), exact, prefix)
        if route is None or not (route.user and route.user.email):
            unrouted[case.origin_country() or "(未填来源)"] += 1
            continue
        if not ignore_logs and ReminderLog.objects.filter(
            subject_type="case", subject_id=case.id, milestone=milestone,
            due_date=case.expected_completion,
        ).exists():
            skipped_already += 1
            continue
        groups[(route.user_id, milestone)].append((case, milestone, left))

    plan = []
    for (user_id, milestone), rows in groups.items():
        route = ReminderRoute.objects.select_related("user").filter(user_id=user_id).first()
        items = [_case_line(c) for c, _m, _left in rows]
        subject, text, html = _render(route.user.first_name or route.user.username, milestone, items)
        plan.append({
            "user_id": str(user_id),
            "user_name": route.user.first_name or route.user.username,
            "email": route.user.email,
            "milestone": milestone,
            "count": len(items),
            "items": items,
            "subject": subject,
            "text": text,
            "html": html,
            # 只放可序列化字段（API 直接返回这份 plan）
            "cases": [{"case_id": str(c.id), "case_number": c.case_number, "milestone": m}
                      for c, m, _l in rows],
        })
    plan.sort(key=lambda p: (p["milestone"], p["email"]))
    return {
        "today": today.isoformat(),
        "plan": plan,
        "unrouted": dict(unrouted),
        "skipped_already_sent": skipped_already,
        "total_cases": sum(p["count"] for p in plan) + skipped_already,
    }


def send(days=(3, 1), dry_run=False, force=False):
    """生成并发送；dry_run=True 只返回清单。force=True 忽略幂等（重发测试用）。"""
    built = build_plan(days, ignore_logs=force)
    result = {
        "today": built["today"],
        "unrouted": built["unrouted"],
        "skipped_already_sent": built["skipped_already_sent"],
        "sent": [],
        "failed": [],
        "dry_run": dry_run,
        "total_cases": built["total_cases"],
    }
    if dry_run:
        result["plan"] = built["plan"]
        return result

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or settings.EMAIL_HOST_USER
    for p in built["plan"]:
        mail = EmailMultiAlternatives(
            subject=p["subject"],
            body=p["text"],
            from_email=from_email,
            to=[p["email"]],
        )
        mail.attach_alternative(p["html"], "text/html")
        try:
            mail.send(fail_silently=False)
        except Exception as exc:  # 单封失败不影响其它人
            result["failed"].append({"email": p["email"], "milestone": p["milestone"],
                                     "error": str(exc)[:300]})
            continue

        with transaction.atomic():
            for item in p["cases"]:
                case = Case.objects.only("id", "case_number", "expected_completion").get(id=item["case_id"])
                ReminderLog.objects.get_or_create(
                    subject_type="case",
                    subject_id=case.id,
                    milestone=item["milestone"],
                    due_date=case.expected_completion,
                    defaults={
                        "subject_repr": case.case_number,
                        "recipient": p["email"],
                        "status": "SENT",
                        "case_number": case.case_number,
                    },
                )
        result["sent"].append({"email": p["email"], "milestone": p["milestone"],
                               "count": p["count"], "subject": p["subject"]})
    return result
