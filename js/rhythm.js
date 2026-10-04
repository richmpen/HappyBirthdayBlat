/* ============================================================
   rhythm.js — ритм-игра (4 дорожки, клавиши S D K L)
   ------------------------------------------------------------
   • Игра сама «слушает» песню: находит удары, вычисляет темп и
     ДОЛИ (beat tracking), и ставит ноты строго на сетку долей —
     поэтому они попадают в ритм. Сложность решает, какие клетки
     сетки заняты: только доли, половинки или четвертушки.
   • Длинные ноты: нажми в начале и держи до конца хвоста.
   • Свои ноты можно записать в редакторе (F10 → «Записать ноты»).
   • Оформление — неоновая сцена из макета (папка «ритм игра/»).
     Всё рисуется на canvas в координатах макета (artW × …,
     1672×941) и растягивается на экран 960×540. Картинки сцены —
     списки back / band / front / overlay, их можно двигать мышкой
     в редакторе. Точка картинки — низ-центр, или pivot [0–1, 0–1].
   • Анимации слоёв (поле anim): beam — прожектор качается вокруг
     pivot, glow — свечение дышит в такт, pulse — вспышка на долю,
     sway — покачивание, twinkle — мерцание.
   • Персонажи (band) меняют кадры на каждую долю песни (every —
     через сколько долей), фразы (phrases) всплывают во время игры.
   Настройки — data/game.json → rhythm.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-rhythm');
const LEAD = 2.4;                        // секунд до начала песни
const TAU = Math.PI * 2;
const IDLE_BEAT = .56;                   // темп танца в меню, секунд на долю
const SQ = '"Game Of Squids", "Glina Script", sans-serif';
const GL = '"Glina Script", "Game Of Squids", sans-serif';

let R = null;
let mode = 'menu';                       // menu | loading | play | result | layout
let sel = 0, diffI = G.readLS('cherry.rhythm.diff', 0);
let P = null;                            // текущее прохождение
let ctx = null;                          // AudioContext песни (ставится на паузу)
let cv = null, g = null, cvK = 0, ui = {}, clock = 0;
let art = null;                          // слой HTML поверх холста, в координатах макета
const beat = { n: 0, pulse: 0, next: 0 };  // доли: в игре — песни, в меню — свои
const cache = new Map();                 // src → { buffer, an }
const down = [false, false, false, false];
const press = [0, 0, 0, 0];              // время последнего нажатия (для анимации кнопок)
const imgs = new Map();
const sprites = new Map();               // готовые неоновые стрелки под текущий размер холста

const diff = () => R.difficulties[G.clamp(diffI, 0, R.difficulties.length - 1)];
const playable = () => R.songs.filter(s => s.src);
const recOf = (song, d) => G.progress.records[`${song.id}/${d.id}`] || 0;
const starsOf = (song, d) => G.progress.stars?.[`${song.id}/${d.id}`] || 0;
const laneOfCode = code => ['KeyS', 'KeyD', 'KeyK', 'KeyL'].indexOf(code);
const image = p => { if (!p) return null; let i = imgs.get(p); if (!i) { i = new Image(); i.src = G.asset(p); imgs.set(p, i); } return i.complete && i.naturalWidth ? i : null; };
const AW = () => R.artW || 1672;         // ширина макета
const AK = () => G.VW / AW();            // экранных пикселей на пиксель макета
const AH = () => G.VH / AK();            // высота макета
const neon = () => R.neon || '#88e856';
const px = () => cv.width / AW();        // пикселей холста на пиксель макета (для shadowBlur)

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
const laneX = i => R.lanes[i]?.x ?? (R.highway.x + (i + .5) * R.highway.w / R.lanes.length);
const laneColor = i => R.lanes[i]?.color || neon();

function stopAudio() {
  if (P?.src) { try { P.src.onended = null; P.src.stop(); } catch {} P.src = null; }
}

/** сколько очков даст идеальное прохождение — от него считаются звёзды */
function perfectScore(notes) {
  let s = 0, c = 0;
  const add = v => { s += Math.round(v * Math.min(2, 1 + Math.floor(c / 10) * .1)); };
  for (const n of notes) {
    c++; add(100);
    if (n.len > 0) { for (let k = Math.floor(n.len / .1); k > 0; k--) add(10); c++; add(50); }
  }
  return s;
}

async function start(song, { record = false } = {}) {
  const d = diff();
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  stopAudio();
  P = null;
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
    beats: per < .36 ? grid.filter((_, i) => i % 2 === 0) : grid, beatI: 0, count: 4,
    head: 0, score: 0, shown: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, max: 0,
    stars: 0, starAt: [-9, -9, -9], comboAt: -9,
    holds: [null, null, null, null], recDown: [null, null, null, null],
    fx: [], beams: [], sparks: [], flash: 0,
    phrase: null, phraseI: 0, phraseNext: 0,
    paused: false, ended: false,
    lat: ctx.outputLatency || ctx.baseLatency || 0, t0: 0, src: null
  };
  P.max = perfectScore(P.notes);
  P.phraseNext = clock + LEAD + 3;
  mode = 'play'; render();
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = data.buffer;
  gain.gain.value = R.volume ?? 1;
  src.connect(gain).connect(ctx.destination);
  P.t0 = ctx.currentTime + LEAD;
  src.start(P.t0);
  P.src = src;
}

/** вспышка попадания: кольцо, звезда-взрыв и искры */
function addFx(lane, perfect, big = false, x = laneX(lane), y = R.hitLine) {
  const parts = [];
  for (let i = 0, n = perfect ? 12 : 8; i < n; i++) parts.push({ a: TAU * i / n + G.rnd(-.25, .25), v: G.rnd(.6, 1.2), len: G.rnd(18, 42) });
  P.fx.push({ x, y, t0: clock, perfect, big, rot: G.rnd(0, TAU), parts, col: laneColor(lane) });
}

function addScore(v) { P.score += Math.round(v * Math.min(2, 1 + Math.floor(P.combo / 10) * .1)); }

function comboUp() {
  P.combo++; P.maxCombo = Math.max(P.maxCombo, P.combo);
  P.comboAt = clock;
  if (P.combo > 0 && P.combo % (R.comboEvery || 25) === 0) {
    const H = R.highway;
    addFx(1, true, true, H.x + H.w / 2, R.hitLine - 300);
    P.flash = 1;
    showJudge(`${P.combo} ${R.texts.combo}!`, 'c');
    showPhrase();
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
  addFx(lane, perfect);
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
      addFx(lane, false); paintHud();
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
  addFx(lane, true);
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
  if (ui.rec && P?.record) ui.rec.textContent = `● REC · ${P.notes.length} · Esc — стоп`;
}

/** фразы из макета по очереди всплывают во время игры (и сразу — на вспышке комбо) */
function showPhrase() {
  const n = R.phrases?.length || 0;
  if (!n || !P || P.record) return;
  P.phrase = { i: P.phraseI++ % n, t0: clock };
}
function phraseTick(t) {
  const show = R.phraseShow ?? 3.2;
  if (P.phrase && clock - P.phrase.t0 > show + .45) {
    P.phrase = null;
    P.phraseNext = clock + (R.phraseGap ?? 4) * G.rnd(.7, 1.5);
  }
  if (!P.phrase && t > 1 && clock >= P.phraseNext) showPhrase();
}

function onBeat() { beat.n++; beat.pulse = 1; }

function tick(dt) {
  const t = now(), an = P.data.an;
  if (!P.paused) {
    for (let i = P.head; i < P.notes.length; i++) {
      const n = P.notes[i];
      if (n.t > t - P.d.good) break;
      if (!n.done) { n.done = true; n.miss = true; P.miss++; P.combo = 0; showJudge(R.texts.miss, 'm'); paintHud(); }
    }
    while (P.head < P.notes.length && P.notes[P.head].t + (P.notes[P.head].len || 0) < t - 1.2) P.head++;
    // длинные ноты: очки капают, пока держишь, из-под кнопки сыплются искры
    for (let l = 0; l < 4; l++) {
      const h = P.holds[l];
      if (!h) continue;
      h.tick += dt;
      while (h.tick >= .1) { h.tick -= .1; addScore(10); }
      if (Math.random() < dt * 45)
        P.sparks.push({ x: laneX(l) + G.rnd(-24, 24), y: R.hitLine - 16, vx: G.rnd(-140, 140), vy: G.rnd(-620, -320), t0: clock, life: G.rnd(.3, .55) });
      if (t >= h.t + h.len) { finishHold(h, l); paintHud(); }
    }
    // отсчёт 3-2-1 и доли песни: персонажи меняют кадр, сцена мигает
    if (t < 0) {
      const c = Math.ceil(-t);
      if (c < P.count) { P.count = c; onBeat(); G.blip(660, .1, 'square', .03); }
    }
    let hit = false;
    while (P.beatI < P.beats.length && P.beats[P.beatI] <= t) { P.beatI++; hit = true; }
    if (hit) onBeat();
    phraseTick(t);
    // звёзды — доля от идеального счёта
    if (P.max > 0) {
      const at = R.starAt || [.25, .5, .8];
      const n = at.filter(a => P.score >= a * P.max).length;
      for (let i = P.stars; i < n; i++) { P.starAt[i] = clock; G.blip(1180 + i * 160, .16, 'sine', .05); }
      P.stars = Math.max(P.stars, n);
    }
    P.flash = Math.max(0, P.flash - dt * 2.5);
    P.shown += (P.score - P.shown) * Math.min(1, dt * 12);
    P.prog = G.clamp(t / an.duration, 0, 1);
    if (t > an.duration + .6 && !P.ended) finish();
  }
  draw(t);
}

function finish() {
  P.ended = true;
  stopAudio();
  if (P.record) {
    const song = P.song, count = P.notes.length;
    (song.charts ||= {})[P.d.id] = P.notes.sort((a, b) => a.t - b.t).map(n => n.len ? [n.t, n.lane, n.len] : [n.t, n.lane]);
    G.editor.changed();
    P = null; mode = 'menu'; render();
    G.popup(`Записано нот: ${count}. F10 → «Сохранить»`, 3500);
    return;
  }
  const k = `${P.song.id}/${P.d.id}`, old = G.progress.records[k] || 0;
  P.isRecord = P.score > old;
  if (P.isRecord) G.progress.records[k] = P.score;
  P.oldRecord = old;
  G.progress.stars ||= {};
  G.progress.stars[k] = Math.max(G.progress.stars[k] || 0, P.stars);
  G.progress.songs[P.song.id] = true;
  G.saveProgress();
  P.phrase = null;
  mode = 'result'; render();
  G.sfx.win();
}

function setPause(on) {
  if (!P || P.ended || mode !== 'play') return;
  P.paused = on;
  on ? ctx.suspend() : ctx.resume();
  if (on) for (let l = 0; l < 4; l++) down[l] = false;
  if (ui.pause) ui.pause.hidden = !on;
}

function quitToMenu() {
  stopAudio();
  ctx?.resume();
  P = null; mode = 'menu'; render();
}

/* ============================================================
   РИСОВАНИЕ (координаты макета, полное разрешение экрана)
   ============================================================ */
const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(136,232,86,${a})`;
};
function star(c, x, y, r, rot = 0, n = 5, inner = .5) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n - Math.PI / 2, rad = i % 2 ? r * inner : r;
    i ? c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad) : c.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  c.closePath();
}
const backOut = u => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;
const ICON_ROT = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

/** слой сцены: картинка + анимация из поля anim */
function layer(L, i) {
  const im = image(L.img);
  if (!im || !(L.w > 0)) return;
  const w = L.w, h = w * im.naturalHeight / im.naturalWidth;
  const [ax, ay] = L.pivot || [.5, 1];
  const ph = L.phase ?? i, sp = L.speed || 1, pl = beat.pulse;
  let rot = 0, k = 1, a = L.alpha ?? 1;
  if (L.anim === 'beam') { rot = Math.sin(clock * .75 * sp + ph) * (L.swing ?? 13); a *= .7 + .3 * pl + .06 * Math.sin(clock * 3.1 + ph); }
  else if (L.anim === 'glow') { a *= .8 + .3 * pl; k = 1 + .02 * pl; }
  else if (L.anim === 'pulse') { k = 1 + .14 * pl; rot = Math.sin(clock * .9 * sp + ph) * 5; }
  else if (L.anim === 'sway') rot = Math.sin(clock * 1.1 * sp + ph) * (L.swing ?? 3);
  else if (L.anim === 'twinkle') { const u = .5 + .5 * Math.sin(clock * 2.4 * sp + ph * 2.3); a *= .2 + .8 * u; k = .75 + .35 * u + .15 * pl; }
  g.save();
  g.globalAlpha = G.clamp(a, 0, 1);
  if (L.blend === 'add') g.globalCompositeOperation = 'lighter';
  else if (L.blend === 'screen') g.globalCompositeOperation = 'screen';
  g.translate(L.x, L.y);
  if (rot) g.rotate(rot * Math.PI / 180);
  g.scale(L.flip ? -k : k, k);
  g.drawImage(im, -ax * w, -ay * h, w, h);
  g.restore();
}
const layers = list => (list || []).forEach(layer);

/** персонажи: кадр меняется на каждую долю, на долю — лёгкий подскок */
function bandDraw() {
  (R.band || []).forEach(B => {
    const fr = B.frames || [], n = fr.length;
    if (!n) return;
    const im = image(fr[Math.floor(beat.n / Math.max(1, B.every || 1)) % n]) || image(fr[0]);
    if (!im) return;
    const w = B.w, h = w * im.naturalHeight / im.naturalWidth, pl = beat.pulse;
    g.save();
    g.translate(B.x, B.y);
    g.scale((B.flip ? -1 : 1) * (1 + pl * .015), 1 - pl * .02);
    g.drawImage(im, -w / 2, -h - pl * (B.bounce ?? 6), w, h);
    g.restore();
  });
}

function iconPath(c, icon) {
  c.beginPath();
  if (icon === 'heart') { c.moveTo(0, 22); c.bezierCurveTo(-34, -2, -22, -30, 0, -12); c.bezierCurveTo(22, -30, 34, -2, 0, 22); c.closePath(); }
  else if (icon === 'star') star(c, 0, 2, 27, 0, 5, .52);
  else if (icon === 'circle') c.arc(0, 0, 24, 0, TAU);
  else { c.moveTo(27, 0); c.lineTo(3, -24); c.lineTo(3, -10); c.lineTo(-25, -10); c.lineTo(-25, 10); c.lineTo(3, 10); c.lineTo(3, 24); c.closePath(); }
}

/** неоновая стрелка, нарисованная один раз в своё полотно: note — летящая, lit — горит, dim — контур в кнопке */
function arrowSprite(lane, kind) {
  const icon = R.lanes[lane]?.icon || 'right', col = laneColor(lane);
  const s = R.noteSize * px(), key = `${icon}|${col}|${kind}|${Math.round(s)}`;
  let sp = sprites.get(key);
  if (sp) return sp;
  const size = Math.ceil(s * 1.9), c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), k = s / 64;
  x.translate(size / 2, size / 2); x.scale(k, k); x.rotate(ICON_ROT[icon] ?? 0);
  x.lineJoin = 'round'; x.lineCap = 'round';
  if (kind === 'dim') {
    iconPath(x, icon); x.fillStyle = 'rgba(0,0,0,.35)'; x.fill();
    iconPath(x, icon); x.lineWidth = 4; x.strokeStyle = rgba(col, .5); x.stroke();
  } else {
    const lit = kind === 'lit';
    iconPath(x, icon);
    const gr = x.createLinearGradient(-25, -24, 25, 24);
    gr.addColorStop(0, rgba(col, lit ? .85 : .5)); gr.addColorStop(1, rgba(col, lit ? .45 : .14));
    x.fillStyle = gr; x.fill();
    x.shadowColor = col; x.shadowBlur = (lit ? 30 : 18) * k;
    for (let i = 0; i < 2; i++) { iconPath(x, icon); x.lineWidth = 7; x.strokeStyle = col; x.stroke(); }
    x.shadowBlur = 0;
    iconPath(x, icon); x.lineWidth = 2.6; x.strokeStyle = '#f2ffea'; x.stroke();
  }
  sp = { c, size: size / px() };
  sprites.set(key, sp);
  return sp;
}

function drawArrow(lane, x, y, scale = 1, kind = 'note', alpha = 1) {
  const im = image(R.lanes[lane]?.img);
  g.save();
  g.globalAlpha *= alpha;
  if (im) {
    const w = R.noteSize * scale, h = w * im.naturalHeight / im.naturalWidth;
    g.drawImage(im, x - w / 2, y - h / 2, w, h);
  } else {
    const sp = arrowSprite(lane, kind), s = sp.size * scale;
    g.drawImage(sp.c, x - s / 2, y - s / 2, s, s);
  }
  g.restore();
}

/** кнопка дорожки: кольцо из макета, стрелка внутри и буква клавиши */
function receptor(i) {
  const x = laneX(i), y = R.hitLine, rs = R.ringSize || 124, col = laneColor(i);
  const hit = Math.max(0, 1 - (clock - press[i]) * 5), on = down[i] ? 1 : hit;
  const k = 1 + .08 * hit - (down[i] ? .04 : 0);
  const ring = image(R.ring), fill = image(R.ringFill);
  g.save();
  g.translate(x, y); g.scale(k, k);
  if (on > 0) {                                        // неоновый ореол
    const gr = g.createRadialGradient(0, 0, rs * .3, 0, 0, rs * .85);
    gr.addColorStop(0, rgba(col, .55 * on)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rs * .85, 0, TAU); g.fill();
  }
  if (ring) g.drawImage(ring, -rs / 2, -rs / 2, rs, rs);
  if (fill) { const f = rs * 94 / 124; g.drawImage(fill, -f / 2, -f / 2, f, f); }
  if (on > 0) {
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rs * .4);
    gr.addColorStop(0, rgba(col, .4 * on)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rs * .4, 0, TAU); g.fill();
  }
  g.restore();
  drawArrow(i, x, y, .6 * k, on > .3 ? 'lit' : 'dim', on > .3 ? .6 + .4 * on : 1);
  const ky = y + rs / 2 + 36;
  g.save();
  g.font = `${R.keySize || 42}px ${SQ}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = '#000';  // чёрная обводка — буквы видно и на шипах рамки
  g.strokeText(R.keys[i] || '', x, ky);
  g.shadowColor = col; g.shadowBlur = (6 + 16 * on) * px();
  g.fillStyle = on > .3 ? '#efffe6' : col;
  g.fillText(R.keys[i] || '', x, ky);
  g.restore();
}

/** световые столбы над нажатыми кнопками */
function laneLights() {
  const H = R.highway, rs = R.ringSize || 124, top = R.hitLine - 560;
  g.save();
  g.beginPath(); g.rect(H.x, H.y, H.w, H.h); g.clip();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < R.lanes.length; i++) {
    const a = Math.max(down[i] ? .2 : 0, Math.max(0, 1 - (clock - press[i]) * 3) * .3);
    if (a <= 0) continue;
    const gr = g.createLinearGradient(0, R.hitLine, 0, top);
    gr.addColorStop(0, rgba(laneColor(i), a)); gr.addColorStop(1, rgba(laneColor(i), 0));
    g.fillStyle = gr; g.fillRect(laneX(i) - rs * .55, top, rs * 1.1, R.hitLine - top);
  }
  if (P) {
    P.beams = P.beams.filter(b => clock - b.t0 < .35);
    for (const b of P.beams) {
      const u = (clock - b.t0) / .35, x = laneX(b.lane), w = rs * (.5 - .3 * u);
      const gr = g.createLinearGradient(0, R.hitLine, 0, top);
      gr.addColorStop(0, `rgba(235,255,225,${(b.perfect ? .7 : .4) * (1 - u)})`); gr.addColorStop(1, 'rgba(235,255,225,0)');
      g.fillStyle = gr; g.fillRect(x - w / 2, top, w, R.hitLine - top);
    }
  }
  g.restore();
}

/** большое полупрозрачное число комбо посреди дорожек */
function comboDraw() {
  if (!P || P.record || mode !== 'play' || P.combo < 5) return;
  const H = R.highway, cx = H.x + H.w / 2, pop = Math.max(0, 1 - (clock - P.comboAt) * 4);
  g.save();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = neon();
  g.globalAlpha = .2 + .25 * pop;
  g.font = `${Math.round(110 * (1 + .12 * pop))}px ${SQ}`;
  g.fillText(String(P.combo), cx, 175);
  g.globalAlpha = .32;
  g.font = `38px ${GL}`;
  g.fillText(R.texts.combo || '', cx, 240);
  g.restore();
}

const DEMO = [{ t: .5, lane: 0 }, { t: .9, lane: 1, len: 1.1 }, { t: 1.3, lane: 2 }, { t: 1.7, lane: 3 }, { t: 2.1, lane: 2 }];

function notesDraw(t) {
  const H = R.highway, hitY = R.hitLine, ns = R.noteSize;
  const approach = P?.d.approach || diff().approach;
  const travel = hitY - H.y + ns;
  const yOf = time => hitY - (time - t) / approach * travel;
  const list = P ? P.notes : DEMO;
  g.save();
  g.beginPath(); g.rect(H.x, H.y, H.w, H.h); g.clip();
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) for (let i = P ? P.head : 0; i < list.length; i++) {
    const nt = list[i];
    if (nt.t - t > approach) break;
    const x = laneX(nt.lane), col = laneColor(nt.lane);
    if (pass === 0) {                                   // хвосты длинных нот — неоновые лучи под головами
      if (!(nt.len > 0) || nt.finished) continue;
      const y1 = yOf(nt.t + nt.len), y0 = nt.holding ? hitY : Math.min(yOf(nt.t), H.y + H.h + 60);
      if (y1 > H.y + H.h + 40 || y0 < H.y - 60) continue;
      const dead = nt.miss || nt.broken;
      const line = (w, style) => { g.lineWidth = w; g.strokeStyle = style; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); };
      g.save();
      if (!dead) g.globalCompositeOperation = 'lighter';
      line(ns * .44, rgba(col, dead ? .08 : .16));
      line(ns * .18, rgba(col, dead ? .22 : nt.holding ? .7 + .3 * Math.sin(clock * 22) ** 2 : .55));
      line(ns * .05, dead ? 'rgba(200,200,200,.25)' : 'rgba(240,255,230,.9)');
      g.restore();
      g.save();
      g.globalAlpha = dead ? .3 : 1;
      g.shadowColor = col; g.shadowBlur = 12 * px();
      star(g, x, y1, 14, clock * 2, 4, .42); g.fillStyle = '#efffe6'; g.fill();
      g.restore();
      continue;
    }
    if (nt.holding) { drawArrow(nt.lane, x, hitY, 1.04 + .06 * Math.sin(clock * 24), 'lit'); continue; }
    if (nt.done && !nt.miss) continue;
    const y = yOf(nt.t);
    if (y > H.y + H.h + ns) continue;
    if (!nt.miss) {                                     // светящийся след
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(0, y, 0, y - ns * 1.5);
      gr.addColorStop(0, rgba(col, .3)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(x - ns * .22, y - ns * 1.5, ns * .44, ns * 1.5);
      g.restore();
    }
    drawArrow(nt.lane, x, y, 1, 'note', nt.miss ? .22 : 1);
  }
  g.restore();
}

/** вспышки попаданий и искры длинных нот */
function fxDraw() {
  if (!P) return;
  const burst = image(R.burst);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  P.fx = P.fx.filter(f => {
    const dur = f.big ? .8 : .5, u = (clock - f.t0) / dur;
    if (u >= 1) return false;
    const e = 1 - (1 - u) ** 3, r0 = (R.ringSize || 124) / 2 * (f.big ? 1.8 : 1);
    g.globalAlpha = 1 - u;
    g.strokeStyle = f.col; g.lineWidth = (f.big ? 14 : 9) * (1 - u) + 1;
    g.beginPath(); g.arc(f.x, f.y, r0 * (.8 + e * (f.perfect ? 1 : .6)), 0, TAU); g.stroke();
    if (burst) {
      const s = r0 * 2.6 * (.45 + e * .8), h = s * burst.naturalHeight / burst.naturalWidth;
      g.globalAlpha = (1 - u) ** 1.4 * (f.perfect ? 1 : .55);
      g.save(); g.translate(f.x, f.y); g.rotate(f.rot + u * .7);
      g.drawImage(burst, -s / 2, -h / 2, s, h);
      g.restore();
    }
    g.strokeStyle = '#e6ffd8';
    for (const p of f.parts) {
      const d0 = r0 * (.5 + e * p.v), d1 = d0 + p.len * (1 - u), cx = Math.cos(p.a), cy = Math.sin(p.a);
      g.globalAlpha = 1 - u; g.lineWidth = 3.5 * (1 - u) + .5;
      g.beginPath(); g.moveTo(f.x + cx * d0, f.y + cy * d0); g.lineTo(f.x + cx * d1, f.y + cy * d1); g.stroke();
    }
    if (f.perfect && u < .3) {
      const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, r0 * 1.1);
      gr.addColorStop(0, `rgba(255,255,255,${.75 * (1 - u / .3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(f.x, f.y, r0 * 1.1, 0, TAU); g.fill();
    }
    return true;
  });
  P.sparks = P.sparks.filter(s => clock - s.t0 < s.life);
  g.strokeStyle = '#dcffc8';
  for (const s of P.sparks) {
    const a = clock - s.t0, b = Math.max(0, a - .03), gy = 1300;
    g.globalAlpha = 1 - a / s.life; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(s.x + s.vx * b, s.y + s.vy * b + gy * b * b / 2);
    g.lineTo(s.x + s.vx * a, s.y + s.vy * a + gy * a * a / 2);
    g.stroke();
  }
  g.restore();
}

/** заливка прогресс-бара песни (как на макете) с бегущим бликом */
function progressDraw(u) {
  const B = R.progress;
  if (!B || u <= 0) return;
  const w = B.w * G.clamp(u, 0, 1), r = B.h / 2;
  g.save();
  g.beginPath(); g.moveTo(B.x + r, B.y); g.lineTo(B.x + B.w, B.y); g.lineTo(B.x + B.w, B.y + B.h); g.lineTo(B.x + r, B.y + B.h);
  g.arc(B.x + r, B.y + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.clip();
  g.fillStyle = B.color || R.score?.color || '#5cb232'; g.fillRect(B.x, B.y, w, B.h);
  const sx = B.x + (clock * 150) % (B.w + 260) - 130;
  const gr = g.createLinearGradient(sx - 90, 0, sx + 90, 0);
  gr.addColorStop(0, 'rgba(175,240,135,0)'); gr.addColorStop(.5, 'rgba(175,240,135,.6)'); gr.addColorStop(1, 'rgba(175,240,135,0)');
  g.fillStyle = gr; g.fillRect(B.x, B.y, w, B.h);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(B.x, B.y + 2, w, B.h * .3);
  g.fillStyle = 'rgba(225,255,205,.9)'; g.fillRect(B.x + w - 2, B.y, 2, B.h);
  g.restore();
}

function phraseDraw() {
  const ph = P?.phrase, L = ph && R.phrases?.[ph.i], im = L && image(L.img);
  if (!im) return;
  const a = clock - ph.t0, show = R.phraseShow ?? 3.2;
  const out = G.clamp((a - show) / .4, 0, 1), alpha = Math.min(1, a / .12) * (1 - out);
  if (alpha <= 0) return;
  const k = backOut(Math.min(1, a / .35)) * (1 + .1 * beat.pulse) * (1 - .25 * out);
  const w = L.w, h = w * im.naturalHeight / im.naturalWidth, [ax, ay] = L.pivot || [.5, .5];
  g.save();
  g.globalAlpha = alpha;
  g.translate(L.x, L.y); g.rotate(Math.sin(clock * 2.2 + ph.i) * .05); g.scale(k, k);
  g.shadowColor = neon(); g.shadowBlur = (8 + 14 * beat.pulse) * px();
  g.drawImage(im, -ax * w, -ay * h, w, h);
  g.restore();
}

function starsDraw() {
  const n = P ? P.stars : mode === 'menu' && R.songs[sel] ? starsOf(R.songs[sel], diff()) : 0;
  (R.stars || []).forEach((S, i) => {
    const on = i < n, im = image(on ? S.on : S.off) || image(S.off);
    if (!im) return;
    const pop = on && P ? Math.max(0, 1 - (clock - P.starAt[i]) * 2.5) : 0;
    const w = S.w * (on ? .905 : 1) * (1 + .6 * pop), h = w * im.naturalHeight / im.naturalWidth;
    g.save();
    g.translate(S.x, S.y); g.rotate(pop * .7);
    if (on) { g.shadowColor = neon(); g.shadowBlur = (6 + 22 * pop) * px(); }
    g.drawImage(im, -w / 2, -h / 2, w, h);
    g.restore();
  });
}

function scoreDraw() {
  const S = R.score;
  if (!S) return;
  const v = P ? (P.record ? P.notes.length : mode === 'result' ? P.score : Math.round(P.shown)) : mode === 'menu' && R.songs[sel] ? recOf(R.songs[sel], diff()) : 0;
  g.save();
  g.font = `${S.h}px ${SQ}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillStyle = S.color || neon(); g.shadowColor = S.color || neon(); g.shadowBlur = 8 * px();
  g.fillText(String(v), S.x + S.w, S.y + S.h * .54);
  g.restore();
}

function draw(t) {
  if (!cv) return;
  const k = Math.min(R.maxRes || 2, G.k * (window.devicePixelRatio || 1));
  if (k !== cvK) { cvK = k; cv.width = Math.round(G.VW * k); cv.height = Math.round(G.VH * k); sprites.clear(); }
  const s = px();
  g.setTransform(s, 0, 0, s, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000'; g.fillRect(0, 0, AW(), AH());

  layers(R.back);
  bandDraw();
  layers(R.front);
  laneLights();
  comboDraw();
  for (let i = 0; i < R.lanes.length; i++) receptor(i);
  if ((P && mode === 'play') || mode === 'layout') notesDraw(t);
  fxDraw();
  layers(R.overlay);
  progressDraw(P ? P.prog || 0 : mode === 'layout' ? .55 : 0);
  phraseDraw();
  starsDraw();
  scoreDraw();
  if (P) {
    if (t < 0 && mode === 'play') {                    // отсчёт 3-2-1
      const num = Math.ceil(-t), u = 1 - (-t % 1), H = R.highway;
      g.save();
      g.font = `${Math.round(170 + 60 * (1 - u))}px ${SQ}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.globalAlpha = Math.min(1, u * 3);
      g.fillStyle = '#efffe6'; g.shadowColor = neon(); g.shadowBlur = 30 * s;
      g.fillText(num, H.x + H.w / 2, 330);
      g.restore();
    }
    if (P.flash > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(neon(), P.flash * .18); g.fillRect(0, 0, AW(), AH());
      g.restore();
    }
  }
}

/* ============================================================
   ЭКРАНЫ (HTML в координатах макета поверх холста)
   ============================================================ */
const btn = (text, cls, fn) => {
  const b = G.el('button', 'rhb' + (cls ? ' ' + cls : ''), `<span>${G.esc(text)}</span>`);
  b.onclick = e => { e.stopPropagation(); G.sfx.tap(); fn(); };
  return b;
};
function panel(cls) {
  const box = G.el('div', 'rhp ' + cls);
  const M = R.menu || { x: 205, y: 108, w: 640, h: 660 };
  box.style.left = M.x + 'px'; box.style.top = M.y + 'px'; box.style.width = M.w + 'px'; box.style.minHeight = M.h + 'px';
  art.appendChild(box);
  return box;
}
const starImgs = n => (R.stars || []).map((S, i) => `<img class="${i < n ? 'on' : 'off'}" src="${G.esc(G.asset(i < n ? S.on : S.off))}" alt="">`).join('');

function renderMenu() {
  const T = R.texts, d = diff();
  sel = G.clamp(sel, 0, R.songs.length - 1);
  const box = panel('rhm');
  box.innerHTML = `<h2 class="rhp__h">${G.esc(T.title)}</h2>`;
  const list = G.el('div', 'rhm__songs');
  R.songs.forEach((s, i) => {
    const ok = !!s.src;
    const b = G.el('button', 'rhs' + (i === sel ? ' is-on' : '') + (ok ? '' : ' is-soon'),
      `<i>${String(i + 1).padStart(2, '0')}</i>` +
      `<span><b>${G.esc(s.title)}</b><small>${G.esc(ok ? s.artist : T.soon)}</small></span>` +
      (ok ? `<em><u>${starImgs(starsOf(s, d))}</u><b>${recOf(s, d)}</b></em>` : ''));
    b.onclick = () => { if (i === sel && ok) start(s); else { sel = i; G.sfx.tap(); render(); } };
    list.appendChild(b);
  });
  box.appendChild(list);
  const ds = G.el('div', 'rhm__diffs');
  R.difficulties.forEach((dd, i) => {
    const b = G.el('button', 'rhd' + (i === diffI ? ' is-on' : ''), `<span>${G.esc(dd.name)}</span>`);
    b.onclick = () => { diffI = i; G.writeLS('cherry.rhythm.diff', i); G.sfx.tap(); render(); };
    ds.appendChild(b);
  });
  box.appendChild(ds);
  const act = G.el('div', 'rhp__actions');
  const go = btn(T.play, 'rhb--big', () => start(R.songs[sel]));
  go.disabled = !R.songs[sel]?.src;
  act.append(btn(T.exit, 'rhb--ghost', exit), go);
  box.appendChild(act);
  box.appendChild(G.el('div', 'rhm__keys', R.keys.map(k => `<kbd>${G.esc(k)}</kbd>`).join('') + `<span>${G.esc(T.keysHint || '')}</span>`));
}

function renderLoading() {
  const box = panel('rhp--load');
  box.innerHTML = `<h2 class="rhp__h">${G.esc(R.texts.loading)}</h2>` +
    `<img class="rhl__spin" src="${G.esc(G.asset(R.burst))}" alt="">` +
    `<div class="rhl__bar"><u><i></i></u></div>`;
  ui.loadBar = box.querySelector('.rhl__bar i');
}

function renderPlay() {
  const H = R.highway;
  ui.judge = G.el('div', 'rh-judge');
  ui.judge.style.left = (H.x + H.w / 2) + 'px';
  ui.judge.style.top = (R.hitLine - 215) + 'px';
  art.appendChild(ui.judge);
  if (P?.record) {
    ui.rec = G.el('div', 'rh-rec');
    ui.rec.style.left = (H.x + H.w / 2) + 'px'; ui.rec.style.top = '120px';
    art.appendChild(ui.rec);
  }
  ui.pause = G.el('div', 'rh-over');
  ui.pause.hidden = !P?.paused;
  const box = G.el('div', 'rhp rhp--pause',
    `<img class="rhp__icon" src="${G.esc(G.asset('assets/rhythm/pause_icon.webp'))}" alt=""><h2 class="rhp__h">${G.esc(R.texts.paused)}</h2>`);
  const act = G.el('div', 'rhp__actions');
  act.append(btn(R.texts.quit, 'rhb--ghost', quitToMenu), btn(R.texts.again, 'rhb--ghost', () => P && start(P.song, { record: P.record })),
    btn(R.texts.resume, 'rhb--big', () => setPause(false)));
  box.appendChild(act);
  ui.pause.appendChild(box);
  art.appendChild(ui.pause);
  if (P) paintHud();
}

function renderResult() {
  const T = R.texts, plain = s => { s = String(s || '').replace(/[!.…]+$/, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const allSongs = playable().every(s => G.progress.songs[s.id]);
  const goNext = allSongs && !G.isDone('rhythm');
  const box = panel('rhr');
  box.innerHTML =
    `<div class="rhp__sub">${G.esc(P.song.title)} · ${G.esc(P.d.name)}</div>` +
    `<div class="rhr__stars">${starImgs(P.stars)}</div>` +
    `<small class="rhp__lbl">${G.esc(T.score)}</small><div class="rhr__big">${P.score}</div>` +
    (P.isRecord ? `<div class="rhr__new">${G.esc(T.newRecord)}</div>`
                : `<div class="rhr__rec">${G.esc(T.record)}: <b>${P.oldRecord}</b></div>`) +
    `<div class="rhr__stats"><span>${G.esc(plain(T.perfect))}<b>${P.perfect}</b></span><span>${G.esc(plain(T.good))}<b>${P.good}</b></span>` +
    `<span>${G.esc(plain(T.miss))}<b>${P.miss}</b></span><span>${G.esc(plain(T.combo))}<b>${P.maxCombo}</b></span></div>`;
  box.querySelectorAll('.rhr__stars img').forEach((im, i) => { im.style.animationDelay = (.25 + i * .22) + 's'; });
  const act = G.el('div', 'rhp__actions');
  act.append(btn(T.again, 'rhb--ghost', () => start(P.song)), btn(T.toSongs, goNext ? 'rhb--ghost' : 'rhb--big', quitToMenu));
  if (goNext) act.appendChild(btn(T.next, 'rhb--big', () => G.completeRoom('rhythm')));
  box.appendChild(act);
}

/** рамки для редактора: картинки сцены и зоны интерфейса можно таскать мышкой */
function proxies() {
  const pic = (o, path, anchor) => {
    const src = o.img || o.frames?.[0] || o.off;
    if (!src || !(o.w > 0)) return;
    const el = G.el('div', 'ent rh-pick');
    el.dataset.edit = path;
    el._ar = 1;
    const [ax, ay] = o.pivot || anchor;
    el.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)`;
    G.place(el, o);
    const im = new Image();
    im.onload = () => { el._ar = im.naturalHeight / im.naturalWidth; G.place(el, o); };
    im.src = G.asset(src);
    art.appendChild(el);
  };
  const zone = (key, label) => { if (R[key]) art.appendChild(G.zone(R[key], 'rhythm.' + key, label, 'zone--edit')); };
  (R.back || []).forEach((L, i) => { if (L.w < AW()) pic(L, `rhythm.back.${i}`, [.5, 1]); });
  (R.band || []).forEach((L, i) => pic(L, `rhythm.band.${i}`, [.5, 1]));
  (R.front || []).forEach((L, i) => pic(L, `rhythm.front.${i}`, [.5, 1]));
  zone('highway', 'дорожки');
  if (mode === 'menu') zone('menu', 'меню');
  (R.overlay || []).forEach((L, i) => pic(L, `rhythm.overlay.${i}`, [.5, 1]));
  (R.phrases || []).forEach((L, i) => pic(L, `rhythm.phrases.${i}`, [.5, .5]));
  (R.stars || []).forEach((L, i) => pic(L, `rhythm.stars.${i}`, [.5, .5]));
  zone('progress', 'прогресс'); zone('score', 'счёт'); zone('pause', 'пауза');
}

/** все картинки сцены грузим сразу, чтобы кадры персонажей не мигали */
function preload() {
  const all = [R.ring, R.ringFill, R.burst];
  for (const k of ['back', 'front', 'overlay', 'phrases']) (R[k] || []).forEach(L => all.push(L.img));
  (R.band || []).forEach(B => all.push(...(B.frames || [])));
  (R.stars || []).forEach(S => all.push(S.on, S.off));
  R.lanes.forEach(L => all.push(L.img));
  all.forEach(image);
}

function render() {
  R = G.cfg.rhythm;
  root.innerHTML = '';
  ui = {};
  sprites.clear();
  cv = G.el('canvas', 'rh-cv');
  g = cv.getContext('2d');
  cvK = 0;
  root.appendChild(cv);
  art = G.el('div', 'rh-art');
  art.style.width = AW() + 'px'; art.style.height = AH() + 'px';
  art.style.transform = `scale(${AK()})`;
  art.dataset.unit = AK();
  root.appendChild(art);
  root.dataset.mode = mode;
  preload();

  if (mode === 'menu') renderMenu();
  else if (mode === 'loading') renderLoading();
  else if (mode === 'result') renderResult();
  else renderPlay();
  proxies();

  cv.onpointerdown = e => {
    if (G.editing || !P || mode !== 'play') return;
    const p = G.toView(e), x = p.x / AK(), y = p.y / AK(), Z = R.pause;
    if (Z && x >= Z.x && x <= Z.x + Z.w && y >= Z.y && y <= Z.y + Z.h) { setPause(true); return; }
    const H = R.highway;
    if (P.paused || x < H.x - 40 || x > H.x + H.w + 40 || y < H.y + 100) return;
    let lane = -1, bd = 1e9;
    R.lanes.forEach((_, i) => { const d = Math.abs(laneX(i) - x); if (d < bd) { bd = d; lane = i; } });
    if (lane < 0) return;
    judgeDown(lane);
    const id = e.pointerId;
    const up = ev => {
      if (ev.pointerId !== id) return;
      judgeUp(lane);
      removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  draw(P ? now() : 0);
}

function exit() {
  stopAudio();
  G.go('world', { room: 'rhythm' });
}

// ушли с вкладки посреди песни — ставим на паузу
const autoPause = () => { if (G.sceneId === 'rhythm' && mode === 'play' && P && !P.paused && !P.ended && !P.record) setPause(true); };
addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

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
    document.fonts?.load(`40px ${SQ}`).catch(() => {});
    document.fonts?.load(`40px ${GL}`).catch(() => {});
    render();
  },
  leave() { stopAudio(); ctx?.suspend(); P = null; mode = 'menu'; },
  refresh() { if (mode !== 'loading') render(); },
  onEdit(on) { if (on && mode === 'play') setPause(true); },

  update(dt) {
    clock += dt;
    if (!(mode === 'play' && P) && clock >= beat.next) { onBeat(); beat.next = clock + IDLE_BEAT; }
    beat.pulse = Math.max(0, beat.pulse - dt * 4);
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
    if (mode === 'result' && G.isAction(e)) art?.querySelector('.rhp__actions .rhb:last-child')?.click();
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
       <p class="ed__note">Картинки сцены — «Ритм-игра» → back (фон), band (персонажи), front, overlay.
         Тащи их мышкой прямо на экране, колесо — размер.</p>
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
