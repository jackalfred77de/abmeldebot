#!/usr/bin/env node
// ─── patch_2c.js ─────────────────────────────────────────────────────────
// Applies all Etapa 2C changes: sendToBuergeramt flow
// Run: node patch_2c.js
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
let changeCount = 0;

function patchFile(filename, patches) {
  const filePath = path.join(DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filename}`);
    return false;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  for (const p of patches) {
    if (p.type === 'replace') {
      const idx = content.indexOf(p.find);
      if (idx === -1) {
        if (p.optional) { console.log(`  ⏭  Skip (not found): ${p.desc}`); continue; }
        console.error(`  ❌ Anchor not found in ${filename}: ${p.desc}`);
        console.error(`     Looking for: ${p.find.substring(0, 80)}...`);
        return false;
      }
      content = content.substring(0, idx) + p.replacement + content.substring(idx + p.find.length);
      console.log(`  ✅ ${p.desc}`);
      changeCount++;
    } else if (p.type === 'append') {
      content += '\n' + p.text;
      console.log(`  ✅ ${p.desc}`);
      changeCount++;
    } else if (p.type === 'insertAfter') {
      const idx = content.indexOf(p.find);
      if (idx === -1) {
        if (p.optional) { console.log(`  ⏭  Skip (not found): ${p.desc}`); continue; }
        console.error(`  ❌ Anchor not found in ${filename}: ${p.desc}`);
        return false;
      }
      const insertPos = idx + p.find.length;
      content = content.substring(0, insertPos) + p.text + content.substring(insertPos);
      console.log(`  ✅ ${p.desc}`);
      changeCount++;
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PATCH email.js — add sendToBuergeramt function + update exports
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n📧 Patching email.js...');

const sendToBuergeramtFn = `

// ─── sendToBuergeramt ─────────────────────────────────────────────────────
// Sends formal Abmeldung submission email to the Bürgeramt on behalf of client
// ───────────────────────────────────────────────────────────────────────────
const { getBezirkEmail } = require('./bezirk_emails');

async function sendToBuergeramt(caseData, opts = {}) {
  const { dryRun = false } = opts;
  const bezirk = caseData.Bezirk || '';
  const amtEmail = getBezirkEmail(bezirk);
  if (!amtEmail) {
    return { success: false, error: 'Kein Bürgeramt-Email für Bezirk "' + bezirk + '" gefunden' };
  }
  const orderId    = caseData.Title || '';
  const clientName = caseData.ClientName || '';
  const nameParts  = clientName.split(' ');
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const gender     = caseData.Gender || '';
  const address    = caseData.BerlinAddress || '';
  const moveOut    = caseData.MoveOutDate || '';

  const isFemale     = gender === 'weiblich';
  const isDivers     = gender === 'divers';
  const mandant      = isDivers ? 'Mandant*in' : (isFemale ? 'Mandantin' : 'Mandant');
  const meines       = isDivers ? 'meines/meiner' : (isFemale ? 'meiner' : 'meines');
  const meinen       = isDivers ? 'meinen/meine' : (isFemale ? 'meine' : 'meinen');
  const bevollmArt   = isDivers ? 'bevollmächtigte/r' : (isFemale ? 'bevollmächtigte' : 'bevollmächtigter');
  const herrnFrau    = isDivers ? 'Herrn/Frau' : (isFemale ? 'Frau' : 'Herrn');
  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const subject = 'Abmeldung — ' + lastName + ', ' + firstName + ' — Vollmacht RA Reichel';

  const htmlBody = '<div style="font-family:Times New Roman,serif;font-size:12pt;color:#000;max-width:680px;">' +
    '<p style="text-align:right;margin-bottom:24px;">Berlin, den ' + today + '</p>' +
    '<p><strong>Kanzlei Reichel — RAFER</strong><br/>Rechtsanwalt Frederico E. Reichel<br/>Katzbachstraße 18<br/>10965 Berlin</p>' +
    '<p>Bezirksamt ' + bezirk + ' von Berlin<br/>Abt. Bürgeramt<br/>— per E-Mail —</p>' +
    '<p><strong>Betreff: Abmeldung einer Wohnung gem. § 17 Abs. 2 BMG</strong><br/>' +
    '<strong>' + mandant + ': ' + herrnFrau + ' ' + firstName + ' ' + lastName + '</strong><br/>' +
    '<strong>Az.: ' + orderId + '</strong></p>' +
    '<p>Sehr geehrte Damen und Herren,</p>' +
    '<p>als ' + bevollmArt + ' Rechtsanwalt ' + meines + ' ' + mandant + 's, ' + herrnFrau + ' ' + firstName + ' ' + lastName + ', ' +
    'zeige ich hiermit die Abmeldung der folgenden Wohnung in Berlin an:</p>' +
    '<table cellpadding="4" cellspacing="0" border="0" style="margin:16px 0;font-size:12pt;">' +
    '<tr><td style="padding-right:16px;"><strong>Adresse:</strong></td><td>' + address + '</td></tr>' +
    '<tr><td style="padding-right:16px;"><strong>Auszugsdatum:</strong></td><td>' + moveOut + '</td></tr></table>' +
    '<p>Die beigefügte Vollmacht berechtigt mich, im Namen ' + meines + ' ' + mandant + 's die Abmeldung ' +
    'zu erklären, erforderliche Unterlagen einzureichen sowie Bestätigungen und sonstige ' +
    'Schreiben im Zusammenhang mit der Abmeldung entgegenzunehmen.</p>' +
    '<p>Als Anlagen überreiche ich:</p>' +
    '<ol style="margin:8px 0 16px 20px;"><li>Ausgefülltes Abmeldeformular</li><li>Vollmacht</li>' +
    '<li>Kopie des Ausweisdokuments ' + meines + ' ' + mandant + 's</li></ol>' +
    '<p>Ich bitte um Bearbeitung und Übersendung der Abmeldebestätigung an ' + meinen + ' ' + mandant + 'en ' +
    'oder an meine Kanzlei unter der oben genannten Adresse.</p>' +
    '<p>Mit freundlichen Grüßen</p>' +
    '<p style="margin-top:32px;"><strong>Frederico E. Reichel</strong><br/>Rechtsanwalt</p>' +
    '<table cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #000;padding-top:12px;margin-top:32px;font-family:Helvetica,Arial,sans-serif;">' +
    '<tr><td style="font-size:11px;color:#333;line-height:1.7;">' +
    'Kanzlei Reichel — RAFER<br/>Katzbachstraße 18 · 10965 Berlin<br/>' +
    'T +49 30 44312792 · Fx +49 30 75439509<br/>' +
    'E <a href="mailto:abmeldung@rafer.de" style="color:#000;">abmeldung@rafer.de</a> · ' +
    'W <a href="https://rafer.de" style="color:#000;">rafer.de</a></td></tr>' +
    '<tr><td style="border-top:1px solid #e0e0e0;padding-top:8px;font-size:8.5pt;color:#888;line-height:1.5;">' +
    'Diese E-Mail und etwaige Anhänge können vertrauliche und/oder rechtlich geschützte Informationen enthalten. ' +
    'Falls Sie nicht der angegebene Empfänger sind, benachrichtigen Sie uns bitte sofort und löschen Sie diese E-Mail.</td></tr></table></div>';

  if (dryRun) {
    return { success: true, dryRun: true, to: amtEmail, subject, htmlBody, bezirk };
  }

  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    console.log('Graph API nicht konfiguriert — simuliere Bürgeramt-Email');
    return { success: true, simulated: true, to: amtEmail, subject, htmlBody, bezirk };
  }

  const attachments = [];
  const SP_DRIVE_ID = process.env.SP_DRIVE_ID || '';

  async function spFileToBase64(spUrl, fallbackName) {
    if (!spUrl || !SP_DRIVE_ID) return null;
    try {
      const token = await getGraphToken();
      const casesFolder = process.env.SP_CASES_FOLDER || 'Abmeldung/Cases';
      const drivePath = casesFolder + '/' + orderId + '/' + fallbackName;
      const resp = await axios.get(
        'https://graph.microsoft.com/v1.0/drives/' + SP_DRIVE_ID + '/root:/' + drivePath + ':/content',
        { headers: { Authorization: 'Bearer ' + token }, responseType: 'arraybuffer', timeout: 30000 }
      );
      return Buffer.from(resp.data).toString('base64');
    } catch (e) {
      console.error('⚠️ SP download error (' + fallbackName + '):', e.message);
      return null;
    }
  }

  const abmeldungB64 = await spFileToBase64(caseData.AbmeldungUrl, 'Abmeldung_' + orderId + '.pdf');
  if (abmeldungB64) {
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Abmeldung_' + orderId + '.pdf', contentType: 'application/pdf', contentBytes: abmeldungB64 });
  }
  const vollmachtB64 = await spFileToBase64(caseData.VollmachtUrl, 'Vollmacht_' + orderId + '.pdf');
  if (vollmachtB64) {
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Vollmacht_' + orderId + '.pdf', contentType: 'application/pdf', contentBytes: vollmachtB64 });
  }
  const idFrontB64 = await spFileToBase64(caseData.IdFrontUrl, 'id_frente.jpg');
  if (idFrontB64) {
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_vorne_' + orderId + '.jpg', contentType: 'image/jpeg', contentBytes: idFrontB64 });
  }
  const idBackB64 = await spFileToBase64(caseData.IdBackUrl, 'id_verso.jpg');
  if (idBackB64) {
    attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_hinten_' + orderId + '.jpg', contentType: 'image/jpeg', contentBytes: idBackB64 });
  }

  if (attachments.length === 0) {
    return { success: false, error: 'Keine Anhänge gefunden — Abmeldung/Vollmacht/ID fehlen in SharePoint' };
  }

  try {
    const token = await getGraphToken();
    await axios.post(
      'https://graph.microsoft.com/v1.0/users/' + GRAPH_SENDER + '/sendMail',
      {
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: amtEmail } }],
          ccRecipients: [{ emailAddress: { address: FIRM_EMAIL } }],
          replyTo: [{ emailAddress: { address: FIRM_EMAIL } }],
          attachments,
        },
        saveToSentItems: true,
      },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    console.log('📬 Bürgeramt-Email gesendet an ' + amtEmail + ' (' + bezirk + ') für ' + orderId);
    return { success: true, to: amtEmail, subject, bezirk, attachmentCount: attachments.length };
  } catch (err) {
    console.error('❌ Bürgeramt-Email Fehler:', err.message);
    return { success: false, error: err.message, to: amtEmail };
  }
}`;

patchFile('email.js', [
  {
    type: 'replace',
    find: "module.exports = { getGraphToken, sendAbmeldungEmail };",
    replacement: sendToBuergeramtFn + "\n\nmodule.exports = { getGraphToken, sendAbmeldungEmail, sendToBuergeramt };",
    desc: 'Add sendToBuergeramt function + update exports',
  },
]);


// ═══════════════════════════════════════════════════════════════════════════
// 2. PATCH server.js — add /api/cases/:id/preview-amt-email and /api/cases/:id/send-to-amt
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n🌐 Patching server.js...');

const serverNewEndpoints = `

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
`;

// Insert before the health check endpoint
patchFile('server.js', [
  {
    type: 'replace',
    find: "// ── Health check ──────────────────────────────────────────────────────────",
    replacement: serverNewEndpoints + "\n// ── Health check ──────────────────────────────────────────────────────────",
    desc: 'Add preview-amt-email and send-to-amt endpoints',
  },
]);


// ═══════════════════════════════════════════════════════════════════════════
// 3. PATCH server.js — expose Telegram bot instance to Express app
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n🤖 Patching server.js — expose bot to Express...');

patchFile('server.js', [
  {
    type: 'replace',
    find: "function startServer() {\n  return new Promise((resolve) => {\n    app.listen(PORT, '0.0.0.0', () => {\n      console.log(`🌐 Dashboard server running on port ${PORT}`);\n      resolve(app);\n    });\n  });\n}",
    replacement: "function startServer(telegramBot) {\n  if (telegramBot) app.set('telegramBot', telegramBot);\n  return new Promise((resolve) => {\n    app.listen(PORT, '0.0.0.0', () => {\n      console.log(`🌐 Dashboard server running on port ${PORT}`);\n      resolve(app);\n    });\n  });\n}",
    desc: 'startServer now accepts telegramBot param',
  },
]);


// ═══════════════════════════════════════════════════════════════════════════
// 4. PATCH sharepoint.js — add Gender field to ledger entry
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n📋 Patching sharepoint.js — add Gender field...');

patchFile('sharepoint.js', [
  {
    type: 'replace',
    find: "      Nationality:  data.nationality   || '',",
    replacement: "      Nationality:  data.nationality   || '',\n      Gender:       data.gender        || '',",
    desc: 'Add Gender field to createLedgerEntry',
  },
]);


// ═══════════════════════════════════════════════════════════════════════════
// 5. PATCH bot.js — pass bot to startServer, update approve for Full Service
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n🤖 Patching bot.js — pass bot to startServer...');

// Find startServer() call and add bot param
const botPath = path.join(DIR, 'bot.js');
let botContent = fs.readFileSync(botPath, 'utf8');

// Replace startServer() with startServer(bot) if not already done
if (botContent.includes('startServer()') && !botContent.includes('startServer(bot)')) {
  botContent = botContent.replace(/startServer\(\)/g, 'startServer(bot)');
  fs.writeFileSync(botPath, botContent, 'utf8');
  console.log('  ✅ startServer() → startServer(bot)');
  changeCount++;
} else {
  console.log('  ⏭  startServer(bot) already present or pattern not found');
}


// ═══════════════════════════════════════════════════════════════════════════
// 6. PATCH dashboard.html — add Bürgeramt send button + email preview modal
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n📊 Patching dashboard.html — add Bürgeramt UI...');

// Add new status to statusLabel
patchFile('dashboard.html', [
  {
    type: 'replace',
    find: "pending_review: 'Pending Review', submitted_to_behoerde: 'Submitted', completed: 'Completed',",
    replacement: "pending_review: 'Pending Review', submitted_to_behoerde: 'Submitted', sent_to_amt: 'Sent to Amt', completed: 'Completed',",
    desc: 'Add sent_to_amt to statusLabel',
  },
]);

// Add badge CSS for sent_to_amt
patchFile('dashboard.html', [
  {
    type: 'insertAfter',
    find: ".badge-submitted_to_behoerde { background: var(--orange-bg); color: var(--orange); }",
    text: "\n.badge-sent_to_amt { background: #e0f2fe; color: #0369a1; }",
    desc: 'Add CSS badge for sent_to_amt',
  },
]);

// Add sent_to_amt to filter dropdown
patchFile('dashboard.html', [
  {
    type: 'insertAfter',
    find: '<option value="submitted_to_behoerde">Submitted</option>',
    text: '\n        <option value="sent_to_amt">Sent to Amt</option>',
    desc: 'Add sent_to_amt to filter dropdown',
  },
]);

// Add the "An Bürgeramt senden" button in the action buttons section
patchFile('dashboard.html', [
  {
    type: 'replace',
    find: "      <button class=\"btn-action btn-submit\" onclick=\"updateStatus('submitted_to_behoerde')\" ${isFinal ? 'disabled' : ''}>📤 Einreichen</button>",
    replacement: "      <button class=\"btn-action btn-submit\" onclick=\"updateStatus('submitted_to_behoerde')\" ${isFinal ? 'disabled' : ''}>📤 Einreichen</button>\n      ${(c.Service === 'full' && c.Status === 'submitted_to_behoerde') ? '<button class=\"btn-action\" style=\"background:#0369a1;color:#fff;\" onclick=\"previewAmtEmail()\">📬 An Bürgeramt senden</button>' : ''}",
    desc: 'Add "An Bürgeramt senden" button for Full Service cases',
  },
]);

// Add the Bürgeramt email preview modal + JS functions
const amtModalAndFunctions = `

<!-- Bürgeramt Email Preview Modal -->
<div id="amtModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:2000;justify-content:center;align-items:center;">
  <div style="background:#fff;border-radius:12px;max-width:720px;width:90%;max-height:85vh;overflow-y:auto;padding:32px;position:relative;">
    <button onclick="closeAmtModal()" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>
    <h3 style="margin:0 0 8px;">📬 E-Mail-Vorschau: Bürgeramt</h3>
    <div id="amtPreviewMeta" style="font-size:13px;color:#666;margin-bottom:16px;"></div>
    <div id="amtPreviewBody" style="border:1px solid #e0e0e0;border-radius:8px;padding:24px;background:#fafafa;"></div>
    <div style="margin-top:20px;display:flex;gap:12px;justify-content:flex-end;">
      <button onclick="closeAmtModal()" style="padding:10px 20px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Abbrechen</button>
      <button id="amtSendBtn" onclick="confirmSendToAmt()" style="padding:10px 24px;border:none;border-radius:8px;background:#0369a1;color:#fff;font-weight:600;cursor:pointer;">📬 Jetzt senden</button>
    </div>
  </div>
</div>`;

const amtJsFunctions = `
async function previewAmtEmail() {
  if (!selectedOrderId) return;
  try {
    const data = await apiCall('GET', '/api/cases/' + selectedOrderId + '/preview-amt-email');
    if (!data.success) { showToast('Fehler: ' + (data.error || 'Vorschau fehlgeschlagen'), 'error'); return; }
    $('amtPreviewMeta').innerHTML = '<strong>An:</strong> ' + esc(data.to) + '<br/><strong>Betreff:</strong> ' + esc(data.subject) + '<br/><strong>Bezirk:</strong> ' + esc(data.bezirk);
    $('amtPreviewBody').innerHTML = data.htmlBody;
    $('amtModal').style.display = 'flex';
  } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
}
function closeAmtModal() { $('amtModal').style.display = 'none'; }
async function confirmSendToAmt() {
  if (!selectedOrderId) return;
  $('amtSendBtn').disabled = true;
  $('amtSendBtn').textContent = 'Wird gesendet...';
  try {
    const data = await apiCall('POST', '/api/cases/' + selectedOrderId + '/send-to-amt');
    if (data.success) {
      showToast('Email an Bürgeramt ' + (data.bezirk || '') + ' gesendet (' + (data.attachmentCount || 0) + ' Anhänge)');
      closeAmtModal();
      await fetchCases();
    } else {
      showToast('Fehler: ' + (data.error || 'Senden fehlgeschlagen'), 'error');
    }
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  } finally {
    $('amtSendBtn').disabled = false;
    $('amtSendBtn').textContent = '📬 Jetzt senden';
  }
}`;

// Insert modal HTML before closing </body>
patchFile('dashboard.html', [
  {
    type: 'replace',
    find: '</body>',
    replacement: amtModalAndFunctions + '\n</body>',
    desc: 'Add Bürgeramt email preview modal',
  },
]);

// Insert JS functions before the closing </script>
patchFile('dashboard.html', [
  {
    type: 'replace',
    find: '</script>',
    replacement: amtJsFunctions + '\n</script>',
    desc: 'Add Bürgeramt JS functions',
  },
]);

// Add sent_to_amt to the counter (count as submitted)
patchFile('dashboard.html', [
  {
    type: 'replace',
    find: "c.Status === 'submitted_to_behoerde'",
    replacement: "c.Status === 'submitted_to_behoerde' || c.Status === 'sent_to_amt'",
    desc: 'Include sent_to_amt in submitted counter',
    optional: true,
  },
]);


// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n✅ Patch complete! ${changeCount} changes applied.`);
console.log('Next: git add -A && git commit -m "Etapa 2C: Envio ao Bürgeramt" && git push origin main');
