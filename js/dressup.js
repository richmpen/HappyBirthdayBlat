/* ============================================================
   dressup.js — мини-игра «Одевашка» (порт CottsugDRESSUP)
   ------------------------------------------------------------
   1) Единая система координат = размер тела (dressup.base.w × h).
      Любой объект описывается ЦЕНТРОМ (x, y) + масштабом s +
      поворотом r + зеркалом f + слоем z.
   2) По умолчанию все картинки одного размера с телом и просто
      накладываются друг на друга: центр = центр тела, масштаб 1.
      В dressup.layout попадают только вещи, которые подвинули
      в редакторе (F10).
   3) Тело — слой "base/0". Вещи с z меньше, чем у тела, уходят ПОД него.
   4) Сколько вещей категории можно надеть разом — categories[].limit
      (верх = 2, аксессуары = 99 → хоть все сразу).
   ============================================================ */
(() => {
'use strict';
const G = window.G;
const root = G.$('#sc-dressup');
const $  = (s, r = root) => r.querySelector(s);
const $$ = (s, r = root) => [...r.querySelectorAll(s)];
const { clamp, round, rnd } = G;

const calm  = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const phone = () => matchMedia('(max-width:760px)').matches || matchMedia('(hover:none)').matches;
const noFx  = () => calm() || phone();

/* ---------------- данные (всегда свежие из конфига) ---------------- */
const D      = () => G.cfg.dressup;
const BASE   = () => D().base;
const CATS   = () => D().categories;
const ITEMS  = cat => D().items[cat] || [];
const LAYOUT = () => (D().layout ||= {});
const BASE_CAT = () => ({ id: 'base', name: BASE().name || 'Тело', emoji: '🧍', z: 0, limit: 1 });
const catOf  = id => id === 'base' ? BASE_CAT() : CATS().find(c => c.id === id);

const isBase = cat => cat === 'base';
const meta   = (cat, n) => isBase(cat) ? { n: 0, w: BASE().w, h: BASE().h, src: BASE().src, thumb: BASE().thumb } : ITEMS(cat).find(i => i.n === n);
const key    = (cat, n) => `${cat}/${n}`;
const bigSrc = (cat, n) => meta(cat, n)?.src || '';
const thumbSrc = (cat, n) => { const m = meta(cat, n); return m?.thumb || m?.src || ''; };

/** позиция «как нарисовано»: по центру тела, в размер тела */
function defPos(cat, n) {
  const B = BASE(), m = meta(cat, n) || { w: B.w, h: B.h };
  const sameShape = Math.abs(m.w / m.h - B.w / B.h) < .02;
  return { x: B.w / 2, y: B.h / 2, s: sameShape ? round(B.w / m.w, 4) : 1, r: 0, f: 1,
           z: isBase(cat) ? 0 : (m.z ?? catOf(cat)?.z ?? 0), ts: 1, tx: 0, ty: 0, tr: 0 };
}
/** позиция для чтения */
function pos(cat, n) {
  const p = LAYOUT()[key(cat, n)];
  return p ? Object.assign(defPos(cat, n), p) : defPos(cat, n);
}
/** позиция для правки — запись появляется в dressup.layout */
function epos(cat, n) {
  const L = LAYOUT(), k = key(cat, n);
  L[k] = Object.assign(defPos(cat, n), L[k] || {});
  return L[k];
}

/* ---------------- состояние ---------------- */
const limitOf = cat => Math.max(1, catOf(cat)?.limit || 1);

function normWorn(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([cat, v]) => {
    if (!D().items[cat]) return;
    const arr = (Array.isArray(v) ? v : [v]).filter(n => ITEMS(cat).some(i => i.n === n));
    if (arr.length) out[cat] = arr.slice(-limitOf(cat));
  });
  return out;
}

let worn = {};
let betaOn = false;
let picked = null;
let activeTab = '';
let dim = 1;
let inited = false;

const layerEls  = new Map();
const alphaMaps = new Map();

const onStage = () => [{ cat: 'base', n: 0 },
  ...CATS().flatMap(c => (worn[c.id] || []).map(n => ({ cat: c.id, n })))];
const isWorn = (cat, n) => (worn[cat] || []).includes(n);
const saveOutfit = () => { G.progress.outfit = worn; G.saveProgress(); };

/* ---------------- DOM ---------------- */
const app     = $('#app');
const stage   = $('#stage');
const inner   = $('#stageInner');
const baseImg = $('#baseImg');
const guides  = $('#guides');
const shelf   = $('#shelf');
const tabsEl  = $('#tabs');
const wornEl  = $('#worn');
const toastEl = $('#toast');
const loader  = $('#loader');

/* ---------------- звук ---------------- */
const sndOn  = () => { G.blip(760, .09, 'sine', .05); setTimeout(() => G.blip(1020, .1, 'sine', .05), 55); };
const sndOff = () => G.blip(520, .08, 'triangle', .05);
const sndTap = () => G.blip(880, .05, 'sine', .035);
const sndWow = () => { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => G.blip(f, .09, 'sine', .04), i * 70)); };

/* ============================================================
   РАЗМЕР СЦЕНЫ — держим точные пропорции тела
   ============================================================ */
function fitStage() {
  // Рамка облегает персонажа: пустые поля картинки сверху и снизу (dressup.fit) в рамку не входят.
  // Сама сцена остаётся в размер тела — позиции вещей от этого не меняются.
  if (!G.cfg) return;
  const doll = $('.doll'), card = stage.parentElement, fit = D().fit || {};
  const top = clamp(fit.cropTop ?? 0, 0, .4), bottom = clamp(fit.cropBottom ?? 1, top + .3, 1), v = bottom - top;
  const cs = getComputedStyle(doll), PAD = 13, side = fit.sideMargin ?? 60;
  const wornH = wornEl.offsetHeight ? wornEl.offsetHeight + 10 : 0;
  const availH = doll.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - wornH;
  const availW = doll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (availW <= 0 || availH <= 60) return;
  const ratio = BASE().w / BASE().h;
  let h = (availH - PAD * 2) / v, w = h * ratio;
  if (w + PAD * 2 > availW) { w = availW - PAD * 2; h = w / ratio; }
  const cardW = Math.round(clamp(w + side * 2, 120, availW)), cardH = Math.round(h * v + PAD * 2);
  // персонаж внутри рамки: масштаб (от центра рамки) и сдвиг в процентах от его размера
  const z = clamp(fit.zoom ?? 1, .3, 3);
  stage.style.flex = '0 0 auto';
  stage.style.width = (w * z) + 'px';
  stage.style.height = (h * z) + 'px';
  stage.style.marginTop = (PAD + v * h / 2 - (top + v / 2) * h * z + (fit.y ?? 0) / 100 * h) + 'px';
  stage.style.left = ((fit.x ?? 0) / 100 * w) + 'px';
  card.style.flex = '0 0 auto';
  card.style.maxWidth = 'none';
  card.style.width = cardW + 'px';
  card.style.height = cardH + 'px';
  card.style.setProperty('--arch', (cardW / 2) + 'px');   // радиус = половина ширины → ровная полуокружность
}
new ResizeObserver(fitStage).observe($('.doll'));
addEventListener('orientationchange', () => setTimeout(fitStage, 250));

/* ============================================================
   СЛОИ ПЕРСОНАЖА
   ============================================================ */
function applyPos(el, cat, n) {
  const p = pos(cat, n), m = meta(cat, n), B = BASE();
  el.style.left   = (p.x / B.w * 100) + '%';
  el.style.top    = (p.y / B.h * 100) + '%';
  el.style.width  = (m.w * p.s / B.w * 100) + '%';
  el.style.height = (m.h * p.s / B.h * 100) + '%';
  el.style.zIndex = p.z;
  const tf = `translate(-50%,-50%) rotate(${p.r}deg) scaleX(${p.f})`;
  el.style.setProperty('--tf', tf);
  el.style.transform = tf;
  el.style.opacity = (dim < 1 && !isBase(cat)) ? dim : '';
}

let pending = 0;
function setLoading(on) {
  pending = Math.max(0, pending + (on ? 1 : -1));
  loader.classList.toggle('is-on', pending > 0);
}

function makeLayer(cat, n, fresh) {
  const img = new Image();
  img.className = 'layer' + (fresh ? ' is-new' : '');
  img.draggable = false;
  img.decoding = 'async';
  img.alt = `${catOf(cat).name} №${n}`;
  img.dataset.cat = cat; img.dataset.n = n;
  setLoading(true);
  img.onload = () => {
    setLoading(false);
    // страховка: если размеры файла разошлись с записанными в конфиге,
    // высоту берём из настоящих пропорций картинки
    if (img.naturalWidth && img.naturalHeight) {
      const q = pos(cat, n), mm = meta(cat, n);
      if (!mm) return;
      const real = mm.w * q.s * (img.naturalHeight / img.naturalWidth) / BASE().h * 100;
      const now  = mm.h * q.s / BASE().h * 100;
      if (Math.abs(real - now) > now * 0.005) img.style.height = real + '%';
    }
  };
  img.onerror = () => { setLoading(false); toast('Не нашлось: ' + bigSrc(cat, n)); };
  img.src = G.asset(bigSrc(cat, n));
  applyPos(img, cat, n);
  inner.appendChild(img);
  layerEls.set(key(cat, n), img);
  return img;
}

function dropLayer(cat, n) {
  const el = layerEls.get(key(cat, n));
  if (el) {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
    layerEls.delete(key(cat, n));
  }
  if (picked && picked.cat === cat && picked.n === n) pick(null);
}

function wear(cat, n, { silent = false } = {}) {
  const list = [...(worn[cat] || [])];

  if (n == null) {                      // «снять» — чистим всю категорию
    list.forEach(x => dropLayer(cat, x));
    delete worn[cat];
    if (!silent && list.length) sndOff();

  } else if (list.includes(n)) {        // повторный клик — снимаем именно её
    dropLayer(cat, n);
    list.splice(list.indexOf(n), 1);
    if (list.length) worn[cat] = list; else delete worn[cat];
    if (!silent) sndOff();

  } else {                              // надеваем
    list.push(n);
    while (list.length > limitOf(cat)) dropLayer(cat, list.shift());
    worn[cat] = list;
    makeLayer(cat, n, true);
    if (!silent) { sndOn(); burst(); }
  }

  saveOutfit();
  paintShelf(); paintWorn();
}

function rebuildAll() {
  [...layerEls.entries()].forEach(([k, el]) => { if (k !== 'base/0') el.remove(); });
  layerEls.clear();
  alphaMaps.clear();
  layerEls.set('base/0', baseImg);
  const src = G.asset(BASE().src);
  if (baseImg.dataset.src !== src) { baseImg.dataset.src = src; baseImg.src = src; }
  applyPos(baseImg, 'base', 0);
  CATS().forEach(c => (worn[c.id] || []).forEach(n => makeLayer(c.id, n, false)));
  paintShelf(); paintWorn();
}

/* ============================================================
   ЭФФЕКТЫ — атласы Arcadia Effector (см. data/game.json → fx)
   ============================================================ */
function burst() {
  if (calm()) return;
  const r = stage.getBoundingClientRect();
  G.fx.screen('heartPop', r.left + r.width * rnd(.3, .7), r.top + r.height * rnd(.3, .6), { scale: Math.max(1.2, r.height / 380) });
}

function sparkleAt(cx, cy) {
  if (calm() || !cx) return;
  G.fx.screen('heartPop', cx, cy, { scale: .6 });
}

function berryRain() {
  if (calm()) return;
  G.fx.screen('confetti', innerWidth / 2, innerHeight / 2, { scale: Math.max(1.6, innerWidth / 560) });
}

/* ============================================================
   ГАРДЕРОБ
   ============================================================ */
function buildTabs() {
  if (!catOf(activeTab) || isBase(activeTab)) activeTab = CATS()[0].id;
  tabsEl.innerHTML = '';
  CATS().forEach(c => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.cat = c.id;
    b.innerHTML = `<span>${G.esc(c.emoji)}</span>${G.esc(c.name)}<em>${ITEMS(c.id).length}</em>`;
    b.setAttribute('aria-selected', String(c.id === activeTab));
    b.onclick = e => {
      activeTab = c.id; sndTap();
      sparkleAt(e.clientX, e.clientY);
      buildTabs(); paintShelf(true);
      G.editor?.toolsChanged();
    };
    tabsEl.appendChild(b);
  });
}

function paintShelf(soft) {
  const cat = activeTab;
  const list = ITEMS(cat);
  if (soft || shelf.dataset.cat !== cat) {
    shelf.dataset.cat = cat;
    shelf.innerHTML = '';

    const none = document.createElement('button');
    none.className = 'card card--none';
    none.type = 'button';
    none.innerHTML = '<b>снять</b>';
    none.onclick = () => wear(cat, null);
    shelf.appendChild(none);

    list.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.dataset.n = it.n;
      b.style.setProperty('--d', Math.min(i * 28, 420) + 'ms');
      applyIconVars(b, cat, it.n);
      const im = new Image();
      im.loading = 'lazy'; im.decoding = 'async';
      im.alt = `${catOf(cat).name} ${it.n}`;
      im.onerror = () => { im.onerror = null; im.src = G.asset(bigSrc(cat, it.n)); };
      im.src = G.asset(thumbSrc(cat, it.n));
      b.appendChild(im);
      b.insertAdjacentHTML('beforeend', `<span class="card__num">${it.n}</span><i class="card__shine"></i>`);
      b.onclick = e => {
        sparkleAt(e.clientX, e.clientY);
        if (betaOn && isWorn(cat, it.n)) { pick({ cat, n: it.n }); return; }
        wear(cat, it.n);
        if (betaOn && isWorn(cat, it.n)) pick({ cat, n: it.n });
      };
      shelf.appendChild(b);
    });
  }
  $$('.card', shelf).forEach(c => {
    if (!c.dataset.n) return;
    const n = +c.dataset.n;
    c.classList.toggle('is-on', isWorn(cat, n));
    applyIconVars(c, cat, n);
  });
  const lim = limitOf(cat);
  const cnt = (worn[cat] || []).length;
  $('#wardrobeCount').textContent = `· надето ${onStage().length - 1}` +
    (lim > 1 ? ` · здесь ${cnt} из ${lim >= 99 ? ITEMS(cat).length : lim}` : '');
}

function paintWorn() {
  wornEl.innerHTML = '';
  const list = betaOn ? onStage() : onStage().filter(o => o.cat !== 'base');
  list.forEach(({ cat, n }) => {
    const c = catOf(cat);
    const chip = document.createElement('button');
    chip.className = 'worn__chip' + (isBase(cat) ? ' worn__chip--base' : '');
    chip.type = 'button';
    chip.title = betaOn ? 'Взять для настройки' : 'Снять';
    if (!isBase(cat)) applyIconVars(chip, cat, n);
    chip.innerHTML =
      `<img src="${G.asset(thumbSrc(cat, n))}" alt="" onerror="this.style.display='none'">` +
      `<span>${G.esc(c.name)}${isBase(cat) ? '' : ' ' + n}</span><i>${betaOn ? '✎' : '✕'}</i>`;
    chip.onclick = () => betaOn ? pick({ cat, n }) : wear(cat, n);
    wornEl.appendChild(chip);
  });
}

function applyIconVars(el, cat, n) {
  const p = pos(cat, n);
  el.style.setProperty('--ts', p.ts ?? 1);
  el.style.setProperty('--tx', (p.tx ?? 0) + '%');
  el.style.setProperty('--ty', (p.ty ?? 0) + '%');
  el.style.setProperty('--tr', (p.tr ?? 0) + 'deg');
}

function applyCardSize() {
  shelf.style.setProperty('--card', (D().settings?.cardSize || 100) + 'px');
}

/* ============================================================
   ДЕЙСТВИЯ В ШАПКЕ
   ============================================================ */
function randomize() {
  const next = {};
  CATS().forEach(c => {
    const pool = ITEMS(c.id).map(i => i.n);
    if (!pool.length) return;
    const cap = Math.min(limitOf(c.id), pool.length, c.limit >= 99 ? 3 : 2);
    const take = 1 + ((Math.random() * cap) | 0);
    const bag = [...pool];
    const got = [];
    for (let i = 0; i < take && bag.length; i++)
      got.push(...bag.splice((Math.random() * bag.length) | 0, 1));
    next[c.id] = got;
  });
  // платье и верх+низ вместе выглядят кашей — оставляем что-то одно
  if (next.dress && (next.top || next.bottom)) {
    if (Math.random() < .5) delete next.dress; else { delete next.top; delete next.bottom; }
  }
  worn = next;
  saveOutfit();
  rebuildAll();

  $$('.layer:not(.layer--base)', inner).forEach((el, i) => {
    el.classList.remove('is-new'); void el.offsetWidth;
    el.style.animationDelay = (i * 55) + 'ms';
    el.classList.add('is-new');
  });
  sndWow(); berryRain(); burst(10);
  toast('Новый образ! 🎲');
}

function clearAll() {
  worn = {};
  saveOutfit();
  rebuildAll();
  pick(null);
  sndOff();
  toast('Всё снято 🧺');
}

async function screenshot() {
  const B = BASE();
  const M = Math.round(B.w * .12);
  const cv = $('#shotCanvas');
  cv.width = B.w + M * 2;
  cv.height = B.h + M * 2;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);

  const load = src => new Promise(res => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = G.asset(src);
  });

  const jobs = onStage().map(({ cat, n }) => {
    const p = pos(cat, n), m = meta(cat, n);
    return { z: p.z, src: bigSrc(cat, n), p, w: m.w, h: m.h };
  }).sort((a, b) => a.z - b.z);

  setLoading(true);
  const imgs = await Promise.all(jobs.map(j => load(j.src)));
  setLoading(false);

  jobs.forEach((j, i) => {
    const im = imgs[i]; if (!im) return;
    const w = j.w * j.p.s, h = j.h * j.p.s;
    ctx.save();
    ctx.translate(M + j.p.x, M + j.p.y);
    ctx.rotate((j.p.r || 0) * Math.PI / 180);
    ctx.scale(j.p.f || 1, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  });

  const mark = D().texts.watermark;
  if (mark) {
    ctx.font = `700 ${Math.round(B.w * .04)}px Nunito, sans-serif`;
    ctx.fillStyle = '#c9184a';
    ctx.textAlign = 'right';
    ctx.fillText(mark, cv.width - M / 2, cv.height - M / 3);
  }

  try {
    cv.toBlob(b => {
      if (!b) { toast('Браузер не отдал картинку'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'cherry-look.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Картинка сохранена 📸');
      sndOn(); berryRain(14);
    }, 'image/png');
  } catch {
    toast('Картинку не собрать — открой сайт через start.bat 🍒');
  }
}

function finish() {
  const need = D().minItems || 0;
  const count = onStage().length - 1;
  if (count < need) { toast(G.fmt(D().texts.needMore, { min: need })); sndOff(); return; }
  G.completeRoom('dressup');
}

/* ============================================================
   РЕЖИМ НАСТРОЙКИ (включается вместе с редактором F10)
   ============================================================ */
const F = s => document.querySelector(s);     // поля панели живут в редакторе, вне сцены

function setBeta(on) {
  betaOn = on;
  app.classList.toggle('is-beta', on);
  guides.classList.toggle('is-on', on && (F('#bGuides')?.checked ?? true));
  moveAll = false;                    // сразу двигаются вещи; весь персонаж — переключателем в панели
  if (!on) { pick(null); dim = 1; $$('.layer', inner).forEach(el => el.style.opacity = ''); }
  paintWorn();
  syncFit();
  setTimeout(fitStage, 60);
}

function pick(sel) {
  if (picked) {
    const el = layerEls.get(key(picked.cat, picked.n));
    el && el.classList.remove('is-picked');
  }
  picked = sel;
  if (sel && moveAll) { moveAll = false; }
  if (sel) {
    const el = layerEls.get(key(sel.cat, sel.n));
    el && el.classList.add('is-picked');
    if (!isBase(sel.cat) && activeTab !== sel.cat) { activeTab = sel.cat; buildTabs(); paintShelf(true); }
  }
  syncFields();
  syncFit();
}

function syncFields() {
  if (!F('#betaSel')) return;
  const on = !!picked;
  const c = on ? catOf(picked.cat) : null;
  F('#betaSel').textContent = on
    ? (isBase(picked.cat) ? '🧍 Тело' : `${c.emoji} ${c.name} · №${picked.n}`)
    : '— кликни по вещи на персонаже —';
  ['#fx', '#fy', '#fs', '#fr', '#fz'].forEach(s => F(s).disabled = !on);
  const noIcon = !on || isBase(picked.cat);
  ['#fts', '#ftx', '#fty', '#ftr'].forEach(s => F(s).disabled = noIcon);
  F('#iconEd').classList.toggle('is-off', noIcon);
  ['#bReplaceImg', '#bReplaceIcon', '#bDelItem'].forEach(s => F(s).disabled = noIcon);
  F('#bAddItem').textContent = `➕ Добавить вещи во вкладку «${catOf(activeTab)?.name || ''}»`;
  if (!on) return;
  const p = pos(picked.cat, picked.n);
  F('#fx').value  = round(p.x, 1);
  F('#fy').value  = round(p.y, 1);
  F('#fs').value  = round(p.s, 4);
  F('#fr').value  = round(p.r, 1);
  F('#fz').value  = p.z;
  F('#fts').value = round(p.ts ?? 1, 3);
  F('#ftx').value = round(p.tx ?? 0, 1);
  F('#fty').value = round(p.ty ?? 0, 1);
  F('#ftr').value = round(p.tr ?? 0, 1);
  paintIconPreview();
}

function paintIconPreview() {
  const box = F('#iconBox'), img = F('#iconImg');
  if (!box || !picked || isBase(picked.cat)) return;
  applyIconVars(box, picked.cat, picked.n);
  const src = G.asset(thumbSrc(picked.cat, picked.n));
  if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; }
}

function commit() {
  if (!picked) return;
  const el = layerEls.get(key(picked.cat, picked.n));
  el && applyPos(el, picked.cat, picked.n);
  syncFields();
  G.editor?.changed();
}

const P_ = () => epos(picked.cat, picked.n);
const nudge   = (dx, dy) => { if (!picked) return; const p = P_(); p.x = round(p.x + dx, 1); p.y = round(p.y + dy, 1); commit(); };
const scaleBy = k => { if (!picked) return; const p = P_(); p.s = round(clamp(p.s * k, .03, 6), 4); commit(); };
const rotBy   = d => { if (!picked) return; const p = P_(); p.r = round(p.r + d, 1); commit(); };
const zBy     = d => { if (!picked) return; const p = P_(); p.z = clamp(p.z + d, -99, 999); commit(); };
const flip    = () => { if (!picked) return; const p = P_(); p.f = (p.f || 1) * -1; commit(); };

/* --- альфа-хиттест: клик «сквозь» прозрачные места --- */
function alphaMap(cat, n) {
  const k = key(cat, n);
  if (alphaMaps.has(k)) return alphaMaps.get(k);
  const img = layerEls.get(k);
  if (!img || !img.complete || !img.naturalWidth) return null;
  try {
    const W = 140, H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const a = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3];
    const m = { w: W, h: H, a };
    alphaMaps.set(k, m);
    return m;
  } catch {
    alphaMaps.set(k, 'no');
    return 'no';
  }
}

function hitLayer(cat, n, cxp, cyp) {
  if (!layerEls.get(key(cat, n))) return false;
  const r = stage.getBoundingClientRect();
  const k = r.width / BASE().w;
  const p = pos(cat, n), m = meta(cat, n);

  const bx = (cxp - r.left) / k, by = (cyp - r.top) / k;
  const ux = bx - p.x, uy = by - p.y;
  const a = -(p.r || 0) * Math.PI / 180;
  const rx = ux * Math.cos(a) - uy * Math.sin(a);
  const ry = ux * Math.sin(a) + uy * Math.cos(a);
  const lx = (rx * (p.f || 1)) / p.s + m.w / 2;
  const ly = ry / p.s + m.h / 2;
  if (lx < 0 || ly < 0 || lx > m.w || ly > m.h) return false;

  const map = alphaMap(cat, n);
  if (!map || map === 'no') return true;
  const px = clamp((lx / m.w * map.w) | 0, 0, map.w - 1);
  const py = clamp((ly / m.h * map.h) | 0, 0, map.h - 1);
  return map.a[py * map.w + px] > 24;
}

const layerAt = (cxp, cyp) => onStage()
  .map(o => ({ ...o, z: pos(o.cat, o.n).z }))
  .sort((a, b) => b.z - a.z)
  .find(o => hitLayer(o.cat, o.n, cxp, cyp)) || null;

/* --- перетаскивание / щипок --- */
const ptrs = new Map();
let drag = null;
let moveAll = false;                 // режим «двигать всего персонажа в рамке»
const FIT = () => (D().fit ||= {});

function syncFit() {
  const f = FIT();
  [['#fitX', f.x ?? 0, 1], ['#fitY', f.y ?? 0, 1], ['#fitZ', f.zoom ?? 1, 3], ['#fitT', f.cropTop ?? 0, 3], ['#fitB', f.cropBottom ?? 1, 3], ['#fitS', f.sideMargin ?? 60, 0]]
    .forEach(([q, v, d]) => { const el = F(q); if (el && el !== document.activeElement) el.value = round(v, d); });
  F('#segAll')?.classList.toggle('is-on', moveAll);
  F('#segItem')?.classList.toggle('is-on', !moveAll);
  const note = F('#segNote');
  if (note) note.textContent = moveAll
    ? 'Тяни персонажа прямо в рамке — двигается всё целиком, тело вместе с одеждой. Колесо мыши — крупнее/мельче.'
    : 'Кликни по вещи на персонаже (или в «Надето») и тяни её. Колесо — масштаб вещи, Shift+колесо — поворот. Потом «Сохранить» наверху.';
  stage.classList.toggle('is-moveall', betaOn && moveAll);
}
function fitChanged() { fitStage(); syncFit(); G.editor?.changed(); }

stage.addEventListener('pointerdown', e => {
  if (!betaOn) return;
  if (moveAll) {
    const f = FIT(), r = stage.getBoundingClientRect(), z = clamp(f.zoom ?? 1, .3, 3);
    drag = { mode: 'all', sx: e.clientX, sy: e.clientY, x0: f.x ?? 0, y0: f.y ?? 0, w: r.width / z, h: r.height / z };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (ptrs.size === 1) {
    const hit = layerAt(e.clientX, e.clientY);
    if (hit && (!picked || picked.cat !== hit.cat || picked.n !== hit.n)) pick({ cat: hit.cat, n: hit.n });
    if (!picked) return;
    const p = pos(picked.cat, picked.n);
    drag = { mode: 'move', sx: e.clientX, sy: e.clientY, px: p.x, py: p.y, moved: false };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  } else if (ptrs.size === 2 && picked) {
    const [a, b] = [...ptrs.values()];
    const p = pos(picked.cat, picked.n);
    drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y),
             a0: Math.atan2(b.y - a.y, b.x - a.x), s0: p.s, r0: p.r };
  }
});

stage.addEventListener('pointermove', e => {
  if (betaOn && drag && drag.mode === 'all') {
    const f = FIT();
    f.x = round(drag.x0 + (e.clientX - drag.sx) / drag.w * 100, 1);
    f.y = round(drag.y0 + (e.clientY - drag.sy) / drag.h * 100, 1);
    fitChanged();
    e.preventDefault();
    return;
  }
  if (!betaOn || !drag || !picked || !ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = stage.getBoundingClientRect();
  const k = r.width / BASE().w;

  if (drag.mode === 'move' && ptrs.size === 1) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const p = P_();
    p.x = round(drag.px + (e.clientX - drag.sx) / k, 1);
    p.y = round(drag.py + (e.clientY - drag.sy) / k, 1);
    commit();
  } else if (drag.mode === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const p = P_();
    p.s = round(clamp(drag.s0 * (d / drag.d0), .03, 6), 4);
    p.r = round(drag.r0 + (ang - drag.a0) * 180 / Math.PI, 1);
    commit();
  }
  e.preventDefault();
}, { passive: false });

['pointerup', 'pointercancel'].forEach(ev =>
  stage.addEventListener(ev, e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) drag = null;
    if (ptrs.size === 1 && drag && drag.mode === 'pinch' && picked) {
      const [a] = [...ptrs.values()];
      const p = pos(picked.cat, picked.n);
      drag = { mode: 'move', sx: a.x, sy: a.y, px: p.x, py: p.y, moved: true };
    }
  })
);

stage.addEventListener('wheel', e => {
  if (betaOn && moveAll) {
    e.preventDefault();
    const f = FIT();
    f.zoom = round(clamp((f.zoom ?? 1) * (e.deltaY > 0 ? .97 : 1.03), .3, 3), 3);
    fitChanged();
    return;
  }
  if (!betaOn || !picked) return;
  e.preventDefault();
  if (e.shiftKey) rotBy(e.deltaY > 0 ? 1.5 : -1.5);
  else scaleBy(e.deltaY > 0 ? .975 : 1.025);
}, { passive: false });

/* ============================================================
   ДОБАВЛЕНИЕ / ЗАМЕНА ВЕЩЕЙ (редактор)
   ============================================================ */
const loadFile = file => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im); im.onerror = () => rej(new Error('не картинка: ' + file.name));
  im.src = URL.createObjectURL(file);
});
const toBlob = (cv, type = 'image/webp', q = .9) => new Promise(res => cv.toBlob(b => res(b), type, q));

/** слой одежды: приводим к размеру тела (если пропорции совпали) и жмём в webp */
async function makeLayerFile(file) {
  const im = await loadFile(file), B = BASE();
  let w = im.naturalWidth, h = im.naturalHeight;
  if (Math.abs(w / h - B.w / B.h) < .02) { w = B.w; h = B.h; }
  else { const k = Math.min(1, 1600 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(im, 0, 0, w, h);
  return { blob: await toBlob(cv), w, h, canvas: cv };
}
/** иконка 256×256: из отдельного файла или автоматически — вещь, обрезанная по краям */
async function makeIconFile(src) {
  let cv = src;
  if (src instanceof File) {
    const im = await loadFile(src);
    cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0);
  }
  // рамка непрозрачных пикселей
  const S = 200, sw = S, sh = Math.max(1, Math.round(S * cv.height / cv.width));
  const t = document.createElement('canvas'); t.width = sw; t.height = sh;
  const tx = t.getContext('2d', { willReadFrequently: true });
  tx.drawImage(cv, 0, 0, sw, sh);
  const d = tx.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    if (d[(y * sw + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = sw - 1; y1 = sh - 1; }
  const k = cv.width / sw;
  const bx = x0 * k, by = y0 * k, bw = (x1 - x0 + 1) * k, bh = (y1 - y0 + 1) * k;
  const out = document.createElement('canvas'); out.width = out.height = 256;
  const ox = out.getContext('2d');
  ox.imageSmoothingQuality = 'high';
  const f = 236 / Math.max(bw, bh);
  ox.drawImage(cv, bx, by, bw, bh, (256 - bw * f) / 2, (256 - bh * f) / 2, bw * f, bh * f);
  return toBlob(out);
}
const stamp = () => Date.now().toString(36);

async function addItems(files) {
  const cat = activeTab;
  const list = (D().items[cat] ||= []);
  let added = 0;
  for (const file of files) {
    try {
      const L = await makeLayerFile(file);
      const n = list.reduce((m, i) => Math.max(m, i.n), 0) + 1;
      const id = `${n}-${stamp()}`;
      const src = `assets/dressup/items/${cat}/${id}.webp`;
      const thumb = `assets/dressup/thumbs/${cat}/${id}.webp`;
      G.editor.stash(src, L.blob);
      G.editor.stash(thumb, await makeIconFile(L.canvas));
      list.push({ n, w: L.w, h: L.h, src, thumb });
      if (!isWorn(cat, n)) wear(cat, n, { silent: true });
      pick({ cat, n });
      added++;
    } catch (e) { toast(e.message); }
  }
  if (added) {
    buildTabs(); paintShelf(true); G.editor.changed();
    toast(`Добавлено вещей: ${added}. Не забудь «Сохранить»`);
  }
}

async function replaceImage(file, what) {
  if (!picked) return;
  try {
    const { cat, n } = picked, m = isBase(cat) ? BASE() : meta(cat, n);
    const id = `${isBase(cat) ? 'base' : n}-${stamp()}`;
    if (what === 'icon') {
      const p = `assets/dressup/thumbs/${cat}/${id}.webp`;
      G.editor.stash(p, await makeIconFile(file));
      m.thumb = p;
    } else {
      const L = await makeLayerFile(file);
      const p = isBase(cat) ? `assets/dressup/${id}.webp` : `assets/dressup/items/${cat}/${id}.webp`;
      G.editor.stash(p, L.blob);
      if (isBase(cat)) {
        // тело задаёт систему координат — размеры не трогаем, чтобы вещи не уехали
        m.src = p; m.thumb = p;
      } else { m.src = p; m.w = L.w; m.h = L.h; }
    }
    rebuildAll(); paintShelf(true); pick(picked); G.editor.changed();
    toast('Заменено. Не забудь «Сохранить»');
  } catch (e) { toast(e.message); }
}

function deleteItem() {
  if (!picked || isBase(picked.cat)) return;
  const { cat, n } = picked;
  if (!confirm(`Удалить «${catOf(cat).name} №${n}» из игры?`)) return;
  if (isWorn(cat, n)) wear(cat, n, { silent: true });
  D().items[cat] = ITEMS(cat).filter(i => i.n !== n);
  delete LAYOUT()[key(cat, n)];
  pick(null); buildTabs(); paintShelf(true); G.editor.changed();
  toast('Вещь удалена');
}

/* панель в редакторе */
function editorTools(box) {
  box.innerHTML = `
    <div class="ed__label">Что двигаем мышкой</div>
    <div class="ed__seg">
      <button id="segItem">👗 Вещи по одной</button>
      <button id="segAll">✥ Персонаж целиком</button>
    </div>
    <p class="ed__note" id="segNote"></p>
    <div class="ed__label">Отдельная вещь</div>
    <div class="beta__sel" id="betaSel"></div>
    <p class="ed__note">Вещи одного размера с телом уже стоят правильно — двигать их не обязательно.</p>
    <div class="beta__rows">
      <label class="brow"><span>X</span><input type="number" id="fx" step="1"></label>
      <label class="brow"><span>Y</span><input type="number" id="fy" step="1"></label>
      <label class="brow"><span>Масштаб</span><input type="number" id="fs" step="0.005"></label>
      <label class="brow"><span>Поворот°</span><input type="number" id="fr" step="0.5"></label>
      <label class="brow"><span>Слой (z)</span><input type="number" id="fz" step="1"></label>
    </div>
    <div class="beta__btns">
      <button class="bbtn" id="bZup">▲ Слой выше</button>
      <button class="bbtn" id="bZdn">▼ Слой ниже</button>
      <button class="bbtn" id="bFlip">⇋ Зеркало</button>
      <button class="bbtn" id="bBody">🧍 Выбрать тело</button>
      <button class="bbtn bbtn--danger" id="bReset" style="grid-column:1/-1">↺ Вернуть объект как было</button>
    </div>
    <div class="iconed" id="iconEd">
      <div class="iconed__title">Иконка в гардеробе</div>
      <div class="iconed__row">
        <div class="iconed__box" id="iconBox"><img id="iconImg" alt=""><span class="iconed__grip">тяни</span></div>
        <div class="iconed__ctrls">
          <label class="brow brow--tiny"><span>Масштаб</span><input type="number" id="fts" step="0.05"></label>
          <label class="brow brow--tiny"><span>Сдвиг X</span><input type="number" id="ftx" step="1"></label>
          <label class="brow brow--tiny"><span>Сдвиг Y</span><input type="number" id="fty" step="1"></label>
          <label class="brow brow--tiny"><span>Поворот</span><input type="number" id="ftr" step="1"></label>
        </div>
      </div>
      <button class="bbtn" id="bIconReset">↺ Сбросить вид иконки</button>
    </div>
    <div class="ed__label">Персонаж в рамке</div>
    <div class="beta__rows">
      <label class="brow"><span>Сдвиг X, %</span><input type="number" id="fitX" step="0.5"></label>
      <label class="brow"><span>Сдвиг Y, %</span><input type="number" id="fitY" step="0.5"></label>
      <label class="brow"><span>Масштаб</span><input type="number" id="fitZ" step="0.02" min="0.3" max="3"></label>
      <label class="brow"><span>Верх рамки</span><input type="number" id="fitT" step="0.005" min="0" max="0.4"></label>
      <label class="brow"><span>Низ рамки</span><input type="number" id="fitB" step="0.005" min="0.4" max="1"></label>
      <label class="brow"><span>Поля, px</span><input type="number" id="fitS" step="2" min="-80" max="200" title="Запас по бокам от персонажа: меньше — рамка уже"></label>
    </div>
    <div class="beta__btns"><button class="bbtn" id="bFitReset" style="grid-column:1/-1">↺ Персонаж по центру, масштаб 1</button></div>
    <label class="bcheck"><input type="checkbox" id="bGuides" checked> Сетка и ось симметрии</label>
    <label class="brow brow--range"><span>Прозрачн.</span><input type="range" id="bOpacity" min="20" max="100" value="${Math.round(dim * 100)}"><i id="bOpacityV">${Math.round(dim * 100)}%</i></label>
    <label class="brow brow--range"><span>Карточки</span><input type="range" id="bCards" min="64" max="170" value="${D().settings.cardSize}"><i id="bCardsV">${D().settings.cardSize}px</i></label>

    <div class="ed__label">Вещи</div>
    <div class="beta__btns">
      <button class="bbtn bbtn--main" id="bAddItem" style="grid-column:1/-1"></button>
      <button class="bbtn" id="bReplaceImg">🖼 Заменить картинку</button>
      <button class="bbtn" id="bReplaceIcon">🔲 Заменить иконку</button>
      <button class="bbtn" id="bReplaceBase">🧍 Заменить тело</button>
      <button class="bbtn bbtn--danger" id="bDelItem">🗑 Удалить вещь</button>
    </div>
    <p class="ed__note">Новые вещи — PNG того же размера, что и тело (слой из фотошопа целиком): они сразу встанут на место. Иконка делается сама, её можно заменить.</p>
    <div class="beta__keys"><b>Клавиши</b>
      <kbd>←↑→↓</kbd> сдвиг (<kbd>Shift</kbd> ×10) · <kbd>+</kbd> <kbd>−</kbd> масштаб · <kbd>Q</kbd> <kbd>E</kbd> поворот ·
      <kbd>F</kbd> зеркало · <kbd>Tab</kbd> следующий · <kbd>Esc</kbd> снять выделение
    </div>
    <input type="file" id="bFile" accept="image/*" hidden>`;

  const bind = (sel, prop, fix, after) => F(sel).addEventListener('input', () => {
    if (!picked) return;
    const v = parseFloat(F(sel).value);
    if (Number.isNaN(v)) return;
    P_()[prop] = fix ? fix(v) : v;
    const el = layerEls.get(key(picked.cat, picked.n));
    el && applyPos(el, picked.cat, picked.n);
    G.editor.changed();
    after && after();
  });
  bind('#fx', 'x'); bind('#fy', 'y');
  bind('#fs', 's', v => clamp(v, .03, 6));
  bind('#fr', 'r');
  bind('#fz', 'z', v => clamp(Math.round(v), -99, 999));
  const afterIcon = () => { paintShelf(); paintWorn(); paintIconPreview(); };
  bind('#fts', 'ts', v => clamp(v, .1, 4), afterIcon);
  bind('#ftx', 'tx', v => clamp(v, -200, 200), afterIcon);
  bind('#fty', 'ty', v => clamp(v, -200, 200), afterIcon);
  bind('#ftr', 'tr', v => clamp(v, -180, 180), afterIcon);

  // персонаж целиком
  F('#segAll').onclick = () => { moveAll = true; pick(null); syncFit(); };
  F('#segItem').onclick = () => { moveAll = false; syncFit(); };
  const fitBind = (q, key, lo, hi) => F(q).addEventListener('input', () => {
    const v = parseFloat(F(q).value);
    if (Number.isNaN(v)) return;
    FIT()[key] = clamp(v, lo, hi);
    fitChanged();
  });
  fitBind('#fitX', 'x', -100, 100); fitBind('#fitY', 'y', -100, 100); fitBind('#fitZ', 'zoom', .3, 3);
  fitBind('#fitT', 'cropTop', 0, .4); fitBind('#fitB', 'cropBottom', .4, 1); fitBind('#fitS', 'sideMargin', -80, 200);
  F('#bFitReset').onclick = () => { Object.assign(FIT(), { x: 0, y: 0, zoom: 1 }); fitChanged(); };
  syncFit();

  F('#bFlip').onclick = flip;
  F('#bZup').onclick  = () => zBy(1);
  F('#bZdn').onclick  = () => zBy(-1);
  F('#bBody').onclick = () => pick({ cat: 'base', n: 0 });
  F('#bReset').onclick = () => {
    if (!picked) return;
    const k = key(picked.cat, picked.n), was = G.base.dressup.layout?.[k];
    if (was) LAYOUT()[k] = G.clone(was); else delete LAYOUT()[k];
    commit(); paintShelf(); paintWorn();
    toast('Объект вернулся на место');
  };
  F('#bIconReset').onclick = () => {
    if (!picked || isBase(picked.cat)) return;
    Object.assign(P_(), { ts: 1, tx: 0, ty: 0, tr: 0 });
    syncFields(); paintShelf(); paintWorn(); G.editor.changed();
  };

  // превью иконки: тянем мышкой, колесо — масштаб, Shift+колесо — поворот
  const ib = F('#iconBox');
  let d = null;
  ib.addEventListener('pointerdown', e => {
    if (!picked || isBase(picked.cat)) return;
    const p = pos(picked.cat, picked.n);
    d = { sx: e.clientX, sy: e.clientY, tx: p.tx ?? 0, ty: p.ty ?? 0, w: ib.clientWidth || 1 };
    ib.setPointerCapture(e.pointerId);
    ib.classList.add('is-grab');
    e.preventDefault();
  });
  ib.addEventListener('pointermove', e => {
    if (!d) return;
    const p = P_();
    p.tx = round(clamp(d.tx + (e.clientX - d.sx) / d.w * 100, -200, 200), 1);
    p.ty = round(clamp(d.ty + (e.clientY - d.sy) / d.w * 100, -200, 200), 1);
    syncFields(); paintShelf(); paintWorn(); G.editor.changed();
  });
  ['pointerup', 'pointercancel'].forEach(ev =>
    ib.addEventListener(ev, () => { d = null; ib.classList.remove('is-grab'); }));
  ib.addEventListener('wheel', e => {
    if (!picked || isBase(picked.cat)) return;
    e.preventDefault();
    const p = P_();
    if (e.shiftKey) p.tr = round(clamp((p.tr ?? 0) + (e.deltaY > 0 ? 3 : -3), -180, 180), 1);
    else            p.ts = round(clamp((p.ts ?? 1) * (e.deltaY > 0 ? .94 : 1.06), .1, 4), 3);
    syncFields(); paintShelf(); paintWorn(); G.editor.changed();
  }, { passive: false });

  F('#bGuides').onchange = e => guides.classList.toggle('is-on', betaOn && e.target.checked);
  F('#bOpacity').oninput = e => {
    dim = e.target.value / 100;
    F('#bOpacityV').textContent = e.target.value + '%';
    $$('.layer', inner).forEach(el => {
      el.style.opacity = (dim < 1 && !el.classList.contains('layer--base')) ? dim : '';
    });
  };
  F('#bCards').oninput = e => {
    D().settings.cardSize = +e.target.value;
    F('#bCardsV').textContent = e.target.value + 'px';
    applyCardSize(); G.editor.changed();
  };

  // файлы
  const file = F('#bFile');
  let mode = '';
  const ask = (m, multiple) => { mode = m; file.multiple = multiple; file.value = ''; file.click(); };
  file.onchange = () => {
    const fs = [...file.files];
    if (!fs.length) return;
    if (mode === 'add') addItems(fs);
    else if (mode === 'base') { pick({ cat: 'base', n: 0 }); replaceImage(fs[0], 'img'); }
    else replaceImage(fs[0], mode);
  };
  F('#bAddItem').onclick     = () => ask('add', true);
  F('#bReplaceImg').onclick  = () => ask('img', false);
  F('#bReplaceIcon').onclick = () => ask('icon', false);
  F('#bReplaceBase').onclick = () => ask('base', false);
  F('#bDelItem').onclick     = deleteItem;

  syncFields();
}

/* ============================================================
   ШТОРКА НА МОБИЛКЕ
   ============================================================ */
const sheet = {
  open()   { app.classList.remove('is-sheet-closed'); },
  close()  { app.classList.add('is-sheet-closed'); },
  toggle() { app.classList.toggle('is-sheet-closed'); sndTap(); }
};

/* ============================================================
   ТОСТ
   ============================================================ */
let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

/* ============================================================
   СЦЕНА
   ============================================================ */
function applyTexts() {
  const T = D().texts;
  $$('[data-t]').forEach(e => { if (T[e.dataset.t] != null) e.textContent = T[e.dataset.t]; });
  $('#duTitle').textContent = D().title;
  if ($('#duTitle2')) $('#duTitle2').textContent = D().title2 || '';
  $('#duTag').textContent = D().tag;
}
function paintSound() {
  $('#soundIcon').textContent = G.soundOn ? '🔔' : '🔕';
  $('#btnSound').classList.toggle('is-muted', !G.soundOn);
  $('#btnSound').setAttribute('aria-pressed', String(G.soundOn));
}

function init() {
  inited = true;
  $('#btnRandom').onclick = randomize;
  $('#btnClear').onclick  = clearAll;
  $('#btnShot').onclick   = screenshot;
  $('#btnDone').onclick   = finish;
  $('#btnExit').onclick   = () => G.go('world', { room: 'dressup' });
  $('#btnSound').onclick  = () => {
    G.soundOn = !G.soundOn;
    G.writeLS('cherry.sound', G.soundOn);
    paintSound();
    if (G.soundOn) sndTap();
  };
  $('#grip').onclick = () => { sheet.toggle(); setTimeout(fitStage, 460); };
  $('#fab').onclick  = e => { sheet.open(); sndTap(); sparkleAt(e.clientX, e.clientY); setTimeout(fitStage, 460); };
  let y0 = null;
  const g = $('#grip');
  g.addEventListener('pointerdown', e => { y0 = e.clientY; });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (dy > 26) sheet.close(); else if (dy < -26) sheet.open();
    setTimeout(fitStage, 460);
  });
  baseImg.fetchPriority = 'high';
  baseImg.decoding = 'async';
  baseImg.dataset.cat = 'base';
  baseImg.dataset.n = 0;
  // мерцающие искры на фоне
  const tw = G.fx.el('twinkle', { loop: true, scale: 4.5 });
  if (tw) { tw.classList.add('du-twinkle'); $('.decor').appendChild(tw); }
}

G.scenes.dressup = {
  root,
  enter() {
    if (!inited) init();
    applyTexts(); paintSound(); applyCardSize();
    worn = normWorn(G.progress.outfit || D().defaultOutfit);
    picked = null;
    buildTabs();
    paintShelf(true);
    rebuildAll();
    setBeta(G.editing);
    requestAnimationFrame(fitStage);
    setTimeout(fitStage, 320);
    if (innerWidth <= 760) sheet.close();
    setTimeout(() => { if (G.sceneId === 'dressup') { toast(D().texts.hello); berryRain(12); } }, 700);
    G.music(G.cfg.world.rooms.dressup?.music);
  },
  leave() { setBeta(false); },
  refresh() {
    applyTexts(); applyCardSize();
    worn = normWorn(worn);
    buildTabs(); paintShelf(true); rebuildAll();
    if (picked && !meta(picked.cat, picked.n)) picked = null;
    if (picked) pick(picked);
    fitStage();
  },
  onEdit(on) { setBeta(on); },

  key(e) {
    if (betaOn) return;
    if (e.code === 'KeyR') randomize();
    else if (e.code === 'KeyC') clearAll();
  },
  /** клавиши режима настройки; true — клавиша обработана */
  editKey(e) {
    const step = e.shiftKey ? 10 : 1;
    switch (e.code) {
      case 'ArrowLeft':  nudge(-step, 0); return true;
      case 'ArrowRight': nudge(step, 0);  return true;
      case 'ArrowUp':    nudge(0, -step); return true;
      case 'ArrowDown':  nudge(0, step);  return true;
      case 'Escape':     pick(null);      return true;
      case 'Tab': {
        const list = onStage();
        const i = picked ? list.findIndex(o => o.cat === picked.cat && o.n === picked.n) : -1;
        pick(list[(i + 1) % list.length]);
        return true;
      }
      case 'Equal': case 'NumpadAdd':      scaleBy(1.02); return true;
      case 'Minus': case 'NumpadSubtract': scaleBy(.98);  return true;
      case 'KeyQ': rotBy(-1); return true;
      case 'KeyE': rotBy(1);  return true;
      case 'KeyF': flip();    return true;
    }
    return false;
  },

  editRoots: () => [{ path: 'dressup', label: 'Одевашка: тексты и категории' },
                    { path: 'world.rooms.dressup.cutscene', label: 'Катсцена после игры' }],
  editorTools
};

})();
