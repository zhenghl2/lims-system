# -*- coding: utf-8 -*-
"""
NIPPT 巴西 PLANILHA DE ENVIO (xlsx) 解析模块
输出与 nippt_docx_parser.parse_docx_bytes 完全一致的结构：
    {seq(external_id=ClientCode), mother_name, mother_dob, mother_id_card,
     gestational_age_weeks, collection_date, collection_site, fathers[{name,id_card,sample_types}],
     sales_person, price, balance, gender_info, notes, expected_completion}
或抛 NipptXlsxParseError

Excel 约定：
- 第 1-2 行双语言表头(英文/葡语)，数据自第 3 行起
- 一行 = 一个母亲 + 一个疑父；同 Client Code 多行 = 同 Case 多疑父(自动合并)
- Test_Item 非 NIPPT 前缀 → 返回 {"_nipt": True, "test_item": ...}
"""
import io
import re
import datetime

import openpyxl

SAMPLE_TYPE_MAP = {
    "SANGUE": "BLOOD", "FTA": "DBS", "SWAB": "SWAB", "CABELO": "HAIR",
    "UNHA": "NAIL", "SEMEN": "SEMEN", "SÊMEN": "SEMEN",
    "ESCOVA": "TOOTHBRUSH", "CIGARRO": "CIGARETTE", "GARRAFA": "BOTTLE",
    "BARBA": "BEARD", "FIO DENTAL": "FLOSS", "CHICLETE": "GUM",
}

NOTE_TRANSLATIONS = [
    ("SEGUNDO SUPOSTO PAI", "第二位疑父"),
    ("PRIMEIRO SUPOSTO PAI", "第一位疑父"),
    ("RECOLETA GESTANTE SOLICITADA", "已要求孕妇重采"),
    ("AGUARDANDO AMOSTRA GESTANTE", "等待孕妇样本"),
    ("AMOSTRA DO SUPOSTO PAI", "疑父样本已到"),
    ("AMOSTRA DA GESTANTE", "孕妇样本已到"),
]

DATE_RE = re.compile(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})")


class NipptXlsxParseError(Exception):
    pass


def _to_text(v):
    """单元格 → 字符串（datetime/数字兼容）"""
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, datetime.date):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _parse_date_dmy(v):
    """从字符串提取第一个 DD/MM/YYYY 或 DD-MM-YYYY；失败返回 None"""
    s = _to_text(v)
    if not s:
        return None
    m = DATE_RE.search(s.replace("\xa0", " ").replace("\n", " "))
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime.date(y, mo, d)
    except ValueError:
        return None


def _map_gender(g):
    """Gender 列 → Yes/No/空（与 Word extract_gender_info 输出格式一致）"""
    g = (g or "").strip().lower()
    g = g.replace("\u00e3", "a")  # ã
    if g in ("sim", "yes", "s", "y"):
        return "Yes"
    if g in ("nao", "no", "n", "-"):
        return "No"
    return ""


def _map_sample_types(sm):
    """'SANGUE/FTA' / 'SANGUE / FTA' → ['BLOOD','DBS']；'-'/空 → ['BLOOD']"""
    s = _to_text(sm).upper()
    if not s or s == "-":
        return ["BLOOD"]
    result = []
    for part in re.split(r"[/+]", s):
        part = part.strip()
        # 常见带修饰词: 'SANGUE PERIFERICO' → SANGUE
        for key in ("FIO DENTAL", "PONTA DE CIGARRO"):
            if part.startswith(key):
                result.append(SAMPLE_TYPE_MAP[key])
                break
        else:
            base = part.replace("PERIFERICO", "").replace("PERIFÉRICO", "").strip()
            if base in SAMPLE_TYPE_MAP:
                result.append(SAMPLE_TYPE_MAP[base])
    return result if result else ["BLOOD"]


def _translate_notes(remarks):
    """葡语备注 → 中文（未识别保留原文），多条用 '；' 连接"""
    s = _to_text(remarks)
    if not s or s == "-":
        return ""
    parts = [p.strip() for p in re.split(r"[/;|]", s) if p.strip()]
    out = []
    for p in parts:
        up = p.upper()
        matched = next((cn for pt, cn in NOTE_TRANSLATIONS if pt in up), None)
        out.append(matched or p)
    return "；".join(out)


def _extract_gestational_week(v):
    """'9 SEMANAS' → 9；'8 SEMANAS 5 DIAS' → 8；失败 None"""
    s = _to_text(v)
    m = re.search(r"(\d{1,2})", s)
    if not m:
        return None
    try:
        w = int(m.group(1))
        return w if 1 <= w <= 45 else None
    except ValueError:
        return None


def _clean_money(v):
    """'R$ 2.550,00' → '2.550,00'；'-'/空 → ''"""
    s = _to_text(v)
    if not s or s == "-":
        return ""
    return s.replace("R$", "").strip()


def _first_part(v, sep="|"):
    """双值 'A | B' 取第一个（母亲值）"""
    s = _to_text(v)
    if not s:
        return ""
    return s.split(sep)[0].strip()


def parse_xlsx_bytes(data, filename=""):
    """解析 PLANILHA DE ENVIO xlsx → list[case-dict] 或抛异常"""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception as e:
        raise NipptXlsxParseError(f"{filename}: 无法读取 xlsx: {str(e)[:150]}")

    ws = wb[wb.sheetnames[0]] if wb.sheetnames else None
    if ws is None:
        raise NipptXlsxParseError(f"{filename}: 无工作表")

    cases = []          # 输出的 case 列表（仅 NIPPT）
    nipt_rows = []      # 跳过的 NIPT 行信息

    # 逐行读取，跳过表头（前2行）
    row_iter = ws.iter_rows(values_only=True)
    for _ in range(2):
        try:
            next(row_iter)
        except StopIteration:
            break

    def norm(v):
        return _to_text(v)

    for r in row_iter:
        if not r:
            continue
        test_item = norm(r[0]) if len(r) > 0 else ""
        client_code = norm(r[2]) if len(r) > 2 else ""
        seq = norm(r[1]) if len(r) > 1 else ""
        mother_name = norm(r[3]) if len(r) > 3 else ""
        mother_name2 = norm(r[4]) if len(r) > 4 else ""
        rg_f = norm(r[5]) if len(r) > 5 else ""
        father_name = norm(r[7]) if len(r) > 7 else ""
        rg_m = norm(r[8]) if len(r) > 8 else ""
        sm_type = norm(r[10]) if len(r) > 10 else ""
        dob = norm(r[11]) if len(r) > 11 else ""
        ga_raw = norm(r[12]) if len(r) > 12 else ""
        price = norm(r[13]) if len(r) > 13 else ""
        balance = norm(r[15]) if len(r) > 15 else ""
        coll_date = norm(r[19]) if len(r) > 19 else ""
        coll_site = norm(r[20]) if len(r) > 20 else ""
        fedex = norm(r[24]) if len(r) > 24 else ""
        due = norm(r[27]) if len(r) > 27 else ""
        gender = _map_gender(norm(r[31])) if len(r) > 31 else ""
        remarks = norm(r[32]) if len(r) > 32 else ""

        if not test_item and not client_code and not mother_name:
            continue  # 空行
        if not test_item:
            # 无 Test_Item 但有内容——视为未知跳过
            continue

        # NIPT / 其他 → 跳过标记
        if "NIPPT" not in test_item.upper():
            nipt_rows.append({"seq": seq, "test_item": test_item})
            continue

        # 归属 key：Client Code 优先，空则用 Seq
        group_key = client_code or seq
        father = None
        if father_name and father_name != "-":
            father = {
                "name": father_name,
                "id_card": rg_m,
                "sample_types": _map_sample_types(sm_type),
            }

        # 合并到已有 case（同 Client Code 多疑父）
        existing = next((c for c in cases if c["seq"] == group_key), None)
        if existing:
            if father:
                existing["fathers"].append(father)
            if not existing["notes"] and remarks:
                existing["notes"] = _translate_notes(remarks)
            continue

        cases.append({
            "seq": group_key,           # external_id = Client Code
            "client_code": client_code,
            "mother_name": mother_name or mother_name2,
            "mother_dob": _to_text(_parse_date_dmy(dob) or ""),
            "mother_id_card": rg_f,
            "gestational_age_weeks": _extract_gestational_week(ga_raw),
            "collection_date": _first_part(coll_date),
            "collection_site": _first_part(coll_site),
            "fathers": [father] if father else [],
            "sales_person": _agent_from_code(client_code, seq),
            "price": _clean_money(price),
            "balance": _clean_money(balance),
            "gender_info": gender,
            "fedex_no": fedex,
            "notes": _translate_notes(remarks),
            "remarks_raw": remarks,
            "expected_completion": _first_part(due),
        })

    wb.close()
    return cases, nipt_rows


def _agent_from_code(client_code, seq):
    """sales_person = Client Code 内 Agent 码（与 Word 解析同规则）"""
    if client_code:
        m = re.match(r"^VGBR([A-Z]{2,4})\d+", client_code)
        if m:
            return m.group(1)
    return ""


if __name__ == "__main__":
    import sys
    data = open(sys.argv[1], "rb").read()
    cs, nipt = parse_xlsx_bytes(data)
    print(f"cases={len(cs)} nipt={len(nipt)}")
    for c in cs:
        print(c["seq"], c["mother_name"][:20], c["gestational_age_weeks"], c["sales_person"], len(c["fathers"]))
