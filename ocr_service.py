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


# ─────────────────────────────────────────────────────────────────────────────
# PRIMARY: Gemini Vision OCR
# ─────────────────────────────────────────────────────────────────────────────

def run_gemini_ocr(file_path, page_number=1):
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

    # Resize large images to max 1200px on the longest side to reduce Gemini token usage
    # and significantly speed up OCR processing time.
    MAX_DIM = 1200
    if img_pil.width > MAX_DIM or img_pil.height > MAX_DIM:
        img_pil.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
        print(f"[OCR] Resized image to {img_pil.width}x{img_pil.height} for Gemini.", file=sys.stderr)

    # Structured extraction prompt — asks Gemini to return JSON layout blocks & complete ITR schema
    prompt = """You are an expert medical document OCR and health record digitization system.
Analyze this medical document/form image carefully.

Your goal is to extract ALL information and categorize it into the exact structured JSON schema below.

Return ONLY a valid JSON object in this exact format (no markdown code fences around JSON):
{
  "full_text": "Categorized document text organized into neat sections with clear headings (=== SECTION NAME ===)",
  "itr_page_number": 1,
  "itr_data": {
    "header": {
      "country": "Republic of the Philippines",
      "province": "Province of Laguna",
      "municipality": "Municipality of Paete",
      "facility": "PAETE RURAL HEALTH UNIT",
      "facility_address": "2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna",
      "form_title": "Individual Treatment Record",
      "age_group": "20 Years old and above"
    },
    "patient_demographics": {
      "name": "",
      "philhealth_no": "",
      "address": "",
      "civil_status": "",
      "birthday": "",
      "age": null,
      "cp_no": "",
      "educational_attainment": "",
      "bhw": ""
    },
    "smoking_cessation_profile": {
      "smoker_status": "",
      "options": {
        "current": false,
        "passive": false,
        "never": false,
        "stopped_gt_1_year": false,
        "stopped_lt_1_year": false
      },
      "brand_of_cigarette": "",
      "sticks_per_day": null,
      "age_started": null,
      "years_smoking": null,
      "reason_for_smoking": "",
      "experienced_side_effects": false,
      "side_effect_details": "",
      "tried_quitting_before": false,
      "quit_attempt_success": false,
      "reason_not_successful": ""
    },
    "family_history": {
      "has_1st_degree_relative": false,
      "hypertension": false,
      "stroke": false,
      "heart_attack": false,
      "dm": false,
      "asthma": false,
      "cancer": false,
      "kidney_disease": false
    },
    "clinical_background": {
      "co_morbid": "",
      "allergy": ""
    },
    "alcohol_intake": {
      "never_consumed": false,
      "drinks_alcohol": false,
      "excessive_alcohol_intake": {
        "definition": "In the past mos., had 5 drinks in one occasion",
        "yes": false,
        "no": false
      }
    },
    "diet_and_lifestyle": {
      "physical_activity": {
        "meets_2_5_hours_per_week": false
      },
      "high_fat_high_salt_food_intake": {
        "weekly_processed_fastfood": false
      },
      "dietary_fiber_intake": {
        "vegetables_3_servings_daily": false,
        "fruits_2_3_servings_daily": false
      }
    },
    "vital_signs": {
      "bmi": null,
      "waistline_cm": null,
      "height_cm": null,
      "weight_kg": null,
      "raised_bp": false,
      "blood_pressure_readings": {
        "first": "",
        "second": ""
      }
    },
    "consultation_records": [
      {
        "date": "",
        "subjective_findings": "",
        "objective_findings": {
          "risk_table_present": false,
          "age": null,
          "weight_kg": null,
          "height_cm": null,
          "blood_pressure": ""
        },
        "assessment_diagnosis": [],
        "plan_treatment": []
      }
    ]
  },
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

Formatting Rules:
1. Set `itr_page_number` to 1 if the document contains Demographics, Lifestyle & Risk Factors, or Vital Signs (Page 1 of ITR). Set to 2 if it is a Follow-up Consultation / Continuation log page (Page 2 of ITR).
2. In `full_text`, DO NOT leave loose unorganized lines. Organize EVERYTHING into neat, labeled sections:
   === HEALTH FACILITY HEADER ===
   === PATIENT DEMOGRAPHICS ===
   === SMOKING CESSATION PROFILE ===
   === FAMILY HISTORY & CLINICAL BACKGROUND ===
   === ALCOHOL, DIET & PHYSICAL ACTIVITY ===
   === VITAL SIGNS & PHYSICAL MEASUREMENTS ===
   === CONSULTATION & CLINICAL FINDINGS ===
3. Fill out ALL populated or checked form fields accurately into `itr_data`.
4. Return ONLY valid JSON."""

    # Only use confirmed-working models (others return 404 and waste retry time)
    gemini_models = ['gemini-flash-latest']
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

    itr_data = parsed.get('itr_data', None)
    if not itr_data and parsed.get('full_text'):
        itr_data = parse_ocr_text_to_json(parsed.get('full_text'))

    if itr_data:
        full_text = format_itr_to_standard_template(itr_data)
    else:
        full_text = parsed.get('full_text', '')

    blocks_raw = parsed.get('blocks', [])
    itr_page_number = parsed.get('itr_page_number', 1)

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

def run_paddle_ocr(file_path, page_number=1):
    """Fallback OCR using local PaddleOCR model."""
    from paddleocr import PaddleOCR  # type: ignore
    from PIL import Image  # type: ignore
    import numpy as np  # type: ignore

    ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

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

    return {
        "success": True,
        "text": '\n'.join(full_text_lines),
        "layout_blocks": layout_blocks,
        "page_size": page_size,
        "total_blocks": len(layout_blocks),
        "engine": "paddleocr"
    }


def parse_ocr_text_to_json(text):
    if not text or not isinstance(text, str):
        return {}

    def split_sections(txt):
        pattern = r"=== (.*?) ===([\s\S]*?)(?===|$)"
        matches = re.findall(pattern, txt)
        return {k.strip(): v.strip() for k, v in matches}

    def get_value(block, label):
        if not block:
            return ""
        clean_label = label.rstrip('?:').strip()
        pattern = rf"^[ \t]*{re.escape(clean_label)}[\?: \t]*([^\n]*)$"
        match = re.search(pattern, block, re.MULTILINE | re.IGNORECASE)
        return match.group(1).strip() if match else ""

    def get_number(val):
        try:
            return float(re.search(r"[\d.]+", val).group())
        except:
            return None

    def checkbox(block, label):
        if not block:
            return False
        escaped = re.escape(label.strip())
        pattern = rf"\[X\]\s*{escaped}"
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
            "birthday": get_value(block, "BIRTHDAY"),
            "age": int(age_num) if age_num is not None else 0,
            "cp_no": get_value(block, "CP No"),
            "educational_attainment": get_value(block, "Educational Attainment"),
            "bhw": get_value(block, "BHW")
        }

    sections = split_sections(text)

    header_block = sections.get("HEALTH FACILITY HEADER", "")
    patient_block = sections.get("PATIENT DEMOGRAPHICS", "")

    lifestyle_key = next((k for k in sections if "LIFESTYLE" in k or "SMOKING" in k), "LIFESTYLE & RISK FACTORS")
    lifestyle_risk_block = sections.get(lifestyle_key, "")

    vitals_key = next((k for k in sections if "VITAL" in k), "VITAL SIGNS & PHYSICAL MEASUREMENTS")
    vitals_block = sections.get(vitals_key, "")

    consult_key = next((k for k in sections if "CONSULTATION" in k), "CONSULTATION & CLINICAL FINDINGS")
    consult_block = sections.get(consult_key, "")

    smk_st = "Never" if checkbox(lifestyle_risk_block, "Never") else ("Current" if checkbox(lifestyle_risk_block, "Current") else ("Passive" if checkbox(lifestyle_risk_block, "Passive") else None))

    exp_yes = "Have you experienced side effect" in lifestyle_risk_block and checkbox(lifestyle_risk_block.split("Have you experienced side effect")[1].split("\n")[0], "YES")
    exp_no  = "Have you experienced side effect" in lifestyle_risk_block and checkbox(lifestyle_risk_block.split("Have you experienced side effect")[1].split("\n")[0], "NO")

    quit_yes = "Try quitting before" in lifestyle_risk_block and checkbox(lifestyle_risk_block.split("Try quitting before")[1].split("\n")[0], "YES")
    quit_no  = "Try quitting before" in lifestyle_risk_block and checkbox(lifestyle_risk_block.split("Try quitting before")[1].split("\n")[0], "NO")

    smoking = {
        "smoker_status": smk_st,
        "options": {
            "current": checkbox(lifestyle_risk_block, "Current"),
            "passive": checkbox(lifestyle_risk_block, "Passive"),
            "never": checkbox(lifestyle_risk_block, "Never"),
            "stopped_gt_1_year": checkbox(lifestyle_risk_block, "Stopped > a year"),
            "stopped_lt_1_year": checkbox(lifestyle_risk_block, "Stopped < a year")
        },
        "brand_of_cigarette": get_value(lifestyle_risk_block, "Brand of Cigarette"),
        "sticks_per_day": get_number(get_value(lifestyle_risk_block, "How many stick per day")),
        "age_started": get_number(get_value(lifestyle_risk_block, "Age started")),
        "years_smoking": get_number(get_value(lifestyle_risk_block, "No of years smoking")),
        "reason_for_smoking": get_value(lifestyle_risk_block, "Reason for smoking"),
        "experienced_side_effects": True if exp_yes else (False if exp_no else None),
        "side_effect_details": get_value(lifestyle_risk_block, "If yes, What effect"),
        "tried_quitting_before": True if quit_yes else (False if quit_no else None),
        "quit_attempt_success": None,
        "reason_not_successful": get_value(lifestyle_risk_block, "If yes, why were not successful")
    }

    family = {
        "has_1st_degree_relative": True,
        "hypertension": checkbox(lifestyle_risk_block, "Hypertension"),
        "stroke": checkbox(lifestyle_risk_block, "Stroke"),
        "heart_attack": checkbox(lifestyle_risk_block, "Heart Attack"),
        "dm": checkbox(lifestyle_risk_block, "DM"),
        "asthma": checkbox(lifestyle_risk_block, "Asthma"),
        "cancer": checkbox(lifestyle_risk_block, "Cancer"),
        "kidney_disease": checkbox(lifestyle_risk_block, "Kidney Disease")
    }

    clinical = {
        "co_morbid": get_value(lifestyle_risk_block, "Co-Morbid"),
        "allergy": get_value(lifestyle_risk_block, "Allergy")
    }

    exc_line = re.search(r"Excessive Alcohol Intake.*", lifestyle_risk_block)
    exc_text = exc_line.group(0) if exc_line else ""
    exc_def = re.search(r"\((.*?)\)", exc_text)

    alcohol_intake = {
        "never_consumed": checkbox(lifestyle_risk_block, "Never Consumed"),
        "drinks_alcohol": checkbox(lifestyle_risk_block, "Yes, drinks alcohol"),
        "excessive_alcohol_intake": {
            "definition": exc_def.group(1) if exc_def else "In the past mos., had 3 drinks in one occasion",
            "yes": checkbox(exc_text, "YES"),
            "no": checkbox(exc_text, "NO")
        }
    }

    pa_line = re.search(r"Does at least 2 1/2 hours.*", lifestyle_risk_block)
    pa_text = pa_line.group(0) if pa_line else ""

    fat_line = re.search(r"Eats processed.*", lifestyle_risk_block)
    fat_text = fat_line.group(0) if fat_line else ""

    veg_line = re.search(r"3 servings of vegetables daily.*", lifestyle_risk_block)
    veg_text = veg_line.group(0) if veg_line else ""

    fruit_line = re.search(r"2-3 servings of fruits daily.*", lifestyle_risk_block)
    fruit_text = fruit_line.group(0) if fruit_line else ""

    diet_and_lifestyle = {
        "physical_activity": {
            "meets_2_5_hours_per_week": True if checkbox(pa_text, "YES") else (False if checkbox(pa_text, "NO") else None)
        },
        "high_fat_high_salt_food_intake": {
            "weekly_processed_fastfood": True if checkbox(fat_text, "YES") else (False if checkbox(fat_text, "NO") else None)
        },
        "dietary_fiber_intake": {
            "vegetables_3_servings_daily": True if checkbox(veg_text, "YES") else (False if checkbox(veg_text, "NO") else None),
            "fruits_2_3_servings_daily": True if checkbox(fruit_text, "YES") else (False if checkbox(fruit_text, "NO") else None)
        }
    }

    def parse_vitals(block):
        return {
            "bmi": get_number(get_value(block, "BMI")),
            "waistline_cm": get_number(get_value(block, "WaistLine")),
            "height_cm": get_number(get_value(block, "HT")),
            "weight_kg": get_number(get_value(block, "WEIGHT")),
            "raised_bp": "Yes" in get_value(block, "RAISED BP"),
            "blood_pressure_readings": {
                "first": get_value(block, "1ST READING") or get_value(block, "1st Reading"),
                "second": get_value(block, "2ND READING") or get_value(block, "2nd Reading")
            }
        }

    def parse_consultation(block):
        entries = re.split(r"Date:", block)[1:]
        results = []

        for entry in entries:
            lines = [l.strip() for l in entry.strip().split("\n") if l.strip()]
            date = lines[0] if lines else ""

            subj = get_value(entry, "Subjective Findings")

            age_match = re.search(r"AGE:\s*(\d+)", entry, re.I)
            wt_match  = re.search(r"WT:\s*(\d+)", entry, re.I)
            ht_match  = re.search(r"HT:\s*(\d+)", entry, re.I)
            bp_match  = re.search(r"BP:\s*([\d/]+\s*mmHg)", entry, re.I)

            age = int(age_match.group(1)) if age_match else None
            wt  = int(wt_match.group(1)) if wt_match else None
            ht  = int(ht_match.group(1)) if ht_match else None
            bp  = bp_match.group(1) if bp_match else ""

            diag_block = re.search(r"Assessment/Diagnosis:\s*(.*?)(?=Plan/|$)", entry, re.DOTALL) or re.search(r"Assessment Diagnosis:\s*(.*?)(?=Plan/|$)", entry, re.DOTALL)
            diag = []
            if diag_block:
                raw_d = diag_block.group(1).strip()
                diag = [item.strip() for item in raw_d.split(",") if item.strip()]

            plan_block = re.search(r"Plan/Treatment Plan:\s*(.*)", entry, re.DOTALL) or re.search(r"Plan/ Treatment Plan:\s*(.*)", entry, re.DOTALL)
            plan = []
            if plan_block:
                raw_p = plan_block.group(1).strip()
                plan = [item.strip() for item in raw_p.split(",") if item.strip()]

            results.append({
                "date": date,
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

        return results

    return {
        "header": parse_header(header_block),
        "patient_demographics": parse_patient(patient_block),
        "smoking_cessation_profile": smoking,
        "family_history": family,
        "clinical_background": clinical,
        "alcohol_intake": alcohol_intake,
        "diet_and_lifestyle": diet_and_lifestyle,
        "vital_signs": parse_vitals(vitals_block),
        "consultation_records": parse_consultation(consult_block)
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

def run_ocr(file_path, page_number=1):
    """
    Smart OCR dispatcher:
      1. Try Gemini Vision (fast, cloud-based, ~1-2s)
      2. Fall back to PaddleOCR (local, offline, ~3-10s)
    """
    # Attempt Gemini Vision if API key is configured
    if GOOGLE_AI_API_KEY:
        try:
            print(f"[OCR] Using Gemini Vision (gemini-flash-latest)...", file=sys.stderr)
            result = run_gemini_ocr(file_path, page_number)
            print(f"[OCR] Gemini extracted {result['total_blocks']} blocks.", file=sys.stderr)
            return result
        except Exception as gemini_err:
            print(f"[OCR] Gemini failed: {gemini_err} — falling back to PaddleOCR.", file=sys.stderr)

    # Fallback: local PaddleOCR
    try:
        print(f"[OCR] Using PaddleOCR (local offline)...", file=sys.stderr)
        result = run_paddle_ocr(file_path, page_number)
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
    args = parser.parse_args()

    if not os.path.exists(args.file_path):
        print(json.dumps({"success": False, "error": f"File not found: {args.file_path}"}))
        sys.exit(1)

    try:
        result = run_ocr(args.file_path, page_number=args.page)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "detail": traceback.format_exc()}))
        sys.exit(1)


if __name__ == '__main__':
    main()
