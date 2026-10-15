#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海外亲子（11 种语言/地区 + 6 种性别报告）

忠实移植自 nippt_hk.py：
  **模板选择完全由「报告版本」列决定**（英文 / 英繁 / 泰国 / 法语 / 英文-美 /
  意大利 / 西班牙 / 德语 / 印度 / 澳洲 / 加纳）；报告版本为空或未知 → 不出报告。
  附表     = 按 万基编号(vg_id) 的 PT 号 + 后缀(H/HA/HB) + .unif 匹配 *.last
  校验     = 结果(Y/N) 与附表首行 Match/Mismatch 一致
  性别报告 = gender 列非空时出（英文/英繁/英文-美/印度/法/意/西/德 有对应模板）
"""
import os
import re

from docxtpl import DocxTemplate

from core import (SEX_M_THRESHOLD, check_consistency, fmt_date, fmt_date_lang,
                  norm_result, parse_appendix, pt_prefix_of, pt_suffix_of, translate_posi)

DATE_COLS = ["report_date", "collection_date", "received_date"]

# 报告版本 → 主模板（空/未知不出报告）
TPL_BY_VERSION = {
    "英文": "nippt_en_template.docx",
    "英繁": "nippt_tc_template.docx",
    "泰国": "nippt_tai_template.docx",
    "法语": "nippt_france_template-swabAF.docx",
    "英文-美": "nippt_us_template_swabAF.docx",
    "意大利": "nippt_italian_template-swabAF.docx",
    "西班牙": "nippt_spanish_template-swabAF.docx",
    "德语": "nippt_de_template-swabAF.docx",
    "印度": "nippt_in_template.docx",
    "澳洲": "nippt_au_template.docx",
    "澳大利亚": "nippt_au_template.docx",
    "加纳": "nippt_Ghana_template.docx",
    "巴西": None,   # 走巴西渲染器
    "国内": None,   # 走国内渲染器
}
# 报告版本 → (性别模板, {M: 词, F: 词}, 输出名后缀)
SEX_BY_VERSION = {
    "英文": ("Sexagem_Fetal_en_tpl.docx", {"M": "Male", "F": "Female"}, "sex"),
    "英繁": ("Sexagem_Fetal_en_tpl.docx", {"M": "Male", "F": "Female"}, "sex"),
    "英文-美": ("Sexagem_Fetal_us_en_tpl.docx", {"M": "Male", "F": "Female"}, "sex"),
    "印度": ("Sexagem_Fetal_en_tpl.docx", {"M": "Male", "F": "Female"}, "sex"),
    "法语": ("Sexagem_Fetal_fr_tpl.docx", {"M": "masculin", "F": "Féminin"}, "sex_fr"),
    "意大利": ("Sexagem_Fetal_it_tpl.docx", {"M": "Maschio", "F": "Femmina"}, "sex_it"),
    "西班牙": ("Sexagem_Fetal_es_tpl.docx", {"M": "Masculino", "F": "Femenino"}, "sex_es"),
    "德语": ("Sexagem_Fetal_de_tpl.docx", {"M": "Männlich", "F": "Weiblich"}, "sex_de"),
    "加纳": ("Sexagem_Fetal_Ghana_tpl.docx", {"M": "Male", "F": "Female"}, "sex_GHA"),
}
# 报告版本 → 附表 match 列语言
LANG_BY_VERSION = {"英繁": "zh", "法语": "fr", "意大利": "it", "西班牙": "es", "德语": "de"}
# 报告版本 → 日期语言
DATE_LANG_BY_VERSION = {"法语": "fr", "意大利": "it", "西班牙": "es", "德语": "de"}

# 各分支的输出名前缀
OUT_PREFIX = {
    "英文": "HK_report_EN_", "英繁": "HK_report_TC_", "泰国": "",
    "法语": "HK_report_FR_", "英文-美": "HK_report_US_", "意大利": "HK_report_IT_",
    "西班牙": "HK_report_ES_", "德语": "HK_report_DE_", "印度": "HK_report_IN_",
    "澳洲": "HK_report_AU_", "澳大利亚": "HK_report_AU_", "加纳": "HK_report_GHA_",
}
NAME_SUFFIX = {"法语": "_swab", "意大利": "_swab", "西班牙": "_swab"}


def render(row, appendix_path, tpl_dir, out_dir=".", sex_override=None):
    """sex_override：由 mother_y_ratio 推算出的 M/F/uncertain（不传则用 row 里的 gender）。"""
    ctx = dict(row)
    version = str(ctx.get("报告版本", "") or "").strip()
    if version not in TPL_BY_VERSION:
        return [], "报告版本为空或未支持: %r" % version
    if TPL_BY_VERSION[version] is None:
        return [], "报告版本 %r 应由对应渠道渲染器处理" % version

    vg_id = str(ctx.get("vg_id", "") or "")
    if not vg_id:
        return [], "缺少万基编号(vg_id)"
    ctx["pt_id"] = pt_prefix_of(vg_id)

    # 结果 + 一致性
    result = norm_result(ctx.get("result"))
    ctx["result"] = result
    if not appendix_path:
        return [], "未找到附表（*.last）"
    posi = parse_appendix(appendix_path)
    if not posi:
        return [], "附表为空"
    ok, first = check_consistency(result, posi)
    ctx["posi_match"] = first
    if not ok:
        return [], "结果(%s)与附表不一致（附表首行=%s）" % (result, first)

    ctx["位点个数"] = len(posi)
    # FF → 百分比（与老脚本 sample_info_toDict 一致；模板里 {{FF}} 显示 11.74%）
    if ctx.get("FF") not in (None, ""):
        try:
            ctx["FF"] = "%.2f%%" % (float(ctx["FF"]) * 100)
        except (TypeError, ValueError):
            pass
    date_short = ctx["collection_date"].strftime("%Y%m") if hasattr(ctx.get("collection_date"), "strftime") else ""

    # 展示用 ID（多数分支共用）
    _, suffix_upper = pt_suffix_of(vg_id)   # 已保证以 H 开头：H / HA / HB
    ctx["pt_suffix_upper"] = suffix_upper
    ctx["female_id"] = ctx["pt_id"] + "W"
    ctx["male_id"] = ctx["pt_id"] + suffix_upper
    ctx["report_id"] = "VGHK" + date_short + vg_id
    ctx["f_DOB"] = fmt_date(ctx.get("f_DOB"), "%Y/%m/%d")
    ctx["m_DOB"] = fmt_date(ctx.get("m_DOB"), "%Y/%m/%d")

    # 日期格式
    lang = DATE_LANG_BY_VERSION.get(version)
    for col in DATE_COLS:
        ctx[col] = fmt_date_lang(ctx.get(col), lang) if lang else fmt_date(ctx.get(col), "%d %B %Y")
    if version == "泰国":
        for col in ("f_DOB", "m_DOB"):
            ctx[col] = fmt_date(ctx.get(col), "%Y/%m/%d")
        ctx["test_id_date"] = "VGpt-" + date_short + "-" + vg_id
        m = re.findall(r"\d.+", str(ctx.get("case_id", "")))
        ctx["case_id_s"] = m[0] if m else str(ctx.get("case_id", ""))

    # 附表语言
    translate_posi(posi, LANG_BY_VERSION.get(version, ""))
    # 加纳：每个染色体只保留前 2 个位点
    # （与老脚本 pandas groupby('chr').head(2) 等价：按 chr 字符串排序分组，组内保持原顺序取前 2）
    if version == "加纳":
        # 等价于 pandas df.groupby("chr").head(2)：每个染色体取前 2 行，且**保持原始行序**
        # （pandas 的 groupby.head(n) 结果按原始顺序拼接，不是按分组键排序）
        seen, kept = {}, []
        for r in posi:
            k = str(r.get("chr", ""))
            seen[k] = seen.get(k, 0) + 1
            if seen[k] <= 2:
                kept.append(r)
        posi = kept
    ctx["posi"] = posi

    # 主报告（英繁 = 英文 + 繁体两份，与老脚本一致）
    ctx["posi"] = posi
    generated = []
    if version == "英繁":
        ctx["posi"] = parse_appendix(appendix_path)      # 未翻译副本 → 英文报告用 Match/Mismatch
        tpl = DocxTemplate(os.path.join(tpl_dir, TPL_BY_VERSION["英文"]))
        tpl.render(ctx)
        en_name = "%s%s-%s.docx" % (OUT_PREFIX["英文"], vg_id, result)
        tpl.save(os.path.join(out_dir, en_name))
        generated.append(en_name)
        translate_posi(ctx["posi"], "zh")                # 繁体报告用「匹配/錯配」
        tpl = DocxTemplate(os.path.join(tpl_dir, TPL_BY_VERSION["英繁"]))
        tpl.render(ctx)
        tc_name = "%s%s-%s.docx" % (OUT_PREFIX["英繁"], vg_id, result)
        tpl.save(os.path.join(out_dir, tc_name))
        generated.append(tc_name)
    else:
        tpl = DocxTemplate(os.path.join(tpl_dir, TPL_BY_VERSION[version]))
        tpl.render(ctx)
        if version == "泰国":
            main_name = "%s Report.docx" % ctx.get("case_id", "")
        else:
            main_name = "%s%s-%s%s.docx" % (OUT_PREFIX[version], vg_id, result, NAME_SUFFIX.get(version, ""))
        tpl.save(os.path.join(out_dir, main_name))
        generated.append(main_name)

    # 性别报告（2026-10-13）：需「额外信息=是」（gender_info=Yes）；未填/No → 不出。
    # 兼容旧输入：离线/文件源没有 gender_info 键时，沿用原有逻辑（按 y_ratio 的 M/F）。
    _gi = ctx.get("gender_info", None)
    if _gi is not None and str(_gi).strip() != "Yes":
        return generated, "额外信息未选「是」→ 不出性别报告"
    sex_val = sex_override if sex_override is not None else str(ctx.get("gender", "") or "").strip()
    if sex_val == "uncertain":
        return generated, "临界(uncertain)：未出性别报告"
    if sex_val in ("M", "F") and version in SEX_BY_VERSION:
        tpl_file, words, tag = SEX_BY_VERSION[version]
        ctx["fetal_gender"] = words[sex_val]
        sex_tpl = DocxTemplate(os.path.join(tpl_dir, tpl_file))
        sex_tpl.render(ctx)
        sex_name = "HK_report_%s_%s.docx" % (tag, vg_id)
        sex_tpl.save(os.path.join(out_dir, sex_name))
        generated.append(sex_name)

    return generated, None
