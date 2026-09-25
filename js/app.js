import {
  PROTOCOL, ALERT_TYPES, buildTransmission, Demodulator, newAlertId, encodeWav, concat,
} from './modem.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtTime = (d) => (d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const typeName = (t) => ALERT_TYPES[t]?.name ?? `Unknown (${t})`;
const severity = (t) => ALERT_TYPES[t]?.severity ?? 'moderate';

let ctx; // shared AudioContext
function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ================================================================ TTS
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('txVoice');
  const prev = sel.value;
  sel.innerHTML = '<option value="">System default</option>' +
    voices.map((v, i) => `<option value="${i}">${v.name} (${v.lang})</option>`).join('');
  if (prev) sel.value = prev;
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text, { voiceIdx = $('txVoice').value, rate = +$('txRate').value || 0.9, volume = 1 } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (voiceIdx !== '' && voices[voiceIdx]) u.voice = voices[voiceIdx];
    u.rate = rate; u.volume = volume;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

function spokenText(a) {
  const exp = a.expires ? ` This alert is in effect until ${fmtTime(a.expires)}.` : '';
  return `Attention. ${typeName(a.type)} for ${a.location || 'the area'}.${exp} ${a.message}`;
}

// ================================================================ TRANSMIT
const typeSel = $('txType');
typeSel.innerHTML = Object.entries(ALERT_TYPES)
  .filter(([k]) => k !== 'ENDM' && k !== 'PREA')
  .map(([k, v]) => `<option value="${k}">${v.name} (${k})</option>`).join('');

(function defaultExpiry() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset() * 60000;
  $('txExp').value = new Date(d - off).toISOString().slice(0, 16);
})();

$('txMsg').addEventListener('input', (e) => { $('txCount').textContent = `${e.target.value.length}/${PROTOCOL.maxMessage}`; });

function readForm() {
  return {
    id: newAlertId(),
    type: typeSel.value,
    location: $('txLoc').value.trim(),
    expires: new Date($('txExp').value),
    message: $('txMsg').value.trim(),
  };
}

let txSource = null, txAbort = false;
const ownIds = new Set();

function playBuffer(samples) {
  const ac = audio();
  return new Promise((resolve) => {
    const buf = ac.createBuffer(1, samples.length, ac.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = ac.createBufferSource();
    const g = ac.createGain();
    g.gain.value = +$('txVol').value;
    src.buffer = buf;
    src.connect(g).connect(ac.destination);
    src.onended = () => { txSource = null; resolve(); };
    txSource = src;
    src.start();
  });
}

function setTx(busy, msg) {
  $('txSend').disabled = busy;
  $('txStop').disabled = !busy;
  if (msg) $('txStatus').textContent = msg;
}

$('txForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = readForm();
  if (isNaN(a.expires)) return ($('txStatus').textContent = 'Invalid expiry.');
  const ac = audio();
  const { header, eom } = buildTransmission(a, ac.sampleRate, { attnSec: $('txAttn').checked ? 6 : 0 });
  ownIds.add(a.id);
  txAbort = false;
  try {
    setTx(true, `Sending data bursts (ID ${a.id})…`);
    await playBuffer(header);
    if (txAbort) return;
    if ($('txTts').checked) {
      setTx(true, 'Speaking message…');
      await sleep(400);
      await speak(spokenText(a), { volume: +$('txVol').value });
      if (txAbort) return;
      await sleep(600);
    }
    if ($('txEom').checked) {
      setTx(true, 'Sending end-of-message…');
      await playBuffer(eom);
    }
  } finally {
    setTx(false, txAbort ? 'Stopped.' : `Broadcast complete (ID ${a.id}).`);
  }
});

$('txStop').addEventListener('click', () => {
  txAbort = true;
  try { txSource?.stop(); } catch {}
  speechSynthesis?.cancel();
});

$('txWav').addEventListener('click', () => {
  const a = readForm();
  if (!a.location || !a.message || isNaN(a.expires)) return ($('txStatus').textContent = 'Fill in all fields first.');
  const sr = 48000;
  const { header, eom } = buildTransmission(a, sr, { attnSec: $('txAttn').checked ? 6 : 0 });
  const wav = encodeWav(concat([header, new Float32Array(sr * 2), eom]), sr);
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  Object.assign(document.createElement('a'), { href: url, download: `pmws-${a.type}-${a.id}.wav` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $('txStatus').textContent = 'WAV saved (data + attention tone + EOM; the TTS voice is added live by receivers).';
});

// ================================================================ RECEIVE
let rx = null; // {stream, node, src, analyser, demod, raf}
const seen = new Map(); // key -> time
const rawEl = $('rxRaw');

async function listMics() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const sel = $('rxDev');
    const prev = sel.value;
    sel.innerHTML = '<option value="">Default microphone</option>' +
      devs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Microphone ${i + 1}`}</option>`).join('');
    sel.value = prev;
  } catch {}
}
navigator.mediaDevices?.addEventListener?.('devicechange', listMics);
listMics();

function appendRaw(b) {
  const ch = b === PROTOCOL.EOT ? '␄\n' : b >= 32 && b < 127 ? String.fromCharCode(b) : '·';
  rawEl.textContent = (rawEl.textContent + ch).slice(-2000);
  rawEl.scrollTop = rawEl.scrollHeight;
}

async function startRx() {
  if (!navigator.mediaDevices?.getUserMedia) return ($('rxStatus').textContent = 'Microphone not supported (needs HTTPS).');
  const ac = audio();
  const devId = $('rxDev').value;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: devId ? { exact: devId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
      },
    });
  } catch (err) {
    $('rxStatus').textContent = `Microphone blocked: ${err.message}`;
    return;
  }
  listMics();
  await ac.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
  const src = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, 'pmws-capture');
  const mute = ac.createGain(); mute.gain.value = 0; // keep graph pulling without echoing mic
  const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.5;
  src.connect(node).connect(mute).connect(ac.destination);
  src.connect(analyser);

  const demod = new Demodulator(ac.sampleRate, {
    onByte: appendRaw,
    onFrame: onAlert,
    onBadFrame: () => ($('rxStatus').textContent = 'Heard a damaged burst (CRC failed) — waiting for a repeat…'),
    onStatus: ({ quality, carrier, level }) => {
      $('mQual').style.width = `${Math.round(quality * 100)}%`;
      $('mLevel').style.width = `${Math.min(100, Math.round(level * 300))}%`;
      $('led').className = `led ${carrier ? 'carrier' : 'listen'}`;
      if (carrier) $('rxStatus').textContent = 'Receiving PMWS data…';
      else if ($('rxStatus').textContent.startsWith('Receiving')) $('rxStatus').textContent = 'Listening…';
    },
  });
  node.port.onmessage = (e) => demod.process(e.data);

  rx = { stream, node, src, analyser, demod };
  drawScope();
  $('rxStart').disabled = true; $('rxStop').disabled = false; $('rxDev').disabled = true;
  $('led').className = 'led listen';
  $('rxStatus').textContent = `Listening @ ${ac.sampleRate} Hz…`;
}

function stopRx() {
  if (!rx) return;
  endPending();
  cancelAnimationFrame(rx.raf);
  rx.node.port.onmessage = null;
  rx.src.disconnect(); rx.node.disconnect();
  rx.stream.getTracks().forEach((t) => t.stop());
  rx = null;
  $('rxStart').disabled = false; $('rxStop').disabled = true; $('rxDev').disabled = false;
  $('led').className = 'led';
  $('mLevel').style.width = $('mQual').style.width = '0';
  $('rxStatus').textContent = 'Not listening.';
}

$('rxStart').addEventListener('click', startRx);
$('rxStop').addEventListener('click', stopRx);

function drawScope() {
  const cv = $('scope'), g = cv.getContext('2d');
  const data = new Uint8Array(rx.analyser.frequencyBinCount);
  const maxHz = 4000, binHz = ctx.sampleRate / rx.analyser.fftSize, bins = Math.floor(maxHz / binHz);
  const loop = () => {
    if (!rx) return;
    rx.analyser.getByteFrequencyData(data);
    const W = cv.width, H = cv.height;
    g.fillStyle = '#070c19'; g.fillRect(0, 0, W, H);
    for (const [hz, col] of [[PROTOCOL.markHz, '#58d6c455'], [PROTOCOL.spaceHz, '#8b7bff55']]) {
      g.fillStyle = col; g.fillRect((hz / maxHz) * W - 1, 0, 2, H);
    }
    g.beginPath();
    for (let i = 0; i < bins; i++) {
      const x = (i / bins) * W, y = H - (data[i] / 255) * (H - 4);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = '#58d6c4'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#8e9bbb'; g.font = '10px system-ui';
    g.fillText('mark 1300', (PROTOCOL.markHz / maxHz) * W + 4, 12);
    g.fillText('space 2500', (PROTOCOL.spaceHz / maxHz) * W + 4, 12);
    rx.raf = requestAnimationFrame(loop);
  };
  loop();
}

// ================================================================ ALERT HANDLING
let alerts = JSON.parse(localStorage.getItem('pmws-log') || '[]').map((a) => ({ ...a, expires: a.expires ? new Date(a.expires) : null, at: new Date(a.at) }));
let current = null;
const speakQueue = [];
let speaking = false;

async function drainSpeech() {
  if (speaking) return;
  speaking = true;
  while (speakQueue.length) {
    const a = speakQueue.shift();
    await speak(spokenText(a), { volume: 1 });
    await sleep(500);
  }
  speaking = false;
}

// ---------------------------------------------------------------- preamble handling
let pending = null; // {id, type, tone:{src,gain}, copies, timer}

function startPreambleTone() {
  const ac = audio();
  const sr = ac.sampleRate;
  const buf = ac.createBuffer(1, sr, sr); // 1 s = exactly 350 cycles, loops seamlessly
  const ch = buf.getChannelData(0);
  const w = (2 * Math.PI * PROTOCOL.preambleHz) / sr;
  for (let i = 0; i < sr; i++) ch[i] = Math.sin(w * i);
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = buf; src.loop = true;
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ac.currentTime + 0.05);
  src.connect(gain).connect(ac.destination);
  src.start();
  return { src, gain };
}

function stopPreambleTone() {
  if (!pending?.tone) return;
  const { src, gain } = pending.tone;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.05);
  src.stop(t + 0.06);
  pending.tone = null;
}

function endPending() {
  if (!pending) return;
  stopPreambleTone();
  clearTimeout(pending.timer);
  pending = null;
}

function armTimer(sec) {
  clearTimeout(pending.timer);
  const id = pending.id;
  pending.timer = setTimeout(() => {
    if (pending?.id !== id) return;
    const gotHeader = pending.copies > 0;
    endPending();
    if (!gotHeader) {
      $('rxStatus').textContent = `Preamble ${id} heard but no alert data followed.`;
      if (current?.id === id) { $('alertBanner').className = 'banner hidden'; current = null; }
    }
  }, sec * 1000);
}

function onPreamble(a) {
  const type = a.message;
  if (!$('rxTests').checked && (type === 'TEST' || type === 'DRIL')) return;
  endPending();
  pending = { id: a.id, type, copies: 0, tone: ownIds.has(a.id) ? null : startPreambleTone() };
  armTimer(PROTOCOL.preambleTimeoutSec);
  current = { id: a.id };
  const b = $('alertBanner');
  b.className = `banner ${severity(type)} incoming`;
  b.style.animation = '';
  $('bType').textContent = `Incoming: ${typeName(type)}`;
  $('bLoc').textContent = 'receiving…';
  $('bExp').textContent = 'receiving…';
  $('bId').textContent = a.id;
  $('bMsg').textContent = 'Stand by — alert data is being received.';
  $('rxStatus').textContent = `Preamble received (ID ${a.id}) — waiting for alert data…`;
}

/** Called for every decoded header copy (including repeats). */
function trackHeaderCopy(a) {
  if (pending?.id !== a.id) return;
  pending.copies++;
  $('rxStatus').textContent = `Receiving alert data… (${pending.copies}/3)`;
  if (pending.copies >= 3) endPending();
  else armTimer(5); // a missed/garbled copy shouldn't leave the tone playing forever
}

function onAlert(a) {
  if (a.type !== 'PREA' && a.type !== 'ENDM') trackHeaderCopy(a);
  const key = `${a.id}:${a.type}`;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 120000) seen.delete(k);
  if (seen.has(key)) return; // repeated burst
  seen.set(key, now);

  if (a.type === 'PREA') return onPreamble(a);

  if (a.type === 'ENDM') {
    if (pending?.id === a.id) endPending();
    $('rxStatus').textContent = `End of message (ID ${a.id}).`;
    if (current?.id === a.id) {
      // keep banner visible but stop pulsing
      $('alertBanner').style.animation = 'none';
    }
    return;
  }
  if (!$('rxTests').checked && (a.type === 'TEST' || a.type === 'DRIL')) return;

  const own = ownIds.has(a.id);
  const expired = a.expires && a.expires < new Date();
  const entry = { ...a, at: new Date(), own, expired };
  alerts.unshift(entry);
  alerts = alerts.slice(0, 50);
  saveLog();
  renderLog();
  showBanner(entry);
  $('rxStatus').textContent = pending?.id === a.id
    ? `Receiving alert data… (${pending.copies}/3)`
    : `Alert received: ${typeName(a.type)} (ID ${a.id})`;

  // Don't read our own broadcast twice or alerts that already expired.
  // Wait for the preamble tone / data bursts to finish before speaking.
  if ($('rxSpeak').checked && !own && !expired) {
    speakQueue.push(a);
    waitForPendingThen(drainSpeech);
  }
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification(`PMWS: ${typeName(a.type)}`, { body: `${a.location}\n${a.message}` });
  }
}

function showBanner(a) {
  current = a;
  const b = $('alertBanner');
  b.className = `banner ${severity(a.type)}`;
  b.style.animation = '';
  $('bType').textContent = typeName(a.type) + (a.expired ? ' (expired)' : '');
  $('bLoc').textContent = a.location || '—';
  $('bExp').textContent = fmtTime(a.expires);
  $('bId').textContent = a.id;
  $('bMsg').textContent = a.message;
}
function waitForPendingThen(fn) {
  const id = setInterval(() => { if (!pending) { clearInterval(id); fn(); } }, 200);
}

$('bDismiss').addEventListener('click', () => { endPending(); $('alertBanner').className = 'banner hidden'; current = null; speechSynthesis?.cancel(); speakQueue.length = 0; });

function saveLog() { localStorage.setItem('pmws-log', JSON.stringify(alerts)); }

function renderLog() {
  const ul = $('log');
  ul.innerHTML = '';
  if (!alerts.length) return (ul.innerHTML = '<li class="empty">Nothing received yet.</li>');
  const now = new Date();
  for (const a of alerts) {
    const li = document.createElement('li');
    const expired = a.expires && a.expires < now;
    li.className = `${severity(a.type)} ${expired ? 'expired' : ''}`;
    li.innerHTML = `
      <div class="l-top"><span class="t"></span><span class="l-meta r"></span></div>
      <div class="l-meta m"></div>
      <p class="l-msg"></p>`;
    const t = li.querySelector('.t');
    t.textContent = typeName(a.type);
    if (a.own) t.insertAdjacentHTML('beforeend', '<span class="tag">own transmission</span>');
    if (expired) t.insertAdjacentHTML('beforeend', '<span class="tag">expired</span>');
    li.querySelector('.r').textContent = `received ${fmtTime(a.at)}`;
    li.querySelector('.m').textContent = `📍 ${a.location || '—'} · until ${fmtTime(a.expires)} · ID ${a.id}`;
    li.querySelector('.l-msg').textContent = a.message;
    li.addEventListener('click', () => showBanner({ ...a, expired }));
    ul.appendChild(li);
  }
}
$('logClear').addEventListener('click', () => { alerts = []; saveLog(); renderLog(); });
renderLog();
setInterval(renderLog, 60000);

// Ask for notification permission on first interaction (optional).
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, { once: true });
