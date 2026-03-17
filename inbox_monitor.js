// ─── inbox_monitor.js ──────────────────────────────────────────────────────
// Polling da inbox de abmeldung@rafer.de via Microsoft Graph API
// Detecta respostas dos Bürgerämter com Abmeldebestätigung anexa
// ───────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const { getGraphToken } = require('./email');
const SP = require('./sharepoint');
const { BEZIRK_EMAILS } = require('./bezirk_emails');

// ── Config ─────────────────────────────────────────────────────────────────
const INBOX_EMAIL      = process.env.INBOX_MONITOR_EMAIL || process.env.GRAPH_SENDER || 'buero@rafer.de';
const POLL_INTERVAL    = parseInt(process.env.INBOX_POLL_INTERVAL, 10) || 300000; // 5 min default
const FAX_DOMAINS      = (process.env.FAX_DOMAINS || 'sipgate.de,fax.de').split(',').map(d => d.trim().toLowerCase());
const ADMIN_CHAT_ID    = process.env.ADMIN_CHAT_ID || '';
const GRAPH            = 'https://graph.microsoft.com/v1.0';

// ── Build set of known Bürgeramt domains ───────────────────────────────────
// Extract unique domains from bezirk_emails.js for matching
const BUERGERAMT_DOMAINS = new Set();
Object.values(BEZIRK_EMAILS).forEach(email => {
  const domain = email.split('@')[1];
  if (domain) BUERGERAMT_DOMAINS.add(domain.toLowerCase());
});
// Also add common Berlin government domains
BUERGERAMT_DOMAINS.add('berlin.de');
BUERGERAMT_DOMAINS.add('verwalt-berlin.de');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if sender domain is from a Bürgeramt or fax service
 */
function isBuergeramtOrFax(senderEmail) {
  if (!senderEmail) return false;
  const domain = senderEmail.split('@')[1];
  if (!domain) return false;
  const lower = domain.toLowerCase();
  // Check exact match or subdomain match against known Bürgeramt domains
  for (const bd of BUERGERAMT_DOMAINS) {
    if (lower === bd || lower.endsWith('.' + bd)) return true;
  }
  // Check fax service domains
  for (const fd of FAX_DOMAINS) {
    if (lower === fd || lower.endsWith('.' + fd)) return true;
  }
  return false;
}

/**
 * Try to extract orderId from email subject/body
 */
function extractOrderId(subject, bodyPreview) {
  const text = (subject || '') + ' ' + (bodyPreview || '');
  const match = text.match(/ABM-\d{4}-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Try to determine Bezirk from sender email
 */
function getBezirkFromSender(senderEmail) {
  if (!senderEmail) return null;
  const lower = senderEmail.toLowerCase();
  for (const [bezirk, email] of Object.entries(BEZIRK_EMAILS)) {
    if (lower === email.toLowerCase()) return bezirk;
    // Partial domain match (e.g. ba-mitte.berlin.de in sender)
    const domain = email.split('@')[1];
    if (domain && lower.includes(domain.split('.')[0])) return bezirk;
  }
  return null;
}

/**
 * Try to match an email to a case using multiple strategies
 */
async function matchEmailToCase(subject, bodyPreview, senderEmail) {
  // Strategy 1: OrderId in subject/body
  const orderId = extractOrderId(subject, bodyPreview);
  if (orderId) {
    const caseData = await SP.getCase(orderId);
    if (caseData) return { caseData, matchMethod: 'orderId', orderId };
  }

  // Strategy 2: Bezirk from sender + cases with status sent_to_amt in that Bezirk
  const bezirk = getBezirkFromSender(senderEmail);
  if (bezirk) {
    const cases = await getCasesByStatusAndBezirk('sent_to_amt', bezirk);
    if (cases.length === 1) {
      return { caseData: cases[0], matchMethod: 'bezirk_unique', orderId: cases[0].Title };
    }
    // If multiple cases in same Bezirk, try name matching in subject
    if (cases.length > 1) {
      for (const c of cases) {
        const name = (c.ClientName || '').toLowerCase();
        const subjectLower = (subject || '').toLowerCase();
        const bodyLower = (bodyPreview || '').toLowerCase();
        const nameParts = name.split(' ').filter(p => p.length > 2);
        const matchCount = nameParts.filter(p => subjectLower.includes(p) || bodyLower.includes(p)).length;
        if (matchCount >= 1 && nameParts.length > 0) {
          return { caseData: c, matchMethod: 'bezirk_name', orderId: c.Title };
        }
      }
    }
  }

  // Strategy 3: Search by client name in subject across all sent_to_amt cases
  const allSentCases = await getCasesByStatus('sent_to_amt');
  for (const c of allSentCases) {
    const lastName = (c.ClientName || '').split(' ').slice(-1)[0];
    if (lastName && lastName.length > 2) {
      const subjectLower = (subject || '').toLowerCase();
      if (subjectLower.includes(lastName.toLowerCase())) {
        return { caseData: c, matchMethod: 'name_in_subject', orderId: c.Title };
      }
    }
  }

  return null;
}

/**
 * Get cases by status from SharePoint
 */
async function getCasesByStatus(status) {
  try {
    return await SP.listCases(`fields/Status eq '${status}'`);
  } catch (e) {
    console.error('getCasesByStatus error:', e.message);
    return [];
  }
}

/**
 * Get cases by status AND Bezirk
 */
async function getCasesByStatusAndBezirk(status, bezirk) {
  try {
    return await SP.listCases(`fields/Status eq '${status}' and fields/Bezirk eq '${bezirk}'`);
  } catch (e) {
    console.error('getCasesByStatusAndBezirk error:', e.message);
    return [];
  }
}

// ── Main inbox check ───────────────────────────────────────────────────────

async function checkInbox(telegramBot) {
  const token = await getGraphToken();

  // Fetch unread messages, expand attachments
  const url = `${GRAPH}/users/${INBOX_EMAIL}/mailFolders/inbox/messages` +
    `?$filter=isRead eq false` +
    `&$orderby=receivedDateTime desc` +
    `&$top=20` +
    `&$expand=attachments` +
    `&$select=id,subject,bodyPreview,from,receivedDateTime,attachments,isRead`;

  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const messages = resp.data.value || [];
  let fromBuergeramt = 0;
  let matched = 0;

  for (const msg of messages) {
    const senderEmail = msg.from?.emailAddress?.address || '';
    const senderName  = msg.from?.emailAddress?.name || senderEmail;
    const subject     = msg.subject || '';
    const bodyPreview = msg.bodyPreview || '';
    const receivedAt  = msg.receivedDateTime || '';

    // Skip if not from a Bürgeramt or fax service
    if (!isBuergeramtOrFax(senderEmail)) continue;
    fromBuergeramt++;

    // Try to match to a case
    const matchResult = await matchEmailToCase(subject, bodyPreview, senderEmail);

    if (matchResult) {
      const { caseData, matchMethod, orderId } = matchResult;
      matched++;

      // Extract PDF attachments
      const pdfAttachments = (msg.attachments || []).filter(att =>
        att.contentType === 'application/pdf' ||
        (att.name && att.name.toLowerCase().endsWith('.pdf'))
      );

      // Upload each PDF to SharePoint
      let uploadedUrl = '';
      for (let i = 0; i < pdfAttachments.length; i++) {
        const att = pdfAttachments[i];
        if (!att.contentBytes) continue;

        const filename = pdfAttachments.length === 1
          ? `Abmeldebestaetigung_${orderId}.pdf`
          : `Abmeldebestaetigung_${orderId}_${i + 1}.pdf`;

        try {
          const buffer = Buffer.from(att.contentBytes, 'base64');
          const spToken = await SP.__getTokenForUpload();
          const spPath = `${process.env.SP_CASES_FOLDER || 'Abmeldung/Cases'}/${orderId}/${filename}`;

          const uploadResp = await axios.put(
            `${GRAPH}/drives/${process.env.SP_DRIVE_ID}/root:/${spPath}:/content`,
            buffer,
            {
              headers: {
                Authorization: `Bearer ${spToken}`,
                'Content-Type': 'application/octet-stream',
              },
              timeout: 60000,
              maxBodyLength: 10 * 1024 * 1024,
            }
          );
          uploadedUrl = uploadResp.data.webUrl || '';
          console.log(`☁️  Inbox: Bestätigung uploaded: ${spPath}`);
        } catch (uploadErr) {
          console.error(`⚠️ Inbox upload error (${filename}):`, uploadErr.message);
        }
      }

      // Also handle image attachments (scanned confirmations)
      const imageAttachments = (msg.attachments || []).filter(att =>
        /^image\/(jpeg|png|tiff|gif)$/i.test(att.contentType || '')
      );
      for (let i = 0; i < imageAttachments.length; i++) {
        const att = imageAttachments[i];
        if (!att.contentBytes) continue;
        const ext = (att.contentType || '').includes('png') ? 'png' : 'jpg';
        const filename = `Abmeldebestaetigung_${orderId}_scan${i + 1}.${ext}`;
        try {
          const buffer = Buffer.from(att.contentBytes, 'base64');
          const spToken = await SP.__getTokenForUpload();
          const spPath = `${process.env.SP_CASES_FOLDER || 'Abmeldung/Cases'}/${orderId}/${filename}`;
          await axios.put(
            `${GRAPH}/drives/${process.env.SP_DRIVE_ID}/root:/${spPath}:/content`,
            buffer,
            {
              headers: { Authorization: `Bearer ${spToken}`, 'Content-Type': att.contentType },
              timeout: 60000,
              maxBodyLength: 10 * 1024 * 1024,
            }
          );
          if (!uploadedUrl) uploadedUrl = `(image: ${filename})`;
          console.log(`☁️  Inbox: Scan uploaded: ${spPath}`);
        } catch (e) {
          console.error(`⚠️ Inbox image upload error:`, e.message);
        }
      }

      // Update case status in SharePoint
      const dateStr = new Date(receivedAt).toLocaleDateString('de-DE');
      const timelineNote = `Abmeldebestätigung empfangen am ${dateStr} via Email von ${senderName} (match: ${matchMethod})`;

      try {
        await SP.updateCaseStatus(orderId, 'confirmation_received', timelineNote);
        if (uploadedUrl) {
          await SP.updateCaseField(orderId, { AbmeldebestaetigungUrl: uploadedUrl });
        }
      } catch (spErr) {
        console.error(`⚠️ Inbox SP update error for ${orderId}:`, spErr.message);
      }

      // Mark email as read
      try {
        await axios.patch(
          `${GRAPH}/users/${INBOX_EMAIL}/messages/${msg.id}`,
          { isRead: true },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
        );
      } catch (readErr) {
        console.error('⚠️ Inbox: failed to mark as read:', readErr.message);
      }

      // Notify admin via Telegram
      if (telegramBot && ADMIN_CHAT_ID) {
        const clientName = caseData.ClientName || orderId;
        const bezirk = caseData.Bezirk || '?';
        const attachCount = pdfAttachments.length + imageAttachments.length;
        try {
          await telegramBot.telegram.sendMessage(ADMIN_CHAT_ID,
            `📩 Abmeldebestätigung empfangen!\n` +
            `👤 ${clientName} (${orderId})\n` +
            `🏛 ${bezirk}\n` +
            `📎 ${attachCount} Anlage(n)\n` +
            `🔍 Match: ${matchMethod}\n` +
            `📧 Von: ${senderName}`
          );
        } catch (tgErr) {
          console.error('⚠️ Inbox TG notify error:', tgErr.message);
        }
      }

      // Notify client via Telegram if we have their chatId
      if (telegramBot && caseData.ChatId) {
        const lang = caseData.Language || 'de';
        const msgs = {
          de: `✅ Ihre Abmeldebestätigung (${orderId}) ist eingegangen! Wir leiten Ihnen das Dokument in Kürze weiter.`,
          pt: `✅ Sua confirmação de Abmeldung (${orderId}) chegou! Enviaremos o documento em breve.`,
          en: `✅ Your Abmeldung confirmation (${orderId}) has been received! We'll forward the document to you shortly.`,
        };
        try {
          await telegramBot.telegram.sendMessage(caseData.ChatId, msgs[lang] || msgs.de);
        } catch (_) {}
      }

    } else {
      // No match — notify admin but do NOT mark as read
      if (telegramBot && ADMIN_CHAT_ID) {
        try {
          await telegramBot.telegram.sendMessage(ADMIN_CHAT_ID,
            `📬 Email von Bürgeramt ohne Match:\n` +
            `📧 ${senderName} <${senderEmail}>\n` +
            `📋 Betreff: ${subject}\n` +
            `⏰ ${new Date(receivedAt).toLocaleString('de-DE')}`
          );
        } catch (tgErr) {
          console.error('⚠️ Inbox TG notify (no-match) error:', tgErr.message);
        }
      }
    }
  }

  console.log(`📬 Inbox check: ${messages.length} unread, ${fromBuergeramt} from Bürgeramt, ${matched} matched`);
  return { total: messages.length, fromBuergeramt, matched };
}

// ── Start/stop polling ─────────────────────────────────────────────────────

let _interval = null;

function startInboxMonitor(telegramBot) {
  if (!SP.isConfigured()) {
    console.log('ℹ️  InboxMonitor: SharePoint not configured — skipping');
    return null;
  }

  console.log(`📬 InboxMonitor starting (inbox: ${INBOX_EMAIL}, interval: ${POLL_INTERVAL / 1000}s)`);

  // Initial check after 10s delay (let everything else start first)
  setTimeout(async () => {
    try {
      await checkInbox(telegramBot);
    } catch (e) {
      console.error('📬 InboxMonitor initial check error:', e.message);
    }
  }, 10000);

  // Periodic polling
  _interval = setInterval(async () => {
    try {
      await checkInbox(telegramBot);
    } catch (e) {
      console.error('📬 InboxMonitor poll error:', e.message);
      // Don't stop — log and continue
    }
  }, POLL_INTERVAL);

  return _interval;
}

function stopInboxMonitor() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log('📬 InboxMonitor stopped');
  }
}

module.exports = {
  startInboxMonitor,
  stopInboxMonitor,
  checkInbox,
  // Export for testing/dashboard
  getCasesByStatus,
  getCasesByStatusAndBezirk,
};
