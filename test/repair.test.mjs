import { buildFrame, parseFrame, buildTransmission, Demodulator, PROTOCOL } from '../js/modem.js';
import { repairCopies, alignTo } from '../js/repair.js';

let fails = 0;
const check = (ok, label) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

const alert = {
  id: 'ABCD', type: 'TORW', location: 'Springfield County, Kansas', expires: new Date(Date.UTC(2031, 0, 1)),
  message: 'A tornado warning has been issued for the area. Take shelter now in a basement or an interior room on the lowest floor. Stay away from windows.',
};
const frame = buildFrame(alert);
const clean = frame.subarray(0, frame.length - 1);
const truth = parseFrame(clean).raw;
const opts = { parse: (b) => parseFrame(b, { strict: true }), magic: new TextEncoder().encode(PROTOCOL.magic + '|') };

// Deterministic PRNG so the test is repeatable
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
function damage(b, flips, drops = 0, inserts = 0) {
  const a = [...b];
  for (let k = 0; k < flips; k++) { const i = Math.floor(rnd() * a.length); a[i] ^= 1 << Math.floor(rnd() * 8); }
  for (let k = 0; k < drops; k++) a.splice(Math.floor(rnd() * a.length), 1);
  for (let k = 0; k < inserts; k++) a.splice(Math.floor(rnd() * a.length), 0, Math.floor(rnd() * 256));
  return Uint8Array.from(a);
}

// Alignment handles dropped and inserted bytes
const { at } = alignTo(clean, damage(clean, 0, 2, 2));
check(at.filter((v, i) => v === clean[i]).length >= clean.length - 6, 'alignment survives dropped/extra bytes');

// Byte-level: damaged copies are rebuilt exactly, never into a wrong message
for (const [label, flips, drops, inserts, n, min] of [
  ['3 copies, 3 bit errors each', 3, 0, 0, 3, 95],
  ['3 copies, bit errors + dropped/extra bytes', 3, 1, 1, 3, 75],
  ['2 copies, 2 bit errors each', 2, 0, 0, 2, 90],
]) {
  let ok = 0, wrong = 0;
  for (let t = 0; t < 100; t++) {
    const r = repairCopies(Array.from({ length: n }, () => damage(clean, flips, drops, inserts)), opts);
    if (r) r.alert.raw === truth ? ok++ : wrong++;
  }
  check(ok >= min && wrong === 0, `${label}: repaired ${ok}/100, wrong ${wrong}`);
}

// Unrelated garbage never "repairs" into a frame
let falseHits = 0;
for (let t = 0; t < 50; t++) {
  const junk = () => Uint8Array.from({ length: 150 }, () => Math.floor(rnd() * 256));
  if (repairCopies([junk(), junk(), junk()], opts)) falseHits++;
}
check(falseHits === 0, `random noise never accepted as a frame (${falseHits}/50)`);

// Over the air: heavy noise where single copies often fail, repair recovers the alert
const sr = 48000;
let plain = 0, repaired = 0, wrongAir = 0;
const T = 12;
for (let t = 0; t < T; t++) {
  const { header } = buildTransmission(alert, sr, { attnSec: 0 });
  const sig = new Float32Array(header.length + sr); sig.set(header, sr / 2);
  for (let i = 0; i < sig.length; i++) sig[i] = sig[i] * 0.3 + 0.3 * (rnd() * 2 - 1);
  let gotPlain = false, gotRepaired = false;
  const d = new Demodulator(sr, {
    onFrame: (f) => {
      if (f.raw !== truth) { wrongAir++; return; }
      if (f.repaired) gotRepaired = true; else gotPlain = true;
    },
  });
  for (let i = 0; i < sig.length; i += 256) d.process(sig.subarray(i, i + 256));
  if (gotPlain) plain++;
  else if (gotRepaired) repaired++;
}
console.log(`     heavy noise: ${plain}/${T} had a clean copy, ${repaired}/${T} more rescued only by repair`);
check(wrongAir === 0, 'over the air: no wrong alerts');
check(repaired >= 1, 'over the air: repair rescues alerts that had no clean copy');
process.exit(fails ? 1 : 0);
