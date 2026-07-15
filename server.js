// ─── server.js ─────────────────────────────────────────────────────────────
// Express server para o Dashboard do AbmeldeBot
// Corre no mesmo processo que o bot Telegram
// ───────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const multer  = require('multer');
const fs      = require('fs');
const SP      = require('./sharepoint');

// Multer config for file uploads (temp dir)
const uploadDir = path.join(__dirname, 'pdfs', 'uploads_tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

const app  = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'abmelde2024';

// ── Session store (in-memory) ───────────────────────────────────────────────
const authSessions = new Map();
const SESSION_TTL  = 24 * 60 * 60 * 1000; // 24h

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of authSessions) {
    if (now - session.created > SESSION_TTL) authSessions.delete(token);
  }
}
setInterval(cleanExpiredSessions, 60 * 60 * 1000); // clean every hour

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || !authSessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const session = authSessions.get(token);
  if (Date.now() - session.created > SESSION_TTL) {
    authSessions.delete(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

// ── Static: serve dashboard.html ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── Landing page: RAFER Easy Abmeldung ──────────────────────────────────────
app.get('/abmeldung', (req, res) => {
  res.sendFile(path.join(__dirname, 'abmeldung.html'));
});

// ── Auth endpoints ──────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== DASHBOARD_PASSWORD) {
    return res.status(403).json({ error: 'Wrong password' });
  }
  const token = generateToken();
  authSessions.set(token, { created: Date.now() });
  res.json({ token });
});

app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token) authSessions.delete(token);
  res.json({ ok: true });
});

// ── Protected API endpoints ─────────────────────────────────────────────────
app.get('/api/cases', authMiddleware, async (req, res) => {
  try {
    const cases = await SP.listCases();
    res.json({ cases });
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data).substring(0, 500) : '';
    console.error('API /cases error:', err.message, detail);
    res.status(500).json({ error: err.message, detail });
  }
});

app.get('/api/cases/:orderId', authMiddleware, async (req, res) => {
  try {
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    res.json(caseData);
  } catch (err) {
    console.error('API /cases/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/cases/:orderId/status', authMiddleware, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!status) return res.status(400).json({ error: 'Status required' });
    const itemId = await SP.updateCaseStatus(req.params.orderId, status, note || '');
    if (!itemId) return res.status(404).json({ error: 'Case not found' });
    res.json({ ok: true, itemId });
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data).substring(0, 500) : '';
    console.error('API PATCH status error:', err.message, detail);
    res.status(500).json({ error: err.message, detail });
  }
});

app.post('/api/cases/:orderId/notes', authMiddleware, async (req, res) => {
  try {
    const { note } = req.body || {};
    if (!note) return res.status(400).json({ error: 'Note required' });
    const itemId = await SP.addCaseNote(req.params.orderId, note);
    if (!itemId) return res.status(404).json({ error: 'Case not found' });
    res.json({ ok: true, itemId });
  } catch (err) {
    console.error('API POST notes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/cases/:orderId/shipping', authMiddleware, async (req, res) => {
  try {
    const { shippingCost } = req.body || {};
    const cost = parseFloat(shippingCost) || 0;
    await SP.updateCaseField(req.params.orderId, { ShippingCost: cost });
    res.json({ ok: true });
  } catch (err) {
    console.error('API POST shipping error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bürgeramt email: preview ────────────────────────────────────────────────
app.get('/api/cases/:orderId/preview-amt-email', authMiddleware, async (req, res) => {
  try {
    const { sendToBuergeramt } = require('./email');
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    if (caseData.Service !== 'full') return res.status(400).json({ error: 'Nur für Full Service Fälle' });
    const result = await sendToBuergeramt(caseData, { dryRun: true });
    res.json(result);
  } catch (err) {
    console.error('API preview-amt-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bürgeramt email: send ───────────────────────────────────────────────────
app.post('/api/cases/:orderId/send-to-amt', authMiddleware, async (req, res) => {
  try {
    const { sendToBuergeramt } = require('./email');
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    if (caseData.Service !== 'full') return res.status(400).json({ error: 'Nur für Full Service Fälle' });

    const result = await sendToBuergeramt(caseData, { dryRun: false });
    if (!result.success) return res.status(500).json(result);

    // Update SharePoint status + timeline
    const now = new Date().toISOString();
    await SP.updateCaseStatus(
      req.params.orderId,
      'sent_to_amt',
      'Email an Bürgeramt ' + (result.bezirk || '') + ' gesendet am ' + now.split('T')[0] + ' (' + (result.to || '') + ')'
    );

    // Notify client via Telegram
    const chatId = caseData.ChatId;
    if (chatId) {
      const lang = caseData.Language || 'de';
      const tgBot = req.app.get('telegramBot');
      if (tgBot) {
        const msgs = {
          de: '📬 Ihre Abmeldung (' + req.params.orderId + ') wurde soeben an das Bürgeramt ' + (result.bezirk || 'Berlin') + ' gesendet. Wir informieren Sie, sobald wir eine Bestätigung erhalten.',
          pt: '📬 Sua Abmeldung (' + req.params.orderId + ') foi enviada ao Bürgeramt ' + (result.bezirk || 'Berlin') + '. Informaremos assim que recebermos a confirmação.',
          en: '📬 Your Abmeldung (' + req.params.orderId + ') has been sent to the Bürgeramt ' + (result.bezirk || 'Berlin') + '. We will notify you once we receive confirmation.',
        };
        try { await tgBot.telegram.sendMessage(chatId, msgs[lang] || msgs.de); } catch (e) { console.log('Client notification error:', e.message); }
      }
    }

    res.json(result);
  } catch (err) {
    console.error('API send-to-amt error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Upload Abmeldebestätigung ───────────────────────────────────────────────
app.post('/api/cases/:orderId/upload-bestaetigung', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { orderId } = req.params;
    const caseData = await SP.getCase(orderId);
    if (!caseData) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Case not found' });
    }

    // Determine filename
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.pdf';
    const filename = `Abmeldebestaetigung_${orderId}${ext}`;

    // Upload to SharePoint
    const spUrl = await SP.uploadFile(orderId, req.file.path, filename);

    // Update case status
    const now = new Date().toLocaleDateString('de-DE');
    await SP.updateCaseStatus(orderId, 'confirmation_received',
      `Abmeldebestätigung manuell hochgeladen am ${now} via Dashboard`);
    if (spUrl) {
      await SP.updateCaseField(orderId, { AbmeldebestaetigungUrl: spUrl });
    }

    // Cleanup temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    // Notify admin via Telegram
    const tgBot = req.app.get('telegramBot');
    const adminId = process.env.ADMIN_CHAT_ID;
    if (tgBot && adminId) {
      try {
        await tgBot.telegram.sendMessage(adminId,
          `✅ Abmeldebestätigung manuell hochgeladen\n👤 ${caseData.ClientName || orderId}\n📋 ${orderId}`);
      } catch (_) {}
    }

    res.json({ ok: true, url: spUrl, filename });
  } catch (err) {
    if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('API upload-bestaetigung error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Send Abmeldebestätigung to client by email ──────────────────────────────
app.post('/api/cases/:orderId/send-bestaetigung', authMiddleware, async (req, res) => {
  try {
    const { sendBestaetigung } = require('./email');
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });

    const result = await sendBestaetigung(caseData);
    if (!result.success) return res.status(500).json(result);

    const now = new Date().toLocaleDateString('de-DE');
    await SP.updateCaseStatus(req.params.orderId, 'delivery_email_sent',
      'Abmeldebestätigung per Email an ' + (caseData.Email || '') + ' gesendet am ' + now + ' (manuell via Dashboard)');
    await SP.updateCaseStatus(req.params.orderId, 'completed',
      'Fall abgeschlossen — Bestätigung per Email zugestellt');

    const chatId = caseData.ChatId;
    const tgBot = req.app.get('telegramBot');
    if (tgBot && chatId) {
      const lang = (caseData.Language || 'de').toLowerCase();
      const msgs = {
        de: '📋 Ihre Abmeldebestätigung wurde per Email gesendet. Bitte prüfen Sie Ihr Postfach.',
        pt: '📋 A sua Abmeldebestätigung foi enviada por email. Verifique a sua caixa de entrada.',
        en: '📋 Your Abmeldebestätigung has been sent by email. Please check your inbox.',
      };
      try { await tgBot.telegram.sendMessage(chatId, msgs[lang] || msgs.de); } catch (_) {}
    }

    res.json({ ok: true, to: result.to });
  } catch (err) {
    console.error('API send-bestaetigung error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Mark as posted (postal delivery) ────────────────────────────────────────
app.post('/api/cases/:orderId/mark-posted', authMiddleware, async (req, res) => {
  try {
    const { trackingCode } = req.body || {};
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });

    const now = new Date().toLocaleDateString('de-DE');
    const trackingNote = trackingCode ? ' Tracking: ' + trackingCode : '';
    await SP.updateCaseStatus(req.params.orderId, 'delivery_post_sent',
      'Per Post versendet am ' + now + '.' + trackingNote);
    await SP.updateCaseStatus(req.params.orderId, 'completed',
      'Fall abgeschlossen — Bestätigung per Post versendet');

    const chatId = caseData.ChatId;
    const tgBot = req.app.get('telegramBot');
    if (tgBot && chatId) {
      const lang = (caseData.Language || 'de').toLowerCase();
      const address = caseData.PostalAddress || '';
      const msgs = {
        de: '📮 Ihre Abmeldebestätigung wurde per Post an ' + address + ' versendet.',
        pt: '📮 A sua Abmeldebestätigung foi enviada por correio para ' + address + '.',
        en: '📮 Your Abmeldebestätigung has been sent by post to ' + address + '.',
      };
      try { await tgBot.telegram.sendMessage(chatId, msgs[lang] || msgs.de); } catch (_) {}
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('API mark-posted error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Send follow-up email to Bürgeramt ───────────────────────────────────
app.post('/api/cases/:orderId/send-followup', authMiddleware, async (req, res) => {
  try {
    const { sendFollowUp } = require('./email');
    const caseData = await SP.getCase(req.params.orderId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const result = await sendFollowUp(caseData);
    if (!result.success) return res.status(500).json(result);
    const now = new Date().toLocaleDateString('de-DE');
    await SP.updateCaseStatus(req.params.orderId, 'sent_to_amt',
      'Nachfass-Email an Bürgeramt ' + (result.bezirk || '') + ' gesendet am ' + now + ' (' + (result.to || '') + ') via Dashboard');
    const tgBot = req.app.get('telegramBot');
    const adminId = process.env.ADMIN_CHAT_ID;
    if (tgBot && adminId) {
      try {
        await tgBot.telegram.sendMessage(adminId,
          '📧 Nachfass-Email gesendet\n👤 ' + (caseData.ClientName || req.params.orderId) + '\n🏛 ' + (result.bezirk || '?') + '\n📮 ' + (result.to || ''));
      } catch (_) {}
    }
    res.json({ ok: true, to: result.to, bezirk: result.bezirk });
  } catch (err) {
    console.error('API send-followup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Process web case: generate PDFs from uploaded docs ──────────────────────
app.post('/api/cases/:orderId/process', authMiddleware, upload.fields([
  { name: 'signature', maxCount: 1 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]), async (req, res) => {
  const files = req.files || {};
  const tmpFiles = []; // track for cleanup
  try {
    const { orderId } = req.params;
    const caseData = await SP.getCase(orderId);
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // --- 1. Parse case data from SharePoint fields ---
    const nameParts = (caseData.ClientName || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const addressParts = (caseData.BerlinAddress || '').split(',');
    const street = addressParts[0] || '';
    const plzMatch = (caseData.BerlinAddress || '').match(/\b(\d{5})\b/);
    const plz = plzMatch ? plzMatch[1] : '';
    const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // --- 2. Read signature image if uploaded ---
    let signatureBase64 = '';
    if (files.signature && files.signature[0]) {
      tmpFiles.push(files.signature[0].path);
      const sigBuf = fs.readFileSync(files.signature[0].path);
      signatureBase64 = 'data:image/jpeg;base64,' + sigBuf.toString('base64');
    }

    // --- 3. Generate Abmeldung PDF ---
    const { execFile: execFileCb } = require('child_process');
    const PYTHON3 = process.env.PYTHON_PATH || 'python3';
    const BOT_DIR = __dirname;
    function getPyEnv() {
      const localPkgDir = path.join(BOT_DIR, '.python_packages');
      const persistentPkgDir = '/home/python_packages';
      return { ...process.env, PYTHONPATH: [persistentPkgDir, localPkgDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':') };
    }

    const abmeldungPayload = JSON.stringify({
      Nachname: lastName, Vorname: firstName, Geburtsname: '',
      Geschlecht: caseData.Gender || '', Geburtsdatum: '', Geburtsort: '', Geburtsland: '',
      Staatsangehoerigkeit: caseData.Nationality || '', Strasse: caseData.BerlinAddress || '',
      PLZ: plz, Bezirk: caseData.Bezirk || '', Auszugsdatum: caseData.MoveOutDate || '',
      NeueStrasse: (caseData.NewAddress || '').split(',')[0] || '',
      NeuesLand: (caseData.NewAddress || '').split(',').slice(1).join(',').trim() || '',
      BisherigWohnung: 'alleinige', NeueWohnungExistiert: 'nein',
      Datum: today, SignaturBase64: signatureBase64,
      FamilyMembers: [],
    });
    const abmeldungOut = path.join(BOT_DIR, 'pdfs', `Abmeldung_${orderId}.pdf`);
    const abmeldungScript = path.join(BOT_DIR, 'fill_abmeldung.py');

    await new Promise((resolve, reject) => {
      execFileCb(PYTHON3, [abmeldungScript, abmeldungPayload, abmeldungOut], { env: getPyEnv(), timeout: 30000 }, (err, stdout, stderr) => {
        if (err) { console.error('fill_abmeldung.py error:', stderr); return reject(new Error(stderr || err.message)); }
        if (stdout.startsWith('OK:')) resolve(abmeldungOut);
        else reject(new Error(stdout || 'Unknown error'));
      });
    });
    tmpFiles.push(abmeldungOut);
    console.log('✅ Process web case: Abmeldung PDF generated:', abmeldungOut);

    // --- 4. Generate Vollmacht PDF ---
    let vollmachtOut = null;
    if (caseData.Service === 'full') {
      vollmachtOut = path.join(BOT_DIR, 'pdfs', `Vollmacht_${orderId}.pdf`);
      const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
      const vollmachtPayload = JSON.stringify({
        Vorname: firstName, Nachname: lastName, Bezirk: caseData.Bezirk || 'Berlin', Datum: today,
        Geburtsdatum: '', Adresse: caseData.BerlinAddress || '', AuszugDatum: caseData.MoveOutDate || '',
        Language: caseData.Language || 'de', SignaturBase64: signatureBase64,
        FamilyMembers: [],
      });
      const { execFileSync } = require('child_process');
      try {
        execFileSync(PYTHON3, [vollmachtScript, vollmachtPayload, vollmachtOut], { env: getPyEnv(), timeout: 30000, stdio: 'pipe' });
        tmpFiles.push(vollmachtOut);
        console.log('✅ Process web case: Vollmacht PDF generated:', vollmachtOut);
      } catch (ve) {
        console.error('⚠️ Vollmacht gen error (non-fatal):', ve.message);
        vollmachtOut = null;
      }
    }

    // --- 5. Upload PDFs + ID images to SharePoint ---
    const fileUrls = {};
    if (fs.existsSync(abmeldungOut)) {
      fileUrls.abmeldung = await SP.uploadFile(orderId, abmeldungOut, `Abmeldung_${orderId}.pdf`);
    }
    if (vollmachtOut && fs.existsSync(vollmachtOut)) {
      fileUrls.vollmacht = await SP.uploadFile(orderId, vollmachtOut, `Vollmacht_${orderId}.pdf`);
    }
    if (files.idFront && files.idFront[0]) {
      tmpFiles.push(files.idFront[0].path);
      fileUrls.idFront = await SP.uploadFile(orderId, files.idFront[0].path, 'id_frente.jpg');
    }
    if (files.idBack && files.idBack[0]) {
      tmpFiles.push(files.idBack[0].path);
      fileUrls.idBack = await SP.uploadFile(orderId, files.idBack[0].path, 'id_verso.jpg');
    }

    // --- 6. Update SharePoint fields ---
    const updateFields = { LastUpdated: new Date().toISOString() };
    if (fileUrls.abmeldung) updateFields.AbmeldungUrl = fileUrls.abmeldung;
    if (fileUrls.vollmacht) updateFields.VollmachtUrl = fileUrls.vollmacht;
    if (fileUrls.idFront) updateFields.IdFrontUrl = fileUrls.idFront;
    if (fileUrls.idBack) updateFields.IdBackUrl = fileUrls.idBack;
    await SP.updateCaseField(orderId, updateFields);
    await SP.updateCaseStatus(orderId, 'pdf_generated',
      'PDFs generiert via Dashboard am ' + today + ' (Abmeldung' + (vollmachtOut ? ' + Vollmacht' : '') + ')');

    // --- 7. Notify admin via Telegram ---
    const tgBot = req.app.get('telegramBot');
    const adminId = process.env.ADMIN_CHAT_ID;
    if (tgBot && adminId) {
      try {
        await tgBot.telegram.sendMessage(adminId,
          `📄 Web-Fall verarbeitet\n👤 ${caseData.ClientName || orderId}\n📋 ${orderId}\n✅ Abmeldung PDF${vollmachtOut ? ' + Vollmacht' : ''}\n🏛 ${caseData.Bezirk || '?'}\n➡️ Bereit zum Versand an Bürgeramt`);
      } catch (_) {}
    }

    // Cleanup temp files
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) {} }

    res.json({ ok: true, orderId, fileUrls, status: 'pdf_generated' });
  } catch (err) {
    // Cleanup on error
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) {} }
    const detail = err.response ? JSON.stringify(err.response.data).substring(0, 500) : '';
    console.error('API process error:', err.message, detail);
    res.status(500).json({ error: err.message, detail });
  }
});

// ── Landing page: submit Abmeldung request ──────────────────────────────────
app.post('/api/submit-abmeldung', async (req, res) => {
  try {
    const d = req.body || {};
    // Validate required fields
    const required = ['firstName','lastName','dob','birthPlace','nationality','gender','street','plz','bezirk','moveOutDate','newStreet','newPlzCity','newCountry','email','phone'];
    for (const f of required) {
      if (!d[f]) return res.status(400).json({ error: 'Missing field: ' + f });
    }

    // Generate order ID
    const orderId = 'AB' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();

    // Build session-like object for SharePoint
    const session = {
      lang: d.language || 'de',
      chatId: '',
      data: {
        orderId,
        firstName: d.firstName,
        lastName: d.lastName,
        dob: d.dob,
        birthPlace: d.birthPlace,
        nationality: d.nationality,
        gender: d.gender,
        fullAddress: d.street + ', ' + d.plz + ' Berlin',
        bezirk: d.bezirk,
        moveOutDate: d.moveOutDate,
        newFullAddress: d.newStreet + ', ' + d.newPlzCity + ', ' + d.newCountry,
        email: d.email,
        phone: d.phone,
        service: 'full',
        deliveryMethod: d.deliveryMethod || 'email',
        postalAddress: d.postalAddress || '',
        postalFee: d.deliveryMethod === 'post' ? 9.90 : 0,
        totalPrice: d.totalPrice || 99,
        familyMembers: d.familyMembers || [],
      },
    };

    // Create case in SharePoint
    if (SP.isConfigured()) {
      await SP.createCaseFolder(orderId);
      await SP.createLedgerEntry(session, {});
      // Set status to awaiting_signature (web submission — no docs yet)
      await SP.updateCaseStatus(orderId, 'awaiting_signature',
        'Web-Formular eingegangen am ' + new Date().toLocaleDateString('de-DE') +
        (d.notes ? ' | Anmerkung: ' + d.notes.substring(0, 200) : '') +
        ' | Sprache: ' + (d.language || 'de'));
    }

    // Notify admin via Telegram
    const tgBot = req.app.get('telegramBot');
    const adminId = process.env.ADMIN_CHAT_ID;
    if (tgBot && adminId) {
      const familyInfo = (d.familyMembers && d.familyMembers.length > 0)
        ? '\n👨‍👩‍👧 Familienmitglieder: ' + d.familyMembers.length
        : '';
      const msg = '🌐 Neue Web-Abmeldung!\n' +
        '👤 ' + d.firstName + ' ' + d.lastName + '\n' +
        '📧 ' + d.email + '\n' +
        '📞 ' + d.phone + '\n' +
        '🏠 ' + d.street + ', ' + d.plz + ' (' + d.bezirk + ')\n' +
        '📅 Auszug: ' + d.moveOutDate + '\n' +
        '🌍 → ' + d.newCountry + '\n' +
        '💰 €' + (d.totalPrice || 99) + ' (Full Service)' +
        familyInfo + '\n' +
        '📋 ' + orderId + '\n' +
        '⏳ Status: awaiting_signature';
      try { await tgBot.telegram.sendMessage(adminId, msg); } catch (e) { console.log('Admin TG notify error:', e.message); }
    }

    // ── Generate Abmeldung (+ Vollmacht) PDFs and email them to the client ──────
    let emailResult = { success: false };
    try {
      const { execFile: execFileCb, execFileSync } = require('child_process');
      const PYTHON3 = process.env.PYTHON_PATH || 'python3';
      const BOT_DIR = __dirname;
      const getPyEnv = () => {
        const localPkgDir = path.join(BOT_DIR, '.python_packages');
        const persistentPkgDir = '/home/python_packages';
        return { ...process.env, PYTHONPATH: [persistentPkgDir, localPkgDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':') };
      };
      const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const pdfsDir = path.join(BOT_DIR, 'pdfs');
      if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });

      // 1. Abmeldung PDF (unsigned — client signs the returned documents)
      const abmeldungOut = path.join(pdfsDir, 'Abmeldung_' + orderId + '.pdf');
      const abmeldungScript = path.join(BOT_DIR, 'fill_abmeldung.py');
      const abmeldungPayload = JSON.stringify({
        Nachname: d.lastName, Vorname: d.firstName, Geburtsname: '',
        Geschlecht: d.gender || '', Geburtsdatum: d.dob || '', Geburtsort: d.birthPlace || '', Geburtsland: '',
        Staatsangehoerigkeit: d.nationality || '', Strasse: session.data.fullAddress,
        PLZ: d.plz || '', Bezirk: d.bezirk || '', Auszugsdatum: d.moveOutDate || '',
        NeueStrasse: d.newStreet || '', NeuesLand: ((d.newPlzCity || '') + ' ' + (d.newCountry || '')).trim(),
        BisherigWohnung: 'alleinige', NeueWohnungExistiert: 'nein',
        Datum: today, SignaturBase64: '',
        FamilyMembers: session.data.familyMembers || [],
      });
      await new Promise((resolve, reject) => {
        execFileCb(PYTHON3, [abmeldungScript, abmeldungPayload, abmeldungOut], { env: getPyEnv(), timeout: 30000 }, (err, stdout, stderr) => {
          if (err) { console.error('fill_abmeldung.py error:', stderr); return reject(new Error(stderr || err.message)); }
          if (stdout.startsWith('OK:')) resolve(abmeldungOut);
          else reject(new Error(stdout || 'Unknown error'));
        });
      });
      console.log('✅ Web submit: Abmeldung PDF generated:', abmeldungOut);

      // 2. Vollmacht PDF (Full Service)
      let vollmachtOut = null;
      if (session.data.service === 'full') {
        vollmachtOut = path.join(pdfsDir, 'Vollmacht_' + orderId + '.pdf');
        const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
        const vollmachtPayload = JSON.stringify({
          Vorname: d.firstName, Nachname: d.lastName, Bezirk: d.bezirk || 'Berlin', Datum: today,
          Geburtsdatum: d.dob || '', Adresse: session.data.fullAddress, AuszugDatum: d.moveOutDate || '',
          Language: session.lang, SignaturBase64: '',
          FamilyMembers: session.data.familyMembers || [],
        });
        try {
          execFileSync(PYTHON3, [vollmachtScript, vollmachtPayload, vollmachtOut], { env: getPyEnv(), timeout: 30000, stdio: 'pipe' });
          session._vollmachtPath = vollmachtOut;
          console.log('✅ Web submit: Vollmacht PDF generated:', vollmachtOut);
        } catch (ve) {
          console.error('⚠️ Vollmacht gen error (non-fatal):', ve.message);
          vollmachtOut = null;
        }
      }

      // 3. Upload PDFs to SharePoint (non-fatal)
      try {
        if (SP.isConfigured() && fs.existsSync(abmeldungOut)) {
          const spFields = { LastUpdated: new Date().toISOString() };
          const abUrl = await SP.uploadFile(orderId, abmeldungOut, 'Abmeldung_' + orderId + '.pdf');
          if (abUrl) spFields.AbmeldungUrl = abUrl;
          if (vollmachtOut && fs.existsSync(vollmachtOut)) {
            const voUrl = await SP.uploadFile(orderId, vollmachtOut, 'Vollmacht_' + orderId + '.pdf');
            if (voUrl) spFields.VollmachtUrl = voUrl;
          }
          await SP.updateCaseField(orderId, spFields);
        }
      } catch (spErr) { console.error('⚠️ Web submit SP upload (non-fatal):', spErr.message); }

      // 4. Email the documents to the client (reuses the bot-flow sender)
      const { sendAbmeldungEmail } = require('./email');
      emailResult = await sendAbmeldungEmail(session.data.email, abmeldungOut, session);
      if (emailResult && emailResult.success) {
        console.log('✅ Web submit: documents emailed to', session.data.email);
        if (SP.isConfigured()) {
          await SP.updateCaseStatus(orderId, 'pdf_generated',
            'PDFs generiert und per Email an ' + session.data.email + ' gesendet am ' + today +
            ' (Abmeldung' + (vollmachtOut ? ' + Vollmacht' : '') + ')');
        }
      } else {
        console.error('❌ Web submit: email failed:', emailResult && emailResult.error);
      }

      // 5. Cleanup temp PDFs
      for (const f of [abmeldungOut, vollmachtOut]) { if (f) { try { fs.unlinkSync(f); } catch (_) {} } }
    } catch (genErr) {
      console.error('❌ Web submit PDF/email error:', genErr.message);
    }

    console.log('🌐 Web submission: ' + orderId + ' — ' + d.firstName + ' ' + d.lastName + ' (' + d.email + ')');
    res.json({ ok: true, orderId, emailSent: !!(emailResult && emailResult.success) });
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data).substring(0, 500) : '';
    console.error('API submit-abmeldung error:', err.message, detail);
    res.status(500).json({ error: err.message, detail });
  }
});

// ── Health check ────────────────────────────────────────────────────────────
// ── DSGVO: Delete case (list item + folder) ─────────────────────────────────
app.delete('/api/cases/:orderId', authMiddleware, async (req, res) => {
  try {
    await SP.deleteCase(req.params.orderId);
    res.json({ ok: true, message: `Case ${req.params.orderId} deleted (DSGVO)` });
  } catch (err) {
    console.error('API DELETE case error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// DEBUG: Log viewer endpoint (temporary debug token)
app.get('/api/logs', (req, res) => {
  const pw = req.query.pw;
  if (pw !== process.env.DASHBOARD_PASSWORD && pw !== 'debug2026') return res.status(401).send('Unauthorized');
  const logs = global._logRing || [];
  const n = parseInt(req.query.n) || 50;
  res.type('text/plain').send(logs.slice(-n).join('\n'));
});

// ── Start server ────────────────────────────────────────────────────────────
function startServer(telegramBot) {
  if (telegramBot) app.set('telegramBot', telegramBot);
  return new Promise((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 Dashboard server running on port ${PORT}`);
      resolve(app);
    });
  });
}

module.exports = { app, startServer };
