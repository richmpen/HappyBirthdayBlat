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

  titleRoot.appendChild(G.el('div', 'ttl__rays'));
  titleRoot.appendChild(G.el('div', 'ttl__gingham'));

  const sky = G.el('div', 'ttl__sky');
  for (let i = 0; i < 18; i++) {
    const c = new Image();
    c.className = 'px ttl__cherry'; c.alt = ''; c.draggable = false;
    c.src = G.asset(M.cherry);
    c.style.left = (3 + (i * 61) % 94) + '%';
    c.style.width = (30 + (i * 13) % 38) + 'px';
    c.style.animationDuration = (6 + (i * 7) % 8) + 's';
    c.style.animationDelay = -((i * 37) % 14) + 's';
    sky.appendChild(c);
  }
  titleRoot.appendChild(sky);
  const tw = G.fx.el('twinkle', { loop: true, scale: 3.6 });
  if (tw) { tw.classList.add('ttl__twinkle'); titleRoot.appendChild(tw); }

  const card = G.el('div', 'ttl__card');
  const h = G.el('h1', 'ttl__title');
  [...M.title].forEach((ch, i) => {
    const s = G.el('span', '', ch === ' ' ? '&nbsp;' : G.esc(ch));
    s.style.animationDelay = (i * .07) + 's';
    h.appendChild(s);
  });
  card.appendChild(h);
  card.appendChild(G.el('p', 'ttl__sub', `<i>✦</i> ${G.esc(M.subtitle)} <i>✦</i>`));

  const btns = G.el('div', 'ttl__btns');
  const start = G.el('button', 'cbtn cbtn--big cbtn--pulse', (has ? '▶ ' : '🍒 ') + G.esc(has ? M.continueButton : M.startButton));
  start.onclick = e => { G.sfx.ok(); G.fx.over('heartPop', e.currentTarget, { scale: 1.6 }); G.go('world'); };
  btns.appendChild(start);
  if (done) {
    const fin = G.el('button', 'cbtn cbtn--gold', '🎂 ' + G.esc(M.finaleButton));
    fin.onclick = () => { G.sfx.ok(); G.go('finale'); };
    btns.appendChild(fin);
  }
  if (has) {
    const again = G.el('button', 'cbtn cbtn--ghost cbtn--small', G.esc(M.newGameButton));
    again.onclick = () => {
      if (!confirm('Начать игру заново? Прогресс и рекорды сотрутся.')) return;
      G.resetProgress(); G.go('world', { reset: true });
    };
    btns.appendChild(again);
  }
  card.appendChild(btns);
  titleRoot.appendChild(card);

  // девочки выглядывают снизу
  const row = G.el('div', 'ttl__girls');
  (M.girls || []).forEach((src, i) => {
    const im = new Image();
    im.className = 'px'; im.alt = ''; im.draggable = false;
    im.onload = () => { im.style.width = im.naturalWidth * (M.girlScale || 3) + 'px'; };   // пиксель-арт — целое увеличение
    im.src = G.asset(src);
    im.style.animationDelay = (i * .25) + 's';
    row.appendChild(im);
  });
  titleRoot.appendChild(row);

  titleRoot.appendChild(G.el('p', 'ttl__ctrl', G.esc(M.controls)));

  const snd = G.el('button', 'hud-btn ttl__snd', G.soundOn ? '🔔' : '🔕');
  snd.title = 'Звук';
  snd.onclick = () => { G.soundOn = !G.soundOn; G.writeLS('cherry.sound', G.soundOn); snd.textContent = G.soundOn ? '🔔' : '🔕'; G.sfx.tap(); };
  titleRoot.appendChild(snd);
}
G.scenes.title = {
  root: titleRoot,
  enter() { renderTitle(); G.music(G.cfg.meta.music); document.title = G.cfg.meta.title + ' 🍒'; },
  refresh: renderTitle,
  key(e) { if (G.isAction(e)) titleRoot.querySelector('.cbtn')?.click(); },
  editRoots: () => [{ path: 'meta', label: 'Заставка' }, { path: 'fx', label: 'Эффекты (атласы Arcadia)' }]
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
  if (a === 'room' || a === 'world') return G.go('world', b ? { room: b, at: 'npc' } : {});
  if (a === 'kitchen') return G.go('kitchen', { step: +b || 0 });
  if (a === 'cutscene') return G.go('cutscene', { path: `world.rooms.${b}.cutscene`, next: () => G.go('world', { room: b }) });
  return G.go(G.scenes[a] ? a : 'title');
};

/* ---------------- свежая ли версия? ---------------- */
/** GitHub Pages разрешает браузеру держать страницу в кэше до 10 минут. Спрашиваем сервер напрямую:
    если там уже новая сборка — перезагружаемся на неё (адрес с ?v=… браузер из кэша не возьмёт). */
async function selfUpdate() {
  try {
    const html = await (await fetch('index.html?t=' + Date.now(), { cache: 'no-store' })).text();
    const m = /window\.BUILD = '([^']+)'/.exec(html);
    if (!m || m[1] === window.BUILD) return false;
    const u = new URL(location.href);
    if (u.searchParams.get('v') === m[1]) return false;
    u.searchParams.set('v', m[1]);
    location.replace(u.href);
    return true;
  } catch { return false; }
}

/* ---------------- запуск ---------------- */
(async () => {
  const boot = $('#boot');
  if (await selfUpdate()) return;
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
