# -*- coding: utf-8 -*-
"""NIPPT 报告到期提醒（T-3 / T-1），一人一封汇总邮件。

用法：
    python manage.py send_due_reminders              # 正式发送
    python manage.py send_due_reminders --dry-run    # 只打印清单
    python manage.py send_due_reminders --days 3,1 --force   # 忽略幂等（联调用）

定时：宿主 crontab 每天 00:00 UTC（= 08:00 CST）执行
    docker exec docker-web-1 python manage.py send_due_reminders
"""
import json

from django.core.management.base import BaseCommand

from lims.apps.notifications.reminders import build_plan, send


class Command(BaseCommand):
    help = "NIPPT 报告到期提醒：T-3 / T-1，按来源路由到销售，一人一封汇总"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="只打印清单，不发信")
        parser.add_argument("--days", default="3,1", help="提醒里程碑（默认 3,1）")
        parser.add_argument("--force", action="store_true", help="忽略幂等（联调用）")
        parser.add_argument("--only", default="", choices=["", "cases", "samples"],
                            help="只处理 NIPPT 案例(cases) 或 NIPT 样本(samples)")
        parser.add_argument("--json", action="store_true", help="输出 JSON")

    def handle(self, *args, **opts):
        days = tuple(sorted({int(x) for x in str(opts["days"]).split(",") if x.strip()}, reverse=True))
        if opts["dry_run"]:
            built = build_plan(days=days, ignore_logs=opts['force'], only=(opts['only'] or None))
            if opts["json"]:
                print(json.dumps({k: v for k, v in built.items() if k != "plan"} |
                                 {"plan": [{kk: vv for kk, vv in p.items() if kk not in ("html",)}
                                           for p in built["plan"]]}, ensure_ascii=False, indent=1))
                return
            self.stdout.write(f"今天 {built['today']} | 待发 {len(built['plan'])} 人/组 | "
                              f"项目 {built['total_cases']} | 未路由来源 {built['unrouted']} | "
                              f"已发过 {built['skipped_already_sent']}")
            for p in built["plan"]:
                self.stdout.write("")
                self.stdout.write(
                    f"→ {p['user_name']} <{p['email']}> {p['milestone']} · {p['count']} 项"
                    f"（NIPPT 案例 {p['case_count']} / NIPT 样本 {p['sample_count']}）")
                self.stdout.write(p["text"])
            return

        # --force：忽略幂等真的重发（用于格式调整后补发），日志按原记录保留
        result = send(days=days, dry_run=False, force=opts["force"], only=(opts["only"] or None))
        self.stdout.write(f"发送完成：成功 {len(result['sent'])} 封，失败 {len(result['failed'])} 封，"
                          f"未路由来源 {result['unrouted']}，今日案例 {result['total_cases']}")
        for f in result["failed"]:
            self.stderr.write(f"  FAIL {f['email']} {f['milestone']}: {f['error']}")
