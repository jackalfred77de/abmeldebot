// signature.js - Email signature for RAFER Abmeldung
// Matches the RAFER corporate signature (Brand/Signature/SVG/email sig-3.svg)
// Logo + Name + Rechtsanwalt + Address + Contact + Disclaimer
//
// Das Logo wird als Inline-Attachment (cid:) eingebettet, weil Outlook
// data:-URIs in E-Mails nicht rendert. Fuer Vorschauen im Browser
// (dryRun/Dashboard) ersetzt toPreviewHtml() die cid-Referenz durch die Data-URI.

const LOGO_B64 = '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';
const LOGO_DATA_URI = 'data:image/png;base64,' + LOGO_B64;
const LOGO_CID = 'raferlogo';

const CONTACT = [
  ['T', '030 75439506'],
  ['Fax', '030 75439509'],
  ['W', '+49 155 60245902']
];

function getEmailSignature(opts) {
  const preview = !!(opts && opts.preview);
  const logoSrc = preview ? LOGO_DATA_URI : 'cid:' + LOGO_CID;

  const contactCells = CONTACT.map(function (c) {
    return '<td style="padding:0 28px 0 0;font-size:12px;color:#333;white-space:nowrap;">' +
      '<strong style="font-size:11px;color:#000;">' + c[0] + '</strong> ' + c[1] +
    '</td>';
  }).join('');

  return (
    '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;font-family:Helvetica,Arial,sans-serif;max-width:600px;">' +

    '<tr><td style="padding-bottom:16px;">' +
      '<img src="' + logoSrc + '" width="60" height="64" alt="RAFER" style="display:block;width:60px;height:64px;border:0;" />' +
    '</td></tr>' +

    '<tr><td style="padding-bottom:4px;">' +
      '<strong style="font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:#000;">FREDERICO REICHEL</strong><br/>' +
      '<span style="font-size:12px;color:#333;">Rechtsanwalt</span>' +
    '</td></tr>' +

    '<tr><td style="padding-bottom:16px;font-size:12px;color:#666;line-height:1.7;">' +
      'Katzbachstra\u00dfe 18, 10965 Berlin<br/>' +
      '<a href="https://www.rafer.de" style="color:#666;text-decoration:none;">www.rafer.de</a>' +
    '</td></tr>' +

    '<tr><td style="border-top:1px solid #e0e0e0;padding:14px 0;">' +
      '<table cellpadding="0" cellspacing="0" border="0" style="font-family:Helvetica,Arial,sans-serif;">' +
        '<tr>' + contactCells + '</tr>' +
      '</table>' +
    '</td></tr>' +

    '<tr><td style="padding-bottom:14px;font-size:12px;color:#333;">' +
      '<strong style="font-size:11px;color:#000;">E</strong> ' +
      '<a href="mailto:abmeldung@rafer.de" style="color:#000;text-decoration:none;">abmeldung@rafer.de</a>' +
    '</td></tr>' +

    '<tr><td style="border-top:1px solid #e0e0e0;padding-top:14px;font-size:9.5px;color:#888;line-height:1.6;">' +
      'Diese E-Mail und etwaige Anh\u00e4nge k\u00f6nnen vertrauliche und/oder rechtlich gesch\u00fctzte Informationen enthalten. ' +
      'Falls Sie nicht der angegebene Empf\u00e4nger sind oder falls diese E-Mail irrt\u00fcmlich an Sie adressiert wurde, ' +
      'benachrichtigen Sie uns bitte in diesem Fall sofort durch Antwort-E-Mail und l\u00f6schen Sie diese E-Mail nebst etwaigen ' +
      'Anlagen von Ihrem System. Ebenso d\u00fcrfen Sie diese E-Mail oder seine Anlagen nicht kopieren oder an Dritte weitergeben. Vielen Dank.' +
    '</td></tr>' +

    '</table>'
  );
}

// Graph-Inline-Attachment fuer das Logo (gehoert in message.attachments)
function getLogoAttachment() {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'rafer-logo.png',
    contentType: 'image/png',
    contentBytes: LOGO_B64,
    isInline: true,
    contentId: LOGO_CID
  };
}

// Ersetzt cid:-Referenz durch Data-URI, damit Browser-Vorschauen das Logo zeigen
function toPreviewHtml(html) {
  return String(html).split('cid:' + LOGO_CID).join(LOGO_DATA_URI);
}

module.exports = { getEmailSignature, getLogoAttachment, toPreviewHtml, LOGO_CID };
