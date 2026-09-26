import { compress, expand, SHORT, LONG } from '../js/codebook.js';
import { buildFrame, parseFrame, burstSeconds, buildTransmission, Demodulator } from '../js/modem.js';

let fails = 0;
const check = (ok, label) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

// Round-trip: expand(compress(x)) === x, exactly
const samples = [
  'A tornado warning has been issued for the area. Take shelter now in a basement or an interior room on the lowest floor. Stay away from windows. If you are outdoors or in a vehicle, find the nearest sturdy building immediately. Monitor local media.',
  'Evacuate immediately. Do not return until further notice. Avoid Interstate 35.',
  'EMERGENCY — TAKE SHELTER', 'Tornadoes, Warnings, warningly, Kansas City, Arkansas', 'state of kansas', 'State of Kansas',
  'Évacuez 🚨 maintenant', '', 'Plain text with nothing to shorten: xyz 123.',
  ...SHORT, ...LONG,
];
let bad = 0;
for (const s of samples) if (expand(compress(s)) !== s) { bad++; console.log('  mismatch:', JSON.stringify(s)); }
check(bad === 0, `round-trip exact for ${samples.length} samples`);
check(samples.every((s) => compress(s).length <= s.length), 'compression never makes text longer');
check([...compress(samples.join(' '))].every((c) => c !== '|' && c !== '\x04'), 'never emits "|" or EOT');

// Frame level: parse gives back the original text; report savings on the typical 258-byte message
const alert = { id: 'ABCD', type: 'TORW', location: 'Springfield County, Kansas', expires: new Date(Date.UTC(2031, 0, 1)), message: samples[0] };
const frame = buildFrame(alert);
const parsed = parseFrame(frame.subarray(0, frame.length - 1));
check(parsed?.message === alert.message && parsed?.location === alert.location, 'frame round-trip restores original text');
const plainLen = new TextEncoder().encode(`PMWS4|ABCD|TORW|${alert.location}|20310101T0000Z|${alert.message}|FFFF\x04`).length;
console.log(`     typical alert: ${plainLen} B -> ${frame.length} B, ${burstSeconds(plainLen).toFixed(2)} s -> ${burstSeconds(frame.length).toFixed(2)} s per copy`);

// Over the air (with noise): compressed control bytes decode fine
const sr = 48000;
const { header } = buildTransmission(alert, sr, { attnSec: 0 });
const sig = new Float32Array(header.length + sr); sig.set(header, sr / 2);
for (let i = 0; i < sig.length; i++) sig[i] += 0.3 * (Math.random() * 2 - 1);
let got = 0;
const d = new Demodulator(sr, { onFrame: (f) => { if (f.message === alert.message) got++; } });
for (let i = 0; i < sig.length; i += 256) d.process(sig.subarray(i, i + 256));
check(got === 3, `over the air with noise: ${got}/3 copies restored exactly`);
process.exit(fails ? 1 : 0);
