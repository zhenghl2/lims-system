# -*- coding: utf-8 -*-
"""
NIPPT 国内送检表（xlsx）解析模块
模版：一行 = 一个案例（孕妇 + 单疑父），第 1 行为中文表头。
输出结构：
    {
        "row_no": 行号,
        "mother_name": "孕妇姓名",
        "father_name": "疑父姓名",
        "father_sample_type": "BLOOD/DBS/...",   # 来自「样本状态」列（男性）
        "external_id": "编号",
        "applicant": "来源",       # → Case.applicant 申请方
        "sales_person": "人员",    # → Case.sales_person 销售
        "phone": "电话",
        "gestational_age_weeks": int | None,
        "gestational_age_days": int | None,
        "collection_date": "YYYY-MM-DD" | None,   # 申请日期 → 母样本采集日期
        "expected_completion": "YYYY-MM-DD" | None,
        "notes": "备注",
        "pt_ref": "万基编号",       # 仅预览参考，不导入
    }
或抛 NipptCnParseError；行级问题收集在 errors 列表。
"""
import datetime
import io
import re

import openpyxl


class NipptCnParseError(Exception):
    pass


# 「样本状态」中文 → 系统样本类型码
SAMPLE_TYPE_CN_MAP = {
    "血液": "BLOOD", "血痕": "DBS", "血斑": "DBS", "干血斑": "DBS",
    "毛发": "HAIR", "头发": "HAIR", "指甲": "NAIL",
    "口腔拭子": "SWAB", "口拭子": "SWAB", "口腔": "SWAB",
    "精液": "SEMEN", "精斑": "SEMSTAIN",
    "牙刷": "TOOTHBRUSH", "烟头": "CIGARETTE", "烟蒂": "CIGARETTE",
    "水瓶": "BOTTLE", "胡须": "BEARD", "牙线": "FLOSS", "口香糖": "GUM",
}

HEADER_MARKER = "孕妇姓名"  # 表头行特征列


def _to_text(v):
    """单元格 → 字符串（datetime/float 兼容）"""
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, datetime.date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _parse_date(v):
    """宽容解析日期 → datetime.date | None
    支持 datetime 对象 / 'YYYY-MM-DD' / 'YYYY/M/D' / 'D/M/YYYY'；
    不完整（如 '2026/9/'）→ None
    """
    if v is None or v == "":
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v).strip()
    if not s:
        return None
    # YYYY/MM/DD 或 YYYY-MM-DD 或 YYYY.MM.DD
    m = re.search(r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})", s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    # DD/MM/YYYY
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def _parse_gestation(v):
    """'7' / '13' / '6+6' → (weeks, days)；失败 → (None, None)"""
    s = _to_text(v)
    if not s:
        return None, None
    m = re.match(r"^(\d+)\s*[+＋]\s*(\d+)", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"^(\d+)", s)
    if m:
        return int(m.group(1)), 0
    return None, None


def _map_sample_type(st):
    """「样本状态」→ 类型码；空/未知 → BLOOD"""
    s = _to_text(st)
    if not s:
        return "BLOOD"
    return SAMPLE_TYPE_CN_MAP.get(s, "BLOOD")


def parse_cn_xlsx_bytes(data, filename=""):
    """解析国内送检表。
    Returns: (cases: list[dict], errors: list[dict])
    Raises: NipptCnParseError（文件级错误）
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as e:
        raise NipptCnParseError(f"无法打开 Excel 文件: {str(e)[:120]}")
    try:
        ws = wb[wb.sheetnames[0]]
        rows = list(ws.iter_rows(values_only=True))
    finally:
        wb.close()
    if not rows:
        raise NipptCnParseError("文件为空")

    # 表头定位：前 10 行内找含「孕妇姓名」的行
    header_idx = None
    for i, r in enumerate(rows[:10]):
        if HEADER_MARKER in [_to_text(c) for c in r]:
            header_idx = i
            break
    if header_idx is None:
        raise NipptCnParseError("未找到表头行（需包含「孕妇姓名」列）")

    headers = [_to_text(c) for c in rows[header_idx]]

    def col(name):
        try:
            return headers.index(name)
        except ValueError:
            return None

    def get(r, name):
        i = col(name)
        if i is None or i >= len(r):
            return None
        return r[i]

    cases, errors = [], []
    for ri, r in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        mother = _to_text(get(r, "孕妇姓名"))
        father = _to_text(get(r, "疑父姓名"))
        if not mother and not father:
            continue  # 空行跳过
        if not mother and not father:
            errors.append({"row_no": ri, "error": "孕妇姓名与疑父姓名均为空"})
            continue
        wk, dy = _parse_gestation(get(r, "孕周"))
        cd = _parse_date(get(r, "申请日期"))
        due = _parse_date(get(r, "预计出报告时间"))
        cases.append({
            "row_no": ri,
            "mother_name": mother,
            "father_name": father,
            "father_sample_type": _map_sample_type(get(r, "样本状态")),
            "external_id": _to_text(get(r, "编号")),
            "applicant": _to_text(get(r, "来源")),
            "sales_person": _to_text(get(r, "人员")),
            "phone": _to_text(get(r, "电话")),
            "gestational_age_weeks": wk,
            "gestational_age_days": dy,
            "collection_date": cd.isoformat() if cd else None,
            "expected_completion": due.isoformat() if due else None,
            "notes": _to_text(get(r, "备注")),
            "pt_ref": _to_text(get(r, "万基编号")),
        })
    if not cases:
        raise NipptCnParseError("未解析到有效数据行")
    return cases, errors
