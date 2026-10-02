/* ============================================================
   finale.js — финал: чёрный экран, плавно появляются три
   девочки, торт со свечкой, салют и поздравление.
   Салют и огонёк свечи — эффекты Arcadia Effector (fx).
   Всё настраивается в data/game.json → finale.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;
const root = $('#sc-finale');

let F = null, run = 0, shown = false, fwOn = false, fwWait = 0;
let sky = null, endEl = null;
const WORKS = ['fireworkRed', 'fireworkGold', 'fireworkPink'];

function launch() {
  const name = WORKS[(Math.random() * WORKS.length) | 0];
  const x = G.rnd(90, G.VW - 90), y = G.rnd(60, 250);
  G.fx.at(name, sky, x, y, { scale: G.rnd(1.6, 2.8) });
  if (G.soundOn) {
    G.blip(G.rnd(110, 190), .28, 'triangle', .04);
    setTimeout(() => G.blip(G.rnd(900, 1500), .05, 'square', .012), 240);
  }
}

function render() {
  F = G.cfg.finale;
  root.innerHTML = '';

  sky = G.el('div', 'fin__sky');
  root.appendChild(sky);

  F.girls.forEach((girl, i) => {
    const e = G.img(girl, `finale.girls.${i}`, 'fin__fade fin__girl');
    e.style.zIndex = Math.round(girl.y);
    root.appendChild(e);
  });

  const cake = G.img(F.cake, 'finale.cake', 'fin__fade fin__cake');
  cake.style.zIndex = Math.round(F.cake.y);
  root.appendChild(cake);

  const glow = G.el('div', 'fin__glow fin__fade');
  glow.style.left = F.flame.x + 'px'; glow.style.top = (F.flame.y - 14) + 'px';
  glow.style.zIndex = Math.round(F.cake.y) + 1;
  root.appendChild(glow);

  // огонёк: точка x,y — основание пламени
  const flame = G.el('div', 'ent fin__fade fin__flame');
  G.place(flame, F.flame);
  flame.dataset.edit = 'finale.flame';
  flame.style.zIndex = Math.round(F.cake.y) + 2;
  const fl = G.fx.el('flame', { loop: true, scale: F.flame.scale || 1 });
  if (fl) flame.appendChild(fl);
  root.appendChild(flame);

  endEl = G.el('div', 'fin__end', `<h1>${G.esc(F.endTitle)}</h1><p>${G.esc(F.endText)}</p>`);
  const back = G.el('button', 'cbtn cbtn--ghost', G.esc(F.backButton));
  back.onclick = () => G.go('title');
  endEl.appendChild(back);
  root.appendChild(endEl);

  if (shown || G.editing) showAll();
}

function showAll() {
  G.$$('.fin__fade', root).forEach(e => e.classList.add('is-in'));
  fwOn = !!F.fireworks;
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
  fwOn = !!F.fireworks; fwWait = 0;
  G.music(F.music, F.musicVolume ?? .7);
  await G.sleep(900);
  if (!alive()) return;
  if (await G.say(F.dialog) < 0 || !alive()) return;
  shown = true;
  endEl.classList.add('is-in');
  G.sfx.win();
  G.fx.screen('confetti', innerWidth / 2, innerHeight / 2, { scale: Math.max(1.8, G.k * 2.4) });
}

G.scenes.finale = {
  root,
  enter() {
    G.progress.finale = true; G.saveProgress();
    G.music('');
    shown = false; fwOn = false; fwWait = 0;
    render();
    if (!G.editing) sequence(); else { shown = true; showAll(); }
  },
  leave() { run++; fwOn = false; G.music(''); },
  refresh() { render(); showAll(); },
  onEdit(on) { if (on) { run++; G.closeDialog(); shown = true; showAll(); } },
  update(dt) {
    if (!fwOn || G.editing) return;
    fwWait -= dt;
    if (fwWait <= 0) { fwWait = (F.fireworkEvery || .55) * G.rnd(.5, 1.6); launch(); }
  },
  editRoots: () => [{ path: 'finale', label: 'Финал: поздравление' }, { path: 'fx', label: 'Эффекты (атласы Arcadia)' }]
};

})();
