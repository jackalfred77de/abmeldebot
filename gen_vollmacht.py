#!/usr/bin/env python3
"""
gen_vollmacht.py — Gera Vollmacht preenchida directamente com reportlab.
Uso: python3 gen_vollmacht.py '<json>' output.pdf
"""
import sys, json, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY

def generate(data: dict, output_path: str):
    vorname  = data.get("Vorname", "")
    nachname = data.get("Nachname", "")
    full_name = f"{vorname} {nachname}".strip()
    bezirk   = data.get("Bezirk", "Berlin")
    datum    = data.get("Datum", "")

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        rightMargin=3*cm, leftMargin=3*cm,
        topMargin=3*cm, bottomMargin=3*cm
    )
    styles = getSampleStyleSheet()
    normal = ParagraphStyle('n', parent=styles['Normal'], fontSize=11, leading=16, alignment=TA_JUSTIFY)
    center = ParagraphStyle('c', parent=styles['Normal'], fontSize=11, leading=16, alignment=TA_CENTER)
    small  = ParagraphStyle('s', parent=styles['Normal'], fontSize=9, leading=14)

    story = []
    story.append(Paragraph("Zustellungen werden nur an die Bevollmächtigten erbeten!", small))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Dem Rechtsanwalt", normal))
    story.append(Paragraph("<b>Frederico Reichel,</b>", normal))
    story.append(Paragraph("Katzbachstr. 18, 10965 Berlin,", normal))
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph("wird hiermit in Sachen:", normal))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph(f"<b>{full_name}</b>", normal))
    story.append(Paragraph("./.", center))
    story.append(Paragraph(f"<b>Bürgeramt {bezirk} - Berlin</b>", normal))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph("wegen: <b>Abmeldung</b>", normal))
    story.append(Spacer(1, 0.6*cm))
    story.append(Paragraph("<b>V o l l m a c h t</b>", center))
    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph("erteilt:", normal))
    story.append(Spacer(1, 0.3*cm))

    clauses = [
        "1. zur Prozeßführung einschließlich der Befugnis zur Erhebung und Zurücknahme von Widerklagen,",
        "2. zur Vertretung in sonstigen Verfahren, ausdrücklich gegenüber Gerichten und Behörden und bei außergerichtlichen Verhandlungen aller Art,",
        "3. zur Begründung und Aufhebung von Vertragsverhältnissen und zur Abgabe von einseitigen Willenserklärungen.",
    ]
    for c in clauses:
        story.append(Paragraph(c, normal))
        story.append(Spacer(1, 0.2*cm))

    story.append(Spacer(1, 0.2*cm))
    story.append(Paragraph(
        "Die Vollmacht gilt für alle Instanzen und erstreckt sich auch auf Neben- und Folgeverfahren aller Art sowie sonstige Verfahren (z.B. Arrest und einstweilige Verfügung, Kostenfestsetzungs-, Zwangsvollstreckungs-, Interventions-, Zwangsversteigerungs-, Zwangsverwaltungs- und Hinterlegungsverfahren sowie Insolvenzverfahren).",
        normal))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(
        "Sie umfaßt insbesondere die Befugnis, Zustellungen zu bewirken und entgegenzunehmen, die Vollmacht ganz oder teilweise auf andere zu übertragen (Untervollmacht), Rechtsmittel einzulegen, zurückzunehmen oder auf sie zu verzichten, den Rechtsstreit oder außergerichtliche Verhandlungen durch Vergleich, Verzicht oder Anerkenntnis zu erledigen.",
        normal))
    story.append(Spacer(1, 1.5*cm))
    story.append(Paragraph(f"Berlin, den {datum}", normal))
    story.append(Spacer(1, 1.8*cm))
    story.append(Paragraph(".................................................", normal))
    story.append(Paragraph(full_name, normal))

    doc.build(story)
    print(f"VOLLMACHT_OK:{output_path}")

if __name__ == "__main__":
    data = json.loads(sys.argv[1])
    generate(data, sys.argv[2])
