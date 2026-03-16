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
    '<p>Mit freundlichen Gr\u00fc\u00dfen,</p>' +
    '<p><strong>FREDERICO E. REICHEL</strong><br/>' +
    '<strong>Rechtsanwalt</strong><br/>' +
    'Katzbachstraße 18<br/>' +
    '10965 Berlin<br/><br/>' +
    'T&nbsp;&nbsp;&nbsp;&nbsp; +49 30 44312792<br/>' +
    'Fx&nbsp;&nbsp; +49 30 75439509<br/>' +
    'E&nbsp;&nbsp;&nbsp;&nbsp; <a href="mailto:abmeldung@rafer.de">abmeldung@rafer.de</a><br/>' +
    'WhatsApp +49 155 60245902</p>';
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
