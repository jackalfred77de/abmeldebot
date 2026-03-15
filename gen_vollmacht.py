#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_vollmacht.py  --  Vollmacht Abmeldung (bicolunada, uma página)
Usa PyMuPDF (fitz). Args: json_data output_path
"""
import sys, json, base64
from datetime import date
import fitz

TRANS = {
    'DE': {
        'title':       'Vollmacht',
        'hereby':      'Hiermit bevollmächtige ich',
        'represent':   ('mich gegenüber dem zuständigen Bürgeramt / der zuständigen '
                        'Meldebehörde im Zusammenhang mit meiner Abmeldung einer Wohnung '
                        'in Berlin zu vertreten.'),
        'scope':       ('Die Vollmacht umfasst die Befugnis, die Abmeldung in meinem Namen '
                        'zu erklären, erforderliche Unterlagen einzureichen sowie '
                        'Bestätigungen und sonstige Schreiben im Zusammenhang mit der '
                        'Abmeldung entgegenzunehmen.'),
        'address_lbl': 'Abzumeldende Wohnung:',
        'name_lbl':    'Name:',
        'birth_lbl':   'Geburtsdatum:',
        'moveout_lbl': 'Auszugsdatum:',
        'place_lbl':   'Ort, Datum:',
        'sig_lbl':     'Unterschrift:',
        'berlin_date': 'Berlin, ',
        'client_lbl':  'Vollmachtgeber/in:',
    },
    'PT': {
        'title':       'Procuração',
        'hereby':      'Por meio desta, outorgo poderes a',
        'represent':   ('para me representar perante a Junta de Freguesia / Autoridade de '
                        'Registro competente, no âmbito do cancelamento de registro de uma '
                        'residência em Berlim.'),
        'scope':       ('A procuração inclui a autorização para declarar o cancelamento em '
                        'meu nome, apresentar documentos necessários e receber confirmações '
                        'e demais correspondências relacionadas ao cancelamento.'),
        'address_lbl': 'Residência a cancelar:',
        'name_lbl':    'Nome:',
        'birth_lbl':   'Data de nascimento:',
        'moveout_lbl': 'Data de saída:',
        'place_lbl':   'Local, Data:',
        'sig_lbl':     'Assinatura:',
        'berlin_date': 'Berlim, ',
        'client_lbl':  'Outorgante:',
    },
    'EN': {
        'title':       'Power of Attorney',
        'hereby':      'I hereby authorize',
        'represent':   ('to represent me before the competent Residents Registration Office '
                        'in connection with the deregistration of a residence in Berlin.'),
        'scope':       ('The power of attorney includes the authority to declare the '
                        'deregistration in my name, to submit required documents, and to '
                        'receive confirmations and other correspondence in connection with '
                        'the deregistration.'),
        'address_lbl': 'Address to deregister:',
        'name_lbl':    'Name:',
        'birth_lbl':   'Date of birth:',
        'moveout_lbl': 'Move-out date:',
        'place_lbl':   'Place, Date:',
        'sig_lbl':     'Signature:',
        'berlin_date': 'Berlin, ',
        'client_lbl':  'Principal:',
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


def enhance_sig(b64):
    try:
        raw = base64.b64decode(b64)
        pix = fitz.Pixmap(raw)
        if pix.n > 2:
            pix = fitz.Pixmap(fitz.csGRAY, pix)
        pix.gamma_with(0.25)
        return pix.tobytes("png")
    except Exception as e:
        print(f"sig warn: {e}", file=sys.stderr)
        return base64.b64decode(b64)


# ── Low-level text writers ────────────────────────────────────────────────────

def write_text(page, x, y, text, fontsize=8.5, bold=False, color=(0,0,0)):
    """Single-line text insert."""
    fn = "hebo" if bold else "helv"
    page.insert_text((x, y), text, fontsize=fontsize, fontname=fn, color=color)
    return y + fontsize + 2


def write_wrapped(page, x, y, w, text, fontsize=8.5, bold=False, line_gap=2):
    """
    Word-wrap text into column of width w.
    Returns y after last line.
    """
    fn = "hebo" if bold else "helv"
    # Measure average char width (approx)
    char_w = fontsize * 0.50
    max_chars = max(1, int(w / char_w))

    words = text.split()
    lines = []
    cur = ""
    for word in words:
        test = (cur + " " + word).strip()
        if len(test) <= max_chars:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)

    for line in lines:
        page.insert_text((x, y), line, fontsize=fontsize, fontname=fn, color=(0,0,0))
        y += fontsize + line_gap
    return y


def build(data_json_str, output_path):
    d = json.loads(data_json_str)

    vorname      = d.get('Vorname', '')
    nachname     = d.get('Nachname', '')
    geburtsdatum = d.get('Geburtsdatum', '')
    adresse      = d.get('Adresse', '')
    auszugdatum  = d.get('AuszugDatum', '')
    language     = d.get('Language', 'de')
    sig_b64      = d.get('SignaturBase64', '') or d.get('Signatur', '')

    lang_key  = get_lang_key(language)
    bilingual = (lang_key != 'DE')
    today_str = date.today().strftime('%d.%m.%Y')
    full_name = f'{vorname} {nachname}'.strip()

    de = TRANS['DE']
    tr = TRANS[lang_key]

    # ── Page layout ───────────────────────────────────────────────────────────
    doc  = fitz.open()
    page = doc.new_page(width=595, height=842)

    ML = 45          # left margin
    MR = 45          # right margin
    MT = 45          # top margin
    PW = 595 - ML - MR   # 505 pts

    if bilingual:
        GAP = 14
        CW  = (PW - GAP) / 2   # ~245 pts
        LX  = ML                # left col x
        RX  = ML + CW + GAP     # right col x  (~304)
    else:
        CW  = PW
        LX  = ML
        RX  = ML   # unused

    FS   = 8.5
    FST  = 11.5   # title
    LH   = FS + 3  # line height body

    lawyer = [
        "Herrn Rechtsanwalt Frederico Eduardo Reichel",
        "Katzbachstraße 18",
        "10965 Berlin",
    ]

    # ── Draw vertical divider (bilingual only) ────────────────────────────────
    div_x = ML + CW + GAP / 2  # midpoint between columns
    # Will draw after all content to know end Y

    # ── Track max Y for divider ───────────────────────────────────────────────
    y_start = MT

    # ── TITLE ─────────────────────────────────────────────────────────────────
    y = MT
    page.insert_text((LX, y + FST), de['title'],
                     fontsize=FST, fontname="hebo", color=(0,0,0))
    if bilingual:
        page.insert_text((RX, y + FST), tr['title'],
                         fontsize=FST, fontname="hebo", color=(0,0,0))
    y += FST + 6

    # Horizontal line under title
    page.draw_line((ML, y), (595-MR, y), color=(0.5,0.5,0.5), width=0.7)
    y += 8

    # ── HEREBY ────────────────────────────────────────────────────────────────
    page.insert_text((LX, y), de['hereby'], fontsize=FS, fontname="helv")
    if bilingual:
        page.insert_text((RX, y), tr['hereby'], fontsize=FS, fontname="helv")
    y += LH + 1

    # ── LAWYER BLOCK ─────────────────────────────────────────────────────────
    for line in lawyer:
        page.insert_text((LX, y), line, fontsize=FS, fontname="hebo")
        if bilingual:
            page.insert_text((RX, y), line, fontsize=FS, fontname="hebo")
        y += LH - 1
    y += 4

    # ── REPRESENT ─────────────────────────────────────────────────────────────
    yL = write_wrapped(page, LX, y, CW, de['represent'], fontsize=FS)
    if bilingual:
        yR = write_wrapped(page, RX, y, CW, tr['represent'], fontsize=FS)
        y = max(yL, yR)
    else:
        y = yL
    y += 4

    # ── SCOPE ─────────────────────────────────────────────────────────────────
    yL = write_wrapped(page, LX, y, CW, de['scope'], fontsize=FS)
    if bilingual:
        yR = write_wrapped(page, RX, y, CW, tr['scope'], fontsize=FS)
        y = max(yL, yR)
    else:
        y = yL
    y += 8

    # Thin separator
    page.draw_line((ML, y), (595-MR, y), color=(0.8,0.8,0.8), width=0.4)
    y += 8

    # ── DATA FIELDS ───────────────────────────────────────────────────────────
    def field_row(lde, ltr, val):
        nonlocal y
        # Left column
        page.insert_text((LX, y), lde, fontsize=FS, fontname="hebo")
        page.insert_text((LX + 115, y), val, fontsize=FS, fontname="helv")
        # Right column
        if bilingual:
            page.insert_text((RX, y), ltr, fontsize=FS, fontname="hebo")
            page.insert_text((RX + 115, y), val, fontsize=FS, fontname="helv")
        y += LH + 1

    # Client name (Vollmachtgeber)
    field_row(de['client_lbl'], tr['client_lbl'] if bilingual else '', full_name)
    field_row(de['birth_lbl'],  tr['birth_lbl']  if bilingual else '', geburtsdatum)
    field_row(de['address_lbl'],tr['address_lbl'] if bilingual else '', adresse)
    field_row(de['moveout_lbl'],tr['moveout_lbl'] if bilingual else '', auszugdatum)

    y += 10

    # ── PLACE / DATE ──────────────────────────────────────────────────────────
    place_de = de['berlin_date'] + today_str
    place_tr = tr['berlin_date'] + today_str
    page.insert_text((LX, y), de['place_lbl'], fontsize=FS, fontname="hebo")
    page.insert_text((LX + 75, y), place_de, fontsize=FS, fontname="helv")
    if bilingual:
        page.insert_text((RX, y), tr['place_lbl'], fontsize=FS, fontname="hebo")
        page.insert_text((RX + 75, y), place_tr, fontsize=FS, fontname="helv")
    y += LH + 12

    # ── SIGNATURE LABEL ───────────────────────────────────────────────────────
    page.insert_text((LX, y), de['sig_lbl'], fontsize=FS, fontname="hebo")
    if bilingual:
        page.insert_text((RX, y), tr['sig_lbl'], fontsize=FS, fontname="hebo")
    y += LH + 4

    # ── SIGNATURE IMAGE or LINE ───────────────────────────────────────────────
    sig_h = 52
    if sig_b64 and sig_b64.strip():
        try:
            sig_bytes = enhance_sig(sig_b64)
            page.insert_image(fitz.Rect(LX, y, LX+150, y+sig_h), stream=sig_bytes)
            if bilingual:
                page.insert_image(fitz.Rect(RX, y, RX+150, y+sig_h), stream=sig_bytes)
        except Exception as e:
            print(f"sig insert warn: {e}", file=sys.stderr)
            page.draw_line((LX, y+30), (LX+150, y+30), width=0.5)
            if bilingual:
                page.draw_line((RX, y+30), (RX+150, y+30), width=0.5)
    else:
        page.draw_line((LX, y+30), (LX+150, y+30), width=0.5)
        if bilingual:
            page.draw_line((RX, y+30), (RX+150, y+30), width=0.5)

    y_end = y + sig_h + 5

    # ── Vertical divider ─────────────────────────────────────────────────────
    if bilingual:
        page.draw_line(
            (div_x, y_start + FST + 8),
            (div_x, y_end),
            color=(0.7, 0.7, 0.7),
            width=0.5
        )

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    print(f'OK: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: gen_vollmacht.py <json_data> <output_path>', file=sys.stderr)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
