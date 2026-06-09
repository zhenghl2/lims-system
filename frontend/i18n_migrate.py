#!/usr/bin/env python3
"""
Comprehensive i18n migration script for LIMS frontend.
Scans all page TSX files for hardcoded strings, expands translation JSONs,
and replaces hardcoded strings with t("key") calls.
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
    """Convert a display string to a translation key (camelCase)."""
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", s)
    words = cleaned.strip().split()
    if not words:
        return "unknown"
    key = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    if len(key) > 50:
        key = key[:50]
    return key


# ─── Translation mappings ─────────────────────────────────────
ZH_MAP = {
    # Samples
    "sampleId": "样本ID", "patientId": "患者ID", "patientName": "患者姓名",
    "sampleType": "样本类型", "picture": "图片", "status": "状态",
    "receivedDate": "接收日期", "actions": "操作", "samples": "样本",
    "receiveSample": "接收样本", "batchCreate": "批量创建", "refresh": "刷新",
    "total": "总计", "receiveNewSample": "接收新样本", "editSample": "编辑样本",
    "rejectSample": "拒绝样本", "batchCreateSamples": "批量创建样本",
    "fillInEachRowToCreateASampleCollectionDateDefaultsToToday": "填写每一行以创建样本。默认采集日期为今天。",
    "addRow": "添加行", "save": "保存", "cancel": "取消", "receive": "接收",
    "delete": "删除", "edit": "编辑", "searchSampleIdOrPatientId": "搜索样本ID或患者ID...",
    "sampleTypeCode": "样本类型码", "panelInfo": "检测方案信息",
    "from": "开始日期", "to": "结束日期", "submitAll": "提交全部",
    "submitAllN": "提交全部", "deleteSample": "删除样本？",
    "thisWillDelete": "此操作将删除",
    "pleaseSelectASampleType": "请选择样本类型",
    "leaveBlankToAutoGenerate": "留空自动生成",
    "collectionDate": "采集日期", "orderingPhysician": "开单医生",
    "orderingFacility": "送检机构", "transportTemperature": "运输温度",
    "eg4cAmbient": "例：4℃，常温", "photoUploaded": "照片已上传",
    "uploadFailed": "上传失败", "view": "查看", "uploadPhoto": "上传照片",
    "accept": "接受", "reject": "拒绝", "accepted": "已接受",
    "failedToDeleteSample": "删除样本失败", "failedToAcceptSample": "接受样本失败",
    "failedToRejectSample": "拒绝样本失败", "failedToUpdateSample": "更新样本失败",
    "pleaseSelectARejectionReason": "请选择拒绝原因", "sampleUpdated": "样本已更新",
    "batchCreateFailed": "批量创建失败", "batchCreatedNSamples": "批量创建完成",
    "someRowsFailed": "部分行创建失败", "hemolyzed": "溶血",
    "insufficientVolume": "量不足", "wrongContainer": "容器错误",
    "labelingError": "标签错误", "temperatureExcursion": "温度异常",
    "expiredTransportTime": "运输超时", "reason": "原因",
    "additionalNotesOptional": "附加说明（可选）", "refreshed": "已刷新",
    "name": "姓名", "auto": "自动", "optional": "可选",
    "select": "请选择", "selectAPanel": "选择方案",
    "selectASampleType": "选择样本类型", "panel": "检测方案",
    "testPanel": "检测方案", "selectTestPanelOptional": "选择检测方案（可选）",
    "select": "选择...", "maternalPlasmaCfdnaStreckBct": "母血浆(cfDNA) — Streck BCT",
    "cervicalSwabPreservCyt": "宫颈拭子 — PreservCyt",
    "liquidBasedCytologySurePath": "液基细胞学 — SurePath",
    "cfdnaPlasma": "cfDNA (血浆)",
    "cervicalSwab": "宫颈拭子",
    "lbcSurePath": "LBC (SurePath)",
    "search": "搜索",
    "noPanelsConfigured": "未配置检测方案",
    "addTestPanelsToSeeDashboardStatistics": "添加检测方案以查看仪表盘统计。",
    "loadingDashboard": "加载仪表盘...",
    "received": "已接收", "inProcess": "处理中",
    "completed": "已完成", "reported": "已报告",
    "rejected": "已拒绝", "rejectedN": "已拒绝",
    "niptIncludingNiptPlus": "NIPT（含 NIPT_PLUS）",
    # Runs
    "runs": "运行", "sequencingRuns": "测序运行", "runNumber": "运行编号",
    "batchId": "批次ID", "sequencer": "测序仪", "planned": "计划日期",
    "createRun": "创建运行", "createNewRun": "创建新运行",
    "runCreatedSuccessfully": "运行创建成功", "failedToCreateRun": "创建运行失败",
    "failedToLoadRuns": "加载运行失败", "failedToDeleteRun": "删除运行失败",
    "searchRunNumber": "搜索运行编号...", "plannedDate": "计划日期",
    "pleaseSelectATestPanel": "请选择检测方案", "selectTestPanel": "选择检测方案",
    "selectSequencerOptional": "选择测序仪（可选）", "runBarcodeBatchId": "运行条码/批次ID",
    "optionalBarcodeForThisRun": "可选条码", "assignSamples": "分配样本",
    "loadingSamples": "加载样本中...", "availableSamples": "可用样本",
    "inThisRun": "在本运行中", "sampleConfiguration": "样本配置",
    "scanBarcode": "扫描条码", "well": "孔位", "index": "索引",
    "pool": "池", "notes": "备注", "runNotes": "运行备注...",
    "run": "运行", "close": "关闭", "protocol": "实验方案",
    "notAssigned": "未分配", "operator": "操作者", "started": "开始时间",
    "ended": "结束时间", "matrix": "矩阵", "workflowSteps": "工作流步骤",
    "results": "结果", "saveResults": "保存结果",
    "noSamplesInThisRun": "该运行中无样本", "noWorkflowStepsFound": "未找到工作流步骤",
    "loadingMatrix": "加载矩阵中...", "loadingSteps": "加载步骤中...",
    "loadingResults": "加载结果中...", "step": "步骤", "sample": "样本",
    "completed": "完成时间", "duration": "耗时", "performedBy": "执行者",
    "instrument": "仪器", "observations": "观察", "observationsNotes": "观察/备注",
    "egDnaConcentration": "例：DNA浓度 45 ng/μL, OD260/280 1.85",
    "reagentLotIds": "试剂批号", "egKit202406A": "例：KIT-202406-A, ENZ-202405-B",
    "instrumentUsed": "所用仪器", "selectInstrument": "选择仪器",
    "selectTechnicianDefaultYou": "选择技术人员（默认：你）",
    "deviationExceptionOccurred": "偏差/异常发生", "deviationNote": "偏差说明",
    "describeAnyDeviationFromSop": "描述任何与SOP的偏差...",
    "completeStep": "完成步骤", "record": "记录",
    "runCompleted": "运行已完成", "failedToCompleteRun": "完成运行失败",
    "advancedTo": "推进至", "failedToAdvanceStatus": "状态推进失败",
    "deleteRun": "删除运行？", "thisWillDeleteRunConfirm": "这将删除运行。确认？",
    "pleaseAssignAtLeastOneSampleToTheRun": "请至少分配一个样本到此运行",
    "failedToLoadCreateData": "创建数据加载失败",
    "failedToLoadRunDetails": "运行详情加载失败",
    "failedToUpdatePerformer": "执行者更新失败",
    "failedToStartStep": "步骤启动失败", "failedToCompleteStep": "步骤完成失败",
    "failedToSkipStep": "步骤跳过失败", "failedToSaveResults": "保存结果失败",
    "noPendingStepsToStart": "没有待启动的步骤",
    "noPendingStepsToSkip": "没有待跳过的步骤",
    "startedNSteps": "已启动步骤", "skippedNSteps": "已跳过步骤",
    "startedNFailedM": "已启动/失败", "skippedNFailedM": "已跳过/失败",
    "noResultsToSave": "没有可保存的结果", "resultsSaved": "结果已保存",
    "startAll": "全部启动", "skipAll": "全部跳过", "start": "启动",
    "skip": "跳过", "done": "完成", "complete": "完成",
    "stepNNameRightClickForBatch": "步骤（右键批量操作）",
    "startAllPendingStepsForThisSample": "启动此样本所有待处理步骤",
    "savedResults": "已保存结果", "saved": "已保存", "unsaved": "未保存",
    "dev": "偏差", "deviationReported": "已报告偏差",
    "enterTestResultsForEachSample": "输入每个样本的测试结果",
    "filterByStatus": "按状态筛选",
    "sampleId": "样本ID", "patient": "患者", "result": "结果",
    "ff": "FF %", "sex": "性别",
    "zScore13": "Z-Score 13", "zScore18": "Z-Score 18", "zScore21": "Z-Score 21",
    "totalNRuns": "总计运行数",
    "notAssigned": "未分配",
    # Dashboard
    "dashboard": "仪表盘",
    # Reports
    "reports": "报告", "draft": "草稿", "reviewed": "已审核",
    "verified": "已验证", "signed": "已签署", "released": "已发布",
    # Lab Workflow
    "labWorkflow": "实验室工作流", "allStatuses": "全部状态",
    "pending": "待处理", "inProgress": "处理中",
    "pendingQc": "等待QC", "failed": "失败",
    # QC
    "qcMaterials": "质控品", "qcRuns": "QC运行",
    "ljCharts": "L-J图表", "qualityEvents": "质量事件",
    # Instruments
    "instruments": "仪器",
    # Reagents
    "reagents": "试剂",
    # Cases
    "case": "案例编号", "pt": "PT编号", "mother": "母亲",
    "clinic": "诊所", "urgent": "加急", "progress": "进度",
    "createdAt": "创建时间", "casePtClinicSales": "Case / PT / 诊所 / 销售...",
    "all": "全部状态",
    # Protocols
    "protocols": "实验方案",
    # Documents
    "documents": "文档", "searchDocuments": "搜索文档...",
    "selectDocumentType": "选择文档类型", "documentType": "文档类型",
    "documentNumber": "文号", "title": "标题", "effectiveDate": "生效日期",
    "egSopGen001": "例：SOP-GEN-001",
    "egS3DocsSopGen001V1PdfOptional": "例：s3://docs/sop-gen-001-v1.pdf（可选）",
    # Training
    "training": "培训",
    # Audit Log
    "auditLog": "审计日志", "auditLogRecords": "日志记录",
    "statistics": "统计", "operation": "操作", "entity": "实体",
    "user": "用户", "ip": "IP", "time": "时间", "change": "变更",
    "hash": "哈希",
    # Bioinformatics
    "bioinformatics": "生物信息学", "analysisTasks": "分析任务",
    "pipelineRegistration": "流水线注册", "runNumberBioinfo": "运行编号",
    "pipeline": "流水线", "submitTime": "提交时间",
    "completionTime": "完成时间", "error": "错误",
    # Notifications
    "notifications": "通知",
    # Quality
    "quality": "质量", "ptRounds": "PT 轮次", "ptItems": "PT 项目",
    "internalAudit": "内部审计",
    # NIPPT
    "nipptRegistration": "NIPPT 登记", "peripheralBlood": "外周血",
    "buccalSwab": "口腔拭子", "hairFollicle": "毛囊",
    "driedBloodSpot": "干血片", "nipptReports": "NIPPT 报告",
    "pleaseEnterReviewerPassword": "请输入审核者密码",
    "queued": "排队中",
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
    "searchSampleIdOrPatientId": "Buscar ID da Amostra ou ID do Paciente...",
    "from": "De", "to": "Até", "submitAll": "Enviar Todos",
    "collectionDate": "Data de Coleta",
    "orderingPhysician": "Médico Solicitante",
    "orderingFacility": "Instituição Solicitante",
    "transportTemperature": "Temperatura de Transporte",
    "eg4cAmbient": "ex.: 4°C, ambiente",
    "photoUploaded": "Foto enviada", "uploadFailed": "Falha no envio",
    "uploadPhoto": "Enviar Foto", "view": "Ver", "accept": "Aceitar",
    "accepted": "Aceito", "reject": "Rejeitar",
    "reason": "Motivo", "additionalNotesOptional": "Notas adicionais (opcional)",
    "refreshed": "Atualizado", "name": "Nome", "auto": "Automático",
    "optional": "Opcional", "select": "Selecionar...",
    "loadingDashboard": "Carregando painel...",
    "noPanelsConfigured": "Nenhum painel configurado",
    "addTestPanelsToSeeDashboardStatistics": "Adicione painéis de teste para ver as estatísticas.",
    "received": "Recebido", "inProcess": "Em Processo",
    "completed": "Concluído", "reported": "Relatado", "rejected": "Rejeitado",
    "niptIncludingNiptPlus": "NIPT (incl. NIPT_PLUS)",
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
    "run": "Execução", "close": "Fechar", "protocol": "Protocolo",
    "notAssigned": "Não atribuído", "matrix": "Matriz",
    "workflowSteps": "Etapas do Fluxo", "results": "Resultados",
    "saveResults": "Salvar Resultados",
    "noSamplesInThisRun": "Nenhuma amostra nesta execução",
    "noWorkflowStepsFound": "Nenhuma etapa encontrada",
    "step": "Etapa", "sample": "Amostra",
    "started": "Iniciado", "completed": "Concluído",
    "duration": "Duração", "performedBy": "Executado Por",
    "instrument": "Instrumento", "observations": "Observações",
    "reagentLotIds": "IDs do Lote de Reagentes",
    "instrumentUsed": "Instrumento Usado",
    "selectInstrument": "Selecionar instrumento",
    "deviationExceptionOccurred": "Ocorreu desvio/exceção",
    "deviationNote": "Nota de Desvio",
    "describeAnyDeviationFromSop": "Descreva qualquer desvio do POP...",
    "completeStep": "Concluir Etapa", "record": "Registro",
    "startAll": "Iniciar Todos", "skipAll": "Pular Todos",
    "start": "Iniciar", "skip": "Pular", "done": "Concluído",
    "complete": "Concluir", "saved": "Salvo", "unsaved": "Não salvo",
    "sampleId": "ID da Amostra", "patient": "Paciente",
    "dashboard": "Painel", "reports": "Relatórios",
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
    "auditLogRecords": "Registros de Auditoria", "statistics": "Estatísticas",
    "operation": "Operação", "entity": "Entidade", "user": "Usuário",
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
    return ZH_MAP.get(key, "[ZH] " + en_str)


def get_pt(en_str):
    key = string_to_key(en_str)
    return PT_MAP.get(key, "[PT] " + en_str)


# ─── Main processing ────────────────────────────────────────────
def process_file(filepath, filename, all_strings_map):
    """Process a single TSX file, replacing hardcoded strings with t() calls."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    basename = filename.replace(".tsx", "")
    first_char_lower = basename[0].lower() + basename[1:] if basename else basename

    has_use_translation = "useTranslation" in content
    lines = content.split("\n")
    replacements = []

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("import") or stripped.startswith("const "):
            continue
        if stripped.startswith("type ") or stripped.startswith("interface "):
            continue

        # ── title: "..." ──
        for match in re.finditer(r"""title:\s*['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            if re.match(r'^[a-z_]+$', s) and len(s) < 10:
                continue
            if s in ("id", "key", "name", "type", "actions", "status", "total"):
                continue

            key = first_char_lower + "." + string_to_key(s)
            old = 'title: "' + s + '"'
            new_val = 'title: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new_val, key, s))

            old2 = "title: '" + s + "'"
            new2 = "title: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── placeholder="..." ──
        for match in re.finditer(r"""placeholder=['"]([^'"]+?)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            if "{" in s:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'placeholder="' + s + '"'
            new_val = 'placeholder={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "placeholder='" + s + "'"
            new2 = "placeholder={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── header="..." ──
        for match in re.finditer(r"""header=['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'header="' + s + '"'
            new_val = 'header={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "header='" + s + "'"
            new2 = "header={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── message.success/error/warning/info("...") ──
        for match in re.finditer(r"""message\.(?:success|error|warning|info)\s*\(\s*['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = '"' + s + '"'
            new_val = 't("' + key + '")'
            if old in line and "message." in stripped:
                replacements.append((i, old, new_val, key, s))
            old2 = "'" + s + "'"
            new2 = "t('" + key + "')"
            if old2 in line and "message." in stripped:
                replacements.append((i, old2, new2, key, s))

        # ── okText="..." ──
        for match in re.finditer(r"""okText=['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'okText="' + s + '"'
            new_val = 'okText={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "okText='" + s + "'"
            new2 = "okText={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── description="..." ──
        for match in re.finditer(r"""description:\s*['"`]([^'"`]+)['"`]""", stripped):
            s = match.group(1)
            if not s or len(s) < 3:
                continue
            if "{" in s or "}" in s or "$" in s:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'description: "' + s + '"'
            new_val = 'description: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "description: '" + s + "'"
            new2 = "description: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── tip="..." ──
        for match in re.finditer(r"""tip=['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 3:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'tip="' + s + '"'
            new_val = 'tip={t("' + key + '")}'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "tip='" + s + "'"
            new2 = "tip={t('" + key + "')}"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── label: "..." in tab/menu definitions ──
        for match in re.finditer(r"""label:\s*['"]([^'"]+?)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 2:
                continue
            if re.match(r'^[a-zA-Z0-9_]+$', s) and len(s) < 8:
                continue
            # Skip options arrays with label
            if "options" in stripped.lower() or "map" in stripped.lower():
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'label: "' + s + '"'
            new_val = 'label: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "label: '" + s + "'"
            new2 = "label: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

        # ── message="..." ──
        for match in re.finditer(r"""message:\s*['"]([^'"]+)['"]""", stripped):
            s = match.group(1)
            if not s or len(s) < 3:
                continue
            if "{" in s:
                continue
            key = first_char_lower + "." + string_to_key(s)
            old = 'message: "' + s + '"'
            new_val = 'message: t("' + key + '")'
            if old in line:
                replacements.append((i, old, new_val, key, s))
            old2 = "message: '" + s + "'"
            new2 = "message: t('" + key + "')"
            if old2 in line:
                replacements.append((i, old2, new2, key, s))

    # Deduplicate and apply replacements (end to start to preserve indices)
    seen = set()
    unique_replacements = []
    for r in replacements:
        tag = (r[0], r[1])
        if tag not in seen:
            seen.add(tag)
            unique_replacements.append(r)

    unique_replacements.sort(key=lambda x: -x[0])
    for line_num, old, new_val, key, en_str in unique_replacements:
        lines[line_num] = lines[line_num].replace(old, new_val, 1)
        if en_str not in all_strings_map:
            all_strings_map[en_str] = {"key": key}

    modified = "\n".join(lines)

    # Add useTranslation import if not already present and we made changes
    if not has_use_translation and unique_replacements:
        hook_import = 'import { useTranslation } from "../i18n/useTranslation";'
        # Find position for import
        last_import_idx = -1
        for idx, line in enumerate(lines):
            if line.strip().startswith("import "):
                last_import_idx = idx

        new_lines = list(lines)
        if last_import_idx >= 0:
            new_lines.insert(last_import_idx + 1, hook_import)
        else:
            new_lines.insert(0, hook_import)
        modified = "\n".join(new_lines)

    # Add const { t } = useTranslation() inside component function
    if not has_use_translation and unique_replacements:
        new_lines = modified.split("\n")
        for idx, line in enumerate(new_lines):
            if "export default function" in line:
                for j in range(idx, min(idx + 30, len(new_lines))):
                    if "{" in new_lines[j]:
                        indent = len(new_lines[j]) - len(new_lines[j].lstrip())
                        hook_line = " " * (indent + 2) + "const { t } = useTranslation();"
                        new_lines.insert(j + 1, hook_line)
                        modified = "\n".join(new_lines)
                        break
                break

    return modified, len(unique_replacements)


def main():
    en = load_json(os.path.join(I18N_DIR, "en.json"))
    zh = load_json(os.path.join(I18N_DIR, "zh.json"))
    pt = load_json(os.path.join(I18N_DIR, "pt.json"))

    all_strings = {}

    # Find all page files
    page_files = []
    for root, dirs, files in os.walk(PAGES_DIR):
        for f in files:
            if f.endswith(".tsx"):
                page_files.append(os.path.join(root, f))

    print("Found " + str(len(page_files)) + " page files")

    total_replacements = 0

    for filepath in page_files:
        filename = os.path.basename(filepath)

        # Skip files that are mostly routing or already fully translated
        skip_files = ("AppRouter.tsx", "Login.tsx", "NipptRouter.tsx",
                      "HpvRouter.tsx", "PublicRegister.tsx")
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
                total_replacements += count
            else:
                print("    -> 0 replacements")
        except Exception as e:
            print("    ERROR: " + str(e))
            import traceback
            traceback.print_exc()

    print("")
    print("Total replacements: " + str(total_replacements))
    print("Unique translation strings: " + str(len(all_strings)))

    # Expand translations
    for en_str, info in all_strings.items():
        key = info["key"]
        parts = key.split(".")
        if len(parts) != 2:
            continue
        section, subkey = parts

        if section not in en:
            en[section] = {}
        en[section][subkey] = en_str

        if section not in zh:
            zh[section] = {}
        zh[section][subkey] = get_zh(en_str)

        if section not in pt:
            pt[section] = {}
        pt[section][subkey] = get_pt(en_str)

    save_json(os.path.join(I18N_DIR, "en.json"), en)
    save_json(os.path.join(I18N_DIR, "zh.json"), zh)
    save_json(os.path.join(I18N_DIR, "pt.json"), pt)

    print("")
    print("Updated translation files:")
    print("  en.json: " + str(len(en)) + " sections")
    print("  zh.json: " + str(len(zh)) + " sections")
    print("  pt.json: " + str(len(pt)) + " sections")
    print("")
    print("Done!")


if __name__ == "__main__":
    main()
