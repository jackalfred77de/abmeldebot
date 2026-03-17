// ─── bezirk_emails.js ──────────────────────────────────────────────────────
// Zuordnung: Berliner Bezirk → Bürgeramt-E-Mail-Adresse
//
// ✅ Verifiziert am 17.03.2026 via service.berlin.de + beratungsstellen.berlin
// ───────────────────────────────────────────────────────────────────────────

const BEZIRK_EMAILS = {
  'Mitte':                       'buergeramt@ba-mitte.berlin.de',
  'Friedrichshain-Kreuzberg':    'buergeramt@ba-fk.berlin.de',
  'Pankow':                      'buergeramt@ba-pankow.berlin.de',
  'Charlottenburg-Wilmersdorf':  'buergeramt@charlottenburg-wilmersdorf.de',
  'Spandau':                     'buergeramt-rathaus@ba-spandau.berlin.de',
  'Steglitz-Zehlendorf':         'buergeramt@ba-sz.berlin.de',
  'Tempelhof-Schöneberg':        'buergeramt@ba-ts.berlin.de',
  'Neukölln':                    'buergeramt@bezirksamt-neukoelln.de',
  'Treptow-Köpenick':            'buergeramt-1@ba-tk.berlin.de',
  'Marzahn-Hellersdorf':         'buergeramt.marzahnerpromenade@ba-mh.verwalt-berlin.de',
  'Lichtenberg':                 'LichtenbergerBuergeramt@lichtenberg.berlin.de',
  'Reinickendorf':               'buergeraemter@reinickendorf.berlin.de',
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
