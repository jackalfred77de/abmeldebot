#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_vollmacht.py  --  Vollmacht Abmeldung (bilingual, one page)
Uses PyMuPDF (fitz) — same library already used by fill_abmeldung.py
Args: json_data output_path
"""
import sys, json, os, base64, io
from datetime import date
import fitz  # PyMuPDF

# ── translations ────────────────────────────────────────────────────────────
TRANS = {
    'DE': {
        'title':       'Vollmacht',
        'hereby':      'Hiermit bevollmächtige ich',
        'represent':   'mich gegenüber dem zuständigen Bürgeramt / der zuständigen Meldebehörde im Zusammenhang mit meiner Abmeldung einer Wohnung in Berlin zu vertreten.',
        'scope':       'Die Vollmacht umfasst die Befugnis, die Abmeldung in meinem Namen zu erklären, erforderliche Unterlagen einzureichen sowie Bestätigungen und sonstige Schreiben im Zusammenhang mit der Abmeldung entgegenzunehmen.',
        'address_lbl': 'Abzumeldende Wohnung:',
        'name_lbl':    'Name:',
        'birth_lbl':   'Geburtsdatum:',
        'moveout_lbl': 'Auszugsdatum:',
        'place_lbl':   'Ort, Datum:',
        'sig_lbl':     'Unterschrift:',
        'berlin_date': 'Berlin, ',
    },
    'PT': {
        'title':       'Procuração',
        'hereby':      'Por meio desta, outorgo poderes a',
        'represent':   'para me representar perante a Junta de Freguesia / Autoridade de Registro competente, no âmbito do cancelamento de registro de uma residência em Berlim.',
        'scope':       'A procuração inclui a autorização para declarar o cancelamento em meu nome, apresentar documentos necessários e receber confirmações e demais correspondências relacionadas ao cancelamento.',
        'address_lbl': 'Residência a cancelar:',
        'name_lbl':    'Nome:',
        'birth_lbl':   'Data de nascimento:',
        'moveout_lbl': 'Data de saída:',
        'place_lbl':   'Local, Data:',
        'sig_lbl':     'Assinatura:',
        'berlin_date': 'Berlim, ',
    },
    'EN': {
        'title':       'Power of Attorney',
        'hereby':      'I hereby authorize',
        'represent':   'to represent me before the competent Residents Registration Office in connection with the deregistration of a residence in Berlin.',
        'scope':       'The power of attorney includes the authority to declare the deregistration in my name, to submit required documents, and to receive confirmations and other correspondence in connection with the deregistration.',
        'address_lbl': 'Address to deregister:',
        'name_lbl':    'Name:',
        'birth_lbl':   'Date of birth:',
        'moveout_lbl': 'Move-out date:',
        'place_lbl':   'Place, Date:',
        'sig_lbl':     'Signature:',
        'berlin_date': 'Berlin, ',
    },
}

def get_lang_key(lang_str):
    if not lang_str:
        return 'DE'
    l = lang_str.strip().upper()
    if l in ('PT', 'PT-BR', 'PORTUGUESE', 'PORTUGUES'):
        return 'PT'
    if l in ('EN', 'ENGLISH', 'ENGLISCH'):
        return 'EN'
    return 'DE'


def enhance_signature_bytes(b64_data):
    """Return enhanced PNG bytes from b64 image data using fitz."""
    try:
        raw = base64.b64decode(b64_data)
        img = fitz.Pixmap(raw)
        # Convert to grayscale
        if img.n > 2:
            img = fitz.Pixmap(fitz.csGRAY, img)
        # Boost contrast: apply gamma < 1 to darken (signature ink)
        img.gamma_with(0.3)
        return img.tobytes("png")
    except Exception as e:
        print(f'sig enhance warn: {e}', file=sys.stderr)
        return base64.b64decode(b64_data)


def draw_wrapped_text(page, text, rect, fontsize=8.5, bold=False, color=(0, 0, 0)):
    """Insert text that wraps within rect. Returns y position after last line."""
    fontname = "helv" if not bold else "hebo"
    # Use insert_htmlbox for proper wrapping with fitz
    story_html = f'<p style="font-size:{fontsize}pt; font-family:Helvetica; color:rgb(0,0,0);">'
    if bold:
        story_html += f'<b>{text}</b>'
    else:
        story_html += text
    story_html += '</p>'
    page.insert_htmlbox(rect, story_html, css="* { margin: 0; padding: 0; }")


def build(data_json_str, output_path):
    d = json.loads(data_json_str)

    vorname      = d.get('Vorname', '')
    nachname     = d.get('Nachname', '')
    geburtsdatum = d.get('Geburtsdatum', '')
    adresse      = d.get('Adresse', '')
    auszugdatum  = d.get('AuszugDatum', '')
    language     = d.get('Language', 'de')
    sig_b64      = d.get('SignaturBase64', '') or d.get('Signatur', '')

    lang_key = get_lang_key(language)
    bilingual = (lang_key != 'DE')

    today_str = date.today().strftime('%d.%m.%Y')
    full_name = f'{vorname} {nachname}'.strip()

    de = TRANS['DE']
    tr = TRANS[lang_key]

    # ── Page setup ───────────────────────────────────────────────────────────
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4

    margin_x = 50
    margin_y = 50
    page_w = 595 - 2 * margin_x   # usable width = 495
    col_gap = 10

    if bilingual:
        col_w = (page_w - col_gap) / 2
        col_x = [margin_x, margin_x + col_w + col_gap]
    else:
        col_w = page_w
        col_x = [margin_x, margin_x]  # only use first column

    y = margin_y
    line_h_title = 18
    line_h_body  = 12
    line_h_small = 10
    font_title = 12
    font_body  = 8.5

    lawyer_lines = [
        "Herrn Rechtsanwalt Frederico Eduardo Reichel",
        "Katzbachstraße 18",
        "10965 Berlin",
    ]

    def insert_text(page, x, y, text, fontsize=8.5, bold=False, color=(0,0,0)):
        fontname = "hebo" if bold else "helv"
        page.insert_text((x, y), text, fontsize=fontsize, fontname=fontname, color=color)

    def insert_wrapped(page, rect, text, fontsize=8.5, bold=False):
        """Wrap text into rect using HTML box."""
        w = '<b>' if bold else ''
        we = '</b>' if bold else ''
        html = f'<span style="font-size:{fontsize}pt;font-family:Helvetica;">{w}{text}{we}</span>'
        page.insert_htmlbox(rect, html)

    def get_text_height(text, col_width, fontsize=8.5):
        """Estimate height needed for text block."""
        chars_per_line = int(col_width / (fontsize * 0.5))
        lines = max(1, len(text) // max(1, chars_per_line) + 1)
        return lines * (fontsize + 2)

    # ── TITLE ────────────────────────────────────────────────────────────────
    for i, (cx, title_txt) in enumerate(zip(col_x, [de['title'], tr['title'] if bilingual else ''])):
        if not title_txt:
            continue
        insert_text(page, cx, y + line_h_title, title_txt, fontsize=font_title, bold=True)
    y += line_h_title + 8

    # Divider line
    page.draw_line((margin_x, y), (595 - margin_x, y), color=(0.7, 0.7, 0.7), width=0.5)
    y += 8

    # ── HEREBY ───────────────────────────────────────────────────────────────
    for cx, txt in zip(col_x, [de['hereby'], tr['hereby'] if bilingual else '']):
        if txt:
            insert_text(page, cx, y, txt, fontsize=font_body)
    y += line_h_body

    # Lawyer block
    for line in lawyer_lines:
        for cx in (col_x[:2] if bilingual else col_x[:1]):
            insert_text(page, cx, y, line, fontsize=font_body, bold=True)
        y += line_h_small
    y += 4

    # ── REPRESENT ────────────────────────────────────────────────────────────
    for i, (cx, txt) in enumerate(zip(col_x, [de['represent'], tr['represent'] if bilingual else ''])):
        if not txt:
            continue
        rect = fitz.Rect(cx, y, cx + col_w, y + 60)
        insert_wrapped(page, rect, txt, fontsize=font_body)
    # Estimate height
    rep_h = max(get_text_height(de['represent'], col_w, font_body), 40)
    y += rep_h + 4

    # ── SCOPE ────────────────────────────────────────────────────────────────
    for cx, txt in zip(col_x, [de['scope'], tr['scope'] if bilingual else '']):
        if not txt:
            continue
        rect = fitz.Rect(cx, y, cx + col_w, y + 80)
        insert_wrapped(page, rect, txt, fontsize=font_body)
    scope_h = max(get_text_height(de['scope'], col_w, font_body), 50)
    y += scope_h + 10

    # Divider
    page.draw_line((margin_x, y), (595 - margin_x, y), color=(0.85, 0.85, 0.85), width=0.3)
    y += 8

    # ── DATA FIELDS ──────────────────────────────────────────────────────────
    fields_de = [
        (de['address_lbl'], adresse),
        (de['name_lbl'],    full_name),
        (de['birth_lbl'],   geburtsdatum),
        (de['moveout_lbl'], auszugdatum),
    ]
    fields_tr = [
        (tr['address_lbl'], adresse),
        (tr['name_lbl'],    full_name),
        (tr['birth_lbl'],   geburtsdatum),
        (tr['moveout_lbl'], auszugdatum),
    ]

    for (lde, vde), (ltr, vtr) in zip(fields_de, fields_tr):
        # Left column (DE)
        insert_text(page, col_x[0], y, lde, fontsize=font_body, bold=True)
        insert_text(page, col_x[0] + 120, y, vde, fontsize=font_body)
        # Right column (TR)
        if bilingual:
            insert_text(page, col_x[1], y, ltr, fontsize=font_body, bold=True)
            insert_text(page, col_x[1] + 120, y, vtr, fontsize=font_body)
        y += line_h_body + 2

    y += 14

    # ── PLACE / DATE ─────────────────────────────────────────────────────────
    for cx, lbl, prefix in [
        (col_x[0], de['place_lbl'], de['berlin_date']),
        (col_x[1] if bilingual else None, tr['place_lbl'] if bilingual else None, tr['berlin_date'] if bilingual else None),
    ]:
        if cx is None:
            continue
        insert_text(page, cx, y, lbl, fontsize=font_body, bold=True)
        insert_text(page, cx + 80, y, prefix + today_str, fontsize=font_body)
    y += line_h_body + 12

    # ── SIGNATURE LABEL ──────────────────────────────────────────────────────
    for cx, lbl in [(col_x[0], de['sig_lbl']), (col_x[1] if bilingual else None, tr['sig_lbl'] if bilingual else None)]:
        if cx is None:
            continue
        insert_text(page, cx, y, lbl, fontsize=font_body, bold=True)
    y += line_h_body + 4

    # ── SIGNATURE IMAGE or LINE ───────────────────────────────────────────────
    if sig_b64 and sig_b64.strip():
        try:
            sig_bytes = enhance_signature_bytes(sig_b64)
            sig_rect = fitz.Rect(col_x[0], y, col_x[0] + 150, y + 55)
            page.insert_image(sig_rect, stream=sig_bytes)
        except Exception as e:
            print(f'sig insert warn: {e}', file=sys.stderr)
            page.draw_line((col_x[0], y + 30), (col_x[0] + 150, y + 30), width=0.5)
    else:
        # Draw signature line
        page.draw_line((col_x[0], y + 30), (col_x[0] + 150, y + 30), width=0.5)
        if bilingual:
            page.draw_line((col_x[1], y + 30), (col_x[1] + 150, y + 30), width=0.5)

    # ── Vertical divider between columns ─────────────────────────────────────
    if bilingual:
        mid_x = margin_x + col_w + col_gap / 2
        page.draw_line((mid_x, margin_y + 26), (mid_x, y + 40), color=(0.75, 0.75, 0.75), width=0.5)

    # ── Save ─────────────────────────────────────────────────────────────────
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    print(f'OK: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: gen_vollmacht.py <json_data> <output_path>', file=sys.stderr)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
