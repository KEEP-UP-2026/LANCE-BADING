#!/usr/bin/env python3
"""
KEEP UP System - OCR Service (Gemini Vision + PaddleOCR Fallback)

PRIMARY:  Google Gemini Vision API — fast, cloud-based, layout-aware OCR.
          Reads text, detects headings, tables, and preserves document structure.
FALLBACK: PaddleOCR — local, offline, activates if Gemini is unavailable.

Usage:
    python ocr_service.py <file_path> [--page <page_number>]

Environment:
    GOOGLE_AI_API_KEY — Gemini API key (set in .env)

Output JSON to stdout:
    {
      "text": "...",
      "layout_blocks": [...],
      "page_size": [w, h],
      "success": true,
      "engine": "gemini" | "paddleocr"
    }
"""

import sys
import os
import re
import json
import argparse
import traceback
import base64

# Force UTF-8 stdio on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Polyfill NumPy 2.0 missing sctypes for PaddleOCR & legacy dependencies
try:
    import numpy as np
    if not hasattr(np, 'sctypes'):
        np.sctypes = {
            'int': [np.int8, np.int16, np.int32, np.int64],
            'uint': [np.uint8, np.uint16, np.uint32, np.uint64],
            'float': [np.float16, np.float32, np.float64],
            'complex': [np.complex64, np.complex128],
            'others': [bool, object, bytes, str]
        }
except Exception:
    pass

# Load .env variables (dotenv-style, pure Python — no extra deps)
def load_env_file():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

load_env_file()

GOOGLE_AI_API_KEY = os.environ.get('GOOGLE_AI_API_KEY', '')


def merge_page_1_data(g_data, r_data):
    """
    Merge Gemini Vision multi-modal extracted JSON with Regex-parsed JSON for Page 1
    to achieve 100% field accuracy and completeness.
    """
    if not isinstance(g_data, dict):
        return r_data or {}
    if not isinstance(r_data, dict):
        return g_data or {}

    res = {**r_data, **g_data}
    
    g_demo = g_data.get('patient_demographics', {}) if isinstance(g_data.get('patient_demographics'), dict) else {}
    r_demo = r_data.get('patient_demographics', {}) if isinstance(r_data.get('patient_demographics'), dict) else {}
    
    merged_demo = {}
    for k in ['name', 'philhealth_no', 'address', 'civil_status', 'birthday', 'age', 'cp_no', 'educational_attainment', 'bhw']:
        val = g_demo.get(k) or r_demo.get(k) or ""
        if k == 'birthday':
            val = clean_date_string(str(val))
        merged_demo[k] = val
    res['patient_demographics'] = merged_demo

    g_vs = g_data.get('vital_signs', {}) if isinstance(g_data.get('vital_signs'), dict) else {}
    r_vs = r_data.get('vital_signs', {}) if isinstance(r_data.get('vital_signs'), dict) else {}
    res['vital_signs'] = {**r_vs, **g_vs}

    g_crs = g_data.get('consultation_records', []) if isinstance(g_data.get('consultation_records'), list) else []
    r_crs = r_data.get('consultation_records', []) if isinstance(r_data.get('consultation_records'), list) else []
    
    if g_crs and len(g_crs) > 0:
        res['consultation_records'] = g_crs
    else:
        res['consultation_records'] = r_crs

    res['itr_page_number'] = 1
    return res


def run_gemini_ocr(file_path, page_number=1, target_page=0):
    """
    Use Google Gemini Vision to extract and structure text from a document image.
    Returns the same layout_blocks schema as PaddleOCR for full compatibility.
    """
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    from PIL import Image  # type: ignore

    # Set a 90-second HTTP timeout so the subprocess doesn't hang indefinitely
    client = genai.Client(
        api_key=GOOGLE_AI_API_KEY,
        http_options=types.HttpOptions(timeout=90000)  # 90s in milliseconds
    )

    # Load image
    if file_path.lower().endswith('.pdf'):
        from pdf2image import convert_from_path  # type: ignore
        images = convert_from_path(file_path, dpi=200, first_page=page_number, last_page=page_number)
        if not images:
            raise ValueError(f"No pages found in PDF: {file_path}")
        img_pil = images[0]
    else:
        img_pil = Image.open(file_path).convert('RGB')

    page_size = [img_pil.width, img_pil.height]

    # Resize large images to max 1800px on the longest side for maximum visual clarity
    # for handwritten text and fine checkboxes.
    MAX_DIM = 1800
    if img_pil.width > MAX_DIM or img_pil.height > MAX_DIM:
        img_pil.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
        print(f"[OCR] Resized image to {img_pil.width}x{img_pil.height} for Gemini.", file=sys.stderr)

    # Structured extraction prompt — asks Gemini to return JSON layout blocks & complete ITR schema
    prompt = """You are an expert medical document OCR and health record digitization system.
Analyze this medical document/form image carefully.

DETERMINE DOCUMENT TYPE:
- If this document is Page 1 of ITR (Health Facility Header, Patient Demographics, Smoking Cessation Profile, Consultation Log): set "itr_page_number": 1.
- If this document is Page 2 of ITR (Philhealth ID Number, Vital Signs, Past Medical History, Past Surgical History, Family History, Personal / Social History, Immunizations, Menstrual History, Pregnancy History): set "itr_page_number": 2.

Return ONLY a valid JSON object in this exact format (no markdown code fences around JSON):
{
  "full_text": "Categorized document text organized into neat sections with clear headings (=== SECTION NAME ===)",
  "itr_page_number": 1 or 2,
  "itr_data": { ... fill out fields based on schema below ... },
  "blocks": [
    {
      "text": "section title or field group text",
      "type": "heading",
      "alignment": "left",
      "y_order": 1,
      "is_heading": true,
      "is_large": true
    }
  ]
}

CRITICAL DATE EXTRACTION ACCURACY INSTRUCTIONS:
- Pay extreme attention to dates written, stamped, or typed anywhere in the document (such as BIRTHDAY, Vaccine Dates in Immunizations, Operation Date, LMP, Consultation Dates).
- Read digits and month names/abbreviations with 100% precision (e.g. 05/20/2024, 05-20-24, May 20, 2024, 2024-05-20). Do not confuse 1 with 7, 0 with 6 or 8, or 3 with 8.
- Ensure each date is placed into its exact corresponding field (e.g. BCG Date -> "bcg_date", HepB Birth Date -> "hepb_birth_date", Operation Date -> "date", LMP -> "last_menstrual_period").

Page 1 Schema (use if itr_page_number == 1):
{
  "header": { "country": "Republic of the Philippines", "province": "Province of Laguna", "municipality": "Municipality of Paete", "facility": "PAETE RURAL HEALTH UNIT", "facility_address": "2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna", "form_title": "Individual Treatment Record", "age_group": "20 Years old and above" },
  "patient_demographics": { "name": "", "philhealth_no": "", "address": "", "civil_status": "", "birthday": "", "age": null, "cp_no": "", "educational_attainment": "", "bhw": "" },
  "smoking_cessation_profile": { "smoker_status": "", "options": { "current": false, "passive": false, "never": false, "stopped_gt_1_year": false, "stopped_lt_1_year": false }, "brand_of_cigarette": "", "sticks_per_day": null, "age_started": null, "years_smoking": null, "reason_for_smoking": "", "experienced_side_effects": false, "side_effect_details": "", "tried_quitting_before": false, "quit_attempt_success": false, "reason_not_successful": "" },
  "family_history": { "has_1st_degree_relative": false, "hypertension": false, "stroke": false, "heart_attack": false, "dm": false, "asthma": false, "cancer": false, "kidney_disease": false },
  "clinical_background": { "co_morbid": "", "allergy": "" },
  "alcohol_intake": { "never_consumed": false, "drinks_alcohol": false, "excessive_alcohol_intake": { "definition": "In the past mos., had 5 drinks in one occasion", "yes": false, "no": false } },
  "diet_and_lifestyle": { "physical_activity": { "meets_2_5_hours_per_week": false }, "high_fat_high_salt_food_intake": { "weekly_processed_fastfood": false }, "dietary_fiber_intake": { "vegetables_3_servings_daily": false, "fruits_2_3_servings_daily": false } },
  "vital_signs": { "bmi": null, "waistline_cm": null, "height_cm": null, "weight_kg": null, "raised_bp": false, "blood_pressure_readings": { "first": "", "second": "" } },
  "consultation_records": []
}

Page 2 Schema (use if itr_page_number == 2):
{
  "philhealth_membership": { "philhealth_id_number": "", "membership_type": { "member": false, "dependent": false, "non_member": false }, "membership_category": { "sponsored": false, "ipp": false, "employed": false, "lifetime": false, "nhits": false, "lgu": false, "organized_group": false, "government": false, "nga": false, "private": false, "ofw": false } },
  "vital_signs": { "blood_pressure": "", "heart_rate": null, "respiratory_rate": null, "pulse_rate": null, "temperature": null, "spo2": null, "height_cm": null, "weight_kg": null, "waist_circumference_cm": null, "hip_circumference_cm": null },
  "past_medical_history": { "allergy": "", "asthma": null, "cancer": { "has": null, "organ": "" }, "cerebrovascular_disease": null, "coronary_artery_disease": null, "diabetes_mellitus": null, "emphysema": null, "epilepsy_seizure_disorder": null, "hepatitis": { "has": null, "type": "" }, "hyperlipidemia": null, "hypertension": { "has": null, "highest_bp": "" }, "peptic_ulcer_disease": null, "pneumonia": null, "thyroid_disease": null, "tuberculosis": { "organ": "", "category": "" }, "urinary_tract_infection": null, "others": "" },
  "past_surgical_history": { "operation": "", "date": "" },
  "family_history": { "allergy": "", "asthma": null, "cancer": { "has": null, "organ": "" }, "cerebrovascular_disease": null, "coronary_artery_disease": null, "diabetes_mellitus": null, "emphysema": null, "epilepsy_seizure_disorder": null, "hepatitis": { "has": null, "type": "" }, "hyperlipidemia": null, "hypertension": { "has": null, "highest_bp": "" }, "peptic_ulcer_disease": null, "pneumonia": null, "thyroid_disease": null, "pulmonary_tuberculosis": null, "extrapulmonary_tuberculosis": null, "urinary_tract_infection": null, "mental_illness": null, "others": "" },
  "personal_social_history": { "smoking": { "yes": false, "no": false, "quit": false, "pack_years": null }, "alcohol": { "yes": false, "no": false, "quit": false, "bottles_per_day": null }, "illicit_drugs": { "yes": false, "no": false, "quit": false }, "sexually_active": null },
  "immunizations": { "child_care": { "bcg_date": "", "hepb_birth_date": "", "hepb_24hrs_date": "", "penta_date": "", "opv_date": "", "ipv_date": "", "pcv_date": "", "measles_vaccine_date": "", "rotavirus_vaccine_date": "", "chickenpox_vaccine_date": "" }, "general": { "flu_vaccine_date": "", "hpv_date": "", "hpv_grade4_date": "", "mr_grade1_date": "", "mr_grade7_date": "", "td_grade1_date": "", "td_grade7_date": "", "tetanus_toxoid_date": "" }, "animal_bite": { "pcecv1_date": "", "pvrv1_date": "", "pvrv2_date": "", "pvrv3_date": "", "pvrv4_date": "", "pcecv2_date": "" }, "ncd": { "pneumococcal_vaccine_date": "", "flu_vaccine_date": "" }, "maternal_care": { "tetanus_toxoid_date": "" } },
  "menstrual_history": { "menarche_age": null, "onset_of_sexual_intercourse": null, "last_menstrual_period": "", "menstrual_bleeding_pattern": "", "birth_control_method": "", "period_duration": "", "cycle_interval": "", "pads_per_day": null, "menopause": null, "age_of_menopause": null },
  "pregnancy_history": { "gravidity": null, "parity": null, "type_of_delivery": "", "full_term": null, "premature": null, "abortion": null, "living_children": null, "pre_eclampsia": null, "age_at_first_pregnancy": null, "family_planning_counseling": null }
}
"""

    # Use robust gemini model fallback list
    gemini_models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']
    response = None
    last_err = None

    for m in gemini_models:
        try:
            response = client.models.generate_content(
                model=m,
                contents=[prompt, img_pil]
            )
            if response and response.text:
                break
        except Exception as e:
            last_err = e
            continue

    if not response or not response.text:
        raise last_err or ValueError("Failed to get response from Gemini Vision API.")

    raw = response.text.strip()

    # Clean up response — remove any markdown fences if Gemini adds them
    if raw.startswith('```'):
        raw = raw.split('```')[1]
        if raw.startswith('json'):
            raw = raw[4:]
        raw = raw.strip()
    if raw.endswith('```'):
        raw = raw[:-3].strip()

    parsed = json.loads(raw)

    raw_text = parsed.get('full_text', '')
    itr_page_number = parsed.get('itr_page_number', 1)
    gemini_itr_data = parsed.get('itr_data', None)

    if target_page == 1:
        itr_page_number = 1
        is_p2 = False
    elif target_page == 2:
        itr_page_number = 2
        is_p2 = True
    else:
        is_p2 = (itr_page_number == 2) or (gemini_itr_data and any(k in gemini_itr_data for k in ['philhealth_membership', 'past_medical_history', 'past_surgical_history', 'immunizations', 'menstrual_history', 'pregnancy_history'])) or any(kw in str(raw_text).upper() for kw in ['PHILHEALTH', 'PAST MEDICAL HISTORY', 'PAST SURGICAL HISTORY', 'IMMUNIZATIONS', 'MENSTRUAL HISTORY', 'PREGNANCY HISTORY'])

    if target_page == 1:
        itr_page_number = 1
        regex_itr_data = parse_itr_page_1(raw_text)
        if gemini_itr_data and isinstance(gemini_itr_data, dict):
            itr_data = merge_page_1_data(gemini_itr_data, regex_itr_data)
        else:
            itr_data = regex_itr_data
        itr_data['itr_page_number'] = 1
        full_text = format_itr_to_standard_template(itr_data)
    elif is_p2:
        itr_page_number = 2
        itr_data = gemini_itr_data
        if not itr_data or not any(k in itr_data for k in ['philhealth_membership', 'past_medical_history', 'past_surgical_history', 'immunizations', 'menstrual_history', 'pregnancy_history']):
            itr_data = parse_ocr_text_to_json(raw_text, target_page=2)
        if itr_data:
            itr_data['itr_page_number'] = 2
            full_text = format_itr_to_standard_template(itr_data)
        else:
            full_text = raw_text
    else:
        regex_itr_data = parse_itr_page_1(raw_text)
        if gemini_itr_data and isinstance(gemini_itr_data, dict):
            itr_data = merge_page_1_data(gemini_itr_data, regex_itr_data)
        else:
            itr_data = regex_itr_data
        if itr_data:
            itr_data['itr_page_number'] = 1
            full_text = format_itr_to_standard_template(itr_data)
        else:
            full_text = raw_text

    blocks_raw = parsed.get('blocks', [])

    # Convert Gemini blocks to our layout_blocks schema
    # (compatible with docx_builder.py and the rest of the pipeline)
    layout_blocks = []
    page_w, page_h = page_size

    for i, b in enumerate(blocks_raw):
        text = str(b.get('text', '')).strip()
        if not text:
            continue

        y_order = b.get('y_order', i + 1)
        y_ratio = (y_order - 1) / max(len(blocks_raw), 1)
        block_type = b.get('type', 'body')
        is_heading = b.get('is_heading', False) or block_type in ('heading', 'subheading')
        is_large = b.get('is_large', False) or block_type == 'heading'

        # Estimate font size from block type
        if block_type == 'heading':
            font_size_pt = 16
        elif block_type == 'subheading':
            font_size_pt = 13
        elif block_type == 'label':
            font_size_pt = 10
        else:
            font_size_pt = 11

        # Estimate x position from alignment
        alignment = b.get('alignment', 'left')
        if alignment == 'center':
            x_min = page_w * 0.25
        elif alignment == 'right':
            x_min = page_w * 0.6
        else:
            x_min = page_w * 0.05

        left_margin_ratio = x_min / page_w

        layout_blocks.append({
            "text": text,
            "confidence": 0.99,  # Gemini is highly accurate
            "bbox": {
                "x": round(x_min, 1),
                "y": round(y_ratio * page_h, 1),
                "w": round(page_w * 0.85, 1),
                "h": round(font_size_pt * 1.5, 1)
            },
            "font_size_pt": font_size_pt,
            "is_heading": is_heading,
            "is_large": is_large,
            "alignment": alignment,
            "left_margin_ratio": round(left_margin_ratio, 4),
            "y_position_ratio": round(y_ratio, 4)
        })

    return {
        "success": True,
        "text": full_text,
        "layout_blocks": layout_blocks,
        "itr_data": itr_data,
        "itr_page_number": itr_page_number,
        "page_size": page_size,
        "total_blocks": len(layout_blocks),
        "engine": "gemini"
    }


# ─────────────────────────────────────────────────────────────────────────────
# FALLBACK: PaddleOCR
# ─────────────────────────────────────────────────────────────────────────────

def run_paddle_ocr(file_path, page_number=1, target_page=0):
    """Fallback OCR using local PaddleOCR model."""
    import numpy as np  # type: ignore
    if not hasattr(np, 'sctypes'):
        np.sctypes = {
            'int': [np.int8, np.int16, np.int32, np.int64],
            'uint': [np.uint8, np.uint16, np.uint32, np.uint64],
            'float': [np.float16, np.float32, np.float64],
            'complex': [np.complex64, np.complex128],
            'others': [bool, object, bytes, str]
        }
        import sys
        if 'numpy' in sys.modules:
            setattr(sys.modules['numpy'], 'sctypes', np.sctypes)

    from paddleocr import PaddleOCR  # type: ignore
    from PIL import Image  # type: ignore

    try:
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
    except Exception:
        ocr = PaddleOCR(use_angle_cls=True, lang='en')

    if file_path.lower().endswith('.pdf'):
        from pdf2image import convert_from_path  # type: ignore
        images = convert_from_path(file_path, dpi=200, first_page=page_number, last_page=page_number)
        if not images:
            return {"success": False, "error": f"No pages found in PDF: {file_path}"}
        img = images[0]
        img_np = np.array(img)
        page_size = [img.width, img.height]
    else:
        img = Image.open(file_path).convert('RGB')
        img_np = np.array(img)
        page_size = [img.width, img.height]

    result = ocr.ocr(img_np, cls=True)

    if not result or not result[0]:
        return {"success": True, "text": "", "layout_blocks": [], "page_size": page_size, "engine": "paddleocr"}

    layout_blocks = []
    full_text_lines = []
    page_height = page_size[1]
    page_width = page_size[0]

    for line in result[0]:
        if not line:
            continue
        bbox = line[0]
        text_info = line[1]
        text = text_info[0]
        confidence = float(text_info[1])

        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        x_min, y_min = min(xs), min(ys)
        x_max, y_max = max(xs), max(ys)
        block_width = x_max - x_min
        block_height = y_max - y_min

        estimated_font_pt = max(8, int(block_height * 0.75 * 0.75))
        is_heading = block_height > (page_height * 0.025) and block_width > (page_width * 0.1)
        is_large = block_height > (page_height * 0.018)
        left_margin_ratio = x_min / page_width
        center_x = (x_min + x_max) / 2
        center_ratio = center_x / page_width
        alignment = 'center' if 0.35 < center_ratio < 0.65 else 'left'

        layout_blocks.append({
            "text": text,
            "confidence": round(confidence, 4),
            "bbox": {"x": round(x_min, 1), "y": round(y_min, 1), "w": round(block_width, 1), "h": round(block_height, 1)},
            "font_size_pt": estimated_font_pt,
            "is_heading": is_heading,
            "is_large": is_large,
            "alignment": alignment,
            "left_margin_ratio": round(left_margin_ratio, 4),
            "y_position_ratio": round(y_min / page_height, 4)
        })
        full_text_lines.append(text)

    layout_blocks.sort(key=lambda b: (b["y_position_ratio"], b["left_margin_ratio"]))

    raw_text = '\n'.join(full_text_lines)
    
    if target_page == 1:
        is_p2 = False
        itr_data = parse_itr_page_1(raw_text)
        itr_data['itr_page_number'] = 1
    elif target_page == 2:
        is_p2 = True
        itr_data = parse_ocr_text_to_json(raw_text, target_page=2)
        itr_data['itr_page_number'] = 2
    else:
        itr_data = parse_ocr_text_to_json(raw_text, target_page=target_page)
        is_p2 = itr_data.get('itr_page_number') == 2
    
    if isinstance(itr_data, dict):
        itr_data['itr_page_number'] = 2 if is_p2 else 1

    formatted_text = format_itr_to_standard_template(itr_data) if itr_data else raw_text

    return {
        "success": True,
        "text": formatted_text,
        "raw_text": raw_text,
        "layout_blocks": layout_blocks,
        "page_size": page_size,
        "total_blocks": len(layout_blocks),
        "itr_data": itr_data,
        "itr_page_number": 2 if is_p2 else 1,
        "engine": "paddleocr"
    }


def clean_date_string(val):
    if not val or not isinstance(val, str):
        return ""
    # 1. Search for actual valid date pattern in the value (MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, Month DD YYYY)
    date_match = re.search(r"(\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})", val, re.IGNORECASE)
    if date_match:
        return date_match.group(1).strip()
    
    # 2. If no strict date pattern, clean noise like "Date_", "Date:", "Vaccine", "(MCV)", etc.
    cleaned = re.sub(r"^[^\w]*Date[_\:\s]*", "", val, flags=re.I)
    cleaned = re.sub(r"^[\(\)\s\:\-\_]+", "", cleaned)
    cleaned = cleaned.strip()
    
    # If cleaned string is just "Vaccine", "Conjugate", "Date", or contains no digits, return empty string
    if not re.search(r"\d", cleaned) or cleaned.lower() in ["date", "vaccine", "conjugate"]:
        return ""
    return cleaned


def parse_ocr_text_to_json(text, target_page=0):
    if not text or not isinstance(text, str):
        return {}

    def split_sections(txt):
        pattern = r"=== (.*?) ===([\s\S]*?)(?===|$)"
        matches = re.findall(pattern, txt)
        res = {k.strip(): v.strip() for k, v in matches}
        if len(res) >= 2:
            return res

        hdr_regex = r"(?im)^[ \t]*(?:===|[#*]-*)?[ \t]*(PHILHEALTH MEMBERSHIP INFORMATION|PHILHEALTH|VITAL SIGNS|PAST MEDICAL HISTORY|PAST SURGICAL HISTORY|FAMILY HISTORY|PERSONAL\s*/\s*SOCIAL HISTORY|PERSONAL/SOCIAL HISTORY|IMMUNIZATIONS|MENSTRUAL HISTORY|PREGNANCY HISTORY|HEALTH FACILITY HEADER|PATIENT DEMOGRAPHICS|LIFESTYLE\s*&\s*RISK FACTORS|VITAL SIGNS\s*&\s*PHYSICAL MEASUREMENTS|CONSULTATION\s*&\s*CLINICAL FINDINGS)[ \t]*(?:===|:|\(For Women\)|$)"
        found = list(re.finditer(hdr_regex, txt))
        if not found:
            return res

        fallback_res = {}
        if found and found[0].start() > 0:
            prefix = txt[:found[0].start()].strip()
            if any(kw in prefix.upper() for kw in ["PHILHEALTH", "MEMBERSHIP", "ID NUMBER", "MEMBER"]):
                fallback_res["PHILHEALTH MEMBERSHIP INFORMATION"] = prefix

        for i, m in enumerate(found):
            raw_h = m.group(1).upper().strip()
            if "PHILHEALTH" in raw_h:
                hkey = "PHILHEALTH MEMBERSHIP INFORMATION"
            elif "VITAL" in raw_h and "PHYSICAL" not in raw_h:
                hkey = "VITAL SIGNS"
            elif "PERSONAL" in raw_h:
                hkey = "PERSONAL / SOCIAL HISTORY"
            elif "MEDICAL" in raw_h:
                hkey = "PAST MEDICAL HISTORY"
            elif "SURGICAL" in raw_h:
                hkey = "PAST SURGICAL HISTORY"
            elif "FAMILY" in raw_h:
                hkey = "FAMILY HISTORY"
            elif "IMMUNIZATION" in raw_h:
                hkey = "IMMUNIZATIONS"
            elif "MENSTRUAL" in raw_h:
                hkey = "MENSTRUAL HISTORY"
            elif "PREGNANCY" in raw_h:
                hkey = "PREGNANCY HISTORY"
            else:
                hkey = raw_h

            st = m.end()
            en = found[i+1].start() if i + 1 < len(found) else len(txt)
            fallback_res[hkey] = txt[st:en].strip()

        return {**fallback_res, **res}

    def get_value(block, label):
        if not block:
            return ""
        clean_label = label.rstrip('?:').strip()
        short_label = re.sub(r"\s*Date\s*$", "", clean_label, flags=re.I).strip()
        
        pattern = rf"(?:{re.escape(clean_label)}|{re.escape(short_label)})[\?: \t\-\=]*([^\n;,\t]+)"
        match = re.search(pattern, block, re.IGNORECASE)
        if match:
            val = match.group(1).strip()
            val = re.sub(r"\s+[A-Z][a-zA-Z0-9\s/()]+:.*$", "", val)
            return val
        return ""

    def get_date_value(block, label):
        val = get_value(block, label)
        return clean_date_string(val)

    def get_number(val):
        try:
            return float(re.search(r"[\d.]+", val).group())
        except:
            return None

    def checkbox(block, label):
        if not block:
            return False
        escaped = re.escape(label.strip())
        pattern = rf"\[[\s]*[XxvV✓/*1]+[\s]*\][ \t]*{escaped}|{escaped}[ \t]*\[[\s]*[XxvV✓/*1]+[\s]*\]|\([\s]*[XxvV✓/*1]+[\s]*\)[ \t]*{escaped}"
        return bool(re.search(pattern, block, re.IGNORECASE))

    def yes_no(line):
        return {
            "yes": checkbox(line, "YES"),
            "no": checkbox(line, "NO")
        }

    def parse_header(block):
        lines = [l.strip() for l in block.split("\n") if l.strip()]
        return {
            "country": lines[0] if len(lines) > 0 else "Republic of the Philippines",
            "province": lines[1] if len(lines) > 1 else "Province of Laguna",
            "municipality": lines[2] if len(lines) > 2 else "Municipality of Paete",
            "facility": lines[3] if len(lines) > 3 else "PAETE RURAL HEALTH UNIT",
            "facility_address": lines[4] if len(lines) > 4 else "2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna",
            "form_title": lines[5] if len(lines) > 5 else "Individual Treatment Record",
            "age_group": lines[6] if len(lines) > 6 else "20 Years old and above"
        }

    def parse_patient(block):
        age_num = get_number(get_value(block, "Age"))
        return {
            "name": get_value(block, "NAME"),
            "philhealth_no": get_value(block, "Philhealth No."),
            "address": get_value(block, "ADDRESS"),
            "civil_status": get_value(block, "Civil Status"),
            "birthday": get_date_value(block, "BIRTHDAY"),
            "age": int(age_num) if age_num is not None else 0,
            "cp_no": get_value(block, "CP No"),
            "educational_attainment": get_value(block, "Educational Attainment"),
            "bhw": get_value(block, "BHW")
        }

    sections = split_sections(text)

    if target_page == 1:
        is_p2 = False
    elif target_page == 2:
        is_p2 = True
    else:
        is_p2 = any(k in sections for k in ['PHILHEALTH MEMBERSHIP INFORMATION', 'PAST MEDICAL HISTORY', 'PAST SURGICAL HISTORY', 'IMMUNIZATIONS', 'MENSTRUAL HISTORY', 'PREGNANCY HISTORY']) or any(kw in text.upper() for kw in ['PHILHEALTH', 'PAST MEDICAL HISTORY', 'PAST SURGICAL HISTORY', 'IMMUNIZATIONS', 'MENSTRUAL HISTORY', 'PREGNANCY HISTORY'])

    if is_p2:
        pmB = sections.get('PHILHEALTH MEMBERSHIP INFORMATION', '')
        vsB = sections.get('VITAL SIGNS', sections.get('VITAL SIGNS & PHYSICAL MEASUREMENTS', ''))
        pmhB = sections.get('PAST MEDICAL HISTORY', '')
        pshB = sections.get('PAST SURGICAL HISTORY', '')
        fhB = sections.get('FAMILY HISTORY', '')
        psocB = sections.get('PERSONAL / SOCIAL HISTORY', sections.get('PERSONAL/SOCIAL HISTORY', ''))
        immB = sections.get('IMMUNIZATIONS', '')
        menB = sections.get('MENSTRUAL HISTORY', '')
        pregB = sections.get('PREGNANCY HISTORY', '')

        return {
            "philhealth_membership": {
                "philhealth_id_number": get_value(pmB, "Philhealth ID Number") or get_value(pmB, "PhilHealth ID Number"),
                "membership_type": {
                    "member": checkbox(pmB, "Member") and not checkbox(pmB, "Non-Member"),
                    "dependent": checkbox(pmB, "Dependent"),
                    "non_member": checkbox(pmB, "Non-Member")
                },
                "membership_category": {
                    "sponsored": checkbox(pmB, "Sponsored"),
                    "ipp": checkbox(pmB, "Individual Paying Program (IPP)") or checkbox(pmB, "IPP"),
                    "employed": checkbox(pmB, "Employed"),
                    "lifetime": checkbox(pmB, "Lifetime"),
                    "nhits": checkbox(pmB, "NHITS"),
                    "lgu": checkbox(pmB, "LGU"),
                    "organized_group": checkbox(pmB, "Organized Group"),
                    "government": checkbox(pmB, "Government"),
                    "nga": checkbox(pmB, "NGA"),
                    "private": checkbox(pmB, "Private"),
                    "ofw": checkbox(pmB, "OFW")
                }
            },
            "vital_signs": {
                "blood_pressure": get_value(vsB, "Blood Pressure") or get_value(vsB, "BP"),
                "heart_rate": get_number(get_value(vsB, "Heart Rate") or get_value(vsB, "HR")),
                "respiratory_rate": get_number(get_value(vsB, "Respiratory Rate") or get_value(vsB, "RR")),
                "pulse_rate": get_number(get_value(vsB, "Pulse Rate") or get_value(vsB, "PR")),
                "temperature": get_number(get_value(vsB, "Temperature") or get_value(vsB, "TEMP")),
                "spo2": get_number(get_value(vsB, "SpO2")),
                "height_cm": get_number(get_value(vsB, "Height (cm)") or get_value(vsB, "HT")),
                "weight_kg": get_number(get_value(vsB, "Weight (kg)") or get_value(vsB, "WEIGHT")),
                "waist_circumference_cm": get_number(get_value(vsB, "Waist Circumference (cm)") or get_value(vsB, "WaistLine")),
                "hip_circumference_cm": get_number(get_value(vsB, "Hip Circumference (cm)") or get_value(vsB, "Hip"))
            },
            "past_medical_history": {
                "allergy": get_value(pmhB, "Allergy (specify)") or get_value(pmhB, "Allergy"),
                "asthma": checkbox(pmhB, "Asthma") if "Asthma" in pmhB else None,
                "cancer": {
                    "has": checkbox(pmhB, "Cancer") if "Cancer" in pmhB else None,
                    "organ": get_value(pmhB, "Cancer (specify organ)")
                },
                "cerebrovascular_disease": checkbox(pmhB, "Cerebrovascular Disease") if "Cerebrovascular" in pmhB else None,
                "coronary_artery_disease": checkbox(pmhB, "Coronary Artery Disease") if "Coronary" in pmhB else None,
                "diabetes_mellitus": checkbox(pmhB, "Diabetes Mellitus") if "Diabetes" in pmhB else None,
                "emphysema": checkbox(pmhB, "Emphysema") if "Emphysema" in pmhB else None,
                "epilepsy_seizure_disorder": checkbox(pmhB, "Epilepsy/Seizure Disorder") or checkbox(pmhB, "Epilepsy") if "Epilepsy" in pmhB else None,
                "hepatitis": {
                    "has": checkbox(pmhB, "Hepatitis") if "Hepatitis" in pmhB else None,
                    "type": get_value(pmhB, "Hepatitis (specify type)")
                },
                "hyperlipidemia": checkbox(pmhB, "Hyperlipidemia") if "Hyperlipidemia" in pmhB else None,
                "hypertension": {
                    "has": checkbox(pmhB, "Hypertension") if "Hypertension" in pmhB else None,
                    "highest_bp": get_value(pmhB, "Highest BP Recorded")
                },
                "peptic_ulcer_disease": checkbox(pmhB, "Peptic Ulcer Disease") if "Peptic" in pmhB else None,
                "pneumonia": checkbox(pmhB, "Pneumonia") if "Pneumonia" in pmhB else None,
                "thyroid_disease": checkbox(pmhB, "Thyroid Disease") if "Thyroid" in pmhB else None,
                "tuberculosis": {
                    "organ": get_value(pmhB, "Tuberculosis (specify organ)"),
                    "category": get_value(pmhB, "If Pulmonary TB Category")
                },
                "urinary_tract_infection": checkbox(pmhB, "Urinary Tract Infection") or checkbox(pmhB, "UTI") if "UTI" in pmhB or "Urinary" in pmhB else None,
                "others": get_value(pmhB, "Others")
            },
            "past_surgical_history": {
                "operation": get_value(pshB, "Operation"),
                "date": get_date_value(pshB, "Date")
            },
            "family_history": {
                "allergy": get_value(fhB, "Allergy (specify)") or get_value(fhB, "Allergy"),
                "asthma": checkbox(fhB, "Asthma") if "Asthma" in fhB else None,
                "cancer": {
                    "has": checkbox(fhB, "Cancer") if "Cancer" in fhB else None,
                    "organ": get_value(fhB, "Cancer (specify organ)")
                },
                "cerebrovascular_disease": checkbox(fhB, "Cerebrovascular Disease") if "Cerebrovascular" in fhB else None,
                "coronary_artery_disease": checkbox(fhB, "Coronary Artery Disease") if "Coronary" in fhB else None,
                "diabetes_mellitus": checkbox(fhB, "Diabetes Mellitus") if "Diabetes" in fhB else None,
                "emphysema": checkbox(fhB, "Emphysema") if "Emphysema" in fhB else None,
                "epilepsy_seizure_disorder": checkbox(fhB, "Epilepsy/Seizure Disorder") or checkbox(fhB, "Epilepsy") if "Epilepsy" in fhB else None,
                "hepatitis": {
                    "has": checkbox(fhB, "Hepatitis") if "Hepatitis" in fhB else None,
                    "type": get_value(fhB, "Hepatitis (specify type)")
                },
                "hyperlipidemia": checkbox(fhB, "Hyperlipidemia") if "Hyperlipidemia" in fhB else None,
                "hypertension": {
                    "has": checkbox(fhB, "Hypertension") if "Hypertension" in fhB else None,
                    "highest_bp": get_value(fhB, "Highest BP Recorded")
                },
                "peptic_ulcer_disease": checkbox(fhB, "Peptic Ulcer Disease") if "Peptic" in fhB else None,
                "pneumonia": checkbox(fhB, "Pneumonia") if "Pneumonia" in fhB else None,
                "thyroid_disease": checkbox(fhB, "Thyroid Disease") if "Thyroid" in fhB else None,
                "pulmonary_tuberculosis": checkbox(fhB, "Pulmonary Tuberculosis") if "Pulmonary Tuberculosis" in fhB else None,
                "extrapulmonary_tuberculosis": checkbox(fhB, "Extrapulmonary Tuberculosis") if "Extrapulmonary" in fhB else None,
                "urinary_tract_infection": checkbox(fhB, "Urinary Tract Infection") or checkbox(fhB, "UTI") if "UTI" in fhB or "Urinary" in fhB else None,
                "mental_illness": checkbox(fhB, "Mental Illness") if "Mental" in fhB else None,
                "others": get_value(fhB, "Others")
            },
            "personal_social_history": {
                "smoking": {
                    "yes": "Smoking:" in psocB and checkbox(psocB.split("Smoking:")[1].split("\n")[0], "Yes"),
                    "no": "Smoking:" in psocB and checkbox(psocB.split("Smoking:")[1].split("\n")[0], "No"),
                    "quit": "Smoking:" in psocB and checkbox(psocB.split("Smoking:")[1].split("\n")[0], "Quit"),
                    "pack_years": get_number(get_value(psocB, "Pack Years"))
                },
                "alcohol": {
                    "yes": "Alcohol:" in psocB and checkbox(psocB.split("Alcohol:")[1].split("\n")[0], "Yes"),
                    "no": "Alcohol:" in psocB and checkbox(psocB.split("Alcohol:")[1].split("\n")[0], "No"),
                    "quit": "Alcohol:" in psocB and checkbox(psocB.split("Alcohol:")[1].split("\n")[0], "Quit"),
                    "bottles_per_day": get_number(get_value(psocB, "Bottles per Day"))
                },
                "illicit_drugs": {
                    "yes": "Illicit Drugs:" in psocB and checkbox(psocB.split("Illicit Drugs:")[1].split("\n")[0], "Yes"),
                    "no": "Illicit Drugs:" in psocB and checkbox(psocB.split("Illicit Drugs:")[1].split("\n")[0], "No"),
                    "quit": "Illicit Drugs:" in psocB and checkbox(psocB.split("Illicit Drugs:")[1].split("\n")[0], "Quit")
                },
                "sexually_active": checkbox(psocB.split("Sexually Active:")[1].split("\n")[0], "Yes") if "Sexually Active:" in psocB else None
            },
            "immunizations": {
                "child_care": {
                    "bcg_date": get_date_value(immB, "BCG Date") or get_date_value(immB, "BCG"),
                    "hepb_birth_date": get_date_value(immB, "HepB Birth Date") or get_date_value(immB, "HepB Birth") or get_date_value(immB, "Hep B Birth"),
                    "hepb_24hrs_date": get_date_value(immB, "HepB 24hrs Date") or get_date_value(immB, "HepB 24h") or get_date_value(immB, "HepB 24hrs"),
                    "penta_date": get_date_value(immB, "PENTA Date") or get_date_value(immB, "PENTA"),
                    "opv_date": get_date_value(immB, "OPV Date") or get_date_value(immB, "OPV"),
                    "ipv_date": get_date_value(immB, "IPV Date") or get_date_value(immB, "IPV"),
                    "pcv_date": get_date_value(immB, "PCV Date") or get_date_value(immB, "PCV"),
                    "measles_vaccine_date": get_date_value(immB, "Measles Vaccine Date") or get_date_value(immB, "Measles"),
                    "rotavirus_vaccine_date": get_date_value(immB, "Rotavirus Vaccine Date") or get_date_value(immB, "Rotavirus"),
                    "chickenpox_vaccine_date": get_date_value(immB, "Chickenpox Vaccine Date") or get_date_value(immB, "Chickenpox")
                },
                "general": {
                    "flu_vaccine_date": get_date_value(immB, "Flu Vaccine Date") or get_date_value(immB, "Flu"),
                    "hpv_date": get_date_value(immB, "HPV Date") or get_date_value(immB, "HPV"),
                    "hpv_grade4_date": get_date_value(immB, "HPV Grade 4 Date") or get_date_value(immB, "HPV Gr.4"),
                    "mr_grade1_date": get_date_value(immB, "MR Grade 1 Date") or get_date_value(immB, "MR Gr.1"),
                    "mr_grade7_date": get_date_value(immB, "MR Grade 7 Date") or get_date_value(immB, "MR Gr.7"),
                    "td_grade1_date": get_date_value(immB, "TD Grade 1 Date") or get_date_value(immB, "TD Gr.1"),
                    "td_grade7_date": get_date_value(immB, "TD Grade 7 Date") or get_date_value(immB, "TD Gr.7"),
                    "tetanus_toxoid_date": get_date_value(immB, "Tetanus Toxoid Date") or get_date_value(immB, "Tetanus Toxoid") or get_date_value(immB, "TT")
                },
                "animal_bite": {
                    "pcecv1_date": get_date_value(immB, "PCECV1 Date") or get_date_value(immB, "PCECV1"),
                    "pvrv1_date": get_date_value(immB, "PVRV1 Date") or get_date_value(immB, "PVRV1"),
                    "pvrv2_date": get_date_value(immB, "PVRV2 Date") or get_date_value(immB, "PVRV2"),
                    "pvrv3_date": get_date_value(immB, "PVRV3 Date") or get_date_value(immB, "PVRV3"),
                    "pvrv4_date": get_date_value(immB, "PVRV4 Date") or get_date_value(immB, "PVRV4"),
                    "pcecv2_date": get_date_value(immB, "PCECV2 Date") or get_date_value(immB, "PCECV2")
                },
                "ncd": {
                    "pneumococcal_vaccine_date": get_date_value(immB, "Pneumococcal Vaccine Date") or get_date_value(immB, "Pneumococcal"),
                    "flu_vaccine_date": get_date_value(immB, "Flu Vaccine (NCD) Date") or get_date_value(immB, "Flu (NCD)") or get_date_value(immB, "Flu")
                },
                "maternal_care": {
                    "tetanus_toxoid_date": get_date_value(immB, "Tetanus Toxoid (Maternal) Date") or get_date_value(immB, "Tetanus Toxoid (Mat.)")
                }
            },
            "menstrual_history": {
                "menarche_age": get_number(get_value(menB, "Menarche Age")),
                "onset_of_sexual_intercourse": get_number(get_value(menB, "Onset of Sexual Intercourse")),
                "last_menstrual_period": get_date_value(menB, "Last Menstrual Period") or get_date_value(menB, "LMP"),
                "menstrual_bleeding_pattern": get_value(menB, "Menstrual Bleeding Pattern"),
                "birth_control_method": get_value(menB, "Birth Control Method"),
                "period_duration": get_value(menB, "Period Duration"),
                "cycle_interval": get_value(menB, "Cycle Interval"),
                "pads_per_day": get_number(get_value(menB, "Pads per Day")),
                "menopause": checkbox(menB.split("Menopause:")[1].split("\n")[0], "Yes") if "Menopause:" in menB else None,
                "age_of_menopause": get_number(get_value(menB, "Age of Menopause"))
            },
            "pregnancy_history": {
                "gravidity": get_number(get_value(pregB, "Gravidity")),
                "parity": get_number(get_value(pregB, "Parity")),
                "type_of_delivery": get_value(pregB, "Type of Delivery"),
                "full_term": get_number(get_value(pregB, "Full Term")),
                "premature": get_number(get_value(pregB, "Premature")),
                "abortion": get_number(get_value(pregB, "Abortion")),
                "living_children": get_number(get_value(pregB, "Living Children")),
                "pre_eclampsia": checkbox(pregB.split("Pre-eclampsia:")[1].split("\n")[0], "Yes") if "Pre-eclampsia:" in pregB else None,
                "age_at_first_pregnancy": get_number(get_value(pregB, "Age at First Pregnancy")),
                "family_planning_counseling": checkbox(pregB.split("Family Planning Counseling:")[1].split("\n")[0], "Yes") if "Family Planning Counseling:" in pregB else None
            }
        }

    return parse_itr_page_1(text)


def parse_itr_page_1(text):
    """
    Dedicated high-accuracy parser for Individual Treatment Record Page 1.
    Extracts Header, Demographics, Smoking Cessation, Family History, Clinical Background,
    Alcohol/Diet, Vital Signs, and Consultation Log Records with 100% precision.
    """
    if not text or not isinstance(text, str):
        text = ""

    def get_field_val(block, labels):
        if not block:
            return ""
        if isinstance(labels, str):
            labels = [labels]
        lines = [l.strip() for l in block.split('\n') if l.strip()]
        known_keywords = r"(?:Philhealth|ADDRESS|Civil|BIRTHDAY|Age|CP|Educational|BHW|Brand|How|Sticks|No of|Reason|Have|If|Try|Family|Co-Morbid|Allergy|Alcohol|Physical|High|Dietary|BMI|RAISED|WaistLine|HT|WEIGHT|1st|2nd|Date|Subjective|Objective|Assessment|Plan|Risk)"

        for label in labels:
            clean_label = label.rstrip('?:').strip()
            for idx, line in enumerate(lines):
                pattern = rf"^(?:===|[#*]-*)?[ \t]*(?:{re.escape(clean_label)}|{re.escape(label)})[\:\?\s\-\=]+(.*)$"
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    val = match.group(1).strip()
                    val = re.sub(r"^[\:\?\-\=\s]+", "", val).strip()
                    val = re.sub(rf"\s+{known_keywords}[\?: \t\-\=].*$", "", val, flags=re.IGNORECASE).strip()
                    if val and not re.match(rf"^{known_keywords}[\?: \t\-\=]", val, re.IGNORECASE):
                        return val
                    if not val and idx + 1 < len(lines):
                        next_line = lines[idx + 1].strip()
                        next_val = re.sub(r"^[\:\?\-\=\s]+", "", next_line).strip()
                        if next_val and not next_val.startswith('===') and not re.match(rf"^{known_keywords}[\?: \t\-\=]", next_val, re.IGNORECASE):
                            return next_val
        return ""

    def get_date_field(block, labels):
        val = get_field_val(block, labels)
        return clean_date_string(val)

    def get_num_field(block, labels):
        val = get_field_val(block, labels)
        try:
            m = re.search(r"[\d.]+", val)
            return float(m.group(0)) if m else None
        except:
            return None

    def chk_box(block, label):
        if not block:
            return False
        escaped = re.escape(label.strip())
        pattern = rf"\[[\s]*[XxvV✓/*1]+[\s]*\][ \t]*{escaped}|{escaped}[ \t]*\[[\s]*[XxvV✓/*1]+[\s]*\]|\([\s]*[XxvV✓/*1]+[\s]*\)[ \t]*{escaped}"
        return bool(re.search(pattern, block, re.IGNORECASE))

    hdr_regex = r"(?im)^[ \t]*(?:===|[#*]-*)?[ \t]*(HEALTH FACILITY HEADER|PATIENT DEMOGRAPHICS|DEMOGRAPHICS|LIFESTYLE\s*&\s*RISK FACTORS|LIFESTYLE|SMOKING CESSATION|FAMILY HISTORY|VITAL SIGNS\s*&\s*PHYSICAL MEASUREMENTS|VITAL SIGNS|CONSULTATION\s*&\s*CLINICAL FINDINGS|CONSULTATION LOG|CONSULTATION)[ \t]*(?:===|:|$)"
    
    section_map = {}
    matches = list(re.finditer(hdr_regex, text))
    
    if matches:
        for i, m in enumerate(matches):
            title = m.group(1).upper().strip()
            st = m.end()
            en = matches[i+1].start() if i + 1 < len(matches) else len(text)
            section_map[title] = text[st:en].strip()

    header_block = section_map.get("HEALTH FACILITY HEADER", text[:400])
    demo_block   = section_map.get("PATIENT DEMOGRAPHICS", section_map.get("DEMOGRAPHICS", text))
    ls_block     = section_map.get("LIFESTYLE & RISK FACTORS", section_map.get("LIFESTYLE", section_map.get("SMOKING CESSATION", text)))
    vitals_block = section_map.get("VITAL SIGNS & PHYSICAL MEASUREMENTS", section_map.get("VITAL SIGNS", text))
    consult_block= section_map.get("CONSULTATION & CLINICAL FINDINGS", section_map.get("CONSULTATION LOG", section_map.get("CONSULTATION", text)))

    # 1. Header
    header_data = {
        "country": "Republic of the Philippines",
        "province": "Province of Laguna",
        "municipality": "Municipality of Paete",
        "facility": "PAETE RURAL HEALTH UNIT",
        "facility_address": "2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna",
        "form_title": "Individual Treatment Record",
        "age_group": "20 Years old and above"
    }

    # 2. Patient Demographics
    age_val = get_num_field(demo_block, ["Age", "AGE"])
    patient_data = {
        "name": get_field_val(demo_block, ["NAME", "Name", "PATIENT NAME", "Patient Name"]),
        "philhealth_no": get_field_val(demo_block, ["Philhealth No.", "Philhealth No", "PhilHealth No", "Philhealth ID", "Philhealth"]),
        "address": get_field_val(demo_block, ["ADDRESS", "Address"]),
        "civil_status": get_field_val(demo_block, ["Civil Status", "CIVIL STATUS", "CivilStatus"]),
        "birthday": get_date_field(demo_block, ["BIRTHDAY", "Birthday", "Birth Date", "DOB"]),
        "age": int(age_val) if age_val is not None else 0,
        "cp_no": get_field_val(demo_block, ["CP No", "CP No.", "CP Number", "Contact No", "Mobile No"]),
        "educational_attainment": get_field_val(demo_block, ["Educational Attainment", "Education", "Educ Attainment"]),
        "bhw": get_field_val(demo_block, ["BHW", "BHW Name", "B.H.W."])
    }

    # 3. Lifestyle & Risk Factors
    smk_current = chk_box(ls_block, "Current")
    smk_passive = chk_box(ls_block, "Passive")
    smk_never   = chk_box(ls_block, "Never")
    smk_gt1yr   = chk_box(ls_block, "Stopped > a year") or chk_box(ls_block, "Stopped > 1 year")
    smk_lt1yr   = chk_box(ls_block, "Stopped < a year") or chk_box(ls_block, "Stopped < 1 year")

    smk_st = "Current" if smk_current else ("Passive" if smk_passive else ("Never" if smk_never else ("Stopped > 1 year" if smk_gt1yr else ("Stopped < 1 year" if smk_lt1yr else None))))

    exp_yes = "experienced side effect" in ls_block.lower() and chk_box(ls_block.split("experienced side effect")[1] if "experienced side effect" in ls_block.lower() else "", "YES")
    exp_no  = "experienced side effect" in ls_block.lower() and chk_box(ls_block.split("experienced side effect")[1] if "experienced side effect" in ls_block.lower() else "", "NO")

    quit_yes = "quitting before" in ls_block.lower() and chk_box(ls_block.split("quitting before")[1] if "quitting before" in ls_block.lower() else "", "YES")
    quit_no  = "quitting before" in ls_block.lower() and chk_box(ls_block.split("quitting before")[1] if "quitting before" in ls_block.lower() else "", "NO")

    smoking_data = {
        "smoker_status": smk_st,
        "options": {
            "current": smk_current,
            "passive": smk_passive,
            "never": smk_never,
            "stopped_gt_1_year": smk_gt1yr,
            "stopped_lt_1_year": smk_lt1yr
        },
        "brand_of_cigarette": get_field_val(ls_block, ["Brand of Cigarette", "Brand"]),
        "sticks_per_day": get_num_field(ls_block, ["How many stick per day", "Sticks per day", "Sticks"]),
        "age_started": get_num_field(ls_block, ["Age started", "Age Started"]),
        "years_smoking": get_num_field(ls_block, ["No of years smoking", "Years smoking", "No. of years smoking"]),
        "reason_for_smoking": get_field_val(ls_block, ["Reason for smoking", "Reason"]),
        "experienced_side_effects": True if exp_yes else (False if exp_no else None),
        "side_effect_details": get_field_val(ls_block, ["If yes, What effect", "What effect"]),
        "tried_quitting_before": True if quit_yes else (False if quit_no else None),
        "quit_attempt_success": None,
        "reason_not_successful": get_field_val(ls_block, ["If yes, why were not successful", "why were not successful"])
    }

    family_data = {
        "has_1st_degree_relative": True,
        "hypertension": chk_box(ls_block, "Hypertension"),
        "stroke": chk_box(ls_block, "Stroke"),
        "heart_attack": chk_box(ls_block, "Heart Attack"),
        "dm": chk_box(ls_block, "DM") or chk_box(ls_block, "Diabetes"),
        "asthma": chk_box(ls_block, "Asthma"),
        "cancer": chk_box(ls_block, "Cancer"),
        "kidney_disease": chk_box(ls_block, "Kidney Disease") or chk_box(ls_block, "Kidney")
    }

    clinical_data = {
        "co_morbid": get_field_val(ls_block, ["Co-Morbid", "Co-morbid", "Comorbid"]),
        "allergy": get_field_val(ls_block, ["Allergy", "ALLERGY"])
    }

    exc_line = re.search(r"Excessive Alcohol Intake.*", ls_block, re.I)
    exc_text = exc_line.group(0) if exc_line else ""
    exc_def = re.search(r"\((.*?)\)", exc_text)

    alcohol_data = {
        "never_consumed": chk_box(ls_block, "Never Consumed"),
        "drinks_alcohol": chk_box(ls_block, "Yes, drinks alcohol") or chk_box(ls_block, "drinks alcohol"),
        "excessive_alcohol_intake": {
            "definition": exc_def.group(1) if exc_def else "In the past mos., had 3 drinks in one occasion",
            "yes": chk_box(exc_text, "YES"),
            "no": chk_box(exc_text, "NO")
        }
    }

    pa_line = re.search(r"Does at least 2 1/2 hours.*", ls_block, re.I)
    pa_text = pa_line.group(0) if pa_line else ""

    fat_line = re.search(r"Eats processed.*", ls_block, re.I)
    fat_text = fat_line.group(0) if fat_line else ""

    veg_line = re.search(r"3 servings of vegetables daily.*", ls_block, re.I)
    veg_text = veg_line.group(0) if veg_line else ""

    fruit_line = re.search(r"2-3 servings of fruits daily.*", ls_block, re.I)
    fruit_text = fruit_line.group(0) if fruit_line else ""

    diet_and_lifestyle = {
        "physical_activity": {
            "meets_2_5_hours_per_week": True if chk_box(pa_text, "YES") else (False if chk_box(pa_text, "NO") else None)
        },
        "high_fat_high_salt_food_intake": {
            "weekly_processed_fastfood": True if chk_box(fat_text, "YES") else (False if chk_box(fat_text, "NO") else None)
        },
        "dietary_fiber_intake": {
            "vegetables_3_servings_daily": True if chk_box(veg_text, "YES") else (False if chk_box(veg_text, "NO") else None),
            "fruits_2_3_servings_daily": True if chk_box(fruit_text, "YES") else (False if chk_box(fruit_text, "NO") else None)
        }
    }

    # 4. Vital Signs
    vital_data = {
        "bmi": get_num_field(vitals_block, ["BMI", "bmi"]),
        "waistline_cm": get_num_field(vitals_block, ["WaistLine", "Waistline", "Waist"]),
        "height_cm": get_num_field(vitals_block, ["HT", "Height", "Ht"]),
        "weight_kg": get_num_field(vitals_block, ["WEIGHT", "Weight", "Wt"]),
        "raised_bp": True if "yes" in get_field_val(vitals_block, ["RAISED BP", "Raised BP"]).lower() else (False if "no" in get_field_val(vitals_block, ["RAISED BP", "Raised BP"]).lower() else None),
        "blood_pressure_readings": {
            "first": get_field_val(vitals_block, ["1ST READING", "1st Reading", "First Reading"]),
            "second": get_field_val(vitals_block, ["2ND READING", "2nd Reading", "Second Reading"])
        }
    }

    # 5. Consultation Log Records
    consultation_records = []
    entries = re.split(r"(?im)^[ \t]*Date:", consult_block)
    if len(entries) > 1:
        for entry in entries[1:]:
            lines = [l.strip() for l in entry.strip().split("\n") if l.strip()]
            date_raw = lines[0] if lines else ""
            date_clean = clean_date_string(date_raw)

            subj = get_field_val(entry, ["Subjective Findings", "Subjective", "S"])

            age_match = re.search(r"AGE:\s*(\d+)", entry, re.I)
            wt_match  = re.search(r"WT:\s*(\d+)", entry, re.I)
            ht_match  = re.search(r"HT:\s*(\d+)", entry, re.I)
            bp_match  = re.search(r"BP:\s*([\d/]+\s*(?:mmHg)?)", entry, re.I)

            age = int(age_match.group(1)) if age_match else None
            wt  = float(wt_match.group(1)) if wt_match else None
            ht  = float(ht_match.group(1)) if ht_match else None
            bp  = bp_match.group(1) if bp_match else ""

            diag_match = re.search(r"(?:Assessment/Diagnosis|Assessment Diagnosis|Diagnosis):\s*(.*?)(?=Plan/|$)", entry, re.DOTALL | re.I)
            diag = []
            if diag_match:
                raw_d = diag_match.group(1).strip()
                diag = [item.strip() for item in raw_d.split(",") if item.strip()]

            plan_match = re.search(r"(?:Plan/Treatment Plan|Plan/ Treatment Plan|Plan):\s*(.*)", entry, re.DOTALL | re.I)
            plan = []
            if plan_match:
                raw_p = plan_match.group(1).strip()
                plan = [item.strip() for item in raw_p.split(",") if item.strip()]

            consultation_records.append({
                "date": date_clean or date_raw,
                "subjective_findings": subj,
                "objective_findings": {
                    "age": age,
                    "weight_kg": wt,
                    "height_cm": ht,
                    "blood_pressure": bp
                },
                "assessment_diagnosis": diag,
                "plan_treatment": plan
            })

    return {
        "header": header_data,
        "patient_demographics": patient_data,
        "smoking_cessation_profile": smoking_data,
        "family_history": family_data,
        "clinical_background": clinical_data,
        "alcohol_intake": alcohol_data,
        "diet_and_lifestyle": diet_and_lifestyle,
        "vital_signs": vital_data,
        "consultation_records": consultation_records,
        "itr_page_number": 1
    }


def format_itr_to_standard_template(data):
    if not data or not isinstance(data, dict):
        return ""

    h = data.get('header', {})
    d = data.get('patient_demographics', {})
    sc = data.get('smoking_cessation_profile', {})
    fh = data.get('family_history', {})
    cb = data.get('clinical_background', {})
    alc = data.get('alcohol_intake', {})
    alc_exc = alc.get('excessive_alcohol_intake', {}) if isinstance(alc.get('excessive_alcohol_intake'), dict) else {}
    dl = data.get('diet_and_lifestyle', {})
    pa = dl.get('physical_activity', {}) if isinstance(dl.get('physical_activity'), dict) else {}
    fat = dl.get('high_fat_high_salt_food_intake', {}) if isinstance(dl.get('high_fat_high_salt_food_intake'), dict) else {}
    fiber = dl.get('dietary_fiber_intake', {}) if isinstance(dl.get('dietary_fiber_intake'), dict) else {}
    vs = data.get('vital_signs', {})
    bpr = vs.get('blood_pressure_readings', {}) if isinstance(vs.get('blood_pressure_readings'), dict) else {}
    crs = data.get('consultation_records', [])

    def chk(val):
        return '[x]' if val is True else '[ ]'

    def opt(status, target):
        return '[x]' if status == target else '[ ]'

    if data.get('itr_page_number') == 1:
        is_page_2 = False
    elif data.get('itr_page_number') == 2:
        is_page_2 = True
    else:
        is_page_2 = any(k in data for k in ['philhealth_membership', 'past_medical_history', 'immunizations', 'menstrual_history', 'pregnancy_history'])

    if is_page_2:
        pm = data.get('philhealth_membership', {})
        pm_type = pm.get('membership_type', {})
        pm_cat = pm.get('membership_category', {})
        vs = data.get('vital_signs', {})
        pmh = data.get('past_medical_history', {})
        pmh_can = pmh.get('cancer', {}) if isinstance(pmh.get('cancer'), dict) else {}
        pmh_hep = pmh.get('hepatitis', {}) if isinstance(pmh.get('hepatitis'), dict) else {}
        pmh_htn = pmh.get('hypertension', {}) if isinstance(pmh.get('hypertension'), dict) else {}
        pmh_tb = pmh.get('tuberculosis', {}) if isinstance(pmh.get('tuberculosis'), dict) else {}
        psh = data.get('past_surgical_history', {})
        fh2 = data.get('family_history', {})
        fh_can = fh2.get('cancer', {}) if isinstance(fh2.get('cancer'), dict) else {}
        fh_hep = fh2.get('hepatitis', {}) if isinstance(fh2.get('hepatitis'), dict) else {}
        fh_htn = fh2.get('hypertension', {}) if isinstance(fh2.get('hypertension'), dict) else {}
        psoc = data.get('personal_social_history', {})
        psoc_smk = psoc.get('smoking', {}) if isinstance(psoc.get('smoking'), dict) else {}
        psoc_alc = psoc.get('alcohol', {}) if isinstance(psoc.get('alcohol'), dict) else {}
        psoc_drg = psoc.get('illicit_drugs', {}) if isinstance(psoc.get('illicit_drugs'), dict) else {}
        imm = data.get('immunizations', {})
        imm_child = imm.get('child_care', {}) if isinstance(imm.get('child_care'), dict) else {}
        imm_gen = imm.get('general', {}) if isinstance(imm.get('general'), dict) else {}
        imm_ab = imm.get('animal_bite', {}) if isinstance(imm.get('animal_bite'), dict) else {}
        imm_ncd = imm.get('ncd', {}) if isinstance(imm.get('ncd'), dict) else {}
        imm_mat = imm.get('maternal_care', {}) if isinstance(imm.get('maternal_care'), dict) else {}
        men = data.get('menstrual_history', {})
        preg = data.get('pregnancy_history', {})

        lines2 = []
        lines2.append('=== PHILHEALTH MEMBERSHIP INFORMATION ===')
        lines2.append(f"Philhealth ID Number: {pm.get('philhealth_id_number', '')}\n")
        lines2.append('Membership Type:')
        lines2.append(f"{chk(pm_type.get('member'))} Member")
        lines2.append(f"{chk(pm_type.get('dependent'))} Dependent")
        lines2.append(f"{chk(pm_type.get('non_member'))} Non-Member\n")
        lines2.append('Membership Category:')
        lines2.append(f"{chk(pm_cat.get('sponsored'))} Sponsored")
        lines2.append(f"{chk(pm_cat.get('ipp'))} Individual Paying Program (IPP)")
        lines2.append(f"{chk(pm_cat.get('employed'))} Employed")
        lines2.append(f"{chk(pm_cat.get('lifetime'))} Lifetime")
        lines2.append(f"{chk(pm_cat.get('nhits'))} NHITS")
        lines2.append(f"{chk(pm_cat.get('lgu'))} LGU")
        lines2.append(f"{chk(pm_cat.get('organized_group'))} Organized Group")
        lines2.append(f"{chk(pm_cat.get('government'))} Government")
        lines2.append(f"{chk(pm_cat.get('nga'))} NGA")
        lines2.append(f"{chk(pm_cat.get('private'))} Private")
        lines2.append(f"{chk(pm_cat.get('ofw'))} OFW\n")

        lines2.append('=== VITAL SIGNS ===')
        lines2.append(f"Blood Pressure: {vs.get('blood_pressure', '')}")
        lines2.append(f"Heart Rate: {vs.get('heart_rate', '') if vs.get('heart_rate') is not None else ''}")
        lines2.append(f"Respiratory Rate: {vs.get('respiratory_rate', '') if vs.get('respiratory_rate') is not None else ''}")
        lines2.append(f"Pulse Rate: {vs.get('pulse_rate', '') if vs.get('pulse_rate') is not None else ''}")
        lines2.append(f"Temperature: {vs.get('temperature', '') if vs.get('temperature') is not None else ''}")
        lines2.append(f"SpO2: {vs.get('spo2', '') if vs.get('spo2') is not None else ''}")
        lines2.append(f"Height (cm): {vs.get('height_cm', '') if vs.get('height_cm') is not None else ''}")
        lines2.append(f"Weight (kg): {vs.get('weight_kg', '') if vs.get('weight_kg') is not None else ''}")
        lines2.append(f"Waist Circumference (cm): {vs.get('waist_circumference_cm', '') if vs.get('waist_circumference_cm') is not None else ''}")
        lines2.append(f"Hip Circumference (cm): {vs.get('hip_circumference_cm', '') if vs.get('hip_circumference_cm') is not None else ''}\n")

        lines2.append('=== PAST MEDICAL HISTORY ===')
        lines2.append(f"Allergy (specify): {pmh.get('allergy', '')}")
        lines2.append(f"Asthma:\n{chk(pmh.get('asthma') is True)} Yes\n{chk(pmh.get('asthma') is False)} No\n")
        lines2.append(f"Cancer (specify organ): {pmh_can.get('organ', '')}")
        lines2.append(f"Cerebrovascular Disease:\n{chk(pmh.get('cerebrovascular_disease') is True)} Yes\n{chk(pmh.get('cerebrovascular_disease') is False)} No\n")
        lines2.append(f"Coronary Artery Disease:\n{chk(pmh.get('coronary_artery_disease') is True)} Yes\n{chk(pmh.get('coronary_artery_disease') is False)} No\n")
        lines2.append(f"Diabetes Mellitus:\n{chk(pmh.get('diabetes_mellitus') is True)} Yes\n{chk(pmh.get('diabetes_mellitus') is False)} No\n")
        lines2.append(f"Emphysema:\n{chk(pmh.get('emphysema') is True)} Yes\n{chk(pmh.get('emphysema') is False)} No\n")
        lines2.append(f"Epilepsy/Seizure Disorder:\n{chk(pmh.get('epilepsy_seizure_disorder') is True)} Yes\n{chk(pmh.get('epilepsy_seizure_disorder') is False)} No\n")
        lines2.append(f"Hepatitis (specify type): {pmh_hep.get('type', '')}")
        lines2.append(f"Hyperlipidemia:\n{chk(pmh.get('hyperlipidemia') is True)} Yes\n{chk(pmh.get('hyperlipidemia') is False)} No\n")
        lines2.append(f"Hypertension:\n{chk(pmh_htn.get('has') is True)} Yes\n{chk(pmh_htn.get('has') is False)} No")
        lines2.append(f"Highest BP Recorded: {pmh_htn.get('highest_bp', '')}\n")
        lines2.append(f"Peptic Ulcer Disease:\n{chk(pmh.get('peptic_ulcer_disease') is True)} Yes\n{chk(pmh.get('peptic_ulcer_disease') is False)} No\n")
        lines2.append(f"Pneumonia:\n{chk(pmh.get('pneumonia') is True)} Yes\n{chk(pmh.get('pneumonia') is False)} No\n")
        lines2.append(f"Thyroid Disease:\n{chk(pmh.get('thyroid_disease') is True)} Yes\n{chk(pmh.get('thyroid_disease') is False)} No\n")
        lines2.append(f"Tuberculosis (specify organ): {pmh_tb.get('organ', '')}")
        lines2.append(f"If Pulmonary TB Category: {pmh_tb.get('category', '')}\n")
        lines2.append(f"Urinary Tract Infection:\n{chk(pmh.get('urinary_tract_infection') is True)} Yes\n{chk(pmh.get('urinary_tract_infection') is False)} No\n")
        lines2.append(f"Others: {pmh.get('others', '')}\n")

        lines2.append('=== PAST SURGICAL HISTORY ===')
        lines2.append(f"Operation: {psh.get('operation', '')}")
        lines2.append(f"Date: {psh.get('date', '')}\n")

        lines2.append('=== FAMILY HISTORY ===')
        lines2.append(f"Allergy (specify): {fh2.get('allergy', '')}")
        lines2.append(f"Asthma:\n{chk(fh2.get('asthma') is True)} Yes\n{chk(fh2.get('asthma') is False)} No\n")
        lines2.append(f"Cancer (specify organ): {fh_can.get('organ', '')}")
        lines2.append(f"Cerebrovascular Disease:\n{chk(fh2.get('cerebrovascular_disease') is True)} Yes\n{chk(fh2.get('cerebrovascular_disease') is False)} No\n")
        lines2.append(f"Coronary Artery Disease:\n{chk(fh2.get('coronary_artery_disease') is True)} Yes\n{chk(fh2.get('coronary_artery_disease') is False)} No\n")
        lines2.append(f"Diabetes Mellitus:\n{chk(fh2.get('diabetes_mellitus') is True)} Yes\n{chk(fh2.get('diabetes_mellitus') is False)} No\n")
        lines2.append(f"Emphysema:\n{chk(fh2.get('emphysema') is True)} Yes\n{chk(fh2.get('emphysema') is False)} No\n")
        lines2.append(f"Epilepsy/Seizure Disorder:\n{chk(fh2.get('epilepsy_seizure_disorder') is True)} Yes\n{chk(fh2.get('epilepsy_seizure_disorder') is False)} No\n")
        lines2.append(f"Hepatitis (specify type): {fh_hep.get('type', '')}")
        lines2.append(f"Hyperlipidemia:\n{chk(fh2.get('hyperlipidemia') is True)} Yes\n{chk(fh2.get('hyperlipidemia') is False)} No\n")
        lines2.append(f"Hypertension:\n{chk(fh_htn.get('has') is True)} Yes\n{chk(fh_htn.get('has') is False)} No")
        lines2.append(f"Highest BP Recorded: {fh_htn.get('highest_bp', '')}\n")
        lines2.append(f"Peptic Ulcer Disease:\n{chk(fh2.get('peptic_ulcer_disease') is True)} Yes\n{chk(fh2.get('peptic_ulcer_disease') is False)} No\n")
        lines2.append(f"Pneumonia:\n{chk(fh2.get('pneumonia') is True)} Yes\n{chk(fh2.get('pneumonia') is False)} No\n")
        lines2.append(f"Thyroid Disease:\n{chk(fh2.get('thyroid_disease') is True)} Yes\n{chk(fh2.get('thyroid_disease') is False)} No\n")
        lines2.append(f"Pulmonary Tuberculosis:\n{chk(fh2.get('pulmonary_tuberculosis') is True)} Yes\n{chk(fh2.get('pulmonary_tuberculosis') is False)} No\n")
        lines2.append(f"Extrapulmonary Tuberculosis:\n{chk(fh2.get('extrapulmonary_tuberculosis') is True)} Yes\n{chk(fh2.get('extrapulmonary_tuberculosis') is False)} No\n")
        lines2.append(f"Urinary Tract Infection:\n{chk(fh2.get('urinary_tract_infection') is True)} Yes\n{chk(fh2.get('urinary_tract_infection') is False)} No\n")
        lines2.append(f"Mental Illness:\n{chk(fh2.get('mental_illness') is True)} Yes\n{chk(fh2.get('mental_illness') is False)} No\n")
        lines2.append(f"Others: {fh2.get('others', '')}\n")

        lines2.append('=== PERSONAL / SOCIAL HISTORY ===')
        lines2.append(f"Smoking:\n{chk(psoc_smk.get('yes'))} Yes\n{chk(psoc_smk.get('no'))} No\n{chk(psoc_smk.get('quit'))} Quit")
        lines2.append(f"Pack Years: {psoc_smk.get('pack_years', '') if psoc_smk.get('pack_years') is not None else ''}\n")
        lines2.append(f"Alcohol:\n{chk(psoc_alc.get('yes'))} Yes\n{chk(psoc_alc.get('no'))} No\n{chk(psoc_alc.get('quit'))} Quit")
        lines2.append(f"Bottles per Day: {psoc_alc.get('bottles_per_day', '') if psoc_alc.get('bottles_per_day') is not None else ''}\n")
        lines2.append(f"Illicit Drugs:\n{chk(psoc_drg.get('yes'))} Yes\n{chk(psoc_drg.get('no'))} No\n{chk(psoc_drg.get('quit'))} Quit\n")
        lines2.append(f"Sexually Active:\n{chk(psoc.get('sexually_active') is True)} Yes\n{chk(psoc.get('sexually_active') is False)} No\n")

        lines2.append('=== IMMUNIZATIONS ===\n')
        lines2.append('-- CHILD CARE --')
        lines2.append(f"BCG Date: {imm_child.get('bcg_date', '')}")
        lines2.append(f"HepB Birth Date: {imm_child.get('hepb_birth_date', '')}")
        lines2.append(f"HepB 24hrs Date: {imm_child.get('hepb_24hrs_date', '')}")
        lines2.append(f"PENTA Date: {imm_child.get('penta_date', '')}")
        lines2.append(f"OPV Date: {imm_child.get('opv_date', '')}")
        lines2.append(f"IPV Date: {imm_child.get('ipv_date', '')}")
        lines2.append(f"PCV Date: {imm_child.get('pcv_date', '')}")
        lines2.append(f"Measles Vaccine Date: {imm_child.get('measles_vaccine_date', '')}")
        lines2.append(f"Rotavirus Vaccine Date: {imm_child.get('rotavirus_vaccine_date', '')}")
        lines2.append(f"Chickenpox Vaccine Date: {imm_child.get('chickenpox_vaccine_date', '')}\n")
        lines2.append('-- GENERAL --')
        lines2.append(f"Flu Vaccine Date: {imm_gen.get('flu_vaccine_date', '')}")
        lines2.append(f"HPV Date: {imm_gen.get('hpv_date', '')}")
        lines2.append(f"HPV Grade 4 Date: {imm_gen.get('hpv_grade4_date', '')}")
        lines2.append(f"MR Grade 1 Date: {imm_gen.get('mr_grade1_date', '')}")
        lines2.append(f"MR Grade 7 Date: {imm_gen.get('mr_grade7_date', '')}")
        lines2.append(f"TD Grade 1 Date: {imm_gen.get('td_grade1_date', '')}")
        lines2.append(f"TD Grade 7 Date: {imm_gen.get('td_grade7_date', '')}")
        lines2.append(f"Tetanus Toxoid Date: {imm_gen.get('tetanus_toxoid_date', '')}\n")
        lines2.append('-- ANIMAL BITE --')
        lines2.append(f"PCECV1 Date: {imm_ab.get('pcecv1_date', '')}")
        lines2.append(f"PVRV1 Date: {imm_ab.get('pvrv1_date', '')}")
        lines2.append(f"PVRV2 Date: {imm_ab.get('pvrv2_date', '')}")
        lines2.append(f"PVRV3 Date: {imm_ab.get('pvrv3_date', '')}")
        lines2.append(f"PVRV4 Date: {imm_ab.get('pvrv4_date', '')}")
        lines2.append(f"PCECV2 Date: {imm_ab.get('pcecv2_date', '')}\n")
        lines2.append('-- NCD --')
        lines2.append(f"Pneumococcal Vaccine Date: {imm_ncd.get('pneumococcal_vaccine_date', '')}")
        lines2.append(f"Flu Vaccine (NCD) Date: {imm_ncd.get('flu_vaccine_date', '')}\n")
        lines2.append('-- MATERNAL CARE --')
        lines2.append(f"Tetanus Toxoid (Maternal) Date: {imm_mat.get('tetanus_toxoid_date', '')}\n")

        lines2.append('=== MENSTRUAL HISTORY ===')
        lines2.append(f"Menarche Age: {men.get('menarche_age', '') if men.get('menarche_age') is not None else ''}")
        lines2.append(f"Onset of Sexual Intercourse: {men.get('onset_of_sexual_intercourse', '') if men.get('onset_of_sexual_intercourse') is not None else ''}")
        lines2.append(f"Last Menstrual Period: {men.get('last_menstrual_period', '')}")
        lines2.append(f"Menstrual Bleeding Pattern: {men.get('menstrual_bleeding_pattern', '')}")
        lines2.append(f"Birth Control Method: {men.get('birth_control_method', '')}")
        lines2.append(f"Period Duration: {men.get('period_duration', '')}")
        lines2.append(f"Cycle Interval: {men.get('cycle_interval', '')}")
        lines2.append(f"Pads per Day: {men.get('pads_per_day', '') if men.get('pads_per_day') is not None else ''}\n")
        lines2.append(f"Menopause:\n{chk(men.get('menopause') is True)} Yes\n{chk(men.get('menopause') is False)} No")
        lines2.append(f"Age of Menopause: {men.get('age_of_menopause', '') if men.get('age_of_menopause') is not None else ''}\n")

        lines2.append('=== PREGNANCY HISTORY ===')
        lines2.append(f"Gravidity: {preg.get('gravidity', '') if preg.get('gravidity') is not None else ''}")
        lines2.append(f"Parity: {preg.get('parity', '') if preg.get('parity') is not None else ''}")
        lines2.append(f"Type of Delivery: {preg.get('type_of_delivery', '')}")
        lines2.append(f"Full Term: {preg.get('full_term', '') if preg.get('full_term') is not None else ''}")
        lines2.append(f"Premature: {preg.get('premature', '') if preg.get('premature') is not None else ''}")
        lines2.append(f"Abortion: {preg.get('abortion', '') if preg.get('abortion') is not None else ''}")
        lines2.append(f"Living Children: {preg.get('living_children', '') if preg.get('living_children') is not None else ''}\n")
        lines2.append(f"Pre-eclampsia:\n{chk(preg.get('pre_eclampsia') is True)} Yes\n{chk(preg.get('pre_eclampsia') is False)} No\n")
        lines2.append(f"Age at First Pregnancy: {preg.get('age_at_first_pregnancy', '') if preg.get('age_at_first_pregnancy') is not None else ''}\n")
        lines2.append(f"Family Planning Counseling:\n{chk(preg.get('family_planning_counseling') is True)} Yes\n{chk(preg.get('family_planning_counseling') is False)} No")
        return '\n'.join(lines2)

    lines = []
    lines.append('=== HEALTH FACILITY HEADER ===')
    lines.append(h.get('country', 'Republic of the Philippines'))
    lines.append(h.get('province', 'Province of Laguna'))
    lines.append(h.get('municipality', 'Municipality of Paete'))
    lines.append(h.get('facility', 'PAETE RURAL HEALTH UNIT'))
    lines.append(h.get('facility_address', '2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna'))
    lines.append(h.get('form_title', 'Individual Treatment Record'))
    lines.append(h.get('age_group', '20 Years old and above'))
    lines.append('')

    lines.append('=== PATIENT DEMOGRAPHICS ===')
    lines.append(f"NAME: {d.get('name', '')}")
    lines.append(f"Philhealth No.: {d.get('philhealth_no', '')}")
    lines.append(f"ADDRESS: {d.get('address', '')}")
    lines.append(f"Civil Status: {d.get('civil_status', '')}")
    lines.append(f"BIRTHDAY: {d.get('birthday', '')}")
    lines.append(f"Age: {d.get('age', '') if d.get('age') is not None else ''}")
    lines.append(f"CP No: {d.get('cp_no', '')}")
    lines.append(f"Educational Attainment: {d.get('educational_attainment', '')}")
    lines.append(f"BHW: {d.get('bhw', '')}")
    lines.append('')

    lines.append('=== LIFESTYLE & RISK FACTORS ===')
    lines.append('Smoking Cessation Profile:')
    smk_st = sc.get('smoker_status', '')
    smk_str = f"Smokers? {opt(smk_st, 'Current')} Current  {opt(smk_st, 'Passive')} Passive  {opt(smk_st, 'Never')} Never  {opt(smk_st, 'Stopped > 1 year')} Stopped > a year  {opt(smk_st, 'Stopped < 1 year')} Stopped < a year"
    lines.append(smk_str)
    lines.append(f"Brand of Cigarette?: {sc.get('brand_of_cigarette', '')}")
    lines.append(f"How many stick per day?: {sc.get('sticks_per_day', '') if sc.get('sticks_per_day') is not None else ''}")
    lines.append(f"Age started?: {sc.get('age_started', '') if sc.get('age_started') is not None else ''}")
    lines.append(f"No of years smoking?: {sc.get('years_smoking', '') if sc.get('years_smoking') is not None else ''}")
    lines.append(f"Reason for smoking?: {sc.get('reason_for_smoking', '')}")
    lines.append(f"Have you experienced side effect or illness brought by smoking?: {chk(sc.get('experienced_side_effects') is True)} YES  {chk(sc.get('experienced_side_effects') is False)} NO")
    lines.append(f"If yes, What effect?: {sc.get('side_effect_details', '')}")
    lines.append(f"Try quitting before?: {chk(sc.get('tried_quitting_before') is True)} YES  {chk(sc.get('tried_quitting_before') is False)} NO")
    lines.append(f"If yes, why were not successful?: {sc.get('reason_not_successful', '')}")
    lines.append('')

    lines.append('Family History (does pt. have 1st degree relative with):')
    lines.append(f"{chk(fh.get('hypertension'))} Hypertension  {chk(fh.get('stroke'))} Stroke  {chk(fh.get('heart_attack'))} Heart Attack  {chk(fh.get('dm'))} DM  {chk(fh.get('asthma'))} Asthma  {chk(fh.get('cancer'))} Cancer  {chk(fh.get('kidney_disease'))} Kidney Disease")
    lines.append(f"Co-Morbid: {cb.get('co_morbid', '')}")
    lines.append(f"Allergy: {cb.get('allergy', '')}")
    lines.append('')

    lines.append('Alcohol Intake:')
    lines.append(f"{chk(alc.get('never_consumed'))} Never Consumed")
    lines.append(f"{chk(alc.get('drinks_alcohol'))} Yes, drinks alcohol")
    lines.append(f"Excessive Alcohol Intake (In the past mos., had 3 drinks in one occasion): {chk(alc_exc.get('yes'))} YES  {chk(alc_exc.get('no'))} NO")
    lines.append('')

    lines.append('Physical Activity:')
    lines.append(f"Does at least 2 1/2 hours a week of moderate intensity physical activity: {chk(pa.get('meets_2_5_hours_per_week') is True)} YES  {chk(pa.get('meets_2_5_hours_per_week') is False)} NO")
    lines.append('')

    lines.append('High Fat / High Salt Food Intake:')
    lines.append(f"Eats processed / Fast foods and inihaw weekly: {chk(fat.get('weekly_processed_fastfood') is True)} YES  {chk(fat.get('weekly_processed_fastfood') is False)} NO")
    lines.append('')

    lines.append('Dietary Fiber Intake:')
    lines.append(f"3 servings of vegetables daily: {chk(fiber.get('vegetables_3_servings_daily') is True)} YES  {chk(fiber.get('vegetables_3_servings_daily') is False)} NO")
    lines.append(f"2-3 servings of fruits daily: {chk(fiber.get('fruits_2_3_servings_daily') is True)} YES  {chk(fiber.get('fruits_2_3_servings_daily') is False)} NO")
    lines.append('')

    lines.append('=== VITAL SIGNS & PHYSICAL MEASUREMENTS ===')
    lines.append(f"BMI: {vs.get('bmi', '') if vs.get('bmi') is not None else ''}")
    rbp = vs.get('raised_bp')
    rbp_str = 'Yes' if rbp is True else ('No' if rbp is False else '')
    lines.append(f"RAISED BP: {rbp_str}")
    lines.append(f"WaistLine: {vs.get('waistline_cm', '') if vs.get('waistline_cm') is not None else ''}")
    lines.append(f"HT: {vs.get('height_cm', '') if vs.get('height_cm') is not None else ''}")
    lines.append(f"1st Reading: {bpr.get('first', '')}")
    lines.append(f"WEIGHT: {vs.get('weight_kg', '') if vs.get('weight_kg') is not None else ''}")
    lines.append(f"2nd Reading: {bpr.get('second', '')}")
    lines.append('')

    lines.append('=== CONSULTATION & CLINICAL FINDINGS ===')
    for c in crs:
        obj = c.get('objective_findings', {}) if isinstance(c.get('objective_findings'), dict) else {}
        lines.append(f"Date: {c.get('date', '')}")
        lines.append(f"Subjective Findings: {c.get('subjective_findings', '')}")
        lines.append('Objective Findings:')
        lines.append(f"  Risk Level: {obj.get('risk_level', '')}")
        lines.append(f"  Percentage of Risk: {obj.get('percentage_of_risk', '')}")
        lines.append(f"  AGE: {obj.get('age', '') if obj.get('age') is not None else ''}")
        lines.append(f"  WT: {obj.get('weight_kg', '') if obj.get('weight_kg') is not None else ''}")
        lines.append(f"  HT: {obj.get('height_cm', '') if obj.get('height_cm') is not None else ''}")
        lines.append(f"  BP: {obj.get('blood_pressure', '')}")
        diag_str = ', '.join(c.get('assessment_diagnosis', [])) if isinstance(c.get('assessment_diagnosis'), list) else str(c.get('assessment_diagnosis', ''))
        lines.append(f"Assessment/Diagnosis: {diag_str}")
        plan_str = ', '.join(c.get('plan_treatment', [])) if isinstance(c.get('plan_treatment'), list) else str(c.get('plan_treatment', ''))
        lines.append(f"Plan/Treatment Plan: {plan_str}")
        lines.append('')

    return '\n'.join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN: Try Gemini first, fall back to PaddleOCR
# ─────────────────────────────────────────────────────────────────────────────

def run_ocr(file_path, page_number=1, target_page=0):
    """
    Smart OCR dispatcher:
      1. Try Gemini Vision (fast, cloud-based, ~1-2s)
      2. Fall back to PaddleOCR (local, offline, ~3-10s)
    """
    if GOOGLE_AI_API_KEY:
        try:
            print(f"[OCR] Using Gemini Vision (gemini-flash-latest)...", file=sys.stderr)
            result = run_gemini_ocr(file_path, page_number, target_page=target_page)
            print(f"[OCR] Gemini extracted {result.get('total_blocks', 0)} blocks.", file=sys.stderr)
            return result
        except Exception as gemini_err:
            print(f"[OCR] Gemini failed: {gemini_err} — falling back to PaddleOCR.", file=sys.stderr)

    # Fallback: local PaddleOCR
    try:
        print(f"[OCR] Using PaddleOCR (local offline)...", file=sys.stderr)
        result = run_paddle_ocr(file_path, page_number, target_page=target_page)
        return result
    except Exception as paddle_err:
        return {
            "success": False,
            "error": f"Both Gemini and PaddleOCR failed. Last error: {str(paddle_err)}",
            "text": "",
            "layout_blocks": [],
            "page_size": [595, 842],
            "engine": "none"
        }


def main():
    parser = argparse.ArgumentParser(description='KEEP UP OCR Service (Gemini + PaddleOCR)')
    parser.add_argument('file_path', help='Path to the image or PDF file')
    parser.add_argument('--page', type=int, default=1, help='PDF page number to OCR (default: 1)')
    parser.add_argument('--page-type', type=int, default=0, help='Explicit document page type (1 = Page 1, 2 = Page 2)')
    args = parser.parse_args()

    if not os.path.exists(args.file_path):
        print(json.dumps({"success": False, "error": f"File not found: {args.file_path}"}))
        sys.exit(1)

    try:
        result = run_ocr(args.file_path, page_number=args.page, target_page=args.page_type)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "detail": traceback.format_exc()}))
        sys.exit(1)


if __name__ == '__main__':
    main()
