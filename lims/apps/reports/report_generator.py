"""
NIPT Report Generator — generates DOCX reports from LIMS data using docxtpl templates.
Called after report review (Reviewed By) step.
"""
import os
import re
import logging
from datetime import datetime
from docxtpl import DocxTemplate, RichText
from django.conf import settings

logger = logging.getLogger("lims.reports")

# ── Template paths (relative to reports/templates/) ──
TPL_DIR = os.path.join(os.path.dirname(__file__), "templates")

TEMPLATE_MAP = {
    "basic": "Test_Report-Low_risk_basic_tpl.docx",
    "basic_twin": "Test_Report-Low_risk_basic_twin_tpl.docx",
    "plus": "Test_Report-Low_risk_plus_tpl.docx",
    "basic_all": "Test_Report-Low_risk_basic_all_tpl.docx",
    "basic_span": "Test_Report-Low_risk_basic_tpl_span.docx",
    "plus_span": "Test_Report-Low_risk_plus_tpl_span.docx",
    "plus_br": "MODELO_DE_LAUDO-NIPT_tpl.docx",
    "plus_br_no_result": "MODELO_DE_LAUDO-NIPT_no_result_tpl.docx",
    "br_sex": "Laudo-Sexagem-tpl.docx",
    "plus_aus": "Test_Report-Low_risk_plus_tpl_aus.docx",
    "basic_aus": "Test_Report-Low_risk_basic_tpl_aus.docx",
    "plus_cyj": "Test_Report-Low_risk_plus_tpl_cyj.docx",
    "basic_cyj": "Test_Report-Low_risk_basic_tpl_cyj.docx",
    # BCC QC failure templates
    "basic_fail": "Test_Report-Low_risk_basic_fail_tpl.docx",
    "basic_all_fail": "Test_Report-Low_risk_basicAll_fail_tpl.docx",
    "plus_fail": "Test_Report-Low_risk_plus_fail_tpl.docx",
}

RESULT_COLS = ["T21", "T18", "T13", "XO", "XXX", "XXY", "XYY"]

# QC failure values and their report descriptions
QC_FAIL_VALUES = {"浓度低", "高GC", "数据量不足", "多条染色体临界", "其他"}

QC_FAILURE_MESSAGES = {
    "浓度低": "No results due to insufficient fetal DNA or combination with other factors "
              "in this sample. The reason may include normal variation, gestational age, "
              "maternal weight, and certain medications. Redraw is recommended.",
    "高GC": "GC values higher in experimental group compared to control. "
            "Repeat specimen recommended for confirmation.",
    "多条染色体临界": "No results due to limitations of the test algorithm. "
                     "A repeat specimen is required for further testing.",
    "数据量不足": "Insufficient data for accurate analysis. "
                  "A repeat specimen is required for further testing.",
    "其他": "Test could not be completed. A repeat specimen is recommended.",
}


def _get_template_path(name):
    return os.path.join(TPL_DIR, name)


def select_template(sample_source, test_option, is_twin, has_no_result, gender_report, is_qc_fail=False):
    """Select the appropriate DOCX template based on sample attributes."""
    src = (sample_source or "").strip()

    # Brazilian source (巴西万基 / 巴西)
    if src in ("巴西万基", "巴西"):
        if has_no_result:
            return _get_template_path(TEMPLATE_MAP["plus_br_no_result"])
        return _get_template_path(TEMPLATE_MAP["plus_br"])

    # Spanish agent
    if src == "西班牙代理":
        if test_option == "Plus":
            return _get_template_path(TEMPLATE_MAP["plus_span"])
        return _get_template_path(TEMPLATE_MAP["basic_span"])

    # Australia
    if src == "澳洲":
        if test_option == "Plus":
            return _get_template_path(TEMPLATE_MAP["plus_aus"])
        return _get_template_path(TEMPLATE_MAP["basic_aus"])

    # CYJ
    if src in ("CYJ", "CYJ印度", "CYJ澳洲", "CYJ澳洲经销商", "CYJ秘鲁", "CYJ美国"):
        if test_option == "Plus":
            return _get_template_path(TEMPLATE_MAP["plus_cyj"])
        return _get_template_path(TEMPLATE_MAP["basic_cyj"])

    # Default (BCC and others)
    if is_qc_fail:
        if test_option == "Plus":
            return _get_template_path(TEMPLATE_MAP["plus_fail"])
        elif test_option == "Basic All":
            return _get_template_path(TEMPLATE_MAP["basic_all_fail"])
        else:  # Basic
            return _get_template_path(TEMPLATE_MAP["basic_fail"])

    if test_option == "Plus":
        return _get_template_path(TEMPLATE_MAP["plus"])
    elif test_option == "Basic All":
        return _get_template_path(TEMPLATE_MAP["basic_all"])
    else:  # Basic
        if is_twin:
            return _get_template_path(TEMPLATE_MAP["basic_twin"])
        return _get_template_path(TEMPLATE_MAP["basic"])


def build_context(report):
    """Build the template context dict from Report + related models."""
    sample = report.sample
    ctx = {}

    # ── Basic info from Sample ──
    ctx["Sample_source"] = sample.sample_source or ""
    ctx["Test_Option"] = sample.test_option or ""
    ctx["Accessioning_ID"] = sample.external_id or ""
    ctx["Patient_ID"] = sample.id_card or ""
    ctx["Name"] = sample.patient_name or ""
    ctx["Age"] = sample.age or ""
    ctx["Gestational_Week"] = str(sample.gestational_weeks or "") if sample.gestational_weeks else ""
    ctx["Report_code"] = sample.report_code or sample.vg_id or ""
    ctx["send_report_id"] = sample.send_report_id or ""
    ctx["Hospital_or_Clinic"] = sample.ordering_facility or ""
    ctx["Physician"] = sample.physician or ""
    ctx["Pregnancy_History"] = sample.pregnancy_history or ""
    ctx["Previous_Medical_History"] = sample.clinical_diagnosis or ""
    ctx["FedEx_No."] = sample.fedex_no or ""
    ctx["IVF"] = "IVF" if sample.ivf_status else "否"
    ctx["Single/Twin"] = "Twin" if sample.multiple_gestation else "Single"
    ctx["Gender_report"] = "YES" if getattr(sample, "gender_report", False) else ""

    # ── Dates ──
    ctx["Collection_Date"] = sample.collection_date
    ctx["Acceptance_Date"] = sample.acceptance_date
    ctx["DOB"] = sample.patient_dob
    ctx["Last_Menstrual_Period"] = sample.last_menstrual_period
    ctx["Report_Date"] = (report.released_at or datetime.now()).strftime("%Y-%m-%d")
    ctx["Actua_Report_Date"] = (report.released_at or datetime.now()).strftime("%Y-%m-%d")

    # ── Bioinformatics data ──
    bio = {}
    if report.run_sample and report.run_sample.run:
        run = report.run_sample.run
        bio_all = run.bioinformatics_data or {}
        rs_id = str(report.run_sample.id)
        bio = bio_all.get(rs_id, {})

    ctx["Zscore21"] = bio.get("z21")
    ctx["Zscore18"] = bio.get("z18")
    ctx["Zscore13"] = bio.get("z13")

    # ── QC failure reason for BCC reports ──
    qc_status = str(bio.get("qc_status", "") or "").strip()
    ctx["failure_reason"] = QC_FAILURE_MESSAGES.get(qc_status, "")
    ctx["T21"] = bio.get("t21", "")
    ctx["T18"] = bio.get("t18", "")
    ctx["T13"] = bio.get("t13", "")
    ctx["XO"] = bio.get("xo", "")
    ctx["XXX"] = bio.get("xxx", "")
    ctx["XXY"] = bio.get("xxy", "")
    ctx["XYY"] = bio.get("xyy", "")
    ctx["All_chrom"] = bio.get("all_chrom", "")
    ctx["Gender"] = bio.get("sex", "")

    # Fetal fraction: stored as percentage, convert to fraction for template
    ff_val = bio.get("ff_percent")
    if ff_val is not None:
        ctx["ff"] = float(ff_val) / 100.0
    else:
        ctx["ff"] = 0.0

    # ── Format z-scores ──
    for key in ["Zscore21", "Zscore18", "Zscore13"]:
        if ctx[key] is not None:
            try:
                ctx[key] = float(ctx[key])
            except (TypeError, ValueError):
                ctx[key] = 0.0
        else:
            ctx[key] = 0.0

    # ── Determine overall result ──
    result = "Low_Risk"
    for r in RESULT_COLS:
        val = str(ctx.get(r, "") or "")
        if "高风险" in val:
            result = "High_Risk"
        elif "低风险" in val:
            ctx[r] = "Low_Risk"
        elif "High Risk" in val:
            result = "High_Risk"
            ctx[r] = "High_Risk"
        elif "Low Risk" in val:
            ctx[r] = "Low_Risk"
    ctx["result"] = result

    # ── Gender mapping ──
    gender = str(ctx.get("Gender", "") or "")
    if gender in ("男", "Male"):
        ctx["Gender"] = "Male"
    elif gender in ("女", "Female"):
        ctx["Gender"] = "Female"

    # ── Date formatting ──
    spanish_sources = {"西班牙代理", "澳洲"}
    if ctx["Sample_source"] in spanish_sources:
        for f in ["Collection_Date", "Acceptance_Date", "DOB"]:
            t = ctx[f]
            if isinstance(t, datetime):
                ctx[f] = t.strftime("%Y/%m/%d")
    else:
        for f in ["Collection_Date", "Acceptance_Date"]:
            t = ctx[f]
            if isinstance(t, datetime):
                ctx[f] = t.strftime("%Y-%m-%d")

    # ── Basic All: All_chrom processing ──
    if ctx["Test_Option"] == "Basic All":
        all_chrom_items = [f"T{i}" for i in range(1, 23) if i not in [13, 18, 21]]
        all_chrom_val = str(ctx.get("All_chrom", "") or "")
        if all_chrom_val == "低风险":
            for item in all_chrom_items:
                ctx[item] = "Low_Risk"
            ctx["All_chrom_result"] = "Low_Risk"
        elif all_chrom_val and all_chrom_val[0] == "T":
            for item in all_chrom_items:
                ctx[item] = "Low_Risk"
            high_risk_items = re.split(r'[,，]', all_chrom_val)
            for item in high_risk_items:
                if item in all_chrom_items:
                    ctx[item] = "High_Risk"
            ctx["All_chrom_result"] = "High_Risk"
            ctx["All_chrom_highrisk"] = "、".join([item.replace("T", "chromosome ") for item in high_risk_items])
        elif all_chrom_val in ("无结果", "No Call"):
            for item in all_chrom_items:
                ctx[item] = "No_result"
            ctx["All_chrom_result"] = "No_result"

    return ctx


def apply_brazil_formatting(ctx):
    """Apply Brazilian-specific result formatting (RichText colors)."""
    for r in RESULT_COLS:
        val = str(ctx.get(r, "") or "")
        if "High_Risk" in val or "高风险" in val:
            ctx["result"] = "Alto risco"
            ctx[r] = RichText("Alto risco", color="FF0000", bold=True, font="eastAsia:Times New Roman", size=20)
        elif "Low_Risk" in val or "低风险" in val:
            ctx["result"] = "Baixo risco"
            ctx[r] = RichText("Baixo risco", color="00B050", bold=True, font="eastAsia:Times New Roman", size=20)
        else:
            ctx[r] = RichText(str(val), color="000000", bold=True, font="eastAsia:Times New Roman", size=20)


def generate_report(report):
    """Generate a DOCX report for the given Report object.
    Returns the file path of the generated report, or None on failure.
    """
    sample = report.sample
    sample_source = sample.sample_source or ""
    test_option = sample.test_option or ""
    is_twin = bool(sample.multiple_gestation)

    # Check if any result is "No Result" or "无结果" (for BR template selection)
    bio = {}
    if report.run_sample and report.run_sample.run:
        run = report.run_sample.run
        bio_all = run.bioinformatics_data or {}
        rs_id = str(report.run_sample.id)
        bio = bio_all.get(rs_id, {})
    has_no_result = any(
        str(bio.get(r, "") or "") in ("No Result", "无结果", "No Call")
        for r in RESULT_COLS
    )

    # Determine if QC failed for this sample
    is_qc_fail = False
    if bio:
        qc_status = str(bio.get("qc_status", "") or "").strip()
        if qc_status in QC_FAIL_VALUES:
            is_qc_fail = True

    # Select template
    template_path = select_template(
        sample_source, test_option, is_twin, has_no_result,
        bool(getattr(sample, "gender_report", False)),
        is_qc_fail
    )
    logger.info(f"Generating report for {report.report_number}: source={sample_source}, "
                f"test={test_option}, twin={is_twin}, template={os.path.basename(template_path)}")

    # Build context
    ctx = build_context(report)

    # Brazilian formatting
    if sample_source in ("巴西万基", "巴西"):
        apply_brazil_formatting(ctx)
        if isinstance(ctx.get("Report_Date"), datetime):
            ctx["Report_Date"] = ctx["Report_Date"].strftime("%d/%m/%Y")

    # Twin: add Y chromosome detection
    if is_twin and test_option == "Basic":
        gender_val = str(ctx.get("Gender", "") or "")
        ctx["y_detected"] = "Detected" if gender_val == "Male" else "Not Detected"

    # ── Render ──
    try:
        tpl = DocxTemplate(template_path)
        tpl.render(ctx)

        # Output path
        output_dir = os.path.join(settings.MEDIA_ROOT, "reports")
        os.makedirs(output_dir, exist_ok=True)
        # File name: VG-ID_sendReportID.docx
        vg = (sample.vg_id or "").strip()
        srid = (sample.send_report_id or "").strip()
        name_parts = [p for p in [vg, srid] if p]
        base_name = "_".join(name_parts) if name_parts else report.report_number
        report_file_name = f"{base_name}.docx"
        output_path = os.path.join(output_dir, report_file_name)
        tpl.save(output_path)

        # Store relative path in Report model
        report.pdf_file_path = f"reports/{report_file_name}"
        report.save(update_fields=["pdf_file_path"])

        # Also generate PDF version via LibreOffice
        pdf_name = f"{base_name}.pdf"
        pdf_path = os.path.join(output_dir, pdf_name)
        try:
            import subprocess
            subprocess.run([
                'libreoffice', '--headless', '--convert-to', 'pdf',
                '--outdir', output_dir, output_path
            ], timeout=60, check=False, capture_output=True)
            if os.path.exists(pdf_path):
                logger.info(f"PDF generated: {pdf_path}")
            else:
                logger.warning(f"PDF conversion failed for {report_file_name}")
        except Exception as e:
            logger.warning(f"PDF conversion error: {e}")

        logger.info(f"Report generated: {output_path}")
        return output_path

    except Exception as e:
        logger.error(f"Failed to generate report {report.report_number}: {e}", exc_info=True)
        return None


def generate_gender_report(report):
    """Generate a separate fetal sex report for Brazilian samples."""
    if not getattr(report.sample, "gender_report", False):
        return None

    ctx = build_context(report)
    match = re.search(r"\d.*", ctx.get("Accessioning_ID", "") or "")
    ctx["tubo_ID"] = (match.group() + "-F") if match else ""

    try:
        tpl_path = _get_template_path(TEMPLATE_MAP["br_sex"])
        tpl = DocxTemplate(tpl_path)
        tpl.render(ctx)

        output_dir = os.path.join(settings.MEDIA_ROOT, "reports")
        os.makedirs(output_dir, exist_ok=True)
        # File name: VG-ID_sendReportID_SexagemFetal.docx
        vg = (sample.vg_id or "").strip()
        srid = (sample.send_report_id or "").strip()
        name_parts = [p for p in [vg, srid] if p]
        base_name = "_".join(name_parts) if name_parts else report.report_number
        file_name = f"{base_name}_SexagemFetal.docx"
        output_path = os.path.join(output_dir, file_name)
        tpl.save(output_path)

        logger.info(f"Gender report generated: {output_path}")
        return output_path
    except Exception as e:
        logger.error(f"Failed to generate gender report: {e}", exc_info=True)
        return None
