// nationality.js - Nationality normalization (PT/EN → DE)

// ─── NATIONALITY MAP (PT/EN → DE) ──────────────────────────────────────────
const NATIONALITY_MAP = {
  // Português → Alemão
  'brasil': 'Brasilianisch', 'brasileira': 'Brasilianisch', 'brasileiro': 'Brasilianisch',
  'portugal': 'Portugiesisch', 'portuguesa': 'Portugiesisch', 'português': 'Portugiesisch',
  'alemanha': 'Deutsch', 'alemão': 'Deutsch', 'alemã': 'Deutsch',
  'italia': 'Italienisch', 'itália': 'Italienisch', 'italiana': 'Italienisch', 'italiano': 'Italienisch',
  'espanha': 'Spanisch', 'espanhola': 'Spanisch', 'espanhol': 'Spanisch',
  'franca': 'Französisch', 'frança': 'Französisch', 'francesa': 'Französisch', 'francês': 'Französisch',
  'estados unidos': 'Amerikanisch', 'eua': 'Amerikanisch', 'usa': 'Amerikanisch',
  'angola': 'Angolanisch', 'moçambique': 'Mosambikanisch', 'mozambique': 'Mosambikanisch',
  'cabo verde': 'Kapverdisch', 'são tomé': 'São-Tomeisch',
  'india': 'Indisch', 'índia': 'Indisch', 'indiana': 'Indisch', 'indiano': 'Indisch',
  'china': 'Chinesisch', 'chinesa': 'Chinesisch', 'chinês': 'Chinesisch',
  'japão': 'Japanisch', 'japonesa': 'Japanisch', 'japonês': 'Japanisch',
  'russia': 'Russisch', 'rússia': 'Russisch', 'russa': 'Russisch', 'russo': 'Russisch',
  'polônia': 'Polnisch', 'polonia': 'Polnisch', 'polonesa': 'Polnisch', 'polonês': 'Polnisch',
  'turquia': 'Türkisch', 'turca': 'Türkisch', 'turco': 'Türkisch',
  'grécia': 'Griechisch', 'grecia': 'Griechisch', 'grega': 'Griechisch', 'grego': 'Griechisch',
  'argentina': 'Argentinisch', 'argentino': 'Argentinisch',
  'colombia': 'Kolumbianisch', 'colômbia': 'Kolumbianisch',
  'mexico': 'Mexikanisch', 'méxico': 'Mexikanisch',
  'venezuela': 'Venezolanisch',
  'peru': 'Peruanisch',
  'chile': 'Chilenisch',
  'ucrania': 'Ukrainisch', 'ucrânia': 'Ukrainisch', 'ucraniana': 'Ukrainisch',
  // English → Alemão  
  'german': 'Deutsch', 'germany': 'Deutsch',
  'american': 'Amerikanisch', 'american citizen': 'Amerikanisch',
  'british': 'Britisch', 'english': 'Britisch',
  'french': 'Französisch', 'france': 'Französisch',
  'italian': 'Italienisch', 'italy': 'Italienisch',
  'spanish': 'Spanisch', 'spain': 'Spanisch',
  'brazilian': 'Brasilianisch', 'brazil': 'Brasilianisch',
  'portuguese': 'Portugiesisch',
  'indian': 'Indisch',
  'chinese': 'Chinesisch',
  'japanese': 'Japanisch',
  'russian': 'Russisch',
  'polish': 'Polnisch',
  'turkish': 'Türkisch',
  'greek': 'Griechisch',
  'ukrainian': 'Ukrainisch',
};

function normalizeNationality(input) {
  if (!input) return input;
  const key = input.toLowerCase().trim();
  return NATIONALITY_MAP[key] || input;
}

module.exports = { NATIONALITY_MAP, normalizeNationality };
