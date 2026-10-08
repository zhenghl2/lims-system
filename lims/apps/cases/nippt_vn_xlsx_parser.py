# -*- coding: utf-8 -*-
"""NIPPT 越南客户信息表（xlsx）解析模块

模版：一行 = 一个案例（孕妇 + 单疑父），第 1 行为英文表头。
真实表头（13 列，注意 Date of birth / Specimen type / Date of collection 各出现两次，
前者属孕妇、后者属疑父，本模块按「Alleged father's Name」位置切分左右半边来区分）：

    S/N | Pregnant woman's Name | Date of birth | Specimen type | Date of collection
        | Alleged father's Name | Date of birth | Specimen type | Date of collection
        | Date of payment | Date of report | Gestational_Week | Remark

输出结构（与国内解析器 parse_cn_xlsx_bytes 保持同构，便于上层复用）：
    {
        "row_no": 行号,
        "mother_name": "孕妇姓名",
        "father_name": "疑父姓名",
        "father_sample_types": ["BLOOD", "DBS"],   # 一格多类型 → 多个样本
        "external_id": "S/N 编号",
        "applicant": "越南",                       # 来源（固定）
        "sales_person": "吴梦婷",                  # 人员（固定）
        "gestational_age_weeks": int | None,
        "gestational_age_days": int | None,
        "mother_collection_date": "YYYY-MM-DD" | "",
        "father_collection_date": "YYYY-MM-DD" | "",
        "expected_completion": "YYYY-MM-DD" | "",  # ← Date of report
        "notes": "备注",                           # Remark + 出生年 + 付款日期
        "type_warnings": ["疑父样本类型 'XXX' 未识别，按血液处理"],   # 预览黄标提示
    }
或抛 NipptVnParseError；行级问题收集在 errors 列表。

设计要点：
- 母样本类型按需求固定为血液（表内 Specimen type 列忽略）
- 出生年（C/G）、付款日期（J）系统无对应字段 → 拼进备注
- 报告日期（K）→ 预计出报告时间
- 未识别的样本类型不静默：记入 type_warnings（前端黄标），落库仍按血液
"""
import datetime
import re

import openpyxl


class NipptVnParseError(Exception):
    pass


# ── 定值（按用户确认）──
FIXED_APPLICANT = "越南"
FIXED_SALES_PERSON = "吴梦婷"

# 表头特征列（用「疑父姓名」列定位表头行，并作为左右半边的分界）
HEADER_MARKER = "alleged father"

# 英文样本类型 → 系统样本类型码（键为归一化后的小写去空格串）
SAMPLE_TYPE_EN_MAP = {
    "periperal blood": "BLOOD", "peripheral blood": "BLOOD", "edta blood": "BLOOD",
    "blood": "BLOOD", "edta": "BLOOD", "whole blood": "BLOOD", "venous blood": "BLOOD",
    "bloodstain": "DBS", "bloodstains": "DBS", "blood stain": "DBS", "blood stains": "DBS",
    "dbs": "DBS", "dried blood spot": "DBS", "dried blood": "DBS", "blood spot": "DBS",
    "nail": "NAIL", "nails": "NAIL", "fingernail": "NAIL", "fingernails": "NAIL",
    "toenail": "NAIL",
    "hair": "HAIR", "hair follicle": "HAIR", "hair follicles": "HAIR", "hair root": "HAIR",
    "hairroot": "HAIR", "hair with root": "HAIR",
    "oral swab": "SWAB", "buccal swab": "SWAB", "mouth swab": "SWAB", "swab": "SWAB",
    "saliva": "SWAB", "saliva swab": "SWAB", "mouth cell": "SWAB",
    "semen": "SEMEN", "sperm": "SEMEN",
    "semen stain": "SEMSTAIN", "sperm stain": "SEMSTAIN", "seminal stain": "SEMSTAIN",
    "toothbrush": "TOOTHBRUSH", "tooth brush": "TOOTHBRUSH",
    "cigarette": "CIGARETTE", "cigarette butt": "CIGARETTE", "cigarette filter": "CIGARETTE",
    "cigarette end": "CIGARETTE", "cigarette stub": "CIGARETTE",
    "bottle": "BOTTLE", "water bottle": "BOTTLE",
    "beard": "BEARD", "beard hair": "BEARD",
    "floss": "FLOSS", "dental floss": "FLOSS", "toothpick": "FLOSS",
    "gum": "GUM", "chewing gum": "GUM",
}

# 中文/常见备选（越南表偶尔混用中文或缩写）
SAMPLE_TYPE_ALIAS = {
    "血液": "BLOOD", "血": "BLOOD", "血痕": "DBS", "血斑": "DBS", "干血斑": "DBS",
    "毛发": "HAIR", "头发": "HAIR", "指甲": "NAIL", "口腔拭子": "SWAB", "口拭子": "SWAB",
    "精液": "SEMEN", "精斑": "SEMSTAIN", "牙刷": "TOOTHBRUSH", "烟头": "CIGARETTE",
    "水瓶": "BOTTLE", "胡须": "BEARD", "牙线": "FLOSS", "口香糖": "GUM",
}


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


def _norm(s):
    """表头/类型值归一化：小写、去多余空白、统一撇号"""
    return re.sub(r"\s+", " ", str(s or "").replace("\u2019", "'").replace("\xa0", " ")).strip().lower()


def _parse_date(v):
    """宽容解析日期 → datetime.date | None（支持 datetime / YYYY-MM-DD / YYYY/M/D / D/M/YYYY）"""
    if v is None or v == "":
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = str(v).strip()
    if not s:
        return None
    m = re.search(r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})", s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def _parse_year(v):
    """出生年：'1993' / 1993 / datetime → '1993'；无法识别 → ''"""
    if v is None or v == "":
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return str(v.year)
    s = str(v).strip()
    m = re.search(r"(19|20)\d{2}", s)
    return m.group(0) if m else ""


def _parse_gestational(v):
    """'13 weeks 4 days' / '8 weeks' / '13w4d' / '13周4天' → (weeks, days) | (None, None)"""
    if v is None or v == "":
        return None, None
    s = str(v).strip().lower()
    if not s:
        return None, None
    m = re.search(r"(\d{1,2})\s*(?:weeks?|w|周)", s)
    if m:
        weeks = int(m.group(1))
        d = re.search(r"(\d)\s*(?:days?|d|天)", s)
        days = int(d.group(1)) if d else 0
        if 0 <= weeks <= 45 and 0 <= days <= 6:
            return weeks, days
        return None, None
    m = re.fullmatch(r"(\d{1,2})", s)  # 只写数字 = 周
    if m:
        weeks = int(m.group(1))
        return (weeks, 0) if weeks <= 45 else (None, None)
    return None, None


def _map_sample_types(raw):
    """样本类型单元格 → (类型码列表, 未识别原值列表)
    一格可能写多种：'EDTA Blood, Bloodstains' → ['BLOOD', 'DBS']
    """
    if raw is None or str(raw).strip() == "":
        return ["BLOOD"], []          # 空 → 默认血液
    s = _to_text(raw)
    # 拆分：逗号 / 分号 / 顿号 / 竖线 / 斜杠 / 全角逗号 / and
    parts = [p for p in re.split(r"[,;、|/，]|\band\b", s) if p and p.strip()]
    codes, unknown = [], []
    for p in parts:
        key = _norm(p).rstrip(".")
        key = re.sub(r"\s*\(.*?\)", "", key).strip()   # 去掉括号补充说明
        code = SAMPLE_TYPE_EN_MAP.get(key) or SAMPLE_TYPE_ALIAS.get(key)
        if code is None:                               # 再试「包含」匹配（如 'bloodstain (cloth)'）
            for k, v in SAMPLE_TYPE_EN_MAP.items():
                if k and k in key:
                    code = v
                    break
        if code is None:
            unknown.append(p.strip())
        elif code not in codes:                        # 去重，保持顺序
            codes.append(code)
    if not codes:
        codes = ["BLOOD"]                              # 全都不认识 → 兜底血液
    return codes, unknown


def parse_vn_xlsx_bytes(data, fname="", sheet=None):
    """解析越南客户信息表 → (cases, errors)"""
    if isinstance(data, (bytes, bytearray)):
        import io
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    else:  # 传路径（便于本地单测）
        wb = openpyxl.load_workbook(data, data_only=True, read_only=True)

    ws = None
    if sheet:
        ws = wb[sheet]
    else:
        # 取第一张非空 sheet（越南表常带一张空 Sheet3）
        for s in wb.worksheets:
            if s.max_row and s.max_row >= 1 and s.max_column and s.max_column >= 1:
                if any(c.value not in (None, "") for row in s.iter_rows(min_row=1, max_row=min(s.max_row, 3)) for c in row):
                    ws = s
                    break
        if ws is None:
            ws = wb.worksheets[0]

    rows = [[c.value for c in r] for r in ws.iter_rows()]

    # ── 定位表头行：含 "alleged father" 的行 ──
    header_idx = None
    for i, r in enumerate(rows):
        if any(HEADER_MARKER in _norm(c) for c in r):
            header_idx = i
            break
    if header_idx is None:
        raise NipptVnParseError(
            f"未找到表头行（需含 \"Alleged father's Name\" 列）：{fname}")
    headers = [_norm(c) for c in rows[header_idx]]

    def idx_of(name, nth=1, after=None):
        """按表头名找列号；nth=2 取第二次出现；after=在某列之后的范围内找"""
        start = 0
        if after is not None:
            start = after + 1
        hits = [i for i in range(start, len(headers))
                if headers[i] == name or (name and name in headers[i])]
        if len(hits) >= nth:
            return hits[nth - 1]
        return None

    i_father_nm = idx_of("alleged father's name") or idx_of("alleged father")
    i_sn = idx_of("s/n") or idx_of("sn") or 0
    i_mother_nm = idx_of("pregnant woman's name") or idx_of("pregnant")
    i_m_birth = idx_of("date of birth", 1)
    i_m_spec = idx_of("specimen type", 1)
    i_m_coll = idx_of("date of collection", 1)
    i_f_birth = idx_of("date of birth", 2) if i_father_nm is not None else None
    i_f_spec = idx_of("specimen type", 2) if i_father_nm is not None else None
    i_f_coll = idx_of("date of collection", 2) if i_father_nm is not None else None
    i_pay = idx_of("date of payment")
    i_rep = idx_of("date of report")
    i_gw = idx_of("gestational")
    i_remark = idx_of("remark")

    def get(row, i):
        if i is None or i >= len(row):
            return None
        return row[i]

    cases, errors = [], []
    for ri, r in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        if r is None or all(c in (None, "") for c in r):
            continue                      # 整行空 → 跳过（不计错误）
        mother = _to_text(get(r, i_mother_nm))
        father = _to_text(get(r, i_father_nm))
        if not mother and not father:
            errors.append({"row_no": ri, "error": "孕妇姓名与疑父姓名均为空"})
            continue

        f_types, f_unknown = _map_sample_types(get(r, i_f_spec))
        warnings = []
        if f_unknown:
            warnings.append(
                "疑父样本类型 %s 未识别，按血液处理" % "、".join("'%s'" % u for u in f_unknown))

        weeks, days = _parse_gestational(get(r, i_gw))
        if get(r, i_gw) not in (None, "") and weeks is None:
            warnings.append("孕周 %r 无法识别" % _to_text(get(r, i_gw)))

        # 备注：原 Remark + 出生年 + 付款日期（系统无对应字段）
        note_bits = []
        rm = _to_text(get(r, i_remark))
        if rm:
            note_bits.append(rm)
        m_birth, f_birth = _parse_year(get(r, i_m_birth)), _parse_year(get(r, i_f_birth))
        if m_birth or f_birth:
            note_bits.append("出生年：母%s/父%s" % (m_birth or "—", f_birth or "—"))
        pay = _to_text(get(r, i_pay))
        if pay:
            note_bits.append("付款日期：%s" % pay)

        cases.append({
            "row_no": ri,
            "mother_name": mother,
            "father_name": father,
            "father_sample_types": f_types,
            "external_id": _to_text(get(r, i_sn)),
            "applicant": FIXED_APPLICANT,
            "sales_person": FIXED_SALES_PERSON,
            "gestational_age_weeks": weeks,
            "gestational_age_days": days,
            "mother_collection_date": _to_text(get(r, i_m_coll)),
            "father_collection_date": _to_text(get(r, i_f_coll)),
            "expected_completion": _to_text(get(r, i_rep)),
            "notes": "；".join(note_bits),
            "type_warnings": warnings,
            "mother_specimen_raw": _to_text(get(r, i_m_spec)),   # 仅预览参考（母类型固定血液）
        })

    if not cases and not errors:
        raise NipptVnParseError(f"文件无有效数据行：{fname}")
    return cases, errors
