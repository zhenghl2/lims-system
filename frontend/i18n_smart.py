#!/usr/bin/env python3
"""
Smarter i18n migration - only replaces strings inside React component functions.
Avoids module-level constants, type definitions, and data arrays.
"""
import os
import re
import json

PAGES_DIR = "/opt/lims/frontend/src/pages"
I18N_DIR = "/opt/lims/frontend/src/i18n"

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

def string_to_key(s):
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", s)
    words = cleaned.strip().split()
    if not words:
        return "unknown"
    key = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    return key[:50]

# Translation maps
ZH_MAP = {
    "sampleId": "样本ID", "patientId": "患者ID", "patientName": "患者姓名",
    "sampleType": "样本类型", "picture": "图片", "status": "状态",
    "receivedDate": "接收日期", "actions": "操作", "samples": "样本",
    "receiveSample": "接收样本", "batchCreate": "批量创建", "refresh": "刷新",
    "total": "总计", "receiveNewSample": "接收新样本", "editSample": "编辑样本",
    "rejectSample": "拒绝样本", "batchCreateSamples": "批量创建样本",
    "addRow": "添加行", "save": "保存", "cancel": "取消", "receive": "接收",
    "delete": "删除", "edit": "编辑", "accept": "接受", "reject": "拒绝",
    "searchSampleIdOrPatientId": "搜索样本ID或患者ID...",
    "from": "开始日期", "to": "结束日期", "submitAll": "提交全部",
    "collectionDate": "采集日期", "orderingPhysician": "开单医生",
    "orderingFacility": "送检机构", "transportTemperature": "运输温度",
    "leaveBlankToAutoGenerate": "留空自动生成",
    "photoUploaded": "照片已上传", "uploadFailed": "上传失败",
    "view": "查看", "uploadPhoto": "上传照片",
    "hemolyzed": "溶血", "insufficientVolume": "量不足",
    "wrongContainer": "容器错误", "labelingError": "标签错误",
    "temperatureExcursion": "温度异常", "expiredTransportTime": "运输超时",
    "reason": "原因", "additionalNotesOptional": "附加说明（可选）",
    "refreshed": "已刷新", "name": "姓名", "auto": "自动", "optional": "可选",
    "select": "请选择...", "pleaseSelectASampleType": "请选择样本类型",
    "failedToDeleteSample": "删除样本失败", "sampleUpdated": "样本已更新",
    "batchCreateFailed": "批量创建失败",
    "pleaseSelectARejectionReason": "请选择拒绝原因",
    "loadingDashboard": "加载仪表盘...",
    "noPanelsConfigured": "未配置检测方案",
    "addTestPanelsToSeeDashboardStatistics": "添加检测方案以查看仪表盘统计。",
    # Runs
    "runs": "运行", "sequencingRuns": "测序运行",
    "runNumber": "运行编号", "batchId": "批次ID",
    "sequencer": "测序仪", "planned": "计划日期",
    "createRun": "创建运行", "createNewRun": "创建新运行",
    "runCreatedSuccessfully": "运行创建成功", "failedToCreateRun": "创建运行失败",
    "failedToLoadRuns": "加载运行失败", "failedToDeleteRun": "删除运行失败",
    "searchRunNumber": "搜索运行编号...", "plannedDate": "计划日期",
    "pleaseSelectATestPanel": "请选择检测方案", "selectTestPanel": "选择检测方案",
    "selectSequencerOptional": "选择测序仪（可选）",
    "assignSamples": "分配样本", "loadingSamples": "加载样本中...",
    "availableSamples": "可用样本", "inThisRun": "在本运行中",
    "sampleConfiguration": "样本配置",
    "scanBarcode": "扫描条码", "well": "孔位", "index": "索引", "pool": "池",
    "notes": "备注", "runNotes": "运行备注...",
    "run": "运行", "close": "关闭", "notAssigned": "未分配",
    "matrix": "矩阵", "workflowSteps": "工作流步骤",
    "results": "结果", "saveResults": "保存结果",
    "noSamplesInThisRun": "该运行中无样本", "noWorkflowStepsFound": "未找到工作流步骤",
    "loadingMatrix": "加载矩阵中...", "loadingSteps": "加载步骤中...",
    "loadingResults": "加载结果中...",
    "step": "步骤", "sample": "样本", "started": "开始时间",
    "completed": "完成时间", "duration": "耗时", "performedBy": "执行者",
    "instrument": "仪器", "observations": "观察",
    "reagentLotIds": "试剂批号", "instrumentUsed": "所用仪器",
    "selectInstrument": "选择仪器",
    "selectTechnicianDefaultYou": "选择技术人员（默认：你）",
    "deviationExceptionOccurred": "偏差/异常发生",
    "deviationNote": "偏差说明",
    "describeAnyDeviationFromSop": "描述任何与SOP的偏差...",
    "completeStep": "完成步骤", "record": "记录",
    "startAll": "全部启动", "skipAll": "全部跳过",
    "start": "启动", "skip": "跳过", "done": "完成", "complete": "完成",
    "saved": "已保存", "unsaved": "未保存",
    "filterByStatus": "按状态筛选",
    "patient": "患者", "result": "结果", "ff": "FF %", "sex": "性别",
    "dashboard": "仪表盘", "reports": "报告",
    "qc": "质量控制", "qcMaterials": "质控品", "qcRuns": "QC运行",
    "ljCharts": "L-J图表", "qualityEvents": "质量事件",
    "instruments": "仪器", "reagents": "试剂",
    "case": "案例编号", "pt": "PT编号", "mother": "母亲",
    "clinic": "诊所", "urgent": "加急", "progress": "进度",
    "createdAt": "创建时间", "all": "全部状态",
    "protocols": "实验方案", "documents": "文档",
    "searchDocuments": "搜索文档...", "selectDocumentType": "选择文档类型",
    "documentType": "文档类型", "documentNumber": "文号",
    "title": "标题", "effectiveDate": "生效日期",
    "training": "培训", "auditLog": "审计日志",
    "auditLog": "审计日志", "statistics": "统计",
    "operation": "操作", "entity": "实体", "user": "用户",
    "ip": "IP", "time": "时间", "change": "变更", "hash": "哈希",
    "bioinformatics": "生物信息学", "analysisTasks": "分析任务",
    "pipelineRegistration": "流水线注册", "pipeline": "流水线",
    "submitTime": "提交时间", "completionTime": "完成时间", "error": "错误",
    "notifications": "通知", "quality": "质量",
    "ptRounds": "PT 轮次", "ptItems": "PT 项目", "internalAudit": "内部审计",
    "nipptRegistration": "NIPPT 登记", "peripheralBlood": "外周血",
    "buccalSwab": "口腔拭子", "hairFollicle": "毛囊",
    "driedBloodSpot": "干血片", "nipptReports": "NIPPT 报告",
    "pleaseEnterReviewerPassword": "请输入审核者密码",
}

PT_MAP = {
    "sampleId": "ID da Amostra", "patientId": "ID do Paciente",
    "patientName": "Nome do Paciente", "sampleType": "Tipo de Amostra",
    "picture": "Imagem", "status": "Status",
    "receivedDate": "Data de Recebimento", "samples": "Amostras",
    "receiveSample": "Receber Amostra", "batchCreate": "Criação em Lote",
    "refresh": "Atualizar", "total": "Total",
    "receiveNewSample": "Receber Nova Amostra", "editSample": "Editar Amostra",
    "rejectSample": "Rejeitar Amostra", "batchCreateSamples": "Criar Amostras em Lote",
    "addRow": "Adicionar Linha", "save": "Salvar", "cancel": "Cancelar",
    "receive": "Receber", "delete": "Excluir", "edit": "Editar",
    "accept": "Aceitar", "reject": "Rejeitar",
    "searchSampleIdOrPatientId": "Buscar ID da Amostra ou ID do Paciente...",
    "from": "De", "to": "Até", "submitAll": "Enviar Todos",
    "collectionDate": "Data de Coleta",
    "orderingPhysician": "Médico Solicitante",
    "orderingFacility": "Instituição Solicitante",
    "transportTemperature": "Temperatura de Transporte",
    "view": "Ver", "uploadPhoto": "Enviar Foto",
    "reason": "Motivo", "additionalNotesOptional": "Notas adicionais (opcional)",
    "refreshed": "Atualizado", "name": "Nome", "auto": "Automático",
    "optional": "Opcional", "select": "Selecionar...",
    "loadingDashboard": "Carregando painel...",
    "noPanelsConfigured": "Nenhum painel configurado",
    "runs": "Execuções", "sequencingRuns": "Execuções de Sequenciamento",
    "runNumber": "Número da Execução", "batchId": "ID do Lote",
    "sequencer": "Sequenciador", "planned": "Planejado",
    "createRun": "Criar Execução", "createNewRun": "Criar Nova Execução",
    "searchRunNumber": "Buscar número da execução...",
    "plannedDate": "Data Planejada", "testPanel": "Painel de Teste",
    "selectTestPanel": "Selecionar painel de teste",
    "assignSamples": "Atribuir Amostras",
    "availableSamples": "Amostras Disponíveis", "inThisRun": "Nesta Execução",
    "sampleConfiguration": "Configuração de Amostras",
    "well": "Poço", "index": "Índice", "pool": "Pool",
    "notes": "Observações", "runNotes": "Notas da execução...",
    "run": "Execução", "close": "Fechar", "notAssigned": "Não atribuído",
    "matrix": "Matriz", "workflowSteps": "Etapas do Fluxo",
    "results": "Resultados", "saveResults": "Salvar Resultados",
    "step": "Etapa", "sample": "Amostra",
    "started": "Iniciado", "completed": "Concluído",
    "duration": "Duração", "performedBy": "Executado Por",
    "instrument": "Instrumento", "observations": "Observações",
    "reagentLotIds": "IDs do Lote de Reagentes",
    "instrumentUsed": "Instrumento Usado",
    "selectInstrument": "Selecionar instrumento",
    "deviationExceptionOccurred": "Ocorreu desvio/exceção",
    "deviationNote": "Nota de Desvio",
    "completeStep": "Concluir Etapa", "record": "Registro",
    "startAll": "Iniciar Todos", "skipAll": "Pular Todos",
    "start": "Iniciar", "skip": "Pular", "done": "Concluído",
    "complete": "Concluir", "saved": "Salvo", "unsaved": "Não salvo",
    "patient": "Paciente", "dashboard": "Painel", "reports": "Relatórios",
    "qcMaterials": "Materiais de CQ", "qcRuns": "Execuções de CQ",
    "ljCharts": "Gráficos L-J", "qualityEvents": "Eventos de Qualidade",
    "instruments": "Instrumentos", "reagents": "Reagentes",
    "case": "Número do Caso", "pt": "Número PT", "mother": "Mãe",
    "clinic": "Clínica", "urgent": "Urgente", "progress": "Progresso",
    "createdAt": "Data de Criação",
    "protocols": "Protocolos", "documents": "Documentos",
    "searchDocuments": "Buscar documentos...",
    "selectDocumentType": "Selecionar tipo de documento",
    "documentType": "Tipo de Documento", "documentNumber": "Número do Documento",
    "title": "Título", "effectiveDate": "Data de Vigência",
    "training": "Treinamento", "auditLog": "Registro de Auditoria",
    "statistics": "Estatísticas", "operation": "Operação",
    "entity": "Entidade", "user": "Usuário",
    "ip": "IP", "time": "Hora", "change": "Alteração", "hash": "Hash",
    "bioinformatics": "Bioinformática", "analysisTasks": "Tarefas de Análise",
    "pipelineRegistration": "Registro de Pipeline", "pipeline": "Pipeline",
    "submitTime": "Hora de Envio", "completionTime": "Hora de Conclusão",
    "error": "Erro", "notifications": "Notificações",
    "quality": "Qualidade", "ptRounds": "Rodadas PT",
    "ptItems": "Itens PT", "internalAudit": "Auditoria Interna",
    "nipptRegistration": "Registro NIPPT",
    "peripheralBlood": "Sangue Periférico", "buccalSwab": "Swab Bucal",
    "hairFollicle": "Folículo Capilar", "driedBloodSpot": "Mancha de Sangue Seca",
}

def get_zh(en_str):
    key = string_to_key(en_str)
    return ZH_MAP.get(key, en_str)

def get_pt(en_str):
    key = string_to_key(en_str)
    return PT_MAP.get(key, en_str)


def find_function_ranges(lines):
    """Find all function body ranges as (start_line, end_line) tuples."""
    ranges = []
    func_stack = []  # stack of (start_line, name)
    brace_depth = 0
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Track braces
        for ch in stripped:
            if ch == "{":
                brace_depth += 1
            elif ch == "}":
                brace_depth -= 1
        
        # Detect function definitions
        if ("function " in stripped or "export default function" in stripped) and "(" in stripped:
            func_stack.append(i)
        
        # When braces return to pre-function level, function ends
        if brace_depth == 0 and func_stack:
            start = func_stack.pop()
            ranges.append((start, i))
    
    return ranges


def process_file(filepath, filename, all_strings):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    basename = filename.replace(".tsx", "")
    section = basename[0].lower() + basename[1:] if basename else basename
    
    has_use_translation = "useTranslation" in content
    lines = content.split("\n")
    
    # Find function boundaries
    func_ranges = find_function_ranges(lines)
    
    # Check which lines are inside functions
    inside_func = [False] * len(lines)
    for start, end in func_ranges:
        for i in range(start, end + 1):
            inside_func[i] = True
    
    replacements = []
    
    for i, line in enumerate(lines):
        if not inside_func[i]:
            continue
        
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        
        # ── title: "..." ──
        for match in re.finditer(r"""title:\s*['\"]([^'\"]+)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            if re.match(r'^[a-z_]+$', s) and len(s) < 10:
                continue
            if s in ("id", "key", "name", "type"):
                continue
            
            key = section + "." + string_to_key(s)
            old = 'title: "' + s + '"'
            new = 'title: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "title: '" + s + "'"
            new2 = "title: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── placeholder="..." ──
        for match in re.finditer(r"""placeholder=['\"]([^'\"]+?)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2 or "{" in s or "}" in s:
                continue
            if re.match(r'^[a-zA-Z0-9._-]+$', s) and len(s) < 8:
                continue
            
            key = section + "." + string_to_key(s)
            old = 'placeholder="' + s + '"'
            new = 'placeholder={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "placeholder='" + s + "'"
            new2 = "placeholder={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── header="..." ──
        for match in re.finditer(r"""header=['\"]([^'\"]+)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            key = section + "." + string_to_key(s)
            old = 'header="' + s + '"'
            new = 'header={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "header='" + s + "'"
            new2 = "header={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── message.*("...") ──
        for match in re.finditer(r"""message\.(?:success|error|warning|info)\s*\(\s*['\"]([^'\"]+)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 3:
                continue
            key = section + "." + string_to_key(s)
            old = '"' + s + '"'
            new = 't("' + key + '")'
            if old in line and "message." in stripped:
                replacements.append((i, old, new, key, s))
            old2 = "'" + s + "'"
            new2 = "t('" + key + "')"
            if old2 in line and "message." in stripped:
                replacements.append((i, old2, new2, key, s))
        
        # ── okText="..." ──
        for match in re.finditer(r"""okText=['\"]([^'\"]+)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            key = section + "." + string_to_key(s)
            old = 'okText="' + s + '"'
            new = 'okText={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "okText='" + s + "'"
            new2 = "okText={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── description="..." ──
        for match in re.finditer(r"""description:\s*['\"`]([^'\"`]+)['\"`]""", stripped):
            s = match.group(1)
            if not s or len(s) < 4 or "{" in s or "$" in s:
                continue
            key = section + "." + string_to_key(s)
            old = 'description: "' + s + '"'
            new = 'description: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "description: '" + s + "'"
            new2 = "description: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── tip="..." ──
        for match in re.finditer(r"""tip=['\"]([^'\"]+)['\"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 3:
                continue
            key = section + "." + string_to_key(s)
            old = 'tip="' + s + '"'
            new = 'tip={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new, key, s))
            old2 = "tip='" + s + "'"
            new2 = "tip={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))
        
        # ── Show buttons and labels between > and < ──
        for match in re.finditer(r""">([A-Z][A-Za-z0-9 /\-&]+?)<""", stripped):
            s = match.group(1).strip()
            if not s or len(s) < 2:
                continue
            if s in ("Space", "Tag", "Text", "Button", "Input", "Select"):
                continue
            key = section + "." + string_to_key(s)
            old = ">" + s + "<"
            new = ">{t(\"" + key + "\")}<"
            if old in line:
                replacements.append((i, old, new, key, s))
    
    # Deduplicate and apply (end to start)
    seen = set()
    unique = []
    for r in replacements:
        tag = (r[0], r[1])
        if tag not in seen:
            seen.add(tag)
            unique.append(r)
    
    unique.sort(key=lambda x: -x[0])
    for line_num, old, new, key, en_str in unique:
        lines[line_num] = lines[line_num].replace(old, new, 1)
        if en_str not in all_strings:
            all_strings[en_str] = {"key": key}
    
    modified = "\n".join(lines)
    
    # Add import if needed
    if not has_use_translation and unique:
        hook_import = 'import { useTranslation } from "../i18n/useTranslation";'
        # For hpv/ subdirectory files
        if "/hpv/" in filepath:
            hook_import = 'import { useTranslation } from "../../i18n/useTranslation";'
        
        new_lines = modified.split("\n")
        last_import = -1
        for idx, line in enumerate(new_lines):
            if line.strip().startswith("import "):
                last_import = idx
        if last_import >= 0:
            new_lines.insert(last_import + 1, hook_import)
        else:
            new_lines.insert(0, hook_import)
        modified = "\n".join(new_lines)
    
    # Add const { t } = useTranslation() to ALL function components that use t()
    for start, _ in func_ranges:
        # Check if this function uses t()
        func_uses_t = False
        func_has_hook = False
        for i in range(start, min(start + 400, len(lines))):
            if "const { t } = useTranslation()" in lines[i]:
                func_has_hook = True
            if 't("' in lines[i] or "t('" in lines[i]:
                func_uses_t = True
        
        if func_uses_t and not func_has_hook:
            new_lines = modified.split("\n")
            for j in range(start, min(start + 15, len(new_lines))):
                if "{" in new_lines[j]:
                    indent = len(new_lines[j]) - len(new_lines[j].lstrip())
                    hook_line = " " * (indent + 2) + "const { t } = useTranslation();"
                    new_lines.insert(j + 1, hook_line)
                    modified = "\n".join(new_lines)
                    break
    
    if unique:
        lines = modified.split("\n")
        for i in range(len(lines)):
            inside_func[i] = any(start <= i <= end for start, end in func_ranges)
    
    return modified, len(unique)


def main():
    en = load_json(os.path.join(I18N_DIR, "en.json"))
    zh = load_json(os.path.join(I18N_DIR, "zh.json"))
    pt = load_json(os.path.join(I18N_DIR, "pt.json"))
    
    all_strings = {}
    
    page_files = []
    for root, dirs, files in os.walk(PAGES_DIR):
        for f in files:
            if f.endswith(".tsx"):
                page_files.append(os.path.join(root, f))
    
    print("Found " + str(len(page_files)) + " page files")
    
    skip_files = ("AppRouter.tsx", "HpvRouter.tsx", "NipptRouter.tsx", "PublicRegister.tsx")
    
    total = 0
    for filepath in sorted(page_files):
        filename = os.path.basename(filepath)
        if filename in skip_files:
            print("  SKIP: " + filename)
            continue
        
        print("  Processing: " + filename + "...")
        try:
            modified, count = process_file(filepath, filename, all_strings)
            if count > 0:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(modified)
                print("    -> " + str(count) + " replacements")
                total += count
            else:
                print("    -> 0 replacements")
        except Exception as e:
            print("    ERROR: " + str(e))
            import traceback
            traceback.print_exc()
    
    print("\nTotal: " + str(total) + " replacements, " + str(len(all_strings)) + " unique strings")
    
    # Expand translations
    for en_str, info in all_strings.items():
        key = info["key"]
        parts = key.split(".")
        if len(parts) != 2:
            continue
        section_name, subkey = parts
        
        if section_name not in en:
            en[section_name] = {}
        en[section_name][subkey] = en_str
        
        if section_name not in zh:
            zh[section_name] = {}
        zh[section_name][subkey] = get_zh(en_str)
        
        if section_name not in pt:
            pt[section_name] = {}
        pt[section_name][subkey] = get_pt(en_str)
    
    save_json(os.path.join(I18N_DIR, "en.json"), en)
    save_json(os.path.join(I18N_DIR, "zh.json"), zh)
    save_json(os.path.join(I18N_DIR, "pt.json"), pt)
    
    print("Translation files updated")
    print("Done!")


if __name__ == "__main__":
    main()
