"""NIPPT 各模块实验照片的独立上传 / 删除 / 清理。

背景：原先把照片以 base64 内联进批次 JSON（processing_data / extraction_data /
library_data）的 photos_female / photos_male 数组，导致每次「保存全部」都要重传
全部照片（10 张 ≈ 3MB）。跨境弱网下会超过前端 axios 超时而中断上传，nginx 返回
400，前端误报「保存失败」。

本模块把照片改为「文件 + URL」：
  MEDIA_ROOT/<namespace>/<batch_id>/<side>/<内容MD5><ext>
  对外 URL：/media/<namespace>/<batch_id>/<side>/<md5><ext>

设计要点（对齐系统已有约定 cases/receipts、samples/upload-image）：
  * 文件名用内容 MD5 → 天然幂等去重，重复上传/重复迁移不产生垃圾文件
  * 只白名单后缀，客户端文件名不参与拼路径（防路径穿越）
  * 删除/清理做 realpath 校验，只允许操作该批次自己的目录
"""

import hashlib
import os
import shutil

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".gif"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 单张上限 10MB
SIDES = ("f", "m")


def _safe_ext(name):
    ext = os.path.splitext(name or "")[1].lower()
    return ext if ext in ALLOWED_EXT else ".jpg"


def _media_root():
    return str(settings.MEDIA_ROOT)


def store_nippt_photo(namespace, batch_id, side, uploaded):
    """落盘并返回对外 URL。同内容（MD5 相同）已存在时直接复用，不重复写。"""
    raw = uploaded.read()
    if not raw:
        raise ValueError("空文件")
    if len(raw) > MAX_PHOTO_BYTES:
        raise ValueError("单张照片超过 %dMB" % (MAX_PHOTO_BYTES // 1024 // 1024))

    md5 = hashlib.md5(raw).hexdigest()
    rel = "%s/%s/%s/%s%s" % (namespace, batch_id, side, md5, _safe_ext(getattr(uploaded, "name", "")))
    abspath = os.path.join(_media_root(), rel)

    os.makedirs(os.path.dirname(abspath), exist_ok=True)
    if not os.path.exists(abspath):  # 幂等：同内容只写一次
        with open(abspath, "wb") as fh:
            fh.write(raw)

    return "%s%s" % (settings.MEDIA_URL, rel)


def delete_nippt_photo(namespace, batch_id, side, name):
    """删除单张照片。返回 True=已删/本就不存在，False=路径非法。"""
    name = os.path.basename(str(name or ""))
    if not name:
        return False
    root = os.path.join(_media_root(), namespace, str(batch_id), side)
    abspath = os.path.join(root, name)
    # 防路径穿越：父目录必须正好是该批次的 side 目录
    if os.path.realpath(os.path.dirname(abspath)) != os.path.realpath(root):
        return False
    try:
        os.remove(abspath)
    except FileNotFoundError:
        pass
    except IsADirectoryError:
        return False
    return True


def purge_nippt_photos(namespace, batch_id):
    """删除该批次的整个照片目录（删批次时调用）。返回删除的文件数。"""
    base = os.path.join(_media_root(), namespace)
    target = os.path.join(base, str(batch_id))
    # 防路径穿越：target 必须是 base 的直接子目录
    if os.path.realpath(os.path.dirname(target)) != os.path.realpath(base):
        return 0
    if not os.path.isdir(target):
        return 0
    count = sum(len(files) for _, _, files in os.walk(target))
    shutil.rmtree(target, ignore_errors=True)
    return count


class NipptPhotosMixin:
    """给 NIPPT 批次 ViewSet 挂上照片接口。

    用法：class XxxViewSet(NipptPhotosMixin, viewsets.ModelViewSet):
              photos_namespace = "nippt_library"

    接口：
      POST   /<route>/{id}/photos/            multipart: file, side=f|m   → {"url": ...}
      DELETE /<route>/{id}/photos/?side=f&name=<file>                     → 204
    """

    photos_namespace = "nippt_photos"

    @action(detail=True, methods=["post", "delete"], url_path="photos",
            parser_classes=[MultiPartParser, FormParser])
    def photos(self, request, pk=None):
        """POST 上传一张照片；DELETE 删除一张照片。

        必须做成【单个 action 同时声明两种 method】：DRF 为每个 action 注册一条路由，
        若拆成两个 action（哪怕 url_path 相同），Django 只会命中排在前面的那条，
        另一种 method 会直接 405（本次踩过）。
        """
        batch = self.get_object()  # 复用 viewset 的权限与可见范围校验

        if request.method == "DELETE":
            side = str(request.query_params.get("side", "") or "").lower()
            name = request.query_params.get("name", "")
            if side not in SIDES or not name:
                return Response({"error": "需要参数 side(f|m) 与 name"},
                                status=status.HTTP_400_BAD_REQUEST)
            if not delete_nippt_photo(self.photos_namespace, batch.id, side, name):
                return Response({"error": "非法路径"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(status=status.HTTP_204_NO_CONTENT)

        side = str(request.data.get("side", "") or "").lower()
        if side not in SIDES:
            return Response({"error": "side 必须为 f 或 m"}, status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"error": "缺少文件字段 file"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = store_nippt_photo(self.photos_namespace, batch.id, side, upload)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"url": url, "side": side})
