/* ============================================================
   rhythm.js — ритм-игра (4 дорожки, клавиши S D K L)
   ------------------------------------------------------------
   • Игра сама «слушает» песню: находит удары, вычисляет темп и
     ДОЛИ (beat tracking), и ставит ноты строго на сетку долей —
     поэтому они попадают в ритм. Сложность решает, какие клетки
     сетки заняты: только доли, половинки или четвертушки.
   • Длинные ноты: нажми в начале и держи до конца хвоста.
   • Свои ноты можно записать в редакторе (F10 → «Записать ноты»).
   • Картинка — не пиксельная: всё рисуется на canvas в полном
     разрешении; вспышки и искры — атласы Arcadia Effector (fx).
   Настройки — data/game.json → rhythm.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-rhythm');
const LEAD = 2.4;                        // секунд до начала песни
const TAU = Math.PI * 2;

let R = null;
let mode = 'menu';                       // menu | loading | play | result | layout
let sel = 0, diffI = G.readLS('cherry.rhythm.diff', 0);
let P = null;                            // текущее прохождение
let ctx = null;                          // AudioContext песни (ставится на паузу)
let cv = null, g = null, cvK = 0, ui = {}, clock = 0;
const cache = new Map();                 // src → { buffer, an }
const down = [false, false, false, false];
const press = [0, 0, 0, 0];              // время последнего нажатия (для анимации кнопок)
const imgs = new Map();

const diff = () => R.difficulties[G.clamp(diffI, 0, R.difficulties.length - 1)];
const playable = () => R.songs.filter(s => s.src);
const recOf = (song, d) => G.progress.records[`${song.id}/${d.id}`] || 0;
const laneOfCode = code => ['KeyS', 'KeyD', 'KeyK', 'KeyL'].indexOf(code);
const image = p => { if (!p) return null; let i = imgs.get(p); if (!i) { i = new Image(); i.src = G.asset(p); imgs.set(p, i); } return i.complete && i.naturalWidth ? i : null; };

/* ============================================================
   АНАЛИЗ ПЕСНИ: удары → темп → доли
   ============================================================ */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** сглаженная и нормированная «ударность»: минус локальное среднее, только положительная часть */
function normalize(env, fps) {
  const n = env.length, W = Math.round(fps * .5), out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
  let sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n, i + W);
    const v = Math.max(0, env[i] - (pre[b] - pre[a]) / (b - a));
    out[i] = v; sum += v; sq += v * v;
  }
  const sd = Math.sqrt(Math.max(1e-9, sq / n - (sum / n) ** 2));
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/** темп по автокорреляции + доли динамическим программированием (метод Эллиса) */
function trackBeats(env, fps) {
  const n = env.length;
  let best = 0, period = Math.round(fps * .5);
  for (let lag = Math.round(fps * 60 / 200); lag <= Math.round(fps * 60 / 62); lag++) {
    let ac = 0;
    for (let i = 0; i + lag < n; i += 2) ac += env[i] * env[i + lag];
    const bpm = 60 * fps / lag, w = Math.exp(-.5 * (Math.log2(bpm / 118) / .75) ** 2);
    if (ac * w > best) { best = ac * w; period = lag; }
  }
  const cum = new Float32Array(n), back = new Int32Array(n).fill(-1), tight = 100;
  const lo = Math.round(period * 2), hi = Math.max(1, Math.round(period / 2));
  const pen = new Float32Array(lo + 1);
  for (let d = hi; d <= lo; d++) pen[d] = -tight * Math.log(d / period) ** 2;
  for (let t = 0; t < n; t++) {
    let bs = -Infinity, bi = -1;
    for (let d = hi; d <= lo; d++) {
      const j = t - d;
      if (j < 0) break;
      const s = cum[j] + pen[d];
      if (s > bs) { bs = s; bi = j; }
    }
    cum[t] = env[t] + (bi >= 0 ? bs : 0);
    back[t] = bi;
  }
  let last = n - 1, top = -Infinity;
  for (let t = Math.max(0, n - period * 2); t < n; t++) if (cum[t] > top) { top = cum[t]; last = t; }
  const frames = [];
  for (let t = last; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();
  return { frames, period };
}

async function analyze(buffer, onProgress) {
  const dec = Math.max(1, Math.round(buffer.sampleRate / 22050)), sr = buffer.sampleRate / dec;
  const len = Math.floor(buffer.length / dec), chs = buffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let j = 0; j < dec; j++) s += d[i * dec + j];
      mono[i] += s / dec / chs;
    }
  }
  const N = 1024, HOP = 256, H2 = N / 2, frames = Math.max(0, Math.floor((len - N) / HOP));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(TAU * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), prev = new Float32Array(H2);
  const low = new Float32Array(frames), high = new Float32Array(frames);
  const kLow = Math.max(3, Math.round(170 / (sr / N)));
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = mono[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let l = 0, h = 0;
    for (let k = 1; k < H2; k++) {
      const mag = Math.log1p(60 * Math.hypot(re[k], im[k]));
      const d = mag - prev[k];
      if (d > 0) { if (k < kLow) l += d; else h += d; }
      prev[k] = mag;
    }
    low[f] = l; high[f] = h;
    if (f % 500 === 0) { onProgress?.(f / frames * .9); await G.sleep(0); }
  }
  const fps = sr / HOP;
  const nl = normalize(low, fps), nh = normalize(high, fps), env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) env[i] = nl[i] * 1.2 + nh[i];
  onProgress?.(.95); await G.sleep(0);
  const bt = trackBeats(env, fps);
  // время кадра: центр окна минус запаздывание детектора (измерено на тестовых щелчках)
  const time = f => (f * HOP + N / 2) / sr - (R.detectLag ?? -.01);
  const frameOf = t => G.clamp(Math.round(((t + (R.detectLag ?? -.01)) * sr - N / 2) / HOP), 0, frames - 1);
  const at = (arr, t) => { const f = frameOf(t); let m = 0; for (let i = Math.max(0, f - 2); i <= Math.min(frames - 1, f + 2); i++) m = Math.max(m, arr[i]); return m; };
  // доли привязаны к кадрам анализа (шаг ~12 мс) — сглаживаем по соседям, чтобы сетка не «дрожала»
  const raw = bt.frames.map(time), beats = raw.map((t, i) => {
    const a = Math.max(0, i - 4), b = Math.min(raw.length - 1, i + 4);
    if (b - a < 2) return t;
    const step = (raw[b] - raw[a]) / (b - a);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += raw[j] - (j - i) * step;
    return sum / (b - a + 1);
  });
  return {
    duration: buffer.duration, fps,
    beats: beats.filter(t => t > 0),
    period: bt.period / fps, bpm: 60 * fps / bt.period,
    strength: t => at(env, t), isLow: t => at(nl, t) * 1.2 >= at(nh, t)
  };
}

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

/** сетка долей песни: либо вычисленная, либо по заданному BPM */
function beatGrid(song, an) {
  if (song.bpm > 0) {
    const out = [];
    for (let t = song.offset || 0; t < an.duration; t += 60 / song.bpm) out.push(t);
    return out;
  }
  return an.beats;
}

function makeChart(song, d, an) {
  const manual = song.charts?.[d.id];
  if (Array.isArray(manual) && manual.length)
    return manual.map(([t, lane, len]) => ({ t, lane, len: len || 0 })).sort((a, b) => a.t - b.t);
  const beats = beatGrid(song, an);
  if (beats.length < 4) return [];
  const rand = mulberry(hash(song.id + '/' + d.id));
  const grid = Math.max(1, d.grid | 0), keep = d.keep || [.9, .4, .25];
  // на быстрых песнях лёгкая сложность берёт каждую вторую долю (ту, что сильнее)
  const period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  let stride = 1, phase = 0;
  if (grid === 1 && period < (d.slowBeat ?? .44)) {
    stride = 2;
    const sum = [0, 0];
    beats.forEach((t, i) => { sum[i % 2] += an.strength(t); });
    phase = sum[1] > sum[0] ? 1 : 0;
  }
  const slots = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const a = beats[i], b = beats[i + 1];
    for (let k = 0; k < grid; k++) {
      if (k === 0 && stride === 2 && i % 2 !== phase) continue;
      const t = a + (b - a) * k / grid;
      if (t < 1.2 || t > an.duration - 1.6) continue;
      slots.push({ t, level: k === 0 ? 0 : (k * 2 === grid ? 1 : 2), s: an.strength(t), low: an.isLow(t), beat: b - a });
    }
  }
  // в каждом классе (доля / половинка / четвертушка) оставляем самые «ударные» клетки
  let notes = [];
  for (let lv = 0; lv < 3; lv++) {
    const cls = slots.filter(s => s.level === lv);
    if (!cls.length) continue;
    const sorted = cls.map(s => s.s).sort((a, b) => b - a);
    const cut = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (keep[lv] ?? 0)))] ?? Infinity;
    notes.push(...cls.filter(s => (keep[lv] ?? 0) >= 1 || s.s > cut));
  }
  notes.sort((a, b) => a.t - b.t);
  const out = [];
  for (const n of notes) {
    const p = out[out.length - 1];
    if (p && n.t - p.t < d.minGap) { if (n.level < p.level || (n.level === p.level && n.s > p.s)) out[out.length - 1] = n; continue; }
    out.push(n);
  }
  // длинные ноты: часть нот «съедает» следующие две доли и превращается в длинную;
  // плюс длинной становится нота, после которой в песне и так пауза
  const share = d.hold ?? .4, eaten = new Set();
  let since = 9;
  out.forEach((n, i) => {
    since++;
    if (eaten.has(i) || since < 4 || rand() > share * .4) return;
    const span = n.beat * 2;
    let j = i + 1;
    while (j < out.length && out[j].t < n.t + span - .02) { eaten.add(j); j++; }
    n.len = span - n.beat * .5; since = 0;
  });
  const kept = out.filter((_, i) => !eaten.has(i));
  let last = -1, lastT = -9;
  return kept.map((n, i) => {
    const next = kept[i + 1], gap = next ? next.t - n.t : 0;
    let len = n.len || 0;
    if (!len && gap >= n.beat * 1.9 && rand() < share) len = Math.min(gap - n.beat * (grid > 1 ? .5 : 1), n.beat * 4);
    let pool = n.low ? [0, 1] : [2, 3];
    if (rand() < .3) pool = [0, 1, 2, 3];
    let lane = pool[(rand() * pool.length) | 0];
    if (lane === last && (n.t - lastT < .5 || rand() < .65)) {
      const others = [0, 1, 2, 3].filter(l => l !== last);
      lane = others[(rand() * others.length) | 0];
    }
    last = lane; lastT = n.t;
    return { t: n.t, lane, len };
  });
}

async function load(song) {
  if (cache.has(song.src)) return cache.get(song.src);
  const r = await fetch(G.asset(song.src));
  if (!r.ok) throw new Error('песня не найдена');
  const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
  const an = await analyze(buffer, p => { if (ui.loadBar) ui.loadBar.style.width = Math.round(p * 100) + '%'; });
  const data = { buffer, an };
  cache.set(song.src, data);
  return data;
}

/* ============================================================
   ИГРА
   ============================================================ */
const now = () => ctx.currentTime - P.t0 - P.lat - (R.offsetMs || 0) / 1000;
const laneX = i => R.highway.x + (i + .5) * R.highway.w / R.lanes.length;

function stopAudio() {
  if (P?.src) { try { P.src.onended = null; P.src.stop(); } catch {} P.src = null; }
}

async function start(song, { record = false } = {}) {
  const d = diff();
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  mode = 'loading'; render();
  let data;
  try { data = await load(song); }
  catch (e) {
    console.error(e);
    if (G.sceneId === 'rhythm') { mode = 'menu'; render(); G.popup('Не получилось открыть песню 😢'); }
    return;
  }
  if (G.sceneId !== 'rhythm' || mode !== 'loading') return;
  const grid = beatGrid(song, data.an);
  const per = grid.length > 1 ? (grid[grid.length - 1] - grid[0]) / (grid.length - 1) : .5;
  P = {
    song, d, record, data,
    notes: record ? [] : makeChart(song, d, data.an),
    beats: per < .36 ? grid.filter((_, i) => i % 2 === 0) : grid, beatI: 0, frame: 0, pulse: 0,
    head: 0, score: 0, shown: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0,
    holds: [null, null, null, null], recDown: [null, null, null, null],
    fx: [], beams: [], floats: [], flash: 0, paused: false, ended: false,
    lat: ctx.outputLatency || ctx.baseLatency || 0, t0: 0, src: null
  };
  mode = 'play'; render();
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = data.buffer;
  gain.gain.value = R.volume ?? 1;
  src.connect(gain).connect(ctx.destination);
  P.t0 = ctx.currentTime + LEAD;
  src.start(P.t0);
  P.src = src;
}

const addFx = (name, lane, scale = 1) => P.fx.push({ name, t0: clock, x: laneX(lane), y: R.hitLine, scale });

function addScore(v) { P.score += Math.round(v * Math.min(2, 1 + Math.floor(P.combo / 10) * .1)); }

function comboUp() {
  P.combo++; P.maxCombo = Math.max(P.maxCombo, P.combo);
  if (P.combo > 0 && P.combo % (R.comboEvery || 25) === 0) {
    P.fx.push({ name: 'comboBurst', t0: clock, x: R.highway.x + R.highway.w / 2, y: R.hitLine - 170, scale: 1.4 });
    P.flash = 1;
    showJudge(`${P.combo} ${R.texts.combo}!`, 'c');
    G.blip(1320, .2, 'sine', .05);
  }
}

function judgeDown(lane) {
  if (!P || P.paused || P.ended) return;
  const t = now();
  down[lane] = true; press[lane] = clock;
  if (P.record) { if (t > 0) P.recDown[lane] = t; return; }
  let best = null, bd = 1e9;
  for (let i = P.head; i < P.notes.length; i++) {
    const n = P.notes[i];
    if (n.t - t > P.d.good) break;
    if (n.done || n.lane !== lane) continue;
    const dd = Math.abs(n.t - t);
    if (dd < bd) { bd = dd; best = n; }
  }
  if (!best || bd > P.d.good) return;
  best.done = true;
  const perfect = bd <= P.d.perfect;
  P[perfect ? 'perfect' : 'good']++;
  comboUp();
  addScore(perfect ? 100 : 50);
  addFx(perfect ? 'hitPerfect' : 'hitGood', lane, perfect ? 1.1 : 1);
  P.beams.push({ lane, t0: clock, perfect });
  if (best.len > 0) { best.holding = true; best.tick = 0; P.holds[lane] = best; }
  if (!(P.combo % (R.comboEvery || 25) === 0)) showJudge(perfect ? R.texts.perfect : R.texts.good, perfect ? 'p' : 'g');
  paintHud();
}

function judgeUp(lane) {
  down[lane] = false;
  if (!P || P.ended) return;
  const t = now();
  if (P.record) {
    const t1 = P.recDown[lane];
    if (t1 != null) {
      const len = t - t1 >= .4 ? G.round(t - t1, 3) : 0;
      P.notes.push({ t: G.round(t1, 3), lane, len, done: true });
      P.recDown[lane] = null;
      addFx('hitGood', lane); paintHud();
    }
    return;
  }
  const h = P.holds[lane];
  if (!h || !h.holding) return;
  h.holding = false; P.holds[lane] = null;
  if (t < h.t + h.len - (R.holdSlack ?? .16)) {          // отпустили рано
    h.broken = true; P.combo = 0; P.miss++;
    showJudge(R.texts.miss, 'm');
  } else finishHold(h, lane);
  paintHud();
}

function finishHold(h, lane) {
  h.holding = false; h.finished = true; P.holds[lane] = null;
  comboUp(); addScore(50);
  addFx('hitPerfect', lane, 1.25);
  showJudge(R.texts.perfect, 'p');
}

function showJudge(text, kind) {
  if (!ui.judge) return;
  ui.judge.textContent = text;
  ui.judge.className = 'rh-judge rh-judge--' + kind;
  ui.judge.style.setProperty('--rot', (Math.random() * 10 - 5) + 'deg');
  void ui.judge.offsetWidth;
  ui.judge.classList.add('is-on');
}

function paintHud() {
  if (!ui.score) return;
  if (P.record) { ui.score.textContent = P.notes.length; ui.combo.textContent = '● REC · Esc — стоп'; return; }
  ui.combo.textContent = P.combo > 1 ? `${P.combo} ${R.texts.combo}` : '';
  ui.combo.classList.remove('is-pop'); void ui.combo.offsetWidth; ui.combo.classList.add('is-pop');
}

function tick(dt) {
  const t = now(), an = P.data.an;
  if (!P.paused) {
    for (let i = P.head; i < P.notes.length; i++) {
      const n = P.notes[i];
      if (n.t > t - P.d.good) break;
      if (!n.done) { n.done = true; n.miss = true; P.miss++; P.combo = 0; showJudge(R.texts.miss, 'm'); paintHud(); }
    }
    while (P.head < P.notes.length && P.notes[P.head].t + (P.notes[P.head].len || 0) < t - 1.2) P.head++;
    // длинные ноты: очки капают, пока держишь
    for (let l = 0; l < 4; l++) {
      const h = P.holds[l];
      if (!h) continue;
      h.tick += dt;
      while (h.tick >= .1) { h.tick -= .1; addScore(10); }
      if (t >= h.t + h.len) { finishHold(h, l); paintHud(); }
    }
    let beat = false;
    while (P.beatI < P.beats.length && P.beats[P.beatI] <= t) { P.beatI++; beat = true; }
    if (beat) {
      P.frame = (P.frame + 1) % Math.max(1, R.dancer.cols || 1);
      P.pulse = 1;
      if (Math.random() < .5) P.floats.push({ x: G.rnd(R.dancer.x - 150, R.dancer.x + 150), y: R.dancer.y - 60, t0: clock, ch: ['♪', '♫', '♥', '✦'][(Math.random() * 4) | 0], vx: G.rnd(-14, 14) });
    }
    P.pulse = Math.max(0, P.pulse - dt * 4.5);
    P.flash = Math.max(0, P.flash - dt * 2.5);
    P.shown += (P.score - P.shown) * Math.min(1, dt * 12);
    if (ui.score && !P.record) ui.score.textContent = Math.round(P.shown);
    if (ui.prog) { const u = G.clamp(t / an.duration, 0, 1) * 100; ui.prog.style.width = u + '%'; ui.knob.style.left = u + '%'; }
    if (t > an.duration + .6 && !P.ended) finish();
  }
  draw(t);
}

function finish() {
  P.ended = true;
  stopAudio();
  if (P.record) {
    const song = P.song;
    (song.charts ||= {})[P.d.id] = P.notes.sort((a, b) => a.t - b.t).map(n => n.len ? [n.t, n.lane, n.len] : [n.t, n.lane]);
    G.editor.changed();
    mode = 'menu'; render();
    G.popup(`Записано нот: ${P.notes.length}. F10 → «Сохранить»`, 3500);
    return;
  }
  const k = `${P.song.id}/${P.d.id}`, old = G.progress.records[k] || 0;
  P.isRecord = P.score > old;
  if (P.isRecord) G.progress.records[k] = P.score;
  P.oldRecord = old;
  G.progress.songs[P.song.id] = true;
  G.saveProgress();
  mode = 'result'; render();
  G.sfx.win();
  G.fx.screen('confetti', innerWidth / 2, innerHeight / 2, { scale: Math.max(1.8, G.k * 2.4) });
}

function setPause(on) {
  if (!P || P.ended || mode !== 'play') return;
  P.paused = on;
  on ? ctx.suspend() : ctx.resume();
  ui.pause.hidden = !on;
}

function quitToMenu() {
  stopAudio();
  ctx?.resume();
  P = null; mode = 'menu'; render();
}

/* ============================================================
   РИСОВАНИЕ (вектор, полное разрешение экрана)
   ============================================================ */
const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(255,143,163,${a})`;
};
const lighten = (hex, k) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#ff8fa3');
  return `rgb(${[1, 2, 3].map(i => Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * k)).join(',')})`;
};
function rr(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function star(x, y, r, rot = 0, n = 5, inner = .5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n - Math.PI / 2, rad = i % 2 ? r * inner : r;
    i ? g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad) : g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}
const ICON_ROT = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

/** пухлая нота: белая обводка, заливка цветом дорожки, блик */
function noteShape(x, y, s, lane, alpha = 1, glow = 0) {
  const L = R.lanes[lane], icon = L.icon || 'right', im = image(L.img);
  g.save();
  g.translate(x, y); g.globalAlpha *= alpha;
  if (im) { const h = s * im.naturalHeight / im.naturalWidth; g.drawImage(im, -s / 2, -h / 2, s, h); g.restore(); return; }
  const k = s / 64;
  g.scale(k, k);
  if (glow > 0) { g.shadowColor = rgba(L.color, .9); g.shadowBlur = 22 * glow; }
  const rot = ICON_ROT[icon] ?? 0;
  g.rotate(rot);
  const path = () => {
    if (icon === 'heart') {
      g.beginPath(); g.moveTo(0, 22); g.bezierCurveTo(-34, -2, -22, -30, 0, -12); g.bezierCurveTo(22, -30, 34, -2, 0, 22); g.closePath();
    } else if (icon === 'star') star(0, 2, 27, 0, 5, .52);
    else if (icon === 'circle') { g.beginPath(); g.arc(0, 0, 24, 0, TAU); }
    else {
      g.beginPath(); g.moveTo(26, 0); g.lineTo(2, -24); g.lineTo(2, -11); g.lineTo(-24, -11); g.lineTo(-24, 11); g.lineTo(2, 11); g.lineTo(2, 24); g.closePath();
    }
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  path(); g.lineWidth = 15; g.strokeStyle = '#ffffff'; g.stroke();
  g.shadowBlur = 0;
  path(); g.lineWidth = 7; g.strokeStyle = L.color; g.stroke();
  path(); g.fillStyle = lighten(L.color, .28); g.fill();
  g.save(); path(); g.clip();
  g.rotate(-rot);
  g.fillStyle = 'rgba(255,255,255,.42)'; g.beginPath(); g.ellipse(-4, -16, 30, 12, -.2, 0, TAU); g.fill();
  g.restore();
  g.restore();
}

function receptor(i, t) {
  const x = laneX(i), y = R.hitLine, L = R.lanes[i], s = R.noteSize;
  const k = 1 + .2 * Math.max(0, 1 - (clock - press[i]) * 7) - (down[i] ? .06 : 0);
  g.save();
  g.translate(x, y); g.scale(k, k);
  g.fillStyle = down[i] ? rgba(L.color, .55) : 'rgba(255,255,255,.55)';
  g.strokeStyle = '#ffffff'; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, s * .58, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = L.color; g.lineWidth = 3; g.setLineDash([7, 7]); g.lineDashOffset = -t * 30;
  g.beginPath(); g.arc(0, 0, s * .58 - 6, 0, TAU); g.stroke(); g.setLineDash([]);
  g.restore();
  noteShape(x, y, s * .62 * k, i, down[i] ? .95 : .4);
  g.font = '800 17px "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.lineJoin = 'round';
  g.strokeText(R.keys[i] || '', x, y + s * .58 + 22); g.fillStyle = L.color; g.fillText(R.keys[i] || '', x, y + s * .58 + 22);
}

function background(t, pulse) {
  const bg = image(R.bg);
  if (bg) { g.drawImage(bg, 0, 0, G.VW, G.VH); return; }
  const B = R.stage || {};
  let gr = g.createLinearGradient(0, 0, 0, G.VH);
  gr.addColorStop(0, B.top || '#ffd6e6'); gr.addColorStop(.55, B.mid || '#ffc2dc'); gr.addColorStop(1, B.bottom || '#e9c7ff');
  g.fillStyle = gr; g.fillRect(0, 0, G.VW, G.VH);
  // лучи из-за сцены
  g.save(); g.translate(G.VW * .5, G.VH * .5); g.rotate(clock * .06);
  for (let i = 0; i < 14; i++) {
    g.rotate(TAU / 14);
    g.fillStyle = `rgba(255,255,255,${.1 + .08 * pulse})`;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(900, -70); g.lineTo(900, 70); g.closePath(); g.fill();
  }
  g.restore();
  gr = g.createRadialGradient(G.VW * .5, G.VH * .5, 30, G.VW * .5, G.VH * .5, 520);
  gr.addColorStop(0, `rgba(255,250,230,${.5 + .25 * pulse})`); gr.addColorStop(1, 'rgba(255,250,230,0)');
  g.fillStyle = gr; g.fillRect(0, 0, G.VW, G.VH);
  // большие звёзды
  for (const [x, y, r, rot] of [[140, 96, 62, -.2], [846, 150, 74, .25], [68, 420, 40, .3], [905, 440, 34, -.2]]) {
    star(x, y, r * (1 + .05 * pulse), rot + Math.sin(clock * .7 + x) * .06, 5, .58);
    g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = B.star || '#ffd95e'; g.stroke(); g.fillStyle = B.star || '#ffd95e'; g.fill();
    star(x - r * .12, y - r * .14, r * .5, rot, 5, .58); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  }
  // сцена-подиум в клетку под танцовщицей
  const D = R.dancer, px = D.x - 160, py = D.y - 26, pw = 320, ph = 74;
  g.save();
  rr(px, py + 16, pw, ph, 26); g.fillStyle = B.podiumSide || '#b99cf0'; g.fill();
  rr(px, py, pw, ph, 26); g.clip();
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) {
    g.fillStyle = (i + j) % 2 ? (B.podiumA || '#ffffff') : (B.podiumB || '#d9c4ff');
    g.fillRect(px + i * 44 - j * 10, py + j * 20, 44, 20);
  }
  g.restore();
  rr(px, py, pw, ph, 26); g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.stroke();
  // колонки
  for (const sx of [px - 50, px + pw - 18]) {
    rr(sx, py - 30, 68, 104, 16); g.fillStyle = B.speaker || '#ff9ec4'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.stroke();
    for (const [cy, r] of [[py - 4, 13], [py + 40, 20 + 3 * pulse]]) {
      g.beginPath(); g.arc(sx + 34, cy, r, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.arc(sx + 34, cy, r * .55, 0, TAU); g.fillStyle = B.speakerCone || '#ff5c9a'; g.fill();
    }
  }
  // кулисы
  const curtain = (sx, dir) => {
    g.save(); g.translate(sx, 0); g.scale(dir, 1);
    g.beginPath(); g.moveTo(-10, -10); g.lineTo(190, -10);
    g.bezierCurveTo(170, 120, 96, 210, 40, 300); g.bezierCurveTo(20, 340, 4, 400, -10, 470); g.closePath();
    g.fillStyle = B.curtain || '#ff8fbd'; g.fill();
    g.strokeStyle = B.curtainFold || '#f4699f'; g.lineWidth = 6; g.lineCap = 'round';
    for (const [a, b, c, d] of [[60, 0, 30, 250], [110, 0, 60, 190], [20, 30, 2, 330]]) { g.beginPath(); g.moveTo(a, b); g.quadraticCurveTo(a - 6, (b + d) / 2, c, d); g.stroke(); }
    g.restore();
  };
  curtain(0, 1); curtain(G.VW, -1);
  g.fillStyle = B.valance || '#ff6fa8';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(G.VW, 0); g.lineTo(G.VW, 22);
  for (let x = G.VW; x > 0; x -= 60) g.quadraticCurveTo(x - 30, 54, x - 60, 22);
  g.closePath(); g.fill();
  // мерцающие искры (Arcadia)
  G.fx.draw(g, 'twinkle', clock, G.VW / 2, 190, 3.4, .9);
}

function dancer(t, pulse, frame) {
  const D = R.dancer, im = image(D.img);
  // пятно света
  const gr = g.createRadialGradient(D.x, D.y - 6, 4, D.x, D.y - 6, 150);
  gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.save(); g.translate(D.x, D.y - 6); g.scale(1, .22); g.translate(-D.x, -(D.y - 6));
  g.fillStyle = gr; g.beginPath(); g.arc(D.x, D.y - 6, 150, 0, TAU); g.fill(); g.restore();
  if (!im) return;
  const cols = Math.max(1, D.cols || 1), fw = im.naturalWidth / cols, w = D.w, h = w * im.naturalHeight / fw;
  g.save();
  g.translate(D.x, D.y - pulse * 16);
  g.scale(1 + pulse * .05, 1 - pulse * .06);
  if (D.pixel) g.imageSmoothingEnabled = false;
  g.drawImage(im, (frame % cols) * fw, 0, fw, im.naturalHeight, -w / 2, -h, w, h);
  g.restore();
}

function draw(t) {
  if (!cv) return;
  const k = G.k * (window.devicePixelRatio || 1);
  if (k !== cvK) { cvK = k; cv.width = Math.round(G.VW * k); cv.height = Math.round(G.VH * k); }
  g.setTransform(cv.width / G.VW, 0, 0, cv.height / G.VH, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const pulse = P ? P.pulse : (Math.sin(clock * 4) > .92 ? 1 : 0) * .6;
  background(t, pulse);

  const H = R.highway, n = R.lanes.length, lw = H.w / n, hitY = R.hitLine, ns = R.noteSize;
  const approach = P?.d.approach || diff().approach;
  // дорожки
  g.save();
  rr(H.x - 10, H.y - 30, H.w + 20, H.h + 60, 34);
  g.fillStyle = 'rgba(255,255,255,.34)'; g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
  g.clip();
  for (let i = 0; i < n; i++) {
    const x = H.x + i * lw, col = R.lanes[i].color;
    const gr = g.createLinearGradient(0, H.y, 0, H.y + H.h);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, down[i] ? .5 : .22));
    g.fillStyle = gr; g.fillRect(x, H.y - 30, lw, H.h + 60);
    if (i) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x - 1.5, H.y - 30, 3, H.h + 60); }
  }
  // вспышки-лучи после попаданий
  if (P) {
    P.beams = P.beams.filter(b => clock - b.t0 < .35);
    for (const b of P.beams) {
      const u = (clock - b.t0) / .35, x = H.x + b.lane * lw;
      const gr = g.createLinearGradient(0, hitY, 0, hitY - 330);
      gr.addColorStop(0, `rgba(255,255,255,${(b.perfect ? .85 : .5) * (1 - u)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, hitY - 330, lw, 330);
    }
  }
  g.restore();
  // линия попадания
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(H.x + 6, hitY); g.lineTo(H.x + H.w - 6, hitY); g.stroke();
  for (let i = 0; i < n; i++) receptor(i, clock);

  // ноты
  const travel = hitY - H.y + ns;
  const yOf = time => hitY - (time - t) / approach * travel;
  const list = P ? P.notes : [{ t: .5, lane: 0 }, { t: .9, lane: 1, len: 1.1 }, { t: 1.3, lane: 2 }, { t: 1.7, lane: 3 }, { t: 2.1, lane: 2 }];
  g.save();
  g.beginPath(); g.rect(H.x - 40, H.y - 30, H.w + 80, G.VH); g.clip();
  for (let pass = 0; pass < 2; pass++) for (let i = P ? P.head : 0; i < list.length; i++) {
    const nt = list[i];
    if (nt.t - t > approach) break;
    const x = laneX(nt.lane), col = R.lanes[nt.lane].color;
    if (pass === 0) {                                   // хвосты длинных нот — под головами
      if (!(nt.len > 0) || nt.finished) continue;
      const y1 = yOf(nt.t + nt.len), y0 = nt.holding ? hitY : Math.min(yOf(nt.t), G.VH + 60);
      if (y1 > G.VH + 40 || y0 < H.y - 60) continue;
      const dead = nt.miss || nt.broken;
      g.globalAlpha = dead ? .3 : 1;
      g.lineCap = 'round';
      g.strokeStyle = '#ffffff'; g.lineWidth = ns * .62; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.strokeStyle = dead ? '#c9bfd6' : lighten(col, nt.holding ? .1 + .25 * Math.sin(clock * 22) ** 2 : .3);
      g.lineWidth = ns * .62 - 12; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 5; g.beginPath(); g.moveTo(x - ns * .13, y0); g.lineTo(x - ns * .13, y1); g.stroke();
      g.globalAlpha = 1;
      star(x, y1, 13, clock * 2, 4, .42); g.fillStyle = '#ffffff'; g.fill();
      continue;
    }
    if (nt.holding) { noteShape(x, hitY, ns * (1.05 + .06 * Math.sin(clock * 24)), nt.lane, 1, 1); continue; }
    if (nt.done && !nt.miss) continue;
    const y = yOf(nt.t);
    if (y > G.VH + ns) continue;
    noteShape(x, y, ns, nt.lane, nt.miss ? .28 : 1);
  }
  g.restore();

  if (P) {
    // искры удержания
    for (let l = 0; l < 4; l++) if (P.holds[l]) G.fx.draw(g, 'holdLoop', clock, laneX(l), hitY - 44, 1.25);
    // вспышки попаданий (атласы Arcadia)
    P.fx = P.fx.filter(f => G.fx.draw(g, f.name, clock - f.t0, f.x, f.y, f.scale));
    // всплывающие нотки и сердечки вокруг танцовщицы
    P.floats = P.floats.filter(f => clock - f.t0 < 1.6);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const f of P.floats) {
      const u = (clock - f.t0) / 1.6;
      g.globalAlpha = Math.sin(Math.PI * u);
      g.font = `800 ${22 + 10 * u}px "M PLUS Rounded 1c", sans-serif`;
      g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.lineJoin = 'round';
      const x = f.x + f.vx * u * 3 + Math.sin(u * 7 + f.x) * 8, y = f.y - 150 * u - 120;
      g.strokeText(f.ch, x, y); g.fillStyle = ['#ff5c9a', '#b388ff', '#58c6ff', '#ffb72e'][f.ch.charCodeAt(0) % 4]; g.fillText(f.ch, x, y);
    }
    g.globalAlpha = 1;
  }
  dancer(t, pulse, P ? P.frame : Math.floor(clock * 2));
  if (P) {
    if (P.combo >= (R.auraCombo || 15)) G.fx.draw(g, 'twinkle', clock * 1.3, R.dancer.x, R.dancer.y - 150, 1.5, Math.min(1, (P.combo - (R.auraCombo || 15)) / 10 + .4));
    if (P.flash > 0) { g.fillStyle = `rgba(255,255,255,${P.flash * .45})`; g.fillRect(0, 0, G.VW, G.VH); }
    if (t < 0) {
      const num = Math.ceil(-t), u = 1 - (-t % 1);
      g.font = `900 ${110 + 30 * (1 - u)}px "M PLUS Rounded 1c", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 16; g.strokeStyle = '#ffffff'; g.lineJoin = 'round';
      g.strokeText(num, H.x + H.w / 2, 230); g.fillStyle = '#ff5c9a'; g.fillText(num, H.x + H.w / 2, 230);
    }
  }
}

/* ============================================================
   ЭКРАНЫ
   ============================================================ */
function renderMenu() {
  const T = R.texts;
  sel = G.clamp(sel, 0, R.songs.length - 1);
  const box = G.el('div', 'rm');
  box.innerHTML = `<h2 class="rm__h">${G.esc(T.title)}</h2>`;
  const list = G.el('div', 'rm__songs');
  R.songs.forEach((s, i) => {
    const ok = !!s.src, rec = recOf(s, diff());
    const b = G.el('button', 'rm__song' + (i === sel ? ' is-on' : '') + (ok ? '' : ' is-soon'),
      `<i>${ok ? (G.progress.songs[s.id] ? '🍒' : '♪') : '🔒'}</i>` +
      `<span><b>${G.esc(s.title)}</b><small>${G.esc(ok ? s.artist : T.soon)}</small></span>` +
      (ok ? `<em>${G.esc(T.record)}<b>${rec}</b></em>` : ''));
    b.onclick = () => { if (i === sel && ok) start(s); else { sel = i; G.sfx.tap(); render(); } };
    list.appendChild(b);
  });
  box.appendChild(list);
  const ds = G.el('div', 'rm__diffs');
  R.difficulties.forEach((d, i) => {
    const b = G.el('button', 'rm__diff' + (i === diffI ? ' is-on' : ''), G.esc(d.name));
    b.onclick = () => { diffI = i; G.writeLS('cherry.rhythm.diff', i); G.sfx.tap(); render(); };
    ds.appendChild(b);
  });
  box.appendChild(ds);
  const act = G.el('div', 'rm__actions');
  const ex = G.el('button', 'cbtn cbtn--ghost', G.esc(T.exit));
  ex.onclick = exit;
  const go = G.el('button', 'cbtn cbtn--big', '▶ ' + G.esc(T.play));
  go.disabled = !R.songs[sel]?.src;
  go.onclick = () => start(R.songs[sel]);
  act.append(ex, go);
  box.appendChild(act);
  box.appendChild(G.el('div', 'rm__keys', R.keys.map((k, i) => `<kbd style="--c:${R.lanes[i]?.color || '#ff8fa3'}">${G.esc(k)}</kbd>`).join('') + `<span>${G.esc(T.keysHint || '')}</span>`));
  root.appendChild(box);
}

function proxy(o, path, label) {
  const z = G.zone(o, path, label, 'zone--edit');
  root.appendChild(z);
  return z;
}

function renderPlay() {
  // рамки для редактора: дорожки, танцовщица, счёт
  proxy(R.highway, 'rhythm.highway', 'дорожки');
  const D = R.dancer, dz = G.el('div', 'ent zone zone--edit', '<span>танцовщица</span>');
  G.place(dz, D); dz.style.height = (D.w * 1.3) + 'px'; dz.dataset.edit = 'rhythm.dancer';
  root.appendChild(dz);

  const top = G.el('div', 'rh-top',
    `<button class="rh-pause" title="Пауза (Esc)">❚❚</button><div class="rh-prog"><i></i><u>🍒</u></div><div class="rh-score"><b>0</b></div>`);
  root.appendChild(top);
  ui.prog = top.querySelector('.rh-prog i'); ui.knob = top.querySelector('.rh-prog u'); ui.score = top.querySelector('.rh-score b');
  top.querySelector('.rh-pause').onclick = () => setPause(true);

  const hud = G.el('div', 'ent rh-hud', `<small>${G.esc(P?.record ? 'Запись нот' : (P?.song.title || ''))}</small><i class="rh-combo"></i>`);
  G.place(hud, R.hud); hud.dataset.edit = 'rhythm.hud';
  root.appendChild(hud);
  ui.combo = hud.querySelector('.rh-combo');

  ui.judge = G.el('div', 'rh-judge');
  ui.judge.style.left = (R.highway.x + R.highway.w / 2) + 'px';
  ui.judge.style.top = (R.hitLine - 120) + 'px';
  root.appendChild(ui.judge);

  ui.pause = G.el('div', 'rh-over', `<div class="rm rm--small"><h2 class="rm__h">${G.esc(R.texts.paused)}</h2><div class="rm__actions"></div></div>`);
  ui.pause.hidden = true;
  const b1 = G.el('button', 'cbtn cbtn--big', G.esc(R.texts.resume)), b2 = G.el('button', 'cbtn cbtn--ghost', G.esc(R.texts.quit));
  b1.onclick = () => setPause(false);
  b2.onclick = quitToMenu;
  ui.pause.querySelector('.rm__actions').append(b2, b1);
  root.appendChild(ui.pause);
  if (P) paintHud();
}

function renderResult() {
  const T = R.texts;
  const allSongs = playable().every(s => G.progress.songs[s.id]);
  const goNext = allSongs && !G.isDone('rhythm');
  const box = G.el('div', 'rm rm--result');
  box.innerHTML =
    `<div class="rm__sub">♪ ${G.esc(P.song.title)} · ${G.esc(P.d.name)}</div>` +
    `<small class="rm__lbl">${G.esc(T.score)}</small><div class="rm__big">${P.score}</div>` +
    (P.isRecord ? `<div class="rm__newrec">★ ${G.esc(T.newRecord)} ★</div>`
                : `<div class="rm__rec">${G.esc(T.record)}: ${P.oldRecord}</div>`);
  const act = G.el('div', 'rm__actions');
  const again = G.el('button', 'cbtn cbtn--ghost', '↻ ' + G.esc(T.again));
  again.onclick = () => start(P.song);
  const songs = G.el('button', 'cbtn' + (goNext ? ' cbtn--ghost' : ''), G.esc(T.toSongs));
  songs.onclick = quitToMenu;
  act.append(again, songs);
  if (goNext) {
    const nx = G.el('button', 'cbtn cbtn--big', G.esc(T.next) + ' ▸');
    nx.onclick = () => G.completeRoom('rhythm');
    act.appendChild(nx);
  }
  box.appendChild(act);
  root.appendChild(box);
}

function render() {
  R = G.cfg.rhythm;
  root.innerHTML = '';
  ui = {};
  cv = G.el('canvas', 'rh-cv');
  g = cv.getContext('2d');
  cvK = 0;
  root.appendChild(cv);
  root.dataset.mode = mode;

  if (mode === 'menu') renderMenu();
  else if (mode === 'loading') {
    const box = G.el('div', 'rm rm--small',
      `<h2 class="rm__h">${G.esc(R.texts.loading)}</h2><div class="rm__load"><i></i></div><div class="rm__spin">🍒</div>`);
    root.appendChild(box);
    ui.loadBar = box.querySelector('.rm__load i');
  }
  else if (mode === 'result') renderResult();
  else renderPlay();

  cv.onpointerdown = e => {
    if (G.editing || !P || mode !== 'play') return;
    const p = G.toView(e), H = R.highway;
    const lane = Math.floor((p.x - H.x) / (H.w / R.lanes.length));
    if (lane < 0 || lane >= R.lanes.length) return;
    judgeDown(lane);
    const up = () => { judgeUp(lane); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  draw(P ? now() : 0);
}

function exit() {
  stopAudio();
  G.go('world', { room: 'rhythm' });
}

G.scenes.rhythm = {
  root,
  /** для отладки из консоли: G.scenes.rhythm.state */
  get state() { return { mode, play: P, time: P && ctx ? now() : 0 }; },
  /** анализ произвольного AudioBuffer (для проверки точности) */
  analyze: b => { R = G.cfg.rhythm; return analyze(b); },

  enter() {
    G.music('');
    P = null; mode = 'menu';
    R = G.cfg.rhythm;
    sel = Math.max(0, R.songs.findIndex(s => s.src));
    render();
  },
  leave() { stopAudio(); ctx?.suspend(); P = null; mode = 'menu'; },
  refresh() { if (mode !== 'loading') render(); },
  onEdit(on) { if (on && mode === 'play') setPause(true); },

  update(dt) {
    clock += dt;
    if (mode === 'play' && P) tick(dt);
    else if (mode === 'layout') draw(clock % 2.6 - .4);
    else draw(0);
  },

  key(e) {
    if (mode === 'play') {
      const lane = laneOfCode(e.code);
      if (lane >= 0) { if (!e.repeat) judgeDown(lane); }
      else if (e.code === 'Escape') { if (P.record) finish(); else setPause(!P.paused); }
      else if (P.paused && G.isAction(e)) setPause(false);
      return;
    }
    if (mode === 'menu') {
      const n = R.songs.length, m = R.difficulties.length;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { sel = (sel + n - 1) % n; G.sfx.tap(); render(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { sel = (sel + 1) % n; G.sfx.tap(); render(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { diffI = (diffI + m - 1) % m; G.writeLS('cherry.rhythm.diff', diffI); G.sfx.tap(); render(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { diffI = (diffI + 1) % m; G.writeLS('cherry.rhythm.diff', diffI); G.sfx.tap(); render(); }
      else if (G.isAction(e) && R.songs[sel]?.src) start(R.songs[sel]);
      else if (e.code === 'Escape') exit();
      return;
    }
    if (mode === 'result' && G.isAction(e)) root.querySelector('.rm__actions .cbtn:last-child')?.click();
  },
  keyup(e) { const lane = laneOfCode(e.code); if (lane >= 0) judgeUp(lane); },

  editRoots: () => [{ path: 'rhythm', label: 'Ритм-игра' }, { path: 'world.rooms.rhythm.cutscene', label: 'Катсцена после игры' }],

  editorTools(box) {
    const song = R.songs[sel], d = diff();
    const has = song?.charts?.[d.id]?.length, an = song && cache.get(song.src)?.an;
    box.innerHTML =
      `<div class="ed__label">Экран</div><div class="ed__row">
         <button class="ed__btn${mode === 'menu' ? ' is-on' : ''}" id="rhM">Меню песен</button>
         <button class="ed__btn${mode === 'layout' ? ' is-on' : ''}" id="rhL">Игра (расстановка)</button></div>
       <div class="ed__label">Ноты: «${G.esc(song?.title || '—')}» · ${G.esc(d.name)}</div>
       <p class="ed__note">${has ? `Записано вручную: ${has} нот.` : 'Ноты ставятся автоматически на доли песни.'}
         ${an ? `Найденный темп: <b>${an.bpm.toFixed(1)} BPM</b>.` : ''}
         Если ноты чуть раньше или позже музыки — поправь «Сдвиг звука, мс». Свои ноты: кнопка ниже, песня заиграет —
         стучи по ${R.keys.join(' ')} (держи для длинной ноты). Esc — закончить.</p>
       <div class="ed__row"><button class="ed__btn" id="rhRec">🎙 Записать ноты</button>
         <button class="ed__btn" id="rhDel" ${has ? '' : 'disabled'}>🗑 Удалить запись</button></div>`;
    box.querySelector('#rhM').onclick = () => { stopAudio(); P = null; mode = 'menu'; render(); G.editor.sceneChanged(); };
    box.querySelector('#rhL').onclick = () => { stopAudio(); P = null; mode = 'layout'; render(); G.editor.sceneChanged(); };
    box.querySelector('#rhRec').onclick = () => {
      if (!song?.src) { G.editor.note('У этой песни ещё нет файла'); return; }
      G.editor.toggle(false);
      start(song, { record: true });
    };
    box.querySelector('#rhDel').onclick = () => { delete song.charts[d.id]; G.editor.changed(); G.editor.sceneChanged(); };
  }
};

})();
