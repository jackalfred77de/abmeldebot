// AbmeldeBot - Telegram Bot Version
// Complete implementation with multi-language support

// Load environment variables
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const SP = require('./sharepoint');

// Configuration from environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SMTP_HOST     = process.env.SMTP_HOST     || null;
const SMTP_PORT     = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER     = process.env.SMTP_USER     || null;
const SMTP_PASS     = process.env.SMTP_PASS     || null;
const SMTP_FROM     = process.env.SMTP_FROM     || SMTP_USER;
const GRAPH_TENANT_ID     = process.env.GRAPH_TENANT_ID     || '';
const GRAPH_CLIENT_ID     = process.env.GRAPH_CLIENT_ID     || '';
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const GRAPH_SENDER        = process.env.GRAPH_SENDER        || 'buero@rafer.de';
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY   || '';
const FIRM_ADDRESS  = 'Katzbachstraße 18, 10965 Berlin';
const FIRM_EMAIL    = 'abmeldung@rafer.de';
const BOT_DIR       = __dirname;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN nicht gefunden!');
  console.error('Bitte in .env Datei setzen.');
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// User sessions (in-memory, use Redis for production)
const sessions = new Map();

// Helper functions
function t(session, key) {
  const lang = session.lang || 'de';
  return translations[lang][key] || key;
}


// ─── NATIONALITY MAP (PT/EN → DE) ──────────────────────────────────────────
const NATIONALITY_MAP = {
  // Português → Alemão
  'brasil': 'Brasilien', 'brasileira': 'Brasilien', 'brasileiro': 'Brasilien',
  'portugal': 'Portugal', 'portuguesa': 'Portugiesisch', 'português': 'Portugiesisch',
  'alemanha': 'Deutsch', 'alemão': 'Deutsch', 'alemã': 'Deutsch',
  'italia': 'Italienisch', 'itália': 'Italienisch', 'italiana': 'Italienisch', 'italiano': 'Italienisch',
  'espanha': 'Spanisch', 'espanhola': 'Spanisch', 'espanhol': 'Spanisch',
  'franca': 'Französisch', 'frança': 'Französisch', 'francesa': 'Französisch', 'francês': 'Französisch',
  'estados unidos': 'Amerikanisch', 'eua': 'Amerikanisch', 'usa': 'Amerikanisch',
  'angola': 'Angolanisch', 'moçambique': 'Mosambikanisch', 'mozambique': 'Mosambikanisch',
  'cabo verde': 'Kapverdisch', 'são tomé': 'São-Tomeisch',
  'india': 'Indisch', 'índia': 'Indisch', 'indiana': 'Indisch', 'indiano': 'Indisch',
  'china': 'Chinesisch', 'chinesa': 'Chinesisch', 'chinês': 'Chinesisch',
  'japão': 'Japanisch', 'japonesa': 'Japanisch', 'japonês': 'Japanisch',
  'russia': 'Russisch', 'rússia': 'Russisch', 'russa': 'Russisch', 'russo': 'Russisch',
  'polônia': 'Polnisch', 'polonia': 'Polnisch', 'polonesa': 'Polnisch', 'polonês': 'Polnisch',
  'turquia': 'Türkisch', 'turca': 'Türkisch', 'turco': 'Türkisch',
  'grécia': 'Griechisch', 'grecia': 'Griechisch', 'grega': 'Griechisch', 'grego': 'Griechisch',
  'argentina': 'Argentinisch', 'argentino': 'Argentinisch',
  'colombia': 'Kolumbianisch', 'colômbia': 'Kolumbianisch',
  'mexico': 'Mexikanisch', 'méxico': 'Mexikanisch',
  'venezuela': 'Venezolanisch',
  'peru': 'Peruanisch',
  'chile': 'Chilenisch',
  'ucrania': 'Ukrainisch', 'ucrânia': 'Ukrainisch', 'ucraniana': 'Ukrainisch',
  // English → Alemão  
  'german': 'Deutsch', 'germany': 'Deutsch',
  'american': 'Amerikanisch', 'american citizen': 'Amerikanisch',
  'british': 'Britisch', 'english': 'Britisch',
  'french': 'Französisch', 'france': 'Französisch',
  'italian': 'Italienisch', 'italy': 'Italienisch',
  'spanish': 'Spanisch', 'spain': 'Spanisch',
  'brazilian': 'Brasilien', 'brazil': 'Brasilien',
  'portuguese': 'Portugiesisch',
  'indian': 'Indisch',
  'chinese': 'Chinesisch',
  'japanese': 'Japanisch',
  'russian': 'Russisch',
  'polish': 'Polnisch',
  'turkish': 'Türkisch',
  'greek': 'Griechisch',
  'ukrainian': 'Ukrainisch',
};

function normalizeNationality(input) {
  if (!input) return input;
  const key = input.toLowerCase().trim();
  return NATIONALITY_MAP[key] || input;
}

// Tradução IA (fallback para mapa local)
async function translateToGerman(text, context) {
  if (!text || !ANTHROPIC_API_KEY) return text;
  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Translate this ${context} to German (single word/phrase only, no explanation): "${text}". Answer only with the German word.`
      }]
    });
    return await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(j.content?.[0]?.text?.trim() || text);
          } catch { resolve(text); }
        });
      });
      req.on('error', () => resolve(text));
      req.setTimeout(5000, () => { req.destroy(); resolve(text); });
      req.write(body);
      req.end();
    });
  } catch { return text; }
}

// Gerar Vollmacht PDF via Python
async function generateVollmacht(data) {
  const today = new Date();
  const datum = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
  const pdfData = {
    Vorname:  data.firstName,
    Nachname: data.lastName,
    Bezirk:   data.bezirk || 'Berlin',
    Datum:    datum,
  };
  const orderId = data.orderId || ('AB' + Date.now());
  const outPath = path.join(BOT_DIR, 'pdfs', `Vollmacht_${orderId}.pdf`);
  const pythonScript = path.join(BOT_DIR, 'fill_abmeldung.py');
  const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';

  return new Promise((resolve, reject) => {
    execFile(PYTHON_PATH, [pythonScript, JSON.stringify(pdfData), outPath, 'vollmacht'], {timeout: 30000}, (err, stdout, stderr) => {
      if (err) { console.error('Vollmacht error:', stderr); reject(err); return; }
      const match = stdout.match(/VOLLMACHT_OK:(.+)/);
      resolve(match ? match[1].trim() : outPath);
    });
  });
}

function createSession(chatId) {
  const session = {
    chatId,
    lang: null,
    step: 'language',
    data: {}
  };
  sessions.set(chatId, session);
  return session;
}

function getSession(chatId) {
  return sessions.get(chatId) || createSession(chatId);
}

function deleteSession(chatId) {
  sessions.delete(chatId);
}

// Validators
function isValidDate(dateStr) {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const day = parseInt(match[1]);
  const month = parseInt(match[2]);
  const year = parseInt(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  return true;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractPLZ(address) {
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

// PLZ to Bezirk mapping - vollständige Berlin PLZ Liste
const PLZ_MAP = {
  // Mitte
  '10115':'Mitte','10117':'Mitte','10119':'Mitte','10135':'Mitte','10178':'Mitte','10179':'Mitte',
  '10551':'Mitte','10553':'Mitte','10555':'Mitte','10557':'Mitte','10559':'Mitte',
  '13347':'Mitte','13349':'Mitte','13351':'Mitte','13353':'Mitte','13355':'Mitte','13357':'Mitte','13359':'Mitte',
  // Friedrichshain-Kreuzberg
  '10243':'Friedrichshain-Kreuzberg','10245':'Friedrichshain-Kreuzberg','10247':'Friedrichshain-Kreuzberg','10249':'Friedrichshain-Kreuzberg',
  '10961':'Friedrichshain-Kreuzberg','10963':'Friedrichshain-Kreuzberg','10965':'Friedrichshain-Kreuzberg','10967':'Friedrichshain-Kreuzberg','10969':'Friedrichshain-Kreuzberg','10997':'Friedrichshain-Kreuzberg','10999':'Friedrichshain-Kreuzberg',
  // Pankow
  '10405':'Pankow','10407':'Pankow','10409':'Pankow',
  '10435':'Pankow','10437':'Pankow','10439':'Pankow',
  '13086':'Pankow','13088':'Pankow','13089':'Pankow','13091':'Pankow','13093':'Pankow','13095':'Pankow','13097':'Pankow','13099':'Pankow',
  '13125':'Pankow','13127':'Pankow','13129':'Pankow','13156':'Pankow','13158':'Pankow','13159':'Pankow','13187':'Pankow','13189':'Pankow',
  // Charlottenburg-Wilmersdorf
  '10585':'Charlottenburg-Wilmersdorf','10587':'Charlottenburg-Wilmersdorf','10589':'Charlottenburg-Wilmersdorf',
  '10623':'Charlottenburg-Wilmersdorf','10625':'Charlottenburg-Wilmersdorf','10627':'Charlottenburg-Wilmersdorf','10629':'Charlottenburg-Wilmersdorf',
  '10707':'Charlottenburg-Wilmersdorf','10709':'Charlottenburg-Wilmersdorf','10711':'Charlottenburg-Wilmersdorf','10713':'Charlottenburg-Wilmersdorf','10715':'Charlottenburg-Wilmersdorf','10717':'Charlottenburg-Wilmersdorf','10719':'Charlottenburg-Wilmersdorf',
  '14050':'Charlottenburg-Wilmersdorf','14052':'Charlottenburg-Wilmersdorf','14053':'Charlottenburg-Wilmersdorf','14055':'Charlottenburg-Wilmersdorf','14057':'Charlottenburg-Wilmersdorf','14059':'Charlottenburg-Wilmersdorf',
  // Spandau
  '13581':'Spandau','13583':'Spandau','13585':'Spandau','13587':'Spandau','13589':'Spandau','13591':'Spandau','13593':'Spandau','13595':'Spandau','13597':'Spandau','13599':'Spandau',
  // Steglitz-Zehlendorf
  '12157':'Steglitz-Zehlendorf','12159':'Steglitz-Zehlendorf','12161':'Steglitz-Zehlendorf','12163':'Steglitz-Zehlendorf','12165':'Steglitz-Zehlendorf','12167':'Steglitz-Zehlendorf','12169':'Steglitz-Zehlendorf',
  '12203':'Steglitz-Zehlendorf','12205':'Steglitz-Zehlendorf','12207':'Steglitz-Zehlendorf','12209':'Steglitz-Zehlendorf',
  '14109':'Steglitz-Zehlendorf','14129':'Steglitz-Zehlendorf','14163':'Steglitz-Zehlendorf','14165':'Steglitz-Zehlendorf','14167':'Steglitz-Zehlendorf','14169':'Steglitz-Zehlendorf','14193':'Steglitz-Zehlendorf','14195':'Steglitz-Zehlendorf','14197':'Steglitz-Zehlendorf','14199':'Steglitz-Zehlendorf',
  // Tempelhof-Schöneberg
  '10777':'Tempelhof-Schöneberg','10779':'Tempelhof-Schöneberg','10781':'Tempelhof-Schöneberg','10783':'Tempelhof-Schöneberg','10785':'Tempelhof-Schöneberg','10787':'Tempelhof-Schöneberg','10789':'Tempelhof-Schöneberg',
  '12099':'Tempelhof-Schöneberg','12101':'Tempelhof-Schöneberg','12103':'Tempelhof-Schöneberg','12105':'Tempelhof-Schöneberg','12107':'Tempelhof-Schöneberg','12109':'Tempelhof-Schöneberg',
  '12277':'Tempelhof-Schöneberg','12279':'Tempelhof-Schöneberg','12305':'Tempelhof-Schöneberg','12307':'Tempelhof-Schöneberg','12309':'Tempelhof-Schöneberg',
  // Neukölln
  '12043':'Neukölln','12045':'Neukölln','12047':'Neukölln','12049':'Neukölln','12051':'Neukölln','12053':'Neukölln','12055':'Neukölln','12057':'Neukölln','12059':'Neukölln',
  '12347':'Neukölln','12349':'Neukölln','12351':'Neukölln','12353':'Neukölln','12355':'Neukölln','12357':'Neukölln','12359':'Neukölln',
  // Treptow-Köpenick
  '12435':'Treptow-Köpenick','12437':'Treptow-Köpenick','12439':'Treptow-Köpenick',
  '12459':'Treptow-Köpenick','12487':'Treptow-Köpenick','12489':'Treptow-Köpenick',
  '12524':'Treptow-Köpenick','12526':'Treptow-Köpenick','12527':'Treptow-Köpenick','12529':'Treptow-Köpenick',
  '12555':'Treptow-Köpenick','12557':'Treptow-Köpenick','12559':'Treptow-Köpenick','12587':'Treptow-Köpenick','12589':'Treptow-Köpenick',
  // Marzahn-Hellersdorf
  '12619':'Marzahn-Hellersdorf','12621':'Marzahn-Hellersdorf','12623':'Marzahn-Hellersdorf','12625':'Marzahn-Hellersdorf','12627':'Marzahn-Hellersdorf','12629':'Marzahn-Hellersdorf',
  '12679':'Marzahn-Hellersdorf','12681':'Marzahn-Hellersdorf','12683':'Marzahn-Hellersdorf','12685':'Marzahn-Hellersdorf','12687':'Marzahn-Hellersdorf','12689':'Marzahn-Hellersdorf',
  // Lichtenberg
  '10315':'Lichtenberg','10317':'Lichtenberg','10318':'Lichtenberg','10319':'Lichtenberg',
  '13051':'Lichtenberg','13053':'Lichtenberg','13055':'Lichtenberg','13057':'Lichtenberg','13059':'Lichtenberg',
  '10365':'Lichtenberg','10367':'Lichtenberg','10369':'Lichtenberg',
  // Reinickendorf
  '13403':'Reinickendorf','13405':'Reinickendorf','13407':'Reinickendorf','13409':'Reinickendorf',
  '13435':'Reinickendorf','13437':'Reinickendorf','13439':'Reinickendorf',
  '13465':'Reinickendorf','13467':'Reinickendorf','13469':'Reinickendorf',
  '13503':'Reinickendorf','13505':'Reinickendorf','13507':'Reinickendorf','13509':'Reinickendorf',
};

function getBezirk(plz) {
  return PLZ_MAP[plz] || null;
}

// Download photo from Telegram
async function downloadPhoto(ctx, fileId) {
  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    console.error('Error downloading photo:', error);
    return null;
  }
}

// Notify admin
async function notifyAdmin(session) {
  if (!ADMIN_CHAT_ID) return;
  const { data } = session;
  const message = `
🔔 **Neue Abmeldung!**

👤 ${data.firstName} ${data.lastName}
📧 ${data.email}
📱 ${data.phone || '–'}
💼 ${data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)'}
📆 Auszug: ${data.moveOutDate}
📍 ${data.fullAddress}
🏛 Bürgeramt: ${data.bezirk}

Bestellung: ${data.orderId}
  `.trim();
  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Admin notification error:', error);
  }
}

// Translations
const translations = {
  de: {
    welcome: '🏛 *Kanzlei Rechtsanwalt Frederico Reichel*\n\n👋 Willkommen beim offiziellen Abmeldungs-Service der Kanzlei Reichel.\n\n🔒 *Datenschutz:* Alle Ihre Daten werden vertraulich behandelt und nach Abschluss des Services gelöscht.\n\n──────────────────────\n\n🇩🇪 Ich helfe Ihnen mit der Abmeldung in Berlin.\n🇬🇧 I help you with deregistration in Berlin.\n🇧🇷 Eu ajudo com a baixa de registro em Berlim.\n\nBitte Sprache wählen / Please choose language / Escolha o idioma:',
    service_select: '✨ Bitte wählen Sie Ihren Service:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *DIY Service – €4,99*\n✅ Wir füllen das Abmeldeformular vollständig aus\n✅ Sie erhalten das PDF per E-Mail\n📌 Sie unterschreiben und senden per Post/E-Mail\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Full Service – €39,99*\n✅ Wir füllen das Formular aus\n✅ Offizielle Vollmacht auf Ihren Namen\n✅ Wir versenden direkt ans Bürgeramt\n⚖️ Durch RA Frederico Reichel, Berlin\n━━━━━━━━━━━━━━━━━━━━━\n\nWelchen Service möchten Sie?',
    ask_firstname: '📝 Wie ist Ihr **Vorname**?\n\n_Alle Vornamen, genau wie im Ausweis (z.B. Maria Clara)._',
    ask_lastname: '📝 Wie ist Ihr **Nachname**?\n\n_Alle Nachnamen wie im Ausweis (z.B. Silva Oliveira)._',
    ask_birthdate: '📅 Geburtsdatum?\n\nBitte im Format: TT.MM.JJJJ\nBeispiel: 15.03.1990',
    ask_birthplace: '🏙 Geburtsort?\n\nBeispiel: Berlin',
    ask_gender: '⚧ Geschlecht? (männlich / weiblich / divers)',
    ask_nationality: '🌍 Staatsangehörigkeit?\n\nBeispiel: Deutsch',
    ask_address: '🏠 Ihre **aktuelle Adresse** in Berlin?\n\nBitte komplett:\nStraße Hausnummer, PLZ Berlin\n\nBeispiel: Katzbachstr. 18, 10965 Berlin',
    ask_moveout: '📆 An welchem Tag ziehen Sie aus?\n\nFormat: TT.MM.JJJJ\nBeispiel: 31.12.2025',
    ask_newaddress_street: '🏠 Neue Adresse — **Straße und Hausnummer**?\n\nBeispiel: Rua das Flores 123',
    ask_newaddress_plzcity: '📮 **PLZ und Stadt**?\n\nBeispiel: 01310-100 São Paulo',
    ask_newaddress_country: '🌍 **Land**?\n\nBeispiel: Brasilien',
    ask_email: '📧 Ihre **E-Mail-Adresse**?\n\nWir senden die PDFs dorthin.',
    ask_phone: '📱 Ihre **Telefonnummer**?\n\n(Für Rückfragen)',
    ask_wohnungtyp: '🏠 War die Berliner Wohnung Ihre...?',
    wohnungtyp_alleinige: '🏠 Alleinige Wohnung',
    wohnungtyp_haupt: '🏠 Hauptwohnung (mit Nebenwohnung)',
    wohnungtyp_neben: '🏠 Nebenwohnung',
    ask_neue_existiert: '🌍 Hat die neue Wohnung bereits als Wohnsitz bestanden?',
    neue_nein: '❌ Nein',
    neue_haupt: '✅ Ja, als Hauptwohnung',
    neue_neben: '✅ Ja, als Nebenwohnung',
    ask_sig_mode: '✍️ Wie möchten Sie unterschreiben?',
    sig_mode_self: '📄 PDF selbst unterschreiben',
    sig_mode_paste: '🖊️ Foto der Unterschrift senden',
    ask_signature: '✍️ Bitte senden Sie ein **Foto Ihrer Unterschrift**!\n\n📸 So geht\'s:\n1. Unterschreiben Sie auf weißem Papier\n2. Fotografieren Sie nur die Unterschrift\n3. Senden Sie das Foto hier\n\n⚠️ Muss mit Ausweis-Unterschrift übereinstimmen!',
    ask_id_front: '📸 Bitte senden Sie ein Foto von Ihrem **Ausweis (Vorderseite)**',
    ask_id_back: '📸 Jetzt die **Rückseite** Ihres Ausweises bitte',
    ask_vollmacht: '📜 Bitte senden Sie ein **Foto oder Scan der unterschriebenen Vollmacht**\n\n_(Sie haben die Vollmacht per E-Mail erhalten. Unterschreiben und hier einsenden.)_',
    ask_anmeldung: '🗂 Falls vorhanden, senden Sie bitte eine **Kopie Ihrer letzten Anmeldung**.\n\n_Nicht zwingend erforderlich, aber hilfreich._',
    skip_doc: '⏭ Überspringen (habe ich nicht dabei)',
    ask_family: '👨‍👩‍👧 Melden Sie auch **Familienmitglieder** ab?\n\n(Ehepartner, Kinder, die an derselben Adresse wohnten)',
    family_yes: '✅ Ja, Familienmitglieder hinzufügen',
    family_no: '➡️ Nein, weiter',
    ask_family_name: '👤 Name des Familienmitglieds #{n}?\n\n_Alle Vornamen + Nachnamen, Geburtsdatum_\n_Beispiel: Maria Silva, 10.05.1990_',
    family_add_more: '➕ Weiteres Mitglied hinzufügen',
    family_done: '✅ Fertig, weiter',
    summary: '📋 **Zusammenfassung**\n\n1️⃣ Vorname: {firstName}\n2️⃣ Nachname: {lastName}\n3️⃣ Geboren: {birthDate} in {birthPlace}\n4️⃣ Nationalität: {nationality}\n\n5️⃣ Adresse Berlin: {address}\n📍 Bezirk: {bezirk}\n\n6️⃣ Auszug: {moveOutDate}\n7️⃣ Neue Adresse: {newAddress}\n\n8️⃣ E-Mail: {email}\n9️⃣ Telefon: {phone}\n\n{familySummary}💼 Service: {service}\n\n✅ Alles korrekt?',
    summary_correct: '✓ Ja, weiter',
    summary_wrong: '✏️ Feld korrigieren',
    correct_which: 'Welches Feld korrigieren?',
    correct_firstname: '1️⃣ Vorname',
    correct_lastname: '2️⃣ Nachname',
    correct_birthdate: '3️⃣ Geburtsdatum',
    correct_birthplace: '4️⃣ Geburtsort',
    correct_nationality: '5️⃣ Nationalität',
    correct_address: '6️⃣ Adresse Berlin',
    correct_moveout: '7️⃣ Auszugsdatum',
    correct_newaddress: '8️⃣ Neue Adresse',
    correct_email: '9️⃣ E-Mail',
    correct_phone: '🔟 Telefon',
    correct_enter_new: 'Bitte neuen Wert eingeben:',
    payment_info: '💳 **Zahlung: €{amount}**\n\nBitte bezahlen Sie via Link:\n\n{paymentUrl}',
    payment_success: '✅ **Zahlung erfolgreich!**\n\nBestellnummer: `{orderId}`',
    error_general: '❌ Ein Fehler ist aufgetreten. Bitte /start',
    error_photo: '❌ Bitte senden Sie ein Foto',
    invalid_date: '❌ Ungültiges Datum. Format: TT.MM.JJJJ',
    invalid_email: '❌ Ungültige E-Mail-Adresse',
    invalid_plz: '❌ Ungültige Berliner PLZ. Bitte prüfen Sie die PLZ.',
    signature_received: '✅ Unterschrift erhalten!',
    id_front_received: '✅ Ausweis Vorderseite erhalten!',
    id_back_received: '✅ Ausweis Rückseite erhalten!',
    processing: '⏳ Einen Moment...',
    cancel: 'Abgebrochen. /start für Neustart.',
    help: '📚 **Hilfe**\n\n/start - Neu starten\n/cancel - Abbrechen\n/help - Diese Hilfe\n\n📧 info@rafer.de\n🏢 ' + FIRM_ADDRESS
  },
  pt: {
    welcome: '🏛 *Escritório Rechtsanwalt Frederico Reichel*\n\n👋 Bem-vindo ao serviço oficial de Abmeldung do escritório Reichel.\n\n🔒 *Privacidade:* Todos os seus dados são tratados com sigilo e serão apagados após a entrega do serviço.\n\nEscolha seu idioma:',
    service_select: '✨ Escolha o seu serviço:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *Serviço DIY – €4,99*\n✅ Preenchemos o formulário completamente (PDF)\n✅ Você recebe por e-mail\n📌 Você assina e envia pelos correios/e-mail\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Serviço Completo – €39,99*\n✅ Preenchemos o formulário\n✅ Procuração oficial em seu nome\n✅ Enviamos diretamente ao Bürgeramt\n⚖️ Adv. Frederico Reichel, Berlim\n━━━━━━━━━━━━━━━━━━━━━\n\nQual serviço você escolhe?',
    ask_firstname: '📝 Qual é seu **primeiro nome** (e outros prenomes)?\n\n_Todos os nomes como no documento. Ex: Maria Clara_',
    ask_lastname: '📝 Qual é seu **sobrenome**?\n\n_Todos os sobrenomes como no documento. Ex: Silva Oliveira_',
    ask_birthdate: '📅 Data de nascimento?\n\nFormato: DD.MM.AAAA\nExemplo: 15.03.1990',
    ask_birthplace: '🏙 Cidade de nascimento?',
    ask_gender: '⚧ Sexo? (masculino / feminino / outro)',
    ask_nationality: '🌍 Nacionalidade?',
    ask_address: '🏠 Seu **endereço atual** em Berlim?\n\nCompleto:\nRua Número, CEP Berlin\n\nExemplo: Katzbachstr. 18, 10965 Berlin',
    ask_moveout: '📆 Data da mudança?\n\nFormato: DD.MM.AAAA',
    ask_newaddress_street: '🏠 Novo endereço — **Rua e número**?\n\nExemplo: Rua das Flores 123',
    ask_newaddress_plzcity: '📮 **CEP e cidade**?\n\nExemplo: 01310-100 São Paulo',
    ask_newaddress_country: '🌍 **País**?\n\nExemplo: Brasil',
    ask_email: '📧 Seu **e-mail**?',
    ask_phone: '📱 Seu **telefone**?',
    ask_wohnungtyp: '🏠 Seu apartamento em Berlim era...?',
    wohnungtyp_alleinige: '🏠 Residência única',
    wohnungtyp_haupt: '🏠 Residência principal (com secundária)',
    wohnungtyp_neben: '🏠 Residência secundária',
    ask_neue_existiert: '🌍 O novo endereço já existia como domicílio?',
    neue_nein: '❌ Não',
    neue_haupt: '✅ Sim, como residência principal',
    neue_neben: '✅ Sim, como residência secundária',
    ask_sig_mode: '✍️ Como quer assinar?',
    sig_mode_self: '📄 Assinar o PDF eu mesmo',
    sig_mode_paste: '🖊️ Enviar foto da assinatura',
    ask_signature: '✍️ Envie uma **foto da sua assinatura**!\n\n📸 Como:\n1. Assine em papel branco\n2. Fotografe somente a assinatura\n3. Envie aqui\n\n⚠️ Deve coincidir com a do documento de identidade',
    ask_id_front: '📸 Foto do **documento (frente)**',
    ask_id_back: '📸 Agora a **parte de trás**',
    ask_vollmacht: '📜 Por favor envie uma **foto ou scan da Vollmacht assinada**\n\n_(Você recebeu a Vollmacht por email. Assine e envie aqui.)_',
    ask_anmeldung: '🗂 Se possível, envie uma **cópia da sua última Anmeldung** (confirmação de registo).\n\n_Não obrigatório — mas ajuda. Pode enviar foto ou PDF._',
    skip_doc: '⏭ Pular (não tenho agora)',
    ask_family: '👨‍👩‍👧 Vai incluir **familiares** no formulário?\n\n(Cônjuge, filhos que moravam no mesmo endereço)',
    family_yes: '✅ Sim, adicionar familiares',
    family_no: '➡️ Não, continuar',
    ask_family_name: '👤 Nome do familiar #{n}?\n\n_Todos os nomes + sobrenomes, data de nascimento_\n_Exemplo: Maria Silva, 10.05.1990_',
    family_add_more: '➕ Adicionar outro familiar',
    family_done: '✅ Pronto, continuar',
    summary: '📋 **Resumo**\n\n1️⃣ Nome: {firstName}\n2️⃣ Sobrenome: {lastName}\n3️⃣ Nasc.: {birthDate} em {birthPlace}\n4️⃣ Nacionalidade: {nationality}\n\n5️⃣ Endereço Berlim: {address}\n📍 {bezirk}\n\n6️⃣ Saída: {moveOutDate}\n7️⃣ Novo endereço: {newAddress}\n\n8️⃣ E-mail: {email}\n9️⃣ Telefone: {phone}\n\n{familySummary}💼 {service}\n\n✅ Correto?',
    summary_correct: '✓ Sim, continuar',
    summary_wrong: '✏️ Corrigir campo',
    correct_which: 'Qual campo corrigir?',
    correct_firstname: '1️⃣ Nome',
    correct_lastname: '2️⃣ Sobrenome',
    correct_birthdate: '3️⃣ Data nasc.',
    correct_birthplace: '4️⃣ Local nasc.',
    correct_nationality: '5️⃣ Nacionalidade',
    correct_address: '6️⃣ Endereço Berlim',
    correct_moveout: '7️⃣ Data saída',
    correct_newaddress: '8️⃣ Novo endereço',
    correct_email: '9️⃣ E-mail',
    correct_phone: '🔟 Telefone',
    correct_enter_new: 'Digite o novo valor:',
    payment_info: '💳 **Pagamento: €{amount}**\n\n{paymentUrl}',
    payment_success: '✅ **Pago!**\n\nPedido: `{orderId}`',
    error_general: '❌ Erro. Tente /start',
    error_photo: '❌ Envie uma foto',
    invalid_date: '❌ Data inválida. Use DD.MM.AAAA',
    invalid_email: '❌ E-mail inválido',
    invalid_plz: '❌ CEP inválido. Verifique o CEP de Berlim.',
    signature_received: '✅ Assinatura recebida!',
    id_front_received: '✅ Frente recebida!',
    id_back_received: '✅ Verso recebido!',
    processing: '⏳ Um momento...',
    cancel: 'Cancelado. /start para recomeçar.',
    help: '📚 **Ajuda**\n\n/start - Recomeçar\n/cancel - Cancelar\n/help - Ajuda\n\n📧 info@rafer.de\n🏢 ' + FIRM_ADDRESS
  },
  en: {
    welcome: '🏛 *Law Office Rechtsanwalt Frederico Reichel*\n\n👋 Welcome to the official Abmeldung service of Kanzlei Reichel.\n\n🔒 *Privacy:* All your data is handled confidentially and will be deleted after service delivery.\n\nChoose your language:',
    service_select: '✨ Choose your service:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *DIY Service – €4.99*\n✅ We fill the form completely (PDF)\n✅ Sent to your email\n📌 You sign and send by post/email\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Full Service – €39.99*\n✅ We fill the form\n✅ Official power of attorney in your name\n✅ We send directly to the Bürgeramt\n⚖️ RA Frederico Reichel, Berlin\n━━━━━━━━━━━━━━━━━━━━━\n\nWhich service do you choose?',
    ask_firstname: '📝 Your **first name(s)**?\n\n_All given names exactly as in your ID. E.g.: Maria Clara_',
    ask_lastname: '📝 Your **last name(s)**?\n\n_All surnames as in your ID. E.g.: Silva Oliveira_',
    ask_birthdate: '📅 Date of birth?\n\nFormat: DD.MM.YYYY\nExample: 15.03.1990',
    ask_birthplace: '🏙 Place of birth?',
    ask_gender: '⚧ Gender? (male / female / diverse)',
    ask_nationality: '🌍 Nationality?',
    ask_address: '🏠 Your **current address** in Berlin?\n\nComplete:\nStreet Number, Postcode Berlin\n\nExample: Katzbachstr. 18, 10965 Berlin',
    ask_moveout: '📆 Move-out date?\n\nFormat: DD.MM.YYYY',
    ask_newaddress_street: '🏠 New address — **street and number**?\n\nExample: Main St 123',
    ask_newaddress_plzcity: '📮 **Postcode and city**?\n\nExample: SW1A 1AA London',
    ask_newaddress_country: '🌍 **Country**?\n\nExample: United Kingdom',
    ask_email: '📧 Your **email**?',
    ask_phone: '📱 Your **phone**?',
    ask_wohnungtyp: '🏠 Was your Berlin apartment...?',
    wohnungtyp_alleinige: '🏠 Sole residence',
    wohnungtyp_haupt: '🏠 Main residence (with secondary)',
    wohnungtyp_neben: '🏠 Secondary residence',
    ask_neue_existiert: '🌍 Did the new address already exist as a registered residence?',
    neue_nein: '❌ No',
    neue_haupt: '✅ Yes, as main residence',
    neue_neben: '✅ Yes, as secondary residence',
    ask_sig_mode: '✍️ How would you like to sign?',
    sig_mode_self: '📄 Sign the PDF myself',
    sig_mode_paste: '🖊️ Send photo of signature',
    ask_signature: '✍️ Send a **photo of your signature**!\n\n📸 How:\n1. Sign on white paper\n2. Photograph only the signature\n3. Send here\n\n⚠️ Must match your ID signature',
    ask_id_front: '📸 Photo of **ID (front)**',
    ask_id_back: '📸 Now the **back**',
    ask_vollmacht: '📜 Please send a **photo or scan of the signed Vollmacht (power of attorney)**\n\n_(You received the Vollmacht by email. Sign it and send it here.)_',
    ask_anmeldung: '🗂 If available, please send a **copy of your last Anmeldung** (registration confirmation).\n\n_Not mandatory, but helpful._',
    skip_doc: '⏭ Skip (I don\'t have it)',
    ask_family: '👨‍👩‍👧 Are you also deregistering **family members**?\n\n(Spouse, children who lived at the same address)',
    family_yes: '✅ Yes, add family members',
    family_no: '➡️ No, continue',
    ask_family_name: '👤 Family member #{n} name?\n\n_All given names + surnames, date of birth_\n_Example: Maria Silva, 10.05.1990_',
    family_add_more: '➕ Add another member',
    family_done: '✅ Done, continue',
    summary: '📋 **Summary**\n\n1️⃣ First name: {firstName}\n2️⃣ Last name: {lastName}\n3️⃣ Born: {birthDate} in {birthPlace}\n4️⃣ Nationality: {nationality}\n\n5️⃣ Berlin address: {address}\n📍 {bezirk}\n\n6️⃣ Move-out: {moveOutDate}\n7️⃣ New address: {newAddress}\n\n8️⃣ Email: {email}\n9️⃣ Phone: {phone}\n\n{familySummary}💼 {service}\n\n✅ Correct?',
    summary_correct: '✓ Yes, continue',
    summary_wrong: '✏️ Correct a field',
    correct_which: 'Which field to correct?',
    correct_firstname: '1️⃣ First name',
    correct_lastname: '2️⃣ Last name',
    correct_birthdate: '3️⃣ Birth date',
    correct_birthplace: '4️⃣ Birth place',
    correct_nationality: '5️⃣ Nationality',
    correct_address: '6️⃣ Berlin address',
    correct_moveout: '7️⃣ Move-out date',
    correct_newaddress: '8️⃣ New address',
    correct_email: '9️⃣ Email',
    correct_phone: '🔟 Phone',
    correct_enter_new: 'Please enter the new value:',
    payment_info: '💳 **Payment: €{amount}**\n\n{paymentUrl}',
    payment_success: '✅ **Paid!**\n\nOrder: `{orderId}`',
    error_general: '❌ Error. Try /start',
    error_photo: '❌ Send a photo',
    invalid_date: '❌ Invalid date. Use DD.MM.YYYY',
    invalid_email: '❌ Invalid email',
    invalid_plz: '❌ Invalid Berlin postcode.',
    signature_received: '✅ Signature received!',
    id_front_received: '✅ Front received!',
    id_back_received: '✅ Back received!',
    processing: '⏳ One moment...',
    cancel: 'Cancelled. /start to restart.',
    help: '📚 **Help**\n\n/start - Restart\n/cancel - Cancel\n/help - Help\n\n📧 info@rafer.de\n🏢 ' + FIRM_ADDRESS
  }
};

// Commands
bot.command('start', (ctx) => {
  sessions.delete(ctx.chat.id); // sessão limpa em cada /start
  const session = createSession(ctx.chat.id);
  ctx.reply(
    translations.de.welcome,
    Markup.inlineKeyboard([
      [Markup.button.callback('🇩🇪 Deutsch', 'lang_de')],
      [Markup.button.callback('🇧🇷 Português', 'lang_pt')],
      [Markup.button.callback('🇬🇧 English', 'lang_en')]
    ])
  );
});

bot.command('cancel', (ctx) => {
  const session = getSession(ctx.chat.id);
  deleteSession(ctx.chat.id);
  ctx.reply(t(session, 'cancel'));
});

bot.command('help', (ctx) => {
  const session = getSession(ctx.chat.id);
  ctx.reply(t(session, 'help'), { parse_mode: 'Markdown' });
});

// Language selection
bot.action(/lang_(.+)/, (ctx) => {
  const lang = ctx.match[1];
  const session = getSession(ctx.chat.id);
  session.lang = lang;
  session.step = 'service';
  ctx.answerCbQuery();
  ctx.reply(
    t(session, 'service_select'),
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 DIY - €4.99', 'service_diy')],
      [Markup.button.callback('🎯 Full Service - €39.99', 'service_full')]
    ])
  );
});

// Service selection
// (skip_vollmacht e skip_anmeldung definidos abaixo, após askFamily)

bot.action('service_diy', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.data.service = 'diy';
  session.step = 'firstname';
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'ask_firstname'), { parse_mode: 'Markdown' });
});

bot.action('service_full', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.data.service = 'full';
  session.step = 'firstname';
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'ask_firstname'), { parse_mode: 'Markdown' });
});

// Vivid payment links
const PAYMENT_URL = {
  full: 'https://business.vivid.money/de/pay/AZyfxze6ftqRjhi9U7NpBw',
  diy:  'https://business.vivid.money/de/pay/AZyfyBwVfGmr-sdU2hwVug'
};

// Generate filled Abmeldung PDF
function generateAbmeldungPdf(session) {
  return new Promise((resolve, reject) => {
    const { data } = session;
    const today = new Date().toLocaleDateString('de-DE');
    const outputPath = path.join(BOT_DIR, 'pdfs', `Abmeldung_${data.orderId}.pdf`);

    const payload = JSON.stringify({
      Nachname:             data.lastName,
      Vorname:              data.firstName,
      Geburtsname:          data.birthName || '',
      Geschlecht:           data.gender || '',
      Geburtsdatum:         data.birthDate || '',
      Geburtsort:           data.birthPlace || '',
      Staatsangehoerigkeit: data.nationality || '',
      Strasse:              data.fullAddress || '',
      PLZ:                  data.plz || '',
      Bezirk:               data.bezirk || '',
      Auszugsdatum:         data.moveOutDate || '',
      NeueStrasse:          data.newStreet || '',
      NeuesLand:            `${data.newPlzCity || ''} ${data.newCountry || ''}`.trim(),
      BisherigWohnung:      data.bisherigWohnungTyp || 'alleinige',
      NeueWohnungExistiert: data.neueWohnungExistiert || 'nein',
      Datum:                today,
      SignaturBase64:       (data.sigMode === 'paste' && data.signatureImage) ? data.signatureImage : '',
      FamilyMembers:        data.familyMembers || [],
    });

    const PYTHON3 = process.env.PYTHON_PATH || 'python3';
    const scriptPath = path.join(BOT_DIR, 'fill_abmeldung.py');
    const pyEnv = { ...process.env };
    execFile(PYTHON3, [scriptPath, payload, outputPath], { env: pyEnv }, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ fill_abmeldung.py error:', stderr);
        return reject(new Error(stderr || err.message));
      }
      if (stdout.startsWith('OK:')) {
        console.log('✅ PDF generated:', outputPath);

        // Gerar Vollmacht (sempre, para full service)
        if (data.service === 'full') {
          const vollmachtPath = outputPath.replace('.pdf', '_Vollmacht.pdf');
          const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
          if (fs.existsSync(vollmachtScript)) {
            try {
              const today2 = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
              const vollmachtData = JSON.stringify({
                Vorname:  data.firstName,
                Nachname: data.lastName,
                Bezirk:   data.bezirk || 'Berlin',
                Datum:    today2,
              });
              execFileSync(PYTHON3, [vollmachtScript, vollmachtData, vollmachtPath], { env: pyEnv });
              session._vollmachtPath = vollmachtPath;
              console.log('✅ Vollmacht gerada:', vollmachtPath);
            } catch(ve) {
              console.error('⚠️ Vollmacht gen error (non-fatal):', ve.message);
            }
          }
        }

        resolve(outputPath);
      } else {
        reject(new Error(stdout || 'Unknown error'));
      }
    });
  });
}

// Gerar PDF com frente+verso do documento de identidade
async function buildIdPdf(frontBase64, backBase64, orderId) {
  const tmpDir = path.join(BOT_DIR, 'pdfs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Guardar imagens temporariamente
  const paths = [];
  for (const [label, b64] of [['front', frontBase64], ['back', backBase64]]) {
    if (!b64) continue;
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    const imgPath = path.join(tmpDir, `id_${label}_${orderId}.jpg`);
    fs.writeFileSync(imgPath, Buffer.from(raw, 'base64'));
    paths.push(imgPath);
  }
  if (paths.length === 0) return null;

  const outPath = path.join(tmpDir, `ID_${orderId}.pdf`);
  const PYTHON3 = process.env.PYTHON_PATH || 'python3';

  // Script Python inline para criar PDF com as imagens (A4, imagem centrada com margens)
  const pyScript = `
import sys, fitz
args = sys.argv[1:]
out = args[-1]
imgs = args[:-1]
doc = fitz.open()
for img_path in imgs:
    page = doc.new_page(width=595, height=842)
    margin = 20
    pix = fitz.open(img_path)[0].get_pixmap()
    iw, ih = pix.width, pix.height
    aw = 595 - 2*margin
    ah = 842 - 2*margin
    scale = min(aw/iw, ah/ih)
    w, h = iw*scale, ih*scale
    x0 = margin + (aw-w)/2
    y0 = margin + (ah-h)/2
    rect = fitz.Rect(x0, y0, x0+w, y0+h)
    page.insert_image(rect, filename=img_path, keep_proportion=False)
doc.save(out)
print('OK')
`;
  const scriptPath = path.join(tmpDir, `build_id_${orderId}.py`);
  fs.writeFileSync(scriptPath, pyScript);

  await new Promise((resolve, reject) => {
    execFile(PYTHON3, [scriptPath, ...paths, outPath], { timeout: 30000 }, (err, stdout, stderr) => {
      // limpar ficheiros temp
      try { fs.unlinkSync(scriptPath); } catch(_) {}
      paths.forEach(p => { try { fs.unlinkSync(p); } catch(_) {} });
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });

  const pdfBytes = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch(_) {}
  return pdfBytes;
}

// Microsoft Graph Email
async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });
  const resp = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  return resp.data.access_token;
}

async function sendAbmeldungEmail(toEmail, pdfPath, session) {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    console.log('Graph API nao configurada - simulando email');
    return { success: true, simulated: true };
  }
  const { data } = session;
  const firstName = data.firstName || '';
  const lastName  = data.lastName  || '';
  const orderId   = data.orderId   || '';
  const isDiy     = data.service === 'diy';
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  // Vollmacht como segundo anexo (full service)
  const attachments = [{
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'Abmeldung_' + orderId + '.pdf',
    contentType: 'application/pdf',
    contentBytes: pdfBase64,
  }];
  if (!isDiy && session._vollmachtPath && fs.existsSync(session._vollmachtPath)) {
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'Vollmacht_' + orderId + '.pdf',
      contentType: 'application/pdf',
      contentBytes: fs.readFileSync(session._vollmachtPath).toString('base64'),
    });
  }
  // Fotos do documento de identidade → PDF combinado (full service)
  if (!isDiy && (data.idFrontImage || data.idBackImage)) {
    try {
      const idPdfBytes = await buildIdPdf(data.idFrontImage, data.idBackImage, orderId);
      if (idPdfBytes) {
        attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'ID_' + orderId + '.pdf',
          contentType: 'application/pdf',
          contentBytes: idPdfBytes.toString('base64'),
        });
      }
    } catch (e) {
      console.error('⚠️ ID PDF build error:', e.message);
    }
  }
  const stepsHtml = isDiy
    ? '<p><strong>N\u00e4chste Schritte (DIY):</strong><br/>1. Formular ausdrucken<br/>2. Unterschreiben<br/>3. Ans B\u00fcrgeramt senden</p>'
    : '<p>Wir k\u00fcmmern uns um die Einreichung beim B\u00fcrgeramt.</p>';
  const SIG_B64 = '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';
  const htmlBody = '<p>Sehr geehrte/r ' + firstName + ' ' + lastName + ',</p>' +
    '<p>im Anhang finden Sie Ihr ausgef\u00fclltes Abmeldeformular (Aktenzeichen: <strong>' + orderId + '</strong>).</p>' +
    stepsHtml +
    '<p>Mit freundlichen Gr\u00fc\u00dfen,</p>' +
    '<p><img src="data:image/png;base64,' + SIG_B64 + '" alt="Unterschrift" style="max-height:80px;"/></p>' +
    '<p><strong>FREDERICO E. REICHEL</strong><br/>' +
    '<strong>Rechtsanwalt</strong><br/>' +
    'Katzbachstraße 18<br/>' +
    '10965 Berlin<br/><br/>' +
    'T&nbsp;&nbsp;&nbsp;&nbsp; +49 30 44312792<br/>' +
    'Fx&nbsp;&nbsp; +49 30 75439509<br/>' +
    'E&nbsp;&nbsp;&nbsp;&nbsp; <a href="mailto:abmeldung@rafer.de">abmeldung@rafer.de</a><br/>' +
    'WhatsApp +49 155 60245902</p>';
  const token = await getGraphToken();
  await axios.post(
    'https://graph.microsoft.com/v1.0/users/' + GRAPH_SENDER + '/sendMail',
    {
      message: {
        subject: 'Ihre Abmeldung - Aktenzeichen ' + orderId,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: toEmail } }],
        replyTo: [{ emailAddress: { address: FIRM_EMAIL } }],
        attachments,
      },
      saveToSentItems: true,
    },
    {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );
  console.log('Email enviado via Graph API para', toEmail);
  return { success: true };
}

// Send PDF to admin via Telegram
async function sendPdfToAdmin(pdfPath, session) {
  if (!ADMIN_CHAT_ID) return;
  const { data } = session;
  try {
    await bot.telegram.sendDocument(
      ADMIN_CHAT_ID,
      { source: pdfPath, filename: `Abmeldung_${data.orderId}.pdf` },
      { caption: `📄 *${data.firstName} ${data.lastName}* — ${data.orderId}\n📍 ${data.bezirk}\n📧 ${data.email}`, parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('❌ sendPdfToAdmin error:', err.message);
  }
}

// Main handler
async function triggerPowerAutomate(session) {
  try {
    const pdfPath = await generateAbmeldungPdf(session);
    // Send PDF to admin BEFORE deleting
    await sendPdfToAdmin(pdfPath, session);
    // Enviar Vollmacht gerada ao admin (full service)
    if (session._vollmachtPath && fs.existsSync(session._vollmachtPath)) {
      try {
        await bot.telegram.sendDocument(
          ADMIN_CHAT_ID,
          { source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` },
          { caption: `📜 Vollmacht — ${session.data.firstName} ${session.data.lastName}` }
        );
      } catch(e) { console.log('Vollmacht admin error:', e.message); }
    }
    if (session.data.anmeldungFileId) {
      try {
        await bot.telegram.sendDocument(ADMIN_CHAT_ID, session.data.anmeldungFileId);
      } catch(e) { console.log('Anmeldung forward error:', e.message); }
    }
    const result  = await sendAbmeldungEmail(session.data.email, pdfPath, session);

    // ── SharePoint: upload de documentos + ledger ──────────────────────────
    SP.processCaseToSharePoint(session, pdfPath, session._vollmachtPath || null, bot)
      .catch(e => console.error('SP non-fatal error:', e.message));

    // Archive PDF instead of deleting
    const archiveDir = path.join(BOT_DIR, 'pdfs', 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, path.basename(pdfPath));
    try { fs.renameSync(pdfPath, archivePath); console.log('📁 PDF arquivado:', archivePath); } catch (_) {}
    return result;
  } catch (err) {
    console.error('❌ PDF/email error:', err.message);
    return { success: false, error: err.message };
  }
}

// Payment confirmation handler
async function handlePaymentConfirmed(ctx, session) {
  // Tradução IA de campos se necessário
  if (session.data.nationality && ANTHROPIC_API_KEY) {
    const natDE = await translateToGerman(session.data.nationality, 'nationality/country name');
    if (natDE && natDE !== session.data.nationality) session.data.nationality = natDE;
  }
  if (session.data.birthPlace && ANTHROPIC_API_KEY) {
    const bpDE = await translateToGerman(session.data.birthPlace, 'city name');
    if (bpDE) session.data.birthPlace = bpDE;
  }
  const lang = session.lang || 'de';
  session.step = 'done';

  const ackMsgs = {
    de: '✅ *Bestätigt!*\n\n⏳ Wir generieren jetzt Ihr Formular und senden es per E-Mail...\n\nBestellnummer: `' + session.data.orderId + '`',
    pt: '✅ *Confirmado!*\n\n⏳ Estamos gerando seu formulário e enviando por e-mail...\n\nPedido: `' + session.data.orderId + '`',
    en: '✅ *Confirmed!*\n\n⏳ Generating your form and sending by email...\n\nOrder: `' + session.data.orderId + '`'
  };
  await ctx.reply(ackMsgs[lang], { parse_mode: 'Markdown' });

  const result = await triggerPowerAutomate(session);

  const doneMsgs = {
    de: result.success
      ? '📧 *Fertig!* Das Formular wurde an *' + session.data.email + '* gesendet.' + (result.simulated ? '\n\n_(Simulation — SMTP noch nicht konfiguriert)_' : '')
      : '⚠️ E-Mail konnte nicht gesendet werden. Bitte wenden Sie sich an info@rafer.de\nBestellnummer: `' + session.data.orderId + '`',
    pt: result.success
      ? '📧 *Pronto!* O formulário foi enviado para *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulação — SMTP não configurado)_' : '')
      : '⚠️ Não foi possível enviar o e-mail. Entre em contato: info@rafer.de\nPedido: `' + session.data.orderId + '`',
    en: result.success
      ? '📧 *Done!* The form was sent to *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulation — SMTP not configured)_' : '')
      : '⚠️ Could not send email. Please contact: info@rafer.de\nOrder: `' + session.data.orderId + '`',
  };
  await ctx.reply(doneMsgs[lang], { parse_mode: 'Markdown' });

  await notifyAdmin(session);
  deleteSession(ctx.chat.id);
}

// Helper: perguntar sobre familiares (ANTES da assinatura)
async function askFamily(ctx, session) {
  session.step = 'ask_family';
  await ctx.reply(
    t(session, 'ask_family'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(session, 'family_yes'), 'family_yes')],
      [Markup.button.callback(t(session, 'family_no'),  'family_no')],
    ])
  );
}

// Helper: perguntar modo de assinatura (DEPOIS dos familiares)
async function askSigMode(ctx, session) {
  session.step = 'sig_mode';
  await ctx.reply(
    t(session, 'ask_sig_mode'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(session, 'sig_mode_self'),  'sig_self')],
      [Markup.button.callback(t(session, 'sig_mode_paste'), 'sig_paste')],
    ])
  );
}

// Familiares — perguntado ANTES da assinatura
bot.action('family_no', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await askSigMode(ctx, session);
});

bot.action('family_yes', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session.data.familyMembers) session.data.familyMembers = [];
  session.step = 'family_name';
  await ctx.answerCbQuery();
  const n = session.data.familyMembers.length + 1;
  await ctx.reply(t(session, 'ask_family_name').replace('{n}', n));
});

bot.action('family_add_more', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (session.data.familyMembers && session.data.familyMembers.length >= 2) {
    await ctx.answerCbQuery();
    await askSigMode(ctx, session);
    return;
  }
  session.step = 'family_name';
  await ctx.answerCbQuery();
  const n = (session.data.familyMembers || []).length + 1;
  await ctx.reply(t(session, 'ask_family_name').replace('{n}', n));
});

bot.action('family_done', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await askSigMode(ctx, session);
});

// Modo de assinatura — DEPOIS dos familiares
bot.action('sig_self', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.data.sigMode = 'self';
  await ctx.answerCbQuery();
  await showSummary(ctx, session);
});

bot.action('sig_paste', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.data.sigMode = 'paste';
  session.step = 'signature';
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'ask_signature'));
});

// Wohnungtyp (bisherige Wohnung)
bot.action(/wtyp_(.+)/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const typ = ctx.match[1];
  session.data.bisherigWohnungTyp = typ.charAt(0).toUpperCase() + typ.slice(1);
  session.step = 'neue_existiert';
  await ctx.answerCbQuery();
  await ctx.reply(
    t(session, 'ask_neue_existiert'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(session, 'neue_nein'),   'nexist_nein')],
      [Markup.button.callback(t(session, 'neue_haupt'),  'nexist_haupt')],
      [Markup.button.callback(t(session, 'neue_neben'),  'nexist_neben')],
    ])
  );
});

// Neue Wohnung bereits bestanden?
bot.action(/nexist_(.+)/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const val = ctx.match[1];
  const map = { nein: 'nein', haupt: 'Hauptwohnung', neben: 'Nebenwohnung' };
  session.data.neueWohnungExistiert = map[val] || 'nein';
  session.step = 'email';
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'ask_email'));
});

// Gender buttons
bot.action(/gender_([mfd])/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const map = { m: 'männlich', f: 'weiblich', d: 'divers' };
  session.data.gender = map[ctx.match[1]] || ctx.match[1];
  session.step = 'nationality';
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'ask_nationality'));
});

// Summary actions
bot.action('summary_correct', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();

  const lang = session.lang || 'de';
  const orderId = 'AB' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
  session.data.orderId = orderId;

  // SIMULATION MODE
  const simMsgs = {
    de: '🧪 *Simulation* — Zahlung wird übersprungen\n\n⏳ Generiere Formular und sende E-Mail...',
    pt: '🧪 *Simulação* — Pagamento ignorado\n\n⏳ Gerando formulário e enviando e-mail...',
    en: '🧪 *Simulation* — Payment skipped\n\n⏳ Generating form and sending email...'
  };
  await ctx.reply(simMsgs[lang], { parse_mode: 'Markdown' });
  await handlePaymentConfirmed(ctx, session);
});

bot.action('summary_wrong', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await ctx.reply(
    t(session, 'correct_which'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(session, 'correct_firstname'),   'corr_firstname'),
       Markup.button.callback(t(session, 'correct_lastname'),    'corr_lastname')],
      [Markup.button.callback(t(session, 'correct_birthdate'),   'corr_birthdate'),
       Markup.button.callback(t(session, 'correct_birthplace'),  'corr_birthplace')],
      [Markup.button.callback(t(session, 'correct_nationality'), 'corr_nationality')],
      [Markup.button.callback(t(session, 'correct_address'),     'corr_address')],
      [Markup.button.callback(t(session, 'correct_moveout'),     'corr_moveout')],
      [Markup.button.callback(t(session, 'correct_newaddress'),  'corr_newaddress')],
      [Markup.button.callback(t(session, 'correct_email'),       'corr_email'),
       Markup.button.callback(t(session, 'correct_phone'),       'corr_phone')],
    ])
  );
});

// Correção pontual — mapa de campos
const CORR_FIELD_MAP = {
  firstname:   { key: 'firstName' },
  lastname:    { key: 'lastName' },
  birthdate:   { key: 'birthDate' },
  birthplace:  { key: 'birthPlace' },
  nationality: { key: 'nationality' },
  address:     { key: 'fullAddress' },
  moveout:     { key: 'moveOutDate' },
  newaddress:  { key: 'newFullAddress' },
  email:       { key: 'email' },
  phone:       { key: 'phone' },
};

bot.action(/corr_(.+)/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const field = ctx.match[1];
  if (!CORR_FIELD_MAP[field]) return ctx.answerCbQuery();
  session.step = `corr_${field}`;
  await ctx.answerCbQuery();
  await ctx.reply(t(session, 'correct_enter_new'));
});

// Text input handler
bot.on('text', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return;

  // Awaiting payment proof
  if (session.step === 'awaiting_payment') {
    await handlePaymentConfirmed(ctx, session);
    return;
  }

  // Correção pontual de campo
  if (session.step && session.step.startsWith('corr_')) {
    const field = session.step.replace('corr_', '');
    const info = CORR_FIELD_MAP[field];
    if (info) {
      if (field === 'birthdate' || field === 'moveout') {
        if (!isValidDate(text)) { await ctx.reply(t(session, 'invalid_date')); return; }
      }
      if (field === 'email') {
        if (!isValidEmail(text)) { await ctx.reply(t(session, 'invalid_email')); return; }
      }
      if (field === 'address') {
        const plz = extractPLZ(text);
        if (!plz || !PLZ_MAP[plz]) { await ctx.reply(t(session, 'invalid_plz')); return; }
        session.data.fullAddress = text;
        session.data.plz = plz;
        session.data.bezirk = getBezirk(plz);
      } else if (field === 'newaddress') {
        session.data.newFullAddress = text;
        session.data.newStreet = text;
        session.data.newPlzCity = '';
        session.data.newCountry = '';
      } else {
        session.data[info.key] = text;
      }
      await ctx.reply('✅');
      await showSummary(ctx, session);
      return;
    }
  }

  switch (session.step) {
    case 'firstname':
      session.data.firstName = text;
      session.step = 'lastname';
      await ctx.reply(t(session, 'ask_lastname'), { parse_mode: 'Markdown' });
      break;

    case 'lastname':
      session.data.lastName = text;
      session.step = 'birthdate';
      await ctx.reply(t(session, 'ask_birthdate'));
      break;

    case 'birthdate':
      if (!isValidDate(text)) {
        await ctx.reply(t(session, 'invalid_date'));
        return;
      }
      session.data.birthDate = text;
      session.step = 'birthplace';
      await ctx.reply(t(session, 'ask_birthplace'));
      break;

    case 'birthplace':
      session.data.birthPlace = text;
      session.step = 'gender';
      await ctx.reply(
        t(session, 'ask_gender'),
        Markup.inlineKeyboard([
          [Markup.button.callback('♂ männlich / masculino / male',   'gender_m')],
          [Markup.button.callback('♀ weiblich / feminino / female',  'gender_f')],
          [Markup.button.callback('⚧ divers / outro / other',         'gender_d')],
        ])
      );
      break;

    case 'gender':
      // fallback: text input
      session.data.gender = text;
      session.step = 'nationality';
      await ctx.reply(t(session, 'ask_nationality'));
      break;

    case 'nationality':
      session.data.nationality = normalizeNationality(text);
      session.step = 'address';
      await ctx.reply(t(session, 'ask_address'));
      break;

    case 'address': {
      const plz = extractPLZ(text);
      if (!plz || !PLZ_MAP[plz]) {
        await ctx.reply(t(session, 'invalid_plz'));
        return;
      }
      session.data.fullAddress = text;
      session.data.plz = plz;
      session.data.bezirk = getBezirk(plz);
      session.step = 'moveout';
      await ctx.reply(t(session, 'ask_moveout'));
      break;
    }

    case 'moveout':
      if (!isValidDate(text)) {
        await ctx.reply(t(session, 'invalid_date'));
        return;
      }
      session.data.moveOutDate = text;
      session.step = 'newaddress_street';
      await ctx.reply(t(session, 'ask_newaddress_street'));
      break;

    case 'newaddress_street':
      session.data.newStreet = text;
      session.step = 'newaddress_plzcity';
      await ctx.reply(t(session, 'ask_newaddress_plzcity'));
      break;

    case 'newaddress_plzcity':
      session.data.newPlzCity = text;
      session.step = 'newaddress_country';
      await ctx.reply(t(session, 'ask_newaddress_country'));
      break;

    case 'newaddress_country':
      session.data.newCountry = text;
      session.data.newFullAddress = `${session.data.newStreet}, ${session.data.newPlzCity}, ${session.data.newCountry}`;
      session.step = 'wohnungtyp';
      await ctx.reply(
        t(session, 'ask_wohnungtyp'),
        Markup.inlineKeyboard([
          [Markup.button.callback(t(session, 'wohnungtyp_alleinige'), 'wtyp_alleinige')],
          [Markup.button.callback(t(session, 'wohnungtyp_haupt'),     'wtyp_haupt')],
          [Markup.button.callback(t(session, 'wohnungtyp_neben'),     'wtyp_neben')],
        ])
      );
      break;

    case 'email':
      if (!isValidEmail(text)) {
        await ctx.reply(t(session, 'invalid_email'));
        return;
      }
      session.data.email = text;
      // Sempre pedir telefone (DIY e Full), depois ID
      session.step = 'phone';
      await ctx.reply(t(session, 'ask_phone'));
      break;

    case 'phone':
      session.data.phone = text;
      // Full e DIY: pedir documento de identidade
      session.step = 'id_front';
      await ctx.reply(t(session, 'ask_id_front'));
      break;

    case 'family_name':
      if (!session.data.familyMembers) session.data.familyMembers = [];
      session.data.familyMembers.push(text);
      {
        const canAddMore = session.data.familyMembers.length < 2;
        await ctx.reply(
          `✅ ${text}`,
          canAddMore
            ? Markup.inlineKeyboard([
                [Markup.button.callback(t(session, 'family_add_more'), 'family_add_more')],
                [Markup.button.callback(t(session, 'family_done'),     'family_done')],
              ])
            : Markup.inlineKeyboard([
                [Markup.button.callback(t(session, 'family_done'), 'family_done')],
              ])
        );
      }
      break;
  }
});

// Photo handler
bot.on('photo', async (ctx) => {
  const session = getSession(ctx.chat.id);

  if (session.step === 'awaiting_payment') {
    await handlePaymentConfirmed(ctx, session);
    return;
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  ctx.reply(t(session, 'processing'));
  const base64Image = await downloadPhoto(ctx, photo.file_id);

  if (!base64Image) {
    await ctx.reply(t(session, 'error_photo'));
    return;
  }

  switch (session.step) {
    case 'signature':
      session.data.signatureImage = base64Image;
      await ctx.reply(t(session, 'signature_received'));
      await showSummary(ctx, session);
      break;

    case 'id_front':
      session.data.idFrontImage  = base64Image;
      session.data.idFrontFileId = photo.file_id; // para upload SharePoint
      await ctx.reply(t(session, 'id_front_received'));
      session.step = 'id_back';
      await ctx.reply(t(session, 'ask_id_back'));
      break;

    case 'id_back':
      session.data.idBackImage  = base64Image;
      session.data.idBackFileId = photo.file_id; // para upload SharePoint
      await ctx.reply(t(session, 'id_back_received'));
      // Após ID: pedir Anmeldung anterior (opcional) para todos
      session.step = 'anmeldung';
      await ctx.reply(t(session, 'ask_anmeldung'), Markup.inlineKeyboard([
        [Markup.button.callback(t(session, 'skip_doc'), 'skip_anmeldung')]
      ]));
      break;

    case 'anmeldung': {
      const amsg = ctx.message;
      const afid = amsg.photo ? amsg.photo[amsg.photo.length-1].file_id : null;
      if (afid) {
        session.data.anmeldungFileId = afid;
        console.log('🗂 Anmeldung recebida:', afid);
        await ctx.reply('✅ Anmeldung recebida!');
      }
      await askFamily(ctx, session);
      break;
    }
  }
});

// Skip document buttons
bot.action('skip_anmeldung', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await askFamily(ctx, session);
});

// Show summary
async function showSummary(ctx, session) {
  const { data } = session;
  const serviceLabel = data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)';
  const newAddr = data.newFullAddress || [data.newStreet, data.newPlzCity, data.newCountry].filter(Boolean).join(', ');

  // Build family summary line
  let familySummary = '';
  if (data.familyMembers && data.familyMembers.length > 0) {
    familySummary = '👨‍👩‍👧 Familienmitglieder:\n' + data.familyMembers.map((m, i) => `  ${i+2}. ${m}`).join('\n') + '\n\n';
  }

  const summary = t(session, 'summary')
    .replace('{firstName}',    data.firstName   || '–')
    .replace('{lastName}',     data.lastName    || '–')
    .replace('{birthDate}',    data.birthDate   || '–')
    .replace('{birthPlace}',   data.birthPlace  || '–')
    .replace('{nationality}',  data.nationality || '–')
    .replace('{address}',      data.fullAddress || '–')
    .replace('{bezirk}',       data.bezirk      || '–')
    .replace('{moveOutDate}',  data.moveOutDate || '–')
    .replace('{newAddress}',   newAddr          || '–')
    .replace('{email}',        data.email       || '–')
    .replace('{phone}',        data.phone       || '–')
    .replace('{familySummary}',familySummary)
    .replace('{service}',      serviceLabel);

  await ctx.reply(
    summary,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(t(session, 'summary_correct'), 'summary_correct')],
        [Markup.button.callback(t(session, 'summary_wrong'),   'summary_wrong')],
      ])
    }
  );
}

// Error handling
bot.catch((err, ctx) => {
  // Ignore expired callback query errors silently
  if (err.message && err.message.includes('query is too old')) return;
  if (err.response && err.response.description && err.response.description.includes('query ID is invalid')) return;
  console.error('Bot error:', err);
  try { ctx.reply('❌ Fehler. Bitte /start'); } catch(_) {}
});


// ─── LAUNCH ─────────────────────────────────────────────────────────────
// Polling timeout no polling.js está patchado para 10s.
// O restart_delay do PM2 é 40s (> 10s), então ao reiniciar a sessão já expirou.
async function startBot() {
  console.log('🤖 AbmeldeBot iniciando...');

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('🧹 Webhook limpo');
  } catch(e) { /* ignora */ }

  try {
    console.log('🚀 Lançando bot...');
    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query'],
    });
    console.log('✅ AbmeldeBot gestartet!');
    console.log('📱 Jetzt in Telegram: /start');
  } catch(err) {
    if (err.message && err.message.includes('409')) {
      console.log('⚠️ 409 — saindo. PM2 reinicia após restart_delay=45s...');
      process.exit(0);
    }
    console.error('❌ Erro:', err.message);
    process.exit(0);
  }
}

startBot();
process.once('SIGINT',  () => { console.log('SIGINT'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { console.log('SIGTERM'); bot.stop('SIGTERM'); });
