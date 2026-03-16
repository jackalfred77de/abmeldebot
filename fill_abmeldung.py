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

def resolve_annots(page):
    """Resolve IndirectObject para obter a lista real de anotações."""
    from pypdf.generic import IndirectObject
    raw = page.get('/Annots')
    if raw is None:
        return []
    return raw.get_object() if isinstance(raw, IndirectObject) else raw

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

    # --- Preencher campos de texto usando update_page_form_field_values (gera aparências visuais) ---
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
        # Limpar TODOS os campos de família por padrão (evitar dados residuais)
        "Person 2 Familienmitglied ist Familienname ggf Doktorgrad":                  "",
        "Person 2 Passname":                                                          "",
        "Person 2 Familienmitglied ist Vornamen Rufnamen unterstreichen":             "",
        "Person 2 Familienmitglied ist Geburtsname":                                  "",
        "Person 2 Familienmitglied istGeschlecht":                                    "",
        "Person 2 Familienmitglied ist Tag Ort Land der Geburt":                      "",
        "Person 2 Familienmitglied ist Religionsgesellschaft":                        "",
        "Person 2 Familienmitglied ist Staatsangehörigkeiten":                        "",
        "Person 2 Familienmitglied ist Ordens- Künstlername":                         "",
        "Person 3 Familienmitglied ist Familienname ggf Doktorgrad":                  "",
        "Person 3 Passname":                                                          "",
        "Person 3 Familienmitglied ist Vornamen Rufnamen unterstreichen":             "",
        "Person 3 Familienmitglied ist Geburtsname":                                  "",
        "Person 3 Familienmitglied ist Geschlecht":                                   "",
        "Person 3 Familienmitglied ist Tag Ort Land der Geburt":                      "",
        "Person 3 Familienmitglied ist Religionsgesellschaft":                        "",
        "Person 3 Familienmitglied istStaatsangehörigkeiten":                         "",
        "Person 3 Familienmitglied ist OrdensKünstlername":                           "",
        # NÃO incluir "Datum, Unterschirft" aqui — o campo será eliminado via fitz abaixo
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

    # Familiares (Person 2 e 3) — só preenche se existirem
    family_members = data.get('FamilyMembers', [])
    for idx, member in enumerate(family_members[:2]):
        if not member:
            continue
        n = idx + 2
        # Suporta tanto string (legado) como dict (novo)
        if isinstance(member, dict):
            raw = member.get('raw', '')
            gender = normalize(member.get('gender', ''), GENDER_MAP)
            nat = normalize(member.get('nationality', ''), NATIONALITY_MAP)
        else:
            raw = str(member)
            gender = ''
            nat = ''
        if not raw.strip():
            continue
        parts = raw.split(',')
        name_raw = parts[0].strip()       # ex: "Maria Silva"
        dob_raw  = parts[1].strip() if len(parts) > 1 else ''
        # Separar nome e sobrenome: última palavra = sobrenome
        name_parts = name_raw.rsplit(' ', 1)
        fn = name_parts[0].strip() if len(name_parts) > 1 else name_raw  # Vornamen
        ln = name_parts[1].strip() if len(name_parts) > 1 else ''         # Familienname
        if n == 2:
            fam_fields = {
                "Person 2 Familienmitglied ist Familienname ggf Doktorgrad": ln,
                "Person 2 Familienmitglied ist Vornamen Rufnamen unterstreichen": fn,
                "Person 2 Familienmitglied istGeschlecht": gender,
                "Person 2 Familienmitglied ist Tag Ort Land der Geburt": dob_raw,
                "Person 2 Familienmitglied ist Staatsangehörigkeiten": nat,
            }
        else:
            fam_fields = {
                "Person 3 Familienmitglied ist Familienname ggf Doktorgrad": ln,
                "Person 3 Familienmitglied ist Vornamen Rufnamen unterstreichen": fn,
                "Person 3 Familienmitglied ist Geschlecht": gender,
                "Person 3 Familienmitglied ist Tag Ort Land der Geburt": dob_raw,
                "Person 3 Familienmitglied istStaatsangehörigkeiten": nat,
            }
        text_fields.update(fam_fields)

    # Aplicar todos os campos de texto de uma vez (gera aparências visuais corretamente)
    writer.update_page_form_field_values(writer.pages[0], text_fields)

    # Aplicar checkboxes via set_checkbox (update_page_form_field_values não lida bem com checkboxes)
    for page in writer.pages:
        annots = resolve_annots(page)
        for name, checked in checkboxes.items():
            set_checkbox(annots, name, checked)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tmp_path = output_path + ".tmp.pdf"
    with open(tmp_path,"wb") as f:
        writer.write(f)

    # --- fitz: eliminar campo de assinatura do PDF + desenhar assinatura limpa ---
    doc = fitz.open(tmp_path)
    page = doc[0]

    # Remover TODOS os widgets/anotações da zona de assinatura para eliminar a assinatura azul do formulário
    widgets_to_remove = []
    for widget in page.widgets():
        r = widget.rect
        # A caixa de assinatura fica aproximadamente entre y=755 e y=820
        if r.y0 > 750 and r.x0 > 300:
            widgets_to_remove.append(widget)
    for w in widgets_to_remove:
        page.delete_widget(w)

    # Cobrir apenas o interior da caixa de assinatura (entre y=772 e y=808)
    # Não cobrir y=771 (linha do label) nem y=808 (linha base) para preservar a estrutura
    page.draw_rect(fitz.Rect(310, 772, 578, 808), color=(1,1,1), fill=(1,1,1))

    sig_b64 = data.get("SignaturBase64","")
    if sig_b64:
        # Decodificar base64
        if "," in sig_b64:
            sig_b64 = sig_b64.split(",",1)[1]
        sig_bytes = base64.b64decode(sig_b64)

        # Tornar fundo branco transparente para evitar caixa preta
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(sig_bytes)).convert("RGBA")
            pixels = img.getdata()
            new_pixels = []
            for r, g, b, a in pixels:
                if r > 200 and g > 200 and b > 200:
                    new_pixels.append((255, 255, 255, 0))
                else:
                    new_pixels.append((r, g, b, a))
            img.putdata(new_pixels)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            sig_bytes = buf.getvalue()
        except Exception:
            pass

        # Assinatura: entre a linha do label (y=771) e o campo de data (y=794)
        # Margem de 2pt acima e abaixo para não tocar nas linhas
        sig_rect = fitz.Rect(315, 774, 570, 791)
        page.insert_image(sig_rect, stream=sig_bytes, keep_proportion=True)

    # Data e nome: dentro do campo de data (widget y=794-807), centrado em y=803
    if datum:
        page.insert_text(fitz.Point(315, 803), datum, fontsize=7.5, color=(0,0,0))
    if vorname or nachname:
        name_text = f"{vorname} {nachname}".strip()
        page.insert_text(fitz.Point(365, 803), name_text, fontsize=7.5, color=(0,0,0))

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
