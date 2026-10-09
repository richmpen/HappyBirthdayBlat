/* ============================================================
   main.js — главное меню, катсцены и запуск игры
   ------------------------------------------------------------
   Главное меню собрано из слоёв макета «общий визуал/начало главное
   меню/» (сжатые копии — assets/menu/). Всё внутри .art — в пикселях
   макета (meta.art.w × meta.art.h = 3492×1640), слой растягивается
   на экран. Точка картинки — низ-центр, как везде в игре.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$, esc = G.esc;

/* ---------------- макет на экране ---------------- */
/** слой в координатах макета: вписан по ширине в экран 960×540, сверху и снизу — полосы рамки */
G.artStage = (root, A, cls) => {
  const k = G.VW / A.w, top = (G.VH - A.h * k) / 2;
  const art = G.el('div', 'art ' + (cls || ''));
  art.style.width = A.w + 'px'; art.style.height = A.h + 'px';
  art.style.transform = `translate(0, ${top}px) scale(${k})`;
  art.dataset.unit = k;
  if (top > 0 && A.edgeTop) {
    const t = G.el('div', 'art-bar art-bar--t'), b = G.el('div', 'art-bar art-bar--b');
    t.style.height = b.style.height = Math.ceil(top) + 1 + 'px';
    t.style.backgroundImage = `url("${G.asset(A.edgeTop)}")`;
    b.style.backgroundImage = `url("${G.asset(A.edgeBottom || A.edgeTop)}")`;
    root.append(t, b);
  }
  root.appendChild(art);
  return art;
};
/** картинка макета: o = { img, x, y, w } (x, y — низ-центр). Анимация — на внутренней картинке */
G.artPiece = (o, path, cls = '') => {
  const d = G.el('div', 'ent art-p ' + cls);
  const im = new Image();
  im.alt = ''; im.draggable = false; im.decoding = 'async';
  im.src = G.asset(o.img);
  d.appendChild(im);
  G.place(d, o);
  if (o.alpha != null) im.style.opacity = o.alpha;
  if (o.anim) im.classList.add('anim-' + o.anim);
  if (o.phase) im.style.animationDelay = -o.phase + 's';
  if (path) d.dataset.edit = path;
  return d;
};
/** точка по центру: искорки, огоньки, круглые кнопки */
G.artDot = (o, path, cls = '') => {
  const d = G.el('div', 'art-dot ' + cls);
  d.style.left = o.x + 'px'; d.style.top = o.y + 'px';
  if (o.w != null) d.style.width = o.w + 'px';
  d._o = o;
  if (path) d.dataset.edit = path;
  return d;
};
/** живой огонёк свечи (рисуется CSS, без картинок): x, y — основание пламени */
G.flame = (o, path, cls = '') => {
  const f = G.artDot(o, path, 'flame ' + cls);
  f.style.width = (o.w || 40) + 'px';
  f.innerHTML = '<i class="flame__glow"></i><i class="flame__body"><b></b></i>';
  if (o.phase) f.style.setProperty('--ph', -o.phase + 's');
  return f;
};

/* ---------------- главное меню ---------------- */
const titleRoot = $('#sc-title');
let tSel = 0, hintT = 0;

function titleButtons() {
  const M = G.cfg.meta, done = G.allDone(), has = G.hasProgress();
  const list = [];
  list.push({ dark: true, icon: 'play', text: has ? M.continueButton : M.startButton,
    go: e => { G.sfx.ok(); G.fx.over('heartPop', e.currentTarget, { scale: 1.6 }); G.go('world'); } });
  if (done) list.push({ icon: 'cherry', text: M.finaleButton, go: () => { G.sfx.ok(); G.go('finale'); } });
  if (has) list.push({ text: M.newGameButton, go: () => {
    if (!confirm('Начать игру заново? Прогресс и рекорды сотрутся.')) return;
    G.resetProgress(); G.go('world', { reset: true });
  } });
  return list;
}

function soundIcon(btn) {
  btn.classList.toggle('is-off', !G.soundOn);
  btn.title = G.soundOn ? 'Звук включён' : 'Звук выключен';
}

function renderTitle() {
  const M = G.cfg.meta, A = M.art;
  clearInterval(hintT);
  titleRoot.innerHTML = '';
  titleRoot.style.background = A.color || '';
  const art = G.artStage(titleRoot, A, 'ttl');

  // звёздочки на фоне — мигают по очереди
  (A.stars || []).forEach((s, i) => {
    const d = G.artDot(s, `meta.art.stars.${i}`, 'ttl-star');
    d.style.setProperty('--d', (-(i * 0.73) % 3.4).toFixed(2) + 's');
    d.style.setProperty('--t', (2.2 + (i * 0.37) % 1.8).toFixed(2) + 's');
    d.innerHTML = `<img src="${G.asset(A.sparkleImg)}" alt="" draggable="false">`;
    art.appendChild(d);
  });

  A.layers.forEach((o, i) => {
    const p = G.artPiece(o, `meta.art.layers.${i}`, 'ttl-l ttl-l--' + (o.name || i));
    p.style.setProperty('--in', (o.inDelay ?? i * .04) + 's');
    if (o.enter) p.classList.add('in-' + o.enter);
    art.appendChild(p);
    if (o.name === 'cake') (A.candles || []).forEach((c, j) => art.appendChild(G.flame({ ...c, phase: j * .37 }, `meta.art.candles.${j}`, 'ttl-flame')));
  });

  // большие искорки из макета
  (A.sparkles || []).forEach((s, i) => {
    const d = G.artDot(s, `meta.art.sparkles.${i}`, 'ttl-spark');
    d.style.setProperty('--d', (-(i * 1.13) % 2.6).toFixed(2) + 's');
    d.innerHTML = `<img src="${G.asset(A.sparkleImg)}" alt="" draggable="false">`;
    art.appendChild(d);
  });

  // подсказка управления: фразы сменяют друг друга
  const pill = G.artDot(A.pill, 'meta.art.pill', 'ttl-pill in-up');
  pill.innerHTML = `<img src="${G.asset(A.pill.img)}" alt="" draggable="false"><span></span>`;
  art.appendChild(pill);
  const hints = (M.hints || []).filter(Boolean), span = pill.querySelector('span');
  let hi = 0;
  span.textContent = hints[0] || '';
  if (hints.length > 1) hintT = setInterval(() => {
    span.classList.add('is-out');
    setTimeout(() => { hi = (hi + 1) % hints.length; span.textContent = hints[hi]; span.classList.remove('is-out'); }, 380);
  }, 3600);

  // кнопки
  const B = A.buttons, list = titleButtons();
  const col = G.el('div', 'ttl-btns');
  const bh = B.h || 198, total = list.length * bh + (list.length - 1) * (B.gap ?? 29);
  col.style.left = B.x + 'px'; col.style.top = (B.y - total / 2) + 'px'; col.style.width = (B.w || 660) + 'px';
  col.style.gap = (B.gap ?? 29) + 'px';
  col.dataset.edit = 'meta.art.buttons';
  tSel = Math.min(tSel, list.length - 1);
  list.forEach((b, i) => {
    const el = G.el('button', 'mbtn ' + (b.dark ? 'mbtn--dark' : 'mbtn--light') + (i === tSel ? ' is-sel' : ''));
    el.style.setProperty('--in', (.55 + i * .1) + 's');
    el.style.backgroundImage = `url("${G.asset(b.dark ? A.btnDark : A.btnLight)}")`;
    const icon = b.icon === 'play' ? `<img class="mbtn__i mbtn__i--play" src="${G.asset(A.playImg)}" alt="">`
      : b.icon === 'cherry' ? `<img class="mbtn__i mbtn__i--cherry" src="${G.asset(A.cherryImg)}" alt="">` : '';
    el.innerHTML = `<span>${icon}<b>${esc(b.text)}</b></span>`;
    el.onclick = e => { if (G.busy) return; b.go(e); };
    el.onpointerenter = () => { tSel = i; markSel(); };
    col.appendChild(el);
  });
  art.appendChild(col);

  // круглые кнопки-цветочки: галерея и звук
  const round = (o, path, cls, inner, title, fn) => {
    const r = G.artDot(o, path, 'mround ' + cls);
    r.innerHTML = `<button type="button" title="${esc(title)}"><img class="mround__bg" src="${G.asset(A.flower)}" alt="">${inner}</button>`;
    r.querySelector('button').onclick = fn;
    art.appendChild(r);
    return r.querySelector('button');
  };
  round(A.gallery, 'meta.art.gallery', 'mround--gal', `${G.galleryIcon}<em>${esc(M.galleryButton || 'Галерея')}</em>`, M.galleryButton || 'Галерея',
    () => { G.sfx.tap(); G.gallery.show(); });
  const snd = round(A.bell, 'meta.art.bell', 'mround--snd', `<img class="mround__bell" src="${G.asset(A.bellImg)}" alt=""><i class="mround__x"></i>`, 'Звук', () => {
    G.setSound(!G.soundOn); soundIcon(snd); G.sfx.tap();
    if (G.soundOn) { snd.classList.remove('is-ring'); void snd.offsetWidth; snd.classList.add('is-ring'); }
  });
  soundIcon(snd);

  const frame = G.el('img', 'ttl-frame');
  frame.src = G.asset(A.frame); frame.alt = ''; frame.draggable = false;
  art.appendChild(frame);

  // появление: всё выезжает по очереди
  requestAnimationFrame(() => requestAnimationFrame(() => titleRoot.classList.add('is-in')));
}
function markSel() {
  titleRoot.querySelectorAll('.mbtn').forEach((b, i) => b.classList.toggle('is-sel', i === tSel));
}
G.scenes.title = {
  root: titleRoot,
  enter() {
    titleRoot.classList.remove('is-in');
    tSel = 0;
    renderTitle(); G.music(G.cfg.meta.music || ''); document.title = G.cfg.meta.title + ' 🍒';
  },
  leave() { clearInterval(hintT); },
  refresh() { renderTitle(); titleRoot.classList.add('is-in'); },
  key(e) {
    const bs = titleRoot.querySelectorAll('.mbtn');
    if (!bs.length) return;
    if (['ArrowUp', 'KeyW'].includes(e.code)) { tSel = (tSel + bs.length - 1) % bs.length; markSel(); G.sfx.tap(); }
    if (['ArrowDown', 'KeyS'].includes(e.code)) { tSel = (tSel + 1) % bs.length; markSel(); G.sfx.tap(); }
    if (G.isAction(e)) bs[tSel]?.click();
  },
  editRoots: () => [{ path: 'meta', label: 'Главное меню' }, { path: 'music', label: 'Музыка игры' }, { path: 'gallery', label: 'Галерея' }]
};

/* ---------------- катсцена: видео (по кругу) или картинка ---------------- */
const cutRoot = $('#sc-cutscene');
let cut = { path: '', next: null, ready: false, t: 0 };
function renderCut() {
  const c = G.get(cut.path) || {};
  cutRoot.innerHTML = '';
  if (c.video) {
    const v = document.createElement('video');
    v.className = 'cut__video';
    v.src = G.asset(c.video);
    if (c.img) v.poster = G.asset(c.img);
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    cutRoot.appendChild(v);
    v.play().catch(() => {});
  } else if (c.img) {
    const im = new Image();
    im.className = 'cut__img px'; im.alt = ''; im.draggable = false;
    im.src = G.asset(c.img);
    cutRoot.appendChild(im);
  }
  if (c.text) cutRoot.appendChild(G.el('div', 'cut__text', esc(c.text)));
  cutRoot.appendChild(G.el('div', 'cut__hint' + (cut.ready ? ' is-on' : ''), esc(G.cfg.texts.cutsceneContinue)));
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
  leave() { cutRoot.querySelector('video')?.pause(); },
  refresh: renderCut,
  onPause(on) { const v = cutRoot.querySelector('video'); if (v) on ? v.pause() : v.play().catch(() => {}); },
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
  if (a === 'gallery') { G.go('title').then(() => G.gallery.show()); return; }
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
    boot.innerHTML = 'Не получилось загрузить игру 😢<br><small>' + esc(e.message) +
      '<br>Если открываешь с компьютера — запусти start.bat, а не index.html напрямую.</small>';
    return;
  }
  G.editor.init();
  G.gallery.init();
  G.start();
  // шрифты меню — до показа, чтобы надписи не прыгали
  await Promise.race([Promise.all(['60px Gooseberry', '60px "Bryndan Write"'].map(f => document.fonts?.load(f).catch(() => {}))), G.sleep(1500)]);
  boot.remove();
  await G.jump(new URLSearchParams(location.search).get('scene') || 'title');
})();

})();
