#!/usr/bin/env python3
"""fill_abmeldung.py — Preenche Abmeldung + gera Vollmacht."""
import sys, json, os, base64
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, create_string_object
import fitz

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLANK_PDF  = os.path.join(SCRIPT_DIR, "abmeldung_blank.pdf")

NATIONALITY_MAP = {
    'brasil':'brasilianisch','brasileira':'brasilianisch','brasileiro':'brasilianisch','brazil':'brasilianisch','brazilian':'brasilianisch',
    'portugal':'portugiesisch','portuguesa':'portugiesisch','português':'portugiesisch','portuguese':'portugiesisch',
    'alemanha':'deutsch','alemão':'deutsch','alemã':'deutsch','alema':'deutsch','alemão':'deutsch','germany':'deutsch','german':'deutsch','deutsch':'deutsch',
    'italia':'italienisch','itália':'italienisch','italiana':'italienisch','italy':'italienisch','italian':'italienisch',
    'espanha':'spanisch','espanhola':'spanisch','spain':'spanisch','spanish':'spanisch',
    'franca':'französisch','frança':'französisch','france':'französisch','french':'französisch',
    'estados unidos':'amerikanisch','eua':'amerikanisch','usa':'amerikanisch','american':'amerikanisch','united states':'amerikanisch',
    'angola':'angolanisch','cabo verde':'kapverdisch','moçambique':'mosambikanisch','mozambique':'mosambikanisch',
    'india':'indisch','índia':'indisch','indian':'indisch',
    'china':'chinesisch','chinese':'chinesisch',
    'japão':'japanisch','japan':'japanisch','japanese':'japanisch',
    'russia':'russisch','rússia':'russisch','russian':'russisch',
    'polônia':'polnisch','polonia':'polnisch','polish':'polnisch','poland':'polnisch',
    'turquia':'türkisch','turkish':'türkisch','turkey':'türkisch',
    'grécia':'griechisch','grecia':'griechisch','greek':'griechisch','greece':'griechisch',
    'argentina':'argentinisch','colombia':'kolumbianisch','colômbia':'kolumbianisch','colombian':'kolumbianisch',
    'mexico':'mexikanisch','méxico':'mexikanisch','mexican':'mexikanisch',
    'venezuela':'venezolanisch','peru':'peruanisch','chile':'chilenisch',
    'ucrania':'ukrainisch','ucrânia':'ukrainisch','ukrainian':'ukrainisch','ukraine':'ukrainisch',
    'roménia':'rumänisch','romênia':'rumänisch','romanian':'rumänisch','romania':'rumänisch',
    'hungria':'ungarisch','hungarian':'ungarisch','hungary':'ungarisch',
    'austria':'österreichisch','áustria':'österreichisch','austrian':'österreichisch',
    'suica':'schweizerisch','suíça':'schweizerisch','swiss':'schweizerisch','switzerland':'schweizerisch',
    'holanda':'niederländisch','netherlands':'niederländisch','dutch':'niederländisch',
    'bélgica':'belgisch','belgium':'belgisch','belgian':'belgisch',
    'suécia':'schwedisch','sweden':'schwedisch','swedish':'schwedisch',
    'noruega':'norwegisch','norway':'norwegisch','norwegian':'norwegisch',
    'dinamarca':'dänisch','denmark':'dänisch','danish':'dänisch',
    'reino unido':'britisch','uk':'britisch','british':'britisch','england':'britisch',
    'canada':'kanadisch','canadense':'kanadisch','canadian':'kanadisch',
    'australia':'australisch','australian':'australisch',
    'cuba':'kubanisch','cuban':'kubanisch',
    'egito':'ägyptisch','egypt':'ägyptisch','egyptian':'ägyptisch',
    'marrocos':'marokkanisch','morocco':'marokkanisch','moroccan':'marokkanisch',
    'nigéria':'nigerianisch','nigeria':'nigerianisch','nigerian':'nigerianisch',
    'coreia do sul':'südkoreanisch','south korea':'südkoreanisch','korean':'südkoreanisch',
}

GENDER_MAP = {
    'masculino':'männlich','feminino':'weiblich','homem':'männlich','mulher':'weiblich',
    'm':'männlich','f':'weiblich','w':'weiblich',
    'male':'männlich','female':'weiblich','man':'männlich','woman':'weiblich',
    'männlich':'männlich','weiblich':'weiblich','divers':'divers',
    'diverse':'divers','outro':'divers','other':'divers','non-binary':'divers',
    'masc':'männlich','fem':'weiblich',
}

def normalize(val, mapping):
    if not val: return val
    return mapping.get(val.lower().strip(), val)

def set_field(annots, name, value):
    for ref in annots:
        a = ref.get_object()
        if str(a.get('/T') or '') == name:
            a.update({NameObject('/V'): create_string_object(value)})

def set_checkbox(annots, name, checked):
    val = NameObject('/On') if checked else NameObject('/Off')
    for ref in annots:
        a = ref.get_object()
        if str(a.get('/T') or '') == name:
            a.update({NameObject('/V'): val, NameObject('/AS'): val, NameObject('/DV'): val})

def fill_pdf(data: dict, output_path: str):
    reader = PdfReader(BLANK_PDF)
    writer = PdfWriter()
    writer.append(reader)

    plz_bezirk  = (data.get("PLZ","") + " " + data.get("Bezirk","")).strip()
    geburtsinfo = " ".join(filter(None,[data.get("Geburtsdatum",""), data.get("Geburtsort","")]))
    neue_strasse = data.get("NeueStrasse", data.get("NeueAdresse",""))
    neue_plz_ort = data.get("NeuePLZOrt","")
    neues_land   = data.get("NeuesLand","")
    kuenftige_plz = f"{neue_plz_ort}, {neues_land}".strip(", ") if neue_plz_ort else neues_land

    nat = normalize(data.get("Staatsangehoerigkeit",""), NATIONALITY_MAP)
    geschlecht = normalize(data.get("Geschlecht",""), GENDER_MAP)

    vorname  = data.get("Vorname","")
    nachname = data.get("Nachname","")
    datum    = data.get("Datum","")

    text_fields = {
        "Tag des Auszugs":                                                            data.get("Auszugsdatum",""),
        "Postleitzahl Gemeinde Ortsteil bisherige Wohnung":                           plz_bezirk,
        "Straße Hausnummer Zusätze bisherige Wohnung":                                data.get("Strasse",""),
        "Postleitzahl Gemeinde Kreis Land (falls Ausland: Staat) künftige Wohnung":  kuenftige_plz,
        "Straße Hausnummer Zusätze künftige Wohnung":                                 neue_strasse,
        "Person 1 Familienname ggf Doktorgrad Zeile 1":                               nachname,
        "Person 1 Passname":                                                          "",
        "Person 1 Vornamen Rufnamen unterstreichen":                                  vorname,
        "Person 1 Geburtsname":                                                       data.get("Geburtsname",""),
        "Person 1 Geschlecht":                                                        geschlecht,
        "Person 1 Tag Ort Land der Geburt":                                           geburtsinfo,
        "Person 1 Religionsgesellschaft":                                             "",
        "Person 1 Staatsangehörigkeiten":                                             nat,
        "Person 1 Ordens- Künstlername":                                              "",
        "Datum, Unterschirft":                                                        datum,
    }

    bisherig = data.get("BisherigWohnung","alleinige").lower().strip()
    is_alleinige = bisherig in ("alleinige","alleinige wohnung")
    is_haupt     = bisherig in ("haupt","hauptwohnung")
    is_neben     = bisherig in ("neben","nebenwohnung")
    neue_existiert = data.get("NeueWohnungExistiert","nein")

    checkboxes = {
        "bisherige Wohnung war alleinige Wohnung": is_alleinige,
        "bisherige Wohnung war Hauptwohnung":      is_haupt,
        "bisherige Wohnung war Nebenwohnung":      is_neben,
        "künftige Wohunung wird alleinige Wohnung": True,
        "künftige Wohunung wird Hauptwohnung":      False,
        "künftige Wohunung wird Nebenwohnung":      False,
        "nein":                neue_existiert=="nein",
        "ja als":              neue_existiert!="nein",
        "ja, als Hauptwohnung":neue_existiert=="Hauptwohnung",
        "ja, als Nebenwohnung":neue_existiert=="Nebenwohnung",
    }

    for page in writer.pages:
        annots = page.get('/Annots',[])
        for name, value in text_fields.items():
            set_field(annots, name, value)
        for name, checked in checkboxes.items():
            set_checkbox(annots, name, checked)

    # Familiares (Person 2 e 3)
    family_members = data.get('FamilyMembers',[])
    for idx, member in enumerate(family_members[:2]):
        n = idx + 2
        parts = member.split(',')
        name_raw = parts[0].strip()
        dob_raw  = parts[1].strip() if len(parts)>1 else ''
        name_parts = name_raw.rsplit(' ',1)
        fn = name_parts[0] if len(name_parts)>1 else name_raw
        ln = name_parts[1] if len(name_parts)>1 else ''
        if n == 2:
            fam_fields = {
                "Person 2 Familienmitglied ist Familienname ggf Doktorgrad": ln,
                "Person 2 Familienmitglied ist Vornamen Rufnamen unterstreichen": fn,
                "Person 2 Familienmitglied ist Tag Ort Land der Geburt": dob_raw,
            }
        else:
            fam_fields = {
                "Person 3 Familienmitglied ist Familienname ggf Doktorgrad": ln,
                "Person 3 Familienmitglied ist Vornamen Rufnamen unterstreichen": fn,
                "Person 3 Familienmitglied ist Tag Ort Land der Geburt": dob_raw,
            }
        for page in writer.pages:
            annots = page.get('/Annots',[])
            for fname, fval in fam_fields.items():
                set_field(annots, fname, fval)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tmp_path = output_path + ".tmp.pdf"
    with open(tmp_path,"wb") as f:
        writer.write(f)

    # fitz: data + nome na mesma linha, mesma fonte; assinatura imagem sem artefactos
    doc = fitz.open(tmp_path)
    page = doc[0]

    # Limpar área do campo Datum (apagar conteúdo do widget visualmente)
    # A área do campo de data+assinatura é aprox. y=794..807
    page.draw_rect(fitz.Rect(310, 792, 578, 810), color=(1,1,1), fill=(1,1,1))

    name_text = f"{vorname} {nachname}".strip()
    # Data e nome na mesma linha, mesma fonte (size 8)
    datum_name = f"{datum}    {name_text}"
    page.insert_text(fitz.Point(312, 805), datum_name, fontsize=8, color=(0,0,0))

    sig_b64 = data.get("SignaturBase64","")
    if sig_b64:
        if "," in sig_b64:
            sig_b64 = sig_b64.split(",",1)[1]
        sig_bytes = base64.b64decode(sig_b64)
        sig_tmp = output_path + ".sig.png"
        with open(sig_tmp,"wb") as f:
            f.write(sig_bytes)
        # Assinatura numa área clara, sem sobreposição com texto
        sig_rect = fitz.Rect(420, 770, 576, 800)
        page.insert_image(sig_rect, filename=sig_tmp, keep_proportion=True)
        try: os.unlink(sig_tmp)
        except: pass

    doc.save(output_path)
    doc.close()
    try: os.unlink(tmp_path)
    except: pass
    print(f"OK:{output_path}")


def generate_vollmacht(data: dict, output_path: str):
    """Gera Vollmacht PDF com dados do cliente."""
    vorname   = data.get("Vorname","")
    nachname  = data.get("Nachname","")
    bezirk    = data.get("Bezirk","Berlin")
    datum     = data.get("Datum","")
    full_name = f"{vorname} {nachname}".strip()
    buergeramt = f"Bürgeramt {bezirk} - Berlin"

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    left = 72

    def ins(text, y, size=10, bold=False, center=False, color=(0,0,0)):
        font = "Helvetica-Bold" if bold else "helv"
        if center:
            tw = fitz.get_text_length(text, fontname=font, fontsize=size)
            x = (595 - tw) / 2
        else:
            x = left
        page.insert_text(fitz.Point(x, y), text, fontname=font, fontsize=size, color=color)
        return y + size * 1.45

    def para(text, y, size=9.5, indent=0):
        words = text.split()
        line_text = ""
        max_w = 523 - left - indent
        for word in words:
            test = (line_text + " " + word).strip()
            if fitz.get_text_length(test, fontname="helv", fontsize=size) > max_w:
                page.insert_text(fitz.Point(left+indent, y), line_text, fontname="helv", fontsize=size)
                y += size * 1.45
                line_text = word
            else:
                line_text = test
        if line_text:
            page.insert_text(fitz.Point(left+indent, y), line_text, fontname="helv", fontsize=size)
            y += size * 1.45
        return y

    y = 80
    y = ins("Zustellungen werden nur an die Bevollmächtigten erbeten!", y, size=9, color=(0.3,0.3,0.3))
    y += 18
    y = ins("Dem Rechtsanwalt", y, size=10)
    y += 4
    y = ins("Frederico Reichel,", y, size=10, bold=True)
    y = ins("Katzbachstr. 18, 10965 Berlin,", y, size=10)
    y += 10
    y = ins("wird hiermit in Sachen:", y, size=10)
    y += 4
    y = ins(full_name, y, size=11, bold=True)
    y += 4
    y = ins("./.", y, size=10, center=True)
    y += 4
    y = ins(buergeramt, y, size=10)
    y += 14
    y = ins("wegen: Abmeldung", y, size=10)
    y += 20
    y = ins("V  o  l  l  m  a  c  h  t", y, size=14, bold=True, center=True)
    y += 16
    y = ins("erteilt:", y, size=10)
    y += 10

    clauses = [
        ("1.", "zur Prozeßführung einschließlich der Befugnis zur Erhebung und Zurücknahme von Widerklagen,"),
        ("2.", "zur Vertretung in sonstigen Verfahren, ausdrücklich gegenüber Gerichten und Behörden und bei außergerichtlichen Verhandlungen aller Art,"),
        ("3.", "zur Begründung und Aufhebung von Vertragsverhältnissen und zur Abgabe von einseitigen Willenserklärungen."),
    ]
    for num, text in clauses:
        page.insert_text(fitz.Point(left, y), num, fontname="helv", fontsize=9.5)
        y = para(text, y, indent=18)
        y += 4

    y += 6
    y = para("Die Vollmacht gilt für alle Instanzen und erstreckt sich auch auf Neben- und Folgeverfahren aller Art sowie sonstige Verfahren (z.B. Arrest und einstweilige Verfügung, Kostenfestsetzungs-, Zwangsvollstreckungs-, Interventions-, Zwangsversteigerungs-, Zwangsverwaltungs- und Hinterlegungsverfahren sowie Insolvenzverfahren).", y)
    y += 8
    y = para("Sie umfaßt insbesondere die Befugnis, Zustellungen zu bewirken und entgegenzunehmen, die Vollmacht ganz oder teilweise auf andere zu übertragen (Untervollmacht), Rechtsmittel einzulegen, zurückzunehmen oder auf sie zu verzichten, den Rechtsstreit oder außergerichtliche Verhandlungen durch Vergleich, Verzicht oder Anerkenntnis zu erledigen.", y)
    y += 30
    y = ins(f"Berlin, den {datum}", y, size=10)
    y += 40
    page.draw_line(fitz.Point(left, y), fitz.Point(left+200, y), color=(0,0,0), width=0.5)
    y += 14
    ins(full_name, y, size=9)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc.save(output_path)
    doc.close()
    print(f"VOLLMACHT_OK:{output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: fill_abmeldung.py '<json>' output.pdf [vollmacht]", file=sys.stderr)
        sys.exit(1)
    try:
        data   = json.loads(sys.argv[1])
        output = sys.argv[2]
        mode   = sys.argv[3] if len(sys.argv)>3 else "abmeldung"
        if mode == "vollmacht":
            generate_vollmacht(data, output)
        else:
            fill_pdf(data, output)
    except Exception as e:
        import traceback
        print(f"ERRO:{e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
