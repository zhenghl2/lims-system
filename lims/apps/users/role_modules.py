"""角色权限 —— 模块清单定义。

权限模型：角色 = { 模块: {view: bool, edit: bool} }
  - view = 能看（菜单可见、列表/详情可读）
  - edit = 能改（新增/修改/删除等写操作）

设计要点：
  1. 模块清单集中定义在后端，前端通过接口拉取 —— 新增模块只改这一处
  2. superuser（admin）恒为全权限，不依赖本配置
  3. 未配置的模块 = 无权限（默认拒绝，安全）
  4. 后续要给某模块加更细的操作（如"审核"、"导出"），在此结构上扩展 action 即可

注意：当前这些权限只驱动**前端菜单与按钮的显示**（后端暂不做硬校验），
      以免误伤现有功能。后续若要收紧，可逐个接口按 module/action 校验。
"""

# 模块清单：(key, 中文名, 所属子系统分组)
MODULES = [
    # ── NIPT 子系统 ─────────────────────────────────────
    ("nipt_register",   "样本登记",     "NIPT"),
    ("nipt_samples",    "样本管理",     "NIPT"),
    ("nipt_receiving",  "样本签收",     "NIPT"),
    ("nipt_plasma",     "血浆分离",     "NIPT"),
    ("nipt_workflow",   "实验流程",     "NIPT"),
    ("nipt_reports",    "报告",         "NIPT"),

    # ── NIPPT 子系统 ────────────────────────────────────
    ("nippt_cases",     "案例管理",     "NIPPT"),
    ("nippt_register",  "案例登记",     "NIPPT"),
    ("nippt_bioinfo",   "生物信息学",   "NIPPT"),

    # ── HPV 子系统 ──────────────────────────────────────
    ("hpv",             "HPV 检测",     "HPV"),

    # ── 质量管理 ────────────────────────────────────────
    ("qc",              "质量控制",     "质量管理"),
    ("documents",       "文档",         "质量管理"),
    ("training",        "培训",         "质量管理"),
    ("quality",         "质量事件",     "质量管理"),
    ("audit",           "审计日志",     "质量管理"),

    # ── 资源管理 ────────────────────────────────────────
    ("instruments",     "仪器",         "资源管理"),
    ("reagents",        "试剂",         "资源管理"),

    # ── 平台功能 ────────────────────────────────────────
    ("notifications",   "通知",         "平台"),
    ("extensions",      "拓展功能",     "平台"),
    ("users",           "用户管理",     "平台"),
]

MODULE_KEYS = [m[0] for m in MODULES]

# 可授权的操作
ACTIONS = [
    ("view", "查看"),
    ("edit", "编辑"),
]

# 默认角色模板：新建角色时可一键套用
ROLE_TEMPLATES = {
    "sales": {
        "label": "销售",
        "description": "只看案例、能登记样本",
        "permissions": {
            "nippt_cases":    {"view": True,  "edit": False},
            "nippt_register": {"view": True,  "edit": True},
            "nipt_register":  {"view": True,  "edit": True},
        },
    },
    "technologist": {
        "label": "实验员",
        "description": "实验操作全流程",
        "permissions": {
            "nipt_samples":   {"view": True, "edit": True},
            "nipt_receiving": {"view": True, "edit": True},
            "nipt_plasma":    {"view": True, "edit": True},
            "nipt_workflow":  {"view": True, "edit": True},
            "nippt_cases":    {"view": True, "edit": True},
            "nippt_register": {"view": True, "edit": True},
            "hpv":            {"view": True, "edit": True},
        },
    },
    "qc_manager": {
        "label": "质控主管",
        "description": "质量管理相关",
        "permissions": {
            "qc":        {"view": True, "edit": True},
            "documents": {"view": True, "edit": True},
            "training":  {"view": True, "edit": True},
            "quality":   {"view": True, "edit": True},
            "audit":     {"view": True, "edit": False},
            "nippt_cases": {"view": True, "edit": False},
        },
    },
    "site_director": {
        "label": "站点负责人",
        "description": "站点全部业务数据（不含用户管理）",
        "permissions": {
            k: {"view": True, "edit": True}
            for k in MODULE_KEYS if k != "users"
        },
    },
}


def all_permissions():
    """全权限（admin 等价物）。"""
    return {k: {"view": True, "edit": True} for k in MODULE_KEYS}


def normalize_permissions(raw):
    """清洗前端传来的权限结构：只保留合法模块与布尔值。"""
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, val in raw.items():
        if key not in MODULE_KEYS or not isinstance(val, dict):
            continue
        entry = {}
        for akey, _label in ACTIONS:
            entry[akey] = bool(val.get(akey, False))
        if entry["view"] or entry["edit"]:
            # edit 隐含 view（能改必然能看）
            if entry["edit"]:
                entry["view"] = True
            out[key] = entry
    return out
