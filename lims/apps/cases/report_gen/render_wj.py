#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内亲子（WJ / WQ × 普通 / 代孕 = 4 个模板）

忠实移植自 VG_nippt_v2.py：
  模板选择 = 「编号」前两位是否 WQ + 「备注」是否以“代孕”开头
  附表     = 按「万基编号」的 PT 号 + 后缀(H/HA/HB) + .unif 匹配 *.last
  校验     = 结果(Y/N) 与附表首行 匹配/错配 必须一致，否则不出
  输出名   = WJ{万基编号}-{申请人}-{Y/N}(YYYY.MM.DD).docx（WQ 用「编号」）
"""
import os

from docxtpl import DocxTemplate

from core import (check_consistency, fmt_date, norm_result, parse_appendix,
                  translate_posi)

TEMPLATE_FILES = {
    ("WJ", False): "WJPT_template.docx",
    ("WJ", True): "WJPT_daiyun.docx",
    ("WQ", False): "WQ_template.docx",
    ("WQ", True): "WQ_daiyun.docx",
}
DATE_COLS = ["报告日期", "申请日期", "男士到样", "检测日期"]

# .last 解析出来的英文内部键 → 国内模板要的中文键
POSI_KEY_MAP = {"NO": "编号", "chr": "染色体", "ma": "母本基因型", "fe": "胎儿基因型",
                "pa": "父本基因型", "match": "是否匹配", "position": "position"}
MATCH_CN = {"Match": "匹配", "Mismatch": "错配"}


def _posi_cn(rec):
    """附表行转成国内模板要求的键名（并把 Match/Mismatch 还原成 匹配/错配）。"""
    d = {POSI_KEY_MAP.get(k, k): v for k, v in rec.items()}
    d["是否匹配"] = MATCH_CN.get(d.get("是否匹配"), d.get("是否匹配"))
    return d


def render(row, appendix_path, tpl_dir, out_dir="."):
    """返回 (生成的文件名列表, 跳过原因 或 None)。"""
    ctx = dict(row)
    code = str(ctx.get("万基编号", "") or "")
    if not code:
        return [], "缺少万基编号"
    sm_id_num = code[2:]
    wq_label = str(ctx.get("编号", "") or "")[:2]
    is_wq = wq_label == "WQ"

    # 检案号码 / sm_id_num
    app_date = ctx.get("申请日期")
    yyyymm = app_date.strftime("%Y%m") if hasattr(app_date, "strftime") else ""
    ctx["检案号码"] = "VGpt-" + yyyymm + "-" + sm_id_num
    ctx["sm_id_num"] = sm_id_num

    # 日期中文化
    for col in DATE_COLS:
        ctx[col] = fmt_date(ctx.get(col), "%Y年%m月%d日")

    # 结果 → Y/N/O
    result = norm_result(ctx.get("结果"))
    if result not in ("Y", "N"):
        result = "O" if not result else result
    ctx["result"] = result
    ctx["位点个数"] = ""

    # 输出名
    date_part = ctx.get("报告日期", "")
    # report_name_date 用报告日期的 (%Y.%m.%d) —— 老脚本在日期中文化之前算，这里用原始日期重算
    raw_report_date = row.get("报告日期")
    report_name_date = raw_report_date.strftime("(%Y.%m.%d)") if hasattr(raw_report_date, "strftime") else ""
    base_code = code
    if is_wq:
        parts = str(ctx.get("编号", "")).split("-")
        ctx["sm_id_num"] = parts[1] if len(parts) > 1 else sm_id_num
        base_code = str(ctx.get("编号", ""))
    out_name = "WJ%s-%s-%s%s.docx" % (base_code, ctx.get("申请人", ""), result, report_name_date)

    # 代孕判定
    notes = str(ctx.get("备注", "") or "")
    # 代孕判定：数据源给了 is_surrogacy（勾选 或 备注开头）就用它；离线源无该键 → 沿用备注规则
    is_daiyun = bool(ctx.get("is_surrogacy")) if "is_surrogacy" in ctx else (notes[:2] == "代孕")
    if is_daiyun and result == "N":
        return [], "代孕 + 不支持 → 按规则不出报告"

    # 附表
    posi = None
    if appendix_path:
        posi = parse_appendix(appendix_path)
    elif not is_daiyun:
        return [], "未找到附表（*.last）"

    if posi:
        ok, first = check_consistency(result, posi)
        if not ok:
            return [], "结果(%s)与附表不一致（附表首行=%s）" % (result, first)
        # 国内模板用中文键名（i.编号 / i.染色体 / i.母本基因型 / i.胎儿基因型 / i.父本基因型 / i.是否匹配）
        ctx["posi"] = [_posi_cn(r) for r in posi]
        ctx["位点个数"] = len(posi)
    else:
        ctx["posi"] = None  # 代孕无附表：模板自身兼容

    tpl_name = TEMPLATE_FILES[("WQ" if is_wq else "WJ", is_daiyun)]
    tpl = DocxTemplate(os.path.join(tpl_dir, tpl_name))
    tpl.render(ctx)
    path = os.path.join(out_dir, out_name)
    tpl.save(path)
    return [out_name], None
