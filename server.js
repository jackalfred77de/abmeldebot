// ─── server.js ─────────────────────────────────────────────────────────────
// Express server para o Dashboard do AbmeldeBot
// Corre no mesmo processo que o bot Telegram
// ───────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const SP      = require('./sharepoint');

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
    console.error('API /cases error:', err.message);
    res.status(500).json({ error: err.message });
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
    console.error('API PATCH status error:', err.message);
    res.status(500).json({ error: err.message });
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
