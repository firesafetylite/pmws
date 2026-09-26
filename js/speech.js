// Builds the text-to-speech script for an alert:
//   "Attention. Tornado Warning for the State of Kansas, effective until 9:30 PM. <message>"

import { ALERT_TYPES } from './modem.js';

// Kept lowercase inside a title-cased place name (unless first word).
const MINOR = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'for', 'to', 'a', 'an', 'by', 'near']);

// "state of kansas" -> needs "the"; "Kansas" / "Springfield County" -> doesn't.
const DIR = '(north|south|east|west|northeast|northwest|southeast|southwest)(ern)?|central';
const NEEDS_THE = [
  /^(state|commonwealth|province|territory|county|parish|borough|city|town|township|village|district|region|republic|municipality)\s+of\b/i,
  /^(entire|whole|greater)\b/i,
  new RegExp(`^(${DIR})\\s+(part|portion|half|side|end|area|region|section)\\b`, 'i'),
  /^(area|region|coast|valley|panhandle)\b/i,
];

function capWord(w) {
  // capitalise each hyphen/apostrophe part: "winston-salem" -> "Winston-Salem", "o'fallon" -> "O'Fallon"
  return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

/** Title-case only text typed in all lowercase or ALL CAPS; mixed case is left as typed. */
export function tidyCase(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  const allLower = letters === letters.toLowerCase();
  const allUpper = letters === letters.toUpperCase();
  if (!letters || (!allLower && !allUpper)) return s;
  let first = true;
  return s.replace(/[\p{L}'’-]+/gu, (w, i) => {
    const lw = w.toLowerCase();
    const afterComma = /,\s*$/.test(s.slice(0, i));
    let out;
    if (!first && MINOR.has(lw)) out = lw;
    else if (w.length === 2 && (allUpper || afterComma) && !MINOR.has(lw)) out = w.toUpperCase(); // "KS"
    else out = capWord(w);
    first = false;
    return out;
  });
}

/** "state of kansas" -> "the State of Kansas"; "THE CITY OF DALLAS." -> "the City of Dallas" */
export function speakLocation(loc) {
  let s = String(loc ?? '').replace(/\s+/g, ' ').trim().replace(/[.;:!?,]+$/, '');
  if (!s) return 'the area';
  s = tidyCase(s);
  const m = /^the\s+/i.exec(s);
  if (m) return 'the ' + s.slice(m[0].length);
  return NEEDS_THE.some((re) => re.test(s)) ? `the ${s}` : s;
}

/** Time only, 12-hour, spoken naturally: "9 PM", "9:30 PM", "noon", "midnight". */
export function speakTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '';
  const h24 = d.getHours(), m = d.getMinutes();
  if (m === 0 && h24 === 12) return 'noon';
  if (m === 0 && h24 === 0) return 'midnight';
  const h = h24 % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Capitalise the first letter and make sure the message ends like a sentence. */
export function speakMessage(msg) {
  let s = String(msg ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return /[.!?]["')\]]?$/.test(s) ? s : s + '.';
}

export function spokenText(a) {
  const name = ALERT_TYPES[a.type]?.name ?? 'Emergency alert';
  const until = a.expires ? `, effective until ${speakTime(a.expires)}` : '';
  const msg = speakMessage(a.message);
  return `Attention. ${name} for ${speakLocation(a.location)}${until}.${msg ? ' ' + msg : ''}`;
}
