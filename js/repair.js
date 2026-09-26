// Redundant-copy repair.
//
// Every transmission sends the same frame 3 times. When copies arrive damaged (CRC fails), we
// combine them: each copy is aligned against the others (global alignment, so dropped or extra
// bytes from UART slips are handled), then every byte position is decided by majority vote.
// Where the copies disagree with no majority, candidates are tried (bitwise majority first) and
// only a candidate that passes the CRC-16 and frame checks is accepted.

const GAP = -1; // "no byte here" in an aligned copy
// CRC-verified tries per repair. Each wrong guess has ~1/65536 odds of passing CRC-16, and the
// frame must also pass strict field checks, so the false-accept risk stays well under 0.2%.
const MAX_CANDIDATES = 128;

function lastIndexOfSeq(hay, needle) {
  outer: for (let i = hay.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Drop anything before the frame's magic (noise picked up in the lead-in). */
export function trimToMagic(bytes, magic) {
  const i = lastIndexOfSeq(bytes, magic);
  return i > 0 ? bytes.subarray(i) : bytes;
}

/**
 * Needleman–Wunsch global alignment of `b` onto `a`.
 * Returns {at, ins}: at[i] = byte of `b` aligned with a[i] (or GAP); ins[i] = bytes `b` has
 * just before a[i] that `a` lacks (ins[a.length] = after the end).
 */
export function alignTo(a, b) {
  const n = a.length, m = b.length, W = m + 1;
  const S = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) S[i * W] = -i;
  for (let j = 1; j <= m; j++) S[j] = -j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = S[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 1 : -1);
      const u = S[(i - 1) * W + j] - 1;
      const l = S[i * W + j - 1] - 1;
      S[i * W + j] = d >= u && d >= l ? d : u >= l ? u : l;
    }
  }
  const at = new Int16Array(n).fill(GAP);
  const ins = Array.from({ length: n + 1 }, () => []);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const s = S[i * W + j];
    if (i > 0 && j > 0 && s === S[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 1 : -1)) { at[i - 1] = b[j - 1]; i--; j--; }
    else if (i > 0 && s === S[(i - 1) * W + j] - 1) i--; // b is missing a[i-1]
    else { ins[i].unshift(b[j - 1]); j--; } // b has an extra byte before a[i]
  }
  return { at, ins };
}

/** Options for one column, best first. A single option means the copies agree (majority). */
function columnOptions(vals) {
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const ranked = [...counts].sort((x, y) => y[1] - x[1]);
  if (ranked[0][1] * 2 > vals.length) return [ranked[0][0]];
  const opts = [];
  const b = vals.filter((v) => v !== GAP);
  if (b.length === 3) opts.push((b[0] & b[1]) | (b[0] & b[2]) | (b[1] & b[2])); // bitwise vote
  for (const [v] of ranked) if (!opts.includes(v)) opts.push(v);
  return opts;
}

/** Column-wise vote options for one base copy + the others aligned to it (star alignment). */
function voteColumns(base, others) {
  const al = others.map((o) => alignTo(base, o));
  const cols = [];
  const insertCols = (slot) => {
    const len = Math.max(0, ...al.map((a) => a.ins[slot].length));
    for (let k = 0; k < len; k++) cols.push(columnOptions([GAP, ...al.map((a) => a.ins[slot][k] ?? GAP)]));
  };
  for (let i = 0; i < base.length; i++) {
    insertCols(i);
    cols.push(columnOptions([base[i], ...al.map((a) => a.at[i])]));
  }
  insertCols(base.length);
  return cols;
}

/** Candidate frames from vote columns, most likely first (odometer over ambiguous columns). */
function* candidates(base, others) {
  const cols = voteColumns(base, others);
  const amb = [];
  cols.forEach((o, i) => { if (o.length > 1) amb.push(i); });
  const idx = new Array(amb.length).fill(0);
  for (;;) {
    const out = [];
    for (let i = 0, k = 0; i < cols.length; i++) {
      const v = cols[i].length > 1 ? cols[i][idx[k++]] : cols[i][0];
      if (v !== GAP) out.push(v);
    }
    yield Uint8Array.from(out);
    let p = 0;
    while (p < idx.length && ++idx[p] === cols[amb[p]].length) idx[p++] = 0;
    if (p === idx.length) return;
  }
}

function subsets(n) {
  // all copies first, then pairs (most recent first)
  const all = [...Array(n).keys()];
  const out = [all];
  if (n > 2) for (let a = n - 1; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([b, a]);
  return out;
}

/**
 * Try to rebuild a valid frame from 2+ damaged copies.
 * parse(bytes) -> alert | null must verify the CRC and frame structure.
 * Returns {alert, used: number of copies combined} or null.
 */
export function repairCopies(copies, { parse, magic }) {
  const trimmed = copies.map((c) => trimToMagic(c, magic));
  const gens = [];
  for (const set of subsets(trimmed.length)) {
    for (const bi of set) gens.push({ used: set.length, it: candidates(trimmed[bi], set.filter((x) => x !== bi).map((x) => trimmed[x])) });
  }
  const tried = new Set();
  let live = gens;
  while (live.length && tried.size < MAX_CANDIDATES) {
    // round-robin: every base's best guess is tried before anyone's second guess
    live = live.filter((g) => {
      if (tried.size >= MAX_CANDIDATES) return false;
      const r = g.it.next();
      if (r.done) return false;
      const key = r.value.join(',');
      if (tried.has(key)) return true;
      tried.add(key);
      const alert = parse(r.value);
      if (alert) { g.found = alert; return false; }
      return true;
    });
    const hit = gens.find((g) => g.found);
    if (hit) return { alert: hit.found, used: hit.used };
  }
  return null;
}
