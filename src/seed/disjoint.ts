/**
 * Content-word overlap checking.
 *
 * The centerpiece claim is that dedupe works across *lexically disjoint*
 * vocabulary. "Disjoint" is therefore a property we machine-check, not one we
 * assert in prose — see src/seed/seed.test.ts. A crude suffix stemmer is used
 * deliberately: it makes the check stricter (invoice/invoices collapse to one
 * token), and a stricter check is the safe direction for this claim.
 */

const STOPWORDS = new Set([
  'a','about','above','after','again','against','all','also','am','an','and','any','are','as','at',
  'be','been','before','being','below','between','both','but','by','can','cannot','could','did','do',
  'does','doing','done','down','during','each','either','else','few','for','from','further','get',
  'had','has','have','having','he','her','here','hers','him','his','how','i','if','in','into','is',
  'it','its','itself','just','like','may','me','might','mine','more','most','much','must','my',
  'myself','no','nor','not','now','of','off','on','once','only','or','other','others','ought','our',
  'ours','out','over','own','same','she','should','so','some','still','such','than','that','the',
  'their','theirs','them','themselves','then','there','these','they','this','those','through','to',
  'too','under','until','up','us','very','was','we','were','what','when','where','whether','which',
  'while','who','whom','whose','why','will','with','within','without','would','you','your','yours',
  // low-signal verbs and fillers that carry no topical meaning here
  'ask','asked','asks','go','goes','going','gone','keep','keeps','let','lets','make','makes','need',
  'needs','please','put','say','says','see','seen','take','takes','tell','told','thing','things',
  'use','used','uses','want','wants','way','ways',
]);

/** Strip one plural/participle suffix. Crude on purpose — see module doc. */
function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

export function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words.map(stem).filter((w) => !STOPWORDS.has(w)));
}

/** Content words present in both texts. Empty means genuinely disjoint. */
export function sharedContentWords(a: string, b: string): string[] {
  const left = contentWords(a);
  return [...contentWords(b)].filter((w) => left.has(w)).sort();
}
