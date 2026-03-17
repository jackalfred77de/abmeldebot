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
const { NATIONALITY_MAP, normalizeNationality, normalizeBirthPlace } = require('./nationality');
const { PLZ_MAP, getBezirk } = require('./plz_map');
const translations = require('./translations');
const { getGraphToken, sendAbmeldungEmail } = require('./email');
const { startServer } = require('./server');
const { startInboxMonitor } = require('./inbox_monitor');

// Helper functions
function t(session, key) {
  const lang = session.lang || 'de';
  return translations[lang][key] || key;
}

// DSGVO: Anthropic API removed — using local dictionaries only (nationality.js)

// Gerar Vollmacht PDF via Python
// Build pyEnv helper — ensures PYTHONPATH includes Python package dirs
function getPyEnv() {
  const localPkgDir = path.join(BOT_DIR, '.python_packages');
  const persistentPkgDir = '/home/python_packages'; // Azure persistent path
  return { ...process.env, PYTHONPATH: [persistentPkgDir, localPkgDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':') };
}

async function generateVollmacht(data) {
  const today = new Date();
  const datum = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
  const pdfData = { Vorname: data.firstName, Nachname: data.lastName, Bezirk: data.bezirk || 'Berlin', Datum: datum };
  const orderId = data.orderId || ('AB' + Date.now());
  const outPath = path.join(BOT_DIR, 'pdfs', `Vollmacht_${orderId}.pdf`);
  const pythonScript = path.join(BOT_DIR, 'fill_abmeldung.py');
  const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';
  return new Promise((resolve, reject) => {
    execFile(PYTHON_PATH, [pythonScript, JSON.stringify(pdfData), outPath, 'vollmacht'], {timeout: 30000, env: getPyEnv()}, (err, stdout, stderr) => {
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
  const deliveryInfo = data.deliveryMethod === 'post' ? `📮 Post (+€15,00)${data.postalAddress ? ' → ' + data.postalAddress : ''}` : '📧 E-Mail';
  const totalPrice = data.totalPrice ? `€${data.totalPrice.toFixed(2)}` : (data.service === 'full' ? '€39.99' : '€4.99');
  const message = `🔔 **Neue Abmeldung!**\n\n👤 ${data.firstName} ${data.lastName}\n📧 ${data.email}\n📱 ${data.phone || '–'}\n💼 ${data.service === 'full' ? 'Full Service' : 'DIY'}\n📬 Zustellung: ${deliveryInfo}\n💰 Gesamt: ${totalPrice}\n📆 Auszug: ${data.moveOutDate}\n📍 ${data.fullAddress}\n🏛 Bürgeramt: ${data.bezirk}\n\nBestellung: ${data.orderId}`;
  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    // Action buttons for admin
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, `⚡ Aktion für ${data.orderId}:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Genehmigen', callback_data: `admin_approve_${data.orderId}` },
            { text: '❌ Ablehnen', callback_data: `admin_reject_${data.orderId}` },
          ],
          [
            { text: '⏸ Zurückstellen', callback_data: `admin_hold_${data.orderId}` },
          ]
        ]
      }
    });
  }
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

// ─── ADMIN COMMANDS ──────────────────────────────────────────────────────
bot.command('cases', async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return;
  try {
    const cases = await SP.listCases();
    const pending = cases.filter(c => ['pending_review', 'email_sent', 'on_hold'].includes(c.Status));
    if (pending.length === 0) { await ctx.reply('📋 Keine offenen F\u00e4lle.'); return; }
    const lines = pending.map(c =>
      `\u2022 *${c.Title}* \u2014 ${c.ClientName} (${c.Service}) \u2014 ${c.Bezirk} \u2014 _${c.Status}_`
    ).join('\n');
    await ctx.reply(`📋 *Offene F\u00e4lle (${pending.length}):*\n\n${lines}`, { parse_mode: 'Markdown' });
  } catch(e) { await ctx.reply('\u274c Fehler: ' + e.message); }
});

bot.command('case', async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const orderId = (ctx.message.text || '').split(/\s+/)[1];
  if (!orderId) { await ctx.reply('Verwendung: /case ORDERID'); return; }
  try {
    const c = await SP.getCase(orderId);
    if (!c) { await ctx.reply(`\u274c Fall ${orderId} nicht gefunden`); return; }
    const detail = `📋 *Fall ${c.Title}*\n\n` +
      `👤 ${c.ClientName}\n📧 ${c.Email}\n📱 ${c.Phone || '\u2013'}\n` +
      `💼 ${c.Service}\n📍 ${c.BerlinAddress}\n🏛 ${c.Bezirk}\n` +
      `📆 Auszug: ${c.MoveOutDate}\n🌍 Neue Adresse: ${c.NewAddress}\n` +
      `🔖 Status: *${c.Status}*\n📅 Erstellt: ${c.CreatedAt}\n` +
      (c.AbmeldungUrl ? `📄 [Abmeldung PDF](${c.AbmeldungUrl})\n` : '') +
      (c.VollmachtUrl ? `📜 [Vollmacht](${c.VollmachtUrl})\n` : '') +
      (c.Notes ? `\n📝 Notizen: ${c.Notes}` : '');
    await ctx.reply(detail, { parse_mode: 'Markdown', disable_web_page_preview: true });
    if (['pending_review', 'email_sent', 'on_hold'].includes(c.Status)) {
      await ctx.reply(`\u26a1 Aktion f\u00fcr ${orderId}:`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '\u2705 Genehmigen', callback_data: `admin_approve_${orderId}` },
              { text: '\u274c Ablehnen', callback_data: `admin_reject_${orderId}` },
            ],
            [{ text: '\u23f8 Zur\u00fcckstellen', callback_data: `admin_hold_${orderId}` }]
          ]
        }
      });
    }
  } catch(e) { await ctx.reply('\u274c Fehler: ' + e.message); }
});

// [TEST] Comando para testes rápidos
// /test       → DIY, sigMode self, vai direto ao resumo
// /test sig   → Full, sigMode paste, pede foto da assinatura
bot.command('test', async (ctx) => {
  sessions.delete(ctx.chat.id);
  const session = createSession(ctx.chat.id);
  session.lang = 'pt';
  const arg = (ctx.message.text || '').split(/\s+/)[1] || '';
  const wantSig = arg.toLowerCase() === 'sig';
  session.data = {
    firstName: 'João', lastName: 'Silva', birthDate: '15.03.1990', birthPlace: 'São Paulo', birthCountry: 'Brasilien',
    gender: 'männlich', nationality: 'Brasilianisch',
    fullAddress: 'Katzbachstr. 18, 10965 Berlin', plz: '10965', bezirk: 'Friedrichshain-Kreuzberg',
    moveOutDate: '31.03.2026', newStreet: 'Rua das Flores 123', newPlzCity: '01310-100 São Paulo',
    newCountry: 'Brasilien', newFullAddress: 'Rua das Flores 123, 01310-100 São Paulo, Brasilien',
    bisherigWohnungTyp: 'Alleinige Wohnung', neueWohnungExistiert: 'nein',
    email: 'f.reichel@rafer.de', phone: '+49 155 60245902',
    service: wantSig ? 'full' : 'diy',
    sigMode: wantSig ? 'paste' : 'self',
    deliveryMethod: 'email', postalAddress: '', postalFee: 0,
    orderId: 'TEST-' + Date.now(),
  };
  if (arg.toLowerCase() === 'delivery') {
    session.step = 'delivery_method';
    await ctx.reply('🧪 *Modo de teste (Delivery)*\nDados pré-preenchidos até telefone.', { parse_mode: 'Markdown' });
    await ctx.reply(t(session, 'ask_delivery_method'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(t(session, 'delivery_email_btn'), 'delivery_email')],[Markup.button.callback(t(session, 'delivery_post_btn'), 'delivery_post')]]) });
  } else if (wantSig) {
    session.step = 'signature';
    await ctx.reply('🧪 *Modo de teste (Full + assinatura)*\nDados pré-preenchidos.\n\n✍️ Envie agora uma *foto da sua assinatura*.', { parse_mode: 'Markdown' });
  } else {
    session.step = null;
    await ctx.reply('🧪 *Modo de teste (DIY)*\nDados de teste pré-preenchidos.', { parse_mode: 'Markdown' });
    await showSummary(ctx, session);
  }
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

bot.action('service_diy', async (ctx) => { const s = getSession(ctx.chat.id); s.data.service = 'diy'; s.step = 'consent'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'privacy_consent'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(t(s, 'consent_yes'), 'consent_yes')],[Markup.button.callback(t(s, 'consent_no'), 'consent_no')]]) }); });
bot.action('service_full', async (ctx) => { const s = getSession(ctx.chat.id); s.data.service = 'full'; s.step = 'consent'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'privacy_consent'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(t(s, 'consent_yes'), 'consent_yes')],[Markup.button.callback(t(s, 'consent_no'), 'consent_no')]]) }); });
bot.action('consent_yes', async (ctx) => { const s = getSession(ctx.chat.id); s.data.consentGiven = true; s.data.consentAt = new Date().toISOString(); s.step = 'firstname'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_firstname'), { parse_mode: 'Markdown' }); });
bot.action('consent_no', async (ctx) => { const s = getSession(ctx.chat.id); await ctx.answerCbQuery(); await ctx.reply(t(s, 'consent_declined'), { parse_mode: 'Markdown' }); deleteSession(ctx.chat.id); });

const PAYMENT_URL = {
  full: 'https://business.vivid.money/de/pay/AZyfxze6ftqRjhi9U7NpBw',
  diy:  'https://business.vivid.money/de/pay/AZyfyBwVfGmr-sdU2hwVug'
};

// ─── PDF GENERATION ─────────────────────────────────────────────────────
function generateAbmeldungPdf(session) {
  return new Promise(async (resolve, reject) => {
    try {
      const { data } = session;
      const today = new Date().toLocaleDateString('de-DE');
      const PYTHON3 = process.env.PYTHON_PATH || 'python3';
      const scriptPath = path.join(BOT_DIR, 'fill_abmeldung.py');
      const pyEnv = getPyEnv();
      console.log('🐍 Python exec:', PYTHON3, '| PYTHONPATH:', pyEnv.PYTHONPATH);

      const allFamily = data.familyMembers || [];
      // Split into chunks of 2 (form has Person 1 + 2 family slots)
      const familyChunks = [];
      for (let i = 0; i < allFamily.length; i += 2) { familyChunks.push(allFamily.slice(i, i + 2)); }
      if (familyChunks.length === 0) familyChunks.push([]); // at least one form

      const generatedPaths = [];
      for (let ci = 0; ci < familyChunks.length; ci++) {
        const suffix = familyChunks.length > 1 ? `_Teil${ci + 1}` : '';
        const outputPath = path.join(BOT_DIR, 'pdfs', `Abmeldung_${data.orderId}${suffix}.pdf`);
        const payload = JSON.stringify({
          Nachname: data.lastName, Vorname: data.firstName, Geburtsname: data.birthName || '',
          Geschlecht: data.gender || '', Geburtsdatum: data.birthDate || '', Geburtsort: data.birthPlace || '', Geburtsland: data.birthCountry || '',
          Staatsangehoerigkeit: data.nationality || '', Strasse: data.fullAddress || '',
          PLZ: data.plz || '', Bezirk: data.bezirk || '', Auszugsdatum: data.moveOutDate || '',
          NeueStrasse: data.newStreet || '', NeuesLand: `${data.newPlzCity || ''} ${data.newCountry || ''}`.trim(),
          BisherigWohnung: data.bisherigWohnungTyp || 'alleinige', NeueWohnungExistiert: data.neueWohnungExistiert || 'nein',
          Datum: today, SignaturBase64: (data.sigMode === 'paste' && data.signatureImage) ? data.signatureImage : '',
          FamilyMembers: familyChunks[ci],
        });
        const result = await new Promise((res, rej) => {
          execFile(PYTHON3, [scriptPath, payload, outputPath], { env: pyEnv }, (err, stdout, stderr) => {
            if (err) { console.error('❌ fill_abmeldung.py error:', stderr); return rej(new Error(stderr || err.message)); }
            if (stdout.startsWith('OK:')) { console.log('✅ PDF generated:', outputPath); res(outputPath); }
            else { rej(new Error(stdout || 'Unknown error')); }
          });
        });
        generatedPaths.push(result);
      }

      if (familyChunks.length > 1) {
        console.log(`📄 Generated ${generatedPaths.length} Abmeldung forms for ${allFamily.length} family members`);
        session._extraAbmeldungPaths = generatedPaths.slice(1); // extra forms beyond the first
      }

      // Vollmacht (Full Service)
      if (data.service === 'full') {
        const vollmachtPath = generatedPaths[0].replace('.pdf', '_Vollmacht.pdf').replace('_Teil1', '');
        const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
        if (fs.existsSync(vollmachtScript)) {
          try {
            const today2 = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const vollmachtData = JSON.stringify({
              Vorname: data.firstName, Nachname: data.lastName, Bezirk: data.bezirk || 'Berlin', Datum: today2,
              Geburtsdatum: data.birthDate || '', Adresse: data.fullAddress || '', AuszugDatum: data.moveOutDate || '',
              Language: session.lang || 'de', SignaturBase64: (data.sigMode === 'paste' && data.signatureImage) ? data.signatureImage : '',
            });
            execFileSync(PYTHON3, [vollmachtScript, vollmachtData, vollmachtPath], { env: getPyEnv(), stdio: 'pipe' });
            session._vollmachtPath = vollmachtPath;
            console.log('✅ Vollmacht gerada:', vollmachtPath, '| lang:', session.lang);
          } catch(ve) { console.error('⚠️ Vollmacht gen error (non-fatal):', ve.message); }
        }
      }
      resolve(generatedPaths[0]);
    } catch (e) { reject(e); }
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
    execFile(PYTHON3, [scriptPath, ...paths, outPath], { timeout: 30000, env: getPyEnv() }, (err, stdout, stderr) => {
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
    // Send extra Abmeldung forms (for families >3 people)
    if (session._extraAbmeldungPaths && session._extraAbmeldungPaths.length > 0) {
      for (let i = 0; i < session._extraAbmeldungPaths.length; i++) {
        const extraPath = session._extraAbmeldungPaths[i];
        if (fs.existsSync(extraPath)) {
          try { await bot.telegram.sendDocument(ADMIN_CHAT_ID, { source: extraPath, filename: path.basename(extraPath) }, { caption: `📋 Abmeldung Anlage ${i + 2} — ${session.data.firstName} ${session.data.lastName}` }); } catch(e) { console.log('Extra form admin error:', e.message); }
        }
      }
    }
    if (session._vollmachtPath && fs.existsSync(session._vollmachtPath)) {
      try { await bot.telegram.sendDocument(ADMIN_CHAT_ID, { source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` }, { caption: `📜 Vollmacht — ${session.data.firstName} ${session.data.lastName}` }); } catch(e) { console.log('Vollmacht admin error:', e.message); }
    }
    if (session.data.anmeldungFileId) { try { await bot.telegram.sendDocument(ADMIN_CHAT_ID, session.data.anmeldungFileId); } catch(e) { console.log('Anmeldung forward error:', e.message); } }
    // Send Vollmacht to client for Full Service (both sig modes)
    if (session.data.service === 'full' && session._vollmachtPath && fs.existsSync(session._vollmachtPath) && String(session.chatId) !== String(ADMIN_CHAT_ID)) {
      try {
        const lang = session.lang || 'de';
        if (session.data.sigMode === 'self') {
          // self-sign: send unsigned Vollmacht, ask client to sign and return it
          await session.ctx.replyWithDocument({ source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` }, { caption: t(session, 'ask_vollmacht_return'), parse_mode: 'Markdown' });
          // Pause flow — wait for signed Vollmacht before proceeding with email+SP
          session.step = 'vollmacht_return';
          session._pendingPdfPath = pdfPath; // save for later use in completeAfterVollmacht
          return { success: true, pending_vollmacht: true };
        } else {
          // paste mode: signature already embedded, just inform client
          const vollmachtCaption = { de: '📜 *Ihre Vollmacht*\n\nBitte unterschreiben und an unser Büro senden.', pt: '📜 *Sua Procuração*\n\nPor favor assine e envie para o nosso escritório.', en: '📜 *Your Power of Attorney*\n\nPlease sign and send to our office.' };
          await session.ctx.replyWithDocument({ source: session._vollmachtPath, filename: `Vollmacht_${session.data.orderId}.pdf` }, { caption: vollmachtCaption[lang] || vollmachtCaption['de'], parse_mode: 'Markdown' });
        }
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

// ─── COMPLETE AFTER VOLLMACHT RETURN ────────────────────────────────────────
async function completeAfterVollmacht(ctx, session) {
  try {
    session.ctx = ctx;
    const pdfPath = session._pendingPdfPath;
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      console.error('❌ completeAfterVollmacht: pendingPdfPath missing or file gone');
      await ctx.reply(t(session, 'error_general'));
      return;
    }
    // Forward signed Vollmacht to admin
    if (session.data.signedVollmachtFileId && ADMIN_CHAT_ID) {
      try {
        await bot.telegram.sendDocument(ADMIN_CHAT_ID, session.data.signedVollmachtFileId, {
          caption: `✅ Unterschriebene Vollmacht — ${session.data.firstName} ${session.data.lastName} (${session.data.orderId})`
        });
      } catch(e) { console.log('Signed Vollmacht admin forward error:', e.message); }
    }
    // Continue with email + SharePoint (same as triggerPowerAutomate tail)
    const result = await sendAbmeldungEmail(session.data.email, pdfPath, session, buildIdPdf);
    const archiveDir = path.join(BOT_DIR, 'pdfs', 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, path.basename(pdfPath));
    try { fs.renameSync(pdfPath, archivePath); console.log('📁 PDF arquivado:', archivePath); } catch (_) {}
    SP.processCaseToSharePoint(session, archivePath, session._vollmachtPath || null, bot).catch(e => console.error('SP non-fatal error:', e.message));
    const lang = session.lang || 'de';
    const doneMsgs = {
      de: result.success ? '📧 *Fertig!* Das Formular wurde an *' + session.data.email + '* gesendet.' + (result.simulated ? '\n\n_(Simulation)_' : '') : '⚠️ E-Mail konnte nicht gesendet werden. info@rafer.de\nBestellnummer: `' + session.data.orderId + '`',
      pt: result.success ? '📧 *Pronto!* O formulário foi enviado para *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulação)_' : '') : '⚠️ Não foi possível enviar o e-mail. info@rafer.de\nPedido: `' + session.data.orderId + '`',
      en: result.success ? '📧 *Done!* The form was sent to *' + session.data.email + '*.' + (result.simulated ? '\n\n_(Simulation)_' : '') : '⚠️ Could not send email. info@rafer.de\nOrder: `' + session.data.orderId + '`',
    };
    await ctx.reply(doneMsgs[lang], { parse_mode: 'Markdown' });
    await notifyAdmin(session);
    session.step = 'done';
    deleteSession(ctx.chat.id);
  } catch(err) {
    console.error('❌ completeAfterVollmacht error:', err.message);
    await ctx.reply(t(session, 'error_general'));
  }
}

// ─── PAYMENT CONFIRMED ──────────────────────────────────────────────────
async function handlePaymentConfirmed(ctx, session) {
  // DSGVO: local dictionary normalization (no external API calls)
  if (session.data.nationality) session.data.nationality = normalizeNationality(session.data.nationality);
  if (session.data.birthPlace) session.data.birthPlace = normalizeBirthPlace(session.data.birthPlace);
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
  // If Vollmacht return is pending (Full Service + self-sign), don't finalize yet
  if (result.pending_vollmacht) return;
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
async function askFamilyDocType(ctx, session) {
  const memberNum = (session.data.familyMembers || []).length;
  session.step = 'family_doc_type';
  await ctx.reply(t(session, 'ask_family_doc_type').replace('{n}', memberNum), Markup.inlineKeyboard([
    [Markup.button.callback(t(session, 'family_doc_passport'), 'fdoc_passport')],
    [Markup.button.callback(t(session, 'family_doc_id'), 'fdoc_id')],
  ]));
}
async function finishFamilyMember(ctx, session) {
  const members = session.data.familyMembers || [];
  const lastMember = members[members.length - 1];
  const label = typeof lastMember === 'object' ? `${lastMember.raw} (${lastMember.gender}, ${lastMember.nationality})` : lastMember;
  await ctx.reply(`✅ ${label}`, Markup.inlineKeyboard([[Markup.button.callback(t(session,'family_add_more'),'family_add_more')],[Markup.button.callback(t(session,'family_done'),'family_done')]]));
}

// ─── BUTTON HANDLERS ────────────────────────────────────────────────────
bot.action('family_no', async (ctx) => { await ctx.answerCbQuery(); await askSigMode(ctx, getSession(ctx.chat.id)); });
bot.action('family_yes', async (ctx) => { const s = getSession(ctx.chat.id); if (!s.data.familyMembers) s.data.familyMembers = []; s.step = 'family_name'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_name').replace('{n}', s.data.familyMembers.length + 1)); });
bot.action('family_add_more', async (ctx) => { const s = getSession(ctx.chat.id); s.step = 'family_name'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_name').replace('{n}', (s.data.familyMembers || []).length + 1)); });
bot.action('family_done', async (ctx) => { await ctx.answerCbQuery(); await askSigMode(ctx, getSession(ctx.chat.id)); });
bot.action(/fgender_([mfd])/, async (ctx) => { const s = getSession(ctx.chat.id); const map = { m: 'männlich', f: 'weiblich', d: 'divers' }; s.data._tempFamilyGender = map[ctx.match[1]]; s.step = 'family_nationality'; await ctx.answerCbQuery(); const memberNum = (s.data.familyMembers || []).length + 1; const natText = t(s, 'ask_family_nationality').replace('{n}', memberNum); const buttons = s.data.nationality ? Markup.inlineKeyboard([[Markup.button.callback(t(s, 'family_same_nationality') + ` (${s.data.nationality})`, 'fnat_same')]]) : undefined; await ctx.reply(natText, buttons); });
bot.action('fnat_same', async (ctx) => { const s = getSession(ctx.chat.id); if (!s.data.familyMembers) s.data.familyMembers = []; const nat = s.data.nationality || ''; s.data.familyMembers.push({ raw: s.data._tempFamilyRaw, gender: s.data._tempFamilyGender || '', nationality: nat, birthPlace: s.data._tempFamilyBirthPlace || '', birthCountry: s.data._tempFamilyBirthCountry || '' }); delete s.data._tempFamilyRaw; delete s.data._tempFamilyGender; delete s.data._tempFamilyBirthPlace; delete s.data._tempFamilyBirthCountry; await ctx.answerCbQuery(); await askFamilyDocType(ctx, s); });
bot.action('fdoc_passport', async (ctx) => { const s = getSession(ctx.chat.id); const idx = (s.data.familyMembers || []).length; if (idx > 0 && typeof s.data.familyMembers[idx-1] === 'object') s.data.familyMembers[idx-1].docType = 'passport'; s.step = 'family_doc_front'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_doc_front').replace('{n}', idx)); });
bot.action('fdoc_id', async (ctx) => { const s = getSession(ctx.chat.id); const idx = (s.data.familyMembers || []).length; if (idx > 0 && typeof s.data.familyMembers[idx-1] === 'object') s.data.familyMembers[idx-1].docType = 'id'; s.step = 'family_doc_front'; await ctx.answerCbQuery(); await ctx.reply(t(s, 'ask_family_doc_front').replace('{n}', idx)); });
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
    [Markup.button.callback(t(s,'correct_birthcountry'),'corr_birthcountry')],
    [Markup.button.callback(t(s,'correct_nationality'),'corr_nationality')],
    [Markup.button.callback(t(s,'correct_address'),'corr_address')],
    [Markup.button.callback(t(s,'correct_moveout'),'corr_moveout')],
    [Markup.button.callback(t(s,'correct_newaddress'),'corr_newaddress')],
    [Markup.button.callback(t(s,'correct_email'),'corr_email'), Markup.button.callback(t(s,'correct_phone'),'corr_phone')],
  ]));
});
const CORR_FIELD_MAP = { firstname:{key:'firstName'}, lastname:{key:'lastName'}, birthdate:{key:'birthDate'}, birthplace:{key:'birthPlace'}, birthcountry:{key:'birthCountry'}, nationality:{key:'nationality'}, address:{key:'fullAddress'}, moveout:{key:'moveOutDate'}, newaddress:{key:'newFullAddress'}, email:{key:'email'}, phone:{key:'phone'} };
bot.action(/corr_(.+)/, async (ctx) => { const s = getSession(ctx.chat.id); const field = ctx.match[1]; if (!CORR_FIELD_MAP[field]) return ctx.answerCbQuery(); s.step = `corr_${field}`; await ctx.answerCbQuery(); await ctx.reply(t(s, 'correct_enter_new')); });
bot.action('skip_anmeldung', async (ctx) => { await ctx.answerCbQuery(); await askFamily(ctx, getSession(ctx.chat.id)); });

// ─── DELIVERY METHOD HANDLERS ─────────────────────────────────────────
bot.action('delivery_email', async (ctx) => {
  const s = getSession(ctx.chat.id);
  s.data.deliveryMethod = 'email';
  s.data.postalAddress = '';
  s.data.postalFee = 0;
  s.step = 'id_front';
  await ctx.answerCbQuery();
  await ctx.reply(t(s, 'ask_id_front'));
});
bot.action('delivery_post', async (ctx) => {
  const s = getSession(ctx.chat.id);
  s.data.deliveryMethod = 'post';
  await ctx.answerCbQuery();
  const newAddr = s.data.newFullAddress || [s.data.newStreet, s.data.newPlzCity, s.data.newCountry].filter(Boolean).join(', ');
  const buttons = [];
  if (newAddr) buttons.push([Markup.button.callback(t(s, 'use_new_address_btn') + ` (${newAddr.substring(0, 40)}${newAddr.length > 40 ? '…' : ''})`, 'delivery_use_new')]);
  buttons.push([Markup.button.callback(t(s, 'other_address_btn'), 'delivery_other')]);
  await ctx.reply(t(s, 'ask_postal_address'), Markup.inlineKeyboard(buttons));
});
bot.action('delivery_use_new', async (ctx) => {
  const s = getSession(ctx.chat.id);
  const newAddr = s.data.newFullAddress || [s.data.newStreet, s.data.newPlzCity, s.data.newCountry].filter(Boolean).join(', ');
  s.data.postalAddress = newAddr;
  s.data.postalFee = 15.00;
  await ctx.answerCbQuery();
  await ctx.reply(t(s, 'delivery_post_confirmation').replace('{address}', newAddr));
  s.step = 'id_front';
  await ctx.reply(t(s, 'ask_id_front'));
});
bot.action('delivery_other', async (ctx) => {
  const s = getSession(ctx.chat.id);
  s.step = 'postal_address';
  await ctx.answerCbQuery();
  await ctx.reply(t(s, 'ask_postal_address'));
});

// ─── ADMIN ACTION HANDLERS ─────────────────────────────────────────────
bot.action(/admin_approve_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌ Nicht autorisiert');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('✅ Genehmigt');
  try {
    const caseData = await SP.getCase(orderId);
    if (!caseData) { await ctx.reply(`❌ Fall ${orderId} nicht gefunden`); return; }
    const isFullService = caseData.Service === 'full';
    const newStatus = isFullService ? 'submitted_to_behoerde' : 'completed';
    await SP.updateCaseStatus(orderId, newStatus, `Admin genehmigt (${isFullService ? 'Full Service → wird an Bürgeramt gesendet' : 'DIY → abgeschlossen'})`);
    await ctx.editMessageText(`✅ *${orderId}* genehmigt → ${newStatus}`, { parse_mode: 'Markdown' });
    const chatId = caseData.ChatId;
    if (chatId) {
      const lang = caseData.Language || 'de';
      const msgs = {
        de: `✅ Ihre Abmeldung (${orderId}) wurde geprüft und genehmigt.${isFullService ? ' Wir senden das Formular an das Bürgeramt.' : ''}`,
        pt: `✅ Sua Abmeldung (${orderId}) foi verificada e aprovada.${isFullService ? ' Enviaremos o formulário ao Bürgeramt.' : ''}`,
        en: `✅ Your Abmeldung (${orderId}) has been reviewed and approved.${isFullService ? ' We will send the form to the Bürgeramt.' : ''}`,
      };
      try { await bot.telegram.sendMessage(chatId, msgs[lang] || msgs.de); } catch(e) { console.log('Client notification error:', e.message); }
    }
  } catch(e) { await ctx.reply('❌ Fehler: ' + e.message); }
});

bot.action(/admin_reject_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('Grund eingeben...');
  sessions.set('_admin_reject_' + orderId, { orderId, step: 'awaiting_reason' });
  await ctx.editMessageText(`❌ *${orderId}* — Bitte Ablehnungsgrund eingeben:`, { parse_mode: 'Markdown' });
});

bot.action(/admin_hold_(.+)/, async (ctx) => {
  if (String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return ctx.answerCbQuery('❌');
  const orderId = ctx.match[1];
  await ctx.answerCbQuery('⏸ Zurückgestellt');
  try {
    await SP.updateCaseStatus(orderId, 'on_hold', 'Admin: zurückgestellt');
    await ctx.editMessageText(`⏸ *${orderId}* zurückgestellt`, { parse_mode: 'Markdown' });
  } catch(e) { await ctx.reply('❌ Fehler: ' + e.message); }
});

// ─── TEXT HANDLER ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  // Check if this is an admin rejection reason
  if (String(ctx.chat.id) === String(ADMIN_CHAT_ID)) {
    for (const [key, val] of sessions.entries()) {
      if (key.startsWith('_admin_reject_') && val.step === 'awaiting_reason') {
        const orderId = val.orderId;
        const reason = text;
        sessions.delete(key);
        try {
          await SP.updateCaseStatus(orderId, 'rejected', `Abgelehnt: ${reason}`);
          await ctx.reply(`❌ *${orderId}* abgelehnt.\nGrund: ${reason}`, { parse_mode: 'Markdown' });
          const caseData = await SP.getCase(orderId);
          if (caseData && caseData.ChatId) {
            const lang = caseData.Language || 'de';
            const msgs = {
              de: `❌ Ihre Abmeldung (${orderId}) wurde leider abgelehnt.\n\nGrund: ${reason}\n\nBitte kontaktieren Sie uns: abmeldung@rafer.de`,
              pt: `❌ Sua Abmeldung (${orderId}) foi recusada.\n\nMotivo: ${reason}\n\nPor favor entre em contato: abmeldung@rafer.de`,
              en: `❌ Your Abmeldung (${orderId}) was rejected.\n\nReason: ${reason}\n\nPlease contact us: abmeldung@rafer.de`,
            };
            try { await bot.telegram.sendMessage(caseData.ChatId, msgs[lang] || msgs.de); } catch(e) { console.log('Client reject notification error:', e.message); }
          }
        } catch(e) { await ctx.reply('❌ Fehler: ' + e.message); }
        return;
      }
    }
  }
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
    case 'birthplace': session.data.birthPlace = text; session.step = 'birthcountry'; await ctx.reply(t(session, 'ask_birthcountry')); break;
    case 'birthcountry': session.data.birthCountry = text; session.step = 'gender'; await ctx.reply(t(session, 'ask_gender'), Markup.inlineKeyboard([[Markup.button.callback('♂ männlich / masculino / male','gender_m')],[Markup.button.callback('♀ weiblich / feminino / female','gender_f')],[Markup.button.callback('⚧ divers / outro / other','gender_d')]])); break;
    case 'gender': session.data.gender = text; session.step = 'nationality'; await ctx.reply(t(session, 'ask_nationality')); break;
    case 'nationality': session.data.nationality = normalizeNationality(text); session.step = 'address'; await ctx.reply(t(session, 'ask_address')); break;
    case 'address': { const plz = extractPLZ(text); if (!plz || !PLZ_MAP[plz]) { await ctx.reply(t(session, 'invalid_plz')); return; } session.data.fullAddress = text; session.data.plz = plz; session.data.bezirk = getBezirk(plz); session.step = 'moveout'; await ctx.reply(t(session, 'ask_moveout')); break; }
    case 'moveout': if (!isValidDate(text)) { await ctx.reply(t(session, 'invalid_date')); return; } session.data.moveOutDate = text; session.step = 'newaddress_street'; await ctx.reply(t(session, 'ask_newaddress_street')); break;
    case 'newaddress_street': session.data.newStreet = text; session.step = 'newaddress_plzcity'; await ctx.reply(t(session, 'ask_newaddress_plzcity')); break;
    case 'newaddress_plzcity': session.data.newPlzCity = text; session.step = 'newaddress_country'; await ctx.reply(t(session, 'ask_newaddress_country')); break;
    case 'newaddress_country': session.data.newCountry = text; session.data.newFullAddress = `${session.data.newStreet}, ${session.data.newPlzCity}, ${session.data.newCountry}`; session.step = 'wohnungtyp'; await ctx.reply(t(session, 'ask_wohnungtyp'), Markup.inlineKeyboard([[Markup.button.callback(t(session,'wohnungtyp_alleinige'),'wtyp_alleinige')],[Markup.button.callback(t(session,'wohnungtyp_haupt'),'wtyp_haupt')],[Markup.button.callback(t(session,'wohnungtyp_neben'),'wtyp_neben')]])); break;
    case 'email': if (!isValidEmail(text)) { await ctx.reply(t(session, 'invalid_email')); return; } session.data.email = text; session.step = 'phone'; await ctx.reply(t(session, 'ask_phone')); break;
    case 'phone': session.data.phone = text; session.step = 'delivery_method'; await ctx.reply(t(session, 'ask_delivery_method'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(t(session, 'delivery_email_btn'), 'delivery_email')],[Markup.button.callback(t(session, 'delivery_post_btn'), 'delivery_post')]]) }); break;
    case 'postal_address': session.data.postalAddress = text; session.data.postalFee = 15.00; await ctx.reply(t(session, 'delivery_post_confirmation').replace('{address}', text)); session.step = 'id_front'; await ctx.reply(t(session, 'ask_id_front')); break;
    case 'family_name': if (!session.data.familyMembers) session.data.familyMembers = []; session.data._tempFamilyRaw = text; session.step = 'family_birthplace'; { const memberNum = session.data.familyMembers.length + 1; await ctx.reply(t(session, 'ask_family_birthplace').replace('{n}', memberNum)); } break;
    case 'family_birthplace': session.data._tempFamilyBirthPlace = text; session.step = 'family_birthcountry'; { const memberNum = (session.data.familyMembers || []).length + 1; await ctx.reply(t(session, 'ask_family_birthcountry').replace('{n}', memberNum)); } break;
    case 'family_birthcountry': session.data._tempFamilyBirthCountry = text; session.step = 'family_gender'; { const memberNum = (session.data.familyMembers || []).length + 1; await ctx.reply(t(session, 'ask_family_gender').replace('{n}', memberNum), Markup.inlineKeyboard([[Markup.button.callback('♂ männlich / masculino / male','fgender_m')],[Markup.button.callback('♀ weiblich / feminino / female','fgender_f')],[Markup.button.callback('⚧ divers / outro / other','fgender_d')]])); } break;
    case 'family_gender': session.data._tempFamilyGender = text; session.step = 'family_nationality'; { const memberNum = session.data.familyMembers.length + 1; const natText = t(session, 'ask_family_nationality').replace('{n}', memberNum); const buttons = session.data.nationality ? Markup.inlineKeyboard([[Markup.button.callback(t(session, 'family_same_nationality') + ` (${session.data.nationality})`, 'fnat_same')]]) : undefined; await ctx.reply(natText, buttons); } break;
    case 'family_nationality': { if (!session.data.familyMembers) session.data.familyMembers = []; const natVal = normalizeNationality(text); session.data.familyMembers.push({ raw: session.data._tempFamilyRaw, gender: session.data._tempFamilyGender || '', nationality: natVal, birthPlace: session.data._tempFamilyBirthPlace || '', birthCountry: session.data._tempFamilyBirthCountry || '' }); delete session.data._tempFamilyRaw; delete session.data._tempFamilyGender; delete session.data._tempFamilyBirthPlace; delete session.data._tempFamilyBirthCountry; await askFamilyDocType(ctx, session); } break;
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
    case 'family_doc_front': { const members = session.data.familyMembers || []; const idx = members.length - 1; if (idx >= 0 && typeof members[idx] === 'object') { members[idx].docFrontFileId = photo.file_id; members[idx].docFrontImage = base64Image; } await ctx.reply(t(session, 'family_doc_received')); if (idx >= 0 && typeof members[idx] === 'object' && members[idx].docType === 'id') { session.step = 'family_doc_back'; await ctx.reply(t(session, 'ask_family_doc_back').replace('{n}', idx + 1)); } else { await finishFamilyMember(ctx, session); } break; }
    case 'family_doc_back': { const members2 = session.data.familyMembers || []; const idx2 = members2.length - 1; if (idx2 >= 0 && typeof members2[idx2] === 'object') { members2[idx2].docBackFileId = photo.file_id; members2[idx2].docBackImage = base64Image; } await ctx.reply(t(session, 'family_doc_received')); await finishFamilyMember(ctx, session); break; }
    case 'vollmacht_return': { session.data.signedVollmachtImage = base64Image; session.data.signedVollmachtFileId = photo.file_id; await ctx.reply(t(session, 'vollmacht_return_received')); await completeAfterVollmacht(ctx, session); break; }
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
      execFileSync(PYTHON3, ['-c', "import fitz,sys; d=fitz.open(sys.argv[1]); mat=fitz.Matrix(2,2); pix=d[0].get_pixmap(matrix=mat); pix.save(sys.argv[2]); print('OK')", tmpPdf, tmpPng], { timeout: 20000, env: getPyEnv() });
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
    case 'family_doc_front': { const members = session.data.familyMembers || []; const idx = members.length - 1; if (idx >= 0 && typeof members[idx] === 'object') { members[idx].docFrontFileId = doc.file_id; members[idx].docFrontImage = base64Image; } await ctx.reply(t(session, 'family_doc_received')); if (idx >= 0 && typeof members[idx] === 'object' && members[idx].docType === 'id') { session.step = 'family_doc_back'; await ctx.reply(t(session, 'ask_family_doc_back').replace('{n}', idx + 1)); } else { await finishFamilyMember(ctx, session); } break; }
    case 'family_doc_back': { const members2 = session.data.familyMembers || []; const idx2 = members2.length - 1; if (idx2 >= 0 && typeof members2[idx2] === 'object') { members2[idx2].docBackFileId = doc.file_id; members2[idx2].docBackImage = base64Image; } await ctx.reply(t(session, 'family_doc_received')); await finishFamilyMember(ctx, session); break; }
    case 'vollmacht': session.data.vollmachtFileId = doc.file_id; await ctx.reply('✅ Vollmacht recebida!'); session.ctx = ctx; await triggerPowerAutomate(session); await ctx.reply(t(session, 'done_message')); session.step = 'done'; break;
    case 'vollmacht_return': { session.data.signedVollmachtFileId = doc.file_id; if (base64Image) session.data.signedVollmachtImage = base64Image; await ctx.reply(t(session, 'vollmacht_return_received')); await completeAfterVollmacht(ctx, session); break; }
  }
});

// ─── SHOW SUMMARY ───────────────────────────────────────────────────────
async function showSummary(ctx, session) {
  const { data } = session;
  const serviceLabel = data.service === 'full' ? 'Full Service (€39.99)' : 'DIY (€4.99)';
  const newAddr = data.newFullAddress || [data.newStreet, data.newPlzCity, data.newCountry].filter(Boolean).join(', ');
  let familySummary = '';
  if (data.familyMembers && data.familyMembers.length > 0) { familySummary = '👨‍👩‍👧 Familienmitglieder:\n' + data.familyMembers.map((m, i) => { if (typeof m === 'object') { const bp = [m.birthPlace, m.birthCountry].filter(Boolean).join(', '); return `  ${i+2}. ${m.raw}${bp ? ' (🏙 ' + bp + ')' : ''} (${m.gender || '?'}, ${m.nationality || '?'})`; } return `  ${i+2}. ${m}`; }).join('\n') + '\n\n'; }
  // Calculate total price
  const basePrice = data.service === 'full' ? 39.99 : 4.99;
  const postalFee = data.postalFee || 0;
  data.totalPrice = basePrice + postalFee;
  // Delivery line
  const deliveryLine = data.deliveryMethod === 'post'
    ? t(session, 'delivery_post_label') + (data.postalAddress ? `\n📮 ${data.postalAddress}` : '')
    : t(session, 'delivery_email_label');
  const totalLine = data.deliveryMethod === 'post'
    ? t(session, 'total_price_label').replace('{total}', data.totalPrice.toFixed(2))
    : t(session, 'total_price_label').replace('{total}', data.totalPrice.toFixed(2)).replace(/\s*\(.*\)/, '');
  const summary = t(session, 'summary')
    .replace('{firstName}', data.firstName || '–').replace('{lastName}', data.lastName || '–')
    .replace('{birthDate}', data.birthDate || '–').replace('{birthPlace}', data.birthPlace || '–').replace('{birthCountry}', data.birthCountry || '–')
    .replace('{nationality}', data.nationality || '–').replace('{address}', data.fullAddress || '–')
    .replace('{bezirk}', data.bezirk || '–').replace('{moveOutDate}', data.moveOutDate || '–')
    .replace('{newAddress}', newAddr || '–').replace('{email}', data.email || '–')
    .replace('{phone}', data.phone || '–').replace('{familySummary}', familySummary)
    .replace('{service}', serviceLabel);
  const fullSummary = summary + `\n\n${deliveryLine}\n${totalLine}`;
  await ctx.reply(fullSummary, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
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

  // DSGVO: Auto-delete files older than 7 days
  const pdfDir = path.join(BOT_DIR, 'pdfs');
  const archiveDir = path.join(BOT_DIR, 'pdfs', 'archive');
  [pdfDir, archiveDir].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      if (!/\.(pdf|jpg|png)$/i.test(file)) return;
      const fp = path.join(dir, file);
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile()) return;
        if (Date.now() - stat.mtimeMs > 7 * 24 * 3600 * 1000) {
          fs.unlinkSync(fp);
          console.log(`🗑 DSGVO: Deleted (>7d): ${file}`);
        }
      } catch(_) {}
    });
  });

  // Start Express dashboard server first
  try { await startServer(bot); } catch(e) { console.error('⚠️ Dashboard server error (non-fatal):', e.message); }

  // Start inbox monitor (polls for Bürgeramt responses)
  try { startInboxMonitor(bot); } catch(e) { console.error('⚠️ InboxMonitor start error (non-fatal):', e.message); }
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
