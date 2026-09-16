"""Extensions views — 泰国数据生成报告."""
import io
import re
import shutil
import zipfile

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from django.http import FileResponse

from .models import ThaiReportBatch
from .serializers import ThaiReportBatchDetailSerializer, ThaiReportBatchListSerializer
from .services import get_batch_dir, get_report_dir, run_generation


class ThaiReportBatchViewSet(viewsets.ModelViewSet):
    """泰国数据生成报告批次：创建（上传两文件生成）/ 列表 / 详情 / 删除 / 打包下载."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return ThaiReportBatch.objects.all()

    def get_serializer_class(self):
        if self.action == "list":
            return ThaiReportBatchListSerializer
        return ThaiReportBatchDetailSerializer

    def create(self, request, *args, **kwargs):
        name = str(request.data.get("name", "")).strip()
        patient_file = request.FILES.get("patient_file")
        result_file = request.FILES.get("result_file")

        if not name:
            return Response({"detail": "请填写批次名"}, status=status.HTTP_400_BAD_REQUEST)
        if not patient_file or not result_file:
            return Response({"detail": "请上传结果表和样本信息表两个文件"}, status=status.HTTP_400_BAD_REQUEST)
        if ThaiReportBatch.objects.filter(name=name).exists():
            return Response({"detail": "批次名 {} 已存在，请换一个名称".format(name)},
                            status=status.HTTP_400_BAD_REQUEST)

        batch = ThaiReportBatch.objects.create(
            name=name,
            patient_file=patient_file,
            result_file=result_file,
            created_by=request.user if request.user.is_authenticated else None,
        )

        try:
            run_generation(batch)
        except Exception as e:  # noqa: BLE001
            batch.status = "FAILED"
            batch.message = str(e)
            batch.save(update_fields=["status", "message"])
            return Response(ThaiReportBatchDetailSerializer(batch).data, status=status.HTTP_200_OK)

        batch.refresh_from_db()
        return Response(ThaiReportBatchDetailSerializer(batch).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        # 删除批次目录（报告 + summary）
        shutil.rmtree(str(get_batch_dir(instance.id)), ignore_errors=True)
        # 删除上传的两个文件（仅当未被其他批次引用时；这里批次名唯一，直接删）
        for f in (instance.patient_file, instance.result_file):
            try:
                if f and f.name:
                    f.storage.delete(f.name)
            except Exception:  # noqa: BLE001
                pass
        instance.delete()

    @action(detail=True, methods=["get"], url_path="source/(?P<which>patient|result)")
    def source(self, request, pk=None, which=None):
        # 下载批次上传的原始文件（patient=样本信息表 result=结果表），供后续复核
        import os as _os
        batch = self.get_object()
        f = batch.patient_file if which == "patient" else batch.result_file
        if not f or not f.name:
            return Response({"detail": "文件不存在"}, status=status.HTTP_404_NOT_FOUND)
        filename = _os.path.basename(f.name)
        filename = re.sub(r"_[A-Za-z0-9]{7}(\.[A-Za-z0-9]+)$", r"\1", filename)
        resp = FileResponse(f.open("rb"), as_attachment=True, filename=filename)
        resp["Content-Type"] = "application/octet-stream"
        return resp

    @action(detail=True, methods=["get"], url_path="items/(?P<item_id>[^/.]+)/report")
    def report(self, request, pk=None, item_id=None):
        # 单个样本报告下载（用于详情内预览）
        from .models import ThaiReportItem
        batch = self.get_object()
        try:
            item = ThaiReportItem.objects.get(id=item_id, batch=batch)
        except ThaiReportItem.DoesNotExist:
            return Response({"detail": "报告不存在"}, status=status.HTTP_404_NOT_FOUND)
        if item.status != "OK" or not item.report_file:
            return Response({"detail": "该样本没有报告文件"}, status=status.HTTP_404_NOT_FOUND)
        f = get_report_dir(batch.id) / item.report_file
        if not f.exists():
            return Response({"detail": "文件缺失"}, status=status.HTTP_404_NOT_FOUND)
        resp = FileResponse(open(str(f), "rb"), as_attachment=False, filename=item.report_file)
        resp["Content-Type"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return resp

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """打包下载该批次的全部报告（zip：docx + summary.csv）。"""
        batch = self.get_object()
        report_dir = get_report_dir(batch.id)
        if not report_dir.exists() or not any(report_dir.glob("*.docx")):
            return Response({"detail": "该批次没有可下载的报告"}, status=status.HTTP_404_NOT_FOUND)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(report_dir.glob("*.docx")):
                zf.write(str(f), f.name)
            summary = get_batch_dir(batch.id) / "{}-report_summary.csv".format(batch.name)
            if summary.exists():
                zf.write(str(summary), summary.name)
        buf.seek(0)

        resp = FileResponse(buf, as_attachment=True,
                            filename="{}-reports.zip".format(batch.name))
        resp["Content-Type"] = "application/zip"
        return resp
