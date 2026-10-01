/* ============================================================
   finale.js — финал: чёрный экран, плавно появляются три
   девочки, торт со свечкой, салют и поздравление.
   Всё настраивается в data/game.json → finale.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-finale');

let F = null, run = 0, shown = false, time = 0;
let flameEl = null, fw = null, endEl = null;

/* ---------------- пиксельный салют ---------------- */
const COLORS = ['#ff4d6d', '#ff8fa3', '#ffd166', '#fff0f3', '#c77dff', '#ff7b00', '#d90429'];
function makeFireworks(cv) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  let rockets = [], sparks = [], wait = 0;
  return {
    on: false,
    step(dt) {
      g.clearRect(0, 0, W, H);
      if (this.on) {
        wait -= dt;
        if (wait <= 0) {
          wait = G.rnd(.2, .75);
          rockets.push({ x: G.rnd(W * .1, W * .9), y: H, vy: -G.rnd(95, 150), ty: G.rnd(H * .12, H * .5),
                         c: COLORS[(Math.random() * COLORS.length) | 0] });
        }
      }
      rockets = rockets.filter(r => {
        r.y += r.vy * dt;
        g.fillStyle = '#fff0f3'; g.fillRect(r.x | 0, r.y | 0, 1, 2);
        g.globalAlpha = .4; g.fillRect(r.x | 0, (r.y | 0) + 2, 1, 5); g.globalAlpha = 1;
        if (r.y > r.ty) return true;
        const n = 26 + ((Math.random() * 22) | 0), ring = Math.random() < .4;
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 2 * i / n + G.rnd(-.1, .1), v = ring ? 46 : G.rnd(14, 58);
          sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: G.rnd(.7, 1.4), t: 0,
                        c: Math.random() < .25 ? '#fff0f3' : r.c });
        }
        if (G.soundOn && G.sceneId === 'finale') G.blip(G.rnd(110, 200), .25, 'triangle', .035);
        return false;
      });
      sparks = sparks.filter(s => {
        s.t += dt;
        if (s.t > s.life) return false;
        s.vy += 42 * dt; s.vx *= .985; s.vy *= .985;
        const ox = s.x, oy = s.y;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const a = 1 - s.t / s.life, big = s.t < s.life * .6 ? 2 : 1;
        g.fillStyle = s.c;
        // короткий хвостик за искрой
        g.globalAlpha = a * .35;
        g.fillRect((ox - s.vx * .05) | 0, (oy - s.vy * .05) | 0, 1, 1);
        g.fillRect((ox - s.vx * .1) | 0, (oy - s.vy * .1) | 0, 1, 1);
        g.globalAlpha = a;
        g.fillRect(s.x | 0, s.y | 0, big, big);
        g.globalAlpha = 1;
        return true;
      });
    }
  };
}

function render() {
  F = G.cfg.finale;
  root.innerHTML = '';

  const cv = G.el('canvas', 'fin__fw px');
  cv.width = 320; cv.height = 180;
  root.appendChild(cv);
  fw = makeFireworks(cv);

  F.girls.forEach((girl, i) => {
    const e = G.img(girl, `finale.girls.${i}`, 'fin__fade fin__girl');
    e.style.zIndex = Math.round(girl.y);
    root.appendChild(e);
  });

  const cake = G.img(F.cake, 'finale.cake', 'fin__fade fin__cake');
  cake.style.zIndex = Math.round(F.cake.y);
  root.appendChild(cake);

  const glow = G.el('div', 'fin__glow fin__fade');
  glow.style.left = F.flame.x + 'px'; glow.style.top = (F.flame.y - 10) + 'px';
  glow.style.zIndex = Math.round(F.cake.y) + 1;
  root.appendChild(glow);

  flameEl = G.sheet(F.flame, 'fin__fade fin__flame');
  G.place(flameEl, F.flame);
  flameEl.dataset.edit = 'finale.flame';
  flameEl.style.zIndex = Math.round(F.cake.y) + 2;
  root.appendChild(flameEl);

  endEl = G.el('div', 'fin__end',
    `<h1>${G.esc(F.endTitle)}</h1><p>${G.esc(F.endText)}</p>`);
  const back = G.el('button', 'pbtn', G.esc(F.backButton));
  back.onclick = () => G.go('title');
  endEl.appendChild(back);
  root.appendChild(endEl);

  if (shown || G.editing) showAll();
}

function showAll() {
  G.$$('.fin__fade', root).forEach(e => e.classList.add('is-in'));
  fw.on = !!F.fireworks;
  if (shown) endEl.classList.add('is-in');
}

async function sequence() {
  const my = ++run;
  const alive = () => my === run && G.sceneId === 'finale';
  await G.sleep(1100);
  for (const e of G.$$('.fin__girl', root)) {
    if (!alive()) return;
    e.classList.add('is-in');
    G.blip(660 + Math.random() * 300, .2, 'sine', .04);
    await G.sleep(900);
  }
  if (!alive()) return;
  G.$$('.fin__cake, .fin__flame, .fin__glow', root).forEach(e => e.classList.add('is-in'));
  G.sfx.ok();
  await G.sleep(1300);
  if (!alive()) return;
  fw.on = !!F.fireworks;
  G.music(F.music, F.musicVolume ?? .7);
  await G.sleep(700);
  if (!alive()) return;
  if (await G.say(F.dialog) < 0 || !alive()) return;
  shown = true;
  endEl.classList.add('is-in');
  G.sfx.win();
}

G.scenes.finale = {
  root,
  enter() {
    G.progress.finale = true; G.saveProgress();
    G.music('');
    shown = false; time = 0;
    render();
    if (!G.editing) sequence(); else { shown = true; showAll(); }
  },
  leave() { run++; G.music(''); },
  refresh() { render(); showAll(); },
  onEdit(on) { if (on) { run++; G.closeDialog(); shown = true; showAll(); } },
  update(dt) {
    time += dt;
    if (flameEl) flameEl.setFrame(Math.floor(time * (F.flame.fps || 8)) % Math.max(1, F.flame.cols || 1));
    fw?.step(dt);
  },
  editRoots: () => [{ path: 'finale', label: 'Финал: поздравление' }]
};

})();
