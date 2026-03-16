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

// ─── BIRTHPLACE MAP (PT/EN → DE) ───────────────────────────────────────────
const BIRTHPLACE_MAP = {
  // Português → Alemão
  'são paulo': 'São Paulo', 'rio de janeiro': 'Rio de Janeiro',
  'brasília': 'Brasília', 'salvador': 'Salvador', 'fortaleza': 'Fortaleza',
  'belo horizonte': 'Belo Horizonte', 'manaus': 'Manaus', 'curitiba': 'Curitiba',
  'recife': 'Recife', 'porto alegre': 'Porto Alegre', 'belém': 'Belém',
  'goiânia': 'Goiânia', 'campinas': 'Campinas', 'florianópolis': 'Florianópolis',
  'lisboa': 'Lissabon', 'porto': 'Porto', 'coimbra': 'Coimbra', 'faro': 'Faro',
  'londres': 'London', 'london': 'London',
  'nova york': 'New York', 'new york': 'New York', 'nova iorque': 'New York',
  'paris': 'Paris', 'lyon': 'Lyon', 'marselha': 'Marseille', 'marseille': 'Marseille',
  'moscou': 'Moskau', 'moscow': 'Moskau', 'moscovo': 'Moskau',
  'varsóvia': 'Warschau', 'warsaw': 'Warschau', 'warszawa': 'Warschau',
  'istambul': 'Istanbul', 'istanbul': 'Istanbul',
  'roma': 'Rom', 'rome': 'Rom', 'milão': 'Mailand', 'milan': 'Mailand',
  'nápoles': 'Neapel', 'naples': 'Neapel', 'veneza': 'Venedig', 'venice': 'Venedig',
  'madrid': 'Madrid', 'barcelona': 'Barcelona', 'sevilha': 'Sevilla', 'seville': 'Sevilla',
  'buenos aires': 'Buenos Aires', 'bogotá': 'Bogotá', 'bogota': 'Bogotá',
  'cidade do méxico': 'Mexiko-Stadt', 'mexico city': 'Mexiko-Stadt', 'ciudad de méxico': 'Mexiko-Stadt',
  'lima': 'Lima', 'santiago': 'Santiago', 'caracas': 'Caracas',
  'mumbai': 'Mumbai', 'nova delhi': 'Neu-Delhi', 'new delhi': 'Neu-Delhi',
  'pequim': 'Peking', 'beijing': 'Peking', 'xangai': 'Shanghai', 'shanghai': 'Shanghai',
  'tóquio': 'Tokio', 'tokyo': 'Tokio', 'toquio': 'Tokio',
  'kiev': 'Kiew', 'kyiv': 'Kiew',
  'atenas': 'Athen', 'athens': 'Athen',
  'ancara': 'Ankara', 'ankara': 'Ankara',
  'berlim': 'Berlin', 'berlin': 'Berlin',
  'munique': 'München', 'munich': 'München', 'münchen': 'München',
  'hamburgo': 'Hamburg', 'hamburg': 'Hamburg',
  'frankfurt': 'Frankfurt', 'colônia': 'Köln', 'cologne': 'Köln', 'köln': 'Köln',
  'düsseldorf': 'Düsseldorf', 'estugarda': 'Stuttgart', 'stuttgart': 'Stuttgart',
  'viena': 'Wien', 'vienna': 'Wien', 'wien': 'Wien',
  'zurique': 'Zürich', 'zurich': 'Zürich', 'zürich': 'Zürich',
  'bruxelas': 'Brüssel', 'brussels': 'Brüssel',
  'amsterdã': 'Amsterdam', 'amsterdam': 'Amsterdam',
  'copenhague': 'Kopenhagen', 'copenhagen': 'Kopenhagen',
  'estocolmo': 'Stockholm', 'stockholm': 'Stockholm',
  'oslo': 'Oslo', 'helsínquia': 'Helsinki', 'helsinki': 'Helsinki',
  'praga': 'Prag', 'prague': 'Prag',
  'budapeste': 'Budapest', 'budapest': 'Budapest',
  'bucareste': 'Bukarest', 'bucharest': 'Bukarest',
  'belgrado': 'Belgrad', 'belgrade': 'Belgrad',
  'sófia': 'Sofia', 'sofia': 'Sofia',
  'cairo': 'Kairo', 'cairo': 'Kairo',
  'luanda': 'Luanda', 'maputo': 'Maputo',
  'cidade da praia': 'Praia', 'praia': 'Praia',
  'sydney': 'Sydney', 'melbourne': 'Melbourne',
  'toronto': 'Toronto', 'vancouver': 'Vancouver',
  'los angeles': 'Los Angeles', 'chicago': 'Chicago', 'san francisco': 'San Francisco',
  'havana': 'Havanna', 'panama': 'Panama',
  'seoul': 'Seoul', 'seul': 'Seoul',
  'bangkok': 'Bangkok', 'singapura': 'Singapur', 'singapore': 'Singapur',
};

function normalizeBirthPlace(input) {
  if (!input) return input;
  const key = input.toLowerCase().trim();
  return BIRTHPLACE_MAP[key] || input;
}

module.exports = { NATIONALITY_MAP, normalizeNationality, BIRTHPLACE_MAP, normalizeBirthPlace };
