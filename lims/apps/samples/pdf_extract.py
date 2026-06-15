#!/usr/bin/env python3
"""NIPT PDF extraction utility for Thailand source. Adapted from tai_dengji_250918.py."""
from PyPDF2 import PdfReader
import os
import datetime
import re


def extract_thai_pdf(file_path, source="泰国"):
    """Extract form fields from a Thai NIPT PDF registration form.
    Returns a dict of Sample fields or None on failure."""

    with open(file_path, 'rb') as fh:
        reader = PdfReader(fh)

    # Get all form fields
    try:
        fields = reader.get_fields(tree=None, retval=None)
    except Exception as e:
        print(f"  [WARN] Cannot read form fields from {file_path}: {e}")
        return None

    if not fields:
        print(f"  [WARN] No form fields found in {file_path}")
        return None

    info = {}

    # Accessioning ID
    info['external_id'] = (fields.get('Text Field0', {}).get('/V', '') or '').strip()

    # Patient name
    info['patient_name'] = (fields.get('Text Field1', {}).get('/V', '') or '').strip()

    # Date of birth (keep raw for Excel, ISO for DB)
    birthday_raw = (fields.get('Text Field2', {}).get('/V', '') or '').strip()
    if birthday_raw:
        parts = birthday_raw.split()
        if len(parts) == 3:
            try:
                dt = datetime.datetime.strptime(f"{parts[1]} {parts[0]} {parts[2]}", "%b %d %Y")
                info['patient_dob'] = dt.strftime("%Y-%m-%d")
                info['patient_dob_raw'] = f"{parts[1]} {parts[0]} {parts[2]}"
            except ValueError:
                pass

    # Age
    age_raw = (fields.get('Text Field3', {}).get('/V', '') or '').strip()
    if age_raw and age_raw.isdigit():
        info['age'] = int(age_raw)

    # Patient ID
    info['id_card'] = (fields.get('Text Field4', {}).get('/V', '') or '').strip()

    # Gestational week (keep raw format like "16+4")
    gw_raw = (fields.get('Text Field5', {}).get('/V', '') or '').strip()
    if gw_raw:
        info['gestational_weeks_raw'] = gw_raw
        match = re.match(r'(\d+)', gw_raw)
        if match:
            info['gestational_weeks'] = int(match.group(1))

    # Test option: Check Box11=Basic, Check Box12=Plus, Check Box13=Basic All
    test_option = None
    if (fields.get('Check Box13', {}).get('/V') or '') == '/Yes':
        test_option = 'Basic All'
    elif (fields.get('Check Box11', {}).get('/V') or '') == '/Yes':
        test_option = 'Basic'
    elif (fields.get('Check Box12', {}).get('/V') or '') == '/Yes':
        test_option = 'Plus'

    if test_option:
        info['test_option'] = test_option

    # Source institution
    info['source_institution'] = source

    # Hospital
    hospital = (fields.get('Text Field12', {}).get('/V', '') or '').strip()
    if hospital:
        info['ordering_facility'] = hospital

    # Physician
    physician = (fields.get('Text Field13', {}).get('/V', '') or '').strip()
    if physician:
        info['ordering_physician'] = physician

    # Collection date (keep raw format for Excel, also ISO for DB)
    collect_raw = (fields.get('Text Field14', {}).get('/V', '') or '').strip()
    collect_time_raw = (fields.get('Text Field15', {}).get('/V', '') or '').strip()
    if collect_raw:
        parts = collect_raw.split()
        if len(parts) == 3:
            try:
                dt = datetime.datetime.strptime(f"{parts[1]} {parts[0]} {parts[2]}", "%b %d %Y")
                info['collection_date'] = dt.strftime("%Y-%m-%d")
                # Original Excel format: "Jun 04 2026 10:00 AM"
                time_str = (collect_time_raw or '').strip().replace('am','AM').replace('pm','PM').replace('.',':')
                info['collection_date_raw'] = f"{parts[1]} {parts[0]} {parts[2]} {time_str}"
            except ValueError:
                pass

    # Single/Twin: Check Box2
    # Check Box2 checked = Single (单胎), unchecked = not specified
    # Most patients are single, so default to False
    check2_val = (fields.get('Check Box2', {}).get('/V') or '')
    info['multiple_gestation'] = (check2_val == '/Yes')

    # IVF: Check Box0
    # Check Box0 checked = 否NO (natural, not IVF)
    # Most patients are not IVF, default to False
    check0_val = (fields.get('Check Box0', {}).get('/V') or '')
    info['ivf_status'] = (check0_val == '/Yes')

    # Medical history: Check Box7/8/9/10
    history_parts = []
    if (fields.get('Check Box7', {}).get('/V') or '') == '/Yes':
        history_parts.append("Tumor patient")
    if (fields.get('Check Box8', {}).get('/V') or '') == '/Yes':
        history_parts.append("Chromosomal abnormalities")
    if (fields.get('Check Box9', {}).get('/V') or '') == '/Yes':
        history_parts.append("Medicine use during pregnancy")
    if (fields.get('Check Box10', {}).get('/V') or '') == '/Yes':
        history_parts.append("Other")
    if history_parts:
        info['clinical_diagnosis'] = ", ".join(history_parts)
    else:
        info['clinical_diagnosis'] = "否"

    return info


def extract_pdfs_from_directory(directory, source="泰国"):
    """Extract all PDFs in a directory and return list of sample dicts."""
    results = []
    for root, dirs, files in os.walk(directory):
        for fname in sorted(files):
            if fname.lower().endswith('.pdf') and not fname.startswith('.'):
                fpath = os.path.join(root, fname)
                print(f"Processing: {fname}")
                info = extract_thai_pdf(fpath, source)
                if info:
                    results.append(info)
                    print(f"  -> {info.get('patient_name', 'N/A')} | {info.get('test_option', 'N/A')}")
                else:
                    print(f"  -> FAILED")
    return results


def generate_excel(samples, output_path):
    """Generate Excel matching the original 泰国NIPT登记表 format (38 columns)."""
    import pandas as pd
    import numpy as np

    # Map extracted fields to the original column names
    rows = []
    for s in samples:
        # Format values like the original
        source = s.get('source_institution', '')
        # Map boolean values
        twin = s.get('multiple_gestation', False)
        twin_str = "双胎twins" if twin else "单胎Single"
        ivf = s.get('ivf_status', False)
        ivf_str = "是YES" if ivf else "否NO"
        diagnosis = s.get('clinical_diagnosis', '') or '否'

        row = {
            'Sample_source': source,
            'Test_Option': s.get('test_option', ''),
            'Accessioning_ID': s.get('external_id', ''),
            'Collection_Date': s.get('collection_date_raw', s.get('collection_date', '')),
            'Acceptance_Date': '',  # Left blank for new entries
            'Hospital_or_Clinic': s.get('ordering_facility', ''),
            'Physician': s.get('ordering_physician', ''),
            'Patient_ID': s.get('id_card', ''),
            'Name': s.get('patient_name', ''),
            'DOB': s.get('patient_dob_raw', s.get('patient_dob', '')),
            'Gestational_Week': s.get('gestational_weeks_raw', str(s.get('gestational_weeks', ''))),
            'Report_code': '',
            'send_report_id': '',
            'Age': s.get('age', ''),
            'Last_Menstrual_Period': '',
            'Single/Twin': twin_str,
            'IVF': ivf_str,
            'Pregnancy_History': '否',
            'Previous_Medical_History': diagnosis,
            'FedEx_No.': '',
            # Analysis columns (empty for new registrations)
            'Zscore21': np.nan, 'Zscore18': np.nan, 'Zscore13': np.nan,
            'T21': np.nan, 'T18': np.nan, 'T13': np.nan,
            'XO': np.nan, 'XXX': np.nan, 'XXY': np.nan, 'XYY': np.nan,
            'All_chrom': np.nan, 'ff': np.nan,
            'Gender_report': np.nan, 'Gender': np.nan,
            'Actua_Report_Date': np.nan, 'Report_Date': np.nan,
            'Unnamed: 36': np.nan, 'Report_situation': np.nan,
        }
        rows.append(row)

    df = pd.DataFrame(rows)
    # Sort by Test_Option then Accessioning_ID (matching original script behavior)
    df = df.sort_values(by=['Test_Option', 'Accessioning_ID'])
    df.to_excel(output_path, index=False)
    print(f"Excel saved to: {output_path}")
    return output_path


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("Usage: python3 pdf_extract.py <pdf_directory> [output_excel_path]")
        sys.exit(1)

    pdf_dir = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else os.path.join(pdf_dir, 'taiguoNIPT.xlsx')

    samples = extract_pdfs_from_directory(pdf_dir)
    print(f"\nTotal extracted: {len(samples)} samples")
    if samples:
        generate_excel(samples, output)
