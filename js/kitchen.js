/* ============================================================
   kitchen.js — мини-игра «Готовим торт» (по умолчанию — «Красный бархат»)
   ------------------------------------------------------------
   Восемь коротких игр подряд, на всё даётся время (kitchen.timeLimit):
     gather  — найти продукты из рецепта среди обманок
     measure — отмерить: держи, чтобы сыпать, отпусти в зелёной зоне
     eggs    — разбить яйца: нажми, когда кольцо совпадёт; вылови скорлупу
     whisk   — взбить тесто: води по кругу в нужном темпе, добавь краситель
     bake    — выпечь: держи жар в зелёной зоне
     stack   — собрать коржи: отпусти корж ровно над тортом
     frost   — покрыть кремом: «закрась» торт лопаткой
     decor   — украсить
   Рецепт, продукты, картинки, тексты и все числа — data/game.json → kitchen.
   Арт сцены — пиксельный, 640×360, показывается с увеличением kitchen.scale.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-kitchen');

let K = null, SC = 1.5, stage = null, layer = null, ui = {}, st = {};
let order = [], idx = 0, timeLeft = 0, running = false, locked = true, ended = false, timers = [], loadId = 0;
const IM = new Map();                 // путь → загруженная картинка
const got = new Set();                // собранные продукты (для галочек в рецепте)

const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
const active = () => running && !locked && !ended && !G.editing && !G.busy;
const art = e => { const p = G.toView(e); return { x: p.x / SC, y: p.y / SC }; };
const im = p => IM.get(p);
const size = (p, fw = 32, fh = 32) => { const i = IM.get(p); return i && i.naturalWidth ? { w: i.naturalWidth, h: i.naturalHeight } : { w: fw, h: fh }; };
const ing = id => K.ingredients.find(i => i.id === id);
const mix = (a, b, t) => {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function preload(obj, done) {
  const paths = new Set();
  (function walk(o) {
    if (typeof o === 'string') { if (/\.(png|webp|jpe?g|gif|svg)$/i.test(o) || G.pending.has(o)) paths.add(o); }
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  })(obj);
  let left = paths.size;
  if (!left) return done();
  paths.forEach(p => {
    const i = new Image();
    i.onload = i.onerror = () => { IM.set(p, i); if (--left === 0) done(); };
    i.src = G.asset(p);
  });
}

/** спрайт на сцену: o = { img, x, y } — точка «низ-центр» в пикселях арта */
function put(o, path, cls = '', key = 'img') {
  const e = G.img(o, path, cls, key);
  layer.appendChild(e);
  return e;
}
function canvas(z) {
  const c = G.el('canvas', 'kcv px');
  c.width = 640; c.height = 360;
  c.style.zIndex = z;
  layer.appendChild(c);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return g;
}
const fx = (name, x, y, o = {}) => G.fx.at(name, layer, x, y, Object.assign({ z: 500 }, o));
function shake(el) { el.classList.remove('is-shake'); void el.offsetWidth; el.classList.add('is-shake'); }
function chip(text, x, y, cls = '') {
  const e = G.el('div', 'k-chip ' + cls, G.esc(text));
  e.style.left = x + 'px'; e.style.top = y + 'px';
  layer.appendChild(e);
  return e;
}
function gauge(x, y, h, label) {
  const e = G.el('div', 'k-gauge', `<i class="k-gauge__zone"></i><i class="k-gauge__needle"></i><span>${G.esc(label)}</span>`);
  Object.assign(e.style, { left: x + 'px', top: y + 'px', height: h + 'px' });
  layer.appendChild(e);
  return { el: e, zone: e.children[0], needle: e.children[1],
    set(v, z0, z1) {
      this.needle.style.bottom = G.clamp(v, 0, 1) * 100 + '%';
      this.zone.style.bottom = z0 * 100 + '%'; this.zone.style.height = (z1 - z0) * 100 + '%';
      this.el.classList.toggle('is-in', v >= z0 && v <= z1);
    } };
}
function bar(x, y, w) {
  const e = G.el('div', 'k-bar', '<i></i>');
  Object.assign(e.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
  layer.appendChild(e);
  return v => { e.firstChild.style.width = G.clamp(v, 0, 1) * 100 + '%'; };
}

/* ============================================================
   1. ПРОДУКТЫ
   ============================================================ */
const STEPS = {};
STEPS.gather = {
  build() {
    const g = K.gather;
    got.clear();
    put(g.cupboard, 'kitchen.gather.cupboard', 'k-back');
    put(g.tray, 'kitchen.gather.tray', 'k-back');
    const cs = size(g.cupboard.img, 460, 232), ts = size(g.tray.img, 320, 36);
    const items = shuffle([
      ...K.ingredients.map((o, i) => ({ o, need: true, path: `kitchen.ingredients.${i}` })),
      ...K.decoys.map((o, i) => ({ o, need: false, path: `kitchen.decoys.${i}` }))]);
    const rows = Math.max(1, g.rows || 3), cols = Math.ceil(items.length / rows);
    const left = g.cupboard.x - cs.w / 2 + 12, top = g.cupboard.y - cs.h, rowH = (cs.h - (g.shelfInset ?? 16)) / rows;
    st = { items, n: 0, need: K.ingredients.length, ts };
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      it.x = left + (cs.w - 24) * (c + .5) / cols; it.y = top + rowH * (r + 1);
      it.el = put({ img: it.o.img, x: it.x, y: it.y }, it.path, 'k-item');
      it.el.dataset.i = i; it.el.title = it.o.name;
    });
  },
  down(e) {
    const el = e.target.closest('.k-item');
    if (!el || el.classList.contains('is-got')) return;
    const it = st.items[+el.dataset.i], g = K.gather;
    if (!it.need) { shake(el); G.sfx.bad(); G.popup(G.fmt(g.wrong, { name: it.o.name }), 1300); return; }
    got.add(it.o.id);
    el.classList.add('is-got');
    el.style.left = (g.tray.x - st.ts.w / 2 + 22 + (st.ts.w - 44) * (st.n + .5) / st.need) + 'px';
    el.style.top = (g.tray.y - 9) + 'px';
    fx('popStar', it.x, it.y - 20);
    G.sfx.plop();
    st.n++;
    paintCard();
    if (st.n >= st.need) complete();
  }
};

/* ============================================================
   2. ОТМЕРИТЬ
   ============================================================ */
STEPS.measure = {
  build() {
    const m = K.measure;
    st = { k: 0, level: 0, pouring: false, mode: 'pour', g: canvas(4), src: null, label: null };
    st.cup = put(m.cup, 'kitchen.measure.cup', 'k-front');
    this.next();
  },
  next() {
    const m = K.measure, it = m.items[st.k], o = ing(it.ingredient) || { name: '?', img: '' };
    const cs = size(m.cup.img, 82, 98);
    st.it = it; st.level = 0; st.mode = 'pour';
    st.src?.remove(); st.label?.remove();
    st.src = put({ img: o.img, x: m.cup.x - cs.w / 2 - 6, y: m.cup.y - cs.h - 8 }, '', 'k-pour');
    st.label = chip(`${o.name} · ${o.amount || ''}  (${st.k + 1}/${m.items.length})`, m.cup.x + cs.w / 2 + 14, m.cup.y - cs.h / 2 - 8);
    hint(m.hint);
  },
  hold(on) {
    if (st.mode !== 'pour') return;
    if (on) { st.pouring = true; st.src.classList.add('is-on'); return; }
    if (!st.pouring) return;
    st.pouring = false; st.src.classList.remove('is-on');
    const it = st.it;
    if (Math.abs(st.level - it.target) <= it.tolerance) {
      st.mode = 'ok';
      G.sfx.ok();
      fx('popStar', K.measure.cup.x, K.measure.cup.y - 60);
      G.popup(K.measure.ok, 900);
      later(() => { st.k++; if (st.k >= K.measure.items.length) complete(); else this.next(); }, 800);
    }
  },
  update(dt) {
    const m = K.measure, it = st.it, cs = size(m.cup.img, 82, 98), f = m.cup.fill;
    if (st.mode === 'pour' && st.pouring) {
      st.level += it.speed * dt;
      if ((st.tick = (st.tick || 0) + dt) > .09) { st.tick = 0; G.blip(300 + st.level * 500, .03, 'triangle', .02); }
      if (st.level > it.target + it.tolerance) {
        st.mode = 'drain'; st.pouring = false; st.src.classList.remove('is-on');
        G.sfx.bad(); G.popup(m.over, 1200); shake(st.cup);
      }
    } else if (st.mode === 'drain') {
      st.level -= 1.8 * dt;
      if (st.level <= 0) { st.level = 0; st.mode = 'pour'; }
    }
    // рисуем содержимое стакана под его стеклом
    const g = st.g, ox = m.cup.x - cs.w / 2, oy = m.cup.y - cs.h;
    g.clearRect(0, 0, 640, 360);
    const yAt = L => oy + f.y + f.h * (1 - L), inset = yy => f.taper * ((yy - (oy + f.y)) / f.h);
    const band = (L0, L1, col) => {
      const y0 = Math.round(yAt(L1)), y1 = Math.round(yAt(L0));
      g.fillStyle = col;
      for (let y = y0; y < y1; y++) g.fillRect(Math.round(ox + f.x + inset(y)), y, Math.round(f.w - inset(y) * 2), 1);
    };
    if (st.level > 0) {
      band(0, Math.min(1, st.level), it.color);
      g.fillStyle = 'rgba(255,255,255,.55)';
      const ys = Math.round(yAt(Math.min(1, st.level)));
      g.fillRect(Math.round(ox + f.x + inset(ys)), ys, Math.round(f.w - inset(ys) * 2), 2);
    }
    band(it.target - it.tolerance, it.target + it.tolerance, st.mode === 'ok' ? 'rgba(106,153,78,.75)' : 'rgba(106,153,78,.4)');
    g.fillStyle = '#3f7a2a';
    for (const L of [it.target - it.tolerance, it.target + it.tolerance]) {
      const y = Math.round(yAt(L));
      for (let x = ox + f.x - 6; x < ox + f.x + f.w + 6; x += 6) g.fillRect(Math.round(x), y, 3, 1);
    }
    if (st.pouring) {
      g.fillStyle = it.color;
      const sx = Math.round(m.cup.x - 4), top = Math.round(oy - 30);
      g.fillRect(sx, top, 5, Math.round(yAt(st.level)) - top);
    }
  }
};

/* ============================================================
   3. ЯЙЦА
   ============================================================ */
STEPS.eggs = {
  build() {
    const e = K.eggs;
    st = { n: 0, mode: 'aim', t: 0, yolks: [], shells: [], g: canvas(4) };
    st.bowl = put(e.bowl, 'kitchen.eggs.bowl', 'k-front');
    st.ring = G.el('div', 'k-ring'); st.goal = G.el('div', 'k-ring k-ring--goal');
    layer.append(st.goal, st.ring);
    st.count = chip('', e.egg.x + 70, e.egg.y - 60);
    this.spawn();
    this.paint();
  },
  center() { const e = K.eggs, s = size(e.egg.img, 48, 64); return { x: e.egg.x, y: e.egg.y - s.h / 2 }; },
  bowlC() { const e = K.eggs, s = size(e.bowl.img, 208, 208); return { x: e.bowl.x, y: e.bowl.y - s.h / 2, r: s.w / 2 - 22 }; },
  spawn() {
    const e = K.eggs, c = this.center();
    st.egg?.remove();
    st.egg = put(e.egg, 'kitchen.eggs.egg', 'k-egg');
    st.mode = 'aim'; st.t = 0;
    for (const r of [st.ring, st.goal]) { r.style.left = c.x + 'px'; r.style.top = c.y + 'px'; r.hidden = false; }
    st.goal.style.width = st.goal.style.height = e.radius * 2 + 'px';
    st.count.textContent = `${st.n + 1} / ${e.count}`;
  },
  radius() { const e = K.eggs, u = (st.t % e.period) / e.period; return e.radius * 2 * (1 - u) + 6; },
  paint() {
    const g = st.g, b = this.bowlC();
    g.clearRect(0, 0, 640, 360);
    g.fillStyle = K.eggs.color || '#fbe9cf';
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath(); g.arc(b.x - 20, b.y - 24, b.r * .32, 0, 7); g.fill();
    const y = im(K.eggs.yolk);
    if (y) st.yolks.forEach(p => g.drawImage(y, Math.round(p.x - y.naturalWidth / 2), Math.round(p.y - y.naturalHeight / 2)));
  },
  down(ev) {
    const e = K.eggs, c = this.center(), b = this.bowlC();
    if (st.mode === 'shell') {
      const el = ev.target.closest('.k-shell');
      if (!el) return;
      const p = art(ev);
      fx('popStar', p.x, p.y, { scale: .7 });
      el.remove(); G.sfx.tap();
      st.shells = st.shells.filter(s => s.el !== el);
      if (!st.shells.length) later(() => this.after(), 300);
      return;
    }
    if (st.mode !== 'aim') return;
    const clean = Math.abs(this.radius() - e.radius) <= e.tolerance;
    st.mode = 'crack';
    st.ring.hidden = st.goal.hidden = true;
    st.egg.remove();
    // половинки разлетаются, желток падает в миску
    for (const [key, dir] of [['left', -1], ['right', 1]]) {
      const h = put({ img: e[key], x: c.x + dir * 8, y: e.egg.y - 6 }, '', 'k-half');
      requestAnimationFrame(() => { h.style.left = (c.x + dir * 64) + 'px'; h.style.top = (e.egg.y - 34) + 'px'; h.style.rotate = dir * 50 + 'deg'; h.style.opacity = 0; });
      later(() => h.remove(), 600);
    }
    const drop = put({ img: e.yolk, x: c.x, y: c.y + 10 }, '', 'k-yolk');
    const tx = b.x + G.rnd(-b.r * .45, b.r * .45), ty = b.y + G.rnd(-b.r * .4, b.r * .4);
    requestAnimationFrame(() => { drop.style.left = tx + 'px'; drop.style.top = (ty + 14) + 'px'; });
    G.blip(clean ? 900 : 240, .08, clean ? 'triangle' : 'sawtooth', .05);
    later(() => {
      drop.remove(); st.yolks.push({ x: tx, y: ty }); this.paint();
      fx('puff', tx, ty, { scale: .7 }); G.sfx.plop();
      if (clean) { G.popup(K.texts.perfect, 700); fx('popStar', tx, ty); later(() => this.after(), 450); }
      else {
        G.popup(e.shellText, 1300);
        st.mode = 'shell';
        for (let i = 0; i < (e.shells || 2); i++) {
          const a = Math.random() * 6.28, d = b.r * G.rnd(.2, .7);
          const el = put({ img: e.shell, x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d * .9 + 8 }, '', 'k-shell');
          el.style.animationDelay = (-i * .4) + 's';
          st.shells.push({ el });
        }
      }
    }, 430);
  },
  after() {
    st.n++;
    if (st.n >= K.eggs.count) complete(); else this.spawn();
  },
  update(dt) {
    if (st.mode !== 'aim') return;
    st.t += dt;
    const r = this.radius(), e = K.eggs;
    st.ring.style.width = st.ring.style.height = r * 2 + 'px';
    st.ring.classList.toggle('is-in', Math.abs(r - e.radius) <= e.tolerance);
  },
  key(e) { if (G.isAction(e) && st.mode === 'aim') this.down({ target: root }); }
};

/* ============================================================
   4. ВЗБИТЬ
   ============================================================ */
STEPS.whisk = {
  build() {
    const w = K.whisk;
    st = { g: canvas(4), ang: -1.2, rot: 0, acc: 0, rps: 0, progress: 0, dyes: 0, color: 0, down: false, last: null, cool: 0, ask: false, hum: 0 };
    st.bowl = put(w.bowl, 'kitchen.whisk.bowl', 'k-front');
    st.whisk = put({ img: w.whisk.img, x: 0, y: 0 }, 'kitchen.whisk.whisk', 'k-whisk');
    st.dye = put(w.dye, 'kitchen.whisk.dye', 'k-dye');
    st.dyeTip = chip(w.dyeText, w.dye.x, w.dye.y + 6, 'k-chip--center k-chip--warn');
    st.dyeTip.hidden = true;
    const b = this.c();
    st.gauge = gauge(b.x + b.r + 62, b.y - 86, 172, w.gaugeLabel);
    st.bar = bar(b.x - 110, b.y - b.r - 46, 220);
    this.place(); this.paint();
  },
  c() { const w = K.whisk, s = size(w.bowl.img, 208, 208); return { x: w.bowl.x, y: w.bowl.y - s.h / 2, r: s.w / 2 - 22 }; },
  place() {
    const b = this.c(), R = b.r * .58;
    st.whisk.style.left = (b.x + Math.cos(st.ang) * R) + 'px';
    st.whisk.style.top = (b.y + Math.sin(st.ang) * R) + 'px';
    st.whisk.style.rotate = (st.ang * 180 / Math.PI + 90) + 'deg';
  },
  paint() {
    const w = K.whisk, g = st.g, b = this.c(), p = st.progress;
    const col = mix(w.colorFrom, w.colorTo, st.color);
    g.clearRect(0, 0, 640, 360);
    g.save();
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.clip();
    g.fillStyle = col; g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    // завитки теста крутятся вместе с венчиком; чем лучше замешано, тем они бледнее
    const arm = (off, width, style, alpha) => {
      g.strokeStyle = style; g.globalAlpha = alpha; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let i = 0; i <= 26; i++) {
          const t = i / 26, a = st.rot + off + k * 2.094 + t * 3.6, r = 6 + t * (b.r - 8);
          g.lineWidth = width * (1 - t * .55);
          const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    };
    arm(0, 13, '#ffffff', .2 + .45 * (1 - p));
    arm(1.05, 9, 'rgba(60,10,20,1)', .1 + .1 * p);
    if (p < .3) {                                       // желтки ещё видны
      g.globalAlpha = 1 - p / .3; g.fillStyle = '#ffc233';
      for (let k = 0; k < 3; k++) { const a = st.rot * .8 + k * 2.2; g.beginPath(); g.arc(b.x + Math.cos(a) * b.r * .45, b.y + Math.sin(a) * b.r * .4, 9, 0, 7); g.fill(); }
    }
    g.globalAlpha = .5; g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(b.x - b.r * .35, b.y - b.r * .4, b.r * .16, 0, 7); g.fill();
    g.restore(); g.globalAlpha = 1;
  },
  down(e) {
    if (e.target.closest('.k-dye')) { this.addDye(); return; }
    st.down = true; st.last = null; this.move(e);
  },
  up() { st.down = false; st.last = null; },
  move(e) {
    if (!st.down) return;
    const p = art(e), b = this.c(), d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < 12 || d > b.r + 60) { st.last = null; return; }
    const a = Math.atan2(p.y - b.y, p.x - b.x);
    if (st.last != null) {
      let da = a - st.last;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      st.acc += Math.abs(da);
      st.rot += da * .7;
    }
    st.last = a; st.ang = a;
    this.place();
  },
  addDye() {
    const w = K.whisk;
    if (!st.ask) return;
    st.ask = false; st.dyes++;
    st.dyeTip.hidden = true; st.dye.classList.remove('is-ask');
    const b = this.c();
    for (let i = 0; i < 3; i++) {
      const d = put({ img: w.drop, x: w.dye.x + 10, y: w.dye.y - 30 }, '', 'k-drop');
      later(() => { d.style.left = (b.x + G.rnd(-30, 30)) + 'px'; d.style.top = (b.y + G.rnd(-20, 20)) + 'px'; }, 30 + i * 90);
      later(() => { d.remove(); fx('splash', b.x, b.y, { scale: .6 }); }, 420 + i * 90);
    }
    G.sfx.ok();
  },
  key(e) { if (G.isAction(e)) this.addDye(); },
  update(dt) {
    const w = K.whisk;
    const rps = st.acc / (Math.PI * 2) / Math.max(dt, .001);
    st.acc = 0;
    st.rps += (rps - st.rps) * Math.min(1, dt * 6);
    st.cool = Math.max(0, st.cool - dt);
    const max = w.speedMax * 1.6, inZone = st.rps >= w.speedMin && st.rps <= w.speedMax;
    st.gauge.set(st.rps / max, w.speedMin / max, w.speedMax / max);
    const dyeAt = w.dyeAt || [], needDye = st.dyes < dyeAt.length && st.progress >= dyeAt[st.dyes];
    if (needDye && !st.ask) { st.ask = true; st.dyeTip.hidden = false; st.dye.classList.add('is-ask'); G.blip(1200, .1, 'sine', .05); }
    if (inZone && !needDye) {
      st.progress = Math.min(1, st.progress + dt / w.seconds);
      if ((st.hum += dt) > .16) { st.hum = 0; G.blip(380 + st.progress * 260, .04, 'triangle', .02); }
    } else if (st.rps > w.speedMax * 1.25 && st.cool <= 0) {
      st.cool = .7;
      const b = this.c();
      fx('splash', b.x + Math.cos(st.ang) * b.r * .6, b.y + Math.sin(st.ang) * b.r * .6);
      st.progress = Math.max(0, st.progress - .04);
      G.popup(w.tooFast, 800); G.sfx.bad();
    }
    const target = dyeAt.length ? st.dyes / dyeAt.length : st.progress;
    st.color += (target - st.color) * Math.min(1, dt * (inZone ? 1.6 : .25));
    st.bar(st.progress);
    this.paint();
    if (st.progress >= 1 && st.dyes >= dyeAt.length) { st.color = 1; this.paint(); complete(); }
  }
};

/* ============================================================
   5. ВЫПЕЧЬ
   ============================================================ */
STEPS.bake = {
  build() {
    const b = K.bake, os = size(b.oven.img, 250, 206);
    st = { heat: .1, t: 0, progress: 0, hold: false, cool: 0, os };
    const left = b.oven.x - os.w / 2, top = b.oven.y - os.h, win = b.window;
    st.inside = put({ img: b.inside, x: left + win.x + win.w / 2, y: top + win.y + win.h }, '', 'k-back');
    st.inside.style.width = win.w + 'px'; st.inside.style.height = win.h + 'px';
    st.cake = put({ img: b.cake.img, x: left + win.x + win.w / 2, y: top + win.y + win.h - 20 }, 'kitchen.bake.cake', 'k-rise');
    put(b.oven, 'kitchen.bake.oven', 'k-front');
    st.gauge = gauge(b.oven.x + os.w / 2 + 34, top + 8, os.h - 30, b.gaugeLabel);
    st.bar = bar(b.oven.x - 110, top - 22, 220);
    st.steam = G.fx.at('steam', layer, b.oven.x, top - 20, { z: 30, loop: true, scale: 1.4 });
    if (st.steam) st.steam.style.opacity = 0;
  },
  hold(on) { st.hold = on; },
  update(dt) {
    const b = K.bake;
    st.t += dt; st.cool = Math.max(0, st.cool - dt);
    st.heat = G.clamp(st.heat + (st.hold ? b.rise : -b.fall) * dt, 0, 1);
    const zc = .52 + .2 * Math.sin(st.t * (b.drift || .8)), z0 = zc - b.zone / 2, z1 = zc + b.zone / 2;
    st.gauge.set(st.heat, z0, z1);
    const inZone = st.heat >= z0 && st.heat <= z1;
    if (inZone) st.progress = Math.min(1, st.progress + dt / b.seconds);
    else if (st.heat > z1 + .16 && st.cool <= 0) {
      st.cool = 1.1; st.progress = Math.max(0, st.progress - .05);
      G.popup(b.tooHot, 800); G.sfx.bad(); fx('puff', b.oven.x, b.oven.y - st.os.h + 10);
    }
    st.bar(st.progress);
    st.cake.style.scale = `1 ${.45 + .55 * st.progress}`;
    st.cake.style.filter = st.heat > z1 + .16 ? 'brightness(.6)' : '';
    if (st.steam) st.steam.style.opacity = G.clamp((st.heat - .3) * 1.6, 0, 1);
    if ((st.hum = (st.hum || 0) + dt) > .25 && st.hold) { st.hum = 0; G.blip(120 + st.heat * 160, .07, 'sawtooth', .012); }
    if (st.progress >= 1) { G.blip(1568, .5, 'sine', .08); complete(); }
  }
};

/* ============================================================
   6. СОБРАТЬ КОРЖИ
   ============================================================ */
STEPS.stack = {
  build() {
    const s = K.stack;
    st = { n: 0, t: 0, mode: 'swing', topY: 0, offs: [], piece: null, ss: size(s.sponge, 124, 38), cs: size(s.cream, 124, 18), ps: size(s.plate.img, 160, 28) };
    put(s.plate, 'kitchen.stack.plate', 'k-back');
    st.topY = s.plate.y - st.ps.h + 12;
    st.count = chip('', s.plate.x + 130, 70);
    this.spawn();
  },
  spawn() {
    const s = K.stack;
    st.mode = 'swing'; st.t = Math.random() * 6;
    st.piece = put({ img: s.sponge, x: s.plate.x, y: s.top }, 'kitchen.stack.sponge', 'k-piece');
    st.piece.style.zIndex = 40 + st.n * 2;
    st.count.textContent = `${st.n + 1} / ${s.layers}`;
  },
  x() { const s = K.stack; return s.plate.x + Math.sin(st.t * (s.speed * (1 + st.n * .22))) * s.swing; },
  drop() {
    if (st.mode !== 'swing') return;
    const s = K.stack, x = this.x(), dx = x - s.plate.x, p = st.piece;
    st.mode = 'fall';
    p.classList.add('is-fall');
    const landY = st.topY;
    if (Math.abs(dx) <= s.okDist) {
      const shown = s.plate.x + dx * .6;
      p.style.left = shown + 'px'; p.style.top = landY + 'px';
      later(() => {
        G.sfx.plop();
        const perfect = Math.abs(dx) <= s.perfectDist;
        fx(perfect ? 'popStar' : 'puff', shown, landY - 10, { scale: perfect ? 1 : .7 });
        if (perfect) G.popup(K.texts.perfect, 700);
        st.topY -= st.ss.h - 8; st.n++;
        if (st.n >= s.layers) { complete(); return; }
        // прослойка крема ложится сама
        const c = put({ img: s.cream, x: shown, y: st.topY + 6 }, 'kitchen.stack.cream', 'k-piece is-fall');
        c.style.zIndex = 41 + st.n * 2;
        st.topY -= st.cs.h - 8;
        later(() => this.spawn(), 350);
      }, 330);
    } else {
      p.style.left = (x + Math.sign(dx) * 90) + 'px'; p.style.top = (s.plate.y + 10) + 'px'; p.style.rotate = Math.sign(dx) * 70 + 'deg'; p.style.opacity = 0;
      later(() => { G.sfx.bad(); fx('puff', x + Math.sign(dx) * 60, s.plate.y - 10); G.popup(s.missText, 900); p.remove(); this.spawn(); }, 420);
    }
  },
  down() { this.drop(); },
  key(e) { if (G.isAction(e)) this.drop(); },
  update(dt) {
    if (st.mode !== 'swing') return;
    st.t += dt;
    st.piece.style.left = this.x() + 'px';
  }
};

/* ============================================================
   7. КРЕМ
   ============================================================ */
STEPS.frost = {
  build() {
    const f = K.frost, cs = size(f.cake.img, 176, 150);
    st = { cs, down: false, last: null, cover: 0, total: 0, check: 0, ox: Math.round(f.cake.x - cs.w / 2), oy: Math.round(f.cake.y - cs.h) };
    put(f.cake, 'kitchen.frost.cake', 'k-back');
    // маска: где уже намазано; цель — пиксели, которые отличаются у «голого» и «покрытого» торта
    st.mask = document.createElement('canvas'); st.mask.width = cs.w; st.mask.height = cs.h;
    st.mg = st.mask.getContext('2d', { willReadFrequently: true });
    st.g = canvas(20);
    st.spatula = put({ img: f.spatula, x: f.cake.x + 110, y: f.cake.y - 40 }, 'kitchen.frost.spatula', 'k-tool');
    st.bar = bar(f.cake.x - 110, st.oy - 26, 220);
    const a = im(f.cake.img), b = im(f.cake.imgDone);
    if (a && b) {
      const t = document.createElement('canvas'); t.width = cs.w; t.height = cs.h;
      const tg = t.getContext('2d', { willReadFrequently: true });
      try {
        tg.drawImage(a, 0, 0); const A = tg.getImageData(0, 0, cs.w, cs.h).data;
        tg.clearRect(0, 0, cs.w, cs.h); tg.drawImage(b, 0, 0); const B = tg.getImageData(0, 0, cs.w, cs.h).data;
        st.target = new Uint8Array(cs.w * cs.h);
        for (let i = 0; i < st.target.length; i++) {
          const k = i * 4;
          if (B[k + 3] > 0 && (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 40 || A[k + 3] !== B[k + 3])) { st.target[i] = 1; st.total++; }
        }
      } catch { st.target = null; }
    }
  },
  paint() {
    const f = K.frost, g = st.g, b = im(f.cake.imgDone);
    g.clearRect(0, 0, 640, 360);
    if (!b) return;
    g.save();
    g.drawImage(b, st.ox, st.oy);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(st.mask, st.ox, st.oy);
    g.restore();
  },
  dab(x, y) {
    const r = K.frost.brush, g = st.mg;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(Math.round(x - st.ox), Math.round(y - st.oy), r, 0, 7); g.fill();
  },
  down(e) { st.down = true; st.last = null; this.move(e); },
  up() { st.down = false; st.last = null; },
  move(e) {
    const p = art(e);
    st.spatula.style.left = (p.x + 8) + 'px'; st.spatula.style.top = (p.y + 54) + 'px';
    if (!st.down) return;
    if (st.last) {
      const d = Math.hypot(p.x - st.last.x, p.y - st.last.y), n = Math.max(1, Math.ceil(d / 5));
      for (let i = 1; i <= n; i++) this.dab(st.last.x + (p.x - st.last.x) * i / n, st.last.y + (p.y - st.last.y) * i / n);
    } else this.dab(p.x, p.y);
    st.last = p;
    this.paint();
    if ((st.snd = (st.snd || 0) + 1) % 7 === 0) G.blip(520 + Math.random() * 80, .03, 'sine', .015);
  },
  update(dt) {
    if ((st.check += dt) < .18) return;
    st.check = 0;
    let cover = 0;
    if (st.target && st.total) {
      const d = st.mg.getImageData(0, 0, st.cs.w, st.cs.h).data;
      let n = 0;
      for (let i = 0; i < st.target.length; i++) if (st.target[i] && d[i * 4 + 3] > 128) n++;
      cover = n / st.total;
    }
    st.cover = cover;
    st.bar(cover / K.frost.need);
    if (cover >= K.frost.need) {
      st.mg.fillStyle = '#fff'; st.mg.fillRect(0, 0, st.cs.w, st.cs.h);
      this.paint(); complete();
    }
  }
};

/* ============================================================
   8. УКРАСИТЬ
   ============================================================ */
STEPS.decor = {
  build() {
    const d = K.decor;
    st = { drag: null, count: 0, cs: size(d.cake.img, 176, 150) };
    st.cake = put(d.cake, 'kitchen.decor.cake', 'k-back');
    d.items.forEach((it, i) => {
      const e = put(it, `kitchen.decor.items.${i}`, 'k-src');
      e.dataset.i = i; e.title = it.name;
    });
    st.btn = G.el('button', 'cbtn k-done', G.esc(K.texts.finish));
    st.btn.onclick = () => { if (active() && st.count >= d.min) complete(); };
    root.appendChild(st.btn);
    this.paintCount();
  },
  paintCount() {
    const d = K.decor;
    hint(G.fmt(d.hint, { min: d.min }) + `  ${Math.min(st.count, d.min)}/${d.min}`);
    st.btn.disabled = st.count < d.min;
    st.btn.classList.toggle('is-ready', st.count >= d.min);
  },
  down(e) {
    const src = e.target.closest('.k-src'), old = e.target.closest('.k-deco');
    if (!src && !old) return;
    const p = art(e);
    let el = old;
    if (src) {
      const it = K.decor.items[+src.dataset.i];
      el = new Image();
      el.className = 'ent px k-deco'; el.draggable = false; el.src = G.asset(it.img);
      layer.appendChild(el);
      st.drag = { el, fresh: true, dx: 0, dy: 10 };
    } else {
      st.drag = { el, fresh: false, dx: parseFloat(el.style.left) - p.x, dy: parseFloat(el.style.top) - p.y };
    }
    el.classList.add('is-drag');
    this.move(e);
    G.sfx.tap();
  },
  move(e) {
    const d = st.drag; if (!d) return;
    const p = art(e);
    d.el.style.left = (p.x + d.dx) + 'px'; d.el.style.top = (p.y + d.dy) + 'px';
    d.el.style.zIndex = 100 + Math.round(p.y + d.dy);
  },
  up() {
    const d = st.drag; if (!d) return;
    st.drag = null;
    d.el.classList.remove('is-drag');
    const c = K.decor.cake, x = parseFloat(d.el.style.left), y = parseFloat(d.el.style.top);
    const on = x > c.x - st.cs.w / 2 + 6 && x < c.x + st.cs.w / 2 - 6 && y > c.y - st.cs.h - 6 && y < c.y - 8;
    if (on) { if (d.fresh) st.count++; G.sfx.plop(); fx('popStar', x, y - 8, { scale: .6 }); }
    else { if (!d.fresh) st.count--; d.el.remove(); }
    this.paintCount();
  }
};

/* ============================================================
   ОБЩИЙ КАРКАС
   ============================================================ */
function hint(text) { if (ui.hint) { ui.hint.textContent = text || ''; ui.hint.hidden = !text; } }

function paintCard() {
  if (!ui.card) return;
  const T = K.texts;
  ui.card.innerHTML =
    `<div class="k-card__pin">🍒</div><h3>${G.esc(K.recipe.name)}</h3><p class="k-card__note">${G.esc(K.recipe.note || '')}</p>` +
    `<h4>${G.esc(T.ingredientsTitle)}</h4><ul class="k-card__ings">` +
    K.ingredients.map(i => `<li class="${got.has(i.id) || idx > order.indexOf('gather') ? 'is-on' : ''}"><i></i><span>${G.esc(i.name)}</span><em>${G.esc(i.amount || '')}</em></li>`).join('') +
    `</ul><h4>${G.esc(T.stepsTitle)}</h4><ol class="k-card__steps">` +
    order.map((s, i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}">${G.esc(K[s].title)}</li>`).join('') + '</ol>';
}

function paintTimer() {
  if (!ui.time) return;
  const t = Math.max(0, Math.ceil(timeLeft));
  ui.time.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  ui.timer.classList.toggle('is-low', K.timeLimit > 0 && t <= 45);
  ui.timeBar.style.width = (K.timeLimit > 0 ? G.clamp(timeLeft / K.timeLimit, 0, 1) * 100 : 100) + '%';
  ui.timer.hidden = !(K.timeLimit > 0);
}

function overlay(html, cls = '') {
  ui.over?.remove();
  ui.over = G.el('div', 'k-over ' + cls, html);
  root.appendChild(ui.over);
  return ui.over;
}

function buildStep(intro) {
  timers.forEach(clearTimeout); timers = [];
  layer.innerHTML = '';
  root.querySelectorAll('.k-done').forEach(e => e.remove());
  const id = order[idx], S = K[id];
  st = {};
  ui.pills.innerHTML = order.map((s, i) => `<i class="${i < idx ? 'is-done' : i === idx ? 'is-on' : ''}">${i < idx ? '✓' : i + 1}</i>`).join('');
  ui.title.textContent = S.title;
  hint(S.hint);
  STEPS[id].build();
  paintCard();
  locked = true;
  if (intro && !G.editing) {
    const o = overlay(`<div class="k-intro"><small>${G.esc(G.fmt(K.texts.stepOf, { n: idx + 1, total: order.length }))}</small><b>${G.esc(S.title)}</b><span>${G.esc(S.hint)}</span></div>`);
    later(() => { o.classList.add('is-out'); locked = false; later(() => o.remove(), 300); }, 1500);
  } else { ui.over?.remove(); locked = false; }
}

function complete() {
  if (locked) return;
  locked = true;
  G.sfx.ok();
  G.fx.screen('confetti', innerWidth / 2, innerHeight / 2, { scale: Math.max(1.6, G.k * 2.2) });
  if (idx >= order.length - 1) {
    running = false;
    G.popup(K.texts.done, 1600);
    later(() => G.completeRoom('kitchen'), 1300);
    return;
  }
  G.popup(K.texts.great, 900);
  later(() => { idx++; buildStep(true); G.editor?.sceneChanged(); }, 1000);
}

function timeUp() {
  ended = true; running = false;
  G.sfx.bad();
  const o = overlay(`<div class="k-intro"><b>${G.esc(K.texts.timeUp)}</b><span>${G.esc(K.texts.timeUpNote)}</span><div class="k-intro__btns"></div></div>`, 'is-modal');
  const again = G.el('button', 'cbtn', G.esc(K.texts.retry)), out = G.el('button', 'cbtn cbtn--ghost', G.esc(K.texts.exit));
  again.onclick = () => start(0);
  out.onclick = exit;
  o.querySelector('.k-intro__btns').append(again, out);
}

function exit() { G.go('world', { room: 'kitchen' }); }

function frame() {
  K = G.cfg.kitchen; SC = K.scale || 1.5;
  root.innerHTML = '';
  ui = {};
  stage = G.el('div', 'kstage');
  stage.dataset.unit = SC;
  stage.style.transform = `scale(${SC})`;
  root.appendChild(stage);
  const bg = new Image();
  bg.className = 'px kbg'; bg.draggable = false; bg.alt = '';
  bg.src = G.asset(K.bg);
  stage.appendChild(bg);
  layer = G.el('div', 'klayer');
  stage.appendChild(layer);

  const top = G.el('div', 'k-top',
    `<div class="hud-chip k-name">🍰 <b></b></div><div class="k-pills"></div>` +
    `<div class="hud-chip k-timer"><span>⏱</span><b></b><i><u></u></i></div>`);
  root.appendChild(top);
  ui.title = top.querySelector('.k-name b'); ui.pills = top.querySelector('.k-pills');
  ui.timer = top.querySelector('.k-timer'); ui.time = ui.timer.querySelector('b'); ui.timeBar = ui.timer.querySelector('u');
  const ex = G.el('button', 'hud-btn k-exit', '✕');
  ex.title = K.texts.exit; ex.onclick = exit;
  root.appendChild(ex);
  ui.card = G.el('aside', 'k-card');
  root.appendChild(ui.card);
  ui.hint = G.el('div', 'k-hint');
  root.appendChild(ui.hint);
}

function start(step) {
  const my = ++loadId;
  K = G.cfg.kitchen;
  order = (K.steps || []).filter(s => STEPS[s] && K[s]);
  idx = G.clamp(step || 0, 0, order.length - 1);
  timeLeft = K.timeLimit || 0;
  ended = false; running = false; locked = true;
  got.clear();
  frame();
  overlay(`<div class="k-intro"><b>${G.esc(K.texts.loading)}</b><div class="k-spin">🍒</div></div>`);
  preload(K, () => {
    if (my !== loadId || G.sceneId !== 'kitchen') return;
    running = true;
    buildStep(true);
    paintTimer();
    G.editor?.sceneChanged();
  });
}

function hold(on) { const S = STEPS[order[idx]]; if (S?.hold) S.hold(on); }

root.addEventListener('pointerdown', e => {
  if (!active() || e.target.closest('button')) return;
  const S = STEPS[order[idx]];
  try { root.setPointerCapture(e.pointerId); } catch {}
  S.down?.(e); hold(true);
});
root.addEventListener('pointermove', e => { if (active()) STEPS[order[idx]].move?.(e); });
['pointerup', 'pointercancel'].forEach(ev => root.addEventListener(ev, e => {
  if (!running) return;
  const S = STEPS[order[idx]];
  S?.up?.(e); hold(false);
}));

G.scenes.kitchen = {
  root,
  get state() { return { step: order[idx], idx, st, timeLeft, locked, running }; },
  enter(p) {
    G.music(G.cfg.kitchen.music);
    start(p.step);
  },
  leave() { loadId++; running = false; timers.forEach(clearTimeout); timers = []; },
  refresh() {
    // правка в редакторе: пересобираем текущий шаг, время не трогаем
    K = G.cfg.kitchen;
    const my = ++loadId, t = timeLeft, wasRunning = running || ended;
    order = (K.steps || []).filter(s => STEPS[s] && K[s]);
    idx = G.clamp(idx, 0, Math.max(0, order.length - 1));
    frame();
    preload(K, () => { if (my !== loadId) return; running = wasRunning; ended = false; timeLeft = t; buildStep(false); paintTimer(); });
  },
  update(dt) {
    if (!running || G.editing) return;
    if (!locked) {
      if (K.timeLimit > 0) {
        timeLeft -= dt;
        if (timeLeft <= 0) { timeLeft = 0; paintTimer(); timeUp(); return; }
      }
      try { STEPS[order[idx]].update?.(dt); } catch (e) { console.error(e); }
    }
    paintTimer();
  },
  key(e) {
    if (!active()) return;
    const S = STEPS[order[idx]];
    if (e.code === 'Space' && S.hold) { if (!e.repeat) hold(true); return; }
    if (!e.repeat) S.key?.(e);
  },
  keyup(e) { if (e.code === 'Space' && running) hold(false); },

  editRoots: () => [
    { path: `kitchen.${order[idx]}`, label: 'Этот шаг: ' + (K[order[idx]]?.title || '') },
    { path: 'kitchen.ingredients', label: 'Продукты рецепта' },
    { path: 'kitchen.decoys', label: 'Обманки (лишние продукты)' },
    { path: 'kitchen', label: 'Вся мини-игра «Торт»' },
    { path: 'world.rooms.kitchen.cutscene', label: 'Катсцена после игры' }
  ],
  editorTools(boxEl) {
    boxEl.innerHTML = '<div class="ed__label">Перейти к шагу</div>';
    const row = G.el('div', 'ed__row ed__row--wrap');
    order.forEach((s, i) => {
      const b = G.el('button', 'ed__btn' + (i === idx ? ' is-on' : ''), `${i + 1}. ${G.esc(K[s].title)}`);
      b.onclick = () => { idx = i; ended = false; running = true; buildStep(false); G.editor.sceneChanged(); };
      row.appendChild(b);
    });
    boxEl.appendChild(row);
    boxEl.appendChild(G.el('p', 'ed__note', 'Пока редактор открыт, время не идёт. Продукты и обманки на полках каждый раз встают в случайном порядке.'));
  }
};

})();
