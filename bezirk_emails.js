// ─── bezirk_emails.js ──────────────────────────────────────────────────────
// Zuordnung: Berliner Bezirk → Bürgeramt-E-Mail-Adresse
//
// ⚠️  WICHTIG: Alle E-Mail-Adressen vor dem Produktiveinsatz verifizieren!
//     Bürgerämter ändern gelegentlich ihre Kontaktdaten.
//     Stand: März 2026 — Quellen: berlin.de / Bezirksamt-Webseiten
// ───────────────────────────────────────────────────────────────────────────

const BEZIRK_EMAILS = {
  'Mitte':                       'buergeramt@ba-mitte.berlin.de',
  'Friedrichshain-Kreuzberg':    'buergeramt@ba-fk.berlin.de',
  'Pankow':                      'buergeramt@ba-pankow.berlin.de',
  'Charlottenburg-Wilmersdorf':  'buergeramt@ba-cw.berlin.de',
  'Spandau':                     'buergeramt@ba-spandau.berlin.de',
  'Steglitz-Zehlendorf':         'buergeramt@ba-sz.berlin.de',
  'Tempelhof-Schöneberg':        'buergeramt@ba-ts.berlin.de',
  'Neukölln':                    'buergeramt@ba-neukoelln.berlin.de',
  'Treptow-Köpenick':            'buergeramt@ba-tk.berlin.de',
  'Marzahn-Hellersdorf':         'buergeramt@ba-mh.berlin.de',
  'Lichtenberg':                 'buergeramt@ba-lichtenberg.berlin.de',
  'Reinickendorf':               'buergeramt@ba-reinickendorf.berlin.de',
};

/**
 * Gibt die Bürgeramt-E-Mail für einen Bezirk zurück.
 * @param {string} bezirk — Name des Bezirks (wie in plz_map.js)
 * @returns {string|null} E-Mail-Adresse oder null
 */
function getBezirkEmail(bezirk) {
  if (!bezirk) return null;
  return BEZIRK_EMAILS[bezirk] || null;
}

/**
 * Gibt alle Bezirke mit E-Mails als Array zurück.
 */
function listBezirke() {
  return Object.entries(BEZIRK_EMAILS).map(([bezirk, email]) => ({ bezirk, email }));
}

module.exports = { BEZIRK_EMAILS, getBezirkEmail, listBezirke };
