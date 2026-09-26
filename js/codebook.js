// PMWS shorthand codebook — lossless compression of common alert words/phrases.
//
// The transmitter replaces known phrases with 1–2 byte codes; receivers expand them back to
// the exact original text. Codes live in control-byte space, which normal text can never use
// (buildFrame strips control characters from user input), so there is no ambiguity.
//
//   0x01–0x1C (except 0x04 EOT) : one-byte code  -> SHORT[i]
//   0x1D                        : CAP — capitalise the first letter of the next code's phrase
//   0x1F, b (0x20–0x7E, not '|') : two-byte code -> LONG[i]
//
// ⚠ The codebook is part of the protocol. Only ever APPEND to the lists (never reorder or
// remove), or bump PROTOCOL.magic, or old and new devices will decode messages differently.

// Most common / longest phrases get the 27 one-byte codes.
export const SHORT = [
  'take shelter', 'immediately', 'emergency', 'warning', 'evacuate', 'evacuation', 'tornado',
  'shelter in place', 'interior room', 'lowest floor', 'stay away from', 'windows', 'county',
  'residents', 'the area', 'until further notice', 'local authorities', 'monitor local media',
  'do not', 'avoid', 'flooding', 'the following', 'should', 'vehicle', 'building',
  'information', 'affected',
];

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

// Up to 94 two-byte codes.
export const LONG = [
  ...STATES,
  'state of', 'city of', 'National Weather Service', 'thunderstorm', 'severe', 'flash flood',
  'hazardous materials', 'power outage', 'missing', 'last seen', 'wearing', 'approximately',
  'miles per hour', 'damaging winds', 'life-threatening', 'please', 'because', 'expected',
  'possible', 'including', 'neighborhood', 'downtown', 'highway', 'Interstate', 'closed',
  'streets', 'northern', 'southern', 'eastern', 'western', 'within', 'minutes', 'hours',
  'tonight', 'tomorrow', 'morning', 'afternoon', 'evening', 'basement', 'outdoors',
  'sturdy', 'nearest', 'boil water', 'contact',
];

const CAP = 0x1d, EXT = 0x1f, EOT = 0x04;
const SHORT_CODES = [];
for (let b = 0x01; b <= 0x1c; b++) if (b !== EOT) SHORT_CODES.push(b);
const EXT_BYTES = [];
for (let b = 0x20; b <= 0x7e; b++) if (b !== 0x7c) EXT_BYTES.push(b);

if (SHORT.length > SHORT_CODES.length || LONG.length > EXT_BYTES.length) throw new Error('codebook overflow');

const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Encoder table: every phrase plus a capitalised variant (for lowercase phrases), longest first.
const TABLE = [];
const addEntries = (list, codeOf) => list.forEach((p, i) => {
  const code = codeOf(i);
  TABLE.push({ text: p, bytes: code });
  if (p[0] !== p[0].toUpperCase()) TABLE.push({ text: capFirst(p), bytes: String.fromCharCode(CAP) + code });
});
addEntries(SHORT, (i) => String.fromCharCode(SHORT_CODES[i]));
addEntries(LONG, (i) => String.fromCharCode(EXT, EXT_BYTES[i]));
TABLE.sort((a, b) => b.text.length - a.text.length);

/** Replace known phrases with codes (greedy longest match). Input must not contain control chars. */
export function compress(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const hit = TABLE.find((e) => e.bytes.length < e.text.length && s.startsWith(e.text, i));
    if (hit) { out += hit.bytes; i += hit.text.length; }
    else { out += s[i]; i++; }
  }
  return out;
}

/** Expand codes back to the original text. Unknown codes are dropped. */
export function expand(s) {
  let out = '', cap = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let phrase = null;
    if (c === CAP) { cap = true; continue; }
    if (c === EXT) phrase = LONG[EXT_BYTES.indexOf(s.charCodeAt(++i))] ?? '';
    else if (c < 0x20) phrase = SHORT[SHORT_CODES.indexOf(c)] ?? '';
    if (phrase === null) { out += s[i]; cap = false; continue; }
    out += cap ? capFirst(phrase) : phrase;
    cap = false;
  }
  return out;
}
