/* ============================================================
   main.js — заставка, катсцены и запуск игры
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$;

/* ---------------- заставка ---------------- */
const titleRoot = $('#sc-title');
function renderTitle() {
  const M = G.cfg.meta, done = G.allDone(), has = G.hasProgress();
  titleRoot.innerHTML = '';

  const sky = G.el('div', 'ttl__sky');
  for (let i = 0; i < 16; i++) {
    const c = new Image();
    c.className = 'px ttl__cherry'; c.alt = ''; c.draggable = false;
    c.src = G.asset('assets/ui/cherry.png');
    c.style.left = (4 + (i * 61) % 92) + '%';
    c.style.width = (28 + (i * 13) % 34) + 'px';
    c.style.animationDuration = (7 + (i * 7) % 8) + 's';
    c.style.animationDelay = -((i * 37) % 14) + 's';
    sky.appendChild(c);
  }
  titleRoot.appendChild(sky);

  const h = G.el('h1', 'ttl__title');
  [...M.title].forEach((ch, i) => {
    const s = G.el('span', '', ch === ' ' ? '&nbsp;' : G.esc(ch));
    s.style.animationDelay = (i * .07) + 's';
    h.appendChild(s);
  });
  titleRoot.appendChild(h);
  titleRoot.appendChild(G.el('p', 'ttl__sub', G.esc(M.subtitle)));

  const btns = G.el('div', 'ttl__btns');
  const start = G.el('button', 'pbtn pbtn--big', G.esc(has ? M.continueButton : M.startButton));
  start.onclick = () => { G.sfx.ok(); G.go('room', { id: 'hub' }); };
  btns.appendChild(start);
  if (done) {
    const fin = G.el('button', 'pbtn pbtn--gold', '🎂 ' + G.esc(M.finaleButton));
    fin.onclick = () => { G.sfx.ok(); G.go('finale'); };
    btns.appendChild(fin);
  }
  if (has) {
    const again = G.el('button', 'pbtn pbtn--ghost', G.esc(M.newGameButton));
    again.onclick = () => {
      if (!confirm('Начать игру заново? Прогресс и рекорды сотрутся.')) return;
      G.resetProgress(); G.go('room', { id: 'hub' });
    };
    btns.appendChild(again);
  }
  titleRoot.appendChild(btns);
  titleRoot.appendChild(G.el('p', 'ttl__ctrl', G.esc(M.controls)));

  const snd = G.el('button', 'ttl__snd', G.soundOn ? '🔔' : '🔕');
  snd.title = 'Звук';
  snd.onclick = () => { G.soundOn = !G.soundOn; G.writeLS('cherry.sound', G.soundOn); snd.textContent = G.soundOn ? '🔔' : '🔕'; G.sfx.tap(); };
  titleRoot.appendChild(snd);
}
G.scenes.title = {
  root: titleRoot,
  enter() { renderTitle(); G.music(G.cfg.meta.music); document.title = G.cfg.meta.title + ' 🍒'; },
  refresh: renderTitle,
  key(e) { if (G.isAction(e)) titleRoot.querySelector('.pbtn')?.click(); },
  editRoots: () => [{ path: 'meta', label: 'Заставка' }]
};

/* ---------------- катсцена: картинка на весь экран ---------------- */
const cutRoot = $('#sc-cutscene');
let cut = { path: '', next: null, ready: false, t: 0 };
function renderCut() {
  const c = G.get(cut.path) || {};
  cutRoot.innerHTML = '';
  if (c.img) {
    const im = new Image();
    im.className = 'cut__img px'; im.alt = ''; im.draggable = false;
    im.src = G.asset(c.img);
    cutRoot.appendChild(im);
  }
  if (c.text) cutRoot.appendChild(G.el('div', 'cut__text', G.esc(c.text)));
  cutRoot.appendChild(G.el('div', 'cut__hint' + (cut.ready ? ' is-on' : ''), G.esc(G.cfg.texts.cutsceneContinue)));
}
function cutNext() {
  if (!cut.ready || G.busy || G.editing) return;
  cut.ready = false;
  G.sfx.tap();
  (cut.next || (() => G.go('title')))();
}
cutRoot.addEventListener('click', cutNext);
G.scenes.cutscene = {
  root: cutRoot,
  enter(p) {
    cut = { path: p.path, next: p.next, ready: false, t: 0 };
    G.music('');
    renderCut();
  },
  refresh: renderCut,
  update(dt) {
    if (cut.ready) return;
    cut.t += dt;
    if (cut.t > 1.4) { cut.ready = true; cutRoot.querySelector('.cut__hint')?.classList.add('is-on'); }
  },
  key(e) { if (G.isAction(e)) cutNext(); },
  editRoots: () => [{ path: cut.path, label: 'Катсцена' }]
};

/* ---------------- быстрый переход (редактор и ?scene=…) ---------------- */
G.jump = spec => {
  const [a, b] = String(spec || '').split(':');
  if (a === 'room') return G.go('room', { id: b || 'hub' });
  if (a === 'kitchen') return G.go('kitchen', { step: +b || 0 });
  if (a === 'cutscene') return G.go('cutscene', { path: `rooms.${b}.cutscene`, next: () => G.go('room', { id: b, at: 'npc' }) });
  return G.go(G.scenes[a] ? a : 'title');
};

/* ---------------- запуск ---------------- */
(async () => {
  const boot = $('#boot');
  try {
    await G.loadConfig();
  } catch (e) {
    console.error(e);
    boot.classList.add('is-error');
    boot.innerHTML = 'Не получилось загрузить игру 😢<br><small>' + G.esc(e.message) +
      '<br>Если открываешь с компьютера — запусти start.bat, а не index.html напрямую.</small>';
    return;
  }
  G.editor.init();
  G.start();
  boot.remove();
  await G.jump(new URLSearchParams(location.search).get('scene') || 'title');
})();

})();
