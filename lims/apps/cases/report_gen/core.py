#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NIPPT 报告生成 —— 公共核心

设计：数据源(Source) → 上下文(context dict) → 渲染(Renderer)
  - 本地/离线：source_offline.OfflineSource（读 xlsx + 目录里的 .last）
  - 服务器：  source_db.DbSource（读数据库 + 库里存的 .last）
两种数据源产出**同样形状的行字典**，渲染层完全共用。

本文件只放三渠道共用的东西：附表解析/匹配、结果口径、日期格式。
"""
import glob
import os
import re
from datetime import date, datetime

# ────────────────────────── 结果口径 ──────────────────────────
# 报告正文用 Y/N；LIMS 里存 INCLUSION/EXCLUSION/''；xlsx 里写 支持/不支持
RESULT_TO_YN = {"支持": "Y", "不支持": "N", "INCLUSION": "Y", "EXCLUSION": "N"}


def norm_result(v):
    """任意来源的结果 → 'Y' / 'N' / 原样（'O' 等）。空值返回 ''。"""
    if v is None:
        return ""
    s = str(v).strip()
    if s == "":
        return ""
    return RESULT_TO_YN.get(s, s)


def is_reportable(result_yn):
    """是否该出报告：只有 Y/N 才出；空白/INCONCLUSIVE/临界一律不出。"""
    return result_yn in ("Y", "N")


# ────────────────────────── .last 附表 ──────────────────────────
# 国内表头：编号/染色体/母本基因型/胎儿基因型/父本基因型/是否匹配/position
# 巴西·海外表头：NO./Chromosome/Maternal genotype/.../Match or Mismatch/position
# 统一解析成 7 个键：NO/chr/ma/fe/pa/match/position（与两份老脚本一致）
APPENDIX_COLS = ["NO", "chr", "ma", "fe", "pa", "match", "position"]

# match 列的取值可能是中文（匹配/错配）或英文（Match/Mismatch）
MATCH_YN = {"匹配": "Match", "错配": "Mismatch", "Match": "Match", "Mismatch": "Mismatch"}


def parse_appendix(path):
    """解析 .last 位点附表 → list[dict]（跳过表头行）。"""
    rows = []
    with open(path, "r", encoding="utf-8-sig", errors="ignore") as fh:
        for i, line in enumerate(fh):
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            if i == 0:  # 表头
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                parts = line.split()  # 兜底：空白分隔
            if len(parts) < 7:
                continue
            rec = dict(zip(APPENDIX_COLS, [p.strip() for p in parts[:7]]))
            rec["match"] = MATCH_YN.get(rec["match"], rec["match"])
            rows.append(rec)
    return rows


def pt_prefix_of(code):
    """从 'PT71838' / 'PT71838H' / 'WJPT71838' 里取 'PT71838'。"""
    m = re.search(r"PT\d+", str(code or ""))
    return m.group(0) if m else ""


def pt_suffix_of(code, default="H"):
    """取 PT 号后面的字母段（H/HA/HB…），没有则补默认 H。

    返回 (suffix, suffix_upper)：单字母保持原样（H），多字母转大写（HA/HB）。
    """
    m = re.search(r"PT\d+(\D.*)", str(code or ""))
    suffix = m.group(1) if m else default
    suffix = suffix and suffix.strip() or ""
    if not suffix:
        suffix = default
    if not suffix.startswith("H"):
        suffix = "H" + suffix
    suffix_upper = suffix.upper() if len(suffix) > 1 else suffix
    return suffix, suffix_upper


def find_appendix(samples_code, search_dir=".", kind="unif"):
    """按 PT 号 + 后缀 + '.unif' 找附表文件。

    与老脚本一致：`*PT71838H.unif*last`（kind='unif'）
    返回 (文件路径 或 None, 匹配到的文件列表)。
    """
    prefix = pt_prefix_of(samples_code)
    if not prefix:
        return None, []
    _, suffix_upper = pt_suffix_of(samples_code)
    pattern = "*" + prefix + suffix_upper + "." + kind + "*last"
    hits = sorted(glob.glob(os.path.join(search_dir, pattern)))
    if len(hits) == 1:
        return hits[0], hits
    return None, hits


def check_consistency(result_yn, posi):
    """结果与附表首行是否一致：Y↔Match、N↔Mismatch。返回 (ok, posi_match)。"""
    if not posi:
        return False, ""
    first = posi[0].get("match", "")
    ok = (result_yn == "Y" and first == "Match") or (result_yn == "N" and first == "Mismatch")
    return ok, first


# ────────────────────────── 性别推算 ──────────────────────────
SEX_M_THRESHOLD = 0.00003  # 用户规则：>0.00003 → M；=0 → F；之间 → uncertain


def fetal_sex_from_y_ratio(mother_y_ratio):
    """用母亲样本的 mother_y_ratio 推算胎儿性别。

    >0.00003 → 'M'；恰好 0（或缺失/负）→ 'F'；0<v<=0.00003 → 'uncertain'（临界）。
    临界不出性别报告（模板只有 M/F 分支，且 {{fetal_gender}} 各语言用词不同）。
    """
    if mother_y_ratio is None or mother_y_ratio == "":
        return ""
    try:
        v = float(mother_y_ratio)
    except (TypeError, ValueError):
        return ""
    if v > SEX_M_THRESHOLD:
        return "M"
    if v == 0:
        return "F"
    return "uncertain"


# ────────────────────────── 样本类型多语言 ──────────────────────────
# 报告「样本类型」取【该配对实际使用的父方样本】的 CaseSample.sample_source，
# 再按报告版本语言化（用户 2026-10-13 确认；译表已核对）。
# 简中列直接用 CaseSample.SampleSource 自带 choices 的措辞，不是另编一套。
SAMPLE_SOURCE_I18N = {
    "BLOOD":      {"zh": "血液",   "zh-Hant": "血液",     "en": "Blood",          "th": "เลือด",                "pt": "Sangue"},
    "DBS":        {"zh": "血痕",   "zh-Hant": "血痕",     "en": "Blood stain",    "th": "คราบเลือด",             "pt": "Mancha de sangue"},
    "NAIL":       {"zh": "指甲",   "zh-Hant": "指甲",     "en": "Nail",           "th": "เล็บ",                  "pt": "Unha"},
    "SWAB":       {"zh": "口拭子", "zh-Hant": "口腔拭子", "en": "Buccal swab",    "th": "สำลีเก็บเซลล์ช่องปาก",   "pt": "Swab bucal"},
    "HAIR":       {"zh": "毛发",   "zh-Hant": "毛髮",     "en": "Hair",           "th": "เส้นผม",                "pt": "Cabelo"},
    "TOOTHBRUSH": {"zh": "牙刷",   "zh-Hant": "牙刷",     "en": "Toothbrush",     "th": "แปรงสีฟัน",             "pt": "Escova de dentes"},
    "SEMSTAIN":   {"zh": "精斑",   "zh-Hant": "精斑",     "en": "Semen stain",    "th": "คราบอสุจิ",             "pt": "Mancha de sêmen"},
    "CIGARETTE":  {"zh": "烟头",   "zh-Hant": "煙蒂",     "en": "Cigarette butt", "th": "ก้นบุหรี่",              "pt": "Bituca de cigarro"},
    "BOTTLE":     {"zh": "水瓶",   "zh-Hant": "水瓶",     "en": "Water bottle",   "th": "ขวดน้ำ",                "pt": "Garrafa de água"},
    "BEARD":      {"zh": "胡须",   "zh-Hant": "鬍鬚",     "en": "Beard hair",     "th": "หนวดเครา",              "pt": "Pelos de barba"},
    "FLOSS":      {"zh": "牙线",   "zh-Hant": "牙線",     "en": "Dental floss",   "th": "ไหมขัดฟัน",             "pt": "Fio dental"},
    "GUM":        {"zh": "口香糖", "zh-Hant": "口香糖",   "en": "Chewing gum",    "th": "หมากฝรั่ง",             "pt": "Chiclete"},
    "SEMEN":      {"zh": "精液",   "zh-Hant": "精液",     "en": "Semen",          "th": "น้ำอสุจิ",              "pt": "Sêmen"},
}

# 报告版本 → 该版本模板里「样本类型」使用的语言
# （法语/意大利/西班牙/德语/英文-美 的模板不含此字段，未列出即默认 en）
# ⚠️ 泰国模板全文是英文（nippt_tai_template.docx），样本类型必须用 en；
#    曾误配 "th" → 同一份报告里女性行 Blood、男性行 เลือด（2026-10-19 修正）
SAMPLE_LANG_BY_VERSION = {
    "国内": "zh", "英繁": "zh-Hant", "泰国": "en", "巴西": "pt",
    "英文": "en", "加纳": "en", "印度": "en", "澳洲": "en", "澳大利亚": "en", "英文-美": "en",
}


def localize_sample_source(code, report_version=""):
    """sample_source 编码 → 按报告版本语言化的文本；未知编码原样返回（不臆造译法）。"""
    if not code:
        return ""
    code = str(code).strip().upper()
    lang = SAMPLE_LANG_BY_VERSION.get((report_version or "").strip(), "en")
    row = SAMPLE_SOURCE_I18N.get(code)
    if not row:
        return code
    return row.get(lang) or row.get("en") or code


# ────────────────────────── 多语言日期 ──────────────────────────
FRENCH_MONTHS = {1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril", 5: "Mai", 6: "Juin",
                 7: "Juillet", 8: "Août", 9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre"}
SPANISH_MONTHS = {1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
                  7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"}
ITALIAN_MONTHS = {1: "Gennaio", 2: "Febbraio", 3: "Marzo", 4: "Aprile", 5: "Maggio", 6: "Giugno",
                  7: "Luglio", 8: "Agosto", 9: "Settembre", 10: "Ottobre", 11: "Novembre", 12: "Dicembre"}
GERMAN_MONTHS = {1: "Januar", 2: "Februar", 3: "März", 4: "April", 5: "Mai", 6: "Juni",
                 7: "Juli", 8: "August", 9: "September", 10: "Oktober", 11: "November", 12: "Dezember"}

MONTHS_BY_LANG = {"fr": FRENCH_MONTHS, "es": SPANISH_MONTHS, "it": ITALIAN_MONTHS, "de": GERMAN_MONTHS}

# 附表 match 列的各语言写法
MATCH_WORD = {
    "zh": {"Match": "匹配", "Mismatch": "錯配"},          # 繁体（英繁模板）
    "fr": {"Match": "correspondance", "Mismatch": "Non-correspondance"},
    "it": {"Match": "Corrispondenza", "Mismatch": "Non Corrispondenza"},
    "es": {"Match": "Coincidencia", "Mismatch": "Discrepancia"},
    "de": {"Match": "Übereinstimmung", "Mismatch": "Nichtübereinstimmung"},
    "pt": {"Match": "Positivo", "Mismatch": "Negativo"},   # 巴西
}


def fmt_date(d, fmt):
    """日期 → 指定格式（非日期原样返回）。"""
    if isinstance(d, datetime):
        return d.strftime(fmt)
    if isinstance(d, date):
        return d.strftime(fmt)
    return d


def fmt_date_lang(d, lang):
    """日期 → 德/法/意/西语的 '日 月 年'。"""
    if not isinstance(d, (datetime, date)):
        return d
    months = MONTHS_BY_LANG.get(lang)
    if not months:
        return d
    month = months[d.month]
    if lang == "es":
        return "%d de %s de %d" % (d.day, month, d.year)
    return "%d %s %d" % (d.day, month, d.year)


def translate_posi(posi, lang):
    """把附表的 Match/Mismatch 翻成对应语言（原地改并返回）。"""
    words = MATCH_WORD.get(lang)
    if not words:
        return posi
    for r in posi:
        r["match"] = words.get(r["match"], r["match"])
    return posi
