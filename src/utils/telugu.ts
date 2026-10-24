/**
 * Telugu Phonetic Transliteration Engine (Google Input Tools / Gboard style)
 * Converts Roman/phonetic Telugu typing and speech transcripts into pure Telugu script (తెలుగు).
 */

const COMMON_TELUGU_WORDS: Record<string, string> = {
  namaskaram: 'నమస్కారం',
  namaste: 'నమస్తే',
  dhanyavadalu: 'ధన్యవాదాలు',
  telugu: 'తెలుగు',
  ela: 'ఎలా',
  unnaru: 'ఉన్నారు',
  unnavu: 'ఉన్నావు',
  unna: 'ఉన్నా',
  bagunnara: 'బాగున్నారా',
  bagunnanu: 'బాగున్నాను',
  bagundi: 'బాగుంది',
  emi: 'ఏమి',
  chestunnaru: 'చేస్తున్నారు',
  chestunnav: 'చేస్తున్నావ్',
  repu: 'రేపు',
  eroju: 'ఈరోజు',
  ivala: 'ఇవాళ',
  ninna: 'నిన్న',
  ellundi: 'ఎల్లుండి',
  podduna: 'పొద్దున్న',
  udayam: 'ఉదయం',
  madhyahnam: 'మధ్యాహ్నం',
  sayantram: 'సాయంత్రం',
  ratri: 'రాత్రి',
  pani: 'పని',
  panulu: 'పనులు',
  intiki: 'ఇంటికి',
  illu: 'ఇల్లు',
  veldham: 'వెళ్దాం',
  vellali: 'వెళ్ళాలి',
  ravali: 'రావాలి',
  randi: 'రండి',
  chudandi: 'చూడండి',
  cheppandi: 'చెప్పండి',
  cheyandi: 'చేయండి',
  cheyyali: 'చేయాలి',
  konali: 'కొనాలి',
  tinali: 'తినాలి',
  bojanam: 'భోజనం',
  bhojanam: 'భోజనం',
  tiffin: 'టిఫిన్',
  neellu: 'నీళ్ళు',
  paalu: 'పాలు',
  kooragayalu: 'కూరగాయలు',
  dabbulu: 'డబ్బులు',
  pustakam: 'పుస్తకం',
  cadavali: 'చదవాలి',
  chadavali: 'చదవాలి',
  rayali: 'రాయాలి',
  meeting: 'మీటింగ్',
  office: 'ఆఫీస్',
  school: 'స్కూల్',
  college: 'కాలేజ్',
  hospital: 'హాస్పిటల్',
  doctor: 'డాక్టర్',
  mandulu: 'మందులు',
  amma: 'అమ్మ',
  nanna: 'నాన్న',
  anna: 'అన్న',
  akka: 'అక్క',
  thammudu: 'తమ్ముడు',
  chelli: 'చెల్లి',
  mama: 'మామ',
  atta: 'అత్త',
  bava: 'బావ',
  스నేహితుడు: 'స్నేహితుడు',
  friend: 'ఫ్రెండ్',
  time: 'టైమ్',
  ganta: 'గంట',
  gantalu: 'గంటలు',
  nimishalu: 'నిమిషాలు',
  avunu: 'అవును',
  kaadu: 'కాదు',
  ledu: 'లేదు',
  undi: 'ఉంది',
  unnayi: 'ఉన్నాయి',
  kavali: 'కావాలి',
  vaddu: 'వద్దు',
  sare: 'సరే',
  tvaraga: 'త్వరగా',
  gurthu: 'గుర్తు',
  pettu: 'పెట్టు',
  pettuko: 'పెట్టుకో',
  note: 'నోట్',
  notes: 'నోట్స్',
};

const INDEPENDENT_VOWELS: [string, string][] = [
  ['aa', 'ఆ'],
  ['ee', 'ఈ'],
  ['ii', 'ఈ'],
  ['oo', 'ఊ'],
  ['uu', 'ఊ'],
  ['ai', 'ఐ'],
  ['au', 'ఔ'],
  ['ou', 'ఔ'],
  ['ru', 'ఋ'],
  ['a', 'అ'],
  ['i', 'ఇ'],
  ['u', 'ఉ'],
  ['e', 'ఎ'],
  ['o', 'ఒ'],
];

const VOWEL_MATRAS: [string, string][] = [
  ['aa', 'ా'],
  ['ee', 'ీ'],
  ['ii', 'ీ'],
  ['oo', 'ూ'],
  ['uu', 'ూ'],
  ['ai', 'ై'],
  ['au', 'ౌ'],
  ['ou', 'ౌ'],
  ['ae', 'ే'],
  ['oe', 'ో'],
  ['a', ''],
  ['i', 'ి'],
  ['u', 'ు'],
  ['e', 'ె'],
  ['o', 'ొ'],
];

const CONSONANTS: [string, string][] = [
  ['ksh', 'క్ష'],
  ['chh', 'ఛ'],
  ['jhn', 'జ్ఞ'],
  ['kh', 'ఖ'],
  ['gh', 'ఘ'],
  ['ch', 'చ'],
  ['jh', 'ఝ'],
  ['th', 'థ'],
  ['dh', 'ధ'],
  ['ph', 'ఫ'],
  ['bh', 'భ'],
  ['sh', 'ష'],
  ['ss', 'శ'],
  ['ng', 'ఙ'],
  ['ny', 'ఞ'],
  ['nt', 'ంట'],
  ['nd', 'ండ'],
  ['mp', 'ంప'],
  ['mb', 'ంబ'],
  ['k', 'క'],
  ['g', 'గ'],
  ['c', 'చ'],
  ['j', 'జ'],
  ['T', 'ట'],
  ['D', 'డ'],
  ['N', 'ణ'],
  ['t', 'త'],
  ['d', 'ద'],
  ['n', 'న'],
  ['p', 'ప'],
  ['f', 'ఫ'],
  ['b', 'బ'],
  ['m', 'మ'],
  ['y', 'య'],
  ['r', 'ర'],
  ['l', 'ల'],
  ['L', 'ళ'],
  ['v', 'వ'],
  ['w', 'వ'],
  ['S', 'శ'],
  ['s', 'స'],
  ['h', 'హ'],
];

const VIRAMA = '్';

export function containsLatinCharacters(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

/**
 * Phonetic conversion of a single Roman word into Telugu script.
 */
export function transliterateWordToTelugu(rawWord: string): string {
  if (!rawWord) return '';
  // If already has no Latin letters, return as-is
  if (!containsLatinCharacters(rawWord)) return rawWord;

  // Preserve leading/trailing punctuation
  const match = rawWord.match(/^([^a-zA-Z]*)([a-zA-Z]+)([^a-zA-Z]*)$/);
  if (!match) {
    return rawWord.replace(/[a-zA-Z]+/g, (sub) => transliterateCoreWord(sub));
  }

  const [, prefix, core, suffix] = match;
  return `${prefix}${transliterateCoreWord(core)}${suffix}`;
}

function transliterateCoreWord(word: string): string {
  const lower = word.toLowerCase();
  if (COMMON_TELUGU_WORDS[lower]) {
    return COMMON_TELUGU_WORDS[lower];
  }

  let i = 0;
  let result = '';
  const n = word.length;

  while (i < n) {
    const rest = word.slice(i);
    const restLower = rest.toLowerCase();

    // Handle anusvara 'm' or 'n' before consonant or at end of word
    if (
      i > 0 &&
      (restLower[0] === 'm' || restLower[0] === 'n') &&
      (i === n - 1 ||
        (restLower[0] === 'm' && /^[mpb]/.test(restLower.slice(1))) ||
        (restLower[0] === 'n' && /^[tdkgcj]/.test(restLower.slice(1))))
    ) {
      if (i === n - 1 && restLower[0] === 'm') {
        result += 'ం';
        i += 1;
        continue;
      }
    }

    // Try matching consonant
    let matchedConsonant: [string, string] | null = null;
    for (const [rom, tel] of CONSONANTS) {
      if (
        (rom === 'T' || rom === 'D' || rom === 'N' || rom === 'L' || rom === 'S') &&
        rest.startsWith(rom)
      ) {
        matchedConsonant = [rom, tel];
        break;
      }
      if (restLower.startsWith(rom.toLowerCase())) {
        matchedConsonant = [rom, tel];
        break;
      }
    }

    if (matchedConsonant) {
      const [romCons, telCons] = matchedConsonant;
      i += romCons.length;

      // Check following vowel matra
      const afterConsLower = word.slice(i).toLowerCase();
      let matchedMatra: [string, string] | null = null;

      // In Telugu, 'e' and 'o' in casual typing often mean long 'ే' and 'ో'
      if (afterConsLower.startsWith('e') && !afterConsLower.startsWith('ee') && !afterConsLower.startsWith('ei')) {
        matchedMatra = ['e', 'ే'];
      } else if (afterConsLower.startsWith('o') && !afterConsLower.startsWith('oo') && !afterConsLower.startsWith('ou')) {
        matchedMatra = ['o', 'ో'];
      } else {
        for (const [vRom, vMatra] of VOWEL_MATRAS) {
          if (afterConsLower.startsWith(vRom)) {
            matchedMatra = [vRom, vMatra];
            break;
          }
        }
      }

      if (matchedMatra) {
        result += telCons + matchedMatra[1];
        i += matchedMatra[0].length;
      } else {
        // Consonant cluster or word-final consonant -> add Virama
        result += telCons + VIRAMA;
      }
      continue;
    }

    // Try matching independent vowel
    let matchedVowel: [string, string] | null = null;
    if (restLower.startsWith('e') && !restLower.startsWith('ee') && i === 0 && n > 2) {
      matchedVowel = ['e', 'ఎ'];
    } else {
      for (const [vRom, vTel] of INDEPENDENT_VOWELS) {
        if (restLower.startsWith(vRom)) {
          matchedVowel = [vRom, vTel];
          break;
        }
      }
    }

    if (matchedVowel) {
      result += matchedVowel[1];
      i += matchedVowel[0].length;
      continue;
    }

    // Fallback: advance 1 character
    result += word[i];
    i += 1;
  }

  return result;
}

/**
 * Converts an entire sentence or phrase into Telugu script.
 */
export function transliterateSentenceToTelugu(text: string): string {
  if (!text || !containsLatinCharacters(text)) return text;
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : transliterateWordToTelugu(part)))
    .join('');
}

/**
 * Fetches Google Input Tools / Server AI Telugu suggestions for a word or phrase,
 * falling back immediately to local phonetic Telugu script conversion.
 */
export async function fetchTeluguTransliteration(text: string): Promise<string> {
  if (!text || !containsLatinCharacters(text)) return text;

  try {
    // 1. Try Google Input Tools public endpoint for exact Google Keyboard behavior
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(
      text
    )}&itc=te-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (
        Array.isArray(data) &&
        data[0] === 'SUCCESS' &&
        Array.isArray(data[1]) &&
        data[1].length > 0
      ) {
        const mapped = data[1]
          .map((entry: unknown) => {
            if (Array.isArray(entry) && Array.isArray(entry[1]) && entry[1][0]) {
              return String(entry[1][0]);
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');
        if (mapped && !containsLatinCharacters(mapped)) {
          return mapped;
        }
      }
    }
  } catch {
    // Fall through to server / local phonetic engine
  }

  return transliterateSentenceToTelugu(text);
}

/**
 * Returns candidate suggestions for the last word currently being typed in Telugu mode.
 */
export async function getTeluguWordSuggestions(word: string): Promise<string[]> {
  const clean = word.trim();
  if (!clean || !containsLatinCharacters(clean)) return [];

  const localPrimary = transliterateWordToTelugu(clean);
  const candidates = new Set<string>([localPrimary]);

  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(
      clean
    )}&itc=te-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (
        Array.isArray(data) &&
        data[0] === 'SUCCESS' &&
        Array.isArray(data[1]) &&
        Array.isArray(data[1][0]) &&
        Array.isArray(data[1][0][1])
      ) {
        const googleList: string[] = data[1][0][1];
        const ordered: string[] = [];
        for (const item of googleList) {
          if (item && !ordered.includes(item)) ordered.push(item);
        }
        if (!ordered.includes(localPrimary)) ordered.push(localPrimary);
        return ordered.slice(0, 5);
      }
    }
  } catch {
    // Ignore and return local candidates
  }

  return Array.from(candidates);
}
