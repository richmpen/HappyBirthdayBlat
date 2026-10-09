/* ============================================================
   finale.js — концовка (макет «общий визуал/концовка/»)
   ------------------------------------------------------------
   1. Комната и Лена; Лиза, Аня и Андрей появляются по очереди.
   2. Каждый говорит свою реплику.
   3. Зажигается свечка: «загадывай желание» — нажми на свечку.
   4. Свечка гаснет, экран плавно темнеет, появляется поздравление,
      сердечко и салют.
   Всё внутри .art — в пикселях макета (3492×1640). Настройки —
   data/game.json → finale.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$, esc = G.esc;
const root = $('#sc-finale');

let F = null, run = 0, stage = 'intro', fwOn = false, fwWait = 0, lit = new Set(), shadeDone = false;
let art = null, sky = null, shade = null, flameEl = null, candleHit = null, endEl = null, dimEl = null, tipEl = null;
const WORKS = ['fireworkRed', 'fireworkGold', 'fireworkPink'];

/* ---------------- звуки ---------------- */
function noiseWhoosh(dur = .7, gain = .18) {         // дуновение: шум, который стихает
  if (!G.soundOn) return;
  try {
    const a = G.audioCtx(), n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = .7;
    f.frequency.setValueAtTime(1600, a.currentTime); f.frequency.exponentialRampToValueAtTime(380, a.currentTime + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0, a.currentTime); g.gain.linearRampToValueAtTime(gain, a.currentTime + .06);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
    src.connect(f).connect(g).connect(a.destination); src.start();
  } catch {}
}
const sndAppear = () => G.blip(660 + Math.random() * 300, .2, 'sine', .04);      // как раньше у девочек
const sndLight = () => { G.blip(520, .12, 'triangle', .03); setTimeout(() => G.blip(780, .18, 'sine', .035), 90); noiseWhoosh(.35, .05); };

function launch() {
  const name = WORKS[(Math.random() * WORKS.length) | 0];
  G.fx.at(name, sky, G.rnd(90, G.VW - 90), G.rnd(50, 230), { scale: G.rnd(1.6, 2.8) });
  if (G.soundOn) {
    G.blip(G.rnd(110, 190), .28, 'triangle', .04);
    setTimeout(() => G.blip(G.rnd(900, 1500), .05, 'square', .012), 240);
  }
}

/* ---------------- прожекторы: кто уже «пришёл» ---------------- */
/** пока гость не появился, его место в полумраке; свет раскрывается мягким кругом */
const spots = new Map();          // key → { x, y, r, cur }
function spotList() {
  const L = [{ key: 'lena', ...F.lena }].concat(F.girls.map((g, i) => ({ key: 'g' + i, ...g })));
  return L.map(o => ({ key: o.key, x: o.x, y: o.y - (o.light?.dy ?? 430), r: o.light?.r ?? 560 }));
}
function drawShade(dt) {
  if (!shade) return;
  const c = shade, g = c.getContext('2d'), A = F.art, k = c.width / A.w;
  let alive = false;
  for (const s of spotList()) {
    const st = spots.get(s.key) || { cur: 0 };
    const want = lit.has(s.key) ? 1 : 0;
    st.cur += (want - st.cur) * Math.min(1, dt * 2.2);
    if (Math.abs(want - st.cur) < .002) st.cur = want; else alive = true;
    Object.assign(st, s);
    spots.set(s.key, st);
  }
  const allLit = [...spots.values()].every(s => s.cur >= 1);
  const fade = shade._fade ?? 0;
  shade._fade = Math.min(1, fade + (allLit ? dt * .8 : 0));
  g.clearRect(0, 0, c.width, c.height);
  if (shade._fade >= 1) { c.style.opacity = 0; shadeDone = true; return; }
  c.style.opacity = 1 - shade._fade;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = F.shadeColor || 'rgba(29,10,6,.84)';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  for (const s of spots.values()) {
    if (s.cur <= 0) continue;
    const e = 1 - Math.pow(1 - s.cur, 3);
    const r = s.r * k * (.25 + .75 * e);
    const grd = g.createRadialGradient(s.x * k, s.y * k, r * .35, s.x * k, s.y * k, r);
    grd.addColorStop(0, `rgba(0,0,0,${e})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(s.x * k, s.y * k, r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return alive;
}

/* ---------------- сцена ---------------- */
function render() {
  F = G.cfg.finale;
  const A = F.art;
  root.innerHTML = '';
  root.style.background = A.color || '';
  art = G.artStage(root, A, 'fin');

  const bg = new Image();
  bg.className = 'fin-bg'; bg.alt = ''; bg.draggable = false; bg.src = G.asset(F.bg);
  art.appendChild(bg);

  // шарики покачиваются вверх-вниз
  F.balloons.forEach((b, i) => {
    const p = G.artPiece({ anim: 'balloon', phase: i * 1.37, ...b }, `finale.balloons.${i}`, 'fin-balloon');
    p.querySelector('img').style.setProperty('--dur', (b.dur || 4.2 + (i * .61) % 1.6) + 's');
    art.appendChild(p);
  });

  const lena = G.artPiece(F.lena, 'finale.lena', 'fin-guest is-in');
  art.appendChild(lena);
  F.girls.forEach((g, i) => {
    const p = G.artPiece(g, `finale.girls.${i}`, 'fin-guest fin-guest--' + i + (lit.has('g' + i) ? ' is-in' : ''));
    art.appendChild(p);
  });

  // полумрак с «прожекторами»
  shade = document.createElement('canvas');
  shade.className = 'fin-shade';
  shade.width = Math.round(A.w / 4); shade.height = Math.round(A.h / 4);
  if (!F.spotlight) shade.hidden = true;
  shade._fade = shadeDone ? 1 : 0;
  if (shadeDone) shade.style.opacity = 0;
  art.appendChild(shade);

  // свечка
  const C = F.candle;
  flameEl = G.flame({ ...C, w: C.w || 46 }, 'finale.candle', 'fin-flame' + (stage === 'wish' || stage === 'lit' ? ' is-lit' : ''));
  art.appendChild(flameEl);
  candleHit = G.artDot({ x: C.x, y: C.y + 40, w: 260 }, null, 'fin-candle-hit');
  candleHit.onclick = e => { e.stopPropagation(); blow(); };
  art.appendChild(candleHit);
  tipEl = G.artDot({ x: C.x + 200, y: C.y + 250 }, null, 'fin-tip');
  tipEl.innerHTML = `<span><i>↖</i> ${esc(F.wishHint)}</span>`;
  art.appendChild(tipEl);

  // затемнение и финальный экран (поверх всей сцены, вместе с полосами рамки)
  dimEl = G.el('div', 'fin-dim');
  dimEl.style.background = F.dark || 'rgba(29,10,6,.9)';
  root.appendChild(dimEl);
  sky = G.el('div', 'fin-sky');
  root.appendChild(sky);

  const E = F.end;
  endEl = G.artStage(root, { ...A, edgeTop: '' }, 'fin-end');
  [['title', 'end.title'], ['love', 'end.love']].forEach(([k, p], i) => {
    const el = G.artPiece(E[k], 'finale.' + p, 'fin-end__' + k);
    el.style.setProperty('--in', (i * 1.1) + 's');
    endEl.appendChild(el);
  });
  const heart = G.artPiece(E.heart, 'finale.end.heart', 'fin-end__heart');
  endEl.appendChild(heart);
  const btn = G.artPiece(E.button, 'finale.end.button', 'fin-end__btn');
  const label = new Image(); label.className = 'fin-end__btxt'; label.alt = esc(F.backButton); label.src = G.asset(E.button.textImg);
  btn.querySelector('img').after(label);
  btn.title = F.backButton;
  btn.onclick = () => { if (!G.editing) { G.sfx.tap(); G.go('title'); } };
  endEl.appendChild(btn);

  applyStage();
}

/** показать то, что уже должно быть видно на текущем шаге (после перерисовки в редакторе) */
function applyStage() {
  root.dataset.stage = stage;
  art.querySelectorAll('.fin-guest').forEach((e, i) => { if (i === 0 || lit.has('g' + (i - 1))) e.classList.add('is-in'); });
  flameEl.classList.toggle('is-lit', stage === 'lit' || stage === 'wish');
  candleHit.classList.toggle('is-on', stage === 'wish');
  tipEl.classList.toggle('is-on', stage === 'wish');
  root.classList.toggle('is-dark', stage === 'end');
  fwOn = stage === 'end' && !!F.fireworks;
}

function showAll() {
  lit = new Set(['lena', ...F.girls.map((g, i) => 'g' + i)]);
  shadeDone = true;
  if (shade) { shade._fade = 1; shade.style.opacity = 0; }
}

async function sequence() {
  const my = ++run;
  const alive = () => my === run && G.sceneId === 'finale';
  const wait = async ms => { await G.sleep(ms); return alive(); };
  stage = 'intro'; lit = new Set(['lena']); applyStage();
  if (!await wait(1100)) return;
  // Лиза, Аня, Андрей — по очереди
  for (let i = 0; i < F.girls.length; i++) {
    lit.add('g' + i);
    const el = art.querySelector('.fin-guest--' + i);
    el?.classList.add('is-in', 'is-pop');
    sndAppear();
    if (!await wait(900)) return;
  }
  if (!await wait(1300)) return;
  // реплики
  stage = 'talk'; applyStage();
  for (let i = 0; i < F.dialog.length; i++) {
    const line = F.dialog[i];
    const who = F.girls.findIndex(g => g.name === line.name);
    art.querySelectorAll('.fin-guest').forEach(e => e.classList.remove('is-talk'));
    if (who >= 0) art.querySelector('.fin-guest--' + who)?.classList.add('is-talk');
    if (await G.say([line]) < 0 || !alive()) return;
  }
  art.querySelectorAll('.fin-guest').forEach(e => e.classList.remove('is-talk'));
  // свечка загорается
  stage = 'lit'; applyStage();
  sndLight();
  if (!await wait(1100)) return;
  stage = 'wish'; applyStage();
  const r = await G.say([{ name: F.wishName, text: F.wish }]);
  if (!alive()) return;
  if (r < 0 && stage !== 'wish') return;
}

async function blow() {
  if (stage !== 'wish' || G.editing) return;
  stage = 'blown';
  const my = run;
  const alive = () => my === run && G.sceneId === 'finale';
  G.closeDialog();
  applyStage();
  candleHit.classList.remove('is-on');
  flameEl.classList.add('is-out');
  noiseWhoosh(.8, .2);
  // дымок
  const smoke = G.artDot({ x: F.candle.x, y: F.candle.y - 10 }, null, 'fin-smoke');
  smoke.innerHTML = '<i></i><i></i><i></i>';
  art.appendChild(smoke);
  G.progress.wish = true; G.saveProgress();
  await G.sleep(700);
  if (!alive()) return;
  G.sfx.win();
  G.fx.screen('confetti', innerWidth / 2, innerHeight / 2, { scale: Math.max(1.8, G.k * 2.4) });
  await G.sleep(900);
  if (!alive()) return;
  stage = 'end'; fwWait = 2.2;
  applyStage();
}

G.scenes.finale = {
  root,
  enter() {
    G.progress.finale = true; G.saveProgress();
    F = G.cfg.finale;
    G.music(F.music, F.musicVolume ?? .7);
    stage = 'intro'; lit = new Set(['lena']); spots.clear(); fwOn = false; fwWait = 0; shadeDone = false;
    render();
    if (!G.editing) sequence(); else { showAll(); stage = 'lit'; render(); }
  },
  leave() { run++; fwOn = false; G.closeDialog(); },
  refresh() { render(); },
  onEdit(on) {
    if (!on) return;
    run++; G.closeDialog();
    showAll();
    if (stage !== 'end') stage = 'lit';
    render();
  },
  update(dt) {
    drawShade(dt);
    if (!fwOn || G.editing) return;
    fwWait -= dt;
    if (fwWait <= 0) { fwWait = (F.fireworkEvery || .9) * G.rnd(.5, 1.6); launch(); }
  },
  key(e) { if (stage === 'wish' && G.isAction(e)) blow(); },
  editorTools(box) {
    box.innerHTML = '';
    const row = G.el('div', 'ed__row ed__row--wrap');
    [['Комната', 'lit'], ['Загадай желание', 'wish'], ['Финальный экран', 'end']].forEach(([t, s]) => {
      const b = G.el('button', 'ed__btn' + (stage === s ? ' is-on' : ''), t);
      b.onclick = () => { stage = s; showAll(); render(); G.editor.toolsChanged(); };
      row.appendChild(b);
    });
    const re = G.el('button', 'ed__btn', '▶ Проиграть сначала');
    re.onclick = () => { G.editor.toggle(false); G.go('finale'); };
    row.appendChild(re);
    box.appendChild(row);
  },
  editRoots: () => [{ path: 'finale', label: 'Концовка' }, { path: 'fx', label: 'Эффекты (атласы Arcadia)' }]
};

})();
