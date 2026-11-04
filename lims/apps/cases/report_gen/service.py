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


def _save_storage_file(pair, field, src_path):
    """把 src_path 存进 pair.<field>；覆盖同名旧文件时先备份，失败可回滚。

    为什么先删旧文件：Django 的 Storage.get_available_name() 遇到同名会改名成
    xxx_<7位随机串>.docx（用户反馈过）。
    为什么先备份（2026-11-04）：删完再保存若失败（磁盘满/存储异常），旧文件就永久丢了，
    而 DB 仍指向它 → 报告 404 且不可恢复。这里把旧内容读进内存，失败时写回。
    """
    from django.core.files.base import ContentFile

    ff = getattr(pair, field)
    old_name = ff.name if ff else ""
    backup = None
    if old_name:
        try:
            with ff.storage.open(old_name, "rb") as fh:
                backup = fh.read()
        except Exception:                          # noqa: BLE001
            backup = None
        try:
            ff.delete(save=False)
        except Exception:                          # noqa: BLE001
            pass
    try:
        with open(src_path, "rb") as fh:
            getattr(pair, field).save(os.path.basename(src_path), fh, save=False)
    except Exception:
        if backup is not None and old_name:
            try:
                ff.storage.save(old_name, ContentFile(backup))
            except Exception:                      # noqa: BLE001
                pass
        raise


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
            # 2026-11-04：与「手动上传」统一结构（action/filename/prev_filename/at/…），
            # 原来写的是 {file, replaced_at, by} → 报告模块的「报告更新记录」显示 undefined
            from django.utils import timezone as _tz
            _new_name = os.path.basename(os.path.join(out_dir, files[0]))
            history.append({
                "action": "regenerate",
                "filename": _new_name,
                "prev_filename": os.path.basename(pair.report_file.name or ""),
                "format": "word",
                "by": getattr(user, "username", "") or "",
                "at": _tz.now().isoformat(),
                "size": os.path.getsize(main) if os.path.exists(main) else 0,
            })
        except Exception:                          # noqa: BLE001
            pass

    # 2026-11-03：覆盖同名旧文件前先删实体，避免 Django 自动加 _7位随机串
    # 2026-11-04：删前备份、失败回滚（见 _save_storage_file）
    _save_storage_file(pair, "report_file", main)

    # 2026-10-21：额外报告（性别报告）也要落库 —— 原来只存 files[0]，性别报告被丢掉
    sex_file = next((f for f in files if "_sex" in str(f)), None)
    if sex_file:
        sex_path = sex_file if os.path.isabs(str(sex_file)) else os.path.join(out_dir, str(sex_file))
        if os.path.exists(sex_path):
            _save_storage_file(pair, "report_file_sex", sex_path)
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
