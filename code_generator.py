"""班级编码自动生成模块。"""

SEASON_CODES = {'暑假': 'S', '秋季': 'Q', '春季': 'C', '寒假': 'H'}

SUBJECT_CODES_QINGSHAO = {
    '博文': 'S', '双语': 'P', '益智': 'M'
}

GRADE_CODES_QINGSHAO = {
    'S3': '0', '幼儿园大班': '0',
    '一年级': '1', '二年级': '2', '三年级': '3',
    '四年级': '4', '五年级': '5', '六年级': '6',
}

CAMPUS_CODES = {
    '友邦': 'A', '友邦教学区': 'A', '友邦金融中心教学区': 'A',
    '映月湖': 'P', '映月湖教学区': 'P', '映月湖环宇城教学区': 'P',
    '新兆阳': 'Y', '新兆阳教学区': 'Y', '新兆阳广场教学区': 'Y',
    '新南万': 'N', '新南万教学区': 'N',
    '广佛智城': 'Z', '广佛智城教学区': 'Z',
    '富凯': 'F', '富凯教学区': 'F', '富凯广场教学区': 'F',
    '铂顿': 'B', '铂顿教学区': 'B', '铂顿城教学区': 'B',
    'IPARK': 'I', 'IPARK教学区': 'I', 'IPARK购物中心教学区': 'I',
    '北滘': 'J', '北滘教学区': 'J', '北滘悦然广场教学区': 'J',
    '禅西': 'C', '禅西教学区': 'C', '禅西环宇城教学区': 'C',
    '容桂': 'R', '容桂教学区': 'R', '容桂桂洲大道教学区': 'R',
}

GRADE_CODES_GAOZHI = {'初一': '1', '初二': '2', '初三': '3', '高一': '4', '高二': '5'}

SUBJECT_CODES_GAOZHI = {
    '数学': 'M', '英语': 'E', '语文': 'W', '物理': 'P', '化学': 'C',
    '生物': 'S', '政治': 'Z', '历史': 'L', '地理': 'D',
    '博文': 'W', '双语': 'E', '益智': 'M', '科学': 'C', '实践': 'P',
}


def get_campus_code(campus_name, config=None):
    code = (config or {}).get('campus_codes', {}).get(campus_name)
    if code:
        return code
    code = CAMPUS_CODES.get(campus_name)
    if code:
        return code
    stripped = (campus_name or '').replace('教学区', '').replace('购物中心', '').replace('广场', '').strip()
    return CAMPUS_CODES.get(stripped, '?')


def _next_code(prefix, existing_codes):
    max_seq = 0
    for code in existing_codes:
        if code and str(code).startswith(prefix):
            tail = str(code)[len(prefix):]
            if tail.isdigit() and len(tail) == 3:
                max_seq = max(max_seq, int(tail))
    return f'{prefix}{max_seq + 1:03d}'


def generate_code_qingshao(season, subject, grade, level, campus, existing_codes, config=None, fy='27'):
    season_code = SEASON_CODES.get(season, 'S')
    subject_code = SUBJECT_CODES_QINGSHAO.get(subject, 'X')
    grade_code = GRADE_CODES_QINGSHAO.get(grade, '0')
    campus_code = get_campus_code(campus, config=config)
    prefix = f'{fy}{season_code}{subject_code}{grade_code}{level or "A"}{campus_code}'
    return _next_code(prefix, existing_codes)


def generate_code_gaozhi(season, subject, grade, existing_codes, fy='27'):
    grade_code = GRADE_CODES_GAOZHI.get(grade, '5')
    season_code = SEASON_CODES.get(season, 'S')
    subject_code = SUBJECT_CODES_GAOZHI.get(subject, 'X')
    prefix = f'{grade_code}ZV{fy}{season_code}{subject_code}'
    return _next_code(prefix, existing_codes)


def generate_code(dept_id, season, subject, grade, level, campus, existing_codes, config=None, fy='27'):
    if dept_id == 'gaozhi':
        return generate_code_gaozhi(season, subject, grade, existing_codes, fy=fy)
    return generate_code_qingshao(season, subject, grade, level, campus, existing_codes, config=config, fy=fy)


def transform_code(code, dept_id, target_fy, target_season):
    """将班级编码转换为目标季度编码，保留尾号不变。"""
    target_season_code = SEASON_CODES.get(target_season, 'S')
    if not code or len(code) < 6:
        return code
    code = str(code)
    if dept_id == 'gaozhi':
        if len(code) >= 8 and code[1:3] == 'ZV':
            return f'{code[0]}ZV{target_fy}{target_season_code}{code[6:]}'
        if len(code) >= 6 and code[0:2].isdigit() and code[3] == 'Z':
            return f'{target_fy}{target_season_code}Z{code[4:]}'
        return code
    if len(code) >= 4 and code[0:2].isdigit():
        return f'{target_fy}{target_season_code}{code[3:]}'
    return code


def extract_target_fy(term_id):
    import re
    m = re.search(r'fy(\d+)', term_id or '')
    return m.group(1) if m else '27'
