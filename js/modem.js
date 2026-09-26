// PMWS modem — Public Mass Warning System
//
//   600 baud async UART (8N1) AFSK, mark 1300 Hz / space 2500 Hz, continuous-mark lead-in,
//   "PMWS1|" frames with CRC-16, EOT-terminated, 700 + 500 Hz dual square-wave attention tone.
//
// A transmission sends 3 progressive header bursts:
//   1/3  ID + type                         -> activates receivers (alert screen + 350 Hz tone)
//   2/3  + location + effective-until
//   3/3  + message (complete alert)
// followed by the attention tone, TTS (not for TEST) and 3 ENDM bursts.

export const PROTOCOL = Object.freeze({
  name: 'PMWS',
  magic: 'PMWS1',
  baud: 600,
  markHz: 1300, // logical 1 / idle
  spaceHz: 2500, // logical 0
  leadInSec: 0.3,
  tailSec: 0.06,
  EOT: 0x04,
  attnFreqs: [700, 500], // dual square-wave attention tone
  headers: 3,
  preambleHz: 350, // tone the RECEIVER plays while the header bursts arrive
  maxMessage: 280,
});

export const ALERT_TYPES = Object.freeze({
  TORW: { name: 'Tornado Warning', severity: 'extreme' },
  SVRW: { name: 'Severe Storm Warning', severity: 'severe' },
  FLDW: { name: 'Flash Flood Warning', severity: 'severe' },
  FIRE: { name: 'Fire Warning', severity: 'extreme' },
  EVAC: { name: 'Evacuation Order', severity: 'extreme' },
  SHLT: { name: 'Shelter In Place', severity: 'extreme' },
  HAZM: { name: 'Hazardous Materials Alert', severity: 'severe' },
  CIVL: { name: 'Civil Emergency', severity: 'severe' },
  MISP: { name: 'Missing Person Alert', severity: 'moderate' },
  PWRO: { name: 'Power Outage Notice', severity: 'moderate' },
  WTHR: { name: 'Weather Advisory', severity: 'moderate' },
  INFO: { name: 'Information Bulletin', severity: 'minor' },
  TEST: { name: 'Test / Drill', severity: 'minor' },
  ENDM: { name: 'End Of Message', severity: 'minor' },
});

// ---------------------------------------------------------------- framing

export function crc16(bytes) {
  // CRC-16/CCITT-FALSE
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });
const clean = (s) => String(s ?? '').replace(/[|\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();

export function formatExpiry(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
}

export function parseExpiry(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}

export function newAlertId() {
  return Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
}

/** alert: {id, type, seq, location, expires(Date), message} -> Uint8Array */
export function buildFrame(alert) {
  const body =
    [
      PROTOCOL.magic,
      clean(alert.id).slice(0, 8),
      clean(alert.type).toUpperCase().slice(0, 4),
      clean(alert.seq ?? ''),
      clean(alert.location).slice(0, 80),
      alert.expires ? formatExpiry(alert.expires) : '',
      clean(alert.message).slice(0, PROTOCOL.maxMessage),
    ].join('|') + '|';
  const b = enc.encode(body);
  const crc = crc16(b).toString(16).toUpperCase().padStart(4, '0');
  return enc.encode(body + crc + '\x04');
}

/** Uint8Array (without EOT) -> alert | null */
export function parseFrame(bytes) {
  const text = dec.decode(bytes);
  const start = text.lastIndexOf(PROTOCOL.magic + '|');
  if (start < 0) return null;
  const t = text.slice(start);
  const cut = t.lastIndexOf('|');
  if (cut < 0) return null;
  const body = t.slice(0, cut + 1);
  const crc = t.slice(cut + 1).trim();
  if (!/^[0-9A-F]{4}$/.test(crc)) return null;
  if (crc16(enc.encode(body)) !== parseInt(crc, 16)) return null;
  const f = body.split('|');
  if (f.length < 8) return null;
  const sm = /^(\d)\/(\d)$/.exec(f[3]);
  return {
    id: f[1],
    type: f[2],
    seq: sm ? +sm[1] : 0,
    of: sm ? +sm[2] : 0,
    location: f[4],
    expires: parseExpiry(f[5]),
    message: f[6],
    raw: body + crc,
  };
}

// ---------------------------------------------------------------- modulator

function bytesToBits(bytes, leadBits, tailBits) {
  const bits = [];
  for (let i = 0; i < leadBits; i++) bits.push(1);
  for (const b of bytes) {
    bits.push(0); // start
    for (let i = 0; i < 8; i++) bits.push((b >> i) & 1); // LSB first
    bits.push(1); // stop
  }
  for (let i = 0; i < tailBits; i++) bits.push(1);
  return bits;
}

function fade(buf, sr, ms = 5) {
  const n = Math.min(Math.floor((sr * ms) / 1000), buf.length >> 1);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return buf;
}

export function modulateBytes(bytes, sampleRate, amplitude = 0.7) {
  const { baud, markHz, spaceHz, leadInSec, tailSec } = PROTOCOL;
  const bits = bytesToBits(bytes, Math.ceil(leadInSec * baud), Math.ceil(tailSec * baud));
  const spb = sampleRate / baud;
  const out = new Float32Array(Math.round(bits.length * spb));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = bits[Math.min(bits.length - 1, Math.floor(i / spb))] ? markHz : spaceHz;
    phase += (2 * Math.PI * f) / sampleRate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    out[i] = amplitude * Math.sin(phase);
  }
  return fade(out, sampleRate);
}

/** One cycle of a band-limited square wave (odd harmonics up to maxHz), to avoid aliasing. */
function squareSample(phase, f, maxHz) {
  let s = 0;
  for (let k = 1; k * f < maxHz; k += 2) s += Math.sin(k * phase) / k;
  return (4 / Math.PI) * s;
}

/** Dual-tone attention signal: 700 Hz + 500 Hz square waves played simultaneously. */
export function attentionTone(sampleRate, seconds = 6, amplitude = 0.5) {
  const out = new Float32Array(Math.round(sampleRate * seconds));
  const maxHz = Math.min(sampleRate / 2 - 500, 12000);
  const tones = PROTOCOL.attnFreqs;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const f of tones) v += squareSample((2 * Math.PI * f * i) / sampleRate, f, maxHz);
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const g = amplitude / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return fade(out, sampleRate, 20);
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function repeatBursts(burst, sampleRate, count = 3, gapSec = 1) {
  const gap = new Float32Array(Math.round(sampleRate * gapSec));
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push(burst);
    if (i < count - 1) parts.push(gap);
  }
  return concat(parts);
}

/**
 * Progressive header frames: 1 = ID + type, 2 = + location/expiry, 3 = + message.
 */
export function buildHeaderFrames(alert) {
  const n = PROTOCOL.headers;
  const base = { id: alert.id, type: alert.type };
  return [
    { ...base, seq: `1/${n}`, location: '', expires: null, message: '' },
    { ...base, seq: `2/${n}`, location: alert.location, expires: alert.expires, message: '' },
    { ...base, seq: `3/${n}`, location: alert.location, expires: alert.expires, message: alert.message },
  ].map(buildFrame);
}

/**
 * Returns {header, eom} audio (Float32Array).
 * header = 3 progressive header bursts + [attention tone]
 */
export function buildTransmission(alert, sampleRate, { gapSec = 1, attnSec = 6 } = {}) {
  const silence = (s) => new Float32Array(Math.round(sampleRate * s));
  const parts = [];
  buildHeaderFrames(alert).forEach((f, i) => {
    if (i) parts.push(silence(gapSec));
    parts.push(modulateBytes(f, sampleRate));
  });
  if (attnSec > 0) parts.push(silence(0.8), attentionTone(sampleRate, attnSec));
  const header = concat(parts);
  const eomFrame = buildFrame({ id: alert.id, type: 'ENDM', seq: '', location: '', expires: null, message: '' });
  const eom = repeatBursts(modulateBytes(eomFrame, sampleRate), sampleRate, PROTOCOL.headers, gapSec);
  return { header, eom };
}

export { concat };

// ---------------------------------------------------------------- demodulator

class Biquad {
  constructor(type, f, q, sr) {
    const w = (2 * Math.PI * f) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2;
    if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/**
 * Streaming non-coherent FSK demodulator + async UART + frame parser.
 * callbacks: onFrame(alert), onByte(byte), onBadFrame(bytes), onStatus({quality, carrier})
 */
export class Demodulator {
  constructor(sampleRate, callbacks = {}) {
    this.sr = sampleRate;
    this.cb = callbacks;
    const { baud, markHz, spaceHz } = PROTOCOL;
    this.spb = sampleRate / baud;
    this.N = Math.round(this.spb);
    // 4th-order high-pass keeps the receiver's own 350 Hz preamble tone out of the FSK detector
    this.hp = new Biquad('hp', 900, 0.707, sampleRate);
    this.hp2 = new Biquad('hp', 900, 0.707, sampleRate);
    this.lp = new Biquad('lp', 3200, 0.707, sampleRate);
    this.wm = (2 * Math.PI * markHz) / sampleRate;
    this.ws = (2 * Math.PI * spaceHz) / sampleRate;
    this.pm = this.ps = 0;
    const N = this.N;
    this.rb = { mi: new Float64Array(N), mq: new Float64Array(N), si: new Float64Array(N), sq: new Float64Array(N), e: new Float64Array(N) };
    this.sum = { mi: 0, mq: 0, si: 0, sq: 0, e: 0 };
    this.idx = 0;
    this.n = 0; // sample counter
    this.state = 'idle';
    this.next = 0;
    this.bit = 0;
    this.byte = 0;
    this.buf = [];
    this.lastByteAt = -1e12;
    this.qAcc = 0; this.qCnt = 0; this.carrierCnt = 0;
  }

  reset() { this.state = 'idle'; this.buf = []; }

  process(samples) {
    const { rb, sum, N } = this;
    for (let k = 0; k < samples.length; k++) {
      const x = this.lp.run(this.hp2.run(this.hp.run(samples[k])));
      this.pm += this.wm; if (this.pm > 6.283185307179586) this.pm -= 6.283185307179586;
      this.ps += this.ws; if (this.ps > 6.283185307179586) this.ps -= 6.283185307179586;
      const i = this.idx;
      const v = { mi: x * Math.cos(this.pm), mq: x * Math.sin(this.pm), si: x * Math.cos(this.ps), sq: x * Math.sin(this.ps), e: x * x };
      for (const key in v) { sum[key] += v[key] - rb[key][i]; rb[key][i] = v[key]; }
      this.idx = (i + 1) % N;

      const Pm = sum.mi * sum.mi + sum.mq * sum.mq;
      const Ps = sum.si * sum.si + sum.sq * sum.sq;
      const tot = Pm + Ps + 1e-20;
      const d = (Pm - Ps) / tot; // +1 mark, -1 space
      const q = Math.min(1, (2 * tot) / (N * Math.max(sum.e, 1e-20))); // tone purity 0..1
      const present = q > 0.4 && sum.e / N > 1e-8;

      this.qAcc += q; this.qCnt++;
      if (present) this.carrierCnt++;
      if (this.qCnt >= 2048) {
        this.cb.onStatus?.({ quality: this.qAcc / this.qCnt, carrier: this.carrierCnt > 1024, level: Math.sqrt(sum.e / N) });
        this.qAcc = this.qCnt = this.carrierCnt = 0;
      }

      this.uart(d, present);
      this.n++;
    }
  }

  uart(d, present) {
    const n = this.n;
    switch (this.state) {
      case 'idle':
        if (present && d < -0.2) {
          // zero-crossing of windowed detector lags the real edge by N/2; bit window is
          // fully inside the start bit N/2 later.
          this.next = n + this.spb * 0.5;
          this.state = 'start';
        }
        if (this.buf.length && n - this.lastByteAt > this.spb * 60) this.buf = [];
        break;
      case 'start':
        if (n >= this.next) {
          if (d < 0 && present) {
            this.state = 'data'; this.bit = 0; this.byte = 0; this.next += this.spb;
          } else this.state = 'idle';
        }
        break;
      case 'data':
        if (n >= this.next) {
          if (d > 0) this.byte |= 1 << this.bit;
          this.bit++; this.next += this.spb;
          if (this.bit === 8) this.state = 'stop';
        }
        break;
      case 'stop':
        if (n >= this.next) {
          if (d > 0) {
            this.onByte(this.byte);
            this.state = 'idle';
          } else this.state = 'waitmark'; // framing error
        }
        break;
      case 'waitmark':
        if (d > 0.2 || !present) this.state = 'idle';
        break;
    }
  }

  onByte(b) {
    this.lastByteAt = this.n;
    this.cb.onByte?.(b);
    if (b === PROTOCOL.EOT) {
      const bytes = Uint8Array.from(this.buf);
      this.buf = [];
      const alert = parseFrame(bytes);
      if (alert) this.cb.onFrame?.(alert);
      else if (bytes.length > 4) this.cb.onBadFrame?.(bytes);
      return;
    }
    this.buf.push(b);
    if (this.buf.length > 600) this.buf.splice(0, this.buf.length - 600);
  }
}

// ---------------------------------------------------------------- WAV helper

export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return buf;
}
