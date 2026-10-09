/* ============================================================
   core.js — ядро игры
   ------------------------------------------------------------
   • Всё, что можно менять (тексты, картинки, позиции, размеры),
     лежит в одном файле data/game.json. Игра читает его при
     запуске, редактор (F10) его правит и сохраняет на GitHub.
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
G.saveProgress  = () => writeLS(PKEY, G.progress);
G.resetProgress = () => { G.progress = freshProgress(); G.saveProgress(); };
G.isDone     = id => !!G.progress.done[id];
G.allDone    = () => G.cfg.order.every(G.isDone);
G.hasProgress = () => Object.keys(G.progress.done).length > 0;
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
   G.music(src)   — свой трек сцены, зациклен тем же плавным переходом;
   G.music(false) — тишина (у ритм-игры свои песни).
   Если сцену сменили, плейлист запоминает, где остановился, и потом
   продолжает с того же места. Громкость — music.volume, колокольчик глушит всё. */
const MUS = { key: null, list: [], vol: .5, chans: [], saved: {}, last: performance.now() };
const musCfg = () => G.cfg?.music || {};

function musChan(src, idx, at, fadeIn) {
  const el = new Audio(G.asset(src));
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
G.music = (src, vol) => {
  const M = musCfg();
  const list = src === false ? [] : src ? [src] : (M.playlist || []).filter(Boolean);
  const key = src === false ? '' : src || '@playlist';
  MUS.vol = vol ?? (src ? .7 : M.volume ?? .5);
  if (key === MUS.key) return;
  // уходящая программа: запомнить место и плавно погасить
  for (const ch of MUS.chans) {
    if (ch.target > 0 && ch.key === MUS.key && MUS.key === '@playlist') MUS.saved[MUS.key] = { idx: ch.idx, t: ch.el.currentTime || 0 };
    ch.target = 0; ch.fade = 1.2;
  }
  MUS.key = key; MUS.list = list;
  if (!list.length) return;
  const s = MUS.saved[key];
  const idx = s && s.idx < list.length ? s.idx : 0;
  musChan(list[idx], idx, s ? s.t : 0, s ? 1.6 : 1.2);
};
/** раз в кадр: громкость каналов, плавные переходы, конец трека */
function musTick() {
  const now = performance.now(), dt = Math.min(.25, (now - MUS.last) / 1000);
  MUS.last = now;
  const xf = Math.max(.5, musCfg().crossfade ?? 5);
  for (const ch of [...MUS.chans]) {
    const el = ch.el;
    if (ch.f !== ch.target) {
      const step = dt / Math.max(.05, ch.fade);
      ch.f = ch.target > ch.f ? Math.min(ch.target, ch.f + step) : Math.max(ch.target, ch.f - step);
    }
    // равная мощность: сумма двух перетекающих треков звучит одинаково громко
    const v = Math.sin(ch.f * Math.PI / 2) * MUS.vol * (G.soundOn ? 1 : 0);
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
function fit() {
  const k = Math.min((shell.clientWidth - 24) / G.VW, (shell.clientHeight - 24) / G.VH);
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
/** ставит элемент по объекту конфига { x, y, w, h } */
G.place = (el, o) => {
  el._o = o;
  if (o.x != null) el.style.left = o.x + 'px';
  if (o.y != null) el.style.top  = o.y + 'px';
  if (o.w != null) el.style.width = o.w + 'px';
  if (o.h != null) el.style.height = o.h + 'px';
  else if (el._ar && o.w != null) el.style.height = (o.w * el._ar) + 'px';
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

/* ---------------- затемнение при переходах ---------------- */
const fadeEl = $('#fade');
G.fade = async on => {
  fadeEl.classList.toggle('is-on', on);
  await G.sleep(260);
};

/* ---------------- сцены ---------------- */
G.go = async (id, params = {}) => {
  if (G.busy) return;
  G.busy++;
  try {
    await G.fade(true);
    G.overlay?.close(true);
    G.closeDialog();
    G.scene?.leave?.();
    Object.values(G.scenes).forEach(s => { s.root.hidden = true; });
    const sc = G.scenes[id];
    G.scene = sc; G.sceneId = id; G.sceneParams = params;
    document.body.dataset.scene = id;
    sc.root.hidden = false;
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
    next: () => (G.allDone() && !G.progress.finale) ? G.go('finale') : G.go('world', { room: id })
  });
};

/* ---------------- диалоги ---------------- */
const dlg = $('#dialog'), dlgName = $('#dlgName'), dlgText = $('#dlgText'),
      dlgNext = $('#dlgNext'), dlgChoices = $('#dlgChoices');
let dlgState = null;
G.dialogOpen = false;

function typeLine(text) {
  const chars = [...text];
  let i = 0;
  dlgText.textContent = '';
  dlgNext.hidden = true;
  dlgState.typing = true;
  clearInterval(dlgState.timer);
  dlgState.finish = () => {
    clearInterval(dlgState.timer);
    dlgText.textContent = text;
    dlgState.typing = false;
    dlgNext.hidden = !!dlgState.choices;
    if (dlgState.choices) showChoices();
  };
  dlgState.timer = setInterval(() => {
    i++;
    dlgText.textContent = chars.slice(0, i).join('');
    if (i % 2 === 0 && chars[i - 1] !== ' ') G.sfx.talk();
    if (i >= chars.length) dlgState.finish();
  }, 28);
}

function showLine() {
  const s = dlgState;
  let line = s.lines[s.i], name = s.speaker || '';
  if (line && typeof line === 'object') { name = line.name ?? name; line = line.text ?? ''; }
  line = String(line ?? '');
  if (line.startsWith('>')) { name = G.cfg.texts.heroName; line = line.slice(1).trim(); }
  dlgName.textContent = name;
  dlgName.hidden = !name;
  dlg.classList.toggle('is-hero', name === G.cfg.texts.heroName);
  typeLine(line);
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
  const s = dlgState;
  G.sfx.tap();
  endDialog(i);
}
function endDialog(result) {
  const s = dlgState;
  if (!s) return;
  clearInterval(s.timer);
  dlgState = null;
  G.dialogOpen = false;
  dlg.hidden = true;
  dlgChoices.hidden = true;
  s.resolve(result);
}
G.closeDialog = () => endDialog(-1);

function openDialog(lines, speaker, choices) {
  G.closeDialog();
  return new Promise(resolve => {
    lines = (Array.isArray(lines) ? lines : [lines]).filter(l => l != null && l !== '');
    if (!lines.length) { resolve(0); return; }
    dlgState = { lines, i: 0, speaker, choices: null, allChoices: choices, sel: 0, resolve };
    if (choices && lines.length === 1) dlgState.choices = choices;
    G.dialogOpen = true;
    dlg.hidden = false;
    dlgChoices.hidden = true;
    showLine();
  });
}

/** показать реплики по очереди. Строка, начинающаяся с «>», — слова героини */
G.say = (lines, speaker) => openDialog(lines, speaker, null);
/** вопрос с вариантами ответа → номер выбранного */
G.choose = (text, options, speaker) => openDialog([text], speaker, options);

G.dialogNext = () => {
  const s = dlgState;
  if (!s) return;
  if (s.typing) { s.finish(); return; }
  if (s.choices) { pickChoice(s.sel); return; }
  G.sfx.tap();
  s.i++;
  if (s.i >= s.lines.length) { endDialog(0); return; }
  if (s.allChoices && s.i === s.lines.length - 1) s.choices = s.allChoices;
  showLine();
};
dlg.addEventListener('click', () => { if (!G.editing) G.dialogNext(); });

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
