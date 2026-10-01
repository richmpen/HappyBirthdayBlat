/* ============================================================
   rooms.js — комнаты: героиня ходит, заходит в двери (E),
   разговаривает с персонажами (E) и запускает мини-игры.
   Все комнаты описаны в data/game.json → rooms.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-room');

let id = 'hub', room = null;
let playerEl = null, hintEl = null;
let ents = [];                 // двери и персонаж: { type, o, el, locked }
let near = null, target = null, talking = false;
const P = { x: 480, y: 420, dir: 'down', t: 0 };

const walkClamp = (x, y) => {
  const w = room.walk;
  return { x: G.clamp(x, w.x, w.x + w.w), y: G.clamp(y, w.y, w.y + w.h) };
};

function render() {
  root.innerHTML = '';
  ents = []; near = null;

  const bg = new Image();
  bg.className = 'room__bg px'; bg.draggable = false; bg.alt = '';
  bg.src = G.asset(room.bg);
  root.appendChild(bg);

  root.appendChild(G.zone(room.walk, `rooms.${id}.walk`, 'здесь можно ходить', 'zone--edit'));

  (room.doors || []).forEach((d, i) => {
    const wrap = G.el('div', 'ent door');
    G.place(wrap, d);
    wrap.dataset.edit = `rooms.${id}.doors.${i}`;
    wrap.style.zIndex = Math.round(d.y);
    const locked = !G.isUnlocked(d.to);
    const done = d.to !== 'hub' && G.isDone(d.to);
    wrap.innerHTML =
      (d.img ? `<img class="px" src="${G.asset(d.img)}" alt="" draggable="false">` : '<div class="ent--empty" style="height:140px">дверь</div>') +
      (d.label ? `<span class="door__label">${G.esc(d.label)}</span>` : '') +
      (locked ? '<span class="door__badge">🔒</span>' : done ? '<span class="door__badge door__badge--ok">🍒</span>' : '');
    wrap.classList.toggle('is-locked', locked);
    root.appendChild(wrap);
    ents.push({ type: 'door', o: d, el: wrap, locked });
  });

  (room.props || []).forEach((p, i) => {
    const e = G.img(p, `rooms.${id}.props.${i}`);
    e.style.zIndex = Math.round(p.y);
    root.appendChild(e);
  });

  if (room.npc) {
    const n = room.npc;
    const wrap = G.el('div', 'ent npc');
    G.place(wrap, n);
    wrap.dataset.edit = `rooms.${id}.npc`;
    wrap.style.zIndex = Math.round(n.y);
    wrap.innerHTML =
      (n.img ? `<img class="px" src="${G.asset(n.img)}" alt="" draggable="false">` : '<div class="ent--empty" style="height:96px">персонаж</div>') +
      `<span class="npc__name">${G.esc(n.name)}</span>` +
      (G.isDone(id) ? '' : '<span class="npc__mark">!</span>');
    root.appendChild(wrap);
    ents.push({ type: 'npc', o: n, el: wrap });
  }

  const spawn = G.el('div', 'ent spawn zone--edit', '<span>старт</span>');
  G.place(spawn, room.spawn);
  spawn.dataset.edit = `rooms.${id}.spawn`;
  root.appendChild(spawn);

  playerEl = G.sheet(G.cfg.player, 'player');
  root.appendChild(playerEl);

  hintEl = G.el('div', 'hint');
  root.appendChild(hintEl);

  root.appendChild(G.el('div', 'room__name', G.esc(room.name)));
  draw();
}

function draw() {
  const pl = G.cfg.player;
  playerEl.style.left = P.x + 'px';
  playerEl.style.top = P.y + 'px';
  playerEl.style.zIndex = Math.round(P.y);
  const row = { down: pl.rowDown, left: pl.rowLeft, right: pl.rowRight, up: pl.rowUp }[P.dir] ?? 0;
  let col = pl.idleFrame ?? 0;
  if (P.t > 0) {
    const step = Math.floor(P.t * (pl.fps || 8));
    col = pl.cols === 3 ? [0, 1, 2, 1][step % 4] : step % (pl.cols || 1);
  }
  playerEl.setFrame(col, row);
}

function findNear() {
  let best = null, bd = 1e9;
  for (const n of ents) {
    const o = n.o;
    let d;
    if (n.type === 'door') {
      if (Math.abs(P.x - o.x) > o.w * .6 || P.y - o.y > 80 || P.y < o.y - 20) continue;
      d = Math.abs(P.x - o.x);
    } else {
      d = Math.hypot(P.x - o.x, (P.y - o.y) * 1.5);
      if (d > 105) continue;
    }
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function showHint() {
  if (!near) { hintEl.classList.remove('is-on'); return; }
  const T = G.cfg.texts;
  hintEl.innerHTML = `<kbd>E</kbd> ${G.esc(near.type === 'door' ? T.hintDoor : T.hintTalk)}`;
  hintEl.style.left = near.o.x + 'px';
  hintEl.style.top = (near.o.y - near.el.offsetHeight - (near.type === 'door' ? 34 : 30)) + 'px';
  hintEl.classList.add('is-on');
}

async function talk() {
  const npc = room.npc, T = G.cfg.texts;
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
      if (await G.choose(T.replayQuestion, [T.playAgain, T.notNow], npc.name) !== 0) return;
    }
    if (G.scenes[id]) G.go(id);
  } finally {
    talking = false;
  }
}

function interactWith(n) {
  if (!n || G.busy || G.dialogOpen || talking) return;
  if (n.type === 'npc') { talk(); return; }
  const d = n.o;
  if (n.locked) {
    G.sfx.bad();
    n.el.classList.remove('is-shake'); void n.el.offsetWidth; n.el.classList.add('is-shake');
    G.popup(d.lockedText || G.cfg.texts.doorLocked);
    return;
  }
  if (!G.cfg.rooms[d.to]) { G.popup('Комната «' + d.to + '» не найдена'); return; }
  G.sfx.door();
  G.go('room', { id: d.to, from: id });
}

root.addEventListener('pointerdown', e => {
  if (G.editing || G.busy || G.dialogOpen || talking) return;
  const entEl = e.target.closest('.door, .npc');
  const n = entEl && ents.find(v => v.el === entEl);
  if (n) {
    const o = n.o;
    const t = n.type === 'door'
      ? walkClamp(o.x, o.y + 12)
      : walkClamp(o.x + (P.x < o.x ? -70 : 70), o.y + 8);
    target = { ...t, then: () => { near = findNear(); if (near === n) interactWith(n); } };
  } else {
    const p = G.toView(e);
    target = walkClamp(p.x, p.y);
  }
});

G.scenes.room = {
  root,
  get roomId() { return id; },

  enter(p) {
    id = G.cfg.rooms[p.id] ? p.id : 'hub';
    room = G.cfg.rooms[id];
    target = null; talking = false;
    let x = room.spawn.x, y = room.spawn.y;
    const back = p.from && (room.doors || []).find(d => d.to === p.from);
    if (back) { x = back.x; y = room.walk.y + 26; }
    if (p.at === 'npc' && room.npc) { x = room.npc.x - 96; y = room.npc.y + 14; }
    Object.assign(P, walkClamp(x, y), { dir: 'down', t: 0 });
    render();
    G.music(room.music);
  },

  refresh() {
    room = G.cfg.rooms[id];
    render();
  },

  update(dt) {
    if (!playerEl) return;
    const free = !G.editing && !G.busy && !G.dialogOpen && !talking;
    let vx = 0, vy = 0;
    if (free) {
      const K = G.keys;
      if (K.has('KeyA') || K.has('ArrowLeft'))  vx -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) vx += 1;
      if (K.has('KeyW') || K.has('ArrowUp'))    vy -= 1;
      if (K.has('KeyS') || K.has('ArrowDown'))  vy += 1;
      if (vx || vy) target = null;
      else if (target) {
        const dx = target.x - P.x, dy = target.y - P.y, d = Math.hypot(dx, dy);
        if (d < 5) { const then = target.then; target = null; then && then(); }
        else { vx = dx / d; vy = dy / d; }
      }
    }
    if (vx || vy) {
      const len = Math.hypot(vx, vy), sp = G.cfg.player.speed * dt;
      Object.assign(P, walkClamp(P.x + vx / len * sp, P.y + vy / len * sp));
      P.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
      P.t += dt;
    } else P.t = 0;
    draw();
    near = free ? findNear() : null;
    showHint();
  },

  key(e) {
    if (G.isAction(e) && near) interactWith(near);
  },

  editRoots: () => [
    { path: `rooms.${id}`, label: 'Комната «' + room.name + '»' },
    { path: 'player', label: 'Героиня (спрайт-лист)' },
    { path: 'texts', label: 'Общие тексты' }
  ]
};

})();
