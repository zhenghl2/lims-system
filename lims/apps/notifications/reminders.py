# -*- coding: utf-8 -*-
"""报告到期提醒（邮件）— NIPPT 案例 + NIPT 样本

规则（用户 2026-11-12 确认，2026-11-12 追加 NIPT）：
- 里程碑 T-3（到期前 3 天）、T-1（到期前 1 天）；首版不发逾期
- 一人一封汇总邮件，按「样本来源」路由到销售（巴西 / 巴西万基 / 泰国 → 吴梦婷）
- NIPPT：按 Case.expected_completion（DateField）
- NIPT：按 Sample.report_due_date（文本，DD/MM/YYYY），限定 panel ∈ NIPT / NIPT_PLUS，
        巴西万基的 NIPPT 样本不在此列（走 Case 口径，避免重复提醒）
- 已完成 / 已取消 / 已拒绝 不提醒
- 幂等：ReminderLog 唯一键 (subject_type, subject_id, milestone, due_date)

入口：
- 管理命令 send_due_reminders（宿主 cron 每天 08:00 CST）
- API：/api/v1/notifications/reminder-routes/preview/ 、/send_now/
"""
from __future__ import annotations

import datetime
from collections import defaultdict

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from lims.apps.cases.models import Case
from lims.apps.samples.models import Sample

from .models import ReminderLog, ReminderRoute

MILESTONES = {3: "T3", 1: "T1"}
CASE_EXCLUDE_STATUS = ("COMPLETED", "CANCELLED")
SAMPLE_EXCLUDE_STATUS = ("COMPLETED", "REJECTED")
NIPT_PANELS = ("NIPT", "NIPT_PLUS")
DATE_FORMATS = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%Y/%m/%d")

TD = "<td style='padding:4px 6px;border:1px solid #ddd'>"
TDN = "<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap'>"
THN = "<th style='padding:4px 6px;border:1px solid #eee;white-space:nowrap;background:#f5f5f5'>"


def parse_due_date(text):
    """NIPT 的 report_due_date 是自由文本，按常见格式解析；解析不了返回 None。"""
    if not text:
        return None
    raw = str(text).strip().replace(".", "/")
    for fmt in DATE_FORMATS:
        try:
            return datetime.datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


# ── 收集 ──────────────────────────────────────────────
def collect_due_cases(days=(3, 1)):
    """NIPPT：[(case, milestone, days_left)]"""
    today = timezone.localdate()
    due_dates = {today + datetime.timedelta(days=d): d for d in days}
    qs = (
        Case.objects.filter(expected_completion__in=list(due_dates.keys()))
        .exclude(status__in=CASE_EXCLUDE_STATUS)
        .prefetch_related("case_samples__sample")
        .order_by("expected_completion", "case_number")
    )
    out = []
    for case in qs:
        left = (case.expected_completion - today).days
        milestone = MILESTONES.get(left)
        if milestone:
            out.append((case, milestone, left))
    return out


def collect_due_samples(days=(3, 1)):
    """NIPT：[(sample, milestone, days_left)]，只看 NIPT / NIPT_PLUS 的样本。"""
    today = timezone.localdate()
    targets = {today + datetime.timedelta(days=d): d for d in days}
    qs = (
        Sample.objects.filter(is_deleted=False, panel__code__in=NIPT_PANELS)
        .exclude(status__in=SAMPLE_EXCLUDE_STATUS)
        .exclude(report_due_date="")
        .exclude(report_due_date__isnull=True)
        .select_related("panel")
        .order_by("report_due_date", "external_id")
    )
    out = []
    for sample in qs:
        due = parse_due_date(sample.report_due_date)
        if due in targets:
            out.append((sample, MILESTONES[targets[due]], targets[due]))
    return out


def _route_map():
    """来源 → route；精确匹配优先，其次前缀匹配（'巴西万基' 命中 '巴西'）。"""
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


# ── 行数据 ────────────────────────────────────────────
def _case_line(case):
    """NIPPT 一行 = 一个案例。外部编号/收样日期取母样本，缺失时退到任一有值的样本。"""
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


def _sample_line(sample):
    due = parse_due_date(sample.report_due_date)
    return {
        "external_id": sample.external_id or "-",
        "panel": sample.panel.code if sample.panel else "",
        "name": sample.patient_name or "",
        "source": sample.sample_source or "-",
        "receipt_date": sample.receipt_date.isoformat() if sample.receipt_date else "-",
        "status": sample.get_status_display(),
        "due": due.isoformat() if due else "",
        "urgent": bool(getattr(sample, "is_urgent", False)),
    }


# ── 渲染 ──────────────────────────────────────────────
def _render(recipient_name, milestone, cases, samples):
    when = "3 天后（T-3）" if milestone == "T3" else "明天（T-1）"
    title = "【报告到期提醒】3 天后到期" if milestone == "T3" else "【报告到期提醒】明天到期"
    total = len(cases) + len(samples)
    if cases and samples:
        subject = f"{title} · 共 {total} 个（NIPPT 案例 {len(cases)} / NIPT 样本 {len(samples)}）"
    elif cases:
        subject = f"{title} · NIPPT 案例 {len(cases)} 个"
    else:
        subject = f"{title} · NIPT 样本 {len(samples)} 个"

    text = [f"{recipient_name}，您好：", ""]
    if cases:
        text.append(f"■ NIPPT 案例 {len(cases)} 个（{when}到期）")
        text.append("")
        for idx, i in enumerate(cases, 1):
            text += [
                f"{idx}) {i['case_number']}    外部编号：{i['external_id']}    "
                f"PT编号：{i['pt_number'] or '-'}    加急：{'是' if i['urgent'] else '否'}",
                f"   孕妇：{i['mother'] or '-'}（{i['source']}）",
                f"   收样日期：{i['receipt_date']}    当前状态：{i['status']}    "
                f"报告截止：{i['due']}",
                "",
            ]
    if samples:
        text.append(f"■ NIPT 样本 {len(samples)} 个（{when}到期）")
        text.append("")
        for idx, i in enumerate(samples, 1):
            text += [
                f"{idx}) {i['external_id']}    项目：{i['panel']}    加急：{'是' if i['urgent'] else '否'}",
                f"   姓名：{i['name'] or '-'}（{i['source']}）",
                f"   收样日期：{i['receipt_date']}    当前状态：{i['status']}    "
                f"报告截止：{i['due']}",
                "",
            ]
    text += [
        "说明：本邮件由 LIMS 系统自动发送（每天 08:00），仅在 T-3 / T-1 提醒；"
        "逾期案例/样本不在本邮件范围。如需调整提醒规则，请联系实验室管理员。",
    ]

    html = [f"<p>{recipient_name}，您好：</p>"]
    html.append(f"<p>以下共 <b>{total}</b> 个需在<b>{when}</b>交付，请及时跟进：</p>")

    if cases:
        html.append(f"<h4 style='margin:14px 0 6px'>NIPPT 案例（{len(cases)} 个）</h4>")
        rows = "".join(
            "<tr>"
            f"{TDN}{i['case_number']}</td>"
            f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap;font-family:monospace'>{i['external_id']}</td>"
            f"{TDN}{i['pt_number'] or '-'}</td>"
            f"{TD}{i['mother'] or '-'}</td>"
            f"{TDN}{i['source']}</td>"
            f"{TDN}{i['receipt_date']}</td>"
            f"{TDN}{i['status']}</td>"
            f"{TDN}{i['due']}</td>"
            f"{TDN}{'<b style=color:#c00>是</b>' if i['urgent'] else '否'}</td>"
            "</tr>"
            for i in cases
        )
        html.append(
            "<table style='border-collapse:collapse;font-size:12px;width:100%'>"
            "<thead><tr>"
            f"{THN}案例编号</th>{THN}外部编号</th>{THN}PT编号</th>{THN}孕妇姓名</th>"
            f"{THN}来源</th>{THN}收样日期</th>{THN}当前状态</th>{THN}截止日期</th>{THN}加急</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
        )

    if samples:
        html.append(f"<h4 style='margin:16px 0 6px'>NIPT 样本（{len(samples)} 个）</h4>")
        rows = "".join(
            "<tr>"
            f"<td style='padding:4px 6px;border:1px solid #ddd;white-space:nowrap;font-family:monospace'>{i['external_id']}</td>"
            f"{TDN}{i['panel']}</td>"
            f"{TD}{i['name'] or '-'}</td>"
            f"{TDN}{i['source']}</td>"
            f"{TDN}{i['receipt_date']}</td>"
            f"{TDN}{i['status']}</td>"
            f"{TDN}{i['due']}</td>"
            f"{TDN}{'<b style=color:#c00>是</b>' if i['urgent'] else '否'}</td>"
            "</tr>"
            for i in samples
        )
        html.append(
            "<table style='border-collapse:collapse;font-size:12px;width:100%'>"
            "<thead><tr>"
            f"{THN}样本编号</th>{THN}项目</th>{THN}姓名</th>{THN}来源</th>"
            f"{THN}收样日期</th>{THN}当前状态</th>{THN}报告截止</th>{THN}加急</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
        )

    html.append(
        "<p style='color:#888;font-size:12px'>本邮件由 LIMS 自动发送（每天 08:00），"
        "仅在 T-3 / T-1 提醒；逾期项目不在本邮件范围。</p>"
    )
    return subject, "\n".join(text), "".join(html)


# ── 主流程 ────────────────────────────────────────────
def build_plan(days=(3, 1), ignore_logs=False):
    """生成待发清单（不发信）：按 (销售, 里程碑) 聚合，NIPPT 案例 + NIPT 样本分开列。"""
    exact, prefix = _route_map()
    today = timezone.localdate()
    groups = defaultdict(lambda: {"cases": [], "samples": []})
    unrouted = defaultdict(int)
    skipped_already = 0

    for case, milestone, left in collect_due_cases(days):
        route = _resolve_route(case.origin_country(), exact, prefix)
        if route is None or not (route.user and route.user.email):
            unrouted["NIPPT:" + (case.origin_country() or "(未填来源)")] += 1
            continue
        if not ignore_logs and ReminderLog.objects.filter(
            subject_type="case", subject_id=case.id, milestone=milestone,
            due_date=case.expected_completion,
        ).exists():
            skipped_already += 1
            continue
        groups[(route.user_id, milestone)]["cases"].append((case, milestone, left))

    for sample, milestone, left in collect_due_samples(days):
        route = _resolve_route(sample.sample_source, exact, prefix)
        if route is None or not (route.user and route.user.email):
            unrouted["NIPT:" + (sample.sample_source or "(未填来源)")] += 1
            continue
        due = parse_due_date(sample.report_due_date)
        if not ignore_logs and ReminderLog.objects.filter(
            subject_type="sample", subject_id=sample.id, milestone=milestone, due_date=due,
        ).exists():
            skipped_already += 1
            continue
        groups[(route.user_id, milestone)]["samples"].append((sample, milestone, left))

    plan = []
    for (user_id, milestone), bucket in groups.items():
        if not bucket["cases"] and not bucket["samples"]:
            continue
        route = ReminderRoute.objects.select_related("user").filter(user_id=user_id).first()
        case_items = [_case_line(c) for c, _m, _l in bucket["cases"]]
        sample_items = [_sample_line(s) for s, _m, _l in bucket["samples"]]
        name = route.user.first_name or route.user.username
        subject, text, html = _render(name, milestone, case_items, sample_items)
        plan.append({
            "user_id": str(user_id),
            "user_name": name,
            "email": route.user.email,
            "milestone": milestone,
            "count": len(case_items) + len(sample_items),
            "case_count": len(case_items),
            "sample_count": len(sample_items),
            "items": case_items + sample_items,
            "cases": [{"case_id": str(c.id), "case_number": c.case_number, "milestone": m}
                      for c, m, _l in bucket["cases"]],
            "samples": [{"sample_id": str(s.id), "external_id": s.external_id,
                         "milestone": m, "due": parse_due_date(s.report_due_date).isoformat()}
                        for s, m, _l in bucket["samples"]],
            "subject": subject,
            "text": text,
            "html": html,
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
    """生成并发送；dry_run=True 只返回清单。force=True 忽略幂等（补发/联调用）。"""
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
    bcc = [getattr(settings, "REMINDER_BCC", "")] if getattr(settings, "REMINDER_BCC", "") else []
    for p in built["plan"]:
        mail = EmailMultiAlternatives(
            subject=p["subject"], body=p["text"], from_email=from_email,
            to=[p["email"]], bcc=bcc,
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
                    subject_type="case", subject_id=case.id,
                    milestone=item["milestone"], due_date=case.expected_completion,
                    defaults={"subject_repr": case.case_number, "recipient": p["email"],
                              "status": "SENT", "case_number": case.case_number},
                )
            for item in p["samples"]:
                sample = Sample.objects.only("id", "external_id", "patient_name").get(id=item["sample_id"])
                ReminderLog.objects.get_or_create(
                    subject_type="sample", subject_id=sample.id,
                    milestone=item["milestone"], due_date=item["due"],
                    defaults={"subject_repr": sample.external_id or "", "recipient": p["email"],
                              "status": "SENT", "case_number": sample.external_id or ""},
                )
        result["sent"].append({"email": p["email"], "milestone": p["milestone"],
                               "count": p["count"], "case_count": p["case_count"],
                               "sample_count": p["sample_count"], "subject": p["subject"]})
    return result
