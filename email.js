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

module.exports = { getGraphToken, sendAbmeldungEmail };
