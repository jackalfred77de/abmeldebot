// patch_email_fixes.js — Apply 4 fixes to email.js
// 1. Fix name splitting (handle multi-word last names like "Del Vecchio")
// 2. Add TEST_MODE override for Bürgeramt email destination
// 3. Fix image format detection (PNG vs JPEG) in buildIdPdfFromBase64 and attachments
// 4. Detect content type from SP file content instead of assuming JPEG

const fs = require('fs');
const emailPath = __dirname + '/email.js';
let code = fs.readFileSync(emailPath, 'utf8');
let changes = 0;

// ── FIX 1: Name splitting ────────────────────────────────────────────────
// Old: splits by space, takes first as firstName, rest as lastName
// Problem: "Luigi Vincenzo Del Vecchio" → firstName="Luigi", lastName="Vincenzo Del Vecchio"
//   but Subject becomes "Vecchio, Luigi Vincenzo Del" — wrong
// New: use ClientFirstName/ClientLastName from SP if available, else smarter split
const oldNameSplit = [
  "  const clientName = caseData.ClientName || '';",
  "  const nameParts  = clientName.split(' ');",
  "  const firstName  = nameParts[0] || '';",
  "  const lastName   = nameParts.slice(1).join(' ') || '';",
].join('\n');

const newNameSplit = [
  "  const clientName = caseData.ClientName || '';",
  "  // Use explicit first/last name fields if available, else split smartly",
  "  const firstName  = caseData.ClientFirstName || clientName.split(' ')[0] || '';",
  "  const lastName   = caseData.ClientLastName || clientName.split(' ').slice(1).join(' ') || '';",
].join('\n');

if (code.includes(oldNameSplit)) {
  code = code.replace(oldNameSplit, newNameSplit);
  changes++;
  console.log('✅ Fix 1: Name splitting — uses ClientFirstName/ClientLastName fields');
} else {
  console.log('⚠️  Fix 1: Name split anchor not found — may already be patched');
}

// ── FIX 2: TEST_MODE override ────────────────────────────────────────────
// Add env-based override so TEST_MODE=true routes all Bürgeramt emails to TEST_EMAIL_DEST
const oldAmtEmail = "  const amtEmail = getBezirkEmail(bezirk);";
const newAmtEmail = [
  "  let amtEmail = getBezirkEmail(bezirk);",
  "  // TEST_MODE: override destination to prevent accidental Bürgeramt emails",
  "  const testDest = process.env.TEST_EMAIL_DEST;",
  "  if (process.env.TEST_MODE === 'true' && testDest) {",
  "    console.log('⚠️  TEST_MODE: Redirecting Bürgeramt email from ' + amtEmail + ' → ' + testDest);",
  "    amtEmail = testDest;",
  "  }",
].join('\n');

if (code.includes(oldAmtEmail)) {
  code = code.replace(oldAmtEmail, newAmtEmail);
  changes++;
  console.log('✅ Fix 2: TEST_MODE override — env TEST_MODE=true + TEST_EMAIL_DEST=buero@rafer.de');
} else {
  console.log('⚠️  Fix 2: amtEmail anchor not found');
}

// ── FIX 3: buildIdPdfFromBase64 — detect image format from content ───────
// Problem: files are saved as .jpg but could be PNG → fitz crashes
// Fix: detect magic bytes and use correct extension
const oldFrontPath = "  const frontPath = require('path').join(tmpDir, 'id_front_' + orderId + '.jpg');";
const newFrontPath = [
  "  // Detect image format from content (magic bytes) instead of assuming JPEG",
  "  const frontBuf = Buffer.from(frontB64, 'base64');",
  "  const frontIsPng = frontBuf[0] === 0x89 && frontBuf.toString('utf8', 1, 4) === 'PNG';",
  "  const frontExt = frontIsPng ? '.png' : '.jpg';",
  "  const frontPath = require('path').join(tmpDir, 'id_front_' + orderId + frontExt);",
].join('\n');

if (code.includes(oldFrontPath)) {
  code = code.replace(oldFrontPath, newFrontPath);
  changes++;
  console.log('✅ Fix 3a: frontPath — detect PNG vs JPEG from magic bytes');
} else {
  console.log('⚠️  Fix 3a: frontPath anchor not found');
}

const oldBackPath = "  const backPath = require('path').join(tmpDir, 'id_back_' + orderId + '.jpg');";
const newBackPath = [
  "  let backPath = require('path').join(tmpDir, 'id_back_' + orderId + '.jpg');",
].join('\n');

if (code.includes(oldBackPath)) {
  code = code.replace(oldBackPath, newBackPath);
  changes++;
  console.log('✅ Fix 3b: backPath — made mutable for format detection');
} else {
  console.log('⚠️  Fix 3b: backPath anchor not found');
}

// Also fix the writeFileSync for front — it was writing frontB64 but we already have frontBuf
const oldWriteFront = "  fs.writeFileSync(frontPath, Buffer.from(frontB64, 'base64'));";
const newWriteFront = "  fs.writeFileSync(frontPath, frontBuf);";

if (code.includes(oldWriteFront)) {
  code = code.replace(oldWriteFront, newWriteFront);
  changes++;
  console.log('✅ Fix 3c: writeFileSync uses existing buffer');
} else {
  console.log('⚠️  Fix 3c: writeFileSync anchor not found');
}

// Fix the back image too — detect format
const oldWriteBack = "    fs.writeFileSync(backPath, Buffer.from(backB64, 'base64'));";
const newWriteBack = [
  "    const backBuf = Buffer.from(backB64, 'base64');",
  "    const backIsPng = backBuf[0] === 0x89 && backBuf.toString('utf8', 1, 4) === 'PNG';",
  "    if (backIsPng) backPath = require('path').join(tmpDir, 'id_back_' + orderId + '.png');",
  "    fs.writeFileSync(backPath, backBuf);",
].join('\n');

if (code.includes(oldWriteBack)) {
  code = code.replace(oldWriteBack, newWriteBack);
  changes++;
  console.log('✅ Fix 3d: back image format detection');
} else {
  console.log('⚠️  Fix 3d: writeFileSync back anchor not found');
}

// ── FIX 4: Fallback attachments — detect content type from base64 content ─
// When buildIdPdf fails and we fall back to raw image attachments,
// detect PNG vs JPEG instead of hardcoding image/jpeg
const oldFallbackFront = "        attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_vorne_' + orderId + '.jpg', contentType: 'image/jpeg', contentBytes: idFrontB64 });";
const newFallbackFront = [
  "        // Detect image type from base64 content",
  "        const frontBuf4 = Buffer.from(idFrontB64.substring(0, 20), 'base64');",
  "        const frontIsPng4 = frontBuf4[0] === 0x89 && frontBuf4.toString('utf8', 1, 4) === 'PNG';",
  "        const frontCT = frontIsPng4 ? 'image/png' : 'image/jpeg';",
  "        const frontExt4 = frontIsPng4 ? '.png' : '.jpg';",
  "        attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_vorne_' + orderId + frontExt4, contentType: frontCT, contentBytes: idFrontB64 });",
].join('\n');

// This pattern appears twice (in try catch), replace both
let fallbackCount = 0;
while (code.includes(oldFallbackFront)) {
  code = code.replace(oldFallbackFront, newFallbackFront);
  fallbackCount++;
}
if (fallbackCount > 0) {
  changes += fallbackCount;
  console.log(`✅ Fix 4a: Front fallback content-type detection (${fallbackCount} occurrences)`);
} else {
  console.log('⚠️  Fix 4a: Front fallback anchor not found');
}

const oldFallbackBack = "        if (idBackB64) attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_hinten_' + orderId + '.jpg', contentType: 'image/jpeg', contentBytes: idBackB64 });";
const newFallbackBack = [
  "        if (idBackB64) {",
  "          const backBuf4 = Buffer.from(idBackB64.substring(0, 20), 'base64');",
  "          const backIsPng4 = backBuf4[0] === 0x89 && backBuf4.toString('utf8', 1, 4) === 'PNG';",
  "          const backCT = backIsPng4 ? 'image/png' : 'image/jpeg';",
  "          const backExt4 = backIsPng4 ? '.png' : '.jpg';",
  "          attachments.push({ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Ausweis_hinten_' + orderId + backExt4, contentType: backCT, contentBytes: idBackB64 });",
  "        }",
].join('\n');

let backFallbackCount = 0;
while (code.includes(oldFallbackBack)) {
  code = code.replace(oldFallbackBack, newFallbackBack);
  backFallbackCount++;
}
if (backFallbackCount > 0) {
  changes += backFallbackCount;
  console.log(`✅ Fix 4b: Back fallback content-type detection (${backFallbackCount} occurrences)`);
} else {
  console.log('⚠️  Fix 4b: Back fallback anchor not found');
}

// ── Also fix the spFileToBase64 fallback name for ID ─────────────────────
// The fallback assumes .jpg but could be .png — need to try both or detect from SP URL
const oldIdFrontFallback = "  const idFrontB64 = await spFileToBase64(caseData.IdFrontUrl, 'id_frente.jpg');";
const newIdFrontFallback = [
  "  // Try to detect extension from SP URL, fallback to trying both",
  "  const idFrontExt = (caseData.IdFrontUrl || '').match(/\\.(png|jpg|jpeg)$/i)?.[0] || '.jpg';",
  "  const idFrontFallback = 'Ausweis_' + orderId + idFrontExt;",
  "  const idFrontB64 = await spFileToBase64(caseData.IdFrontUrl, idFrontFallback);",
].join('\n');

if (code.includes(oldIdFrontFallback)) {
  code = code.replace(oldIdFrontFallback, newIdFrontFallback);
  changes++;
  console.log('✅ Fix 4c: ID front fallback name from SP URL extension');
} else {
  console.log('⚠️  Fix 4c: idFrontB64 fallback anchor not found');
}

const oldIdBackFallback = "  const idBackB64 = await spFileToBase64(caseData.IdBackUrl, 'id_verso.jpg');";
const newIdBackFallback = [
  "  const idBackExt = (caseData.IdBackUrl || '').match(/\\.(png|jpg|jpeg)$/i)?.[0] || '.jpg';",
  "  const idBackFallback = 'Ausweis_hinten_' + orderId + idBackExt;",
  "  const idBackB64 = await spFileToBase64(caseData.IdBackUrl, idBackFallback);",
].join('\n');

if (code.includes(oldIdBackFallback)) {
  code = code.replace(oldIdBackFallback, newIdBackFallback);
  changes++;
  console.log('✅ Fix 4d: ID back fallback name from SP URL extension');
} else {
  console.log('⚠️  Fix 4d: idBackB64 fallback anchor not found');
}

// ── Write patched file ──────────────────────────────────────────────────
fs.writeFileSync(emailPath, code);
console.log(`\n✅ Done: ${changes} changes applied to email.js`);
