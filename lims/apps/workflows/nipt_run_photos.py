"""NIPT 实验流程（SampleRun）各模块实验照片的独立上传 / 删除。

背景（2026-10-13 香港报障复现）：
  照片原先以 base64 内联在 run 的 extraction_data / library_data / sequencing_data
  的 photos 数组里，前端每次保存都要 POST 整个 data（含全部照片，实测单张 3.9MB、
  library_data 合计 15.16MB）。后果有两个：
    1) 跨境弱网（香港→阿里云）上传 20~40 秒，用户看到「转半天」；
    2) 超过 Django 默认 DATA_UPLOAD_MAX_MEMORY_SIZE(2.5MB) → RequestDataTooBig → 400，
       前端误报「保存失败」。（复现：0.5MB→200、3MB→400、该 run 真实 15.16MB→400）

做法与 NIPPT 侧（cases/nippt_photos.py）一致：照片落盘为文件，JSON 里只存 URL：
  MEDIA_ROOT/nipt_workflow/<run_id>/<module>/<内容MD5><ext>
  URL: /media/nipt_workflow/<run_id>/<module>/<md5><ext>
  天然幂等（同内容 MD5 相同 → 不重复写）、按批次隔离、防路径穿越。

与 NIPPT 版的差异：NIPT 照片不区分女/男（无 side），改为区分模块 module。
"""

import hashlib
import os
import shutil

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

NAMESPACE = "nipt_workflow"
MODULES = ("extraction", "library", "sequencing")
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".gif"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 单张上限 10MB


def _safe_ext(name):
    ext = os.path.splitext(name or "")[1].lower()
    return ext if ext in ALLOWED_EXT else ".jpg"


def _media_root():
    return str(settings.MEDIA_ROOT)


def store_run_photo(module, run_id, uploaded):
    """落盘并返回对外 URL。同内容（MD5 相同）已存在时直接复用，不重复写。"""
    raw = uploaded.read()
    if not raw:
        raise ValueError("空文件")
    if len(raw) > MAX_PHOTO_BYTES:
        raise ValueError("单张照片超过 %dMB" % (MAX_PHOTO_BYTES // 1024 // 1024))

    md5 = hashlib.md5(raw).hexdigest()
    rel = "%s/%s/%s/%s%s" % (NAMESPACE, run_id, module, md5, _safe_ext(getattr(uploaded, "name", "")))
    abspath = os.path.join(_media_root(), rel)

    os.makedirs(os.path.dirname(abspath), exist_ok=True)
    if not os.path.exists(abspath):  # 幂等：同内容只写一次
        with open(abspath, "wb") as fh:
            fh.write(raw)

    return "%s%s" % (settings.MEDIA_URL, rel)


def delete_run_photo(module, run_id, name):
    """删除单张照片。返回 True=已删/本就不存在，False=路径非法。"""
    name = os.path.basename(str(name or ""))
    if not name:
        return False
    root = os.path.join(_media_root(), NAMESPACE, str(run_id), module)
    abspath = os.path.join(root, name)
    # 防路径穿越：父目录必须正好是该 run 该模块目录
    if os.path.realpath(os.path.dirname(abspath)) != os.path.realpath(root):
        return False
    try:
        os.remove(abspath)
    except FileNotFoundError:
        pass
    except IsADirectoryError:
        return False
    return True


def purge_run_photos(run_id):
    """删除该 run 的整个照片目录（删 run 时调用）。返回删除的文件数。"""
    base = os.path.join(_media_root(), NAMESPACE)
    target = os.path.join(base, str(run_id))
    # 防路径穿越：target 必须是 base 的直接子目录
    if os.path.realpath(os.path.dirname(target)) != os.path.realpath(base):
        return 0
    if not os.path.isdir(target):
        return 0
    count = sum(len(files) for _, _, files in os.walk(target))
    shutil.rmtree(target, ignore_errors=True)
    return count


class NiptRunPhotosMixin:
    """给 SampleRunViewSet 挂上照片接口。

    接口：
      POST   /runs/{id}/photos/    multipart: file, module=extraction|library|sequencing
                                   → {"url": "/media/nipt_workflow/<id>/<module>/<md5>.jpg", "module": ...}
      DELETE /runs/{id}/photos/?module=library&name=<file>          → 204
    """

    @action(detail=True, methods=["post", "delete"], url_path="photos",
            parser_classes=[MultiPartParser, FormParser])
    def photos(self, request, pk=None):
        """POST 上传一张照片；DELETE 删除一张照片。

        必须做成【单个 action 同时声明两种 method】：DRF 为每个 action 注册一条路由，
        若拆成两个 action（哪怕 url_path 相同），Django 只会命中排在前面的那条，
        另一种 method 会直接 405（NIPPT 侧踩过同样的坑）。
        """
        run = self.get_object()  # 复用 viewset 的权限与可见范围校验（含 site 过滤）

        if request.method == "DELETE":
            module = str(request.query_params.get("module", "") or "").lower()
            name = request.query_params.get("name", "")
            if module not in MODULES or not name:
                return Response({"error": "需要参数 module(extraction|library|sequencing) 与 name"},
                                status=status.HTTP_400_BAD_REQUEST)
            if not delete_run_photo(module, run.id, name):
                return Response({"error": "非法路径"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(status=status.HTTP_204_NO_CONTENT)

        module = str(request.data.get("module", "") or "").lower()
        if module not in MODULES:
            return Response({"error": "module 必须为 extraction / library / sequencing"},
                            status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"error": "缺少文件字段 file"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = store_run_photo(module, run.id, upload)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"url": url, "module": module})
