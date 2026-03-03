// AbmeldeBot - Telegram Bot Version
// Complete implementation with multi-language support

// Load environment variables
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { execFile } = require('child_process');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Configuration from environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SMTP_HOST     = process.env.SMTP_HOST     || null;
const SMTP_PORT     = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER     = process.env.SMTP_USER     || null;
const SMTP_PASS     = process.env.SMTP_PASS     || null;
const SMTP_FROM     = process.env.SMTP_FROM     || SMTP_USER;
const FIRM_ADDRESS  = 'Rechtsanwalt Frederico Reichel, Katzbachstr. 18, 10965 Berlin';
const FIRM_EMAIL    = 'info@rafer.de';
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
    welcome: '👋 Willkommen beim AbmeldeBot / Welcome to AbmeldeBot / Bem-vindo ao AbmeldeBot!\n\n🇩🇪 Ich helfe Ihnen bei Ihrer Abmeldung in Berlin.\n🇬🇧 I help you with your deregistration in Berlin.\n🇧🇷 Eu ajudo com sua baixa de registro em Berlim.\n\nBitte Sprache wählen / Please choose language / Escolha o idioma:',
    service_select: '✨ Bitte wählen Sie Ihren Service:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *DIY Service – €4,99*\n✅ Wir füllen das Abmeldeformular vollständig aus\n✅ Sie erhalten das PDF per E-Mail\n📌 Sie unterschreiben und senden per Post/E-Mail\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Full Service – €39,99*\n✅ Wir füllen das Formular aus\n✅ Offizielle Vollmacht auf Ihren Namen\n✅ Wir versenden direkt ans Bürgeramt\n⚖️ Durch RA Frederico Reichel, Berlin\n━━━━━━━━━━━━━━━━━━━━━\n\nWelchen Service möchten Sie?',
    ask_firstname: '📝 Wie ist Ihr **Vorname**?\n\n_Alle Vornamen, genau wie im Ausweis (z.B. Maria Clara)._',
    ask_lastname: '📝 Wie ist Ihr **Nachname**?\n\n_Alle Nachnamen wie im Ausweis (z.B. Silva Oliveira)._',
    ask_birthdate: '📅 Geburtsdatum?\n\nBitte im Format: TT.MM.JJJJ\nBeispiel: 15.03.1990',
    ask_birthplace: '🏙 Geburtsort?\n\nBeispiel: Berlin',
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
    welcome: '👋 Bem-vindo ao AbmeldeBot!\n\nEu ajudo você com sua baixa de registro em Berlim.\n\nEscolha seu idioma:',
    service_select: '✨ Escolha o seu serviço:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *Serviço DIY – €4,99*\n✅ Preenchemos o formulário completamente (PDF)\n✅ Você recebe por e-mail\n📌 Você assina e envia pelos correios/e-mail\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Serviço Completo – €39,99*\n✅ Preenchemos o formulário\n✅ Procuração oficial em seu nome\n✅ Enviamos diretamente ao Bürgeramt\n⚖️ Adv. Frederico Reichel, Berlim\n━━━━━━━━━━━━━━━━━━━━━\n\nQual serviço você escolhe?',
    ask_firstname: '📝 Qual é seu **primeiro nome** (e outros prenomes)?\n\n_Todos os nomes como no documento. Ex: Maria Clara_',
    ask_lastname: '📝 Qual é seu **sobrenome**?\n\n_Todos os sobrenomes como no documento. Ex: Silva Oliveira_',
    ask_birthdate: '📅 Data de nascimento?\n\nFormato: DD.MM.AAAA\nExemplo: 15.03.1990',
    ask_birthplace: '🏙 Cidade de nascimento?',
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
    welcome: '👋 Welcome to AbmeldeBot!\n\nI help you with deregistration in Berlin.\n\nChoose your language:',
    service_select: '✨ Choose your service:\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 *DIY Service – €4.99*\n✅ We fill the form completely (PDF)\n✅ Sent to your email\n📌 You sign and send by post/email\n\n━━━━━━━━━━━━━━━━━━━━━\n🎯 *Full Service – €39.99*\n✅ We fill the form\n✅ Official power of attorney in your name\n✅ We send directly to the Bürgeramt\n⚖️ RA Frederico Reichel, Berlin\n━━━━━━━━━━━━━━━━━━━━━\n\nWhich service do you choose?',
    ask_firstname: '📝 Your **first name(s)**?\n\n_All given names exactly as in your ID. E.g.: Maria Clara_',
    ask_lastname: '📝 Your **last name(s)**?\n\n_All surnames as in your ID. E.g.: Silva Oliveira_',
    ask_birthdate: '📅 Date of birth?\n\nFormat: DD.MM.YYYY\nExample: 15.03.1990',
    ask_birthplace: '🏙 Place of birth?',
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
        resolve(outputPath);
      } else {
        reject(new Error(stdout || 'Unknown error'));
      }
    });
  });
}

// Send PDF by email
async function sendAbmeldungEmail(toEmail, pdfPath, session) {
  if (!SMTP_HOST) {
    console.log('⚠️  SMTP not configured — skipping email (simulation mode)');
    return { success: true, simulated: true };
  }

  const { data } = session;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const firstName = data.firstName || '';
  const lastName  = data.lastName  || '';
  const orderId   = data.orderId   || '';
  const isDiy     = data.service === 'diy';

  await transporter.sendMail({
    from: `"RA Frederico Reichel – Abmeldung" <${SMTP_FROM}>`,
    to:   toEmail,
    replyTo: FIRM_EMAIL,
    subject: `Ihre Abmeldung – Bestellung ${orderId}`,
    html: `
      <p>Sehr geehrte/r ${firstName} ${lastName},</p>
      <p>im Anhang finden Sie Ihr ausgefülltes Abmeldeformular (Bestellnr.: <strong>${orderId}</strong>).</p>
      ${isDiy ? `
      <p><strong>Nächste Schritte (DIY Service):</strong><br/>
      1. Formular ausdrucken<br/>
      2. Unterschreiben<br/>
      3. Per Post oder E-Mail ans zuständige Bürgeramt senden</p>
      ` : `
      <p>Wir kümmern uns um die Einreichung beim Bürgeramt. Sie müssen nichts weiter tun.</p>
      `}
      <p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
      <p>Mit freundlichen Grüßen,<br/>
      <strong>Rechtsanwalt Frederico Reichel</strong><br/>
      ${FIRM_ADDRESS}<br/>
      <a href="mailto:${FIRM_EMAIL}">${FIRM_EMAIL}</a></p>
    `,
    attachments: [{
      filename: `Abmeldung_${orderId}.pdf`,
      path:     pdfPath,
    }],
  });

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
    const result  = await sendAbmeldungEmail(session.data.email, pdfPath, session);
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
      session.step = 'nationality';
      await ctx.reply(t(session, 'ask_nationality'));
      break;

    case 'nationality':
      session.data.nationality = text;
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
      if (session.data.service === 'full') {
        session.step = 'phone';
        await ctx.reply(t(session, 'ask_phone'));
      } else {
        // DIY: familiares antes da assinatura
        await askFamily(ctx, session);
      }
      break;

    case 'phone':
      session.data.phone = text;
      // Full: familiares antes da assinatura
      await askFamily(ctx, session);
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
      session.data.idFrontImage = base64Image;
      await ctx.reply(t(session, 'id_front_received'));
      session.step = 'id_back';
      await ctx.reply(t(session, 'ask_id_back'));
      break;

    case 'id_back':
      session.data.idBackImage = base64Image;
      await ctx.reply(t(session, 'id_back_received'));
      await askFamily(ctx, session);
      break;
  }
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


// ─── LAUNCH COM RETRY ──────────────────────────────────────────────────────
async function startBot() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('🧹 Webhook limpo');
  } catch(e) { console.log('Webhook cleanup:', e.message); }
  try {
    await bot.launch();
    console.log('✅ AbmeldeBot gestartet!');
    console.log('📱 Jetzt in Telegram: /start');
  } catch(err) {
    if (err.message && err.message.includes('409')) {
      console.log('⚠️ Conflict 409 — aguardando 15s...');
      setTimeout(startBot, 15000);
    } else {
      console.error('❌ Erro:', err.message);
      setTimeout(startBot, 5000);
    }
  }
}
startBot();
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
