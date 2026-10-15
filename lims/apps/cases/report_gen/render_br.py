#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
巴西亲子（主报告 + 性别报告）

忠实移植自 br_nippt_report.py：
  必填校验 = case_id/female_name/RG_F/ID do tubo-F/male_name/RG_M/ID do tubo-M/report_date/collection_date/received_date/FF/result
  附表     = 按 test_id 匹配 *.last
  FF       = 小数 ×100 保留两位 + %
  校验     = 结果(Y/N) 与附表首行 Match/Mismatch 一致
  附表语言 = Match → Positivo / Mismatch → Negativo
  输出     = Laudo - {case_id}_{Y/N} - {test_id}.docx
             Gender 列非空时额外出 Laudo - {case_id} - Sexagem Fetal.docx
"""
import os
import re

from docxtpl import DocxTemplate

from core import check_consistency, fmt_date, norm_result, parse_appendix, translate_posi

REQUIRED_COLS = ["case_id", "female_name", "RG_F", "ID do tubo-F", "male_name", "RG_M",
                 "ID do tubo-M", "report_date", "collection_date", "received_date", "FF", "result"]
DATE_COLS = ["report_date", "collection_date", "received_date"]
TPL_MAIN = "brazil_report_plt.docx"
TPL_SEX = "Laudo-Sexagem-tpl.docx"


def render(row, appendix_path, tpl_dir, out_dir="."):
    ctx = dict(row)

    missing = [k for k in REQUIRED_COLS if ctx.get(k) in (None, "")]
    if missing:
        return [], "缺少必填: %s" % ", ".join(missing)

    # FF → 百分比（小数 ×100，两位小数）
    try:
        ctx["FF"] = "%.2f%%" % (float(ctx["FF"]) * 100)
    except (TypeError, ValueError):
        return [], "FF 不是数字: %r" % ctx.get("FF")

    # 结果
    result = norm_result(ctx.get("result"))
    ctx["result"] = result

    # 附表
    if not appendix_path:
        return [], "未找到附表（*.last）"
    posi = parse_appendix(appendix_path)
    if not posi:
        return [], "附表为空"

    ok, first = check_consistency(result, posi)
    ctx["posi_match"] = first
    if not ok:
        return [], "结果(%s)与附表不一致（附表首行=%s）" % (result, first)

    # 日期 → DD/MM/YYYY
    for col in DATE_COLS:
        ctx[col] = fmt_date(ctx.get(col), "%d/%m/%Y")

    # case_id_s = case_id 里第一个数字开始的部分
    m = re.findall(r"\d.+", str(ctx["case_id"]))
    ctx["case_id_s"] = m[0] if m else str(ctx["case_id"])

    # 附表结论葡语化
    ctx["posi"] = translate_posi(posi, "pt")

    generated = []
    tpl = DocxTemplate(os.path.join(tpl_dir, TPL_MAIN))
    tpl.render(ctx)
    main_name = "Laudo - %s_%s - %s.docx" % (ctx["case_id"], ctx["result"], ctx["test_id"])
    tpl.save(os.path.join(out_dir, main_name))
    generated.append(main_name)

    # 性别报告（2026-10-13）：需「额外信息=是」（gender_info=Yes）；未填/No → 不出。
    # 兼容旧输入：没有该键时沿用原逻辑（Gender 列非空）。
    if ctx.get("gender_info", None) is None:
        _want_sex = bool(str(ctx.get("Gender", "") or "").strip())
    else:
        _want_sex = str(ctx.get("gender_info") or "").strip() == "Yes"
    if _want_sex:
        sex_tpl = DocxTemplate(os.path.join(tpl_dir, TPL_SEX))
        sex_tpl.render(ctx)
        sex_name = "Laudo - %s - Sexagem Fetal.docx" % ctx["case_id"]
        sex_tpl.save(os.path.join(out_dir, sex_name))
        generated.append(sex_name)

    return generated, None
