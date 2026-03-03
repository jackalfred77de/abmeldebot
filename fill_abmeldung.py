#!/usr/bin/env python3
"""
fill_abmeldung.py — Preenche o formulário oficial de Abmeldung de Berlin (PDF).
"""

import sys
import json
import os
import base64
from pypdf import PdfReader, PdfWriter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLANK_PDF  = os.path.join(SCRIPT_DIR, "abmeldung_blank.pdf")

def fill_pdf(data: dict, output_path: str):
    reader = PdfReader(BLANK_PDF)
    writer = PdfWriter()
    writer.append(reader)

    plz_bezirk   = (data.get("PLZ", "") + " " + data.get("Bezirk", "")).strip()
    geburtsinfo  = " ".join(filter(None, [data.get("Geburtsdatum", ""), data.get("Geburtsort", "")]))
    neue_strasse = data.get("NeueStrasse", data.get("NeueAdresse", ""))
    neues_land   = data.get("NeuesLand", neue_strasse)

    text_fields = {
        "Tag des Auszugs":                                                              data.get("Auszugsdatum", ""),
        "Postleitzahl Gemeinde Ortsteil bisherige Wohnung":                             plz_bezirk,
        "Straße Hausnummer Zusätze bisherige Wohnung":                                  data.get("Strasse", ""),
        "Postleitzahl Gemeinde Kreis Land (falls Ausland: Staat) künftige Wohnung":     neues_land,
        "Straße Hausnummer Zusätze künftige Wohnung":                                   neue_strasse,
        "Person 1 Familienname ggf Doktorgrad Zeile 1":                                 data.get("Nachname", ""),
        "Person 1 Vornamen Rufnamen unterstreichen":                                    data.get("Vorname", ""),
        "Person 1 Geburtsname":                                                         data.get("Geburtsname", ""),
        "Person 1 Geschlecht":                                                          data.get("Geschlecht", ""),
        "Person 1 Tag Ort Land der Geburt":                                             geburtsinfo,
        "Person 1 Staatsangehörigkeiten":                                               data.get("Staatsangehoerigkeit", ""),
        "Datum, Unterschirft":                                                          data.get("Datum", ""),
    }

    bisherig = data.get("BisherigWohnung", "alleinige").lower().strip()
    is_alleinige = bisherig in ("alleinige", "alleinige wohnung")
    is_haupt     = bisherig in ("haupt", "hauptwohnung")
    is_neben     = bisherig in ("neben", "nebenwohnung")
    checkbox_bisherig = {
        "bisherige Wohnung war alleinige Wohnung": is_alleinige,
        "bisherige Wohnung war Hauptwohnung":      is_haupt,
        "bisherige Wohnung war Nebenwohnung":      is_neben,
        "Diese Wohnung war Hauptwohnung Zeile 1":  is_haupt,
        "Diese Wohnung war Hauptwohnung Zeile 2":  is_haupt,
        "Diese Wohnung war Hauptwohnung Zeile 3":  is_haupt,
        "Diese Wohnung war Nebenwohnung Zeile 1":  is_neben,
        "Diese Wohnung war Nebenwohnung Zeile 2":  is_neben,
        "Diese Wohnung war Nebenwohnung Zeile 3":  is_neben,
    }
    checkbox_kuenftig = {
        "künftige Wohunung wird alleinige Wohnung": True,
        "künftige Wohunung wird Hauptwohnung":      False,
        "künftige Wohunung wird Nebenwohnung":      False,
        "Wohnung ist künftig Hauptwohnung Zeile 1": False,
        "Wohnung ist künftig Hauptwohnung Zeile 2": False,
        "Wohnung ist künftig Hauptwohnung Zeile 3": False,
        "Wohnung ist künftig Nebenwohnung Zeile 1": False,
        "Wohnung ist künftig Nebenwohnung Zeile 2": False,
        "Wohnung ist künftig Nebenwohnung Zeile 3": False,
    }
    neue_existiert = data.get("NeueWohnungExistiert", "nein")
    checkbox_existiert = {
        "nein":                 neue_existiert == "nein",
        "ja als":               neue_existiert != "nein",
        "ja, als Hauptwohnung": neue_existiert == "Hauptwohnung",
        "ja, als Nebenwohnung": neue_existiert == "Nebenwohnung",
    }

    all_checkboxes = {**checkbox_bisherig, **checkbox_kuenftig, **checkbox_existiert}
    writer.update_page_form_field_values(writer.pages[0], text_fields)

    # Also set text fields directly on annotations (more reliable)
    from pypdf.generic import NameObject, BooleanObject, create_string_object
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            annot = annot_ref.get_object()
            field_name = annot.get('/T')
            if field_name is None:
                continue
            field_name = str(field_name)
            if field_name in text_fields:
                annot.update({NameObject('/V'): create_string_object(text_fields[field_name])})

    # Familiares (Person 2 e Person 3)
    family_members = data.get('FamilyMembers', [])
    for idx, member in enumerate(family_members[:2]):
        n = idx + 2  # Person 2, Person 3
        # Tentar separar "Nome Sobrenome, DD.MM.YYYY"
        parts = member.split(',')
        name_raw = parts[0].strip() if parts else member
        dob_raw  = parts[1].strip() if len(parts) > 1 else ''
        # Dividir nome em primeiro/último
        name_parts = name_raw.rsplit(' ', 1)
        vorname  = name_parts[0] if len(name_parts) > 1 else name_raw
        nachname = name_parts[1] if len(name_parts) > 1 else ''
        if n == 2:
            family_fields = {
                'Person 2 Familienmitglied ist Familienname ggf Doktorgrad': nachname,
                'Person 2 Familienmitglied ist Vornamen Rufnamen unterstreichen': vorname,
                'Person 2 Familienmitglied ist Tag Ort Land der Geburt': dob_raw,
            }
        else:
            family_fields = {
                'Person 3 Familienmitglied ist Familienname ggf Doktorgrad': nachname,
                'Person 3 Familienmitglied ist Vornamen Rufnamen unterstreichen': vorname,
                'Person 3 Familienmitglied ist Tag Ort Land der Geburt': dob_raw,
            }
        # Also set directly on annotations
        for page in writer.pages:
            if '/Annots' not in page:
                continue
            for annot_ref in page['/Annots']:
                annot = annot_ref.get_object()
                fn = str(annot.get('/T') or '')
                if fn in family_fields:
                    annot.update({NameObject('/V'): create_string_object(family_fields[fn])})
    # update_page_form_field_values doesn't work reliably for checkboxes
    # We update the raw annotation objects directly
    from pypdf.generic import NameObject, BooleanObject, create_string_object
    for page in writer.pages:
        if '/Annots' not in page:
            continue
        for annot_ref in page['/Annots']:
            annot = annot_ref.get_object()
            field_name = annot.get('/T')
            if field_name is None:
                continue
            field_name = str(field_name)
            if field_name in all_checkboxes:
                val = NameObject('/On') if all_checkboxes[field_name] else NameObject('/Off')
                annot_obj = annot_ref.get_object()
                annot_obj.update({
                    NameObject('/V'):  val,
                    NameObject('/AS'): val,
                    NameObject('/DV'): val,
                })

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    sig_b64 = data.get("SignaturBase64", "")
    if sig_b64:
        import fitz
        tmp_path = output_path + ".tmp.pdf"
        with open(tmp_path, "wb") as f:
            writer.write(f)
        if "," in sig_b64:
            sig_b64 = sig_b64.split(",", 1)[1]
        sig_bytes = base64.b64decode(sig_b64)
        sig_tmp = output_path + ".sig.png"
        with open(sig_tmp, "wb") as f:
            f.write(sig_bytes)
        doc = fitz.open(tmp_path)
        page = doc[0]
        # Área de assinatura: dentro da caixa, abaixo do label (coordenadas fitz top-down)
        sig_rect = fitz.Rect(420, 773, 565, 806)
        page.insert_image(sig_rect, filename=sig_tmp, keep_proportion=True)
        doc.save(output_path)
        doc.close()
        try: os.unlink(tmp_path)
        except: pass
        try: os.unlink(sig_tmp)
        except: pass
    else:
        with open(output_path, "wb") as f:
            writer.write(f)

    print(f"OK:{output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python3 fill_abmeldung.py '<json>' output.pdf", file=sys.stderr)
        sys.exit(1)
    try:
        data = json.loads(sys.argv[1])
        fill_pdf(data, sys.argv[2])
    except Exception as e:
        print(f"ERRO:{e}", file=sys.stderr)
        sys.exit(1)
