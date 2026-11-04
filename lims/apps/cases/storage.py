# -*- coding: utf-8 -*-
r"""NIPPT 报告文件存储：保留括号等可读字符。

Django 默认 get_valid_filename() 会清掉 [^-\w.] 以外的字符，
于是报告名 WJ...-Y(2026.11.03).docx 落盘会变成 WJ...-Y2026.11.03.docx。
用户 2026-11-03 确认：报告文件名要保留括号。
"""
import re

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible


@deconstructible
class NipptReportStorage(FileSystemStorage):
    """只放开括号（含全角），其余仍按 Django 规则清洗。"""

    def get_valid_name(self, name):
        s = str(name).strip().replace(" ", "_")
        s = re.sub(r"(?u)[^-\w.()（）]", "", s)
        # 与 Django 原生实现保持一致：清洗后不能是空名 / 当前目录 / 上级目录
        if s in {"", ".", ".."}:
            raise SuspiciousFileOperation("Could not derive file name from '%s'" % name)
        return s
