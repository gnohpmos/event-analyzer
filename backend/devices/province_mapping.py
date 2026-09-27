"""
Province and Regional mapping module.
Maps the first 2 characters of device sys_name (hostname) to 77 Thailand provinces,
and aggregates provinces into standard Thailand geographical regions.
"""
import re
from typing import Tuple

# Standard 77 Thailand Provinces mapped by 2-letter uppercase code
PROVINCE_MAP = {
    'NW': 'นครสวรรค์',
    'SB': 'สระบุรี',
    'KP': 'กำแพงเพชร',
    'AY': 'พระนครศรีอยุธยา',
    'PI': 'พิจิตร',
    'PC': 'เพชรบูรณ์',
    'LB': 'ลพบุรี',
    'SH': 'สิงห์บุรี',
    'CN': 'ชัยนาท',
    'AT': 'อ่างทอง',
    'UN': 'อุทัยธานี',
    'CB': 'ชลบุรี',
    'RY': 'ระยอง',
    'JB': 'จันทบุรี',
    'CC': 'ฉะเชิงเทรา',
    'PA': 'ปราจีนบุรี',
    'SO': 'สระแก้ว',
    'TD': 'ตราด',
    'NY': 'นครนายก',
    'KK': 'ขอนแก่น',
    'NM': 'นครราชสีมา',
    'UD': 'อุดรธานี',
    'KS': 'กาฬสินธุ์',
    'CY': 'ชัยภูมิ',
    'NP': 'นครพนม',
    'BR': 'บุรีรัมย์',
    'MD': 'มุกดาหาร',
    'YT': 'ยโสธร',
    'RE': 'ร้อยเอ็ด',
    'LY': 'เลย',
    'SI': 'ศรีสะเกษ',
    'SN': 'สกลนคร',
    'SR': 'สุรินทร์',
    'NK': 'หนองคาย',
    'UB': 'อุบลราชธานี',
    'MK': 'มหาสารคาม',
    'AC': 'อำนาจเจริญ',
    'BG': 'บึงกาฬ',
    'NL': 'หนองบัวลำภู',
    'CM': 'เชียงใหม่',
    'LP': 'ลำปาง',
    'PL': 'พิษณุโลก',
    'CR': 'เชียงราย',
    'LN': 'ลำพูน',
    'PR': 'แพร่',
    'PY': 'พะเยา',
    'NA': 'น่าน',
    'UT': 'อุตรดิตถ์',
    'TK': 'ตาก',
    'SY': 'สุโขทัย',
    'MS': 'แม่ฮ่องสอน',
    'PT': 'ปทุมธานี',
    'BK': 'กรุงเทพมหานคร',
    'SP': 'สมุทรปราการ',
    'NB': 'นนทบุรี',
    'NS': 'นครศรีธรรมราช',
    'KB': 'กระบี่',
    'PG': 'พังงา',
    'PK': 'ภูเก็ต',
    'SD': 'สุราษฎร์ธานี',
    'SK': 'สงขลา',
    'ST': 'สตูล',
    'TR': 'ตรัง',
    'PU': 'พัทลุง',
    'PN': 'ปัตตานี',
    'YL': 'ยะลา',
    'NR': 'นราธิวาส',
    'RB': 'ราชบุรี',
    'KJ': 'กาญจนบุรี',
    'SU': 'สุพรรณบุรี',
    'NT': 'นครปฐม',
    'SA': 'สมุทรสาคร',
    'SS': 'สมุทรสงคราม',
    'PB': 'เพชรบุรี',
    'PJ': 'ประจวบคีรีขันธ์',
    'RN': 'ระนอง',
    'CP': 'ชุมพร',
}

# Mapping Thailand Province Code to 6 Geographical Regions
PROVINCE_TO_REGION = {
    # ภาคกลางและกรุงเทพฯ / ปริมณฑล (Central & Metropolitan)
    'BK': 'ภาคกลางและกรุงเทพฯ', 'NB': 'ภาคกลางและกรุงเทพฯ', 'PT': 'ภาคกลางและกรุงเทพฯ',
    'SP': 'ภาคกลางและกรุงเทพฯ', 'SA': 'ภาคกลางและกรุงเทพฯ', 'SS': 'ภาคกลางและกรุงเทพฯ',
    'NT': 'ภาคกลางและกรุงเทพฯ', 'AY': 'ภาคกลางและกรุงเทพฯ', 'SB': 'ภาคกลางและกรุงเทพฯ',
    'LB': 'ภาคกลางและกรุงเทพฯ', 'AT': 'ภาคกลางและกรุงเทพฯ', 'SH': 'ภาคกลางและกรุงเทพฯ',
    'CN': 'ภาคกลางและกรุงเทพฯ',
    
    # ภาคเหนือ (Northern)
    'CM': 'ภาคเหนือ', 'CR': 'ภาคเหนือ', 'LP': 'ภาคเหนือ', 'LN': 'ภาคเหนือ',
    'PY': 'ภาคเหนือ', 'PR': 'ภาคเหนือ', 'NA': 'ภาคเหนือ', 'MS': 'ภาคเหนือ',
    'UT': 'ภาคเหนือ', 'PL': 'ภาคเหนือ', 'SY': 'ภาคเหนือ', 'TK': 'ภาคเหนือ',
    'PI': 'ภาคเหนือ', 'KP': 'ภาคเหนือ', 'NW': 'ภาคเหนือ', 'UN': 'ภาคเหนือ',
    'PC': 'ภาคเหนือ',
    
    # ภาคตะวันออกเฉียงเหนือ (Northeastern)
    'KK': 'ภาคตะวันออกเฉียงเหนือ', 'NM': 'ภาคตะวันออกเฉียงเหนือ', 'UD': 'ภาคตะวันออกเฉียงเหนือ',
    'UB': 'ภาคตะวันออกเฉียงเหนือ', 'CY': 'ภาคตะวันออกเฉียงเหนือ', 'BR': 'ภาคตะวันออกเฉียงเหนือ',
    'SR': 'ภาคตะวันออกเฉียงเหนือ', 'SI': 'ภาคตะวันออกเฉียงเหนือ', 'RE': 'ภาคตะวันออกเฉียงเหนือ',
    'MK': 'ภาคตะวันออกเฉียงเหนือ', 'KS': 'ภาคตะวันออกเฉียงเหนือ', 'YT': 'ภาคตะวันออกเฉียงเหนือ',
    'AC': 'ภาคตะวันออกเฉียงเหนือ', 'SN': 'ภาคตะวันออกเฉียงเหนือ', 'NP': 'ภาคตะวันออกเฉียงเหนือ',
    'MD': 'ภาคตะวันออกเฉียงเหนือ', 'LY': 'ภาคตะวันออกเฉียงเหนือ', 'NK': 'ภาคตะวันออกเฉียงเหนือ',
    'NL': 'ภาคตะวันออกเฉียงเหนือ', 'BG': 'ภาคตะวันออกเฉียงเหนือ',
    
    # ภาคตะวันออก (Eastern)
    'CB': 'ภาคตะวันออก', 'RY': 'ภาคตะวันออก', 'JB': 'ภาคตะวันออก', 'TD': 'ภาคตะวันออก',
    'CC': 'ภาคตะวันออก', 'PA': 'ภาคตะวันออก', 'SO': 'ภาคตะวันออก', 'NY': 'ภาคตะวันออก',
    
    # ภาคใต้ (Southern)
    'SK': 'ภาคใต้', 'SD': 'ภาคใต้', 'NS': 'ภาคใต้', 'PK': 'ภาคใต้',
    'KB': 'ภาคใต้', 'PG': 'ภาคใต้', 'TR': 'ภาคใต้', 'PU': 'ภาคใต้',
    'ST': 'ภาคใต้', 'PN': 'ภาคใต้', 'YL': 'ภาคใต้', 'NR': 'ภาคใต้',
    'RN': 'ภาคใต้', 'CP': 'ภาคใต้',
    
    # ภาคตะวันตก (Western)
    'KJ': 'ภาคตะวันตก', 'RB': 'ภาคตะวันตก', 'PB': 'ภาคตะวันตก', 'PJ': 'ภาคตะวันตก',
    'SU': 'ภาคตะวันตก',
}

REGIONS_ORDER = [
    'ภาคกลางและกรุงเทพฯ',
    'ภาคเหนือ',
    'ภาคตะวันออกเฉียงเหนือ',
    'ภาคตะวันออก',
    'ภาคใต้',
    'ภาคตะวันตก',
    'ไม่ระบุพื้นที่'
]


def resolve_province(sys_name: str) -> Tuple[str, str]:
    """
    Extract first 2 alphabetical characters of sys_name and resolve to Thailand province.
    
    Returns:
        tuple (province_code, province_name)
        If not found or invalid: ('', '')
    """
    if not sys_name:
        return '', ''

    cleaned = sys_name.strip()

    # Find the first 2 letters (e.g., 'bk-cvlu-pe' -> 'BK', 'CR-R-NCS540' -> 'CR')
    match = re.match(r'^([a-zA-Z]{2})', cleaned)
    if not match:
        letters = re.findall(r'[a-zA-Z]', cleaned)
        if len(letters) >= 2:
            code = (letters[0] + letters[1]).upper()
        else:
            return '', ''
    else:
        code = match.group(1).upper()

    province_name = PROVINCE_MAP.get(code, '')
    if province_name:
        return code, province_name

    return '', ''


def get_region_for_province(province_code: str, sys_name: str = '') -> str:
    """
    Get Thailand geographical region for a given province code or hostname domain tag.
    """
    if province_code:
        code_upper = province_code.upper().strip()
        if code_upper in PROVINCE_TO_REGION:
            return PROVINCE_TO_REGION[code_upper]

    if sys_name:
        name_lower = sys_name.lower()
        if '.bkk.' in name_lower or '.central.' in name_lower:
            return 'ภาคกลางและกรุงเทพฯ'
        elif '.north.' in name_lower:
            return 'ภาคเหนือ'
        elif '.northeast.' in name_lower or '.isan.' in name_lower:
            return 'ภาคตะวันออกเฉียงเหนือ'
        elif '.east.' in name_lower:
            return 'ภาคตะวันออก'
        elif '.south.' in name_lower:
            return 'ภาคใต้'
        elif '.west.' in name_lower:
            return 'ภาคตะวันตก'

    return 'ไม่ระบุพื้นที่'
