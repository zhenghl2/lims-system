import re
with open('/app/lims/apps/plasma_separation/views.py', 'r') as f:
    content = f.read()

# Replace the broken line with correct one using regex
content = re.sub(
    r'NIPT_SIGNER_PASSWORD=***    'NIPT_SIGNER_PASSWORD = "1234...open('/app/lims/apps/plasma_separation/views.py', 'w') as f:
    f.write(content)

import py_compile
try:
    py_compile.compile('/app/lims/apps/plasma_separation/views.py', doraise=True)
    print('COMPILE OK')
except py_compile.PyCompileError as e:
    print(f'COMPILE ERROR: {e}')
