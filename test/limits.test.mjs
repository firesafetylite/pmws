import {
  PROTOCOL, buildFrame, buildTransmission, Demodulator, byteLength, truncateBytes, burstSeconds,
} from '../js/modem.js';

let fails = 0;
const check = (ok, label) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

// truncateBytes never splits a code point and respects the byte budget
const emoji = '🚨'.repeat(200); // 4 bytes each
const t = truncateBytes(emoji, 501);
check(byteLength(t) === 500 && t === '🚨'.repeat(125), 'truncateBytes keeps whole code points');

// Worst-case frames (ASCII max, and multibyte max) fit the demodulator buffer and decode 3/3
const cases = {
  'max ASCII': { location: 'L'.repeat(200), message: 'M'.repeat(1000) },
  'max multibyte': { location: 'é'.repeat(200), message: 'Évacuez 🚨 ' .repeat(100) },
};
for (const [label, fields] of Object.entries(cases)) {
  const alert = { id: 'FFFF', type: 'EVAC', expires: new Date(Date.UTC(2031, 0, 1)), ...fields };
  const frame = buildFrame(alert);
  check(frame.length <= PROTOCOL.maxFrameBytes, `${label}: frame ${frame.length} B <= buffer ${PROTOCOL.maxFrameBytes} B`);

  const sr = 48000;
  const { header } = buildTransmission(alert, sr, { attnSec: 0 });
  const sig = new Float32Array(header.length + sr); sig.set(header, sr / 2);
  const times = [];
  let n = 0;
  const d = new Demodulator(sr, { onFrame: (f) => { if (f.type === 'EVAC') times.push({ n, f }); } });
  for (; n < sig.length; n += 256) d.process(sig.subarray(n, n + 256));
  check(times.length === 3, `${label}: decoded ${times.length}/3 copies`);

  // Receiver timeout (same formula as app.js) must exceed the real copy-to-copy interval
  if (times.length >= 2) {
    const f = times[0].f;
    const timeoutSec = burstSeconds(byteLength(f.raw) + 1) + PROTOCOL.gapSec + 1.5;
    const interval = (times[1].n - times[0].n) / sr;
    check(timeoutSec > interval, `${label}: copy interval ${interval.toFixed(2)} s < timeout ${timeoutSec.toFixed(2)} s`);
  }
}
process.exit(fails ? 1 : 0);
