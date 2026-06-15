import sys
sys.path.insert(0, '/app')
from PyPDF2 import PdfReader
import os

# Test with a sample PDF if exists
test_pdf = '/opt/lims/docs/fetal_sex_qPCR_protocol.pdf'
if os.path.exists(test_pdf):
    reader = PdfReader(test_pdf)
    print(f"Pages: {len(reader.pages)}")
    try:
        fields = reader.get_fields(tree=None, retval=None)
        print(f"get_fields result: {type(fields).__name__}, truthy: {bool(fields)}")
        if fields:
            for k in list(fields.keys())[:3]:
                print(f"  Field: {k}")
    except Exception as e:
        print(f"get_fields error: {type(e).__name__}: {e}")
    
    try:
        fields2 = reader.get_form_text_fields()
        print(f"get_form_text_fields: {type(fields2).__name__}, truthy: {bool(fields2)}")
        if fields2:
            for k in list(fields2.keys())[:3]:
                print(f"  Field: {k} = {fields2[k]}")
    except Exception as e:
        print(f"get_form_text_fields error: {type(e).__name__}: {e}")
else:
    print(f"No test PDF at {test_pdf}")
