#!/usr/bin/env python3
"""
KEEP UP System - Document Scanner & Image Enhancer
Full Computer Vision Pipeline for Medical Document Digitization:

  Step 1: Grayscale + Gaussian Blur       — Remove noise / background texture
  Step 2: Edge Detection (Canny)          — Find sharp edges / document boundary
  Step 3: Contour Extraction              — Find the 4-corner document rectangle
  Step 4: Perspective Transformation      — Warp/flatten tilted photo to flat scan
  Step 5: Image Enhancement (Adaptive Thresholding + CLAHE + Unsharp Mask)

Usage:
    python image_enhancer.py <input_path> <output_path> [--pdf-page 1] [--no-bg-remove]

Output JSON to stdout:
    {
      "success": true,
      "output_path": "...",
      "angle_corrected": float,
      "resolution": [w, h],
      "bg_removed": bool,
      "perspective_corrected": bool
    }
"""

import sys
import os
import json
import argparse
import traceback

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
    from PIL import Image  # type: ignore
except ImportError:
    pass


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1-3: Grayscale → Blur → Edges → Find Document Corners
# ─────────────────────────────────────────────────────────────────────────────

def order_points(pts):
    """
    Sort 4 corner points into consistent order:
    [top-left, top-right, bottom-right, bottom-left]
    """
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left: smallest sum
    rect[2] = pts[np.argmax(s)]   # bottom-right: largest sum
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right: smallest diff
    rect[3] = pts[np.argmax(diff)]  # bottom-left: largest diff
    return rect


def find_document_contour(img_cv):
    """
    Step 1-3: Detect the document's 4 corners using Canny edges + contour search.
    Returns the 4 corner points as a (4,2) float32 array, or None if not found.
    """
    h, w = img_cv.shape[:2]
    total_area = h * w

    # Step 1: Grayscale + Gaussian Blur (removes background texture noise)
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)

    # Step 2: Edge Detection — Canny finds sharp borders between paper and background
    # Use automatic threshold selection via median pixel value
    median_val = float(np.median(blurred))
    sigma = 0.33
    lo = int(max(0, (1.0 - sigma) * median_val))
    hi = int(min(255, (1.0 + sigma) * median_val))
    edges = cv2.Canny(blurred, lo, hi)

    # Dilate edges slightly to close small gaps in document border
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.dilate(edges, kernel, iterations=1)

    # Step 3: Contour Extraction — find all shapes, sorted largest → smallest
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    doc_corners = None
    for c in contours:
        # Only consider contours that cover at least 15% of the image
        if cv2.contourArea(c) < total_area * 0.15:
            break

        # Approximate contour shape — reduce to polygon
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)

        # We want exactly 4 corners — that's our document rectangle
        if len(approx) == 4:
            doc_corners = approx.reshape(4, 2).astype("float32")
            break

    return doc_corners


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Perspective Transformation (Warp flat)
# ─────────────────────────────────────────────────────────────────────────────

def four_point_transform(img_cv, pts):
    """
    Step 4: Perspective Transform.
    Given 4 corner points of a document in a photo,
    mathematically warp/stretch the image so the document
    appears flat and rectangular — as if scanned from directly above.
    """
    rect = order_points(pts)
    (tl, tr, br, bl) = rect

    # Compute output width: max of bottom edge width vs top edge width
    width_bottom = np.linalg.norm(br - bl)
    width_top    = np.linalg.norm(tr - tl)
    max_width = max(int(width_bottom), int(width_top))

    # Compute output height: max of right edge vs left edge
    height_right = np.linalg.norm(tr - br)
    height_left  = np.linalg.norm(tl - bl)
    max_height = max(int(height_right), int(height_left))

    # Destination points — a perfect upright rectangle
    dst = np.array([
        [0,           0          ],
        [max_width-1, 0          ],
        [max_width-1, max_height-1],
        [0,           max_height-1]
    ], dtype="float32")

    # Compute the perspective transform matrix and apply it
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img_cv, M, (max_width, max_height))

    return warped


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Image Enhancement — Adaptive Threshold + CLAHE + Sharpening
# ─────────────────────────────────────────────────────────────────────────────

def enhance_scanned_document(img_cv):
    """
    Step 5: Make the warped image look like a clean flatbed scanner output.

    - Adaptive Thresholding: Forces background → pure white, text → pure black
      even under uneven lighting or shadows (unlike global thresholding).
    - CLAHE: Boosts contrast in dark areas (faint pencil handwriting, light ink).
    - Unsharp Mask: Crisp, sharp text edges for better OCR accuracy.
    """
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

    # CLAHE — enhance local contrast (helps with faint handwriting / uneven light)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    cl = clahe.apply(gray)

    # Adaptive Thresholding — background → white, text → black
    # Block size 11 means: each 11x11 region is evaluated independently
    adaptive = cv2.adaptiveThreshold(
        cl, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=11,
        C=10
    )

    # Convert back to BGR (3-channel) so downstream pipeline stays consistent
    result_bgr = cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)

    # Unsharp Mask — sharpen text edges
    gaussian = cv2.GaussianBlur(result_bgr, (0, 0), 3)
    sharpened = cv2.addWeighted(result_bgr, 1.5, gaussian, -0.5, 0)

    return sharpened


# ─────────────────────────────────────────────────────────────────────────────
# FALLBACK: Deskew-only (when 4-corner detection fails)
# ─────────────────────────────────────────────────────────────────────────────

def deskew_image(img_cv):
    """
    Fallback deskew: detect text line tilt angle and rotate to horizontal.
    Used when 4-corner perspective detection fails (e.g., already-flat scans).
    Returns (rotated_image, angle_corrected).
    """
    try:
        gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (9, 9), 0)
        thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 5))
        dilate = cv2.dilate(thresh, kernel, iterations=2)
        contours, _ = cv2.findContours(dilate, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        angles = []
        for c in contours:
            if cv2.contourArea(c) > 1000:
                rect = cv2.minAreaRect(c)
                angle = rect[-1]
                if angle < -45:
                    angle = 90 + angle
                elif angle > 45:
                    angle = angle - 90
                if -25 <= angle <= 25:
                    angles.append(angle)

        if not angles:
            return img_cv, 0.0

        median_angle = float(np.median(angles))
        if abs(median_angle) > 0.5:
            h, w = img_cv.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
            rotated = cv2.warpAffine(
                img_cv, M, (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE
            )
            return rotated, round(median_angle, 2)
        return img_cv, 0.0

    except Exception:
        return img_cv, 0.0


def enhance_flat_document(img_cv):
    """
    Enhancement for already-flat scans (no perspective correction needed).
    Same CLAHE + adaptive threshold + sharpen pipeline.
    """
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    cl = clahe.apply(gray)

    lab = cv2.merge([cl,
                     cv2.cvtColor(img_cv, cv2.COLOR_BGR2LAB)[:,:,1],
                     cv2.cvtColor(img_cv, cv2.COLOR_BGR2LAB)[:,:,2]])
    enhanced_bgr = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    gaussian = cv2.GaussianBlur(enhanced_bgr, (0, 0), 3)
    sharpened = cv2.addWeighted(enhanced_bgr, 1.4, gaussian, -0.4, 0)
    denoised = cv2.fastNlMeansDenoisingColored(sharpened, None, 5, 5, 7, 21)

    return denoised


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

def process_image(input_path, output_path, pdf_page=1, skip_bg_remove=False):
    """
    Full document scanner pipeline:
      If 4 document corners found  → Steps 1-5 (full perspective warp + enhance)
      Otherwise                    → Fallback deskew + CLAHE enhancement
    """
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    # Load image (PDF or raster)
    if input_path.lower().endswith('.pdf'):
        from pdf2image import convert_from_path  # type: ignore
        images = convert_from_path(input_path, dpi=200, first_page=pdf_page, last_page=pdf_page)
        if not images:
            raise ValueError(f"Could not render PDF page {pdf_page}")
        img_cv = cv2.cvtColor(np.array(images[0]), cv2.COLOR_RGB2BGR)
    else:
        img_cv = cv2.imread(input_path)
        if img_cv is None:
            raise ValueError(f"Failed to read image file: {input_path}")

    angle_corrected = 0.0
    perspective_corrected = False
    bg_removed = False

    if not skip_bg_remove:
        # ── Try full perspective correction pipeline (Steps 1–5) ──────────────
        doc_corners = find_document_contour(img_cv)

        if doc_corners is not None:
            # Step 4: Warp the tilted photo into a flat rectangle
            warped = four_point_transform(img_cv, doc_corners)

            # Step 5: Enhance — adaptive threshold + CLAHE + sharpen
            result = enhance_scanned_document(warped)

            perspective_corrected = True
            bg_removed = True  # Perspective crop inherently removes the background

            # Estimate effective angle correction from corner geometry
            (tl, tr, _, _) = order_points(doc_corners)
            dx = float(tr[0] - tl[0])
            dy = float(tr[1] - tl[1])
            angle_corrected = round(-float(np.degrees(np.arctan2(dy, dx))), 2) if dx != 0 else 0.0

        else:
            # ── Fallback: simple deskew + CLAHE for already-flat images ──────
            deskewed, angle_corrected = deskew_image(img_cv)
            result = enhance_flat_document(deskewed)
            perspective_corrected = False
            bg_removed = False
    else:
        # Skip all background/perspective processing
        deskewed, angle_corrected = deskew_image(img_cv)
        result = enhance_flat_document(deskewed)

    # Ensure output directory exists and save
    out_dir = os.path.dirname(output_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    cv2.imwrite(output_path, result)
    h, w = result.shape[:2]

    return {
        "success": True,
        "output_path": output_path,
        "angle_corrected": angle_corrected,
        "resolution": [w, h],
        "bg_removed": bg_removed,
        "perspective_corrected": perspective_corrected
    }


def main():
    parser = argparse.ArgumentParser(description='KEEP UP Document Scanner & Image Enhancer')
    parser.add_argument('input_path',   help='Path to raw input image/PDF')
    parser.add_argument('output_path',  help='Path to save enhanced output image')
    parser.add_argument('--pdf-page',   type=int, default=1, help='PDF page number (default: 1)')
    parser.add_argument('--no-bg-remove', action='store_true', help='Skip perspective correction and background removal')
    args = parser.parse_args()

    if not os.path.exists(args.input_path):
        print(json.dumps({"success": False, "error": f"Input file not found: {args.input_path}"}))
        sys.exit(1)

    try:
        res = process_image(
            args.input_path,
            args.output_path,
            pdf_page=args.pdf_page,
            skip_bg_remove=args.no_bg_remove
        )
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "detail": traceback.format_exc()
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
