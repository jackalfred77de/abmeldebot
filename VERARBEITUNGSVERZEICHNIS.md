# Verarbeitungsverzeichnis gemäß Art. 30 DSGVO

## AbmeldeBot — Telegram-Bot für Abmeldungen in Berlin

**Stand:** März 2026

---

## 1. Verantwortlicher

| Feld | Angabe |
|---|---|
| Name | RA Frederico Reichel |
| Anschrift | Katzbachstraße 18, 10965 Berlin |
| E-Mail | info@rafer.de |
| Telefon | +49 155 60245902 |
| Website | https://rafer.de |

---

## 2. Zweck der Verarbeitung

Durchführung von Abmeldungen (Wohnsitz) bei Berliner Bürgerämtern im Auftrag von Mandanten. Die Datenverarbeitung umfasst:

- Erfassung der für die Abmeldung erforderlichen personenbezogenen Daten über einen Telegram-Bot
- Automatische Erstellung des amtlichen Abmeldeformulars (PDF)
- Erstellung einer Vollmacht (bei Full Service)
- Versand der Dokumente per E-Mail an den Mandanten
- Einreichung der Abmeldung beim zuständigen Bürgeramt (bei Full Service)

---

## 3. Rechtsgrundlage

**Art. 6 Abs. 1 lit. b DSGVO** — Verarbeitung ist für die Erfüllung eines Vertrags erforderlich, dessen Vertragspartei die betroffene Person ist.

Zusätzlich wird vor Beginn der Datenerhebung eine **ausdrückliche Einwilligung** (Art. 6 Abs. 1 lit. a DSGVO) über den Bot-Dialog eingeholt.

---

## 4. Kategorien betroffener Personen

- Mandanten (natürliche Personen, die den Abmeldungs-Service nutzen)
- Familienangehörige der Mandanten (Ehepartner, Kinder), sofern diese mitabgemeldet werden

---

## 5. Kategorien personenbezogener Daten

| Kategorie | Daten |
|---|---|
| Identifikationsdaten | Vorname, Nachname, Geburtsname |
| Geburtsdaten | Geburtsdatum, Geburtsort |
| Demografische Daten | Geschlecht, Staatsangehörigkeit |
| Adressdaten | Aktuelle Berliner Adresse, neue Adresse im Ausland/Inland |
| Kontaktdaten | E-Mail-Adresse, Telefonnummer |
| Dokumentenkopien | Ausweiskopien (Vorder- und Rückseite), ggf. Anmeldebestätigung |
| Unterschrift | Digitale Unterschrift (Foto) bei Full Service |
| Verfahrensdaten | Bestellnummer, gewählter Service (DIY/Full), Auszugsdatum, Bezirk |
| Familienangehörige | Name, Geschlecht, Staatsangehörigkeit, Dokumentenkopien |

---

## 6. Empfänger der Daten

| Empfänger | Zweck | Rechtsgrundlage |
|---|---|---|
| Berliner Bürgerämter | Einreichung der Abmeldung (Full Service) | Art. 6 Abs. 1 lit. b DSGVO |
| Microsoft Corporation (SharePoint/Exchange Online) | Dokumentenspeicherung, E-Mail-Versand | Auftragsverarbeitung (Art. 28 DSGVO) |
| Telegram FZ-LLC | Kommunikationskanal mit dem Mandanten | Art. 6 Abs. 1 lit. b DSGVO |
| Microsoft Azure (Hosting) | Hosting des Bot-Servers (App Service) | Auftragsverarbeitung (Art. 28 DSGVO) |

---

## 7. Übermittlung in Drittländer

| Dienst | Sitz / Serverstandort | Garantien |
|---|---|---|
| Telegram FZ-LLC | Dubai (VAE) / UK / Singapur | EU-Standardvertragsklauseln (SCCs) |
| Microsoft Corporation (Azure) | EU (West Europe) | EU-Standardvertragsklauseln (SCCs), Data Privacy Framework |
| Microsoft Corporation | EU-Rechenzentren (primär), USA (Backup) | EU-Standardvertragsklauseln (SCCs), Data Privacy Framework |

**Hinweis:** Personenbezogene Daten werden **nicht** an KI-Dienste oder sonstige Dritte übermittelt. Die Normalisierung von Nationalität und Geburtsort erfolgt ausschließlich über ein lokales Dictionary ohne externe API-Aufrufe.

---

## 8. Löschfristen

| Datenort | Löschfrist | Methode |
|---|---|---|
| In-Memory-Session (Bot-Server) | Sofort nach Abschluss des Vorgangs | Automatische Session-Löschung |
| PDF-Dateien auf Server (pdfs/archive/) | 7 Tage | Automatische Löschung bei Bot-Start |
| SharePoint (Ordner + Listeneintrag) | Nach Fallabschluss, auf Anfrage | Manuelle Löschung über Dashboard (DSGVO-Löschfunktion) |
| E-Mail (an Mandanten) | Verbleibt beim Mandanten | Verantwortung des Mandanten |
| Telegram-Chat (Admin) | Nach Fallabschluss | Manuelle Löschung durch Admin |

---

## 9. Technische und organisatorische Maßnahmen (TOMs)

### Vertraulichkeit
- TLS-Verschlüsselung für alle Datenübertragungen (Telegram API, Microsoft Graph API, Bot-Server)
- Passwortgeschützter Zugang zum Admin-Dashboard
- Zugriffsbeschränkung: nur autorisierte Kanzleimitarbeiter

### Integrität
- Session-basierte Datenverarbeitung (keine persistente Datenbank auf dem Bot-Server)
- Validierung aller Eingabedaten (Datum, E-Mail, PLZ)

### Verfügbarkeit
- Azure App Service mit automatischem Restart (Always On)
- Fehlerbehandlung und Logging im Bot

### Datenschutz by Design
- Einwilligungsabfrage vor Datenerhebung im Bot-Dialog
- Datenschutzerklärung verlinkt in Willkommensnachricht und Consent-Dialog
- Keine Übermittlung personenbezogener Daten an externe KI-Dienste
- Automatische Löschung temporärer Dateien nach 7 Tagen
- DSGVO-Löschfunktion im Dashboard für vollständige Fallentfernung aus SharePoint

---

## 10. Datenschutzfolgenabschätzung (DSFA)

Eine formelle DSFA nach Art. 35 DSGVO wird als nicht zwingend erforderlich eingeschätzt, da:
- Die Verarbeitung auf Vertragsbasis und mit ausdrücklicher Einwilligung erfolgt
- Die Datenmenge pro Mandant überschaubar ist
- Keine automatisierte Entscheidungsfindung stattfindet
- Keine Profilerstellung erfolgt

Bei Änderung des Verarbeitungsumfangs ist eine erneute Prüfung vorzunehmen.

---

## 11. Änderungshistorie

| Datum | Änderung |
|---|---|
| März 2026 | Erstversion: Verarbeitungsverzeichnis erstellt |
| März 2026 | Anthropic-API entfernt, lokales Dictionary eingeführt |
| März 2026 | Consent-Step im Bot implementiert |
| März 2026 | Automatische PDF-Löschung (7 Tage) implementiert |
| März 2026 | SharePoint-Löschfunktion (DSGVO) implementiert |
| März 2026 | Datenschutzerklärungs-Link in Bot integriert |
