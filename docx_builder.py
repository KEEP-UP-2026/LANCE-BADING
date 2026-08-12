#!/usr/bin/env python3
"""
KEEP UP System - Word Document Builder
Converts PaddleOCR JSON layout results into a formatted .docx Word document.

Usage:
    python docx_builder.py <ocr_json_path> <output_docx_path> [--title "Document Title"]

The OCR JSON must contain:
    { "layout_blocks": [...], "page_size": [w, h], "text": "..." }

Each block:
    { "text", "font_size_pt", "is_heading", "is_large", "alignment",
      "left_margin_ratio", "y_position_ratio", "bbox", "confidence" }

Output:
    Writes .docx file to output_docx_path
    Prints JSON: { "success": true, "output_path": "..." }
"""

import sys
import os
import json
import argparse
import traceback

try:
    from docx import Document  # type: ignore
    from docx.shared import Pt, Inches, Cm, RGBColor  # type: ignore
    from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore
    from docx.oxml.ns import qn  # type: ignore
    from docx.oxml import OxmlElement  # type: ignore
except ImportError:
    pass


def detect_text_style(block):
    """Determine text style (heading level, bold, font size) from layout analysis."""
    font_size = block.get("font_size_pt", 10)
    is_heading = block.get("is_heading", False)
    is_large = block.get("is_large", False)
    text = block.get("text", "").strip()

    # Heuristics for heading detection
    # 1. Short, large text at top of page = likely title/heading
    if is_heading and font_size >= 16:
        return "heading1"
    elif is_heading and font_size >= 13:
        return "heading2"
    elif is_large and font_size >= 11:
        return "heading3"
    elif text.isupper() and len(text) < 80:
        return "heading3"
    else:
        return "normal"


def get_alignment(alignment_str):
    """Get python-docx alignment constant."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore
    mapping = {
        'center': WD_ALIGN_PARAGRAPH.CENTER,
        'right': WD_ALIGN_PARAGRAPH.RIGHT,
        'left': WD_ALIGN_PARAGRAPH.LEFT,
        'justify': WD_ALIGN_PARAGRAPH.JUSTIFY,
    }
    return mapping.get(alignment_str, WD_ALIGN_PARAGRAPH.LEFT)


def build_docx(ocr_data, output_path, title=None):
    """Build a .docx document from OCR layout data."""
    from docx import Document  # type: ignore
    from docx.shared import Pt, Inches, Cm, RGBColor  # type: ignore
    from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore
    from docx.oxml.ns import qn  # type: ignore
    from docx.oxml import OxmlElement  # type: ignore
    import re


    doc = Document()

    # Set page margins (A4-like, consistent with typical medical forms)
    sections = doc.sections
    for section in sections:
        section.page_width = Cm(21.0)    # A4 width
        section.page_height = Cm(29.7)   # A4 height
        section.left_margin = Cm(2.54)
        section.right_margin = Cm(2.54)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)

    # Set default paragraph font
    style = doc.styles['Normal']
    font = style.font
    font.name = 'Calibri'
    font.size = Pt(11)
    font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)

    # Set heading styles
    for h_level in ['Heading 1', 'Heading 2', 'Heading 3']:
        try:
            hstyle = doc.styles[h_level]
            hstyle.font.name = 'Calibri'
            if h_level == 'Heading 1':
                hstyle.font.size = Pt(16)
                hstyle.font.bold = True
                hstyle.font.color.rgb = RGBColor(0x1F, 0x39, 0x64)
            elif h_level == 'Heading 2':
                hstyle.font.size = Pt(13)
                hstyle.font.bold = True
                hstyle.font.color.rgb = RGBColor(0x26, 0x4F, 0x78)
            elif h_level == 'Heading 3':
                hstyle.font.size = Pt(12)
                hstyle.font.bold = True
                hstyle.font.color.rgb = RGBColor(0x31, 0x6B, 0xA8)
        except Exception:
            pass

    # Add title if provided
    if title:
        title_para = doc.add_heading(title, level=1)
        title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph()  # spacing

    blocks = ocr_data.get("layout_blocks", [])

    if not blocks:
        # Fallback: just dump the plain text
        plain_text = ocr_data.get("text", "")
        if plain_text.strip():
            for line in plain_text.split('\n'):
                line = line.strip()
                if line:
                    doc.add_paragraph(line)
        else:
            # No content at all — add a placeholder note
            para = doc.add_paragraph("(No text content could be extracted from this document.)")
            para.runs[0].font.color.rgb = RGBColor(0x99, 0x99, 0x99)
        return doc  # Always return doc object

    # Group blocks into logical rows (blocks within ~1.5% of page height of each other = same row)
    page_height = ocr_data.get("page_size", [1, 1000])[1]
    row_threshold = 0.015  # 1.5% of page height

    rows = []
    current_row = []
    last_y = -999

    for block in blocks:
        y = block.get("y_position_ratio", 0)
        if abs(y - last_y) > row_threshold and current_row:
            rows.append(current_row)
            current_row = []
        current_row.append(block)
        last_y = y

    if current_row:
        rows.append(current_row)

    # Track previous paragraph y to add spacing for large gaps
    prev_row_y = 0

    for row in rows:
        # Sort row left to right
        row_sorted = sorted(row, key=lambda b: b.get("left_margin_ratio", 0))

        # Check vertical gap from previous row
        row_y = row_sorted[0].get("y_position_ratio", 0)
        vertical_gap = row_y - prev_row_y

        # Add blank line for large vertical gaps (section breaks)
        if prev_row_y > 0 and vertical_gap > 0.06:
            doc.add_paragraph()

        prev_row_y = row_y

        # Combine all text in this row into one paragraph
        row_text = '  '.join(b.get("text", "").strip() for b in row_sorted if b.get("text", "").strip())
        if not row_text.strip():
            continue

        # Determine style from the largest/most prominent block in the row
        primary_block = max(row_sorted, key=lambda b: b.get("font_size_pt", 0))
        style_type = detect_text_style(primary_block)
        alignment = get_alignment(primary_block.get("alignment", "left"))
        font_size = primary_block.get("font_size_pt", 11)

        if style_type == "heading1":
            para = doc.add_heading(row_text, level=1)
        elif style_type == "heading2":
            para = doc.add_heading(row_text, level=2)
        elif style_type == "heading3":
            para = doc.add_heading(row_text, level=3)
        else:
            para = doc.add_paragraph()
            run = para.add_run(row_text)
            run.font.name = 'Calibri'
            run.font.size = Pt(max(8, min(font_size, 14)))  # clamp to 8-14pt

            # Detect if it looks like a label (ends with colon, all caps short)
            text_clean = row_text.strip()
            if text_clean.endswith(':') or (text_clean.isupper() and len(text_clean) < 60):
                run.bold = True

        para.alignment = alignment

        # Set paragraph spacing
        para.paragraph_format.space_before = Pt(2)
        para.paragraph_format.space_after = Pt(2)

    return doc


def main():
    parser = argparse.ArgumentParser(description='KEEP UP Word Document Builder')
    parser.add_argument('ocr_json_path', help='Path to OCR JSON file or "-" to read from stdin')
    parser.add_argument('output_docx_path', help='Output path for the .docx file')
    parser.add_argument('--title', default=None, help='Optional document title')
    args = parser.parse_args()

    # Load OCR JSON
    try:
        if args.ocr_json_path == '-':
            ocr_data = json.load(sys.stdin)
        else:
            with open(args.ocr_json_path, 'r', encoding='utf-8') as f:
                ocr_data = json.load(f)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to load OCR JSON: {e}"}))
        sys.exit(1)

    # Build docx
    try:
        doc = build_docx(ocr_data, args.output_docx_path, title=args.title)
        doc.save(args.output_docx_path)
        print(json.dumps({
            "success": True,
            "output_path": args.output_docx_path,
            "total_blocks": ocr_data.get("total_blocks", len(ocr_data.get("layout_blocks", [])))
        }))
    except Exception as e:
        err_detail = traceback.format_exc()
        print(json.dumps({
            "success": False,
            "error": str(e),
            "detail": err_detail
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
