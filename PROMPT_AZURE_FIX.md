# AbmeldeBot — Azure: Python-Fix + Startup Command + Retest

## Kontext
Der AbmeldeBot (`@raferabmeldungbot`) wurde von Railway auf Azure App Service migriert. Im vorherigen Test-Chat wurden folgende Ergebnisse erzielt:

### ✅ Bestanden (7/10)
- Azure App Service läuft (`/api/health` → OK, Uptime stabil)
- Telegram Bot erreichbar, Polling-Modus aktiv (`getMe` OK, `getWebhookInfo` → `url: ""`)
- `/start` → Willkommensnachricht + Sprachauswahl (DE/PT/EN)
- `/test` → Testdaten vorausgefüllt, Zusammenfassung korrekt
- Admin-Benachrichtigung an Chat-ID 661435601 mit Aktionsbuttons (Genehmigen/Ablehnen/Zurückstellen)
- Graph API Token funktioniert (manuell getestet)
- Email-Versand via Graph API funktioniert (manueller curl-Test → HTTP 202)

### ❌ Fehlgeschlagen (3/10) — Ursache: Python fehlt auf Azure
- **PDF-Generierung**: `fill_abmeldung.py` braucht `pypdf`, `pymupdf` (fitz), `reportlab` — diese Pakete sind auf Azure App Service nicht installiert
- **Email-Versand**: Folge-Fehler — kein PDF → `fs.readFileSync(pdfPath)` crasht in `sendAbmeldungEmail()`
- **SharePoint-Archivierung**: Folge-Fehler — wird nach Email aufgerufen

### Was bereits gemacht wurde
1. **`startup.sh`** erstellt — installiert Python-Pakete beim App-Start in `/home/site/wwwroot/.python_packages`
2. **`.github/workflows/azure-deploy.yml`** aktualisiert — Python-Build aus ZIP entfernt (war zu groß mit pymupdf ~50MB)
3. **GitHub Push** erfolgreich — Workflow #4 deployt nur Node.js + startup.sh (ohne Python-Pakete)
4. **NOCH NICHT GEMACHT**: Startup Command `bash startup.sh` muss in Azure Portal gesetzt werden

### Offenes Problem: Windows vs Linux?
Die Fehlermeldung im Workflow #2 war: `"startup-command is not a valid input for Windows web app or with publish-profile auth scheme"`. Unklar ob die App Windows oder Linux ist. Falls Windows:
- Kein `bash startup.sh` möglich
- Kein Python3 vorinstalliert
- Anderer Ansatz nötig (z.B. Python als Azure Web Extension oder App auf Linux umstellen)

## Infra
- **Azure App Service**: `rafer-abmeldebot` (West Europe, B1 Basic, Node 22 LTS)
- **URL**: `https://rafer-abmeldebot-c8deh4gcg4g4h0bu.westeurope-01.azurewebsites.net`
- **Repo**: `jackalfred77de/abmeldebot` (GitHub, Branch: main)
- **Lokaler Pfad**: `/Users/FredHome/Library/CloudStorage/OneDrive-FredericoReichel/BüroEasy - Documents/Abmeldung/abmeldebot`
- **Stack**: Node.js 22, Telegraf 4.15, Express, Microsoft Graph (Email + SharePoint), Python 3 (PDF)
- **Deploy**: GitHub Actions → Azure (`.github/workflows/azure-deploy.yml`)

## Env Vars (gesetzt in Azure)
`TELEGRAM_BOT_TOKEN`, `ADMIN_CHAT_ID=661435601`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER=buero@rafer.de`, `SP_SITE_ID`, `SP_DRIVE_ID`, `SP_LIST_ID`, `SP_CASES_FOLDER=Abmeldung/Cases`, `WEBHOOK_VERIFY_TOKEN=rafer2026`, `NODE_ENV=production`, `DASHBOARD_PASSWORD=Rafer2024!`, `PYTHON_PATH=python3`, `PORT=8080`

## Telegram Bot Token
`8734340861:AAHFai4sqkCcOyh7JGzLg5a2VnJmLnZ8ji0`

## Dateien
| Datei | Zweck |
|-------|-------|
| `bot.js` | Telegram Bot Core (537 Zeilen) |
| `server.js` | Express Dashboard Server |
| `sharepoint.js` | Microsoft Graph: SharePoint CRUD |
| `translations.js` | DE/PT/EN Übersetzungen |
| `email.js` | Email via Microsoft Graph |
| `nationality.js` | Nationalitäten-Dictionary |
| `fill_abmeldung.py` | PDF-Ausfüllung (pypdf + fitz) |
| `gen_vollmacht.py` | Vollmacht-PDF (pypdf + fitz) |
| `startup.sh` | Azure Startup Script (Python install + node start) |
| `dashboard.html` | Admin Dashboard UI |

## Tools verfügbar
- `Control your Mac:osascript` — Terminal-Befehle
- `Claude in Chrome` — Browser-Automatisierung (Azure Portal)
- `Filesystem` — Dateien lesen/schreiben im lokalen Repo

## Aufgabe
1. **Prüfe ob die Azure App Windows oder Linux ist** (über Azure Portal oder REST API)
2. **Falls Linux**: Setze den Startup Command `bash startup.sh` im Azure Portal (Configuration → General Settings → Startup Command)
3. **Falls Windows**: Finde eine Alternative (Python Web Extension, oder App auf Linux umstellen)
4. **Nach dem Fix**: Starte die App neu, sende `/test` in Telegram, klicke "✓ Sim, continuar", und prüfe ob PDF + Email + SharePoint funktionieren
5. **Telegram Web A** ist eingeloggt unter `https://web.telegram.org/a/#8734340861` — nutze diesen Tab um den Bot-Chat zu lesen und Nachrichten zu senden
