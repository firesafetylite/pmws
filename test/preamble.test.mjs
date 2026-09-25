import { buildTransmission, Demodulator, preambleTone, newAlertId } from '../js/modem.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

for (const sr of [44100, 48000]) {
  const alert = { id: newAlertId(), type: 'EVAC', location: 'Test Town', expires: new Date(Date.UTC(2031, 0, 1, 12, 0)), message: 'Leave now via Route 9.' };
  const { header } = buildTransmission(alert, sr);
  const sig = new Float32Array(header.length + sr);
  sig.set(header, sr / 2);
  let n = 0;
  const events = [];
  const onFrame = (f) => events.push({ t: n / sr, type: f.type, f });
  // Pass 1: clean, to find when PREA decodes
  const d1 = new Demodulator(sr, { onFrame });
  for (; n < sig.length; n += 256) d1.process(sig.subarray(n, n + 256));
  const pre = events.find((e) => e.type === 'PREA');
  check(pre && pre.f.id === alert.id && pre.f.message === 'EVAC', `sr=${sr} PREA burst decoded at ${pre?.t.toFixed(2)}s with ID + type`);
  const hdrs = events.filter((e) => e.type === 'EVAC');
  check(hdrs.length === 3 && hdrs[0].t > pre.t, `sr=${sr} 3 header bursts follow the preamble (${hdrs.length}/3)`);

  // Pass 2: receiver's own 350 Hz preamble tone leaks into the mic after PREA decodes
  const noisy = sig.slice();
  const tone = preambleTone(sr, 30, 0.5);
  for (let i = Math.round(pre.t * sr); i < noisy.length; i++) noisy[i] += tone[i % tone.length] + 0.05 * (Math.random() * 2 - 1);
  let got = 0;
  const d2 = new Demodulator(sr, { onFrame: (f) => { if (f.type === 'EVAC' && f.message === alert.message) got++; } });
  for (let i = 0; i < noisy.length; i += 256) d2.process(noisy.subarray(i, i + 256));
  check(got === 3, `sr=${sr} all 3 headers decode while the receiver plays its preamble tone (${got}/3)`);
}
process.exit(fails ? 1 : 0);
