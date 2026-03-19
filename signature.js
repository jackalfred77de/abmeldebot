// signature.js — Email signature loader with Akagi font + logo
// Loads from email_signature.html at startup, falls back to plain HTML

const fs = require('fs');
const path = require('path');

let _cached = null;

function getEmailSignature() {
  if (_cached) return _cached;
  try {
    const sigPath = path.join(__dirname, 'email_signature.html');
    const raw = fs.readFileSync(sigPath, 'utf8');
    // Extract style + body content
    const styleMatch = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const styleTag = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';
      _cached = styleTag + bodyMatch[1];
    } else {
      _cached = raw;
    }
  } catch (e) {
    console.error('\u26a0\ufe0f Could not load email_signature.html:', e.message);
    _cached = '<table cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #000;padding-top:16px;margin-top:24px;font-family:Helvetica,Arial,sans-serif;">' +
      '<tr><td style="padding-bottom:12px;"><strong style="font-size:15px;letter-spacing:0.04em;text-transform:uppercase;">FREDERICO E. REICHEL</strong><br/><span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">Rechtsanwalt</span></td></tr>' +
      '<tr><td style="border-top:1px solid #ccc;padding-top:10px;font-size:11.5px;color:#222;line-height:1.7;">Katzbachstra\u00dfe 18 &middot; 10965 Berlin<br/>' +
      '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">T</span> +49 30 44312792<br/>' +
      '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">Fx</span> +49 30 75439509<br/>' +
      '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">E</span> <a href="mailto:abmeldung@rafer.de" style="color:#000;text-decoration:none;">abmeldung@rafer.de</a><br/>' +
      '<span style="display:inline-block;width:28px;color:#555;font-size:10.5px;">W</span> <a href="https://rafer.de" style="color:#000;text-decoration:none;">rafer.de</a><br/>' +
      '\ud83d\udcf1 WhatsApp + Telegram: +49 155 60245902</td></tr>' +
      '<tr><td style="border-top:1px solid #e0e0e0;padding-top:10px;margin-top:16px;font-size:9px;color:#888;line-height:1.55;">Diese E-Mail und etwaige Anh\u00e4nge k\u00f6nnen vertrauliche und/oder rechtlich gesch\u00fctzte Informationen enthalten. Falls Sie nicht der angegebene Empf\u00e4nger sind, benachrichtigen Sie uns bitte sofort und l\u00f6schen Sie diese E-Mail.</td></tr></table>';
  }
  return _cached;
}

module.exports = { getEmailSignature };
