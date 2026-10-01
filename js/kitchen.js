/* ============================================================
   kitchen.js — мини-игра «Готовим торт» (в духе «Кухни Сары»)
   4 шага: ингредиенты → замешать → выпечь → украсить.
   Всё настраивается в data/game.json → kitchen.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-kitchen');
const STEPS = ['add', 'mix', 'bake', 'decor'];

let K = null, step = 0, st = {}, layer = null, hintEl = null, timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const active = () => !G.editing && !G.busy && !st.locked;

/* центр и размер элемента в координатах экрана */
function box(el) {
  const r = el.getBoundingClientRect(), v = G.$('#view').getBoundingClientRect();
  const x = (r.left - v.left) / G.k, y = (r.top - v.top) / G.k, w = r.width / G.k, h = r.height / G.k;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function puff(x, y, glyphs = ['✦', '✧', '♥']) {
  for (let i = 0; i < 7; i++) {
    const s = G.el('span', 'kit__puff', glyphs[i % glyphs.length]);
    const a = Math.PI * 2 * i / 7 + G.rnd(-.3, .3), d = G.rnd(30, 70);
    s.style.left = x + 'px'; s.style.top = y + 'px';
    s.style.setProperty('--tx', Math.cos(a) * d + 'px');
    s.style.setProperty('--ty', Math.sin(a) * d - 20 + 'px');
    layer.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

function setHint(text) { hintEl.textContent = text; }

function nextStep() {
  if (step >= STEPS.length - 1) return;
  step++;
  G.sfx.ok();
  render();
  G.editor?.sceneChanged();
}

/* ============================================================
   ШАГ 1 — ингредиенты в миску по очереди
   ============================================================ */
function buildAdd() {
  const A = K.add;
  st = { i: 0, drag: null, bowl: null, els: [] };
  st.bowl = G.img(A.bowl, 'kitchen.add.bowl', 'kit__bowl');
  layer.appendChild(st.bowl);
  A.ingredients.forEach((ing, i) => {
    const e = G.img(ing, `kitchen.add.ingredients.${i}`, 'kit__ing');
    e.dataset.i = i;
    layer.appendChild(e);
    const tag = G.el('span', 'kit__tag', G.esc(ing.name));
    tag.style.left = ing.x + 'px'; tag.style.top = (ing.y + 6) + 'px';
    layer.appendChild(tag);
    st.els.push({ e, tag });
  });
  markTarget();
}
function markTarget() {
  const A = K.add, ing = A.ingredients[st.i];
  st.els.forEach((v, i) => v.e.classList.toggle('is-target', i === st.i));
  setHint(ing ? G.fmt(A.hint, { name: ing.name }) : '');
}
function addDown(e) {
  const el = e.target.closest('.kit__ing');
  if (!el || el.classList.contains('is-used')) return;
  const i = +el.dataset.i, p = G.toView(e), ing = K.add.ingredients[i];
  st.drag = { i, el, ing, sx: p.x, sy: p.y, moved: false };
  el.classList.add('is-drag');
  root.setPointerCapture(e.pointerId);
}
function addMove(e) {
  const d = st.drag; if (!d) return;
  const p = G.toView(e);
  if (Math.hypot(p.x - d.sx, p.y - d.sy) > 6) d.moved = true;
  d.el.style.left = (d.ing.x + p.x - d.sx) + 'px';
  d.el.style.top  = (d.ing.y + p.y - d.sy) + 'px';
}
function addUp() {
  const d = st.drag; if (!d) return;
  st.drag = null;
  d.el.classList.remove('is-drag');
  const b = box(st.bowl), c = box(d.el);
  const inBowl = !d.moved || (Math.abs(c.cx - b.cx) < b.w * .55 && Math.abs(c.cy - b.cy) < b.h * .9);
  const back = () => { d.el.style.left = d.ing.x + 'px'; d.el.style.top = d.ing.y + 'px'; };
  if (!inBowl) { back(); return; }
  if (d.i !== st.i) {
    back();
    G.sfx.bad();
    d.el.classList.remove('is-shake'); void d.el.offsetWidth; d.el.classList.add('is-shake');
    G.popup(K.texts.wrong, 1300);
    return;
  }
  // правильный ингредиент — летит в миску
  d.el.classList.add('is-used');
  d.el.style.left = b.cx + 'px';
  d.el.style.top = (b.cy + 10) + 'px';
  st.els[d.i].tag.remove();
  G.sfx.plop();
  puff(b.cx, b.y + 20);
  st.i++;
  if (st.i >= K.add.ingredients.length) {
    st.locked = true;
    setHint('');
    later(() => { if (K.add.bowl.imgFull) st.bowl.src = G.asset(K.add.bowl.imgFull); }, 250);
    later(nextStep, 1100);
  } else markTarget();
}

/* ============================================================
   ШАГ 2 — замешиваем тесто кругами
   ============================================================ */
function buildMix() {
  const M = K.mix;
  st = { down: false, ang: null, total: 0, need: Math.PI * 2 * Math.max(1, M.turns), bowl: null, whisk: null, fill: null, tick: 0 };
  st.bowl = G.img(M.bowl, 'kitchen.mix.bowl', 'kit__bowl');
  layer.appendChild(st.bowl);
  st.whisk = G.img({ img: M.whisk.img, w: M.whisk.w, x: M.bowl.x + M.bowl.w * .2, y: M.bowl.y - 90 }, 'kitchen.mix.whisk', 'kit__whisk');
  layer.appendChild(st.whisk);
  const bar = G.el('div', 'kit__bar', '<i></i>');
  layer.appendChild(bar);
  st.fill = bar.firstChild;
  setHint(M.hint);
}
function mixMove(e) {
  if (!st.whisk) return;
  const p = G.toView(e), b = box(st.bowl);
  st.whisk.style.left = p.x + 'px';
  st.whisk.style.top = (p.y + 24) + 'px';
  if (!st.down) { st.ang = null; return; }
  const cx = b.cx, cy = b.y + b.h * .3;
  if (Math.hypot(p.x - cx, p.y - cy) > b.w * .65) { st.ang = null; return; }
  const a = Math.atan2(p.y - cy, p.x - cx);
  if (st.ang != null) {
    let da = a - st.ang;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    st.total += Math.abs(da);
    st.tick += Math.abs(da);
    if (st.tick > Math.PI / 2) { st.tick = 0; G.blip(420 + 300 * (st.total / st.need), .04, 'triangle', .03); }
    st.bowl.style.rotate = (Math.sin(st.total * 2) * 2.5) + 'deg';
  }
  st.ang = a;
  st.fill.style.width = Math.min(100, st.total / st.need * 100) + '%';
  if (st.total >= st.need && !st.locked) {
    st.locked = true;
    st.bowl.style.rotate = '';
    if (K.mix.bowl.imgDone) st.bowl.src = G.asset(K.mix.bowl.imgDone);
    puff(cx, b.y + 10);
    G.sfx.ok();
    later(nextStep, 1100);
  }
}

/* ============================================================
   ШАГ 3 — выпечка: попади в зелёную зону
   ============================================================ */
function buildBake() {
  const B = K.bake;
  st = { pos: 0, dir: 1, hits: 0, zone: G.clamp(B.zone, .06, .9), z0: 0, bar: null, marker: null, zoneEl: null, dots: null };
  layer.appendChild(G.img(B.oven, 'kitchen.bake.oven', 'kit__oven'));
  st.bar = G.zone(B.bar, 'kitchen.bake.bar', '', 'kit__timing');
  st.bar.innerHTML = '<i class="kit__zone"></i><i class="kit__marker"></i>';
  layer.appendChild(st.bar);
  st.zoneEl = st.bar.children[0]; st.marker = st.bar.children[1];
  st.dots = G.el('div', 'kit__dots');
  st.dots.style.left = (B.bar.x + B.bar.w / 2) + 'px';
  st.dots.style.top = (B.bar.y + B.bar.h + 12) + 'px';
  layer.appendChild(st.dots);
  newZone(); paintDots();
  setHint(B.hint);
}
function newZone() {
  st.z0 = G.rnd(.05, .95 - st.zone);
  st.zoneEl.style.left = st.z0 * 100 + '%';
  st.zoneEl.style.width = st.zone * 100 + '%';
}
function paintDots() {
  st.dots.innerHTML = Array.from({ length: K.bake.hits }, (_, i) => `<i class="${i < st.hits ? 'is-on' : ''}"></i>`).join('');
}
function bakeHit() {
  if (!active() || step !== 2) return;
  const ok = st.pos >= st.z0 && st.pos <= st.z0 + st.zone;
  if (!ok) {
    G.sfx.bad();
    st.bar.classList.remove('is-shake'); void st.bar.offsetWidth; st.bar.classList.add('is-shake');
    G.popup(K.texts.miss, 900);
    return;
  }
  st.hits++;
  paintDots();
  G.sfx.ok();
  const b = box(st.marker);
  puff(b.cx, b.cy, ['✦', '🔥', '✧']);
  if (st.hits >= K.bake.hits) {
    st.locked = true;
    G.popup(K.texts.hit, 900);
    later(() => G.blip(1568, .5, 'sine', .08), 300);
    later(nextStep, 1200);
  } else {
    st.zone = Math.max(.08, st.zone * .82);
    newZone();
  }
}
function bakeUpdate(dt) {
  if (st.locked || G.editing || !st.marker) return;
  st.pos += st.dir * K.bake.speed * dt;
  if (st.pos > 1) { st.pos = 1; st.dir = -1; }
  if (st.pos < 0) { st.pos = 0; st.dir = 1; }
  st.marker.style.left = st.pos * 100 + '%';
}

/* ============================================================
   ШАГ 4 — украшаем торт
   ============================================================ */
function buildDecor() {
  const D = K.decor;
  st = { drag: null, cake: null, count: 0, btn: null };
  st.cake = G.img(D.cake, 'kitchen.decor.cake', 'kit__cake');
  layer.appendChild(st.cake);
  D.items.forEach((it, i) => {
    const e = G.img(it, `kitchen.decor.items.${i}`, 'kit__src');
    e.dataset.i = i; e.title = it.name;
    layer.appendChild(e);
  });
  st.btn = G.el('button', 'pbtn kit__done', G.esc(K.texts.finish));
  st.btn.disabled = true;
  st.btn.onclick = () => {
    if (!active() || st.count < D.min) return;
    st.locked = true;
    const b = box(st.cake);
    puff(b.cx, b.cy, ['🍒', '✦', '♥']);
    later(() => G.completeRoom('kitchen'), 500);
  };
  root.appendChild(st.btn);
  paintDecor();
}
function paintDecor() {
  const D = K.decor;
  setHint(G.fmt(D.hint, { min: D.min }) + `  (${st.count}/${D.min})`);
  st.btn.disabled = st.count < D.min;
  st.btn.classList.toggle('is-ready', st.count >= D.min);
}
function decorDown(e) {
  const src = e.target.closest('.kit__src'), old = e.target.closest('.kit__deco');
  if (!src && !old) return;
  const p = G.toView(e);
  let el = old;
  if (src) {
    const it = K.decor.items[+src.dataset.i];
    el = new Image();
    el.className = 'ent px kit__deco';
    el.draggable = false;
    el.src = G.asset(it.img);
    el.style.width = it.w + 'px';
    layer.appendChild(el);
    const b = box(src);
    st.drag = { el, fresh: true, dx: b.cx - p.x, dy: b.y + b.h - p.y };
  } else {
    const b = box(el);
    st.drag = { el, fresh: false, dx: b.cx - p.x, dy: b.y + b.h - p.y };
  }
  el.classList.add('is-drag');
  decorMove(e);
  root.setPointerCapture(e.pointerId);
  G.sfx.tap();
}
function decorMove(e) {
  const d = st.drag; if (!d) return;
  const p = G.toView(e);
  d.el.style.left = (p.x + d.dx) + 'px';
  d.el.style.top = (p.y + d.dy) + 'px';
  d.el.style.zIndex = 100 + Math.round(p.y + d.dy);
}
function decorUp() {
  const d = st.drag; if (!d) return;
  st.drag = null;
  d.el.classList.remove('is-drag');
  const c = box(d.el), b = box(st.cake);
  const on = c.cx > b.x - 10 && c.cx < b.x + b.w + 10 && c.cy > b.y - 30 && c.cy < b.y + b.h + 10;
  if (on) {
    if (d.fresh) st.count++;
    G.sfx.plop();
  } else {
    if (!d.fresh) st.count--;
    d.el.remove();
  }
  paintDecor();
}

/* ============================================================
   общий каркас
   ============================================================ */
function render() {
  timers.forEach(clearTimeout); timers = [];
  K = G.cfg.kitchen;
  root.innerHTML = '';

  const bg = new Image();
  bg.className = 'room__bg px'; bg.draggable = false; bg.alt = '';
  bg.src = G.asset(K.bg);
  root.appendChild(bg);

  layer = G.el('div', 'kit__layer');
  root.appendChild(layer);

  const S = K[STEPS[step]];
  const head = G.el('div', 'kit__head',
    `<div class="kit__steps">${STEPS.map((_, i) => `<i class="${i === step ? 'is-on' : i < step ? 'is-done' : ''}">${i + 1}</i>`).join('')}</div>` +
    `<div class="kit__title">${G.esc(S.title)}</div><div class="kit__hint"></div>`);
  root.appendChild(head);
  hintEl = head.querySelector('.kit__hint');

  const exit = G.el('button', 'pbtn pbtn--ghost kit__exit', G.esc(K.texts.exit));
  exit.onclick = () => G.go('room', { id: 'kitchen', at: 'npc' });
  root.appendChild(exit);

  [buildAdd, buildMix, buildBake, buildDecor][step]();
}

root.addEventListener('pointerdown', e => {
  if (!active() || e.target.closest('button')) return;
  if (step === 0) addDown(e);
  else if (step === 1) { st.down = true; mixMove(e); root.setPointerCapture(e.pointerId); }
  else if (step === 2) bakeHit();
  else decorDown(e);
});
root.addEventListener('pointermove', e => {
  if (!active()) return;
  if (step === 0) addMove(e);
  else if (step === 1) mixMove(e);
  else if (step === 3) decorMove(e);
});
['pointerup', 'pointercancel'].forEach(ev => root.addEventListener(ev, () => {
  if (step === 0) addUp();
  else if (step === 1) { st.down = false; st.ang = null; }
  else if (step === 3) decorUp();
}));

G.scenes.kitchen = {
  root,
  enter(p) {
    step = G.clamp(p.step ?? 0, 0, STEPS.length - 1);
    render();
    G.music(G.cfg.kitchen.music);
  },
  refresh: render,
  leave() { timers.forEach(clearTimeout); timers = []; },
  update(dt) { if (step === 2) bakeUpdate(dt); },
  key(e) { if (step === 2 && G.isAction(e)) bakeHit(); },

  editRoots: () => [
    { path: `kitchen.${STEPS[step]}`, label: 'Этот шаг: ' + K[STEPS[step]].title },
    { path: 'kitchen', label: 'Вся мини-игра «Торт»' },
    { path: 'rooms.kitchen.cutscene', label: 'Катсцена после игры' }
  ],
  editorTools(boxEl) {
    boxEl.innerHTML = '<div class="ed__label">Перейти к шагу</div>';
    const row = G.el('div', 'ed__row');
    STEPS.forEach((s, i) => {
      const b = G.el('button', 'ed__btn' + (i === step ? ' is-on' : ''), String(i + 1));
      b.title = K[s].title;
      b.onclick = () => { step = i; render(); G.editor.sceneChanged(); };
      row.appendChild(b);
    });
    boxEl.appendChild(row);
  }
};

})();
