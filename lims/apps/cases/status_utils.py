# -*- coding: utf-8 -*-
"""NIPPT 案例管理列表：状态 / 进度的聚合口径（2026-11-21）

用户确认的口径：
1. 按「人」分组：母亲 1 组；每个疑父各 1 组。同一人的多个样本类型 / 重采(_R) / 重做(_T) 合并成一组。
2. 组内取**进度最快**的一份 —— 同一男性寄了血液+血痕、实际只做了一份时，不被另一份拖住。
   （案例 NIPPT-20261109-0021：血液已到报告草稿、血痕还停在提取 → 案例应显示报告草稿）
3. 组间取**最靠后**的组作为案例状态（男女在不同步骤时显示较后的那个）。
   报告必须男女一起出，所以不会出现「一方已出报告另一方没做完」的误显示。
4. 某个人**全部**样本类型都失败 → 案例仍显示「有失败」（红色，避免漏掉）。
5. 双疑父（H / HB）在列表里分别显示各自状态与进度条 → 前端读 progress_groups。

⚠️ 只给案例管理列表（CaseListSerializer）用。Case.computed_status、dashboard 卡片统计、
   签收页仍用原来的「最慢样本」口径，本次不动（用户 2026-11-21 明确范围）。
"""
import re

WORKFLOW_ORDER = [
    "REGISTERED", "RECEIVED", "PRE_PROCESSING", "EXTRACTION",
    "LIBRARY_PREP", "POOLING", "HYB_SEQ", "BIOINFO",
    "REPORT_DRAFT", "COMPLETED",
]
WORKFLOW_WEIGHT = {
    "REGISTERED": 5, "RECEIVED": 12,
    "PRE_PROCESSING": 22, "EXTRACTION": 35,
    "LIBRARY_PREP": 48, "POOLING": 58,
    "HYB_SEQ": 70, "BIOINFO": 82,
    "REPORT_DRAFT": 92, "COMPLETED": 100,
}

_SUFFIX_RE = re.compile(r"(_R\d+|_T\d+)+$", re.I)


def _base_stage(stage):
    """EXTRACTION_FAILED → EXTRACTION"""
    return stage[:-7] if stage.endswith("_FAILED") else stage


def _held(cs):
    """挂起的备用样本：不参与案例状态推导。"""
    return bool(getattr(cs, "is_backup", False)) and not getattr(cs, "backup_released", False)


def _person_key(cs):
    """同一个人 → 同一个 key。母亲恒为 W；疑父按 test_sample_id 去掉 _R/_T 后缀归一。"""
    if (cs.role or "") == "MOTHER":
        return "W"
    tid = (cs.test_sample_id or "").strip().upper()
    if tid:
        return _SUFFIX_RE.sub("", tid)
    name = (getattr(cs.sample, "patient_name", "") or "").strip()
    return "F-" + (name or str(cs.id))


def case_progress_groups(case_samples):
    """按人分组的进度明细。返回 list[dict]（母亲组 + 每个疑父组）。"""
    css = list(case_samples)
    if not css:
        return []
    active = [cs for cs in css
              if cs.is_active and cs.sample.status != "REJECTED" and not _held(cs)]
    if not active:
        active = [cs for cs in css if cs.sample.status != "REJECTED" and not _held(cs)]
    if not active:
        return []

    buckets = {}
    for cs in active:
        buckets.setdefault(_person_key(cs), []).append(cs)

    groups = []
    for key, rows in buckets.items():
        # 组内取「进度最靠后」的那一份；它是失败样本 → 该组算失败。
        #   只用「是否全部失败」判断会误判：血液 BIOINFO_FAILED + 血痕还没开工(PRE_PROCESSING)
        #   → 组内最靠后的是失败那次，案例必须显示「有失败」（NIPPT-20260921-0012）。
        #   反之 BIOINFO_FAILED + 另一份已跑到 COMPLETED → 最靠后的是成功那份，不算失败。
        best_key, best_stage, failed = (-1, 0), "REGISTERED", False
        for cs in rows:
            raw = cs.workflow_stage or "REGISTERED"
            base = _base_stage(raw)
            if base not in WORKFLOW_ORDER:
                base = "REGISTERED"
            idx = WORKFLOW_ORDER.index(base)
            is_failed = raw.endswith("_FAILED")
            # 同阶段时优先「成功」的那份
            k = (idx, 0 if is_failed else 1)
            if k > best_key:
                best_key, best_stage, failed = k, base, is_failed
        types = sorted({t for t in (cs.effective_sample_type for cs in rows) if t})
        groups.append({
            "key": key,
            "role": rows[0].role or "",
            "patient_name": rows[0].sample.patient_name or "",
            "stage": best_stage,
            "percent": WORKFLOW_WEIGHT.get(best_stage, 0),
            "failed": failed,
            "sample_types": types,
            "sample_ids": [str(cs.id) for cs in rows],
        })

    # 疑父标签：单个 → H；多个 → HA / HB / HC…（按 test_sample_id 排序，与管线命名一致）
    fathers = sorted([g for g in groups if g["role"] == "ALLEGED_FATHER"], key=lambda g: g["key"])
    for i, g in enumerate(fathers):
        g["label"] = ("H" + chr(65 + i)) if len(fathers) > 1 else "H"
    for g in groups:
        if g["role"] == "MOTHER":
            g["label"] = "W"
        elif g["role"] != "ALLEGED_FATHER":
            g["label"] = g["label"] if "label" in g else "—"
    # 母亲组排前面，疑父按标签排序
    order = {"W": 0}
    groups.sort(key=lambda g: (order.get(g["label"], 1) if g["role"] == "MOTHER" else 1, g["label"]))
    return groups


def case_progress_summary(case_samples):
    """→ (状态, 百分比, 分组明细)。状态优先级：全拒收 > 待签收重采 > 有失败 > 组间最靠后。"""
    css = list(case_samples)
    if not css:
        return "REGISTERED", 0, []
    if all(cs.sample.status == "REJECTED" for cs in css):
        return "REJECTED", 0, []
    held_ids = {cs.id for cs in css if _held(cs)}
    if any(cs.resample_of_id and cs.sample.status == "REGISTERED" and cs.id not in held_ids
           for cs in css):
        groups = case_progress_groups(css)
        return "HAS_RESAMPLE", max([g["percent"] for g in groups] or [0]), groups
    groups = case_progress_groups(css)
    if not groups:
        return "REGISTERED", 0, []
    percent = max(g["percent"] for g in groups)
    if any(g["failed"] for g in groups):
        return "HAS_FAILURE", percent, groups
    top = max(groups, key=lambda g: WORKFLOW_ORDER.index(g["stage"]))
    return top["stage"], percent, groups
