import { buildTransmission, Demodulator, newAlertId } from '../js/modem.js';

let fails = 0;
function run(sr, noise, gain = 1, label = '') {
  const alert = {
    id: newAlertId(), type: 'TORW', location: 'Springfield County, ZN',
    expires: new Date(Date.UTC(2030, 4, 6, 18, 30)),
    message: 'A tornado has been sighted near Main Street. Take shelter now in an interior room.',
  };
  const { header, eom } = buildTransmission(alert, sr, { attnSec: 1 });
  const sig = new Float32Array(sr + header.length + eom.length + sr);
  sig.set(header, sr / 2); sig.set(eom, sr / 2 + header.length + sr / 2);
  for (let i = 0; i < sig.length; i++) sig[i] = sig[i] * gain + noise * (Math.random() * 2 - 1);
  const frames = [];
  const d = new Demodulator(sr, { onFrame: (f) => frames.push(f) });
  for (let i = 0; i < sig.length; i += 128) d.process(sig.subarray(i, i + 128));
  const h = frames.filter((f) => f.type === 'TORW');
  const ok = h.filter((f) =>
    (f.seq === 1 && !f.location && !f.message) ||
    (f.seq === 2 && f.location === alert.location && +f.expires === +alert.expires && !f.message) ||
    (f.seq === 3 && f.location === alert.location && +f.expires === +alert.expires && f.message === alert.message)).length;
  const eoms = frames.filter((f) => f.type === 'ENDM').length;
  const pass = ok === 3 && eoms >= 1;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} sr=${sr} noise=${noise} gain=${gain} ${label} headers=${ok}/3 eoms=${eoms}/3`);
}
for (const sr of [44100, 48000]) for (const n of [0, 0.1, 0.3]) run(sr, n);
run(48000, 0.02, 0.05, '(quiet)');
process.exit(fails ? 1 : 0);
