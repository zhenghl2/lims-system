"""统一时间显示：服务器时区为 UTC(USE_TZ)，所有界面文本一律输出北京时间。

为什么需要：TIME_ZONE = "UTC" → timezone.localtime() 返回的仍是 UTC；
            str(aware_datetime) 也带 +00:00。界面要北京时间必须显式转换。
用法：from lims.core.timefmt import bj
      bj(dt)                    -> "2026-10-25 11:04:28"
      bj(dt, "%m-%d %H:%M")     -> "10-25 11:04"
"""
from zoneinfo import ZoneInfo

BEIJING = ZoneInfo("Asia/Shanghai")
DEFAULT_FMT = "%Y-%m-%d %H:%M:%S"


def bj(dt, fmt=DEFAULT_FMT):
    """aware datetime → 北京时间字符串；None/空 → 空串（调用方无需判空）。"""
    if not dt:
        return ""
    try:
        return dt.astimezone(BEIJING).strftime(fmt)
    except Exception:
        return ""


def bj_short(dt):
    """北京时间 MM-DD HH:mm（列表/台账用）。"""
    return bj(dt, "%m-%d %H:%M")
