/* ============================================================
   rhythm.js — ритм-игра (4 дорожки, клавиши S D K L)
   ------------------------------------------------------------
   • Ноты для песни делаются автоматически: игра «слушает» mp3,
     находит удары (бас → левые дорожки, остальное → правые) и
     оставляет столько нот, сколько положено по сложности.
   • Ноты можно записать вручную в редакторе (F10 → «Записать ноты»),
     тогда они сохранятся в songs[].charts.
   • Промахи песню не прерывают. В конце — счёт и рекорд.
   Всё настраивается в data/game.json → rhythm.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-rhythm');
const LEAD = 2.2;                       // секунд тишины перед началом песни

let R = null;
let mode = 'menu';                      // menu | loading | play | result | layout
let sel = 0, diffI = G.readLS('cherry.rhythm.diff', 0);
let P = null;                           // состояние текущего прохождения
let ctx = null;                         // отдельный AudioContext для песни (его можно ставить на паузу)
let cv = null, g = null, dancerEl = null, laneImgs = [];
let ui = {};
const cache = new Map();                // src → { buffer, an }
const down = [false, false, false, false];

const diff = () => R.difficulties[G.clamp(diffI, 0, R.difficulties.length - 1)];
const playable = () => R.songs.filter(s => s.src);
const recOf = (song, d) => G.progress.records[`${song.id}/${d.id}`] || 0;
const laneOfCode = code => ['KeyS', 'KeyD', 'KeyK', 'KeyL'].indexOf(code);

/* ============================================================
   АНАЛИЗ ПЕСНИ → удары
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
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
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

function pickPeaks(env, fps, band) {
  const n = env.length, W = Math.round(fps * .7), out = [];
  const s1 = new Float64Array(n + 1), s2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { s1[i + 1] = s1[i] + env[i]; s2[i + 1] = s2[i] + env[i] * env[i]; }
  const gmean = s1[n] / n;
  for (let i = 2; i < n - 2; i++) {
    const v = env[i];
    if (v <= env[i - 1] || v < env[i + 1] || v <= env[i - 2] || v < env[i + 2]) continue;
    const a = Math.max(0, i - W), b = Math.min(n, i + W), m = b - a;
    const mean = (s1[b] - s1[a]) / m, sd = Math.sqrt(Math.max(1e-9, (s2[b] - s2[a]) / m - mean * mean));
    if (v > mean + .5 * sd && v > gmean * .35) out.push({ f: i, s: (v - mean) / sd, band });
  }
  return out;
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
  for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1));
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
    if (f % 500 === 0) { onProgress?.(f / frames); await G.sleep(0); }
  }
  const fps = sr / HOP, time = f => (f * HOP + N / 2 - HOP) / sr;
  const lows = pickPeaks(low, fps, 0), highs = pickPeaks(high, fps, 1);
  // сливаем близкие удары из двух полос
  const all = [...lows, ...highs].sort((a, b) => a.f - b.f), cands = [];
  for (const p of all) {
    let q = cands[cands.length - 1];
    if (!q || p.f - q.f > 3) { q = { t: time(p.f), f: p.f, ls: 0, hs: 0 }; cands.push(q); }
    if (p.band === 0) q.ls = Math.max(q.ls, p.s); else q.hs = Math.max(q.hs, p.s);
  }
  // чей удар сильнее — бас или «верх» — в ту сторону дорожек и пойдёт нота
  for (const q of cands) { q.band = q.ls > q.hs ? 0 : 1; q.s = Math.max(q.ls, q.hs) + (q.ls && q.hs ? .3 : 0); }
  return { duration: buffer.duration, cands, lows: lows.map(p => ({ t: time(p.f), s: p.s })) };
}

/** самые сильные удары, не ближе gap друг к другу */
function thin(list, gap, max = 1e9) {
  const byStrength = [...list].sort((a, b) => b.s - a.s), used = new Map(), out = [];
  for (const c of byStrength) {
    if (out.length >= max) break;
    const b = Math.floor(c.t / gap);
    let ok = true;
    for (let k = b - 1; k <= b + 1 && ok; k++) for (const t of used.get(k) || []) if (Math.abs(t - c.t) < gap) { ok = false; break; }
    if (!ok) continue;
    (used.get(b) || used.set(b, []).get(b)).push(c.t);
    out.push(c);
  }
  return out.sort((a, b) => a.t - b.t);
}

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

function makeChart(song, d, an) {
  const manual = song.charts?.[d.id];
  if (Array.isArray(manual) && manual.length)
    return manual.map(([t, lane]) => ({ t, lane })).sort((a, b) => a.t - b.t);
  const usable = an.cands.filter(c => c.t > 1.2 && c.t < an.duration - 1);
  const picked = thin(usable, d.gap, Math.round(an.duration * d.perSec));
  const rand = mulberry(hash(song.id + '/' + d.id));
  let last = -1, prevT = -9;
  return picked.map(c => {
    let pool = c.band === 0 ? [0, 1] : [2, 3];
    if (rand() < .3) pool = [0, 1, 2, 3];
    let lane = pool[(rand() * pool.length) | 0];
    if (lane === last && (c.t - prevT < .45 || rand() < .6)) {
      const others = [0, 1, 2, 3].filter(l => l !== last);
      lane = others[(rand() * others.length) | 0];
    }
    last = lane; prevT = c.t;
    return { t: c.t, lane };
  });
}

function makeBeats(song, an) {
  if (song.bpm > 0) {
    const step = 60 / song.bpm, out = [];
    for (let t = song.offset || 0; t < an.duration; t += step) out.push(t);
    return out;
  }
  let b = thin(an.lows, .34);
  if (b.length < an.duration * .7) b = thin(an.cands, .4);
  return b.map(x => x.t);
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
  P = {
    song, d, record, data,
    notes: record ? [] : makeChart(song, d, data.an),
    beats: makeBeats(song, data.an), beatI: 0, frame: 0,
    head: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0,
    fx: [], paused: false, ended: false,
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

function judge(lane) {
  if (!P || P.paused || P.ended) return;
  const t = now();
  down[lane] = true;
  if (P.record) {
    if (t > 0) { P.notes.push({ t: G.round(t, 3), lane, done: true }); P.fx.push({ lane, t0: t, kind: 'good' }); paintHud(); }
    return;
  }
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
  P.combo++; P.maxCombo = Math.max(P.maxCombo, P.combo);
  P[perfect ? 'perfect' : 'good']++;
  P.score += Math.round((perfect ? 100 : 50) * Math.min(2, 1 + Math.floor(P.combo / 10) * .1));
  P.fx.push({ lane, t0: t, kind: perfect ? 'perfect' : 'good' });
  showJudge(perfect ? R.texts.perfect : R.texts.good, perfect ? 'p' : 'g');
  paintHud();
}

function showJudge(text, kind) {
  if (!ui.judge) return;
  ui.judge.textContent = text;
  ui.judge.className = 'rh__judge rh__judge--' + kind;
  void ui.judge.offsetWidth;
  ui.judge.classList.add('is-on');
}

function paintHud() {
  if (!ui.score) return;
  if (P.record) { ui.score.textContent = P.notes.length; ui.combo.textContent = '● REC · Esc — стоп'; return; }
  ui.score.textContent = P.score;
  ui.combo.textContent = P.combo > 1 ? `${R.texts.combo} ×${P.combo}` : '';
}

function tick() {
  const t = now(), an = P.data.an;
  if (!P.paused) {
    // пропущенные ноты
    for (let i = P.head; i < P.notes.length; i++) {
      const n = P.notes[i];
      if (n.t > t - P.d.good) break;
      if (!n.done) { n.done = true; n.miss = true; P.miss++; P.combo = 0; showJudge(R.texts.miss, 'm'); paintHud(); }
    }
    while (P.head < P.notes.length && P.notes[P.head].t < t - 1) P.head++;
    // танец под удары
    let beat = false;
    while (P.beatI < P.beats.length && P.beats[P.beatI] <= t) { P.beatI++; beat = true; }
    if (beat && dancerEl) {
      P.frame = (P.frame + 1) % Math.max(1, R.dancer.cols || 1);
      dancerEl.setFrame(P.frame);
      dancerEl.classList.remove('is-beat'); void dancerEl.offsetWidth; dancerEl.classList.add('is-beat');
    }
    if (ui.prog) ui.prog.style.width = G.clamp(t / an.duration * 100, 0, 100) + '%';
    if (t > an.duration + .6 && !P.ended) finish();
  }
  draw(t);
}

function finish() {
  P.ended = true;
  stopAudio();
  if (P.record) {
    const song = P.song;
    (song.charts ||= {})[P.d.id] = P.notes.sort((a, b) => a.t - b.t).map(n => [n.t, n.lane]);
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

/* ---------------- рисование дорожек ---------------- */
const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(255,143,163,${a})`;
};

function draw(t) {
  if (!g) return;
  const H = R.highway, n = R.lanes.length, lw = H.w / n, hitY = R.hitLine, ns = R.noteSize;
  const approach = P?.d.approach || diff().approach;
  g.clearRect(0, 0, G.VW, G.VH);
  g.fillStyle = 'rgba(26,5,14,.78)';
  g.fillRect(H.x, H.y, H.w, H.h);
  for (let i = 0; i < n; i++) {
    const x = H.x + i * lw, col = R.lanes[i].color;
    const gr = g.createLinearGradient(0, H.y, 0, H.y + H.h);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, down[i] ? .42 : .16));
    g.fillStyle = gr; g.fillRect(x, H.y, lw, H.h);
    if (i) { g.fillStyle = 'rgba(255,240,243,.14)'; g.fillRect(x - 1, H.y, 2, H.h); }
  }
  g.fillStyle = '#ffccd5';
  g.fillRect(H.x - 6, H.y, 6, H.h); g.fillRect(H.x + H.w, H.y, 6, H.h);
  g.fillStyle = '#a4133c';
  g.fillRect(H.x - 2, H.y, 2, H.h); g.fillRect(H.x + H.w, H.y, 2, H.h);

  // линия попадания и «кнопки»
  g.fillStyle = 'rgba(255,240,243,.85)';
  g.fillRect(H.x, hitY - 2, H.w, 4);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const cx = H.x + (i + .5) * lw, col = R.lanes[i].color, s = ns + 10;
    g.fillStyle = down[i] ? rgba(col, .75) : 'rgba(26,5,14,.85)';
    g.fillRect(cx - s / 2, hitY - s / 2, s, s);
    g.lineWidth = 4; g.strokeStyle = col;
    g.strokeRect(cx - s / 2 + 2, hitY - s / 2 + 2, s - 4, s - 4);
    g.font = '26px Tiny5, monospace';
    g.fillStyle = down[i] ? '#fff' : rgba(col, .95);
    g.fillText(R.keys[i] || '', cx, hitY + 2);
  }

  // ноты
  const travel = hitY - H.y + ns;
  const list = P ? P.notes : [{ t: .3, lane: 0 }, { t: .7, lane: 1 }, { t: 1.0, lane: 2 }, { t: 1.4, lane: 3 }, { t: 1.6, lane: 1 }];
  for (let i = P ? P.head : 0; i < list.length; i++) {
    const nt = list[i], d = nt.t - t;
    if (d > approach) break;
    if (nt.done && !nt.miss) continue;
    const y = hitY - d / approach * travel;
    if (y > H.y + H.h + ns) continue;
    const cx = H.x + (nt.lane + .5) * lw, im = laneImgs[nt.lane];
    g.globalAlpha = nt.miss ? .3 : 1;
    if (im && im.complete && im.naturalWidth) {
      const hh = ns * im.naturalHeight / im.naturalWidth;
      g.drawImage(im, Math.round(cx - ns / 2), Math.round(y - hh / 2), ns, hh);
    } else {
      g.fillStyle = R.lanes[nt.lane].color;
      g.fillRect(cx - ns / 2 + 6, y - ns / 2 + 6, ns - 12, ns - 12);
    }
    g.globalAlpha = 1;
  }

  // вспышки попаданий
  if (P) {
    P.fx = P.fx.filter(f => t - f.t0 < .3);
    for (const f of P.fx) {
      const k = (t - f.t0) / .3, cx = H.x + (f.lane + .5) * lw, s = ns + 10 + k * 46;
      g.lineWidth = 6 * (1 - k);
      g.strokeStyle = f.kind === 'perfect' ? `rgba(255,255,255,${1 - k})` : rgba(R.lanes[f.lane].color, 1 - k);
      g.strokeRect(cx - s / 2, hitY - s / 2, s, s);
    }
    if (t < 0) {
      g.font = '64px Tiny5, monospace';
      g.fillStyle = '#fff0f3';
      g.fillText(String(Math.ceil(-t)), H.x + H.w / 2, hitY - 200);
    }
  }
}

/* ============================================================
   ЭКРАНЫ
   ============================================================ */
function renderMenu() {
  const T = R.texts;
  sel = G.clamp(sel, 0, R.songs.length - 1);
  const box = G.el('div', 'rh__menu');
  box.innerHTML = `<h2 class="rh__h">${G.esc(T.title)}</h2>`;
  const list = G.el('div', 'rh__songs');
  R.songs.forEach((s, i) => {
    const ok = !!s.src, rec = recOf(s, diff());
    const b = G.el('button', 'rh__song' + (i === sel ? ' is-on' : '') + (ok ? '' : ' is-soon'),
      `<i>${ok ? (G.progress.songs[s.id] ? '🍒' : '♪') : '🔒'}</i>` +
      `<span><b>${G.esc(s.title)}</b><small>${G.esc(ok ? s.artist : T.soon)}</small></span>` +
      (ok ? `<em>${G.esc(T.record)}<br><b>${rec}</b></em>` : ''));
    b.onclick = () => { if (i === sel && ok) start(s); else { sel = i; G.sfx.tap(); render(); } };
    list.appendChild(b);
  });
  box.appendChild(list);
  const ds = G.el('div', 'rh__diffs');
  R.difficulties.forEach((d, i) => {
    const b = G.el('button', 'rh__diff' + (i === diffI ? ' is-on' : ''), G.esc(d.name));
    b.onclick = () => { diffI = i; G.writeLS('cherry.rhythm.diff', i); G.sfx.tap(); render(); };
    ds.appendChild(b);
  });
  box.appendChild(ds);
  const act = G.el('div', 'rh__actions');
  const ex = G.el('button', 'pbtn pbtn--ghost', G.esc(T.exit));
  ex.onclick = exit;
  const go = G.el('button', 'pbtn', '▶ ' + G.esc(T.play));
  go.disabled = !R.songs[sel]?.src;
  go.onclick = () => start(R.songs[sel]);
  act.append(ex, go);
  box.appendChild(act);
  box.appendChild(G.el('div', 'rh__keys', R.keys.map(k => `<kbd>${G.esc(k)}</kbd>`).join(' ')));
  root.appendChild(box);
}

function renderPlay() {
  cv = G.el('canvas', 'rh__cv px');
  cv.width = G.VW; cv.height = G.VH;
  g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  root.appendChild(cv);
  root.appendChild(G.zone(R.highway, 'rhythm.highway', 'дорожки', 'zone--edit'));

  dancerEl = G.sheet(R.dancer, 'rh__dancer');
  G.place(dancerEl, R.dancer);
  dancerEl.dataset.edit = 'rhythm.dancer';
  root.appendChild(dancerEl);

  const hud = G.el('div', 'ent rh__hud',
    `<small>${G.esc(P?.record ? 'Нот записано' : R.texts.score)}</small><b class="rh__score">0</b><i class="rh__combo"></i>`);
  G.place(hud, R.hud);
  hud.dataset.edit = 'rhythm.hud';
  root.appendChild(hud);
  ui.score = hud.querySelector('.rh__score'); ui.combo = hud.querySelector('.rh__combo');

  ui.judge = G.el('div', 'rh__judge');
  ui.judge.style.left = (R.highway.x + R.highway.w / 2) + 'px';
  ui.judge.style.top = (R.hitLine - 130) + 'px';
  root.appendChild(ui.judge);

  const song = P?.song || R.songs[sel];
  root.appendChild(G.el('div', 'rh__now', `♪ ${G.esc(song?.title || '')}${song?.artist ? ' — ' + G.esc(song.artist) : ''} · ${G.esc((P?.d || diff()).name)}`));
  const bar = G.el('div', 'rh__progress', '<i></i>');
  root.appendChild(bar);
  ui.prog = bar.firstChild;

  ui.pause = G.el('div', 'rh__overlay', `<div class="rh__panel"><h2 class="rh__h">${G.esc(R.texts.paused)}</h2></div>`);
  ui.pause.hidden = true;
  const b1 = G.el('button', 'pbtn', G.esc(R.texts.resume)), b2 = G.el('button', 'pbtn pbtn--ghost', G.esc(R.texts.quit));
  b1.onclick = () => setPause(false);
  b2.onclick = quitToMenu;
  ui.pause.firstChild.append(b1, b2);
  root.appendChild(ui.pause);

  cv.addEventListener('pointerdown', e => {
    if (G.editing || !P) return;
    const p = G.toView(e), H = R.highway;
    const lane = Math.floor((p.x - H.x) / (H.w / R.lanes.length));
    if (lane >= 0 && lane < R.lanes.length) { judge(lane); setTimeout(() => { down[lane] = false; }, 120); }
  });
  if (P) paintHud();
  draw(P ? now() : 0);
}

function renderResult() {
  const T = R.texts;
  const allSongs = playable().every(s => G.progress.songs[s.id]);
  const goNext = allSongs && !G.isDone('rhythm');
  const box = G.el('div', 'rh__menu rh__result');
  box.innerHTML =
    `<div class="rh__now2">♪ ${G.esc(P.song.title)} · ${G.esc(P.d.name)}</div>` +
    `<small class="rh__lbl">${G.esc(T.score)}</small><div class="rh__big">${P.score}</div>` +
    (P.isRecord ? `<div class="rh__newrec">${G.esc(T.newRecord)}</div>`
                : `<div class="rh__rec">${G.esc(T.record)}: ${P.oldRecord}</div>`);
  const act = G.el('div', 'rh__actions');
  const again = G.el('button', 'pbtn pbtn--ghost', '↻ ' + G.esc(T.again));
  again.onclick = () => start(P.song);
  const songs = G.el('button', 'pbtn' + (goNext ? ' pbtn--ghost' : ''), G.esc(T.toSongs));
  songs.onclick = quitToMenu;
  act.append(again, songs);
  if (goNext) {
    const nx = G.el('button', 'pbtn', G.esc(T.next) + ' ▸');
    nx.onclick = () => G.completeRoom('rhythm');
    act.appendChild(nx);
  }
  box.appendChild(act);
  root.appendChild(box);
}

function render() {
  R = G.cfg.rhythm;
  root.innerHTML = '';
  ui = {}; cv = null; g = null; dancerEl = null;
  laneImgs = R.lanes.map(l => { if (!l.img) return null; const im = new Image(); im.src = G.asset(l.img); return im; });

  const bg = new Image();
  bg.className = 'room__bg px'; bg.draggable = false; bg.alt = '';
  bg.src = G.asset(R.bg);
  root.appendChild(bg);

  if (mode === 'menu') renderMenu();
  else if (mode === 'loading') {
    const box = G.el('div', 'rh__menu rh__loading',
      `<h2 class="rh__h">${G.esc(R.texts.loading)}</h2><div class="rh__loadbar"><i></i></div><div class="rh__spin">🍒</div>`);
    root.appendChild(box);
    ui.loadBar = box.querySelector('.rh__loadbar i');
  }
  else if (mode === 'result') renderResult();
  else renderPlay();
}

function exit() {
  stopAudio();
  G.go('room', { id: 'rhythm', at: 'npc' });
}

G.scenes.rhythm = {
  root,
  /** для отладки из консоли: G.scenes.rhythm.state */
  get state() { return { mode, play: P, time: P && ctx ? now() : 0 }; },
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

  update() {
    if (mode === 'play' && P) tick();
    else if (mode === 'layout') draw((performance.now() / 1000) % 1.2 - .2);
  },

  key(e) {
    if (mode === 'play') {
      const lane = laneOfCode(e.code);
      if (lane >= 0 && !e.repeat) judge(lane);
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
    if (mode === 'result' && G.isAction(e)) {
      root.querySelector('.rh__actions .pbtn:last-child')?.click();
    }
  },
  keyup(e) { const lane = laneOfCode(e.code); if (lane >= 0) down[lane] = false; },

  editRoots: () => [{ path: 'rhythm', label: 'Ритм-игра' }, { path: 'rooms.rhythm.cutscene', label: 'Катсцена после игры' }],

  editorTools(box) {
    const song = R.songs[sel], d = diff();
    const has = song?.charts?.[d.id]?.length;
    box.innerHTML =
      `<div class="ed__label">Экран</div><div class="ed__row">
         <button class="ed__btn${mode === 'menu' ? ' is-on' : ''}" id="rhM">Меню песен</button>
         <button class="ed__btn${mode === 'layout' ? ' is-on' : ''}" id="rhL">Игра (расстановка)</button></div>
       <div class="ed__label">Ноты: «${G.esc(song?.title || '—')}» · ${G.esc(d.name)}</div>
       <p class="ed__note">${has ? `Записано вручную: ${has} нот.` : 'Сейчас ноты подбираются автоматически по музыке.'}
         Чтобы записать свои: нажми кнопку, редактор закроется, песня заиграет — стучи по ${R.keys.join(' ')} в ритм. Esc — закончить.</p>
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
