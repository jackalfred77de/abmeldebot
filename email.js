// email.js - Microsoft Graph email sending

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GRAPH_TENANT_ID     = process.env.GRAPH_TENANT_ID     || '';
const GRAPH_CLIENT_ID     = process.env.GRAPH_CLIENT_ID     || '';
const GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const GRAPH_SENDER        = process.env.GRAPH_SENDER        || 'buero@rafer.de';
const FIRM_EMAIL          = 'abmeldung@rafer.de';

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

async function sendAbmeldungEmail(toEmail, pdfPath, session, buildIdPdf) {
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
  // Extra Abmeldung forms (for families >3 people)
  if (session._extraAbmeldungPaths && session._extraAbmeldungPaths.length > 0) {
    for (let i = 0; i < session._extraAbmeldungPaths.length; i++) {
      const extraPath = session._extraAbmeldungPaths[i];
      if (fs.existsSync(extraPath)) {
        attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: path.basename(extraPath),
          contentType: 'application/pdf',
          contentBytes: fs.readFileSync(extraPath).toString('base64'),
        });
      }
    }
  }
  if (!isDiy && (data.idFrontImage || data.idBackImage)) {
    try {
      const idPdfBytes = buildIdPdf ? await buildIdPdf(data.idFrontImage, data.idBackImage, orderId) : null;
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
  const htmlBody = '<p>Sehr geehrte/r ' + firstName + ' ' + lastName + ',</p>' +
    '<p>im Anhang finden Sie Ihr ausgef\u00fclltes Abmeldeformular (Aktenzeichen: <strong>' + orderId + '</strong>).</p>' +
    stepsHtml +
    '<p>Mit freundlichen Gr\u00fc\u00dfen</p>' +
    '<table cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #000;padding-top:16px;margin-top:24px;font-family:Helvetica,Arial,sans-serif;">' +
    '<tr><td style="padding-bottom:12px;">' +
    '<strong style="font-size:15px;letter-spacing:0.04em;text-transform:uppercase;">FREDERICO E. REICHEL</strong><br/>' +
    '<span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Rechtsanwalt</span>' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #ccc;padding-top:10px;font-size:11.5px;color:#222;line-height:1.7;">' +
    'Katzbachstra\u00dfe 18 &middot; 10965 Berlin<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">T</span> +49 30 44312792<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">Fx</span> +49 30 75439509<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">E</span> <a href="mailto:abmeldung@rafer.de" style="color:#000;text-decoration:none;">abmeldung@rafer.de</a><br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">W</span> <a href="https://rafer.de" style="color:#000;text-decoration:none;">rafer.de</a><br/>' +
    '\ud83d\udcf1 WhatsApp + Telegram: +49 155 60245902' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #e0e0e0;padding-top:10px;margin-top:16px;font-size:9px;color:#888;line-height:1.55;">' +
    'Diese E-Mail und etwaige Anh\u00e4nge k\u00f6nnen vertrauliche und/oder rechtlich gesch\u00fctzte Informationen enthalten. ' +
    'Falls Sie nicht der angegebene Empf\u00e4nger sind, benachrichtigen Sie uns bitte sofort und l\u00f6schen Sie diese E-Mail.' +
    '</td></tr></table>';
  try {
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
  } catch (emailErr) {
    console.error('❌ Graph API email error:', emailErr.message);
    return { success: false, error: emailErr.message };
  }
}



// ─── sendToBuergeramt ─────────────────────────────────────────────────────
// Sends formal Abmeldung submission email to the Bürgeramt on behalf of client
// ───────────────────────────────────────────────────────────────────────────
const { getBezirkEmail } = require('./bezirk_emails');

async function sendToBuergeramt(caseData, opts = {}) {
  const { dryRun = false } = opts;
  const bezirk = caseData.Bezirk || '';
  const amtEmail = getBezirkEmail(bezirk);
  if (!amtEmail) {
    return { success: false, error: 'Kein B\u00fcrgeramt-Email f\u00fcr Bezirk "' + bezirk + '" gefunden' };
  }
  const orderId    = caseData.Title || '';
  const clientName = caseData.ClientName || '';
  const nameParts  = clientName.split(' ');
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const gender     = caseData.Gender || '';
  const address    = caseData.BerlinAddress || '';
  const moveOut    = caseData.MoveOutDate || '';

  // Gender-aware: Mandant / Mandantin (no "Mandantins"!)
  const isFemale   = gender === 'weiblich';
  const isDivers   = gender === 'divers';
  const mandant    = isDivers ? 'Mandant*in' : (isFemale ? 'Mandantin' : 'Mandant');
  const mandanten  = isDivers ? 'Mandant*in' : (isFemale ? 'Mandantin' : 'Mandanten');
  const meiner     = isDivers ? 'meines/meiner' : (isFemale ? 'meiner' : 'meines');
  const herrnFrau  = isDivers ? 'Herrn/Frau' : (isFemale ? 'Frau' : 'Herrn');
  const bevollm    = isDivers ? 'bevollm\u00e4chtigte/r' : (isFemale ? 'bevollm\u00e4chtigte' : 'bevollm\u00e4chtigter');

  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const subject = 'Abmeldung \u2014 ' + lastName + ', ' + firstName + ' \u2014 Vollmacht RA Reichel';

  // Family members from SharePoint (JSON string)
  let familyNames = [];
  try {
    const fm = JSON.parse(caseData.FamilyMembers || '[]');
    familyNames = fm.map(function(m) { return (typeof m === 'object' && m.raw) ? m.raw : String(m); });
  } catch(_) {}

  // Build family section if applicable
  let familyHtml = '';
  if (familyNames.length > 0) {
    familyHtml = '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Die Abmeldung umfasst neben ' + herrnFrau + ' ' + firstName + ' ' + lastName + ' folgende Familienangeh\u00f6rige:</p>' +
      '<ul style="margin:4px 0 16px 20px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
      familyNames.map(function(n) { return '<li>' + n + '</li>'; }).join('') +
      '</ul>';
  }

  const htmlBody = '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
    'Rechtsanwalt Frederico E. Reichel \u2014 RAFER<br/>' +
    'Katzbachstra\u00dfe 18<br/>10965 Berlin</p>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
    'Bezirksamt ' + bezirk + ' von Berlin<br/>' +
    'Abt. B\u00fcrgeramt<br/>' +
    '\u2014 per E-Mail \u2014</p>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
    '<strong>Betreff: Abmeldung einer Wohnung gem. \u00a7 17 Abs. 2 BMG</strong><br/>' +
    '<strong>' + mandant + ': ' + herrnFrau + ' ' + firstName + ' ' + lastName + '</strong><br/>' +
    '<strong>Az.: ' + orderId + '</strong></p>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Sehr geehrte Damen und Herren,</p>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
    'als ' + bevollm + ' Rechtsanwalt ' + meiner + ' ' + mandanten + ', ' + herrnFrau + ' ' + firstName + ' ' + lastName + ', ' +
    'zeige ich hiermit die Abmeldung der folgenden Wohnung in Berlin an:</p>' +
    '<table cellpadding="4" cellspacing="0" border="0" style="margin:8px 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;">' +
    '<tr><td style="padding-right:16px;"><strong>Adresse:</strong></td><td>' + address + '</td></tr>' +
    '<tr><td style="padding-right:16px;"><strong>Auszugsdatum:</strong></td><td>' + moveOut + '</td></tr></table>' +
    familyHtml +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Als Anlagen \u00fcberreiche ich:</p>' +
    '<ol style="margin:4px 0 16px 20px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;">' +
    '<li>Ausgef\u00fclltes Abmeldeformular</li>' +
    '<li>Vollmacht</li>' +
    '<li>Kopie des Ausweisdokuments ' + meiner + ' ' + mandanten + '</li></ol>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">' +
    'Ich bitte um Bearbeitung und \u00dcbersendung der Abmeldebest\u00e4tigung an meine Kanzlei unter der oben genannten Adresse, per E-Mail oder per Fax an:<br/><br/><strong>030 75439509</strong></p>' +
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Mit freundlichen Gr\u00fc\u00dfen</p>' +
    '<table cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #000;padding-top:16px;margin-top:24px;font-family:Helvetica,Arial,sans-serif;">' +
    '<tr><td style="padding-bottom:12px;">' +
    '<strong style="font-size:15px;letter-spacing:0.04em;text-transform:uppercase;">FREDERICO E. REICHEL</strong><br/>' +
    '<span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Rechtsanwalt</span>' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #ccc;padding-top:10px;font-size:11.5px;color:#222;line-height:1.7;">' +
    'Katzbachstra\u00dfe 18 &middot; 10965 Berlin<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">T</span> +49 30 44312792<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">Fx</span> +49 30 75439509<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">E</span> <a href="mailto:abmeldung@rafer.de" style="color:#000;text-decoration:none;">abmeldung@rafer.de</a><br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">W</span> <a href="https://rafer.de" style="color:#000;text-decoration:none;">rafer.de</a><br/>' +
    '\ud83d\udcf1 WhatsApp + Telegram: +49 155 60245902' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #e0e0e0;padding-top:10px;margin-top:16px;font-size:9px;color:#888;line-height:1.55;">' +
    'Diese E-Mail und etwaige Anh\u00e4nge k\u00f6nnen vertrauliche und/oder rechtlich gesch\u00fctzte Informationen enthalten. ' +
    'Falls Sie nicht der angegebene Empf\u00e4nger sind, benachrichtigen Sie uns bitte sofort und l\u00f6schen Sie diese E-Mail.' +
    '</td></tr></table>';

  if (dryRun) {
    return { success: true, dryRun: true, to: amtEmail, subject, htmlBody, bezirk };
  }

  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    console.log('Graph API nicht konfiguriert \u2014 simuliere B\u00fcrgeramt-Email');
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
      console.error('\u26a0\ufe0f SP download error (' + fallbackName + '):', e.message);
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
    return { success: false, error: 'Keine Anh\u00e4nge gefunden \u2014 Abmeldung/Vollmacht/ID fehlen in SharePoint' };
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
    console.log('\ud83d\udcec B\u00fcrgeramt-Email gesendet an ' + amtEmail + ' (' + bezirk + ') f\u00fcr ' + orderId);
    return { success: true, to: amtEmail, subject, bezirk, attachmentCount: attachments.length };
  } catch (err) {
    console.error('\u274c B\u00fcrgeramt-Email Fehler:', err.message);
    return { success: false, error: err.message, to: amtEmail };
  }
}

// ─── sendBestaetigung ──────────────────────────────────────────────────────
// Sends the Abmeldebestätigung to the client by email
// ───────────────────────────────────────────────────────────────────────────

async function sendBestaetigung(caseData) {
  const orderId    = caseData.Title || '';
  const clientName = caseData.ClientName || '';
  const nameParts  = clientName.split(' ');
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';
  const toEmail    = caseData.Email || '';
  const lang       = (caseData.Language || 'de').toLowerCase();

  if (!toEmail) {
    return { success: false, error: 'Keine E-Mail-Adresse vorhanden' };
  }

  // 1. Download Abmeldebestätigung PDF from SharePoint
  const SP_DRIVE_ID = process.env.SP_DRIVE_ID || '';
  const casesFolder = process.env.SP_CASES_FOLDER || 'Abmeldung/Cases';

  async function spBestaetigungToBase64() {
    if (!SP_DRIVE_ID) return null;
    const token = await getGraphToken();
    // Try standard filename first
    const filenames = [
      'Abmeldebestaetigung_' + orderId + '.pdf',
      'Abmeldebestaetigung_' + orderId + '_1.pdf',
    ];
    for (const fn of filenames) {
      try {
        const drivePath = casesFolder + '/' + orderId + '/' + fn;
        const resp = await axios.get(
          'https://graph.microsoft.com/v1.0/drives/' + SP_DRIVE_ID + '/root:/' + drivePath + ':/content',
          { headers: { Authorization: 'Bearer ' + token }, responseType: 'arraybuffer', timeout: 30000 }
        );
        return { base64: Buffer.from(resp.data).toString('base64'), filename: fn };
      } catch (e) {
        if (e.response && e.response.status === 404) continue;
        console.error('⚠️ Bestätigung download error (' + fn + '):', e.message);
      }
    }
    return null;
  }

  const pdfData = await spBestaetigungToBase64();
  if (!pdfData) {
    return { success: false, error: 'Abmeldebestätigung PDF nicht in SharePoint gefunden' };
  }

  // 2. Build email body per language
  const subjects = {
    de: 'Ihre Abmeldebestätigung — Aktenzeichen ' + orderId,
    pt: 'Sua confirmação de Abmeldung — Ref. ' + orderId,
    en: 'Your deregistration confirmation — Ref. ' + orderId,
  };

  const bodyTexts = {
    de: '<p>Sehr geehrte/r ' + firstName + ' ' + lastName + ',</p>' +
        '<p>anbei erhalten Sie Ihre <strong>Abmeldebestätigung</strong> (Aktenzeichen: <strong>' + orderId + '</strong>).</p>' +
        '<p>Bitte bewahren Sie dieses Dokument sorgfältig auf. Es dient als Nachweis Ihrer Abmeldung aus Berlin.</p>' +
        '<p>Sollten Sie Fragen haben, stehen wir Ihnen gerne zur Verfügung.</p>' +
        '<p>Mit freundlichen Grüßen</p>',
    pt: '<p>Prezado(a) Sr(a). ' + firstName + ' ' + lastName + ',</p>' +
        '<p>em anexo encontra a sua <strong>confirmação de cancelamento de residência</strong> (Abmeldebestätigung, referência: <strong>' + orderId + '</strong>).</p>' +
        '<p>Por favor, guarde este documento com cuidado. Ele serve como comprovativo do seu cancelamento de residência em Berlim.</p>' +
        '<p>Se tiver alguma dúvida, estamos à sua disposição.</p>' +
        '<p>Atenciosamente</p>',
    en: '<p>Dear ' + firstName + ' ' + lastName + ',</p>' +
        '<p>please find attached your <strong>deregistration confirmation</strong> (Abmeldebestätigung, reference: <strong>' + orderId + '</strong>).</p>' +
        '<p>Please keep this document in a safe place. It serves as proof of your deregistration from Berlin.</p>' +
        '<p>If you have any questions, please do not hesitate to contact us.</p>' +
        '<p>Kind regards</p>',
  };

  const signatureHtml = '<table cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #000;padding-top:16px;margin-top:24px;font-family:Helvetica,Arial,sans-serif;">' +
    '<tr><td style="padding-bottom:12px;">' +
    '<strong style="font-size:15px;letter-spacing:0.04em;text-transform:uppercase;">FREDERICO E. REICHEL</strong><br/>' +
    '<span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Rechtsanwalt</span>' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #ccc;padding-top:10px;font-size:11.5px;color:#222;line-height:1.7;">' +
    'Katzbachstra\u00dfe 18 &middot; 10965 Berlin<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">T</span> +49 30 44312792<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">Fx</span> +49 30 75439509<br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">E</span> <a href="mailto:abmeldung@rafer.de" style="color:#000;text-decoration:none;">abmeldung@rafer.de</a><br/>' +
    '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">W</span> <a href="https://rafer.de" style="color:#000;text-decoration:none;">rafer.de</a><br/>' +
    '\ud83d\udcf1 WhatsApp + Telegram: +49 155 60245902' +
    '</td></tr>' +
    '<tr><td style="border-top:1px solid #e0e0e0;padding-top:10px;margin-top:16px;font-size:9px;color:#888;line-height:1.55;">' +
    'Diese E-Mail und etwaige Anhänge können vertrauliche und/oder rechtlich geschützte Informationen enthalten. ' +
    'Falls Sie nicht der angegebene Empfänger sind, benachrichtigen Sie uns bitte sofort und löschen Sie diese E-Mail.' +
    '</td></tr></table>';

  const htmlBody = (bodyTexts[lang] || bodyTexts.de) + signatureHtml;
  const subject  = subjects[lang] || subjects.de;

  // 3. Send via Graph API
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    console.log('Graph API nicht konfiguriert — simuliere Bestätigung-Email');
    return { success: true, simulated: true };
  }

  try {
    const token = await getGraphToken();
    await axios.post(
      'https://graph.microsoft.com/v1.0/users/' + GRAPH_SENDER + '/sendMail',
      {
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: toEmail } }],
          replyTo: [{ emailAddress: { address: FIRM_EMAIL } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: pdfData.filename,
            contentType: 'application/pdf',
            contentBytes: pdfData.base64,
          }],
        },
        saveToSentItems: true,
      },
      {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    console.log('📋 Bestätigung-Email gesendet an ' + toEmail + ' (' + orderId + ')');
    return { success: true, to: toEmail };
  } catch (err) {
    console.error('❌ Bestätigung-Email Fehler:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getGraphToken, sendAbmeldungEmail, sendToBuergeramt, sendBestaetigung };
