// AbmeldeBot - Telegram Bot Version
// Complete implementation with multi-language support

// Load environment variables
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const SP = require('./sharepoint');

// Configuration from environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
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

// External modules
const { NATIONALITY_MAP, normalizeNationality } = require('./nationality');
const { PLZ_MAP, getBezirk } = require('./plz_map');
const translations = require('./translations');
const { getGraphToken, sendAbmeldungEmail } = require('./email');

// Helper functions
function t(session, key) {
  const lang = session.lang || 'de';
  return translations[lang][key] || key;
}

// Tradução IA (fallback para mapa local)
async function translateToGerman(text, context) {
  if (!text || !ANTHROPIC_API_KEY) return text;
  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: `Translate this ${context} to German (single word/phrase only, no explanation): "${text}". Answer only with the German word.` }]
    });
    return await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => { try { const j = JSON.parse(data); resolve(j.content?.[0]?.text?.trim() || text); } catch { resolve(text); } });
      });
      req.on('error', () => resolve(text));
      req.setTimeout(5000, () => { req.destroy(); resolve(text); });
      req.write(body); req.end();
    });
  } catch { return text; }
}

// Gerar Vollmacht PDF via Python
async function generateVollmacht(data) {
  const today = new Date();
  const datum = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
  const pdfData = { Vorname: data.firstName, Nachname: data.lastName, Bezirk: data.bezirk || 'Berlin', Datum: datum };
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
  const session = { chatId, lang: null, step: 'language', data: {} };
  sessions.set(chatId, session);
  return session;
}
function getSession(chatId) { return sessions.get(chatId) || createSession(chatId); }
function deleteSession(chatId) { sessions.delete(chatId); }

// Validators
function isValidDate(dateStr) {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const [, d, m, y] = match.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100;
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function extractPLZ(address) { const m = address.match(/\b(\d{5})\b/); return m ? m[1] : null; }

// Download photo from Telegram
async function downloadPhoto(ctx, fileId) {
  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    return `data:image/jpeg;base64,${Buffer.from(response.data).toString('base64')}`;
  } catch (error) { console.error('Error downloading photo:', error); return null; }
}

// Notify admin
async function notifyAdmin(session) {
  if (!ADMIN_CHAT_ID) return;
  const { data } = session;
  const message = `🔔 **Neue Abmeldung!**\n\n👤 ${data.firstName} ${data.lastName}\n📧 ${data.email}\n📱 ${data.phone || '–'}\n💼 ${data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)'}\n📆 Auszug: ${data.moveOutDate}\n📍 ${data.fullAddress}\n🏛 Bürgeramt: ${data.bezirk}\n\nBestellung: ${data.orderId}`;
  try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' }); }
  catch (error) { console.error('Admin notification error:', error); }
}

// ─── COMMANDS ───────────────────────────────────────────────────────────
bot.command('start', (ctx) => {
  sessions.delete(ctx.chat.id);
  const session = createSession(ctx.chat.id);
  ctx.reply(translations.de.welcome, Markup.inlineKeyboard([
    [Markup.button.callback('🇩🇪 Deutsch', 'lang_de')],
    [Markup.button.callback('🇧🇷 Português', 'lang_pt')],
    [Markup.button.callback('🇬🇧 English', 'lang_en')]
  ]));
});

bot.command('cancel', (ctx) => { const s = getSession(ctx.chat.id); deleteSession(ctx.chat.id); ctx.reply(t(s, 'cancel')); });
bot.command('help', (ctx) => { const s = getSession(ctx.chat.id); ctx.reply(t(s, 'help'), { parse_mode: 'Markdown' }); });

// [TEST] Comando para testes rápidos
bot.command('test', async (ctx) => {
  sessions.delete(ctx.chat.id);
  const session = createSession(ctx.chat.id);
  session.lang = 'pt'; session.step = null;
  session.data = {
    firstName: 'João', lastName: 'Silva', birthDate: '15.03.1990', birthPlace: 'São Paulo',
    gender: 'männlich', nationality: 'Brasilianisch',
    fullAddress: 'Katzbachstr. 18, 10965 Berlin', plz: '10965', bezirk: 'Friedrichshain-Kreuzberg',
    moveOutDate: '31.03.2026', newStreet: 'Rua das Flores 123', newPlzCity: '01310-100 São Paulo',
    newCountry: 'Brasilien', newFullAddress: 'Rua das Flores 123, 01310-100 São Paulo, Brasilien',
    bisherigWohnungTyp: 'Alleinige Wohnung', neueWohnungExistiert: 'nein',
    email: 'test@test.com', phone: '+49 155 12345678', service: 'diy', sigMode: 'self',
    orderId: 'TEST-' + Date.now(),
  };
  await ctx.reply('🧪 *Modo de teste ativado!*\nDados de teste pré-preenchidos.', { parse_mode: 'Markdown' });
  await showSummary(ctx, session);
});

// ─── ACTIONS ────────────────────────────────────────────────────────────
bot.action(/lang_(.+)/, (ctx) => {
  const session = getSession(ctx.chat.id); session.lang = ctx.match[1]; session.step = 'service';
  ctx.answerCbQuery();
  ctx.reply(t(session, 'service_select'), Markup.inlineKeyboard([
    [Markup.button.callback('📝 DIY - €4.99', 'service_diy')],
    [Markup.button.callback('🎯 Full Service - €39.99', 'service_full')]
  ]));
});

bot.action('service_diy', async (ctx) => { const s = getSession(ctx.chat.id); s.data.service = 'diy'; s.step = 'firstname'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_firstname'), { parse_mode: 'Markdown' }); });
bot.action('service_full', async (ctx) => { const s = getSession(ctx.chat.id); s.data.service = 'full'; s.step = 'firstname'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_firstname'), { parse_mode: 'Markdown' }); });

const PAYMENT_URL = {
  full: 'https://business.vivid.money/de/pay/AZyfxze6ftqRjhi9U7NpBw',
  diy:  'https://business.vivid.money/de/pay/AZyfyBwVfGmr-sdU2hwVug'
};

// ─── PDF GENERATION ─────────────────────────────────────────────────────
function generateAbmeldungPdf(session) {
  return new Promise((resolve, reject) => {
    const { data } = session;
    const today = new Date().toLocaleDateString('de-DE');
    const outputPath = path.join(BOT_DIR, 'pdfs', `Abmeldung_${data.orderId}.pdf`);
    const payload = JSON.stringify({
      Nachname: data.lastName, Vorname: data.firstName, Geburtsname: data.birthName || '',
      Geschlecht: data.gender || '', Geburtsdatum: data.birthDate || '', Geburtsort: data.birthPlace || '',
      Staatsangehoerigkeit: data.nationality || '', Strasse: data.fullAddress || '',
      PLZ: data.plz || '', Bezirk: data.bezirk || '', Auszugsdatum: data.moveOutDate || '',
      NeueStrasse: data.newStreet || '', NeuesLand: `${data.newPlzCity || ''} ${data.newCountry || ''}`.trim(),
      BisherigWohnung: data.bisherigWohnungTyp || 'alleinige', NeueWohnungExistiert: data.neueWohnungExistiert || 'nein',
      Datum: today, SignaturBase64: (data.sigMode === 'paste' && data.signatureImage) ? data.signatureImage : '',
      FamilyMembers: data.familyMembers || [],
    });
    const PYTHON3 = process.env.PYTHON_PATH || 'python3';
    const scriptPath = path.join(BOT_DIR, 'fill_abmeldung.py');
    const pyEnv = { ...process.env };
    execFile(PYTHON3, [scriptPath, payload, outputPath], { env: pyEnv }, (err, stdout, stderr) => {
      if (err) { console.error('❌ fill_abmeldung.py error:', stderr); return reject(new Error(stderr || err.message)); }
      if (stdout.startsWith('OK:')) {
        console.log('✅ PDF generated:', outputPath);
        if (data.service === 'full') {
          const vollmachtPath = outputPath.replace('.pdf', '_Vollmacht.pdf');
          const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
          if (fs.existsSync(vollmachtScript)) {
            try {
              const today2 = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
              const vollmachtData = JSON.stringify({
                Vorname: data.firstName, Nachname: data.lastName, Bezirk: data.bezirk || 'Berlin', Datum: today2,
                Geburtsdatum: data.birthDate || '', Adresse: data.fullAddress || '', AuszugDatum: data.moveOutDate || '',
                Language: session.lang || 'de', SignaturBase64: (data.sigMode === 'paste' && data.signatureImage) ? data.signatureImage : '',
              });
              execFileSync(PYTHON3, [vollmachtScript, vollmachtData, vollmachtPath], { env: pyEnv, stdio: 'pipe' });
              session._vollmachtPath = vollmachtPath;
              console.log('✅ Vollmacht gerada:', vollmachtPath, '| lang:', session.lang);
            } catch(ve) { console.error('⚠️ Vollmacht gen error (non-fatal):', ve.message); }
          }
        }
        resolve(outputPath);
      } else { reject(new Error(stdout || 'Unknown error')); }
    });
  });
}

async function buildIdPdf(frontBase64, backBase64, orderId) {
  const tmpDir = path.join(BOT_DIR, 'pdfs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
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
  const pyScript = `\nimport sys, fitz\nargs = sys.argv[1:]\nout = args[-1]\nimgs = args[:-1]\ndoc = fitz.open()\nfor img_path in imgs:\n    page = doc.new_page(width=595, height=842)\n    margin = 20\n    pix = fitz.open(img_path)[0].get_pixmap()\n    iw, ih = pix.width, pix.height\n    aw = 595 - 2*margin\n    ah = 842 - 2*margin\n    scale = min(aw/iw, ah/ih)\n    w, h = iw*scale, ih*scale\n    x0 = margin + (aw-w)/2\n    y0 = margin + (ah-h)/2\n    rect = fitz.Rect(x0, y0, x0+w, y0+h)\n    page.insert_image(rect, filename=img_path, keep_proportion=False)\ndoc.save(out)\nprint('OK')\n`;
  const scriptPath = path.join(tmpDir, `build_id_${orderId}.py`);
  fs.writeFileSync(scriptPath, pyScript);
  await new Promise((resolve, reject) => {
    execFile(PYTHON3, [scriptPath, ...paths, outPath], { timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(scriptPath); } catch(_) {}
      paths.forEach(p => { try { fs.unlinkSync(p); } catch(_) {} });
      if (err) reject(new Error(stderr || err.message)); else resolve();
    });
  });
  const pdfBytes = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch(_) {}
  return pdfBytes;
}

// ─── SEND PDF TO ADMIN ──────────────────────────────────────────────────
async function sendPdfToAdmin(pdfPath, session) {
  if (!ADMIN_CHAT_ID) return;
  const { data } = session;
  try {
    await bot.telegram.sendDocument(ADMIN_CHAT_ID,
      { source: pdfPath, filename: `Abmeldung_${data.orderId}.pdf` },
      { caption: `📄 *${data.firstName} ${data.lastName}* — ${data.orderId}\n📍 ${data.bezirk}\n📧 ${data.email}`, parse_mode: 'Markdown' }
    );
  } catch (err) { console.error('❌ sendPdfToAdmin error:', err.message); }
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────
async function triggerPowerAutomate(session) {
  try {
    const pdfPath = await generateAbmeldungPdf(session);
    await sendPdfToAdmin(pdfPath, session);
    if (session._vollmachtPath && fs.existsSync(session._vollmachtPath)) {
      try { await bot.telegram.sendDocument(ADMIN_CHAT_ID, { source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` }, { caption: `📜 Vollmacht — ${session.data.firstName} ${session.data.lastName}` }); } catch(e) { console.log('Vollmacht admin error:', e.message); }
    }
    if (session.data.anmeldungFileId) { try { await bot.telegram.sendDocument(ADMIN_CHAT_ID, session.data.anmeldungFileId); } catch(e) { console.log('Anmeldung forward error:', e.message); } }
    if (session.data.service === 'full' && session.data.sigMode === 'paste' && session._vollmachtPath && fs.existsSync(session._vollmachtPath)) {
      try {
        const lang = session.lang || 'de';
        const vollmachtCaption = { de: '📜 *Ihre Vollmacht*\n\nBitte unterschreiben und an unser Büro senden.', pt: '📜 *Sua Procuração*\n\nPor favor assine e envie para o nosso escritório.', en: '📜 *Your Power of Attorney*\n\nPlease sign and send to our office.' };
        await session.ctx.replyWithDocument({ source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` }, { caption: vollmachtCaption[lang] || vollmachtCaption['de'], parse_mode: 'Markdown' });
      } catch(e) { console.log('Vollmacht cliente error:', e.message); }
    }
    const result = await sendAbmeldungEmail(session.data.email, pdfPath, session, buildIdPdf);
    const archiveDir = path.join(BOT_DIR, 'pdfs', 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, path.basename(pdfPath));
    try { fs.renameSync(pdfPath, archivePath); console.log('📁 PDF arquivado:', archivePath); } catch (_) {}
    SP.processCaseToSharePoint(session, archivePath, session._vollmachtPath || null, bot).catch(e => console.error('SP non-fatal error:', e.message));
    return result;
  } catch (err) { console.error('❌ PDF/email error:', err.message); return { success: false, error: err.message }; }
}

// ─── PAYMENT CONFIRMED ──────────────────────────────────────────────────
async function handlePaymentConfirmed(ctx, session) {
  if (session.data.nationality && ANTHROPIC_API_KEY) { const natDE = await translateToGerman(session.data.nationality, 'nationality/country name'); if (natDE && natDE !== session.data.nationality) session.data.nationality = natDE; }
  if (session.data.birthPlace && ANTHROPIC_API_KEY) { const bpDE = await translateToGerman(session.data.birthPlace, 'city name'); if (bpDE) session.data.birthPlace = bpDE; }
  const lang = session.lang || 'de';
  session.step = 'done';
  const ackMsgs = {
    de: '✅ *Bestätigt!*\n\n⏳ Wir generieren jetzt Ihr Formular und senden es per E-Mail...\n\nBestellnummer: `' + session.data.orderId + '`',
    pt: '✅ *Confirmado!*\n\n⏳ Estamos gerando seu formulário e enviando por e-mail...\n\nPedido: `' + session.data.orderId + '`',
    en: '✅ *Confirmed!*\n\n⏳ Generating your form and sending by email...\n\nOrder: `' + session.data.orderId + '`'
  };
  await ctx.reply(ackMsgs[lang], { parse_mode: 'Markdown' });
  session.ctx = ctx;
  const result = await triggerPowerAutomate(session);
  const doneMsgs = {
    de: result.success ? '📧 *Fertig!* Das Formular wurde an *' + session.data.email + '* gesendet.' + (result.simulated ? '\n\n_(Simulation)_' : '') : '⚠️ E-Mail konnte nicht gesendet werden. info@rafer.de\nBestellnummer: `' + session.data.orderId + '`',
    pt: result.success ? '📧 *Pronto!* O formulário foi enviado para *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulação)_' : '') : '⚠️ Não foi possível enviar o e-mail. info@rafer.de\nPedido: `' + session.data.orderId + '`',
    en: result.success ? '📧 *Done!* The form was sent to *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulation)_' : '') : '⚠️ Could not send email. info@rafer.de\nOrder: `' + session.data.orderId + '`',
  };
  await ctx.reply(doneMsgs[lang], { parse_mode: 'Markdown' });
  await notifyAdmin(session);
  deleteSession(ctx.chat.id);
}

// ─── HELPERS ────────────────────────────────────────────────────────────
async function askFamily(ctx, session) {
  session.step = 'ask_family';
  await ctx.reply(t(session, 'ask_family'), Markup.inlineKeyboard([
    [Markup.button.callback(t(session, 'family_yes'), 'family_yes')],
    [Markup.button.callback(t(session, 'family_no'), 'family_no')],
  ]));
}
async function askSigMode(ctx, session) {
  session.step = 'sig_mode';
  await ctx.reply(t(session, 'ask_sig_mode'), Markup.inlineKeyboard([
    [Markup.button.callback(t(session, 'sig_mode_self'), 'sig_self')],
    [Markup.button.callback(t(session, 'sig_mode_paste'), 'sig_paste')],
  ]));
}

// ─── BUTTON HANDLERS ────────────────────────────────────────────────────
bot.action('family_no', async (ctx) => { await ctx.answerCbQuery(); await askSigMode(ctx, getSession(ctx.chat.id)); });
bot.action('family_yes', async (ctx) => { const s = getSession(ctx.chat.id); if (!s.data.familyMembers) s.data.familyMembers = []; s.step = 'family_name'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_name').replace('{n}', s.data.familyMembers.length + 1)); });
bot.action('family_add_more', async (ctx) => { const s = getSession(ctx.chat.id); if (s.data.familyMembers && s.data.familyMembers.length >= 2) { await ctx.answerCbQuery(); await askSigMode(ctx, s); return; } s.step = 'family_name'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_name').replace('{n}', (s.data.familyMembers || []).length + 1)); });
bot.action('family_done', async (ctx) => { await ctx.answerCbQuery(); await askSigMode(ctx, getSession(ctx.chat.id)); });
bot.action('sig_self', async (ctx) => { const s = getSession(ctx.chat.id); s.data.sigMode = 'self'; await ctx.answerCbQuery(); await showSummary(ctx, s); });
bot.action('sig_paste', async (ctx) => { const s = getSession(ctx.chat.id); s.data.sigMode = 'paste'; s.step = 'signature'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_signature')); });
bot.action(/wtyp_(.+)/, async (ctx) => { const s = getSession(ctx.chat.id); s.data.bisherigWohnungTyp = ctx.match[1].charAt(0).toUpperCase() + ctx.match[1].slice(1); s.step = 'neue_existiert'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_neue_existiert'), Markup.inlineKeyboard([[Markup.button.callback(t(s,'neue_nein'),'nexist_nein')],[Markup.button.callback(t(s,'neue_haupt'),'nexist_haupt')],[Markup.button.callback(t(s,'neue_neben'),'nexist_neben')]])); });
bot.action(/nexist_(.+)/, async (ctx) => { const s = getSession(ctx.chat.id); const map = { nein: 'nein', haupt: 'Hauptwohnung', neben: 'Nebenwohnung' }; s.data.neueWohnungExistiert = map[ctx.match[1]] || 'nein'; s.step = 'email'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_email')); });
bot.action(/gender_([mfd])/, async (ctx) => { const s = getSession(ctx.chat.id); const map = { m: 'männlich', f: 'weiblich', d: 'divers' }; s.data.gender = map[ctx.match[1]]; s.step = 'nationality'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_nationality')); });
bot.action('summary_correct', async (ctx) => {
  const s = getSession(ctx.chat.id); await ctx.answerCbQuery();
  const lang = s.lang || 'de';
  s.data.orderId = 'AB' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
  const simMsgs = { de: '🧪 *Simulation* — Zahlung wird übersprungen...', pt: '🧪 *Simulação* — Pagamento ignorado...', en: '🧪 *Simulation* — Payment skipped...' };
  await ctx.reply(simMsgs[lang], { parse_mode: 'Markdown' });
  await handlePaymentConfirmed(ctx, s);
});
bot.action('summary_wrong', async (ctx) => {
  const s = getSession(ctx.chat.id); await ctx.answerCbQuery();
  await ctx.reply(t(s, 'correct_which'), Markup.inlineKeyboard([
    [Markup.button.callback(t(s,'correct_firstname'),'corr_firstname'), Markup.button.callback(t(s,'correct_lastname'),'corr_lastname')],
    [Markup.button.callback(t(s,'correct_birthdate'),'corr_birthdate'), Markup.button.callback(t(s,'correct_birthplace'),'corr_birthplace')],
    [Markup.button.callback(t(s,'correct_nationality'),'corr_nationality')],
    [Markup.button.callback(t(s,'correct_address'),'corr_address')],
    [Markup.button.callback(t(s,'correct_moveout'),'corr_moveout')],
    [Markup.button.callback(t(s,'correct_newaddress'),'corr_newaddress')],
    [Markup.button.callback(t(s,'correct_email'),'corr_email'), Markup.button.callback(t(s,'correct_phone'),'corr_phone')],
  ]));
});
const CORR_FIELD_MAP = { firstname:{key:'firstName'}, lastname:{key:'lastName'}, birthdate:{key:'birthDate'}, birthplace:{key:'birthPlace'}, nationality:{key:'nationality'}, address:{key:'fullAddress'}, moveout:{key:'moveOutDate'}, newaddress:{key:'newFullAddress'}, email:{key:'email'}, phone:{key:'phone'} };
bot.action(/corr_(.+)/, async (ctx) => { const s = getSession(ctx.chat.id); const field = ctx.match[1]; if (!CORR_FIELD_MAP[field]) return ctx.answerCbQuery(); s.step = `corr_${field}`; await ctx.answerCbQuery(); await ctx.reply(t(s, 'correct_enter_new')); });
bot.action('skip_anmeldung', async (ctx) => { await ctx.answerCbQuery(); await askFamily(ctx, getSession(ctx.chat.id)); });

// ─── TEXT HANDLER ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  if (session.step === 'awaiting_payment') { await handlePaymentConfirmed(ctx, session); return; }
  if (session.step === 'corr_newaddress_plzcity') { session.data.newPlzCity = text; session.step = 'corr_newaddress_country'; await ctx.reply(t(session, 'ask_newaddress_country')); return; }
  if (session.step === 'corr_newaddress_country') { session.data.newCountry = text; session.data.newFullAddress = `${session.data.newStreet}, ${session.data.newPlzCity}, ${session.data.newCountry}`; session.step = null; await ctx.reply('✅'); await showSummary(ctx, session); return; }
  if (session.step && session.step.startsWith('corr_')) {
    const field = session.step.replace('corr_', ''); const info = CORR_FIELD_MAP[field];
    if (info) {
      if ((field === 'birthdate' || field === 'moveout') && !isValidDate(text)) { await ctx.reply(t(session, 'invalid_date')); return; }
      if (field === 'email' && !isValidEmail(text)) { await ctx.reply(t(session, 'invalid_email')); return; }
      if (field === 'address') { const plz = extractPLZ(text); if (!plz || !PLZ_MAP[plz]) { await ctx.reply(t(session, 'invalid_plz')); return; } session.data.fullAddress = text; session.data.plz = plz; session.data.bezirk = getBezirk(plz); }
      else if (field === 'newaddress') { session.data.newStreet = text; session.step = 'corr_newaddress_plzcity'; await ctx.reply(t(session, 'ask_newaddress_plzcity')); return; }
      else { session.data[info.key] = text; }
      await ctx.reply('✅'); await showSummary(ctx, session); return;
    }
  }
  switch (session.step) {
    case 'firstname': session.data.firstName = text; session.step = 'lastname'; await ctx.reply(t(session, 'ask_lastname'), { parse_mode: 'Markdown' }); break;
    case 'lastname': session.data.lastName = text; session.step = 'birthdate'; await ctx.reply(t(session, 'ask_birthdate')); break;
    case 'birthdate': if (!isValidDate(text)) { await ctx.reply(t(session, 'invalid_date')); return; } session.data.birthDate = text; session.step = 'birthplace'; await ctx.reply(t(session, 'ask_birthplace')); break;
    case 'birthplace': session.data.birthPlace = text; session.step = 'gender'; await ctx.reply(t(session, 'ask_gender'), Markup.inlineKeyboard([[Markup.button.callback('♂ männlich / masculino / male','gender_m')],[Markup.button.callback('♀ weiblich / feminino / female','gender_f')],[Markup.button.callback('⚧ divers / outro / other','gender_d')]])); break;
    case 'gender': session.data.gender = text; session.step = 'nationality'; await ctx.reply(t(session, 'ask_nationality')); break;
    case 'nationality': session.data.nationality = normalizeNationality(text); session.step = 'address'; await ctx.reply(t(session, 'ask_address')); break;
    case 'address': { const plz = extractPLZ(text); if (!plz || !PLZ_MAP[plz]) { await ctx.reply(t(session, 'invalid_plz')); return; } session.data.fullAddress = text; session.data.plz = plz; session.data.bezirk = getBezirk(plz); session.step = 'moveout'; await ctx.reply(t(session, 'ask_moveout')); break; }
    case 'moveout': if (!isValidDate(text)) { await ctx.reply(t(session, 'invalid_date')); return; } session.data.moveOutDate = text; session.step = 'newaddress_street'; await ctx.reply(t(session, 'ask_newaddress_street')); break;
    case 'newaddress_street': session.data.newStreet = text; session.step = 'newaddress_plzcity'; await ctx.reply(t(session, 'ask_newaddress_plzcity')); break;
    case 'newaddress_plzcity': session.data.newPlzCity = text; session.step = 'newaddress_country'; await ctx.reply(t(session, 'ask_newaddress_country')); break;
    case 'newaddress_country': session.data.newCountry = text; session.data.newFullAddress = `${session.data.newStreet}, ${session.data.newPlzCity}, ${session.data.newCountry}`; session.step = 'wohnungtyp'; await ctx.reply(t(session, 'ask_wohnungtyp'), Markup.inlineKeyboard([[Markup.button.callback(t(session,'wohnungtyp_alleinige'),'wtyp_alleinige')],[Markup.button.callback(t(session,'wohnungtyp_haupt'),'wtyp_haupt')],[Markup.button.callback(t(session,'wohnungtyp_neben'),'wtyp_neben')]])); break;
    case 'email': if (!isValidEmail(text)) { await ctx.reply(t(session, 'invalid_email')); return; } session.data.email = text; session.step = 'phone'; await ctx.reply(t(session, 'ask_phone')); break;
    case 'phone': session.data.phone = text; session.step = 'id_front'; await ctx.reply(t(session, 'ask_id_front')); break;
    case 'family_name': if (!session.data.familyMembers) session.data.familyMembers = []; session.data.familyMembers.push(text); { const canAdd = session.data.familyMembers.length < 2; await ctx.reply(`✅ ${text}`, canAdd ? Markup.inlineKeyboard([[Markup.button.callback(t(session,'family_add_more'),'family_add_more')],[Markup.button.callback(t(session,'family_done'),'family_done')]]) : Markup.inlineKeyboard([[Markup.button.callback(t(session,'family_done'),'family_done')]])); } break;
  }
});

// ─── PHOTO HANDLER ──────────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (session.step === 'awaiting_payment') { await handlePaymentConfirmed(ctx, session); return; }
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  ctx.reply(t(session, 'processing'));
  const base64Image = await downloadPhoto(ctx, photo.file_id);
  if (!base64Image) { await ctx.reply(t(session, 'error_photo')); return; }
  switch (session.step) {
    case 'signature': session.data.signatureImage = base64Image; await ctx.reply(t(session, 'signature_received')); await showSummary(ctx, session); break;
    case 'id_front': session.data.idFrontImage = base64Image; session.data.idFrontFileId = photo.file_id; await ctx.reply(t(session, 'id_front_received')); session.step = 'id_back'; await ctx.reply(t(session, 'ask_id_back')); break;
    case 'id_back': session.data.idBackImage = base64Image; session.data.idBackFileId = photo.file_id; await ctx.reply(t(session, 'id_back_received')); session.step = 'anmeldung'; await ctx.reply(t(session, 'ask_anmeldung'), Markup.inlineKeyboard([[Markup.button.callback(t(session,'skip_doc'),'skip_anmeldung')]])); break;
    case 'anmeldung': { const afid = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length-1].file_id : null; if (afid) { session.data.anmeldungFileId = afid; await ctx.reply('✅ Anmeldung recebida!'); } await askFamily(ctx, session); break; }
  }
});

// ─── DOCUMENT HANDLER ───────────────────────────────────────────────────
bot.on('document', async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session || !session.step) return;
  const doc = ctx.message.document;
  const mime = doc.mime_type || '';
  const isImage = mime.startsWith('image/'); const isPdf = mime === 'application/pdf';
  if (!isImage && !isPdf) { await ctx.reply(t(session, 'error_photo') + ' (JPEG/PNG/PDF)'); return; }
  ctx.reply(t(session, 'processing'));
  let base64Image = null;
  if (isImage) { base64Image = await downloadPhoto(ctx, doc.file_id); }
  else if (isPdf) {
    try {
      const PYTHON3 = process.env.PYTHON_PATH || 'python3';
      const tmpPdf = path.join(BOT_DIR, 'pdfs', 'tmp_' + doc.file_id.slice(-8) + '.pdf');
      const tmpPng = tmpPdf.replace('.pdf', '.png');
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const resp = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      fs.writeFileSync(tmpPdf, Buffer.from(resp.data));
      execFileSync(PYTHON3, ['-c', "import fitz,sys; d=fitz.open(sys.argv[1]); mat=fitz.Matrix(2,2); pix=d[0].get_pixmap(matrix=mat); pix.save(sys.argv[2]); print('OK')", tmpPdf, tmpPng], { timeout: 20000 });
      base64Image = fs.readFileSync(tmpPng).toString('base64');
      try { fs.unlinkSync(tmpPdf); fs.unlinkSync(tmpPng); } catch(_) {}
    } catch(e) { console.error('PDF->image error:', e.message); await ctx.reply('❌ Erro ao processar PDF.'); return; }
  }
  if (!base64Image) { await ctx.reply(t(session, 'error_photo')); return; }
  switch (session.step) {
    case 'signature': session.data.signatureImage = base64Image; await ctx.reply(t(session, 'signature_received')); await showSummary(ctx, session); break;
    case 'id_front': session.data.idFrontImage = base64Image; session.data.idFrontFileId = doc.file_id; await ctx.reply(t(session, 'id_front_received')); session.step = 'id_back'; await ctx.reply(t(session, 'ask_id_back')); break;
    case 'id_back': session.data.idBackImage = base64Image; session.data.idBackFileId = doc.file_id; await ctx.reply(t(session, 'id_back_received')); session.step = 'anmeldung'; await ctx.reply(t(session, 'ask_anmeldung'), Markup.inlineKeyboard([[Markup.button.callback(t(session,'skip_doc'),'skip_anmeldung')]])); break;
    case 'anmeldung': session.data.anmeldungFileId = doc.file_id; await ctx.reply('✅ Anmeldung recebida!'); await askFamily(ctx, session); break;
    case 'vollmacht': session.data.vollmachtFileId = doc.file_id; await ctx.reply('✅ Vollmacht recebida!'); session.ctx = ctx; await triggerPowerAutomate(session); await ctx.reply(t(session, 'done_message')); session.step = 'done'; break;
  }
});

// ─── SHOW SUMMARY ───────────────────────────────────────────────────────
async function showSummary(ctx, session) {
  const { data } = session;
  const serviceLabel = data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)';
  const newAddr = data.newFullAddress || [data.newStreet, data.newPlzCity, data.newCountry].filter(Boolean).join(', ');
  let familySummary = '';
  if (data.familyMembers && data.familyMembers.length > 0) { familySummary = '👨‍👩‍👧 Familienmitglieder:\n' + data.familyMembers.map((m, i) => `  ${i+2}. ${m}`).join('\n') + '\n\n'; }
  const summary = t(session, 'summary')
    .replace('{firstName}', data.firstName || '–').replace('{lastName}', data.lastName || '–')
    .replace('{birthDate}', data.birthDate || '–').replace('{birthPlace}', data.birthPlace || '–')
    .replace('{nationality}', data.nationality || '–').replace('{address}', data.fullAddress || '–')
    .replace('{bezirk}', data.bezirk || '–').replace('{moveOutDate}', data.moveOutDate || '–')
    .replace('{newAddress}', newAddr || '–').replace('{email}', data.email || '–')
    .replace('{phone}', data.phone || '–').replace('{familySummary}', familySummary)
    .replace('{service}', serviceLabel);
  await ctx.reply(summary, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback(t(session, 'summary_correct'), 'summary_correct')],
    [Markup.button.callback(t(session, 'summary_wrong'), 'summary_wrong')],
  ]) });
}

// ─── ERROR HANDLING & LAUNCH ────────────────────────────────────────────
bot.catch((err, ctx) => {
  if (err.message && err.message.includes('query is too old')) return;
  if (err.response && err.response.description && err.response.description.includes('query ID is invalid')) return;
  console.error('Bot error:', err);
  try { ctx.reply('❌ Fehler. Bitte /start'); } catch(_) {}
});

async function startBot() {
  console.log('🤖 AbmeldeBot iniciando...');
  try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); console.log('🧹 Webhook limpo'); } catch(e) {}
  try {
    await bot.launch({ dropPendingUpdates: true, allowedUpdates: ['message', 'callback_query'] });
    console.log('✅ AbmeldeBot gestartet!'); console.log('📱 Jetzt in Telegram: /start');
  } catch(err) {
    if (err.message && err.message.includes('409')) { console.log('⚠️ 409 — saindo...'); process.exit(0); }
    console.error('❌ Erro:', err.message); process.exit(0);
  }
}
startBot();
process.once('SIGINT', () => { console.log('SIGINT'); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { console.log('SIGTERM'); bot.stop('SIGTERM'); });
