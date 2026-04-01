#!/usr/bin/env node
/**
 * test_e2e.js — End-to-end test script for RAFER Easy Abmeldung flow
 * 
 * Simulates a complete case lifecycle:
 *   1. Create case in SharePoint
 *   2. Generate Abmeldung PDF + Vollmacht PDF
 *   3. Upload documents to SharePoint
 *   4. Preview Bürgeramt email (dry run)
 *   5. Send test email to buero@rafer.de (never to real Bürgeramt)
 *   6. Validate all attachments are valid files
 *   7. Update status through the lifecycle
 *   8. Clean up (optional)
 *
 * Usage:
 *   node test_e2e.js                  # full run with default test data
 *   node test_e2e.js --persona maria  # use "maria" test persona
 *   node test_e2e.js --keep           # don't delete test case after
 *   node test_e2e.js --dry            # dry run, no emails sent
 *   node test_e2e.js --step 3         # run only up to step 3
 *
 * SAFETY: All emails go to buero@rafer.de. OrderIds start with TEST-.
 *         sendToBuergeramt is ALWAYS called with override destination.
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const { execFileSync } = require('child_process');

const BOT_DIR = __dirname;
const SP      = require('./sharepoint');
const { sendToBuergeramt, sendAbmeldungEmail, getGraphToken } = require('./email');
const axios   = require('axios');

// ── Config ──────────────────────────────────────────────────────────────────
const TEST_EMAIL_DEST = 'buero@rafer.de';   // ALL test emails go here
const ADMIN_CHAT_ID   = process.env.ADMIN_CHAT_ID || '661435601';
const GRAPH_SENDER    = process.env.GRAPH_SENDER || 'buero@rafer.de';

// ── Test Personas ───────────────────────────────────────────────────────────
const PERSONAS = {
  carlos: {
    firstName: 'Carlos', lastName: 'Testmann', birthName: '',
    gender: 'männlich', birthDate: '15.03.1990', birthPlace: 'São Paulo',
    birthCountry: 'Brasilien', nationality: 'brasilianisch',
    fullAddress: 'Teststraße 42, 10965 Berlin', plz: '10965',
    bezirk: 'Friedrichshain-Kreuzberg',
    moveOutDate: '30.04.2026',
    newStreet: 'Rua Teste 123', newPlzCity: '01310-100 São Paulo', newCountry: 'Brasilien',
    bisherigWohnungTyp: 'alleinige', neueWohnungExistiert: 'nein',
    email: 'test@rafer.de', phone: '+49 170 1234567',
    service: 'full', lang: 'pt',
  },
  maria: {
    firstName: 'Maria', lastName: 'Testfrau', birthName: 'Müller',
    gender: 'weiblich', birthDate: '22.07.1985', birthPlace: 'Berlin',
    birthCountry: 'Deutschland', nationality: 'deutsch',
    fullAddress: 'Musterweg 7, 10247 Berlin', plz: '10247',
    bezirk: 'Friedrichshain-Kreuzberg',
    moveOutDate: '15.05.2026',
    newStreet: 'Hauptstraße 1', newPlzCity: '80331 München', newCountry: 'Deutschland',
    bisherigWohnungTyp: 'alleinige', neueWohnungExistiert: 'ja',
    email: 'test@rafer.de', phone: '+49 171 9876543',
    service: 'full', lang: 'de',
  },
  luigi: {
    firstName: 'Luigi', lastName: 'Del Vecchio', birthName: '',
    gender: 'männlich', birthDate: '26.04.1971', birthPlace: 'Caserta',
    birthCountry: 'Italien', nationality: 'italienisch',
    fullAddress: 'Blücherstrasse 33, 10961 Berlin', plz: '10961',
    bezirk: 'Friedrichshain-Kreuzberg',
    moveOutDate: '30.04.2026',
    newStreet: 'Via Roma 15', newPlzCity: '80055 Portici (NA)', newCountry: 'Italien',
    bisherigWohnungTyp: 'alleinige', neueWohnungExistiert: 'nein',
    email: 'test@rafer.de', phone: '+49 172 7053734',
    service: 'full', lang: 'en',
  },
};

// ── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 ? (args[idx + 1] || true) : null;
}
const personaName = getArg('persona') || 'carlos';
const keepCase    = args.includes('--keep');
const dryOnly     = args.includes('--dry');
const maxStep     = parseInt(getArg('step')) || 99;

// ── Helpers ─────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN  = '\x1b[36m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

let stepNum = 0;
let passed  = 0;
let failed  = 0;
const results = [];

function logStep(name) {
  stepNum++;
  console.log(`\n${CYAN}${BOLD}━━━ Step ${stepNum}: ${name} ━━━${RESET}`);
}

function ok(msg) {
  passed++;
  results.push({ step: stepNum, status: '✅', msg });
  console.log(`  ${GREEN}✅ ${msg}${RESET}`);
}

function fail(msg, err) {
  failed++;
  results.push({ step: stepNum, status: '❌', msg });
  console.log(`  ${RED}❌ ${msg}${RESET}`);
  if (err) console.log(`     ${DIM}${err.message || err}${RESET}`);
}

function warn(msg) {
  results.push({ step: stepNum, status: '⚠️', msg });
  console.log(`  ${YELLOW}⚠️  ${msg}${RESET}`);
}

function info(msg) {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function getPyEnv() {
  const localPkgDir = path.join(BOT_DIR, '.python_packages');
  const persistentPkgDir = '/home/python_packages';
  return {
    ...process.env,
    PYTHONPATH: [persistentPkgDir, localPkgDir, process.env.PYTHONPATH || '']
      .filter(Boolean).join(':'),
  };
}

// ── SAFETY CHECK ────────────────────────────────────────────────────────────
function assertTestOrderId(orderId) {
  if (!orderId.startsWith('TEST-')) {
    throw new Error(`SAFETY: orderId "${orderId}" does not start with TEST-. Aborting.`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  const persona = PERSONAS[personaName];
  if (!persona) {
    console.error(`Unknown persona "${personaName}". Available: ${Object.keys(PERSONAS).join(', ')}`);
    process.exit(1);
  }

  const orderId = 'TEST-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();

  console.log(`${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  RAFER Easy — E2E Test                                 ║${RESET}`);
  console.log(`${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}`);
  console.log(`${BOLD}║${RESET}  Persona:   ${CYAN}${personaName}${RESET} (${persona.firstName} ${persona.lastName})`);
  console.log(`${BOLD}║${RESET}  OrderId:   ${CYAN}${orderId}${RESET}`);
  console.log(`${BOLD}║${RESET}  Email to:  ${CYAN}${TEST_EMAIL_DEST}${RESET} (NEVER real Bürgeramt)`);
  console.log(`${BOLD}║${RESET}  Dry only:  ${dryOnly ? 'yes' : 'no'}  |  Keep case: ${keepCase ? 'yes' : 'no'}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);

  assertTestOrderId(orderId);

  const session = {
    lang: persona.lang,
    chatId: ADMIN_CHAT_ID,
    data: { ...persona, orderId, sigMode: 'none', signatureImage: '' },
  };

  const PYTHON3 = process.env.PYTHON_PATH || 'python3';
  const pdfsDir = path.join(BOT_DIR, 'pdfs');
  if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });

  // ── Step 1: SharePoint — Create case folder ─────────────────────────────
  if (maxStep >= 1) {
    logStep('SharePoint — Create case folder');
    try {
      if (!SP.isConfigured()) throw new Error('SharePoint not configured (missing env vars)');
      await SP.createCaseFolder(orderId);
      ok(`Folder created: Abmeldung/Cases/${orderId}`);
    } catch (e) { fail('Could not create SP folder', e); }
  }

  // ── Step 2: Generate Abmeldung PDF ──────────────────────────────────────
  let abmeldungPath = null;
  if (maxStep >= 2) {
    logStep('Generate Abmeldung PDF');
    try {
      const scriptPath = path.join(BOT_DIR, 'fill_abmeldung.py');
      const outputPath = path.join(pdfsDir, `Abmeldung_${orderId}.pdf`);
      const today = new Date().toLocaleDateString('de-DE');
      const payload = JSON.stringify({
        Nachname: persona.lastName, Vorname: persona.firstName,
        Geburtsname: persona.birthName || '',
        Geschlecht: persona.gender || '',
        Geburtsdatum: persona.birthDate || '',
        Geburtsort: persona.birthPlace || '',
        Geburtsland: persona.birthCountry || '',
        Staatsangehoerigkeit: persona.nationality || '',
        Strasse: persona.fullAddress || '',
        PLZ: persona.plz || '',
        Bezirk: persona.bezirk || '',
        Auszugsdatum: persona.moveOutDate || '',
        NeueStrasse: persona.newStreet || '',
        NeuesLand: `${persona.newPlzCity || ''} ${persona.newCountry || ''}`.trim(),
        BisherigWohnung: persona.bisherigWohnungTyp || 'alleinige',
        NeueWohnungExistiert: persona.neueWohnungExistiert || 'nein',
        Datum: today, SignaturBase64: '',
        FamilyMembers: [],
      });

      const result = execFileSync(PYTHON3, [scriptPath, payload, outputPath], {
        env: getPyEnv(), timeout: 30000,
      }).toString();

      if (result.startsWith('OK:') && fs.existsSync(outputPath)) {
        const size = fs.statSync(outputPath).size;
        abmeldungPath = outputPath;
        ok(`Abmeldung PDF generated: ${(size / 1024).toFixed(1)} KB`);

        // Validate: is it a real PDF?
        const header = fs.readFileSync(outputPath, 'utf8').substring(0, 5);
        if (header === '%PDF-') ok('PDF header valid');
        else fail('PDF header invalid: ' + header);
      } else {
        fail('fill_abmeldung.py output unexpected: ' + result.substring(0, 100));
      }
    } catch (e) { fail('Abmeldung PDF generation failed', e); }
  }

  // ── Step 3: Generate Vollmacht PDF ──────────────────────────────────────
  let vollmachtPath = null;
  if (maxStep >= 3) {
    logStep('Generate Vollmacht PDF (unsigned — as sent to client)');
    try {
      const vollmachtScript = path.join(BOT_DIR, 'gen_vollmacht.py');
      vollmachtPath = path.join(pdfsDir, `Vollmacht_${orderId}.pdf`);
      const today2 = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const vollmachtData = JSON.stringify({
        Vorname: persona.firstName, Nachname: persona.lastName,
        Bezirk: persona.bezirk || 'Berlin', Datum: today2,
        Geburtsdatum: persona.birthDate || '',
        Adresse: persona.fullAddress || '',
        AuszugDatum: persona.moveOutDate || '',
        Language: persona.lang || 'de',
        SignaturBase64: '',  // unsigned — this is what client receives
        FamilyMembers: [],
      });

      execFileSync(PYTHON3, [vollmachtScript, vollmachtData, vollmachtPath], {
        env: getPyEnv(), timeout: 30000, stdio: 'pipe',
      });

      if (fs.existsSync(vollmachtPath)) {
        const size = fs.statSync(vollmachtPath).size;
        ok(`Vollmacht PDF generated (unsigned): ${(size / 1024).toFixed(1)} KB`);

        const header = fs.readFileSync(vollmachtPath, 'utf8').substring(0, 5);
        if (header === '%PDF-') ok('Vollmacht PDF header valid');
        else fail('Vollmacht PDF header invalid');
      } else {
        fail('Vollmacht PDF not created');
      }
    } catch (e) { fail('Vollmacht PDF generation failed', e); }
  }

  // ── Step 4: Upload documents to SharePoint ──────────────────────────────
  const fileUrls = {};
  if (maxStep >= 4) {
    logStep('Upload documents to SharePoint');
    try {
      // Upload Abmeldung PDF
      if (abmeldungPath && fs.existsSync(abmeldungPath)) {
        const url = await SP.uploadFile(orderId, abmeldungPath, `Abmeldung_${orderId}.pdf`);
        if (url) { fileUrls.abmeldung = url; ok('Abmeldung uploaded → ' + url.substring(0, 60) + '...'); }
        else fail('Abmeldung upload returned null');
      } else warn('Skipping Abmeldung upload — file not available');

      // Upload Vollmacht PDF
      if (vollmachtPath && fs.existsSync(vollmachtPath)) {
        const url = await SP.uploadFile(orderId, vollmachtPath, `Vollmacht_${orderId}.pdf`);
        if (url) { fileUrls.vollmacht = url; ok('Vollmacht uploaded → ' + url.substring(0, 60) + '...'); }
        else fail('Vollmacht upload returned null');
      } else warn('Skipping Vollmacht upload — file not available');

      // Upload a dummy ID image (create a simple 1x1 pixel JPEG for testing)
      const dummyIdPath = path.join(pdfsDir, `id_test_${orderId}.jpg`);
      // Minimal valid JPEG (1x1 red pixel)
      const jpegBuf = Buffer.from(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
        'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
        'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
        'CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
        'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMR' +
        'AD8AKwA//9k=',
        'base64'
      );
      fs.writeFileSync(dummyIdPath, jpegBuf);
      const idUrl = await SP.uploadFile(orderId, dummyIdPath, `Ausweis_${orderId}.jpg`);
      if (idUrl) { fileUrls.idFront = idUrl; ok('Test ID image uploaded'); }
      else warn('Test ID upload returned null');

      // Clean up temp ID file
      try { fs.unlinkSync(dummyIdPath); } catch(_) {}
    } catch (e) { fail('SharePoint upload failed', e); }
  }

  // ── Step 5: Create SharePoint ledger entry ──────────────────────────────
  if (maxStep >= 5) {
    logStep('SharePoint — Create ledger entry');
    try {
      const listItemId = await SP.createLedgerEntry(session, fileUrls);
      if (listItemId) ok(`Ledger entry created, item ID: ${listItemId}`);
      else fail('createLedgerEntry returned null');

      // Update status to awaiting_signature (simulating web submission)
      await SP.updateCaseStatus(orderId, 'awaiting_signature',
        '[TEST] Case created via test_e2e.js on ' + new Date().toISOString().split('T')[0]);
      ok('Status → awaiting_signature');
    } catch (e) { fail('Ledger entry creation failed', e); }
  }

  // ── Step 6: Simulate "client returns signed Vollmacht" ──────────────────
  if (maxStep >= 6) {
    logStep('Simulate signed Vollmacht return (update status)');
    try {
      // In real flow: client sends signed PDF back, admin uploads it
      // Here we just update status as if it happened
      await SP.updateCaseStatus(orderId, 'documents_ready',
        '[TEST] Signed Vollmacht received (simulated)');
      ok('Status → documents_ready');
    } catch (e) { fail('Status update failed', e); }
  }

  // ── Step 7: Preview Bürgeramt email (dry run) ───────────────────────────
  if (maxStep >= 7) {
    logStep('Preview Bürgeramt email (dry run)');
    try {
      const caseData = await SP.getCase(orderId);
      if (!caseData) throw new Error('Case not found in SharePoint');
      info(`Case retrieved: ${caseData.ClientName} / ${caseData.Bezirk}`);

      const preview = await sendToBuergeramt(caseData, { dryRun: true });
      if (preview.success) {
        ok(`Preview OK → would send to: ${preview.to}`);
        info(`Subject: ${preview.subject}`);
        info(`Bezirk: ${preview.bezirk}`);

        // SAFETY: verify the preview target is a real Bürgeramt
        if (preview.to && !preview.to.includes('rafer.de')) {
          ok(`Target is a Bürgeramt address: ${preview.to}`);
        } else {
          warn('Preview target is a rafer.de address (expected for some bezirke?)');
        }
      } else {
        fail('Preview failed: ' + (preview.error || 'unknown'));
      }
    } catch (e) { fail('Preview failed', e); }
  }

  // ── Step 8: Send test email to buero@rafer.de ───────────────────────────
  if (maxStep >= 8 && !dryOnly) {
    logStep(`Send test email to ${TEST_EMAIL_DEST}`);
    try {
      assertTestOrderId(orderId);
      const caseData = await SP.getCase(orderId);
      if (!caseData) throw new Error('Case not found');

      // SAFETY: Override the Bezirk email to our test address
      // We do this by temporarily patching bezirk_emails
      const bezirkEmails = require('./bezirk_emails');
      const originalGetEmail = bezirkEmails.getBezirkEmail;
      bezirkEmails.getBezirkEmail = () => TEST_EMAIL_DEST;

      try {
        const result = await sendToBuergeramt(caseData, { dryRun: false });
        if (result.success) {
          ok(`Email sent to ${result.to}`);
          info(`Attachments: ${result.attachmentCount || 0}`);

          // SAFETY: Verify it went to test address
          if (result.to === TEST_EMAIL_DEST) {
            ok('Confirmed: email went to TEST destination');
          } else {
            fail(`SAFETY VIOLATION: email went to ${result.to} instead of ${TEST_EMAIL_DEST}`);
          }

          // Update status
          await SP.updateCaseStatus(orderId, 'sent_to_amt',
            `[TEST] Email sent to ${TEST_EMAIL_DEST} on ${new Date().toISOString().split('T')[0]}`);
          ok('Status → sent_to_amt');
        } else {
          fail('Email send failed: ' + (result.error || 'unknown'));
        }
      } finally {
        // Restore original function
        bezirkEmails.getBezirkEmail = originalGetEmail;
      }
    } catch (e) { fail('Test email failed', e); }
  } else if (maxStep >= 8 && dryOnly) {
    logStep('Send test email (SKIPPED — dry run mode)');
    warn('Email send skipped (--dry flag)');
  }

  // ── Step 9: Validate SP documents are downloadable ──────────────────────
  if (maxStep >= 9) {
    logStep('Validate SharePoint documents are downloadable');
    try {
      const token = await SP.__getTokenForUpload();
      const driveId = process.env.SP_DRIVE_ID;
      const casesFolder = process.env.SP_CASES_FOLDER || 'Abmeldung/Cases';

      const filesToCheck = [
        { name: `Abmeldung_${orderId}.pdf`, type: 'PDF' },
        { name: `Vollmacht_${orderId}.pdf`, type: 'PDF' },
        { name: `Ausweis_${orderId}.jpg`, type: 'JPEG' },
      ];

      for (const f of filesToCheck) {
        try {
          const resp = await axios.get(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${casesFolder}/${orderId}/${f.name}:/content`,
            { headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer', timeout: 15000 }
          );
          const buf = Buffer.from(resp.data);
          const header = buf.toString('utf8', 0, 5);

          if (f.type === 'PDF' && header === '%PDF-') {
            ok(`${f.name}: downloadable & valid PDF (${(buf.length / 1024).toFixed(1)} KB)`);
          } else if (f.type === 'JPEG' && buf[0] === 0xFF && buf[1] === 0xD8) {
            ok(`${f.name}: downloadable & valid JPEG (${(buf.length / 1024).toFixed(1)} KB)`);
          } else {
            warn(`${f.name}: downloaded but header looks wrong (${header.substring(0, 10)})`);
          }
        } catch (e) {
          fail(`${f.name}: NOT downloadable from SharePoint`, e);
        }
      }
    } catch (e) { fail('Document validation failed', e); }
  }

  // ── Step 10: Cleanup ────────────────────────────────────────────────────
  if (maxStep >= 10 && !keepCase) {
    logStep('Cleanup — Delete test case');
    try {
      await SP.deleteCase(orderId);
      ok('SharePoint case deleted');
    } catch (e) { warn('Could not delete test case: ' + e.message); }

    // Clean local PDFs
    for (const p of [abmeldungPath, vollmachtPath]) {
      if (p && fs.existsSync(p)) { fs.unlinkSync(p); info(`Deleted local: ${path.basename(p)}`); }
    }
  } else if (maxStep >= 10) {
    logStep('Cleanup (SKIPPED — --keep flag)');
    warn(`Test case ${orderId} kept in SharePoint for manual inspection`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  Test Summary                                          ║${RESET}`);
  console.log(`${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}`);
  console.log(`${BOLD}║${RESET}  ${GREEN}Passed: ${passed}${RESET}  |  ${failed > 0 ? RED : GREEN}Failed: ${failed}${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);

  if (failed > 0) {
    console.log(`\n${RED}Failed steps:${RESET}`);
    results.filter(r => r.status === '❌').forEach(r => {
      console.log(`  ${RED}Step ${r.step}: ${r.msg}${RESET}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n${RED}FATAL: ${err.message}${RESET}`);
  console.error(err.stack);
  process.exit(2);
});
