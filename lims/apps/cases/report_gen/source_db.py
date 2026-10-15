#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库数据源（服务器模式）—— 骨架

阶段二落地：脚本跑在服务器上（能 import django），直接从 LIMS 库取数，
不再需要导出 xlsx；附表 .last 从「生信模块上传后存的库/文件」里按 PT 号取。

当前状态：数据行的组装已按《docs/字段映射.md》实现；
        附表取数留 TODO（等 .last 存储方案定稿）。
"""
import os
from datetime import date as _date

# ⚠️ 只有服务器模式（gen_report.py --mode db）才会 import 本模块
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "lims.config.settings.base")

import django  # noqa: E402

django.setup()

from lims.apps.cases.models import Case, CaseSample, NipptBioinfoPair  # noqa: E402

# 报告版本 → 渠道
def channel_of(report_version):
    rv = (report_version or "").strip()
    if rv == "国内":
        return "wj"
    if rv == "巴西":
        return "br"
    return "hk"


def _cs_of(bioinfo_sample):
    """生信样本行 → 对应的业务 CaseSample。

    ⚠️ NipptBioinfoPair 没有 case_sample_ids；配对通过 mother_sample/father_sample 两个
    NipptBioinfoSample 外键关联，业务 id 存在生信样本行的 case_sample_ids 里。
    """
    if not bioinfo_sample or not bioinfo_sample.case_sample_ids:
        return None
    return (CaseSample.objects.filter(id=bioinfo_sample.case_sample_ids[0])
            .select_related("sample").first())


def _pair_case_samples(pair):
    """配对里的母亲/疑父 CaseSample。"""
    return _cs_of(pair.mother_sample), _cs_of(pair.father_sample)


def _pt_of(cs):
    return cs.test_sample_id if cs else ""


def case_client_id(case):
    """报告里的 case_id（客户编号）：优先母亲样本的 Sample.external_id，
    没有母亲（只登记男性）时取任一有值的样本 —— 与「只登记男性」修复的口径一致。"""
    qs = CaseSample.objects.filter(case=case).select_related("sample")
    for cs in qs:
        if cs.role == "MOTHER" and (cs.sample.external_id or ""):
            return cs.sample.external_id
    for cs in qs:
        if (cs.sample.external_id or ""):
            return cs.sample.external_id
    return ""


def build_row(pair):
    """NipptBioinfoPair → 报告渲染所需的行字典（键名与模板一致）。"""
    case = pair.case
    mother, father = _pair_case_samples(pair)
    ms = mother.sample if mother else None
    fs = father.sample if father else None
    rv = (case.report_version or "").strip()
    vg_id = _pt_of(mother)
    # 样本类型 = 【该配对实际使用的父方样本】的 sample_source，并按报告版本语言化
    # （2026-10-13 用户确认；此前取的是母亲 → 报告该栏恒为 血液/BLOOD，男性材质错）
    from core import localize_sample_source
    father_source = (father.sample_source if father else "") or ""
    sm_type = localize_sample_source(father_source, rv)

    # 结果：INCLUSION→支持 / EXCLUSION→不支持 / 空→''（不出报告）
    result_cn = {"INCLUSION": "支持", "EXCLUSION": "不支持"}.get(pair.result, "")
    result = result_cn

    # 胎儿性别：母亲样本的 y_ratio
    from core import fetal_sex_from_y_ratio
    sex = fetal_sex_from_y_ratio(getattr(pair, "mother_y_ratio", None))

    row = {
        # 通用
        "报告版本": rv,
        "result": result,          # 模板里判 Y/N 用（渲染器转换）
        "结果": result_cn,          # 国内模板正文/判断用中文（支持/不支持）
        "case_id": case_client_id(case),      # ✅ 已确认：母亲样本的 Sample.external_id
        "vg_id": vg_id,
        "test_id": vg_id,
        "万基编号": vg_id,
        "female_name": ms.patient_name if ms else "",
        "male_name": fs.patient_name if fs else "",
        "female_name2": ms.patient_name if ms else "",
        "male_name2": fs.patient_name if fs else "",
        "孕妇姓名": ms.patient_name if ms else "",
        "疑父姓名": fs.patient_name if fs else "",
        "sm_type": sm_type,
        "样本上机类型": sm_type,
        "father_sample_source": father_source,          # 原始编码（备用/排查）
        "collection_date": ms.collection_date if ms else None,
        "received_date": fs.receipt_date if fs else None,
        "男士到样": fs.receipt_date if fs else None,
        "女士到样": ms.receipt_date if ms else None,
        # 报告日期 = 生成报告当天（用户 2026-10-12 确认：实验室实际出报告的日子）
        "report_date": _date.today(),
        "报告日期": _date.today(),
        "检测日期": case.expected_completion,  # ✅ 已确认：Case.expected_completion
        "预计出报告时间": case.expected_completion,
        "due_date": case.expected_completion,
        "申请人": case.applicant,
        # 申请日期 = 登记时的值（用户 2026-10-12 确认）→ 案例创建（登记）日期
        "申请日期": case.created_at.date() if getattr(case, "created_at", None) else None,
        "备注": case.notes or "",
        # 代孕判定（与 Case.is_surrogacy 同口径）：渲染器优先用它，无此键时回退「备注开头」
        "is_surrogacy": bool(case.is_surrogacy()) if hasattr(case, "is_surrogacy") else ((case.notes or "")[:2] == "代孕"),
        "来源": case.origin_country() if hasattr(case, "origin_country") else "",
        "sales_department": case.origin_country() if hasattr(case, "origin_country") else "",
        "Agent": case.sales_person,
        "FF": getattr(ms, "fetal_fraction", None),
        "f_DOB": ms.patient_dob if ms else None,
        "m_DOB": fs.patient_dob if fs else None,
        "Date_of_Birth": ms.patient_dob if ms else None,
        "gender": sex,
        # 额外信息（2026-10-13）：案例管理基本信息里显示为 gender 的那项 → Yes 才出性别报告
        "gender_info": (case.mother_gender_info() if hasattr(case, "mother_gender_info") else ""),
        # 巴西专用
        "RG_F": getattr(ms, "id_card", "") if ms else "",
        "RG_M": getattr(fs, "id_card", "") if fs else "",
        "ID do tubo-F": getattr(ms, "tube_no", "") if ms else "",
        "ID do tubo-M": getattr(fs, "tube_no", "") if fs else "",
        "Price": getattr(ms, "price", "") if ms else "",
        "Sinal": getattr(ms, "sinal", "") if ms else "",
        "Balance": getattr(ms, "balance", "") if ms else "",
        "Client Telephone": case.phone,
        # 编号 = PT编号（用户 2026-10-12 确认）；国内模板用它判 WJ/WQ
        "编号": (case.pt_number or (ms.test_sample_id if ms else "") or case.case_number),
    }
    return row


class DbSource:
    """按案例/配对从数据库取报告行。"""

    def __init__(self, appendix_root=None):
        self.appendix_root = appendix_root  # TODO: 生信上传的 .last 存储根目录

    def rows(self, case_number=None, only_with_result=True):
        qs = NipptBioinfoPair.objects.select_related("case")
        if case_number:
            qs = qs.filter(case__case_number=case_number)
        out = []
        for pair in qs:
            if only_with_result and pair.result not in ("INCLUSION", "EXCLUSION"):
                continue  # 空白/INCONCLUSIVE 不出报告
            out.append(build_row(pair))
        return out

    def appendix(self, row):
        """按 PT 号取附表文件。

        TODO（阶段二）：改为从生信上传的存储里按 PT 号取；
        当前先在 appendix_root 下扫文件名，便于联调。
        """
        from core import find_appendix
        if not self.appendix_root:
            return None, []
        code = row.get("vg_id") or row.get("test_id") or row.get("万基编号")
        return find_appendix(code, self.appendix_root)
