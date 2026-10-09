/* ============================================================
   gallery.js — галерея: катсцены, арт начала и концовки
   ------------------------------------------------------------
   Открывается кнопкой-цветочком из любого места игры (и из меню).
   Карточка открывается, когда игрок до неё дошёл (unlock):
     ''        — сразу,             'all'    — пройдены все комнаты,
     'kitchen' / 'dressup' / 'rhythm' — пройдена эта комната,
     'finale'  — начался праздник,  'wish'   — свечка задута.
   Пока галерея открыта, игра стоит на паузе.
   Настройки — data/game.json → gallery.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$, esc = G.esc;

G.galleryIcon = `<svg class="gal-ico" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <rect x="6" y="9" width="36" height="30" rx="6"/><path d="M8 34l10-10 8 8 5-5 9 9"/><circle cx="31" cy="19" r="3.4" fill="currentColor" stroke="none"/></g></svg>`;

let box = null, btn = null, view = -1, list = [];
const C = () => G.cfg.gallery;

function unlocked(it) {
  const u = it.unlock || '';
  if (!u || G.progress.unlockAll) return true;
  if (u === 'all') return G.allDone();
  if (u === 'finale') return !!G.progress.finale;
  if (u === 'wish') return !!G.progress.wish;
  return G.isDone(u);
}

function card(it, i) {
  const open = unlocked(it);
  const c = G.el('button', 'gcard' + (open ? '' : ' is-locked') + (it.video ? ' is-video' : ''));
  c.type = 'button';
  c.style.setProperty('--r', ((i * 37 % 7) - 3) * .55 + 'deg');
  c.style.setProperty('--i', i);
  const pic = open
    ? `<img class="${it.pixel ? 'px' : ''}" src="${G.asset(it.thumb || it.img)}" alt="" loading="lazy" draggable="false">${it.video ? '<i class="gcard__play"></i>' : ''}`
    : `<span class="gcard__lock"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><rect x="10" y="21" width="28" height="21" rx="6" fill="currentColor"/><circle cx="24" cy="30.5" r="3" fill="#fcf2eb"/></svg><small>${esc(it.hint || C().locked)}</small></span>`;
  c.innerHTML = `<span class="gcard__pic">${pic}</span><b class="gcard__name">${esc(open ? it.name : '???')}</b>`;
  c.onclick = () => { if (!open) { G.sfx.bad(); c.classList.remove('is-shake'); void c.offsetWidth; c.classList.add('is-shake'); return; } G.sfx.tap(); openView(i); };
  return c;
}

function render() {
  const g = C();
  list = g.items;
  const n = list.filter(unlocked).length;
  box.innerHTML = `
    <div class="gal__frame">
      <img class="gal__garland gal__garland--l" src="${G.asset(g.garlandLeft)}" alt="">
      <img class="gal__garland gal__garland--r" src="${G.asset(g.garlandRight)}" alt="">
      <header class="gal__head">
        <h2 class="gal__title">${esc(g.title)}</h2>
        <p class="gal__sub">${esc(g.subtitle)} · <b>${n}</b> / ${list.length}</p>
      </header>
      <div class="gal__grid"></div>
      <button class="gal__close mflower" type="button" title="${esc(g.close)}"><img src="${G.asset(G.cfg.meta.art.flower)}" alt=""><i>✕</i></button>
      <div class="gal__stars"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="gview" hidden>
      <div class="gview__back"></div>
      <figure class="gview__fig"><div class="gview__media"></div><figcaption><b></b><span></span></figcaption></figure>
      <button class="gview__nav gview__nav--prev mflower" type="button" title="Назад"><img src="${G.asset(G.cfg.meta.art.flower)}" alt=""><i>‹</i></button>
      <button class="gview__nav gview__nav--next mflower" type="button" title="Дальше"><img src="${G.asset(G.cfg.meta.art.flower)}" alt=""><i>›</i></button>
      <button class="gview__x mflower" type="button" title="${esc(g.close)}"><img src="${G.asset(G.cfg.meta.art.flower)}" alt=""><i>✕</i></button>
    </div>`;
  const grid = box.querySelector('.gal__grid');
  list.forEach((it, i) => grid.appendChild(card(it, i)));
  box.querySelector('.gal__close').onclick = () => api.close();
  box.querySelector('.gview__back').onclick = closeView;
  box.querySelector('.gview__x').onclick = closeView;
  box.querySelector('.gview__nav--prev').onclick = () => step(-1);
  box.querySelector('.gview__nav--next').onclick = () => step(1);
  box.querySelector('.gal__frame').addEventListener('click', e => { if (e.target === e.currentTarget) api.close(); });
}

/* ---------------- просмотр одной карточки ---------------- */
const openIdx = () => list.map((it, i) => unlocked(it) ? i : -1).filter(i => i >= 0);
function openView(i) {
  view = i;
  const it = list[i], v = box.querySelector('.gview'), m = v.querySelector('.gview__media');
  m.querySelector('video')?.pause();
  m.innerHTML = '';
  if (it.video) {
    const vid = document.createElement('video');
    vid.src = G.asset(it.video); vid.poster = G.asset(it.img || it.thumb || '');
    vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
    vid.setAttribute('playsinline', ''); vid.setAttribute('muted', '');
    m.appendChild(vid);
    vid.play().catch(() => {});
  } else {
    const im = new Image();
    im.src = G.asset(it.img); im.alt = it.name || ''; im.draggable = false;
    if (it.pixel) im.className = 'px';
    m.appendChild(im);
  }
  v.querySelector('figcaption b').textContent = it.name || '';
  v.querySelector('figcaption span').textContent = it.text || '';
  const ids = openIdx(), k = ids.indexOf(i);
  v.querySelector('.gview__nav--prev').hidden = ids.length < 2;
  v.querySelector('.gview__nav--next').hidden = ids.length < 2;
  v.querySelector('.gview__fig').dataset.n = `${k + 1} / ${ids.length}`;
  if (v.hidden) { v.hidden = false; v.classList.remove('is-in'); void v.offsetWidth; }
  v.classList.add('is-in');
  const fig = v.querySelector('.gview__fig');
  fig.classList.remove('is-flip'); void fig.offsetWidth; fig.classList.add('is-flip');
}
function closeView() {
  const v = box.querySelector('.gview');
  v.querySelector('video')?.pause();
  v.hidden = true; view = -1;
  G.sfx.tap();
}
function step(d) {
  const ids = openIdx();
  if (ids.length < 2) return;
  const k = (ids.indexOf(view) + d + ids.length) % ids.length;
  G.sfx.tap();
  openView(ids[k]);
}

/* ---------------- внешний интерфейс ---------------- */
const api = G.gallery = G.overlay = {
  open: false,
  init() {
    box = G.el('div', 'gal'); box.id = 'gallery'; box.hidden = true;
    document.body.appendChild(box);
    btn = G.el('button', 'gal-btn mflower');
    btn.type = 'button';
    btn.innerHTML = `<img src="${G.asset(G.cfg.meta.art.flower)}" alt="">${G.galleryIcon}<em>${esc(C().button)}</em>`;
    btn.title = C().button;
    btn.onclick = () => { G.sfx.tap(); api.show(); };
    document.body.appendChild(btn);
  },
  show() {
    if (api.open || G.editing || !box) return;
    api.open = true;
    G.keys.clear();
    G.scene?.onPause?.(true);
    render();
    box.hidden = false;
    document.body.classList.add('gal-open');
    requestAnimationFrame(() => box.classList.add('is-in'));
  },
  close(instant) {
    if (!api.open) return;
    api.open = false;
    box.querySelector('video')?.pause();
    box.classList.remove('is-in');
    document.body.classList.remove('gal-open');
    const done = () => { if (!api.open) { box.hidden = true; box.innerHTML = ''; } };
    if (instant) done(); else setTimeout(done, 260);
    if (!instant) G.sfx.tap();
    G.scene?.onPause?.(false);
  },
  key(e) {
    if (e.repeat) return;
    const inView = view >= 0 && !box.querySelector('.gview').hidden;
    if (e.code === 'Escape') { inView ? closeView() : api.close(); return; }
    if (inView && ['ArrowLeft', 'KeyA'].includes(e.code)) step(-1);
    if (inView && ['ArrowRight', 'KeyD'].includes(e.code)) step(1);
  }
};

})();
