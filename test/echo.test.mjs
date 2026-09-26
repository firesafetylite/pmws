import { buildTransmission, Demodulator, newAlertId, PROTOCOL } from '../js/modem.js';
// After the first copy decodes, the receiver plays a 350 Hz tone that leaks into its mic.
// Copies 2 and 3 must still decode.
let fails = 0;
for (const sr of [44100, 48000]) {
  const alert = { id: newAlertId(), type: 'EVAC', location: 'Test Town', expires: new Date(Date.UTC(2031, 0, 1)), message: 'Leave now via Route 9.' };
  const { header } = buildTransmission(alert, sr);
  const sig = new Float32Array(header.length + sr); sig.set(header, sr / 2);
  let n = 0; const t = [];
  const d1 = new Demodulator(sr, { onFrame: () => t.push(n) });
  for (; n < sig.length; n += 256) d1.process(sig.subarray(n, n + 256));
  const w = (2 * Math.PI * PROTOCOL.preambleHz) / sr;
  for (let i = t[0]; i < sig.length; i++) sig[i] += 0.5 * Math.sin(w * i) + 0.05 * (Math.random() * 2 - 1);
  let got = 0;
  const d2 = new Demodulator(sr, { onFrame: (f) => { if (f.message === alert.message) got++; } });
  for (let i = 0; i < sig.length; i += 256) d2.process(sig.subarray(i, i + 256));
  const pass = t.length === 3 && got === 3;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} sr=${sr} first copy at ${(t[0] / sr).toFixed(2)}s, copies with tone echo ${got}/3`);
}
process.exit(fails ? 1 : 0);
