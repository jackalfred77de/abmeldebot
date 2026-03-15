#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_bot_local.py — Simula o fluxo completo do AbmeldeBot localmente.
Gera Abmeldung PDF + Vollmacht e abre ambos para inspeção visual.

Uso:
  python3 test_bot_local.py             # PT com assinatura (padrão)
  python3 test_bot_local.py en          # EN com assinatura
  python3 test_bot_local.py de          # DE sem bilingue
  python3 test_bot_local.py nosig       # PT sem assinatura
"""

import sys, os, json, subprocess, re
from datetime import date

BOT_DIR  = os.path.dirname(os.path.abspath(__file__))
PYTHON3  = '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3'
OUT_DIR  = os.path.join(BOT_DIR, 'pdfs')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Args ─────────────────────────────────────────────────────────────────────
lang    = 'pt'
use_sig = True
for arg in sys.argv[1:]:
    if arg.lower() in ('en', 'pt', 'de'):
        lang = arg.lower()
    if arg.lower() == 'nosig':
        use_sig = False

print(f"\n{'='*60}")
print(f"  AbmeldeBot Local Test  |  lang={lang.upper()}  |  sig={'YES' if use_sig else 'NO'}")
print(f"{'='*60}\n")

# ── Extrair SIG_B64 do bot.js ─────────────────────────────────────────────
sig_b64 = ''
if use_sig:
    bot_js = os.path.join(BOT_DIR, 'bot.js')
    with open(bot_js, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r"const SIG_B64 = '([^']+)'", content)
    if m:
        sig_b64 = m.group(1)
        print(f"✅ SIG_B64 extraído ({len(sig_b64)} chars)")
    else:
        print("⚠️  SIG_B64 não encontrado — testando sem assinatura")

# ── Dados de teste ───────────────────────────────────────────────────────────
today_str = date.today().strftime('%d.%m.%Y')

abmeldung_data = {
    "firstName": "Maria", "lastName": "Silva",
    "birthDate": "01.01.1985", "geburtsort": "Lissabon",
    "strasse": "Musterstraße", "hausnummer": "42",
    "plz": "10965", "stadt": "Berlin",
    "fullAddress": "Musterstraße 42, 10965 Berlin",
    "bezirk": "Friedrichshain-Kreuzberg",
    "moveOutDate": "31.03.2025",
    "bisherigWohnungTyp": "alleinige",
    "newPlzCity": "", "newCountry": "Portugal",
    "neueWohnungExistiert": "nein",
    "service": "full",
    "sigMode": "paste" if use_sig else "self",
    "signatureImage": sig_b64,
    "language": lang,
    "email": "test@example.com",
    "familyMembers": [],
    "Datum": today_str,
    "orderId": "TEST-001",
    "SignaturBase64": sig_b64 if use_sig else '',
}

out_pdf       = os.path.join(OUT_DIR, f'test_abmeldung_{lang}.pdf')
out_vollmacht = out_pdf.replace('.pdf', '_Vollmacht.pdf')

# ── 1. Abmeldung PDF ─────────────────────────────────────────────────────────
print("📄 A gerar Abmeldung PDF...")
fill_script = os.path.join(BOT_DIR, 'fill_abmeldung.py')
r1 = subprocess.run(
    [PYTHON3, fill_script, json.dumps(abmeldung_data), out_pdf],
    capture_output=True, text=True, cwd=BOT_DIR
)
if r1.returncode == 0 and os.path.exists(out_pdf):
    print(f"   ✅ {os.path.basename(out_pdf)}")
else:
    print(f"   ❌ fill_abmeldung.py falhou (code {r1.returncode})")
    print(f"   STDERR: {r1.stderr[:400]}")
    sys.exit(1)

# ── 2. Vollmacht ─────────────────────────────────────────────────────────────
print("📜 A gerar Vollmacht...")
vollmacht_script = os.path.join(BOT_DIR, 'gen_vollmacht.py')
vollmacht_data = json.dumps({
    "Vorname":        abmeldung_data["firstName"],
    "Nachname":       abmeldung_data["lastName"],
    "Bezirk":         abmeldung_data["bezirk"],
    "Datum":          today_str,
    "Geburtsdatum":   abmeldung_data["birthDate"],
    "Adresse":        abmeldung_data["fullAddress"],
    "AuszugDatum":    abmeldung_data["moveOutDate"],
    "Language":       lang,
    "SignaturBase64": sig_b64 if use_sig else '',
})
r2 = subprocess.run(
    [PYTHON3, vollmacht_script, vollmacht_data, out_vollmacht],
    capture_output=True, text=True, cwd=BOT_DIR
)
if r2.returncode == 0 and os.path.exists(out_vollmacht):
    print(f"   ✅ {os.path.basename(out_vollmacht)}")
else:
    print(f"   ❌ gen_vollmacht.py falhou (code {r2.returncode})")
    print(f"   STDOUT: {r2.stdout[:200]}")
    print(f"   STDERR: {r2.stderr[:400]}")
    sys.exit(1)

# ── 3. Verificações ──────────────────────────────────────────────────────────
print("\n🔍 Verificando PDFs...")
import fitz

for label, path_ in [("Abmeldung", out_pdf), ("Vollmacht", out_vollmacht)]:
    doc   = fitz.open(path_)
    page  = doc[0]
    imgs  = page.get_images()
    size  = os.path.getsize(path_)
    words = page.get_text('words')
    xs    = sorted(set(round(w[0]/10)*10 for w in words))
    right_col = [x for x in xs if x > 250]
    if label == "Vollmacht":
        bilingual = len(right_col) > 0
        print(f"   {label}: {size//1024}KB | imgs={len(imgs)} | "
              f"bicolunado={'✅' if bilingual else '❌'} "
              f"(R-x≈{min(right_col) if right_col else 'n/a'})")
    else:
        print(f"   {label}: {size//1024}KB | imgs={len(imgs)}")

# ── 4. Abrir no Preview ───────────────────────────────────────────────────────
print("\n🖥  A abrir PDFs no Preview...")
subprocess.run(['open', out_pdf, out_vollmacht])

print(f"\n{'='*60}")
print(f"  CONCLUÍDO")
print(f"  Abmeldung : {os.path.basename(out_pdf)}")
print(f"  Vollmacht : {os.path.basename(out_vollmacht)}")
print(f"{'='*60}")
print()
print("ℹ️  NOTAS:")
print("  • A Vollmacht vai no EMAIL ao cliente (não no Telegram)")
print("  • O admin recebe a Vollmacht via Telegram (sendDocument)")
print("  • Se no teste do Telegram não apareceu a Vollmacht:")
print("    → O cliente não vê por Telegram, só por email")
print("    → O admin deve receber no chat de admin")
print()
