"""泰国数据生成报告 — 生成服务.

移植自 report_by_batch.py（report_by_batch 脚本逻辑），核心函数保持一致：
- 读表（自动识别分隔符）→ SampleID 匹配 → ResultFilter 过滤 → 模板选择 → docxtpl 渲染。
- 服务器端运行，报告输出到 media/extensions/thai_report/<batch_id>/reports/。
"""
import csv
import io
import os
import re
from datetime import datetime
from pathlib import Path

from django.conf import settings

from .models import ThaiReportBatch, ThaiReportItem

# ── 配置 ──────────────────────────────────────────────
TEMPLATES = {
    "national": "Report_B-NIPT_tmp.docx",
    "basic": "Test_Report-Low_risk_basic_tpl_style_summary.docx",
    "twin": "Test_Report-Low_risk_basic_twin_tpl_style_summary.docx",
    "plus": "Test_Report-Low_risk_plus_tpl_style_summary.docx",
    "basic_all": "Test_Report-Low_risk_basic_all_tpl_style_summary.docx",
}

NATIONAL_PREFIX = "GV-NIPT"

PLUS_ITEMS = ["NIPT_P{}".format(str(i).zfill(3)) for i in range(1, 94)]
BASIC_ITEMS = ["T21", "T18", "T13", "XO", "XXX", "XXY", "XYY"]
ZSCORE_ITEMS = ["Zscore21", "Zscore18", "Zscore13"]
ALL_CHROM_ITEMS = ["T{}".format(i) for i in range(1, 23) if i not in (13, 18, 21)]

THAI_HIGH_RISK = "ความเสี่ยงสูง"
THAI_LOW_RISK = "ความเสี่ยงต่ำ"
THAI_NO_RESULT = "ไม่มีข้อมูล"

NOCALL_THAI = {
    "limitation": "ไม่สามารถรายงานผลได้ เนื่องจากข้อจำกัดของการทดสอบ แนะนําให้เก็บสิ่งส่งตรวจอีกครั้งเพื่อตรวจซ้ำ",
    "gc": "ไม่สามารถรายงานผลได้ เนื่องจากคุณภาพของสิ่งส่งตรวจไม่ผ่านเกณฑ์มาตราฐานของการวิเคราะห์ผล แนะนําให้เก็บสิ่งส่งตรวจอีกครั้งเพื่อตรวจซ้ำ",
    "lowff": "ไม่สามารถรายงานผลได้ เนื่องจากปริมาณดีเอ็นเอของทารกในสิ่งส่งตรวจไม่เพียงพอ หรือมีปัจจัยอื่นร่วมด้วย สาเหตุอาจเกิดจาก อายุครรภ์ น้ำหนักมารดา หรือยาบางชนิด แนะนําให้เก็บสิ่งส่งตรวจอีกครั้งเพื่อตรวจซ้ำ",
}

CHROM_TO_THAI_NUM = {
    "T21": "21", "T18": "18", "T13": "13",
    "XO": "X(XO)", "XXX": "X(XXX)", "XXY": "X(XXY)", "XYY": "X(XYY)",
}


def get_template_dir():
    """模板目录：media/extensions/thai_report_templates/"""
    return Path(settings.MEDIA_ROOT) / "extensions" / "thai_report_templates"


def get_batch_dir(batch_id):
    """批次工作目录：media/extensions/thai_report/<batch_id>/"""
    return Path(settings.MEDIA_ROOT) / "extensions" / "thai_report" / str(batch_id)


def get_report_dir(batch_id):
    return get_batch_dir(batch_id) / "reports"


# ── 读表 ──────────────────────────────────────────────
def read_table(file_path):
    """读取表格（txt/csv），自动识别分隔符，全部按字符串处理。"""
    with open(file_path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        first_line = f.readline()
    sep = "\t" if first_line.count("\t") > first_line.count(",") else ","

    with open(file_path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=sep)
        rows = []
        for row in reader:
            clean = {}
            for k, v in row.items():
                if k is None:
                    continue
                key = str(k).strip()
                val = v if isinstance(v, str) else (str(v) if v is not None else "")
                clean[key] = val.strip()
            if any(v for v in clean.values()):
                rows.append(clean)
    return rows


def get_sample_column(column_names, default="SampleID"):
    for col in column_names:
        norm = col.lower().replace(" ", "").replace("_", "")
        if norm in ("sampleid", "sample"):
            return col
    if default in column_names:
        return default
    raise ValueError("cannot find SampleID column, columns: {}".format(list(column_names)))


# ── 校验（原 check_plus_result）────────────────────────
def check_plus_result(sample, strict=True):
    """校验并补全 plus 结果，返回 (错误信息 or None)。"""
    sample_id = sample.get("SampleID", "")

    for z_item, chrom in zip(ZSCORE_ITEMS, ["T21", "T18", "T13"]):
        z_value = str(sample.get(z_item, "")).strip()
        chrom_value = str(sample.get(chrom, "")).strip()
        z_is_na = z_value == "N/A"
        chrom_is_no_result = chrom_value == "No Result"
        if z_is_na != chrom_is_no_result:
            msg = "{} = '{}' but {} = '{}' , N/A and No Result must appear together".format(
                z_item, z_value, chrom, chrom_value)
            if strict:
                raise ValueError("{} Error: {}".format(sample_id, msg))
            return msg

    plus_result = str(sample.get("plus_result", "")).strip().lower()
    high_risk_items_raw = str(sample.get("plus_highrisk_items", "")).strip()

    if plus_result == "no result":
        sample.update({item: "No Result" for item in PLUS_ITEMS})
    elif plus_result == "low risk":
        sample.update({item: "Low Risk" for item in PLUS_ITEMS})
        if high_risk_items_raw:
            msg = "plus_result is 'Low Risk' but plus_highrisk_items is '{}'".format(high_risk_items_raw)
            if strict:
                raise ValueError("{} Error: {}".format(sample_id, msg))
            return msg
    elif plus_result == "high risk":
        if not high_risk_items_raw:
            msg = "plus_result is 'High Risk' but plus_highrisk_items is empty"
            if strict:
                raise ValueError("{} Error: {}".format(sample_id, msg))
            return msg
        sample.update({item: "Low Risk" for item in PLUS_ITEMS})
        high_risk_items = [item.strip() for item in re.split(r"[,，]", high_risk_items_raw) if item.strip()]
        unknown = [item for item in high_risk_items if item not in PLUS_ITEMS]
        if unknown:
            return "unknown plus_highrisk_items: {}".format(",".join(unknown))
        sample.update({item: "High Risk" for item in high_risk_items})
    return None


# ── 上下文构建 ────────────────────────────────────────
def convert_date(value, to_buddhist=False):
    """支持 '10 Apr 2026' 与 '04-08-2026'，国家项目报告转佛年。"""
    if not value:
        return value
    text = str(value).strip()
    parsed = None
    for fmt in ("%d %b %Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(text, fmt)
            break
        except ValueError:
            continue
    if parsed is None:
        return value
    if to_buddhist:
        return parsed.strftime("%d-%m-{}".format(parsed.year + 543))
    return parsed.strftime("%d %b %Y")


def classify_nocall(sample):
    result_filter = str(sample.get("ResultFilter", "")).upper()
    if "NOCALL-GC" in result_filter:
        return "gc"
    if "NOCALL-LOWFF" in result_filter:
        return "lowff"
    if "NOCALL-LIMITATION" in result_filter:
        return "limitation"

    text = "{} {} {}".format(sample.get("result_description", ""),
                             sample.get("addition", ""), "").lower()
    if "gc content" in text or "gc than" in text:
        return "gc"
    if "fetal fraction" in text or "low ff" in text or "dna" in text:
        return "lowff"
    return "limitation"


def build_national_context(context, RichText):
    """国家项目（泰语）报告。"""
    for field in ["ReportDate", "SampleCollectedTh", "RegisterDate", "DateOfBirthTh"]:
        context[field] = convert_date(context.get(field, ""), to_buddhist=True)

    high_risk_items = []
    for item in BASIC_ITEMS:
        status = context.get(item, "")
        if status == "High Risk":
            context[item] = RichText(THAI_HIGH_RISK, color="FF0000", font="Cordia New", size=22, bold=True)
            high_risk_items.append(CHROM_TO_THAI_NUM.get(item, item))
        elif status == "Low Risk":
            context[item] = RichText(THAI_LOW_RISK, font="Cordia New", size=22, bold=True)
        elif status == "No Result":
            context[item] = RichText(THAI_NO_RESULT, font="Cordia New", size=22, bold=True)

    if high_risk_items:
        chrom_str = " และ ".join(high_risk_items)
        context["result_description"] = (
            "มีความเสี่ยงสูงต่อความผิดปกติของโครโมโซมคู่ที่ {} "
            "ผลนี้เป็นเพียงการตรวจคัดกรองเบื้องต้นเท่านั้น "
            "ควรปรึกษาแพทย์ผู้เชี่ยวชาญและตรวจเพิ่มเติมเพื่อยืนยันผล".format(chrom_str))
    else:
        if str(context.get("ResultFilter", "")).upper().startswith("NOCALL"):
            context["result_description"] = NOCALL_THAI[classify_nocall(context)]
        else:
            context["result_description"] = ""

    gender = str(context.get("FetalGender", "")).strip()
    context["FetalGender"] = {"Male": "ชาย", "Female": "หญิง"}.get(gender, THAI_NO_RESULT)
    context["SampleQuality"] = "ผ่าน" if str(context.get("ResultFilter", "")).upper() == "PASS" else "ไม่ผ่าน"


def build_regular_context(context, RichText):
    """普通（英文）报告。"""
    for field in ["ReportDate", "SampleCollected", "RegisterDate", "DateOfBirth"]:
        context[field] = convert_date(context.get(field, ""), to_buddhist=False)

    for item in PLUS_ITEMS + BASIC_ITEMS:
        if context.get(item, "") == "High Risk":
            context[item] = RichText(context[item], color="FF0000", font="eastAsia:Times New Roman", size=20)
        else:
            context[item] = RichText(context.get(item, ""), font="eastAsia:Times New Roman", size=20)

    for item in ZSCORE_ITEMS:
        value = str(context.get(item, "")).strip()
        if value == "N/A":
            context[item] = RichText(value, font="eastAsia:Times New Roman", size=20)
        else:
            try:
                is_abnormal = float(value) > 3 or float(value) < -3
            except ValueError:
                is_abnormal = False
            if is_abnormal:
                context[item] = RichText(value, color="FF0000", font="eastAsia:Times New Roman", size=20)
            else:
                context[item] = RichText(value, font="eastAsia:Times New Roman", size=20)

    return context


def apply_option_context(context, option, RichText):
    """按检测项目(Option)填充模板专用字段。"""
    all_chrom = str(context.get("All_chrom", "")).strip()

    if option == "plus":
        if all_chrom == "No Result":
            context["other_chr"] = "No Result"
        elif all_chrom == "Low Risk":
            context["other_chr"] = "Not Detected"
        elif all_chrom[:1] == "T":
            items = [item.strip() for item in re.split(r"[,，]", all_chrom) if item.strip()]
            named = ["Trisomy {}".format(item[1:]) if item.startswith("T") else item for item in items]
            context["other_chr"] = ",".join(named) + " High Risk"
        else:
            context["other_chr"] = all_chrom

        if all_chrom[:1] == "T":
            context["other_chr"] = RichText(context["other_chr"], color="FF0000",
                                            font="eastAsia:Times New Roman", size=22)
        else:
            context["other_chr"] = RichText(context["other_chr"],
                                            font="eastAsia:Times New Roman", size=22)

    elif option == "basic all":
        if all_chrom == "Low Risk":
            for item in ALL_CHROM_ITEMS:
                context[item] = "Low Risk"
            context["All_chrom_result"] = "Low Risk"
        elif all_chrom == "No Result":
            for item in ALL_CHROM_ITEMS:
                context[item] = "No Result"
            context["All_chrom_result"] = "No Result"
        elif all_chrom[:1] == "T":
            high_risk_items = [item.strip() for item in re.split(r"[,，]", all_chrom) if item.strip()]
            for item in ALL_CHROM_ITEMS:
                context[item] = "Low Risk"
            for item in high_risk_items:
                if item in ALL_CHROM_ITEMS:
                    context[item] = "High Risk"
            context["All_chrom_result"] = "High Risk"
            context["All_chrom_highrisk"] = "、".join(
                item.replace("T", "chromosome ") for item in high_risk_items)


def pick_template_key(context, option, national):
    if national:
        return "national"
    if option == "plus":
        return "plus"
    if option == "basic all":
        return "basic_all"
    if str(context.get("Twin type", "")).strip().lower().startswith("yes"):
        return "twin"
    return "basic"


# ── PDF 转换 ──────────────────────────────────────────
def convert_reports_to_pdf(report_dir):
    """将目录内全部 docx 批量转 PDF（运行期依赖服务器 libreeoffice-writer-nogui）。"""
    import subprocess
    docx_files = sorted(Path(report_dir).glob("*.docx"))
    if not docx_files:
        return 0
    try:
        cmd = ["soffice", "--headless", "--norestore",
               "-env:UserInstallation=file:///tmp/lo_profile",
               "--convert-to", "pdf", "--outdir", str(report_dir)]
        cmd += [str(f) for f in docx_files]
        res = subprocess.run(cmd, timeout=900, capture_output=True)
        if res.returncode != 0:
            return -1
        return len(list(Path(report_dir).glob("*.pdf")))
    except Exception:  # noqa: BLE001
        return -1


# ── 主流程 ────────────────────────────────────────────
def run_generation(batch: ThaiReportBatch):
    """执行生成：读两表 → 逐样本渲染 docx → 写明细与统计。"""
    from docxtpl import DocxTemplate, RichText

    template_dir = get_template_dir()
    templates = {}
    for key, name in TEMPLATES.items():
        path = template_dir / name
        if not path.exists():
            raise ValueError("TEMPLATE_MISSING: {} 不存在（模板目录 {}）".format(name, template_dir))
        templates[key] = str(path)

    patient_rows = read_table(batch.patient_file.path)
    result_rows = read_table(batch.result_file.path)
    if not patient_rows:
        raise ValueError("样本信息表为空或格式不正确")
    if not result_rows:
        raise ValueError("结果表为空或格式不正确")

    patient_col = get_sample_column(list(patient_rows[0].keys()))
    result_col = get_sample_column(list(result_rows[0].keys()))

    patient_map = {}
    for row in patient_rows:
        sid = str(row.get(patient_col, "")).strip()
        if sid:
            patient_map[sid] = row

    report_dir = get_report_dir(batch.id)
    report_dir.mkdir(parents=True, exist_ok=True)

    items = []
    success = failed = skipped = 0
    total = 0

    for record in result_rows:
        sample_id = str(record.get(result_col, "")).strip()
        if not sample_id:
            continue
        total += 1

        item = ThaiReportItem(batch=batch, sample_id=sample_id,
                              option=record.get("Option", ""),
                              result_filter=record.get("ResultFilter", ""))
        try:
            if sample_id not in patient_map:
                raise ValueError("patient info not found")

            result_filter = str(record.get("ResultFilter", "")).upper()
            if "PASS" not in result_filter and "NOCALL" not in result_filter:
                skipped += 1
                item.status = "SKIPPED"
                item.message = "ResultFilter={}".format(record.get("ResultFilter", ""))
                items.append(item)
                continue

            sample = dict(record)
            check_msg = check_plus_result(sample, strict=False)

            context = {}
            context.update(patient_map[sample_id])
            context.update(sample)

            option = str(context.get("Option", "")).strip().lower()
            context["Option"] = option
            accession_id = str(context.get("AccessionID", "")).strip()
            if not accession_id:
                raise ValueError("AccessionID is empty")

            national = accession_id.startswith(NATIONAL_PREFIX)
            template_key = pick_template_key(context, option, national)

            if national:
                build_national_context(context, RichText)
            else:
                build_regular_context(context, RichText)
                apply_option_context(context, option, RichText)
                if template_key == "twin":
                    context["y_detected"] = "Detected" if str(context.get("FetalGender", "")) == "Male" else "Not Detected"

            report_file = "{}_Report.docx".format(accession_id)
            tpl = DocxTemplate(templates[template_key])
            tpl.render(context)
            tpl.save(str(report_dir / report_file))

            success += 1
            item.accession_id = accession_id
            item.option = option
            item.template = template_key
            item.report_file = report_file
            item.status = "OK"
            item.message = check_msg or ""
        except Exception as e:  # noqa: BLE001
            failed += 1
            item.status = "FAILED"
            item.message = "{}".format(e)

        items.append(item)

    ThaiReportItem.objects.bulk_create(items)

    # 批量转 PDF（LibreOffice headless；失败不影响 docx）
    convert_reports_to_pdf(report_dir)

    # 批次汇总 CSV（与脚本一致的列）
    summary_path = get_batch_dir(batch.id) / "{}-report_summary.csv".format(batch.name)
    with open(summary_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["SampleID", "AccessionID", "Option", "ResultFilter", "Template", "ReportFile", "Status", "Message"])
        for it in items:
            writer.writerow([it.sample_id, it.accession_id, it.option, it.result_filter,
                             it.template, it.report_file, it.status, it.message])

    batch.total = total
    batch.success = success
    batch.failed = failed
    batch.skipped = skipped
    batch.status = "DONE" if failed == 0 else ("DONE" if success > 0 else "FAILED")
    batch.save(update_fields=["total", "success", "failed", "skipped", "status"])
    return batch
