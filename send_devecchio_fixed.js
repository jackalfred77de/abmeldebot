// send_devecchio_fixed.js — Send Del Vecchio docs directly (bypass spFileToBase64)
// Reads the REAL downloaded files from disk and sends via Graph API
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ORDERID = 'AB1774641279825NPT48';
const TEST_DEST = 'buero@rafer.de';
const SRC_DIR = path.join(__dirname, 'pdfs', 'devecchio_real');

async function getToken() {
  const resp = await axios.post(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID,
      client_secret: process.env.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return resp.data.access_token;
}

async function main() {
  const token = await getToken();
  const sender = process.env.GRAPH_SENDER || 'buero@rafer.de';

  // Read the REAL files from disk
  const files = fs.readdirSync(SRC_DIR);
  console.log('Files in devecchio_real:', files);

  const attachments = [];
  for (const f of files) {
    const fPath = path.join(SRC_DIR, f);
    const buf = fs.readFileSync(fPath);
    const header = buf.toString('utf8', 0, 5);
    const isPdf = header === '%PDF-';
    const isPng = buf[0] === 0x89 && buf.toString('utf8', 1, 4) === 'PNG';
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;

    let attName, contentType;
    const fLower = f.toLowerCase();
    if (isPdf && fLower.includes('abmeldung')) {
      attName = `Abmeldung_${ORDERID}.pdf`;
      contentType = 'application/pdf';
    } else if (isPdf && fLower.includes('vollmacht')) {
      attName = `Vollmacht_${ORDERID}.pdf`;
      contentType = 'application/pdf';
    } else if (isPng) {
      attName = `Ausweis_${ORDERID}.png`;
      contentType = 'image/png';
    } else if (isJpeg) {
      attName = `Ausweis_${ORDERID}.jpg`;
      contentType = 'image/jpeg';
    } else {
      attName = f;
      contentType = 'application/octet-stream';
    }

    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attName,
      contentType: contentType,
      contentBytes: buf.toString('base64'),
    });
    console.log(`  ✅ ${f} → ${attName} (${contentType}, ${(buf.length/1024).toFixed(1)}KB)`);
  }

  // Build the formal email
  const SP = require('./sharepoint');
  const caseData = await SP.getCase(ORDERID);
  const clientName = caseData.ClientName || 'Luigi Vincenzo Del Vecchio';
  const nameParts = clientName.split(' ');
  const firstName = nameParts.slice(0, -1).join(' ') || 'Luigi Vincenzo';
  const lastName = nameParts.slice(-1)[0] || 'Del Vecchio';
  const bezirk = caseData.Bezirk || 'Friedrichshain-Kreuzberg';
  const address = caseData.BerlinAddress || 'Blücherstraße 33, 10961 Berlin';
  const moveOut = caseData.MoveOutDate || '28.02.2026';

  const subject = `Abmeldung — ${lastName}, ${firstName} — Vollmacht RA Reichel`;

  // Load email signature
  let signature = '';
  try {
    const { getEmailSignature } = require('./signature');
    signature = getEmailSignature ? getEmailSignature() : '';
  } catch(_) {
    signature = '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Mit freundlichen Grüßen<br/><br/><strong>Frederico E. Reichel</strong><br/>Rechtsanwalt<br/>Katzbachstraße 18, 10965 Berlin<br/>abmeldung@rafer.de</p>';
  }

  const htmlBody = `<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Rechtsanwalt Frederico E. Reichel — RAFER<br/>Katzbachstraße 18<br/>10965 Berlin</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Bezirksamt ${bezirk} von Berlin<br/>Abt. Bürgeramt<br/>— per E-Mail —</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;"><strong>Betreff: Abmeldung einer Wohnung gem. § 17 Abs. 2 BMG</strong><br/><strong>Mandant: Herrn ${firstName} ${lastName}</strong><br/><strong>Az.: ${ORDERID}</strong></p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Sehr geehrte Damen und Herren,</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">als bevollmächtigter Rechtsanwalt meines Mandanten, Herrn ${firstName} ${lastName}, zeige ich hiermit die Abmeldung der folgenden Wohnung in Berlin an:</p>
<table cellpadding="4" cellspacing="0" border="0" style="margin:8px 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;">
<tr><td style="padding-right:16px;"><strong>Adresse:</strong></td><td>${address}</td></tr>
<tr><td style="padding-right:16px;"><strong>Auszugsdatum:</strong></td><td>${moveOut}</td></tr></table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Als Anlagen überreiche ich:</p>
<ol style="margin:4px 0 16px 20px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;">
<li>Ausgefülltes Abmeldeformular</li>
<li>Vollmacht</li>
<li>Kopie des Ausweisdokuments meines Mandanten</li></ol>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Ich bitte um Bearbeitung und Übersendung der Abmeldebestätigung an meine Kanzlei unter der oben genannten Adresse, per E-Mail oder per Fax an:<br/><br/><strong>030 75439509</strong></p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#222;">Mit freundlichen Grüßen</p>
${signature}`;

  const dest = process.argv[2] === '--real' ? 'buergeramt@ba-fk.berlin.de' : TEST_DEST;

  console.log(`\n📧 Sending to: ${dest}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Attachments: ${attachments.length}`);

  if (process.argv[2] === '--dry') {
    console.log('\n🔍 DRY RUN — no email sent');
    return;
  }

  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,
    {
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: dest } }],
        ccRecipients: [{ emailAddress: { address: 'abmeldung@rafer.de' } }],
        replyTo: [{ emailAddress: { address: 'abmeldung@rafer.de' } }],
        attachments,
      },
      saveToSentItems: true,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  console.log(`\n✅ Email sent to ${dest} with ${attachments.length} attachments`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
