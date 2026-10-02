/* ============================================================
   world.js — дом: все комнаты на одной карте, без экранов загрузки.
   ------------------------------------------------------------
   • Комнаты описаны в data/game.json → world.rooms: прямоугольник
     в клетках (x, y, w, h; клетка = 16 пикселей арта), текстура
     стены и пола, список предметов (props), персонаж (npc).
   • Комната, в которой героиня ещё не была, затемнена.
   • Двери — world.doors: соединяют две комнаты. Дверь в комнату,
     до которой очередь ещё не дошла, закрыта («Персонаж не дома»).
   • Координаты предметов — в пикселях арта, точка «низ-центр».
     Экран показывает арт с увеличением world.scale.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-world');

let W, S, T;                       // конфиг мира, масштаб, размер клетки
let box, mapCv, playerEl, hintEl, bannerEl, nameEl;
let ents = [], doors = [], darkEls = {};
let cam = { x: 0, y: 0 }, bounds = { w: 0, h: 0 };
let near = null, target = null, talking = false, transit = null, lockCool = 0, pan = null, palOpen = false;
const P = { x: 0, y: 0, dir: 'down', t: 0, room: '', placed: false };
const tex = new Map();             // путь → Image (текстуры стен/полов)

const R = id => W.rooms[id];
/** комната в пикселях арта: fy — где кончается стена и начинается пол */
const geo = r => ({ x: r.x * T, y: r.y * T, w: r.w * T, h: r.h * T, fy: (r.y + W.wallH) * T, bx: (r.x + r.w) * T, by: (r.y + r.h) * T });
const lit = id => G.editing || id === P.room || !!G.progress.visited?.[id];
const doorLocked = d => !G.isUnlocked(d.a) || !G.isUnlocked(d.b);

/* ---------------- геометрия дверей ---------------- */
function doorGeo(d) {
  const A = geo(R(d.a));
  if (d.side === 'top') {
    const x = A.x + d.at * T;
    return { kind: 'top', x, cx: x + T, wallY: A.fy, edgeY: A.y };          // проём в стене комнаты a, комната b — сверху
  }
  const y = A.y + d.at * T, x = d.side === 'left' ? A.x : A.bx;
  return { kind: 'side', x, y, cy: y + T, dir: d.side === 'left' ? -1 : 1 }; // проём в боковой рамке
}

/* ---------------- фон: стены, полы, рамки ---------------- */
function loadTex(path) {
  if (!path) return null;
  let im = tex.get(path);
  if (!im) {
    im = new Image();
    im.onload = () => { if (G.sceneId === 'world') drawMap(); };
    im.src = G.asset(path);
    tex.set(path, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

function drawMap() {
  const g = mapCv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = W.voidColor || '#170b10';
  g.fillRect(0, 0, mapCv.width, mapCv.height);
  const F = 2;                                         // половина толщины рамки
  for (const id in W.rooms) {
    const r = R(id), q = geo(r);
    const wall = loadTex(r.wall), floor = loadTex(r.floor);
    // стена: текстура прижата к низу стены
    g.fillStyle = '#8a5a3a'; g.fillRect(q.x, q.y, q.w, q.fy - q.y);
    if (wall) {
      g.save(); g.translate(q.x, q.fy - wall.naturalHeight);
      g.fillStyle = g.createPattern(wall, 'repeat-x');
      g.fillRect(0, 0, q.w, wall.naturalHeight);
      if (q.fy - q.y > wall.naturalHeight) {            // стена выше текстуры — тянем верхний цвет
        g.drawImage(wall, 0, 1, 1, 1, 0, -(q.fy - q.y - wall.naturalHeight), q.w, q.fy - q.y - wall.naturalHeight);
      }
      g.restore();
    }
    // пол
    g.fillStyle = '#b36933'; g.fillRect(q.x, q.fy, q.w, q.by - q.fy);
    if (floor) {
      g.save(); g.translate(q.x, q.fy);
      g.fillStyle = g.createPattern(floor, 'repeat');
      g.fillRect(0, 0, q.w, q.by - q.fy);
      g.restore();
    }
    // тени: под стеной и по краям — чтобы комната не выглядела плоской
    let gr = g.createLinearGradient(0, q.fy, 0, q.fy + 9);
    gr.addColorStop(0, 'rgba(40,14,8,.34)'); gr.addColorStop(1, 'rgba(40,14,8,0)');
    g.fillStyle = gr; g.fillRect(q.x, q.fy, q.w, 9);
    gr = g.createLinearGradient(q.x, 0, q.x + 7, 0);
    gr.addColorStop(0, 'rgba(40,14,8,.22)'); gr.addColorStop(1, 'rgba(40,14,8,0)');
    g.fillStyle = gr; g.fillRect(q.x, q.fy, 7, q.by - q.fy);
    gr = g.createLinearGradient(q.bx - 7, 0, q.bx, 0);
    gr.addColorStop(0, 'rgba(40,14,8,0)'); gr.addColorStop(1, 'rgba(40,14,8,.22)');
    g.fillStyle = gr; g.fillRect(q.bx - 7, q.fy, 7, q.by - q.fy);
    gr = g.createLinearGradient(0, q.y, 0, q.y + 10);
    gr.addColorStop(0, 'rgba(30,10,6,.3)'); gr.addColorStop(1, 'rgba(30,10,6,0)');
    g.fillStyle = gr; g.fillRect(q.x, q.y, q.w, 10);
  }
  // рамки комнат
  for (const id in W.rooms) {
    const q = geo(R(id));
    g.fillStyle = W.frame || '#4b2a10';
    g.fillRect(q.x - F, q.y - F, q.w + F * 2, F * 2); g.fillRect(q.x - F, q.by - F, q.w + F * 2, F * 2);
    g.fillRect(q.x - F, q.y - F, F * 2, q.h + F * 2); g.fillRect(q.bx - F, q.y - F, F * 2, q.h + F * 2);
    g.fillStyle = W.frame2 || '#633919';
    g.fillRect(q.x - F + 1, q.y - F + 1, q.w + F * 2 - 2, F * 2 - 2); g.fillRect(q.x - F + 1, q.by - F + 1, q.w + F * 2 - 2, F * 2 - 2);
    g.fillRect(q.x - F + 1, q.y - F + 1, F * 2 - 2, q.h + F * 2 - 2); g.fillRect(q.bx - F + 1, q.y - F + 1, F * 2 - 2, q.h + F * 2 - 2);
  }
  // дверные проёмы
  for (const d of W.doors) {
    if (!R(d.a) || !R(d.b)) continue;
    const k = doorGeo(d);
    if (k.kind === 'top') {
      g.fillStyle = '#1d0d08'; g.fillRect(k.x + 3, k.wallY - 46, 26, 46);
      g.fillStyle = '#2a1408'; g.fillRect(k.x + 3, k.edgeY - F, 26, F * 2);       // разрыв в рамке верхней комнаты
      g.fillStyle = '#8c2236'; g.fillRect(k.x + 3, k.edgeY - F - 7, 26, 7);       // коврик у выхода
      g.fillStyle = '#b8324a'; g.fillRect(k.x + 4, k.edgeY - F - 6, 24, 5);
      g.fillStyle = '#e8a0ac'; g.fillRect(k.x + 6, k.edgeY - F - 4, 20, 1);
    } else {
      g.fillStyle = '#7a4a22'; g.fillRect(k.x - F, k.y + 2, F * 2, 2 * T - 4);     // порог
      g.fillStyle = '#9d6a38'; g.fillRect(k.x - F + 1, k.y + 3, F * 2 - 2, 2 * T - 6);
    }
  }
}

/* ---------------- сцена ---------------- */
function render() {
  W = G.cfg.world; S = W.scale || 2; T = W.tile || 16;
  root.innerHTML = '';
  ents = []; doors = []; darkEls = {}; near = null;

  bounds = { w: 0, h: 0 };
  for (const id in W.rooms) { const q = geo(R(id)); bounds.w = Math.max(bounds.w, q.bx + 8); bounds.h = Math.max(bounds.h, q.by + 8); }

  box = G.el('div', 'wbox');
  box.dataset.unit = S;
  box.style.width = bounds.w + 'px'; box.style.height = bounds.h + 'px';
  root.appendChild(box);

  mapCv = G.el('canvas', 'wmap px');
  mapCv.width = bounds.w; mapCv.height = bounds.h;
  box.appendChild(mapCv);
  drawMap();

  for (const id in W.rooms) {
    const r = R(id), q = geo(r);
    // рамка-зона комнаты (видна только в редакторе)
    const zone = G.el('div', 'zone zone--edit wroom', `<span>${G.esc(r.name)}</span>`);
    Object.assign(zone.style, { left: q.x + 'px', top: q.y + 'px', width: q.w + 'px', height: q.h + 'px' });
    zone.dataset.edit = `world.rooms.${id}`;
    zone.dataset.nodrag = 1;
    box.appendChild(zone);

    (r.props || []).forEach((p, i) => {
      const e = G.img(p, `world.rooms.${id}.props.${i}`, 'wprop' + (p.flip ? ' is-flip' : ''));
      e.style.zIndex = p.flat ? 2 : Math.round(p.y) + 10;
      box.appendChild(e);
    });

    if (r.npc) {
      const n = r.npc;
      const wrap = G.el('div', 'ent wnpc');
      G.place(wrap, n);
      wrap.dataset.edit = `world.rooms.${id}.npc`;
      wrap.style.zIndex = Math.round(n.y) + 10;
      wrap.innerHTML =
        (n.img ? `<img class="px" src="${G.asset(n.img)}" alt="" draggable="false">` : '<div class="ent--empty" style="width:24px;height:32px">?</div>') +
        `<span class="wnpc__name">${G.esc(n.name)}</span>` +
        (G.isDone(id) ? '' : '<span class="wnpc__mark">!</span>');
      box.appendChild(wrap);
      ents.push({ type: 'npc', room: id, o: n, el: wrap });
    }

    const dark = G.el('div', 'wdark' + (lit(id) ? ' is-lit' : ''));
    Object.assign(dark.style, { left: (q.x + 2) + 'px', top: (q.y + 2) + 'px', width: (q.w - 4) + 'px', height: (q.h - 4) + 'px' });
    dark.style.setProperty('--dark', W.dark ?? .93);
    box.appendChild(dark);
    darkEls[id] = dark;
  }

  W.doors.forEach((d, i) => {
    if (!R(d.a) || !R(d.b)) return;
    const k = doorGeo(d), locked = doorLocked(d);
    const e = G.el('div', 'wdoor wdoor--' + k.kind + (locked ? ' is-locked' : ''));
    e.dataset.edit = `world.doors.${i}`;
    e.dataset.nodrag = 1;
    if (k.kind === 'top') {
      Object.assign(e.style, { left: k.x + 'px', top: (k.wallY - 48) + 'px', zIndex: Math.round(k.wallY) + 9 });
      e.innerHTML =
        `<img class="px wdoor__closed" src="${G.asset(d.closed)}" alt="" draggable="false">` +
        `<img class="px wdoor__open" src="${G.asset(d.open)}" alt="" draggable="false">` +
        `<img class="px wdoor__frame" src="${G.asset(d.frame)}" alt="" draggable="false">`;
    } else {
      Object.assign(e.style, { left: (k.x - 3) + 'px', top: (k.y - 1) + 'px', zIndex: Math.round(k.y + 2 * T) + 9 });
      e.innerHTML = `<img class="px wdoor__closed" src="${G.asset(d.img)}" alt="" draggable="false">`;
    }
    if (locked) e.insertAdjacentHTML('beforeend', '<span class="wdoor__lock">🔒</span>');
    box.appendChild(e);
    doors.push({ d, k, el: e, locked, open: false });
  });

  playerEl = G.sheet(Object.assign({}, G.cfg.player, { w: G.cfg.player.w }), 'wplayer');
  box.appendChild(playerEl);

  hintEl = G.el('div', 'whint');
  box.appendChild(hintEl);

  nameEl = G.el('div', 'hud-chip wname');
  root.appendChild(nameEl);
  bannerEl = G.el('div', 'wbanner');
  root.appendChild(bannerEl);

  const home = G.el('button', 'hud-btn whome', '🏠');
  home.title = 'В главное меню';
  home.onclick = () => G.go('title');
  root.appendChild(home);

  paintRoom(false);
  draw();
  applyCam();
}

function paintRoom(announce) {
  const r = R(P.room);
  if (!r) return;
  nameEl.textContent = r.name;
  for (const id in darkEls) darkEls[id].classList.toggle('is-lit', lit(id));
  if (announce) {
    bannerEl.textContent = r.name;
    bannerEl.classList.remove('is-on'); void bannerEl.offsetWidth; bannerEl.classList.add('is-on');
  }
}

function enterRoom(id) {
  if (id === P.room || !R(id)) return;
  const first = !G.progress.visited?.[id];
  P.room = id;
  (G.progress.visited ||= {})[id] = true;
  G.saveProgress();
  paintRoom(true);
  if (first) {
    G.sfx.ok();
    const q = geo(R(id));
    G.fx?.at('roomReveal', box, q.x + q.w / 2, q.fy + (q.by - q.fy) / 2, { unit: S });
  }
  G.music(R(id).music);
}

/* ---------------- героиня ---------------- */
function draw() {
  const pl = G.cfg.player;
  playerEl.style.left = P.x + 'px';
  playerEl.style.top = P.y + 'px';
  playerEl.style.zIndex = Math.round(P.y) + 10;
  const row = { down: pl.rowDown, left: pl.rowLeft, right: pl.rowRight, up: pl.rowUp }[P.dir] ?? 0;
  let col = pl.idleFrame ?? 0;
  if (P.t > 0) {
    const step = Math.floor(P.t * (pl.fps || 8));
    col = pl.cols === 3 ? [0, 1, 2, 1][step % 4] : step % (pl.cols || 1);
  }
  playerEl.setFrame(col, row);
}

function camTarget() {
  const vw = G.VW, vh = G.VH, ww = bounds.w * S, wh = bounds.h * S;
  return {
    x: ww <= vw ? (ww - vw) / 2 : G.clamp(P.x * S - vw / 2, 0, ww - vw),
    y: wh <= vh ? (wh - vh) / 2 : G.clamp(P.y * S - vh * .56, 0, wh - vh)
  };
}
function applyCam() { box.style.transform = `translate(${-Math.round(cam.x)}px,${-Math.round(cam.y)}px) scale(${S})`; }
function snapCam() { cam = camTarget(); applyCam(); }

/** можно ли стоять в точке (x, y) — проверяем прямоугольник «ног» */
function free(x, y) {
  const hw = 5, hh = 4;
  const pts = [[x - hw, y - hh], [x + hw, y - hh], [x - hw, y], [x + hw, y]];
  for (const [px, py] of pts) {
    let ok = false;
    for (const id in W.rooms) {
      const q = geo(R(id));
      if (px >= q.x + 3 && px <= q.bx - 3 && py >= q.fy + 1 && py <= q.by - 3) { ok = true; break; }
    }
    if (!ok) for (const dr of doors) {                       // боковой проём открытой двери
      const k = dr.k;
      if (k.kind === 'side' && !dr.locked && Math.abs(px - k.x) <= 4 && py >= k.y + 5 && py <= k.y + 2 * T - 2) { ok = true; break; }
    }
    if (!ok) return false;
  }
  // мебель и персонажи
  for (const id in W.rooms) {
    const r = R(id);
    for (const p of r.props || []) {
      if (!p.solid) continue;
      const el = p._el, w = (p.w || el?.naturalWidth || 16), h = el?.naturalHeight || 16;
      const foot = p.foot ?? Math.min(h, 10);
      if (x + hw > p.x - w / 2 + 1 && x - hw < p.x + w / 2 - 1 && y > p.y - foot && y - hh < p.y) return false;
    }
    const n = r.npc;
    if (n && x + hw > n.x - 8 && x - hw < n.x + 8 && y > n.y - 7 && y - hh < n.y + 1) return false;
  }
  return true;
}

function roomAt(x, y) {
  for (const id in W.rooms) { const q = geo(R(id)); if (x >= q.x && x < q.bx && y >= q.y && y < q.by) return id; }
  return null;
}

function bump(dr) {
  if (lockCool > 0) return;
  lockCool = 1.6;
  G.sfx.bad();
  dr.el.classList.remove('is-shake'); void dr.el.offsetWidth; dr.el.classList.add('is-shake');
  G.popup(dr.d.lockedText || G.cfg.texts.doorLocked);
}

/** дверь в верхней стене: шаг в проём переносит в комнату за стеной */
function tryTopDoors(vy) {
  for (const dr of doors) {
    const k = dr.k;
    if (k.kind !== 'top' || Math.abs(P.x - k.cx) > 11) continue;
    const A = geo(R(dr.d.a)), other = P.room === dr.d.a ? dr.d.b : dr.d.a;
    const goingUp = P.room === dr.d.a && vy < 0 && P.y <= A.fy + 8;
    const goingDown = P.room === dr.d.b && vy > 0 && P.y >= k.edgeY - 5;
    if (!goingUp && !goingDown) continue;
    if (dr.locked) { bump(dr); return true; }
    G.sfx.door();
    transit = { t: 0, dur: .5, fx: P.x, fy: P.y, tx: k.cx, ty: goingUp ? k.edgeY - 9 : A.fy + 8, room: other, dir: goingUp ? 'up' : 'down', swapped: false };
    target = null;
    return true;
  }
  return false;
}

function findNear() {
  let best = null, bd = 1e9;
  for (const n of ents) {
    if (n.room !== P.room) continue;
    const d = Math.hypot(P.x - n.o.x, (P.y - n.o.y) * 1.4);
    if (d < 34 && d < bd) { bd = d; best = n; }
  }
  return best;
}

function showHint() {
  if (!near) { hintEl.classList.remove('is-on'); return; }
  hintEl.innerHTML = `<kbd>E</kbd>${G.esc(G.cfg.texts.hintTalk)}`;
  hintEl.style.left = near.o.x + 'px';
  hintEl.style.top = (near.o.y - near.el.offsetHeight - 12) + 'px';
  hintEl.classList.add('is-on');
}

async function talk(n) {
  const id = n.room, npc = n.o, T_ = G.cfg.texts;
  if (talking) return;
  talking = true;
  P.dir = Math.abs(npc.x - P.x) > Math.abs(npc.y - P.y) ? (npc.x < P.x ? 'left' : 'right') : (npc.y < P.y ? 'up' : 'down');
  P.t = 0; draw();
  try {
    if (!G.isDone(id)) {
      if (await G.say(npc.dialog, npc.name) < 0) return;
    } else {
      if (await G.say(npc.dialogAfter, npc.name) < 0) return;
      if (!G.scenes[id]) return;
      if (await G.choose(T_.replayQuestion, [T_.playAgain, T_.notNow], npc.name) !== 0) return;
    }
    if (G.scenes[id]) G.go(id);
  } finally { talking = false; }
}

const toWorld = e => { const p = G.toView(e); return { x: (p.x + cam.x) / S, y: (p.y + cam.y) / S }; };

root.addEventListener('pointerdown', e => {
  if (G.editing || G.busy || G.dialogOpen || talking || transit || e.target.closest('button')) return;
  const entEl = e.target.closest('.wnpc');
  const n = entEl && ents.find(v => v.el === entEl);
  const p = toWorld(e);
  if (n) target = { x: n.o.x + (P.x < n.o.x ? -16 : 16), y: n.o.y + 3, then: () => { near = findNear(); if (near === n) talk(n); } };
  else target = { x: p.x, y: p.y };
  target.ttl = 6;
});

G.scenes.world = {
  root,
  get roomId() { return P.room; },
  get player() { return P; },

  enter(p) {
    W = G.cfg.world; S = W.scale || 2; T = W.tile || 16;
    target = null; talking = false; transit = null;
    const want = p.room && R(p.room) ? p.room : null;
    if (!P.placed || !R(P.room) || p.reset) {
      const st = W.start || {};
      P.room = R(st.room) ? st.room : Object.keys(W.rooms)[0];
      P.x = st.x; P.y = st.y; P.dir = 'down'; P.placed = true;
    }
    if (want && (want !== P.room || p.at)) {
      const r = R(want), q = geo(r);
      P.room = want;
      if (r.npc) { P.x = r.npc.x - 20; P.y = r.npc.y + 4; } else { P.x = q.x + q.w / 2; P.y = q.fy + (q.by - q.fy) / 2; }
    }
    (G.progress.visited ||= {})[P.room] = true;
    P.t = 0;
    render();
    // если точка занята мебелью — ищем свободную рядом
    for (let i = 0; i < 60 && !free(P.x, P.y); i++) { P.x += (i % 2 ? 1 : -1) * (i + 1) * 2; }
    draw(); snapCam();
    G.music(R(P.room).music);
  },

  refresh() {
    W = G.cfg.world;
    render();          // камера остаётся на месте — удобно править дальние комнаты
  },
  onEdit() { paintRoom(false); },

  update(dt) {
    if (!playerEl) return;
    lockCool = Math.max(0, lockCool - dt);
    // связываем предметы с их картинками (нужны размеры для столкновений)
    if (!ents._linked) {
      box.querySelectorAll('.wprop').forEach(e => { const o = G.get(e.dataset.edit); if (o) Object.defineProperty(o, '_el', { value: e, enumerable: false, configurable: true }); });
      ents._linked = true;
    }
    const freeMove = !G.editing && !G.busy && !G.dialogOpen && !talking;

    if (transit) {
      const tr = transit;
      tr.t += dt;
      const u = Math.min(1, tr.t / tr.dur);
      P.x = tr.fx + (tr.tx - tr.fx) * u; P.y = tr.fy + (tr.ty - tr.fy) * u;
      P.dir = tr.dir; P.t += dt;
      playerEl.style.opacity = u < .3 ? 1 - u / .3 : u > .7 ? (u - .7) / .3 : 0;
      if (u >= .5 && !tr.swapped) { tr.swapped = true; enterRoom(tr.room); }
      if (u >= 1) { transit = null; playerEl.style.opacity = ''; P.t = 0; }
    } else if (freeMove) {
      let vx = 0, vy = 0;
      const K = G.keys;
      if (K.has('KeyA') || K.has('ArrowLeft'))  vx -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) vx += 1;
      if (K.has('KeyW') || K.has('ArrowUp'))    vy -= 1;
      if (K.has('KeyS') || K.has('ArrowDown'))  vy += 1;
      if (vx || vy) target = null;
      else if (target) {
        const dx = target.x - P.x, dy = target.y - P.y, d = Math.hypot(dx, dy);
        target.ttl -= dt;
        if (d < 2.5 || target.ttl <= 0) { const then = target.then; target = null; then && then(); }
        else { vx = dx / d; vy = dy / d; }
      }
      if (vx || vy) {
        const len = Math.hypot(vx, vy), sp = (G.cfg.player.speed || 80) * dt;
        const nx = P.x + vx / len * sp, ny = P.y + vy / len * sp;
        const okX = !!vx && free(nx, P.y);
        if (okX) P.x = nx;
        const okY = !!vy && free(P.x, ny);
        if (okY) P.y = ny;
        P.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
        P.t += dt;
        if (!tryTopDoors(vy)) {
          if (!okX && !okY && target) target.ttl -= dt * 4;
          if (vx && !okX) for (const dr of doors) {        // упёрлись в закрытую боковую дверь
            const k = dr.k;
            if (k.kind === 'side' && dr.locked && Math.abs(P.x - k.x) < 14 && P.y > k.y - 4 && P.y < k.y + 2 * T + 8 && Math.sign(vx) === Math.sign(k.x - P.x)) bump(dr);
          }
        }
        const rid = roomAt(P.x, P.y);
        if (rid && rid !== P.room) enterRoom(rid);
      } else P.t = 0;
    } else P.t = 0;

    // двери открываются, когда героиня рядом
    for (const dr of doors) {
      const k = dr.k;
      const d = k.kind === 'top'
        ? Math.hypot(P.x - k.cx, (P.y - (P.room === dr.d.a ? k.wallY : k.edgeY)))
        : Math.hypot(P.x - k.x, P.y - k.cy - 4);
      const open = !dr.locked && d < 30;
      if (open !== dr.open) { dr.open = open; dr.el.classList.toggle('is-open', open); }
    }

    draw();
    if (!G.editing) {
      const t = camTarget(), k = Math.min(1, dt * 7);
      cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
      applyCam();
    }
    near = freeMove && !transit ? findNear() : null;
    showHint();
  },

  key(e) {
    if (G.isAction(e) && near) talk(near);
  },

  /* --- редактор --- */
  /** в редакторе пустое место тянет камеру */
  editPan(e) {
    pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    const move = ev => {
      cam.x = G.clamp(pan.cx - (ev.clientX - pan.sx) / G.k, -200, Math.max(0, bounds.w * S - G.VW) + 200);
      cam.y = G.clamp(pan.cy - (ev.clientY - pan.sy) / G.k, -200, Math.max(0, bounds.h * S - G.VH) + 200);
      applyCam();
    };
    const up = () => { removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); };
    addEventListener('pointermove', move, true); addEventListener('pointerup', up, true);
  },
  /** центр экрана в координатах арта и комната под ним */
  center() {
    const x = Math.round((cam.x + G.VW / 2) / S), y = Math.round((cam.y + G.VH / 2) / S);
    return { x, y, room: roomAt(x, y) || P.room };
  },

  /* инструменты в панели редактора: добавить / удалить / настроить предмет */
  selectTools: true,
  editorTools(boxEl) {
    const m = /^world\.rooms\.(\w+)\.props\.(\d+)$/.exec(G.editor.sel || '');
    const prop = m && R(m[1])?.props[+m[2]];
    const open = palOpen;
    boxEl.innerHTML =
      `<p class="ed__note">Все предметы в комнатах — отдельные картинки: их можно двигать, заменять и удалять.
        Пустое место тянет камеру. Размер и текстуры комнаты — в её настройках ниже.</p>
       <div class="ed__row"><button class="ed__btn ed__btn--main" id="wAdd">➕ Добавить предмет</button><button class="ed__btn" id="wUp">⬆ Своя картинка…</button></div>
       <div class="ed__pal" id="wPal" hidden></div>
       <div class="ed__label">Выбранный предмет</div>
       <div class="ed__row ed__row--wrap">
         <button class="ed__btn${prop?.solid ? ' is-on' : ''}" id="wSolid">Преграда</button>
         <button class="ed__btn${prop?.flat ? ' is-on' : ''}" id="wFlat">На полу</button>
         <button class="ed__btn${prop?.flip ? ' is-on' : ''}" id="wFlip">Отразить</button>
         <button class="ed__btn" id="wDup">Дублировать</button>
         <button class="ed__btn" id="wDel" style="color:#b3261e">🗑 Удалить</button>
       </div>`;
    const q = s => boxEl.querySelector(s);
    ['#wSolid', '#wFlat', '#wFlip', '#wDup', '#wDel'].forEach(s => { q(s).disabled = !prop; });
    const done = sel => { G.refresh(); if (sel !== undefined) G.editor.select(sel); G.editor.structural(); };
    const add = img => {
      const c = this.center(), list = (R(c.room).props ||= []);
      list.push({ img, x: c.x, y: c.y, solid: true });
      done(`world.rooms.${c.room}.props.${list.length - 1}`);
    };
    const flag = k => () => { if (!prop) return; if (prop[k]) delete prop[k]; else prop[k] = true; done(); };
    q('#wSolid').onclick = flag('solid'); q('#wFlat').onclick = flag('flat'); q('#wFlip').onclick = flag('flip');
    q('#wDup').onclick = () => { const list = R(m[1]).props; list.push(Object.assign(G.clone(prop), { x: prop.x + 12, y: prop.y + 8 })); done(`world.rooms.${m[1]}.props.${list.length - 1}`); };
    q('#wDel').onclick = () => { R(m[1]).props.splice(+m[2], 1); done(null); };
    q('#wUp').onclick = () => G.editor.pickFile('image/*', f => add(G.editor.stashFile(f)));
    const fillPal = async () => {
      const pal = q('#wPal');
      try {
        const man = await (await fetch('assets/world/manifest.json', { cache: 'no-store' })).json();
        const names = { furniture: 'Мебель', items: 'Мелочи и окна', doors: 'Двери' };
        pal.innerHTML = '';
        for (const grp of Object.keys(names)) {
          pal.appendChild(G.el('div', 'ed__label', names[grp]));
          const grid = G.el('div', 'ed__palgrid');
          Object.keys(man).filter(k => man[k] === grp).forEach(path => {
            const b = G.el('button', 'ed__palitem', `<img class="px" loading="lazy" src="${G.asset(path)}" alt="">`);
            b.title = path.split('/').pop().replace('.png', '');
            b.onclick = () => add(path);
            grid.appendChild(b);
          });
          pal.appendChild(grid);
        }
      } catch { pal.textContent = 'Не удалось загрузить список спрайтов'; }
    };
    q('#wAdd').onclick = () => { const pal = q('#wPal'); pal.hidden = !pal.hidden; palOpen = !pal.hidden; if (palOpen && !pal.childElementCount) fillPal(); };
    if (open) { q('#wPal').hidden = false; fillPal(); }
  },

  editRoots: () => [
    { path: `world.rooms.${P.room}`, label: 'Комната «' + R(P.room).name + '»' },
    { path: 'world.doors', label: 'Двери' },
    { path: 'world', label: 'Весь дом' },
    { path: 'player', label: 'Героиня (спрайт-лист)' },
    { path: 'texts', label: 'Общие тексты' }
  ]
};

})();
