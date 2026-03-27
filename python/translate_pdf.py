#!/usr/bin/env python3
"""
PDF Translator: Chinese → Russian / English
Preserves layout, fonts, images, tables using PyMuPDF.
Uses free translation engines (Google, Bing, etc.) via translators library — no API key needed.
Batches text to minimize API calls and avoid rate limiting.
"""

import sys
import json
import os
import re
import time
import fitz  # PyMuPDF
import translators as ts
import argparse
import traceback
from pathlib import Path


def log_progress(step: str, progress: int, total: int = 100, message: str = ""):
    data = {
        "type": "progress",
        "step": step,
        "progress": progress,
        "total": total,
        "message": message
    }
    print(json.dumps(data, ensure_ascii=False), flush=True)


def log_warning(message: str):
    print(json.dumps({"type": "warning", "message": message}, ensure_ascii=False), flush=True)


def is_chinese_text(text: str) -> bool:
    if not text or not text.strip():
        return False
    return any('\u4e00' <= c <= '\u9fff' or '\u3400' <= c <= '\u4dbf' for c in text)


def is_numeric_only(text: str) -> bool:
    """Check if text is only numbers, units, symbols — no real words to translate."""
    stripped = text.strip()
    if not stripped:
        return True
    return bool(re.match(r'^[\d\s.,±°/×%<>≤≥≈~\-+()℃℉kKmMgGhHsSwWvVaAdDΩμ°′″\[\]{}:;·•─│┤├┼┌┐└┘]+$', stripped))


# ── Translation with batching ────────────────────────────────────────────

BATCH_SEPARATOR = "\n㊀\n"  # unique separator unlikely to appear in text

def translate_batch(texts: list[str], target_lang: str, engine: str, retries: int = 3) -> list[str]:
    """
    Translate a batch of texts in a single API call by joining them with a separator.
    Falls back to individual translation if batch fails.
    """
    if not texts:
        return []
    
    lang_map = {"RU": "ru", "EN": "en"}
    to_lang = lang_map.get(target_lang, "en")
    
    engines = [engine]
    for fallback in ["google", "bing", "alibaba"]:
        if fallback not in engines:
            engines.append(fallback)
    
    # Try batch translation first
    joined = BATCH_SEPARATOR.join(texts)
    
    for eng in engines:
        for attempt in range(retries):
            try:
                result = ts.translate_text(
                    joined,
                    translator=eng,
                    from_language='zh',
                    to_language=to_lang,
                    timeout=30,
                )
                if result and result.strip():
                    # Split result back into individual translations
                    # Try exact separator first, then fuzzy match
                    parts = result.split("㊀")
                    # Clean up parts
                    parts = [p.strip() for p in parts]
                    # Remove empty parts from edges
                    parts = [p for p in parts if p]
                    
                    if len(parts) == len(texts):
                        time.sleep(0.5)
                        return parts
                    elif len(parts) > len(texts):
                        # Separator appeared in translation, merge extras
                        merged = parts[:len(texts)-1] + [" ".join(parts[len(texts)-1:])]
                        time.sleep(0.5)
                        return merged
                    else:
                        # Fewer parts — separator was lost, fall back to individual
                        log_warning(f"Batch split mismatch ({len(parts)} vs {len(texts)}), trying individual")
                        break
                        
            except Exception as e:
                if attempt < retries - 1:
                    time.sleep(2 * (attempt + 1))
                else:
                    log_warning(f"Engine '{eng}' batch failed: {str(e)[:100]}")
        
        # If we got here from break (split mismatch), try individual with this engine
        individual_results = _translate_individually(texts, to_lang, eng, retries)
        if individual_results:
            return individual_results
    
    # All batch attempts failed, try individual with all engines
    for eng in engines:
        individual_results = _translate_individually(texts, to_lang, eng, retries)
        if individual_results:
            return individual_results
    
    # Complete failure — return originals
    return texts


def _translate_individually(texts: list[str], to_lang: str, engine: str, retries: int) -> list[str] | None:
    """Translate texts one by one as fallback."""
    results = []
    success_count = 0
    
    for text in texts:
        translated = False
        for attempt in range(retries):
            try:
                result = ts.translate_text(
                    text,
                    translator=engine,
                    from_language='zh',
                    to_language=to_lang,
                    timeout=15,
                )
                if result and result.strip():
                    results.append(result)
                    translated = True
                    success_count += 1
                    time.sleep(0.4)
                    break
            except Exception as e:
                if attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1))
        
        if not translated:
            results.append(text)  # Keep original on failure
    
    # Consider success if at least 50% translated
    if success_count >= len(texts) * 0.5:
        return results
    return None


# ── PDF Processing ───────────────────────────────────────────────────────

def translate_pdf(input_path: str, output_path: str, target_lang: str = "RU", engine: str = "google"):
    log_progress("open", 5, message="Открытие PDF файла...")
    
    doc = fitz.open(input_path)
    total_pages = len(doc)
    
    log_progress("analyze", 8, message=f"Анализ документа: {total_pages} стр. Движок: {engine}")
    
    for page_num in range(total_pages):
        page = doc[page_num]
        progress = 10 + int((page_num / total_pages) * 85)
        log_progress("translate", progress, message=f"Перевод страницы {page_num + 1} из {total_pages}...")
        
        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_IMAGES)
        
        # Collect all Chinese text spans
        chinese_spans = []
        
        for block in text_dict.get("blocks", []):
            if block["type"] != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    if is_chinese_text(text) and not is_numeric_only(text):
                        chinese_spans.append({
                            "bbox": fitz.Rect(span["bbox"]),
                            "text": text,
                            "font_size": span.get("size", 10),
                            "color": span.get("color", 0),
                            "font_flags": span.get("flags", 0),
                            "origin": span.get("origin", (span["bbox"][0], span["bbox"][3]))
                        })
        
        if not chinese_spans:
            continue
        
        # Batch translate all Chinese texts on this page
        texts_to_translate = [s["text"] for s in chinese_spans]
        
        # Split into manageable batches (max ~15 texts per batch to stay under char limits)
        BATCH_SIZE = 12
        all_translated = []
        
        for batch_start in range(0, len(texts_to_translate), BATCH_SIZE):
            batch = texts_to_translate[batch_start:batch_start + BATCH_SIZE]
            translated_batch = translate_batch(batch, target_lang, engine)
            all_translated.extend(translated_batch)
        
        # Pair translations with spans
        translations = []
        for i, span_info in enumerate(chinese_spans):
            translated_text = all_translated[i] if i < len(all_translated) else span_info["text"]
            if translated_text != span_info["text"]:
                translations.append({
                    **span_info,
                    "translated": translated_text
                })
        
        if not translations:
            continue
        
        # Redact original Chinese text
        for t in translations:
            rect = t["bbox"]
            expanded = fitz.Rect(rect.x0 - 0.5, rect.y0 - 0.5, rect.x1 + 0.5, rect.y1 + 0.5)
            page.add_redact_annot(expanded, fill=(1, 1, 1))
        
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
        
        # Insert translated text
        page_width = page.rect.width
        page_right = page.rect.x1
        
        for t in translations:
            rect = t["bbox"]
            font_size = t["font_size"]
            
            color_int = t["color"]
            if isinstance(color_int, int):
                r = ((color_int >> 16) & 0xFF) / 255.0
                g = ((color_int >> 8) & 0xFF) / 255.0
                b = (color_int & 0xFF) / 255.0
                color = (r, g, b)
            else:
                color = (0, 0, 0)
            
            fontname = "helv"
            translated_text = t["translated"]
            
            # Calculate max available width: from text start to right page margin (with small padding)
            right_margin = 20  # minimum right margin in points
            max_available_width = page_right - rect.x0 - right_margin
            original_width = rect.x1 - rect.x0
            # Use the larger of original box or available page width, but cap at page boundary
            available_width = max(original_width, min(max_available_width, original_width * 2.5))
            
            current_size = font_size
            text_length = fitz.get_text_length(translated_text, fontname=fontname, fontsize=current_size)
            
            # Shrink font if text overflows available width
            min_size = max(3, font_size * 0.45)  # don't go below 45% of original
            while text_length > available_width and current_size > min_size:
                current_size -= 0.3
                text_length = fitz.get_text_length(translated_text, fontname=fontname, fontsize=current_size)
            
            # If still too long, truncate with ellipsis as last resort
            if text_length > max_available_width and len(translated_text) > 20:
                # Try to fit by trimming words from the end
                words = translated_text.split()
                while len(words) > 1 and fitz.get_text_length(" ".join(words) + "...", fontname=fontname, fontsize=current_size) > max_available_width:
                    words.pop()
                translated_text = " ".join(words)
                if len(words) < len(t["translated"].split()):
                    translated_text += "..."
            
            try:
                tw = fitz.TextWriter(page.rect)
                point = fitz.Point(rect.x0, t["origin"][1] if t["origin"] else rect.y1 - 1)
                tw.append(point, translated_text, fontsize=current_size, font=fitz.Font(fontname))
                tw.write_text(page, color=color)
            except Exception:
                try:
                    page.insert_text(
                        fitz.Point(rect.x0, rect.y1 - 1),
                        translated_text,
                        fontsize=current_size,
                        fontname=fontname,
                        color=color,
                    )
                except Exception as e2:
                    log_warning(f"Insert failed: {str(e2)[:80]}")
    
    log_progress("save", 97, message="Сохранение переведённого PDF...")
    
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    
    log_progress("done", 100, message="Перевод завершён!")
    
    result = {
        "type": "result",
        "success": True,
        "output_path": output_path,
        "pages": total_pages,
        "target_language": target_lang,
        "engine": engine
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Translate PDF from Chinese")
    parser.add_argument("input", help="Input PDF file path")
    parser.add_argument("output", help="Output PDF file path")
    parser.add_argument("--target-lang", default="RU", choices=["RU", "EN"], help="Target language")
    parser.add_argument("--engine", default="google", 
                        choices=["google", "bing", "alibaba", "baidu", "yandex"],
                        help="Translation engine")
    
    args = parser.parse_args()
    
    try:
        translate_pdf(args.input, args.output, args.target_lang, args.engine)
    except Exception as e:
        error = {
            "type": "error",
            "success": False,
            "message": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error, ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
