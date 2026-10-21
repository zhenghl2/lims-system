#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
报告生成服务层（服务器用）

职责：把「生信配对 NipptBioinfoPair」渲染成报告文件。
- 数据来源：source_db.build_row()（直接读库）
- 附表来源：pair.appendix_file（生信模块上传的 .last）
- 模板：report_gen/templates/<渠道>/
- 结果：写入 pair.report_file，旧文件进 pair.report_history（不丢历史）

对外只暴露两个函数：
    render_pair(pair, out_dir)  -> (files, skipped_reason)
    generate_and_save(pair, out_dir, user) -> (files, skipped_reason)
"""
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:            # vendored 引擎用扁平 import
    sys.path.insert(0, _HERE)

import core                # noqa: E402
import render_br           # noqa: E402
import render_hk           # noqa: E402
import render_wj           # noqa: E402
import source_db           # noqa: E402

TEMPLATES_DIR = os.path.join(_HERE, "templates")
RENDERERS = {"wj": render_wj, "br": render_br, "hk": render_hk}


def channel_of(report_version):
    """报告版本 → 渠道（与卡点一致：国内/巴西各自渠道，其余走海外）。"""
    rv = (report_version or "").strip()
    if rv == "国内":
        return "wj"
    if rv == "巴西":
        return "br"
    return "hk"


def check_admittable(pair):
    """准入检查：返回 (ok, reason)。"""
    case = pair.case
    rv = (case.report_version or "").strip()
    if not rv:
        return False, "案例未填报告版本（请先在案例详情里补填）"
    if pair.result not in ("INCLUSION", "EXCLUSION"):
        return False, "生信结果为空或为亲缘临界（%s），不出报告" % (pair.result or "空")
    if not pair.appendix_file:
        return False, "缺少位点附表（.last），请先在生信模块上传"
    ch = channel_of(rv)
    if ch == "hk" and rv not in render_hk.TPL_BY_VERSION:
        return False, "海外报告版本 %r 暂不支持" % rv
    if ch == "hk" and render_hk.TPL_BY_VERSION.get(rv) is None:
        return False, "报告版本 %r 与渠道不匹配" % rv
    return True, ""


def render_pair(pair, out_dir):
    """渲染不落库（供试算/排障）。返回 (生成的文件名列表, 跳过原因)。"""
    ok, reason = check_admittable(pair)
    if not ok:
        return [], reason
    row = source_db.build_row(pair)
    rv = (pair.case.report_version or "").strip()
    ch = channel_of(rv)
    try:
        appendix_path = pair.appendix_file.path
    except (ValueError, NotImplementedError, OSError):
        return [], "附表文件不可读取（存储后端不支持本地路径？）"
    if not appendix_path or not os.path.exists(appendix_path):
        return [], "附表文件在磁盘上不存在"
    os.makedirs(out_dir, exist_ok=True)
    try:
        return RENDERERS[ch].render(row, appendix_path, os.path.join(TEMPLATES_DIR, ch), out_dir)
    except Exception as exc:                      # noqa: BLE001
        return [], "渲染异常: %s" % exc


def generate_and_save(pair, out_dir, user=None):
    """渲染并写回 report_file；旧文件进 report_history。"""
    files, reason = render_pair(pair, out_dir)
    if not files:
        return [], reason

    sex_saved = False
    main = os.path.join(out_dir, files[0])
    if not os.path.exists(main):
        return [], "渲染产物缺失：%s" % files[0]

    history = list(pair.report_history or [])
    if pair.report_file:
        try:
            history.append({
                "file": pair.report_file.name,
                "replaced_at": datetime.now().isoformat(timespec="seconds"),
                "by": getattr(user, "username", "") or "",
            })
        except Exception:                          # noqa: BLE001
            pass

    with open(main, "rb") as fh:
        pair.report_file.save(os.path.basename(main), fh, save=False)

    # 2026-10-21：额外报告（性别报告）也要落库 —— 原来只存 files[0]，性别报告被丢掉
    sex_file = next((f for f in files if "_sex" in str(f)), None)
    if sex_file:
        sex_path = sex_file if os.path.isabs(str(sex_file)) else os.path.join(out_dir, str(sex_file))
        if os.path.exists(sex_path):
            with open(sex_path, "rb") as fh:
                pair.report_file_sex.save(os.path.basename(sex_path), fh, save=False)
            sex_saved = True
    pair.report_history = history[-20:]            # 只留最近 20 条
    # 2026-10-13：重新生成 Word 后，若已有 PDF → 标记可能过期（保留不删，前端提示）
    _fields = ["report_file", "report_history", "updated_at"]
    if sex_saved:
        _fields.append("report_file_sex")
    if pair.report_file_pdf:
        pair.report_pdf_stale = True
        _fields.append("report_pdf_stale")
    pair.save(update_fields=_fields)
    return files, ""


def zip_files(files, out_dir, zip_path):
    """把生成的文件打包（供批量生成后一次性下载）。"""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            p = os.path.join(out_dir, f)
            if os.path.exists(p):
                z.write(p, os.path.basename(p))
    return zip_path
