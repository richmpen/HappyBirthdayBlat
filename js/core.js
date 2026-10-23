/* ============================================================
   core.js — ядро игры
   ------------------------------------------------------------
   • Всё, что можно менять (тексты, картинки, позиции, размеры),
     лежит в одном файле data/game.json. Игра читает его при
     запуске, редактор (F10 — настройки, F11 — слои) его правит
     и сохраняет на GitHub.
   • Игровой экран — «виртуальные» 960×540, растягивается под окно.
     Координаты объектов: x,y — точка НИЗ-ЦЕНТР картинки («ноги»),
     w — ширина; высота считается сама по пропорциям картинки.
   • Сцены: title, world, kitchen, dressup, rhythm, cutscene, finale.
   • Эффекты (G.fx) — спрайт-атласы, собранные в Arcadia Effector
     из файлов effects/*.json; список — data/game.json → fx.
   ============================================================ */
(() => {
'use strict';

const G = window.G = {
  VW: 960, VH: 540,
  cfg: null,          // текущий конфиг (с правками редактора)
  base: null,         // конфиг, как он лежит на сайте (для «что изменилось»)
  scenes: {}, scene: null, sceneId: '', sceneParams: {},
  editing: false,     // открыт редактор — игра на паузе, объекты можно таскать
  busy: 0,            // идёт переход между сценами
  k: 1                // текущий масштаб экрана
};

/* ---------------- утилиты ---------------- */
const $  = G.$  = (s, r = document) => r.querySelector(s);
const $$ = G.$$ = (s, r = document) => [...r.querySelectorAll(s)];
G.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
G.round = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };
G.rnd   = (a, b) => a + Math.random() * (b - a);
G.sleep = ms => new Promise(r => setTimeout(r, ms));
G.clone = o => JSON.parse(JSON.stringify(o));
G.esc   = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
G.fmt   = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

G.el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const readLS  = G.readLS  = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const writeLS = G.writeLS = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* путь в конфиге: "rooms.hub.doors.0.x" */
G.get = (path, root = G.cfg) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), root);
G.set = (path, v) => {
  const ks = path.split('.'), last = ks.pop();
  const o = ks.reduce((o, k) => o[k], G.cfg);
  o[last] = v;
};

/* ---------------- файлы ---------------- */
/** загруженные в редакторе, но ещё не сохранённые файлы: путь → { blob, url } */
G.pending = new Map();
/** уже сохранённые в этой сессии — показываем из памяти, пока сайт пересобирается */
G.fresh = new Map();

/** путь из конфига → адрес, который можно ставить в src */
G.asset = p => {
  if (!p) return '';
  const f = G.pending.get(p) || G.fresh.get(p);
  if (f) return f.url;
  if (/^(https?:|data:|blob:)/.test(p)) return p;
  return p.split('/').map(encodeURIComponent).join('/');
};

/** все картинки проекта (data/assets.json, его пишет tools/assets-list.js) + то, на что уже ссылается конфиг и что загружено сейчас */
let assetsP = null;
G.assetList = async () => {
  assetsP ||= fetch('data/assets.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []);
  const list = new Set(await assetsP);
  (function walk(o) {
    if (typeof o === 'string') { if (/^assets\/.+\.(png|webp|jpe?g|gif|svg)$/i.test(o)) list.add(o); }
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  })(G.cfg);
  G.pending.forEach((f, p) => { if (/\.(png|webp|jpe?g|gif|svg)$/i.test(p)) list.add(p); });
  return [...list].sort();
};

G.loadConfig = async () => {
  const r = await fetch('data/game.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('data/game.json — ' + r.status);
  G.cfg = await r.json();
  G.base = G.clone(G.cfg);
};

/* ---------------- прогресс игрока (в браузере) ---------------- */
const PKEY = 'cherry.progress.v1';
const freshProgress = () => ({ done: {}, visited: {}, songs: {}, records: {}, outfit: null, finale: false, wish: false, unlockAll: false });
G.progress = Object.assign(freshProgress(), readLS(PKEY, {}));
G.saveProgress  = () => { writeLS(PKEY, G.progress); G.markDone(); };
G.resetProgress = () => { G.progress = freshProgress(); G.saveProgress(); };
G.isDone     = id => !!G.progress.done[id];
G.allDone    = () => G.cfg.order.every(G.isDone);
G.hasProgress = () => Object.keys(G.progress.done).length > 0;
/** галерея открыта после прохождения игры (в редакторе — «Все двери открыты») */
G.galleryOpen = () => !!G.cfg && (G.allDone() || !!G.progress.unlockAll);
G.markDone = () => document.body.classList.toggle('game-done', G.galleryOpen());
/** комнаты открываются по очереди: дверь открыта, если пройдены все предыдущие */
G.isUnlocked = id => {
  const i = G.cfg.order.indexOf(id);
  if (i < 0 || G.progress.unlockAll) return true;
  return G.cfg.order.slice(0, i).every(G.isDone);
};

/* ---------------- звук: мягкие «блипы» без файлов ---------------- */
let actx = null;
G.audioCtx = () => {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
};
G.soundOn = readLS('cherry.sound', true);
G.blip = (freq = 660, dur = .08, type = 'square', gain = .04) => {
  if (!G.soundOn) return;
  try {
    const a = G.audioCtx(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(gain, a.currentTime + .01);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + .02);
  } catch {}
};
G.sfx = {
  tap : () => G.blip(880, .05, 'square', .025),
  talk: () => G.blip(520 + Math.random() * 120, .03, 'square', .014),
  ok  : () => { G.blip(760, .09); setTimeout(() => G.blip(1020, .1), 60); },
  bad : () => G.blip(180, .16, 'sawtooth', .03),
  door: () => { G.blip(330, .1, 'triangle', .05); setTimeout(() => G.blip(440, .14, 'triangle', .05), 90); },
  win : () => [660, 880, 990, 1320].forEach((f, i) => setTimeout(() => G.blip(f, .14, 'square', .035), i * 90)),
  plop: () => G.blip(300, .12, 'sine', .07)
};

/** звук вкл/выкл (колокольчик): блипы и музыка */
G.setSound = on => { G.soundOn = !!on; writeLS('cherry.sound', G.soundOn); };

/* ---------------- музыка ----------------
   G.music('')    — музыка игры: песни из music.playlist идут по очереди,
                    соседние плавно перетекают друг в друга (music.crossfade, с);
   G.music(src)   — свой трек сцены (мини-игры: kitchen.music, dressup.music),
                    зациклен тем же плавным переходом;
   G.music(false) — тишина (у ритм-игры свои песни).
   Если сцену сменили, музыка запоминает, где остановилась: вышли из
   мини-игры — дальше играет та же песня с того же места. Громкость — music.volume, колокольчик глушит всё.
   Пока идёт диалог или катсцена, музыка плавно становится тише (music.duck —
   во сколько раз от обычной громкости, music.duckFade — за сколько секунд);
   в финале — не тише, там всё на одной громкости.
   G.music(src, vol, { now: true }) — сразу и с начала трека (финал);
   G.preloadMusic(src) — загрузить заранее, чтобы потом заиграло без паузы. */
const MUS = { key: null, list: [], vol: .5, chans: [], saved: {}, last: performance.now(), duck: 1 };
const musCfg = () => G.cfg?.music || {};

const musPre = new Map();               // заранее загруженные треки: путь → Audio
G.preloadMusic = src => {
  if (!src || musPre.has(src)) return;
  const el = new Audio(G.asset(src));
  el.preload = 'auto'; el.volume = 0; el.load();
  musPre.set(src, el);
};
function musChan(src, idx, at, fadeIn) {
  const el = musPre.get(src) || new Audio(G.asset(src));
  musPre.delete(src);
  el.preload = 'auto'; el.volume = 0;
  const ch = { el, idx, key: MUS.key, f: 0, target: 1, fade: fadeIn, started: false, next: false };
  const go = () => { try { if (at) el.currentTime = at; } catch {} el.play().then(() => { ch.started = true; }).catch(() => { ch.blocked = true; }); };
  if (at) el.addEventListener('loadedmetadata', go, { once: true }); else go();
  el.addEventListener('ended', () => { if (!ch.next && ch.key === MUS.key && ch.target > 0) musNext(ch, .4); });
  MUS.chans.push(ch);
  return ch;
}
/** следующий трек программы (для одного трека — он же сначала) */
function musNext(ch, fade) {
  ch.next = true;
  ch.target = 0; ch.fade = fade;
  const n = (ch.idx + 1) % MUS.list.length;
  musChan(MUS.list[n], n, 0, fade);
}
G.music = (src, vol, opt = {}) => {
  const M = musCfg();
  const list = src === false ? [] : src ? [src] : (M.playlist || []).filter(Boolean);
  const key = src === false ? '' : src || '@playlist';
  MUS.vol = vol ?? (src ? .7 : M.volume ?? .5);
  if (key === MUS.key && !opt.now) return;
  // уходящая программа: запомнить место и плавно погасить
  for (const ch of MUS.chans) {
    if (ch.target > 0 && ch.key === MUS.key && MUS.key) MUS.saved[MUS.key] = { idx: ch.idx, t: ch.el.currentTime || 0 };
    ch.target = 0; ch.fade = opt.now ? .5 : 1.2;
  }
  MUS.key = key; MUS.list = list;
  if (opt.now) { delete MUS.saved[key]; MUS.duck = 1; }
  if (!list.length) return;
  const s = MUS.saved[key];
  const idx = s && s.idx < list.length ? s.idx : 0;
  musChan(list[idx], idx, s ? s.t : 0, opt.now ? .15 : s ? 1.6 : 1.2);
};
/** раз в кадр: громкость каналов, плавные переходы, конец трека */
function musTick() {
  const now = performance.now(), dt = Math.min(.25, (now - MUS.last) / 1000);
  MUS.last = now;
  const xf = Math.max(.5, musCfg().crossfade ?? 5);
  // приглушение: в диалоге и катсцене музыка тише, потом плавно возвращается
  const quiet = (G.dialogOpen || G.sceneId === 'cutscene') && G.sceneId !== 'finale';
  const duckTo = quiet ? G.clamp(musCfg().duck ?? .35, 0, 1) : 1, rate = dt / Math.max(.05, musCfg().duckFade ?? .9);
  MUS.duck = duckTo < MUS.duck ? Math.max(duckTo, MUS.duck - rate) : Math.min(duckTo, MUS.duck + rate * .7);
  for (const ch of [...MUS.chans]) {
    const el = ch.el;
    if (ch.f !== ch.target) {
      const step = dt / Math.max(.05, ch.fade);
      ch.f = ch.target > ch.f ? Math.min(ch.target, ch.f + step) : Math.max(ch.target, ch.f - step);
    }
    // равная мощность: сумма двух перетекающих треков звучит одинаково громко
    const v = Math.sin(ch.f * Math.PI / 2) * MUS.vol * MUS.duck * (G.soundOn ? 1 : 0);
    if (Math.abs(el.volume - v) > .002) el.volume = G.clamp(v, 0, 1);
    if (ch.target === 0 && ch.f === 0) { el.pause(); el.removeAttribute('src'); el.load(); MUS.chans.splice(MUS.chans.indexOf(ch), 1); continue; }
    if (!ch.next && ch.target > 0 && ch.key === MUS.key && el.duration && isFinite(el.duration) &&
        el.duration - el.currentTime <= Math.min(xf, el.duration / 3)) musNext(ch, Math.min(xf, el.duration - el.currentTime));
  }
}
/** для отладки из консоли: что сейчас играет */
G.musicState = () => MUS.chans.map(c => ({ src: c.el.src.split('/').pop(), t: +c.el.currentTime.toFixed(1), vol: +c.el.volume.toFixed(2), target: c.target, paused: c.el.paused }));
/** браузер не даёт играть звук до первого клика — запускаем по первому действию */
const musUnlock = () => {
  G.audioCtx();
  for (const ch of MUS.chans) if (ch.target > 0 && (ch.blocked || ch.el.paused)) { ch.blocked = false; ch.el.play().then(() => { ch.started = true; }).catch(() => {}); }
};
setInterval(musTick, 50);          // таймер, а не кадры: переходы идут и в свёрнутой вкладке
addEventListener('pointerdown', musUnlock, true);
addEventListener('keydown', musUnlock, true);

/* ---------------- экран ---------------- */
const shell = $('#shell'), view = $('#view');
/** экран вписан в окно целиком, без рамок. Размер экрана задаёт сцена (viewSize):
    обычно 960×540; 'fill' — по пропорциям окна (дом, катсцены: никаких полос);
    { w, h } — свой (меню и финал — пропорции рисунка).
    framed — экран в рамке с отступом от краёв окна (катсцены). */
function fit() {
  const W = Math.max(1, shell.clientWidth), H = Math.max(1, shell.clientHeight);
  const v = G.scene?.viewSize?.();
  let vw = 960, vh = 540;
  if (v === 'fill') vw = Math.round(G.clamp(540 * W / H, 640, 1800));
  else if (v) { vw = v.w; vh = v.h; }
  if (vw !== G.VW || vh !== G.VH) {
    G.VW = vw; G.VH = vh;
    view.style.width = vw + 'px'; view.style.height = vh + 'px';
  }
  const pad = G.scene?.framed ? 48 : 0;
  const k = Math.min((W - pad) / G.VW, (H - pad) / G.VH);
  G.k = Math.max(.1, k);
  view.style.transform = `translate(-50%,-50%) scale(${G.k})`;
}
new ResizeObserver(fit).observe(shell);
G.fit = fit;

/** координаты указателя → координаты экрана 960×540 */
G.toView = e => {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left) / G.k, y: (e.clientY - r.top) / G.k };
};

/* ---------------- объекты на экране ---------------- */
/** ставит элемент по объекту конфига { x, y, w, h }; z — слой, hide — спрятан (редактор F11) */
G.place = (el, o) => {
  el._o = o;
  if (o.x != null) el.style.left = o.x + 'px';
  if (o.y != null) el.style.top  = o.y + 'px';
  if (o.w != null) el.style.width = o.w + 'px';
  if (o.h != null) el.style.height = o.h + 'px';
  else if (el._ar && o.w != null) el.style.height = (o.w * el._ar) + 'px';
  if (typeof o.z === 'number') el.style.zIndex = o.z;
  el.classList.toggle('is-hide', !!o.hide);
  el.classList.toggle('is-flip', !!o.flip);
};

/** картинка-объект. path — путь в конфиге (чтобы редактор мог её выбрать) */
G.img = (o, path, cls = '', key = 'img') => {
  let e;
  if (o[key]) {
    e = new Image();
    e.draggable = false; e.alt = '';
    e.src = G.asset(o[key]);
  } else {
    e = G.el('div', 'ent--empty', 'нет<br>картинки');
    e.style.height = (o.w || 60) + 'px';
  }
  e.classList.add('ent', 'px');
  if (cls) e.classList.add(...cls.split(' '));
  G.place(e, o);
  if (path) e.dataset.edit = path;
  return e;
};

/** спрайт-лист: o = { img, cols, rows, w }. Кадр ставится через .setFrame(col,row) */
G.sheet = (o, cls = '') => {
  const d = G.el('div', 'ent px sheet ' + cls);
  const cols = Math.max(1, o.cols || 1), rows = Math.max(1, o.rows || 1);
  d.style.backgroundImage = `url("${G.asset(o.img)}")`;
  d.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
  d._ar = 4 / 3;
  d.style.width = o.w + 'px';
  d.style.height = (o.w * d._ar) + 'px';
  const im = new Image();
  im.onload = () => {
    d._ar = (im.naturalHeight / rows) / (im.naturalWidth / cols);
    d.style.height = (parseFloat(d.style.width) * d._ar) + 'px';
  };
  im.src = G.asset(o.img);
  d.setFrame = (c, r = 0) => {
    d.style.backgroundPosition =
      `${cols > 1 ? (c % cols) / (cols - 1) * 100 : 0}% ${rows > 1 ? (r % rows) / (rows - 1) * 100 : 0}%`;
  };
  d.setFrame(0, 0);
  return d;
};

/** прямоугольная зона { x, y, w, h } (левый верхний угол) */
G.zone = (o, path, label, cls = '') => {
  const z = G.el('div', 'zone ' + cls, label ? `<span>${G.esc(label)}</span>` : '');
  G.place(z, o);
  if (path) z.dataset.edit = path;
  return z;
};

/* ---------------- эффекты: атласы из Arcadia Effector ---------------- */
const fxImgs = new Map(), fxLive = new Set();
function fxFrame(st, f) {
  const d = st.d;
  st.frame = f;
  st.e.style.backgroundPosition =
    `${d.cols > 1 ? (f % d.cols) / (d.cols - 1) * 100 : 0}% ${d.rows > 1 ? Math.floor(f / d.cols) / (d.rows - 1) * 100 : 0}%`;
}
G.fx = {
  def: name => G.cfg.fx?.[name],
  image(name) {
    const d = this.def(name);
    if (!d) return null;
    let im = fxImgs.get(d.img);
    if (!im) { im = new Image(); im.src = G.asset(d.img); fxImgs.set(d.img, im); }
    return im;
  },
  /** элемент, который проигрывает эффект (сам удалится в конце, если эффект не зациклен) */
  el(name, o = {}) {
    const d = this.def(name);
    if (!d || !d.img) return null;
    const e = G.el('div', 'fx' + (d.pixel ? ' px' : '') + (d.blend === 'add' ? ' fx--add' : ''));
    const k = (o.scale ?? 1) * (d.scale ?? 1);
    e.style.width = d.w * k + 'px'; e.style.height = d.h * k + 'px';
    e.style.backgroundImage = `url("${G.asset(d.img)}")`;
    e.style.backgroundSize = `${d.cols * 100}% ${d.rows * 100}%`;
    const st = { e, d, t: 0, loop: o.loop ?? !!d.loop, onEnd: o.onEnd, frame: 0, seen: false };
    fxFrame(st, 0);
    fxLive.add(st);
    return e;
  },
  /** эффект в точке (x, y) внутри элемента parent */
  at(name, parent, x, y, o = {}) {
    const e = this.el(name, o);
    if (!e || !parent) return null;
    e.style.left = x + 'px'; e.style.top = y + 'px';
    if (o.z != null) e.style.zIndex = o.z;
    parent.appendChild(e);
    return e;
  },
  /** эффект поверх всего, в координатах окна */
  screen(name, cx, cy, o) { return this.at(name, $('#fxLayer'), cx, cy, o); },
  /** эффект над элементом (по его центру) */
  over(name, el, o = {}) {
    const r = el.getBoundingClientRect();
    return this.screen(name, r.left + r.width / 2 + (o.dx || 0), r.top + r.height / 2 + (o.dy || 0), o);
  },
  /** кадр эффекта на canvas в момент t; false — эффект уже кончился */
  draw(g, name, t, x, y, scale = 1, alpha = 1) {
    const d = this.def(name), im = this.image(name);
    if (!d || !im || !im.complete || !im.naturalWidth) return t < 1;
    let f = Math.floor(t * d.fps);
    if (f >= d.frames) { if (!d.loop) return false; f %= d.frames; }
    if (f < 0) return true;
    const sw = im.naturalWidth / d.cols, sh = im.naturalHeight / d.rows, w = d.w * scale * (d.scale ?? 1), h = d.h * scale * (d.scale ?? 1);
    const pa = g.globalAlpha, pc = g.globalCompositeOperation;
    g.globalAlpha = pa * alpha;
    if (d.blend === 'add') g.globalCompositeOperation = 'lighter';
    g.drawImage(im, (f % d.cols) * sw, Math.floor(f / d.cols) * sh, sw, sh, x - w / 2, y - h / 2, w, h);
    g.globalAlpha = pa; g.globalCompositeOperation = pc;
    return true;
  },
  tick(dt) {
    for (const st of fxLive) {
      if (st.e.isConnected) st.seen = true;
      else if (st.seen) { fxLive.delete(st); continue; }
      st.t += dt;
      let f = Math.floor(st.t * st.d.fps);
      if (f >= st.d.frames) {
        if (st.loop) f %= st.d.frames;
        else { fxLive.delete(st); st.e.remove(); st.onEnd && st.onEnd(); continue; }
      }
      if (f !== st.frame) fxFrame(st, f);
    }
  }
};

/* ---------------- затемнение при переходах ----------------
   slow — медленное мягкое затемнение (катсцены): экран плавно темнеет и плавно светлеет */
const fadeEl = $('#fade');
G.fade = async (on, slow) => {
  if (on) fadeEl.classList.toggle('is-slow', !!slow);
  const sl = fadeEl.classList.contains('is-slow');
  fadeEl.classList.toggle('is-on', on);
  await G.sleep(sl ? (on ? 1150 : 1400) : 260);
};

/* ---------------- сцены ---------------- */
G.go = async (id, params = {}) => {
  if (G.busy) return;
  G.busy++;
  const slow = id === 'cutscene' || G.sceneId === 'cutscene';
  try {
    await G.fade(true, slow);
    G.overlay?.close(true);
    G.closeDialog();
    G.scene?.leave?.();
    Object.values(G.scenes).forEach(s => { s.root.hidden = true; });
    const sc = G.scenes[id];
    G.scene = sc; G.sceneId = id; G.sceneParams = params;
    document.body.dataset.scene = id;
    document.body.classList.toggle('cut-framed', !!sc.framed);
    G.markDone();
    sc.root.hidden = false;
    fit();                                   // размер экрана этой сцены — до того, как она нарисуется
    sc.enter(params);
    G.editor?.sceneChanged();
    fit();
  } finally {
    G.busy--;
  }
  await G.fade(false);
};

/** перерисовать текущую сцену после правки в редакторе */
G.refresh = () => { try { G.scene?.refresh?.(); } catch (e) { console.error(e); } };

/** мини-игра комнаты пройдена: катсцена → (финал | обратно в комнату) */
G.completeRoom = id => {
  G.progress.done[id] = true;
  G.saveProgress();
  G.sfx.win();
  return G.go('cutscene', {
    path: `world.rooms.${id}.cutscene`,
    next: () => (G.allDone() && !G.progress.finale) ? G.go('finale') : G.go('world', { room: id, talk: true })
  });
};

/* ---------------- диалоги ----------------
   Реплика — строка («>» в начале — говорит героиня) или объект:
     { who, text, sprite, pic, spriteEvery }
       who    — 'npc' (персонаж, с которым говорим), 'hero' (героиня) или любое имя;
       sprite — спрайт персонажа слева, как в новелле (путь или список кадров —
                кадры меняются раз в spriteEvery секунд). Спрайт остаётся до
                следующего; '-' — убрать. Если говорит не этот персонаж,
                спрайт темнеет и чуть уменьшается (низ остаётся на месте);
       pic    — картинка на весь экран за окном диалога (только на этой реплике).
                Реплика с картинкой и без текста — просто картинка: текст и спрайт
                пропадают, остаётся только она;
       wait   — дальше само через столько секунд: у фразы — после того, как текст
                напечатался; у картинки — после того, как она проявилась (и пока
                время не вышло, клик её не пропускает).
   Старый вид { name, text } тоже понимается. */
const dlg = $('#dialog'), dlgName = $('#dlgName'), dlgText = $('#dlgText'),
      dlgNext = $('#dlgNext'), dlgChoices = $('#dlgChoices'),
      nov = $('#novel'), novPic = $('#novelPic'), novSpr = $('#novelSprite');
let dlgState = null;
G.dialogOpen = false;

function typeLine(text) {
  const chars = [...text];
  let i = 0;
  dlgText.textContent = '';
  dlgNext.hidden = true;
  dlgState.typing = true;
  clearInterval(dlgState.timer);
  const s = dlgState, o = s.lines[s.i];
  s.finish = () => {
    clearInterval(s.timer);
    dlgText.textContent = text;
    s.typing = false;
    dlgNext.hidden = !!s.choices;
    if (s.choices) showChoices();
    if (o && o.wait > 0 && !s.lock && !s.choices) autoNext(s, o.wait);   // фраза договорена — дальше само
  };
  if (!chars.length) { dlgState.finish(); return; }
  dlgState.timer = setInterval(() => {
    i++;
    dlgText.textContent = chars.slice(0, i).join('');
    if (i % 2 === 0 && chars[i - 1] !== ' ') G.sfx.talk();
    if (i >= chars.length) dlgState.finish();
  }, 28);
}

/** реплика → { name, text, o } */
function parseLine(line, speaker) {
  const hero = G.cfg.texts.heroName;
  let name = speaker || '', o = {};
  if (line && typeof line === 'object') {
    o = line;
    if (o.who === 'hero') name = hero;
    else if (o.who && o.who !== 'npc') name = o.who;
    else if (o.name != null && o.name !== '') name = o.name;
    line = o.text ?? '';
  }
  line = String(line ?? '');
  if (line.startsWith('>')) { name = hero; line = line.slice(1).trim(); }
  return { name, text: line, o };
}
const isNovel = lines => lines.some(l => l && typeof l === 'object' && (l.sprite || l.pic));
G.dialogIsNovel = isNovel;

/** спрайт слева и картинка за окном диалога */
function paintNovel(o, name) {
  const s = dlgState;
  if (o.sprite === '-') s.sprite = [];
  else if (o.sprite) s.sprite = [].concat(o.sprite).filter(Boolean);
  if (o.spriteEvery) s.every = o.spriteEvery;
  const frames = s.sprite || [];
  frames.forEach(p => { if (!s.pre.has(p)) { const i = new Image(); i.src = G.asset(p); s.pre.set(p, i); } });
  clearInterval(s.sprT);
  if (frames.length) {
    let f = 0;
    const set = p => { const u = G.asset(p); if (novSpr.getAttribute('src') !== u) novSpr.src = u; };
    set(frames[0]);
    if (frames.length > 1) s.sprT = setInterval(() => set(frames[++f % frames.length]), Math.max(.1, s.every || 1) * 1000);
    if (novSpr.hidden) { novSpr.hidden = false; novSpr.classList.remove('is-in'); void novSpr.offsetWidth; novSpr.classList.add('is-in'); }
  } else novSpr.hidden = true;
  placePortrait(frames.length > 0);
  // говорит не тот, чей спрайт — спрайт в тени
  novSpr.classList.toggle('is-dim', !!name && name !== s.speaker);
  if (o.pic) {
    const u = `url("${G.asset(o.pic)}")`;
    if (novPic.style.backgroundImage !== u) novPic.style.backgroundImage = u;
    novPic.classList.add('is-on');
  } else novPic.classList.remove('is-on');
  const picOnly = !!o.pic && !String(o.text ?? '').trim();
  dlg.hidden = picOnly;
  if (picOnly) novSpr.hidden = true;                             // только картинка: ни текста, ни спрайта
  nov.classList.toggle('is-pic-only', picOnly);
  return { picOnly, fresh: !!o.pic && !s.picOn };
}

/** где стоит портрет: у персонажа свой (npc.portrait) или общий (novel) — { x, y, h }:
    x — середина, y — низ (в пикселях экрана), h — высота. В редакторе его тащат мышкой, колесо — размер */
function portraitPath() {
  const own = dlgState?.path && dlgState.path.replace(/.(dialog|dialogAfter)$/, '.portrait');
  return own && G.get(own) ? own : 'novel';
}
function placePortrait(on) {
  const path = portraitPath(), L = G.get(path) || {};
  const o = { x: L.x ?? 125, y: L.y ?? G.VH, h: L.h ?? 290 };
  if (G.get(path)) novSpr.dataset.edit = path; else delete novSpr.dataset.edit;
  G.place(novSpr, o);
  novSpr.classList.toggle('is-flip', !!(L.flip || dlgState?.lines[dlgState.i]?.flip));
  novSpr.style.width = 'auto';
  // окно диалога — рядом с портретом: портрет слева — окно правее, справа — левее
  const ar = novSpr.naturalWidth ? novSpr.naturalWidth / novSpr.naturalHeight : .66, half = o.h * ar / 2;
  dlg.style.left = dlg.style.right = '';
  if (on && o.x < G.VW / 2) dlg.style.left = Math.max(50, Math.round(o.x + half + 14)) + 'px';
  else if (on) dlg.style.right = Math.max(50, Math.round(G.VW - o.x + half + 14)) + 'px';
  if (!novSpr.onload) novSpr.onload = () => { if (dlgState && !novSpr.hidden) placePortrait(true); };
}
G.placePortrait = () => { if (dlgState?.novel) placePortrait(!novSpr.hidden); };

/** перейти к следующей фразе само через sec секунд (в редакторе — ждём, пока его закроют) */
function autoNext(s, sec) {
  clearTimeout(s.autoT);
  const i = s.i;
  const go = () => {
    if (s !== dlgState || s.i !== i) return;
    if (G.editing || G.overlay?.open) { s.autoT = setTimeout(go, 400); return; }
    s.lock = false;
    advance();
  };
  s.autoT = setTimeout(go, sec * 1000);
}

function showLine() {
  const s = dlgState;
  const { name, text, o } = parseLine(s.lines[s.i], s.speaker);
  dlgName.textContent = name;
  dlgName.hidden = !name;
  dlg.classList.toggle('is-hero', name === G.cfg.texts.heroName);
  clearTimeout(s.autoT); s.lock = false;
  const nv = s.novel ? paintNovel(o, name) : {};
  s.picOn = !!o.pic;
  if (nv.picOnly && o.wait > 0) { s.lock = true; autoNext(s, o.wait + (nv.fresh ? 1.35 : 0)); }  // картинка висит, потом диалог дальше
  typeLine(text);
}

function showChoices() {
  const s = dlgState;
  dlgChoices.innerHTML = '';
  s.choices.forEach((c, i) => {
    const b = G.el('button', 'dlg__choice' + (i === s.sel ? ' is-on' : ''), G.esc(c));
    b.onclick = e => { e.stopPropagation(); pickChoice(i); };
    dlgChoices.appendChild(b);
  });
  dlgChoices.hidden = false;
}
function pickChoice(i) {
  G.sfx.tap();
  endDialog(i);
}
function endDialog(result) {
  const s = dlgState;
  if (!s) return;
  clearInterval(s.timer); clearInterval(s.sprT); clearTimeout(s.autoT);
  dlgState = null;
  G.dialogOpen = false;
  dlg.hidden = true;
  dlgChoices.hidden = true;
  nov.hidden = true; novSpr.hidden = true; novPic.classList.remove('is-on'); dlg.style.left = dlg.style.right = '';
  delete dlg.dataset.edit; delete nov.dataset.edit;
  s.resolve(result);
}
G.closeDialog = () => endDialog(-1);

const keepLine = l => l != null && l !== '' && !(typeof l === 'object' && !l.text && !l.pic);
/** path — где эти реплики лежат в конфиге: тогда по F10 (или клику по окну диалога) их сразу видно в редакторе */
function openDialog(lines, speaker, choices, path) {
  G.closeDialog();
  return new Promise(resolve => {
    const src = Array.isArray(lines) ? lines : [lines];
    lines = src.filter(keepLine);
    if (!lines.length) { resolve(0); return; }
    dlgState = { src, lines, i: 0, speaker, path, choices: null, allChoices: choices, sel: 0, resolve, novel: isNovel(lines), sprite: null, pre: new Map() };
    if (choices && lines.length === 1) dlgState.choices = choices;
    if (path) dlg.dataset.edit = nov.dataset.edit = path;
    G.dialogOpen = true;
    dlg.hidden = false;
    dlgChoices.hidden = true;
    nov.hidden = !dlgState.novel;
    showLine();
  });
}

/** открытый диалог для редактора: где он в конфиге и какая фраза (номер в исходном списке) сейчас на экране */
G.dialogInfo = () => dlgState && dlgState.path ? { path: dlgState.path, i: dlgState.src.indexOf(dlgState.lines[dlgState.i]) } : null;
/** фразы поправили в редакторе — показать текущую заново (без печати по буквам) */
G.dialogRefresh = () => {
  const s = dlgState;
  if (!s) return;
  const cur = s.src.indexOf(s.lines[s.i]);
  s.lines = s.src.filter(keepLine);
  if (!s.lines.length) { G.closeDialog(); return; }
  const k = cur >= 0 ? s.lines.indexOf(s.src[cur]) : -1;
  s.i = G.clamp(k >= 0 ? k : s.i, 0, s.lines.length - 1);
  s.novel = isNovel(s.lines);
  nov.hidden = !s.novel;
  // спрайт тянется с прошлых фраз — пересчитываем его с начала
  s.sprite = null;
  if (s.novel) for (let j = 0; j < s.i; j++) { const sp = s.lines[j]?.sprite; if (sp === '-') s.sprite = []; else if (sp) s.sprite = [].concat(sp).filter(Boolean); }
  showLine();
  s.finish();
};

/** показать реплики по очереди. Строка, начинающаяся с «>», — слова героини */
G.say = (lines, speaker, path) => openDialog(lines, speaker, null, path);
/** реплики, а на последней — варианты ответа → номер выбранного (−1 — диалог закрыли) */
G.ask = (lines, options, speaker, path) => openDialog(lines, speaker, options, path);
/** вопрос с вариантами ответа → номер выбранного */
G.choose = (text, options, speaker) => openDialog([text], speaker, options);

G.dialogNext = () => {
  const s = dlgState;
  if (!s || s.lock) return;
  if (s.typing) { s.finish(); return; }
  if (s.choices) { pickChoice(s.sel); return; }
  G.sfx.tap();
  advance();
};
function advance() {
  const s = dlgState;
  if (!s) return;
  s.i++;
  if (s.i >= s.lines.length) { endDialog(0); return; }
  if (s.allChoices && s.i === s.lines.length - 1) s.choices = s.allChoices;
  showLine();
}
dlg.addEventListener('click', () => { if (!G.editing) G.dialogNext(); });
nov.addEventListener('click', () => { if (!G.editing) G.dialogNext(); });

function dialogKey(e) {
  const s = dlgState;
  if (s.choices && !s.typing) {
    const n = s.choices.length;
    if (['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA'].includes(e.code)) { s.sel = (s.sel + n - 1) % n; showChoices(); G.sfx.tap(); }
    if (['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD'].includes(e.code)) { s.sel = (s.sel + 1) % n; showChoices(); G.sfx.tap(); }
  }
  if (G.isAction(e)) G.dialogNext();
}

/* ---------------- всплывающая подсказка на экране ---------------- */
const popupEl = $('#popup');
let popupT;
G.popup = (text, ms = 2000) => {
  popupEl.textContent = text;
  popupEl.classList.remove('is-on');
  void popupEl.offsetWidth;
  popupEl.classList.add('is-on');
  clearTimeout(popupT);
  popupT = setTimeout(() => popupEl.classList.remove('is-on'), ms);
};

/* ---------------- клавиатура ---------------- */
G.keys = new Set();
G.isAction = e => e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space';
const typing = t => /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;

addEventListener('keydown', e => {
  if (e.code === 'F10') { e.preventDefault(); G.editor?.toggle(); return; }
  if (e.code === 'F11') { e.preventDefault(); G.editor?.layers(); return; }      // слои: картинка, слой, видимость каждого предмета
  if (typing(e.target)) return;
  if (G.editing) { if (G.editor.key(e)) e.preventDefault(); return; }   // при открытом редакторе игра клавиш не получает
  if (e.repeat && G.isAction(e)) { e.preventDefault(); return; }
  G.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (G.overlay?.open) { G.overlay.key(e); return; }   // галерея поверх игры
  if (G.busy) return;
  if (G.dialogOpen) { dialogKey(e); return; }
  G.scene?.key?.(e);
});
addEventListener('keyup', e => { G.keys.delete(e.code); G.scene?.keyup?.(e); });
addEventListener('blur', () => G.keys.clear());

/* ---------------- главный цикл ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  if (!G.overlay?.open) try { G.scene?.update?.(dt, now / 1000); } catch (e) { console.error(e); }
  G.fx.tick(dt);
  G.editor?.tick?.();
  requestAnimationFrame(frame);
}
G.start = () => requestAnimationFrame(frame);

})();
