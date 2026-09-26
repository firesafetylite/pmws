import { buildTransmission, Demodulator, newAlertId, PROTOCOL } from '../js/modem.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

// 350 Hz tone as the receiver plays it (for echo simulation)
function tone(sr, sec, amp) {
  const out = new Float32Array(sr * sec), w = (2 * Math.PI * PROTOCOL.preambleHz) / sr;
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(w * i);
  return out;
}

for (const sr of [44100, 48000]) {
  const alert = { id: newAlertId(), type: 'EVAC', location: 'Test Town', expires: new Date(Date.UTC(2031, 0, 1, 12, 0)), message: 'Leave now via Route 9.' };
  const { header } = buildTransmission(alert, sr);
  const sig = new Float32Array(header.length + sr);
  sig.set(header, sr / 2);
  let n = 0;
  const ev = [];
  const d1 = new Demodulator(sr, { onFrame: (f) => ev.push({ t: n / sr, f }) });
  for (; n < sig.length; n += 256) d1.process(sig.subarray(n, n + 256));
  const seqs = ev.map((e) => e.f.seq).join(',');
  check(seqs === '1,2,3', `sr=${sr} headers arrive in order (${seqs})`);
  const [h1, h2, h3] = ev.map((e) => e.f);
  check(h1?.type === 'EVAC' && h1.id === alert.id && !h1.location && !h1.message, `sr=${sr} header 1 = ID + type only (at ${ev[0]?.t.toFixed(2)}s)`);
  check(h2?.location === alert.location && +h2.expires === +alert.expires && !h2.message, `sr=${sr} header 2 adds location + expiry`);
  check(h3?.message === alert.message, `sr=${sr} header 3 adds message`);

  // Receiver plays its 350 Hz tone after header 1 decodes; headers 2 and 3 must still decode.
  const noisy = sig.slice();
  const echo = tone(sr, 30, 0.5);
  for (let i = Math.round(ev[0].t * sr); i < noisy.length; i++) noisy[i] += echo[i % echo.length] + 0.05 * (Math.random() * 2 - 1);
  const got = [];
  const d2 = new Demodulator(sr, { onFrame: (f) => got.push(f.seq) });
  for (let i = 0; i < noisy.length; i += 256) d2.process(noisy.subarray(i, i + 256));
  check(got.join(',') === '1,2,3', `sr=${sr} headers 2+3 decode while receiver tone plays (${got.join(',')})`);
}
process.exit(fails ? 1 : 0);
