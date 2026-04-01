// fetch_devecchio_email.js — Find and download Del Vecchio's email attachments
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
  const mailbox = process.env.INBOX_MONITOR_EMAIL || 'abmeldung@rafer.de';
  const step = process.argv[2] || 'list';

  if (step === 'list') {
    // List recent emails with attachments
    const resp = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${mailbox}/messages?$top=15&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments&$expand=attachments($select=id,name,contentType,size)`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const msgs = resp.data.value || [];
    msgs.forEach((m, i) => {
      const atts = (m.attachments || []).map(a => `${a.name} (${(a.size/1024).toFixed(1)}KB)`).join(', ');
      console.log(`[${i}] ${m.receivedDateTime} | ${m.from?.emailAddress?.address} | ${m.subject} | ${atts || 'no attachments'}`);
      if (m.hasAttachments) console.log(`    MSG_ID: ${m.id}`);
    });
  }

  if (step === 'download') {
    const msgId = process.argv[3];
    if (!msgId) { console.error('Usage: node fetch_devecchio_email.js download <MSG_ID>'); process.exit(1); }
    
    const outDir = path.join(__dirname, 'pdfs', 'devecchio_real');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    // Get message with full attachment content
    const resp = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${msgId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    
    const atts = resp.data.value || [];
    console.log(`Found ${atts.length} attachments:`);
    
    for (const att of atts) {
      if (att['@odata.type'] === '#microsoft.graph.itemAttachment') {
        console.log(`  SKIP (nested message): ${att.name}`);
        continue;
      }
      const buf = Buffer.from(att.contentBytes, 'base64');
      const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(outDir, safeName);
      fs.writeFileSync(outPath, buf);
      
      // Validate
      const header = buf.toString('utf8', 0, 5);
      const isPdf = header === '%PDF-';
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng = buf[0] === 0x89 && buf.toString('utf8', 1, 4) === 'PNG';
      const type = isPdf ? 'PDF' : isJpeg ? 'JPEG' : isPng ? 'PNG' : 'UNKNOWN';
      
      console.log(`  ✅ ${safeName} (${(buf.length/1024).toFixed(1)}KB, ${type})`);
    }
    console.log(`\nSaved to: ${outDir}`);
  }

  if (step === 'upload') {
    // Upload downloaded files to SharePoint, replacing the bogus ones
    const orderId = 'AB1774641279825NPT48';
    const SP = require('./sharepoint');
    const srcDir = path.join(__dirname, 'pdfs', 'devecchio_real');
    
    if (!fs.existsSync(srcDir)) { console.error('No files found. Run download first.'); process.exit(1); }
    
    const files = fs.readdirSync(srcDir);
    console.log(`Uploading ${files.length} files to SharePoint case ${orderId}...`);
    
    for (const f of files) {
      const fPath = path.join(srcDir, f);
      const buf = fs.readFileSync(fPath);
      const isPdf = buf.toString('utf8', 0, 5) === '%PDF-';
      const isImage = (buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89);
      
      // Determine target filename
      let spName = f;
      const fLower = f.toLowerCase();
      if (isPdf && fLower.includes('vollmacht')) {
        spName = `Vollmacht_${orderId}.pdf`;
      } else if (isPdf && fLower.includes('abmeldung')) {
        spName = `Abmeldung_${orderId}.pdf`;
      } else if (isPdf) {
        spName = `Dokument_${f}`;
      } else if (isImage && (fLower.includes('id') || fLower.includes('passport') || fLower.includes('ausweis'))) {
        spName = `Ausweis_${orderId}${path.extname(f)}`;
      }
      
      const url = await SP.uploadFile(orderId, fPath, spName);
      console.log(`  ☁️ ${f} → ${spName} (${url ? 'OK' : 'FAIL'})`);
      
      // Update SP fields
      if (spName.startsWith('Vollmacht_') && url) {
        await SP.updateCaseField(orderId, { VollmachtUrl: url });
        console.log('     → VollmachtUrl updated');
      } else if (spName.startsWith('Abmeldung_') && url) {
        await SP.updateCaseField(orderId, { AbmeldungUrl: url });
        console.log('     → AbmeldungUrl updated');
      } else if (spName.startsWith('Ausweis_') && url) {
        await SP.updateCaseField(orderId, { IdFrontUrl: url });
        console.log('     → IdFrontUrl updated');
      }
    }
    console.log('\nDone! Files uploaded to SharePoint.');
  }

  if (step === 'send-test') {
    // Send test email to buero@rafer.de with the real documents
    const orderId = 'AB1774641279825NPT48';
    const SP = require('./sharepoint');
    const { sendToBuergeramt } = require('./email');
    const bezirkEmails = require('./bezirk_emails');
    
    const caseData = await SP.getCase(orderId);
    if (!caseData) { console.error('Case not found'); process.exit(1); }
    
    // Override to test address
    const originalGetEmail = bezirkEmails.getBezirkEmail;
    bezirkEmails.getBezirkEmail = () => 'buero@rafer.de';
    
    try {
      console.log(`Sending test email to buero@rafer.de for ${caseData.ClientName}...`);
      const result = await sendToBuergeramt(caseData, { dryRun: false });
      if (result.success) {
        console.log(`✅ Email sent to ${result.to}`);
        console.log(`   Attachments: ${result.attachmentCount || 0}`);
        console.log(`   Subject: ${result.subject}`);
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
    } finally {
      bezirkEmails.getBezirkEmail = originalGetEmail;
    }
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
