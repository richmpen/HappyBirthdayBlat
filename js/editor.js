/* ============================================================
   editor.js — редактор игры (клавиша F10)
   ------------------------------------------------------------
   • Объекты на экране можно таскать мышкой, колесом менять размер,
     стрелками двигать по пикселю.
   • В панели справа — все тексты, картинки, звуки и числа.
     Картинку/звук можно загрузить со своего компьютера.
   • «Сохранить на сайт» кладёт всё в репозиторий GitHub одним
     коммитом (см. js/github.js). Если игра запущена через start.bat,
     сохранение идёт прямо в папку проекта.
   • Если два художника правили одновременно, их правки сливаются:
     берётся свежая версия с сайта, и на неё накладывается только то,
     что изменил ты.
   ============================================================ */
(() => {
'use strict';
const G = window.G, $ = G.$, esc = G.esc;
const panel = $('#editor'), view = $('#view'), selBox = $('#edsel'), selH = $('#edselH'), selL = $('#edselL');

let sel = null;               // путь выбранного объекта в конфиге
let drag = null;              // перетаскивание / изменение размера
let built = false, local = false, busy = false;
const opened = new Set();     // раскрытые группы настроек
let fileInput = null, refreshT = 0, stateT = 0, noteT = 0;

/* ---------------- подписи полей ---------------- */
const LABELS = {
  x: 'X', y: 'Y', w: 'Ширина', h: 'Высота', img: 'Картинка', bg: 'Фон', name: 'Имя / название', title: 'Заголовок',
  subtitle: 'Подзаголовок', text: 'Текст', label: 'Надпись', lockedText: 'Текст, если дверь закрыта', to: 'Куда ведёт (id комнаты)',
  dialog: 'Диалог (строка с «>» в начале — говорит героиня)', dialogAfter: 'Диалог после прохождения',
  music: 'Музыка', musicVolume: 'Громкость музыки (0–1)',
  walk: 'Зона, где можно ходить', spawn: 'Точка появления', doors: 'Двери', props: 'Предметы-декорации', npc: 'Персонаж', cutscene: 'Катсцена',
  cols: 'Кадров в ряду', rows: 'Рядов', speed: 'Скорость', fps: 'Кадров в секунду',
  rowDown: 'Ряд «идёт вниз»', rowLeft: 'Ряд «идёт влево»', rowRight: 'Ряд «идёт вправо»', rowUp: 'Ряд «идёт вверх»', idleFrame: 'Кадр «стоит»',
  meta: 'Заставка', texts: 'Тексты', player: 'Героиня (спрайт-лист)', rooms: 'Комнаты', kitchen: 'Торт (мини-игра)',
  dressup: 'Одевашка', rhythm: 'Ритм-игра', finale: 'Финал', hub: 'Главная комната',
  startButton: 'Кнопка «начать»', continueButton: 'Кнопка «продолжить»', newGameButton: 'Кнопка «заново»',
  finaleButton: 'Кнопка «финал»', controls: 'Подсказка управления',
  doorLocked: 'Дверь закрыта (общий текст)', hintDoor: 'Подсказка у двери', hintTalk: 'Подсказка у персонажа',
  cutsceneContinue: 'Подсказка в катсцене', replayQuestion: 'Вопрос «сыграть ещё?»', playAgain: 'Ответ «да»', notNow: 'Ответ «нет»',
  heroName: 'Имя героини в диалогах',
  add: 'Шаг 1: ингредиенты', mix: 'Шаг 2: замес', bake: 'Шаг 3: выпечка', decor: 'Шаг 4: украшение',
  hint: 'Подсказка', bowl: 'Миска', imgFull: 'Картинка: миска с ингредиентами', imgDone: 'Картинка: готовое тесто',
  ingredients: 'Ингредиенты (в нужном порядке)', whisk: 'Венчик', turns: 'Сколько кругов мешать', oven: 'Духовка', bar: 'Шкала',
  hits: 'Сколько попаданий нужно', zone: 'Ширина зелёной зоны (0–1)', cake: 'Торт', min: 'Минимум украшений', items: 'Украшения',
  wrong: 'Не тот ингредиент', miss: 'Промах', hit: 'Попадание', exit: 'Кнопка «выйти»', finish: 'Кнопка «готово»',
  tag: 'Подпись под названием', minItems: 'Минимум вещей для «Готово»', base: 'Тело', categories: 'Категории (вкладки)',
  settings: 'Настройки', cardSize: 'Размер карточек', defaultOutfit: 'Наряд по умолчанию', emoji: 'Значок',
  z: 'Слой (z)', limit: 'Сколько можно надеть сразу', id: 'id (лучше не менять)', src: 'Файл', thumb: 'Иконка',
  wardrobe: 'Заголовок гардероба', random: 'Кнопка «рандом»', clear: 'Кнопка «снять всё»', shot: 'Кнопка «фото»',
  done: 'Кнопка «готово»', hello: 'Приветствие', needMore: 'Мало вещей', watermark: 'Подпись на фото',
  difficulties: 'Сложности', gap: 'Мин. пауза между нотами, с', perSec: 'Нот в секунду (не больше)',
  approach: 'Время полёта ноты, с', perfect: 'Окно «идеально», с', good: 'Окно «хорошо», с',
  keys: 'Подписи клавиш', lanes: 'Дорожки', color: 'Цвет', highway: 'Зона дорожек', hitLine: 'Линия попадания (Y)',
  noteSize: 'Размер ноты', offsetMs: 'Сдвиг звука, мс', volume: 'Громкость песни (0–1)', hud: 'Счёт на экране', dancer: 'Танцовщица',
  songs: 'Песни', artist: 'Исполнитель', bpm: 'BPM для танца (0 — авто)', offset: 'Первый удар, с',
  loading: 'Загрузка', score: 'Счёт', combo: 'Комбо', record: 'Рекорд', newRecord: 'Новый рекорд', soon: 'Песни ещё нет',
  again: 'Кнопка «ещё раз»', toSongs: 'Кнопка «к песням»', next: 'Кнопка «дальше»', paused: 'Пауза', resume: 'Продолжить', quit: 'Выйти в меню', play: 'Кнопка «играть»',
  world: 'Дом (комнаты и двери)', scale: 'Увеличение', tile: 'Размер клетки, px', wallH: 'Высота стены, клеток', dark: 'Темнота непосещённых комнат (0–1)',
  voidColor: 'Цвет пустоты', frame: 'Рамка', frame2: 'Рамка (светлая)', start: 'Где начинается игра', wall: 'Текстура стены', floor: 'Текстура пола',
  a: 'Комната A (id)', b: 'Комната B (id)', side: 'Сторона комнаты A: top / left / right', at: 'Отступ вдоль стены, клеток',
  closed: 'Дверь закрыта', open: 'Дверь открыта', solid: 'Преграда (нельзя пройти)', flat: 'Лежит на полу (ковёр)', flip: 'Отразить',
  foot: 'Глубина преграды, px', lift: 'Поднять слой (стоит на столе)', room: 'Комната (id)',
  timeLimit: 'Время на торт, секунд (0 — без таймера)', recipe: 'Рецепт', note: 'Подпись', steps: 'Порядок шагов', decoys: 'Обманки (лишние продукты)',
  amount: 'Количество', gather: 'Шаг: продукты', measure: 'Шаг: отмерить', eggs: 'Шаг: яйца', whisk: 'Шаг: взбить', stack: 'Шаг: коржи', frost: 'Шаг: крем',
  cupboard: 'Шкаф с полками', tray: 'Поднос', shelfInset: 'Нижний отступ полок, px', cup: 'Мерный стакан', fill: 'Область наполнения',
  taper: 'Сужение стакана, px', target: 'Сколько нужно (0–1)', tolerance: 'Допуск', ingredient: 'Продукт (id)', ok: 'Текст «получилось»', over: 'Текст «перебор»',
  count: 'Сколько', radius: 'Радиус цели', period: 'Период кольца, с', shells: 'Осколков скорлупы', shellText: 'Текст про скорлупу',
  left: 'Левая половинка', right: 'Правая половинка', yolk: 'Желток', shell: 'Скорлупка', egg: 'Яйцо',
  seconds: 'Сколько секунд держать', speedMin: 'Темп от, об/с', speedMax: 'Темп до, об/с', dyeAt: 'Когда добавить краситель (0–1)',
  colorFrom: 'Цвет теста в начале', colorTo: 'Цвет теста в конце', dye: 'Краситель', drop: 'Капля', dyeText: 'Текст про краситель',
  tooFast: 'Текст «слишком быстро»', tooHot: 'Текст «горячо»', gaugeLabel: 'Подпись шкалы', rise: 'Скорость нагрева', fall: 'Скорость остывания',
  drift: 'Как быстро гуляет зона', window: 'Окно духовки', inside: 'Нутро духовки', layers: 'Сколько коржей', top: 'Высота, с которой падает',
  swing: 'Размах, px', okDist: 'Допуск «попал», px', perfectDist: 'Допуск «идеально», px', sponge: 'Корж', cream: 'Прослойка крема', plate: 'Тарелка',
  missText: 'Текст «мимо»', need: 'Сколько закрасить (0–1)', brush: 'Размер лопатки, px', spatula: 'Лопатка',
  title2: 'Вторая строка названия', stage: 'Сцена (цвета)', grid: 'Сетка: 1 — доли, 2 — половинки, 4 — четвертушки',
  keep: 'Сколько клеток занято [доли, половинки, четв.]', minGap: 'Мин. пауза между нотами, с', hold: 'Доля длинных нот (0–1)',
  slowBeat: 'Быстрая песня, если доля короче, с', detectLag: 'Запаздывание детектора, с', holdSlack: 'Запас отпускания длинной ноты, с',
  comboEvery: 'Вспышка комбо каждые N', auraCombo: 'Аура танцовщицы с комбо', pixel: 'Пиксельная картинка (без сглаживания)', icon: 'Значок: left/down/up/right/heart/star/circle',
  fx: 'Эффекты (атласы Arcadia Effector)', blend: 'Смешивание: normal / add', loop: 'Зациклен', frames: 'Кадров', fireworkEvery: 'Пауза между залпами, с',
  cherry: 'Падающая вишенка', keysHint: 'Подсказка про клавиши',
  zoom: 'Масштаб персонажа',
  fit: 'Рамка и положение персонажа', cropTop: 'Обрезать пустое сверху (доля высоты, 0–1)', cropBottom: 'Низ рамки (доля высоты, 0–1)', sideMargin: 'Поля по бокам, px',
  fireworks: 'Салют', girls: 'Девочки', flame: 'Огонёк свечи', endTitle: 'Финальный заголовок', endText: 'Финальный текст', backButton: 'Кнопка «в меню»'
};
const TEMPLATES = {
  props: { img: '', x: 480, y: 420, w: 96 },
  doors: { to: 'hub', img: 'assets/sprites/door.png', x: 480, y: 300, w: 96, label: '', lockedText: '' },
  girls: { name: '', img: '', x: 480, y: 390, w: 110 },
  ingredients: { name: 'Новый', img: '', x: 480, y: 168, w: 80 },
  items: { name: 'Новое', img: '', x: 800, y: 300, w: 64 },
  songs: { id: '', title: 'Новая песня', artist: '', src: '', bpm: 0, offset: 0 }
};
const hidden = p => p === 'dressup.items' || p === 'dressup.layout' || p === 'github' || /\.charts$/.test(p);
const IMG_KEYS = /^(img|imgFull|imgDone|bg|thumb|cover|portrait|wall|floor|closed|open|inside|sponge|cream|spatula|yolk|shell|drop|cherry)$/;
const AUD_KEYS = /^(music|audio|sound)$/;
function kind(p, key, val) {
  if (typeof val === 'number') return 'num';
  if (typeof val === 'boolean') return 'bool';
  val = String(val ?? '');
  if (AUD_KEYS.test(key) || /\.(mp3|ogg|wav|m4a)$/i.test(val) || /songs\.\d+\.src$/.test(p)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(val) || G.pending.has(val)) return 'image';
  if (val && !/[\/.]/.test(val)) return /^#[0-9a-f]{6}$/i.test(val) ? 'color' : 'text';
  if (IMG_KEYS.test(key) || key === 'src') return 'image';
  if (/^#[0-9a-f]{6}$/i.test(val)) return 'color';
  return 'text';
}
const itemTitle = (v, i) => String(v.name || v.title || v.label || v.text || v.id || v.to || `№${i + 1}`).slice(0, 34);

/* ---------------- слияние правок двух людей ---------------- */
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** base — что было, mine — мои правки, theirs — что сейчас на сайте */
function merge3(base, mine, theirs) {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const out = {}, b = isObj(base) ? base : {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge3(b[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs) && Array.isArray(base) &&
      mine.length === theirs.length && mine.length === base.length)
    return mine.map((v, i) => merge3(base[i], v, theirs[i]));
  return mine;
}

/* ---------------- файлы ---------------- */
const stamp = () => Date.now().toString(36);
const safeName = n => (n.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file');
function stash(path, blob) {
  const old = G.pending.get(path);
  if (old) URL.revokeObjectURL(old.url);
  G.pending.set(path, { blob, url: URL.createObjectURL(blob) });
  touch();
  return path;
}
function stashFile(file) {
  const ext = (/\.[a-z0-9]+$/i.exec(file.name) || [''])[0].toLowerCase();
  const base = safeName(file.name.replace(/\.[^.]+$/, ''));
  return stash(`assets/uploads/${stamp()}-${base}${ext}`, file);
}
function pickFile(accept, cb) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = () => { const f = fileInput.files[0]; if (f) cb(f); };
  fileInput.click();
}

/* ---------------- состояние «сохранено / есть правки» ---------------- */
const dirty = () => G.pending.size > 0 || !same(G.cfg, G.base);
function paintState() {
  const el = $('#edState');
  if (!el) return;
  const d = dirty();
  el.classList.toggle('is-dirty', d);
  el.textContent = busy ? 'Сохраняю…'
    : d ? `Есть несохранённые правки${G.pending.size ? ` (новых файлов: ${G.pending.size})` : ''}. Их видишь только ты — нажми «Сохранить».`
    : (local ? 'Всё сохранено в папке проекта.' : 'Всё совпадает с сайтом.');
  $('#edSave').disabled = busy;
}
function touch() { clearTimeout(stateT); stateT = setTimeout(paintState, 120); }
function note(text, bad) {
  const el = $('#edNote');
  el.textContent = text;
  el.className = 'ed__toast is-on' + (bad ? ' is-bad' : '');
  clearTimeout(noteT);
  noteT = setTimeout(() => el.classList.remove('is-on'), bad ? 9000 : 5000);
}
function scheduleRefresh() {
  cancelAnimationFrame(refreshT);
  refreshT = requestAnimationFrame(() => G.refresh());
}
function syncInputs(p, src) {
  panel.querySelectorAll(`[data-path="${CSS.escape(p)}"]`).forEach(i => {
    if (i === src || i === document.activeElement || !('value' in i)) return;
    const v = G.get(p);
    if (i.type === 'checkbox') i.checked = !!v; else i.value = v ?? '';
  });
}
/** значение по пути изменилось */
function setVal(p, v, src) {
  G.set(p, v);
  syncInputs(p, src);
  scheduleRefresh();
  touch();
}

/* ============================================================
   ПОЛЯ НАСТРОЕК
   ============================================================ */
function group(path, title) {
  const d = G.el('details', 'ed__grp');
  d.dataset.group = path;
  const s = G.el('summary', '', `<span class="ed__gt">${esc(title)}</span>`);
  const body = G.el('div', 'ed__grpbody');
  d.append(s, body);
  let filled = false;
  const fill = () => { if (!filled) { filled = true; fields(body, path); } };
  d.addEventListener('toggle', () => { if (d.open) { opened.add(path); fill(); } else opened.delete(path); });
  if (opened.has(path)) { d.open = true; fill(); }
  return d;
}

function mediaField(p, title, val, isAudio) {
  const wrap = G.el('div', 'ed__f ed__f--media');
  wrap.innerHTML =
    `<span class="ed__k">${esc(title)}</span>
     <div class="ed__media">
       <span class="ed__thumb">${isAudio ? '♪' : '<img class="px" alt="">'}</span>
       <div class="ed__mbtns">
         <button type="button" class="ed__btn" data-a="pick">${isAudio ? 'Загрузить звук…' : 'Загрузить картинку…'}</button>
         ${isAudio ? '<button type="button" class="ed__btn" data-a="play">▶</button>' : ''}
         <button type="button" class="ed__btn" data-a="clear" title="Убрать">✕</button>
       </div>
     </div>
     <input class="ed__path" type="text" spellcheck="false" placeholder="путь к файлу">`;
  const inp = wrap.querySelector('.ed__path'), im = wrap.querySelector('img');
  inp.dataset.path = p;
  const show = v => {
    inp.value = v || '';
    if (im) { im.src = G.asset(v) || ''; im.style.visibility = v ? '' : 'hidden'; }
  };
  show(val);
  inp.oninput = () => { setVal(p, inp.value.trim(), inp); if (im) { im.src = G.asset(inp.value.trim()); im.style.visibility = inp.value ? '' : 'hidden'; } };
  let audio = null;
  wrap.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pick') pickFile(isAudio ? 'audio/*' : 'image/*', f => { const path = stashFile(f); setVal(p, path); show(path); });
    if (a === 'clear') { setVal(p, ''); show(''); }
    if (a === 'play') {
      if (audio) { audio.pause(); audio = null; return; }
      const v = G.get(p);
      if (!v) return;
      audio = new Audio(G.asset(v));
      audio.play().catch(() => {});
      audio.onended = () => { audio = null; };
    }
  };
  return wrap;
}

function field(p, key, val, title) {
  title ??= LABELS[key] || key;
  if (val && typeof val === 'object')
    return group(p, title + (Array.isArray(val) ? ` · ${val.length}` : ''));
  const k = kind(p, key, val);
  if (k === 'image' || k === 'audio') return mediaField(p, title, val, k === 'audio');

  const row = G.el('label', 'ed__f ed__f--' + k, `<span class="ed__k">${esc(title)}</span>`);
  let inp;
  if (k === 'num') {
    inp = G.el('input'); inp.type = 'number'; inp.step = 'any'; inp.value = val;
    inp.oninput = () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) setVal(p, v, inp); };
  } else if (k === 'bool') {
    inp = G.el('input'); inp.type = 'checkbox'; inp.checked = !!val;
    inp.onchange = () => setVal(p, inp.checked, inp);
  } else if (k === 'color') {
    inp = G.el('input'); inp.type = 'color'; inp.value = val;
    inp.oninput = () => setVal(p, inp.value, inp);
  } else {
    inp = G.el('textarea'); inp.rows = Math.min(5, Math.max(1, Math.ceil(String(val ?? '').length / 30)));
    inp.value = val ?? ''; inp.spellcheck = false;
    inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 2 + 'px'; setVal(p, inp.value, inp); };
  }
  inp.dataset.path = p;
  row.appendChild(inp);
  return row;
}

function arrayFields(box, path, arr) {
  const key = path.split('.').pop();
  const act = (label, tip, fn) => {
    const b = G.el('button', 'ed__mini', label);
    b.type = 'button'; b.title = tip;
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); fn(); structural(); };
    return b;
  };
  arr.forEach((v, i) => {
    const p = `${path}.${i}`;
    const tools = G.el('span', 'ed__tools');
    if (i > 0) tools.appendChild(act('↑', 'Выше', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }));
    if (i < arr.length - 1) tools.appendChild(act('↓', 'Ниже', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }));
    tools.appendChild(act('✕', 'Удалить', () => { arr.splice(i, 1); if (sel && sel.startsWith(path + '.')) sel = null; }));
    if (v && typeof v === 'object') {
      const g = group(p, itemTitle(v, i));
      g.querySelector('summary').appendChild(tools);
      box.appendChild(g);
    } else {
      const row = G.el('div', 'ed__item');
      row.append(field(p, String(i), v, String(i + 1)), tools);
      box.appendChild(row);
    }
  });
  const add = G.el('button', 'ed__btn ed__add', '+ Добавить');
  add.type = 'button';
  add.onclick = () => {
    const last = arr[arr.length - 1];
    let item = last !== undefined ? G.clone(last) : (TEMPLATES[key] !== undefined ? G.clone(TEMPLATES[key]) : '');
    if (path === 'finale.dialog' && last === undefined) item = { name: '', text: '' };
    if (typeof item === 'string') item = '';
    if (isObj(item) && 'id' in item && key === 'songs') { item.id = 'song-' + stamp(); item.src = ''; delete item.charts; }
    arr.push(item);
    opened.add(`${path}.${arr.length - 1}`);
    structural();
  };
  box.appendChild(add);
}

function fields(box, path) {
  const obj = path ? G.get(path) : G.cfg;
  if (obj == null) { box.innerHTML = '<p class="ed__note">Пусто</p>'; return; }
  if (Array.isArray(obj)) { arrayFields(box, path, obj); return; }
  Object.keys(obj).forEach(key => {
    const p = path ? `${path}.${key}` : key;
    if (!hidden(p)) box.appendChild(field(p, key, obj[key]));
  });
}

/** изменилась структура (добавили/удалили/переставили) — перестраиваем панель */
function structural() {
  touch();
  G.refresh();
  rebuild();
}

/* ============================================================
   ПАНЕЛЬ
   ============================================================ */
function pathTitle(path) {
  const ks = path.split('.'), last = ks[ks.length - 1], o = G.get(path);
  if (/^\d+$/.test(last)) return `${LABELS[ks[ks.length - 2]] || ks[ks.length - 2]}: ${itemTitle(o || {}, +last)}`;
  return LABELS[last] || last;
}

function buildSel() {
  const box = $('#edSel');
  box.innerHTML = '';
  if (!sel || G.get(sel) == null) {
    box.innerHTML = '<p class="ed__note">Кликни по объекту на экране: его можно тащить мышкой, колесо меняет размер, стрелки двигают по пикселю (Shift — по 10).</p>';
    return;
  }
  box.appendChild(G.el('div', 'ed__seltitle', esc(pathTitle(sel))));
  fields(box, sel);
}

function buildScene() {
  const sc = G.scene;
  $('#edScene').textContent = ({ title: 'заставка', world: 'дом', kitchen: 'торт', dressup: 'одевашка',
    rhythm: 'ритм-игра', cutscene: 'катсцена', finale: 'финал' })[G.sceneId] || '';
  const tools = $('#edTools'), tsec = $('#edToolsSec');
  tools.innerHTML = '';
  tsec.hidden = !sc?.editorTools;
  if (sc?.editorTools) sc.editorTools(tools);

  const box = $('#edRoots');
  box.innerHTML = '';
  (sc?.editRoots?.() || []).forEach((r, i) => {
    if (G.get(r.path) == null) return;
    if (i === 0) opened.add(r.path);
    box.appendChild(group(r.path, r.label));
  });
}

function buildAll() {
  const box = $('#edAll');
  box.innerHTML = '';
  fields(box, '');
}

function buildNav() {
  const box = $('#edNavBox');
  const R = G.cfg.world.rooms, rooms = Object.keys(R);
  const items = [
    ['title', 'Заставка'],
    ...rooms.map(r => [`room:${r}`, '🚪 ' + R[r].name]),
    ['kitchen:0', '🎂 Торт'], ['dressup', '👗 Одевашка'], ['rhythm', '🎵 Ритм'],
    ...rooms.filter(r => R[r].cutscene).map(r => [`cutscene:${r}`, '🖼 Катсцена: ' + R[r].name]),
    ['finale', '🎆 Финал']
  ];
  box.innerHTML = '';
  const row = G.el('div', 'ed__row ed__row--wrap');
  items.forEach(([spec, label]) => {
    const b = G.el('button', 'ed__btn', esc(label));
    b.onclick = () => G.jump(spec);
    row.appendChild(b);
  });
  box.appendChild(row);
  const row2 = G.el('div', 'ed__row');
  const un = G.el('button', 'ed__btn' + (G.progress.unlockAll ? ' is-on' : ''), '🔓 Все двери открыты');
  un.onclick = () => { G.progress.unlockAll = !G.progress.unlockAll; G.saveProgress(); G.refresh(); buildNav(); };
  const rs = G.el('button', 'ed__btn', '↺ Сбросить мой прогресс');
  rs.onclick = () => { if (confirm('Сбросить твой прогресс и рекорды в этом браузере?')) { G.resetProgress(); G.refresh(); buildNav(); } };
  row2.append(un, rs);
  box.appendChild(row2);
}

function buildGithub() {
  const s = G.github.settings(), box = $('#edGhBox');
  box.innerHTML =
    (local ? '<p class="ed__note ed__note--ok">Игра запущена с компьютера (start.bat): «Сохранить» пишет прямо в папку проекта, токен не нужен. Поля ниже нужны только на сайте.</p>' : '') +
    `<label class="ed__f"><span class="ed__k">Владелец (логин GitHub)</span><input type="text" id="ghOwner" value="${esc(s.owner)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Репозиторий</span><input type="text" id="ghRepo" value="${esc(s.repo)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Ветка</span><input type="text" id="ghBranch" value="${esc(s.branch)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Токен доступа</span><input type="password" id="ghToken" value="${esc(s.token)}" autocomplete="off" placeholder="github_pat_…"></label>
     <div class="ed__row"><button class="ed__btn" id="ghCheck">Проверить доступ</button></div>
     <div class="ed__note" id="ghMsg"></div>
     <p class="ed__note">Токен вводится один раз и хранится только в твоём браузере.<br>
       <b>Владелец репозитория:</b> <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">создать Fine-grained token</a> →
       Repository access: <b>Only select repositories</b> → этот репозиторий → Permissions → <b>Contents: Read and write</b>.
       Такой токен умеет менять только этот сайт, поэтому его можно лично передать художникам.<br>
       <b>Соавтор (Collaborator):</b> <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=cherry-game" target="_blank" rel="noopener">создать classic-токен</a> с галочкой <b>public_repo</b>.</p>`;
  const read = () => G.github.store({
    owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(),
    branch: $('#ghBranch').value.trim() || 'main', token: $('#ghToken').value.trim()
  });
  ['#ghOwner', '#ghRepo', '#ghBranch', '#ghToken'].forEach(q => { $(q).oninput = read; });
  $('#ghCheck').onclick = async () => {
    read();
    const msg = $('#ghMsg');
    msg.textContent = 'Проверяю…'; msg.className = 'ed__note';
    try {
      const r = await G.github.check();
      msg.textContent = r.canPush ? `✓ Доступ есть: ${r.name}. Можно сохранять.` : `Репозиторий ${r.name} виден, но права записи нет.`;
      msg.className = 'ed__note ' + (r.canPush ? 'ed__note--ok' : 'ed__note--bad');
    } catch (e) { msg.textContent = '✕ ' + e.message; msg.className = 'ed__note ed__note--bad'; }
  };
}

function build() {
  built = true;
  panel.innerHTML = `
    <div class="ed__head"><b>🍒 Редактор</b><span id="edScene"></span><button id="edClose" title="Закрыть (F10)">✕</button></div>
    <div class="ed__save">
      <div class="ed__state" id="edState"></div>
      <div class="ed__row">
        <button class="ed__btn ed__btn--main" id="edSave">💾 Сохранить на сайт</button>
        <button class="ed__btn" id="edRevert" title="Вернуть всё как на сайте">↺ Отменить правки</button>
      </div>
    </div>
    <div class="ed__body">
      <details class="ed__sec" open><summary>🎯 Выбранный объект</summary><div id="edSel"></div></details>
      <details class="ed__sec" open id="edToolsSec"><summary>🛠 Инструменты этой сцены</summary><div id="edTools"></div></details>
      <details class="ed__sec" open><summary>📄 Настройки этой сцены</summary><div id="edRoots"></div></details>
      <details class="ed__sec"><summary>🚪 Перейти в другое место игры</summary><div id="edNavBox"></div></details>
      <details class="ed__sec"><summary>🗂 Все настройки игры</summary><div id="edAll"></div></details>
      <details class="ed__sec" id="edGh"><summary>⚙ Доступ к GitHub (для сохранения)</summary><div id="edGhBox"></div></details>
      <details class="ed__sec"><summary>📦 Файл настроек</summary>
        <p class="ed__note">Все настройки — один файл <code>data/game.json</code>. Его можно скачать про запас или загрузить обратно.</p>
        <div class="ed__row"><button class="ed__btn" id="edExport">⬇ Скачать</button><button class="ed__btn" id="edImport">⬆ Загрузить</button></div>
      </details>
    </div>
    <div class="ed__toast" id="edNote"></div>
    <input type="file" id="edFile" hidden>`;
  fileInput = $('#edFile');
  $('#edClose').onclick = () => api.toggle(false);
  $('#edSave').onclick = save;
  $('#edRevert').onclick = () => {
    if (!dirty()) { note('Правок нет'); return; }
    if (!confirm('Отменить все несохранённые правки?')) return;
    G.cfg = G.clone(G.base);
    G.pending.forEach(f => URL.revokeObjectURL(f.url));
    G.pending.clear();
    sel = null;
    G.refresh(); rebuild(); paintState();
    note('Правки отменены');
  };
  $('#edExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(G.cfg, null, 2)], { type: 'application/json' }));
    a.download = 'game.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('#edImport').onclick = () => pickFile('.json,application/json', async f => {
    try {
      const c = JSON.parse(await f.text());
      if (!c.world || !c.meta) throw new Error('это не файл настроек игры');
      G.cfg = c; sel = null;
      G.refresh(); rebuild(); paintState();
      note('Настройки загружены. Чтобы они попали на сайт — «Сохранить»');
    } catch (e) { note('Не получилось: ' + e.message, true); }
  });
}

function rebuild() {
  if (!built || !G.editing) return;
  buildSel(); buildScene(); buildAll(); buildNav(); buildGithub();
}

/* ============================================================
   СОХРАНЕНИЕ
   ============================================================ */
const toBase64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = rej;
  fr.readAsDataURL(blob);
});

async function save() {
  if (busy) return;
  if (!dirty()) { note('Сохранять нечего — правок нет'); return; }
  if (!local && !G.github.ready()) {
    $('#edGh').open = true;
    $('#edGh').scrollIntoView({ behavior: 'smooth' });
    note('Сначала заполни «Доступ к GitHub»: нужен токен', true);
    return;
  }
  busy = true; paintState();
  try {
    // в репозиторий идут только файлы, на которые ещё ссылается конфиг
    const text = JSON.stringify(G.cfg);
    const files = [...G.pending].filter(([p]) => text.includes(JSON.stringify(p))).map(([path, f]) => ({ path, blob: f.blob }));
    let result = G.cfg;
    if (local) {
      const body = { config: G.cfg, files: [] };
      for (const f of files) body.files.push({ path: f.path, base64: await toBase64(f.blob) });
      const r = await fetch('/__api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('локальный сервер ответил ' + r.status);
    } else {
      const res = await G.github.commit({
        files,
        buildConfig: remote => remote ? merge3(G.base, G.cfg, remote) : G.cfg,
        message: `Редактор: правки игры${files.length ? ` (+${files.length} файл.)` : ''}`,
        onStep: t => { $('#edState').textContent = t; }
      });
      result = res.cfg;
    }
    G.pending.forEach((f, p) => G.fresh.set(p, f));
    G.pending.clear();
    G.cfg = result;
    G.base = G.clone(result);
    busy = false;
    G.refresh(); rebuild(); paintState();
    note(local ? 'Сохранено в папку проекта 🍒' : 'Сохранено! Сайт обновится у всех через 1–2 минуты 🍒');
  } catch (e) {
    console.error(e);
    busy = false; paintState();
    note('Не сохранилось: ' + e.message, true);
  }
}

/* ============================================================
   ПЕРЕТАСКИВАНИЕ ОБЪЕКТОВ НА ЭКРАНЕ
   ============================================================ */
function select(path) {
  sel = path;
  buildSel();
  if (built && G.editing && G.scene?.selectTools) G.scene.editorTools($('#edTools'));
  if (path) panel.querySelector('.ed__body').scrollTop = 0;
}
const selEl = () => sel ? view.querySelector(`[data-edit="${CSS.escape(sel)}"]`) : null;
const movable = o => o && typeof o.x === 'number' && typeof o.y === 'number';

function live(path, el, o) {
  if (el) G.place(el, o);
  ['x', 'y', 'w', 'h'].forEach(k => { if (typeof o[k] === 'number') syncInputs(`${path}.${k}`); });
  touch();
}

view.addEventListener('pointerdown', e => {
  if (!G.editing) return;
  e.preventDefault(); e.stopPropagation();
  const t = e.target.closest('[data-edit]');
  if (!t) { select(null); G.scene?.editPan?.(e); return; }
  const path = t.dataset.edit, o = G.get(path);
  if (sel !== path) select(path);
  if (!movable(o) || t.dataset.nodrag) { G.scene?.editPan?.(e); return; }
  const unit = +(t.closest('[data-unit]')?.dataset.unit || 1);
  drag = { mode: 'move', path, el: t, o, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false, unit };
  view.setPointerCapture(e.pointerId);
}, true);

selH.addEventListener('pointerdown', e => {
  const el = selEl(), o = sel && G.get(sel);
  if (!o || typeof o.w !== 'number') return;
  e.preventDefault(); e.stopPropagation();
  drag = { mode: 'size', path: sel, el, o, sx: e.clientX, sy: e.clientY, ow: o.w, oh: o.h, moved: false, unit: +(el?.closest('[data-unit]')?.dataset.unit || 1) };
  selH.setPointerCapture(e.pointerId);
});

function onMove(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) / G.k / drag.unit, dy = (e.clientY - drag.sy) / G.k / drag.unit, o = drag.o;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
  drag.moved = true;
  if (drag.mode === 'move') {
    o.x = Math.round(drag.ox + dx);
    o.y = Math.round(drag.oy + dy);
  } else if (typeof o.h === 'number') {          // зона: ширина и высота отдельно
    o.w = Math.max(10, Math.round(drag.ow + dx));
    o.h = Math.max(10, Math.round(drag.oh + dy));
  } else {
    o.w = Math.max(6, Math.round(drag.ow + dx * 2)); // картинка: пропорции сохраняются
  }
  live(drag.path, drag.el, o);
}
function onUp() {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  if (moved) G.refresh();
}
view.addEventListener('pointermove', e => { if (G.editing) { e.stopPropagation(); onMove(e); } }, true);
selH.addEventListener('pointermove', onMove);
['pointerup', 'pointercancel'].forEach(ev => {
  view.addEventListener(ev, e => { if (G.editing) { e.stopPropagation(); onUp(); } }, true);
  selH.addEventListener(ev, onUp);
});
// при открытом редакторе клики по игре не срабатывают
view.addEventListener('click', e => { if (G.editing) { e.preventDefault(); e.stopPropagation(); } }, true);

view.addEventListener('wheel', e => {
  if (!G.editing || !sel) return;
  const o = G.get(sel);
  if (!o || typeof o.w !== 'number') return;
  e.preventDefault();
  const k = e.deltaY > 0 ? .96 : 1.04;
  o.w = Math.max(6, G.round(o.w * k, 1));
  if (typeof o.h === 'number') o.h = Math.max(6, G.round(o.h * k, 1));
  live(sel, selEl(), o);
  scheduleRefresh();
}, { passive: false });

/* ============================================================
   ВНЕШНИЙ ИНТЕРФЕЙС
   ============================================================ */
const api = G.editor = {
  init() {
    // игра запущена через tools/server.js → можно писать прямо на диск
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname))
      fetch('/__api/ping').then(r => r.ok && r.json()).then(j => { if (j?.ok) { local = true; if (G.editing) { buildGithub(); paintState(); } } }).catch(() => {});
    addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
    if (new URLSearchParams(location.search).has('edit')) this.toggle(true);
  },

  toggle(force) {
    const on = force ?? !G.editing;
    if (on === G.editing) return;
    G.editing = on;
    G.keys.clear();
    panel.hidden = !on;
    document.body.classList.toggle('editing', on);
    if (on) { if (!built) build(); rebuild(); paintState(); }
    else { sel = null; drag = null; selBox.hidden = true; }
    G.scene?.onEdit?.(on);
    G.fit();
  },

  /** сцена сменилась или сменился её экран — обновить панель */
  sceneChanged() {
    if (!G.editing || !built) return;
    if (sel && G.get(sel) == null) sel = null;
    rebuild();
  },
  toolsChanged() {
    if (!G.editing || !built || !G.scene?.editorTools) return;
    G.scene.editorTools($('#edTools'));
  },

  /** сцена сама поменяла конфиг (например, одевашка подвинула вещь) */
  changed: touch,
  stash, stashFile, pickFile, note,
  get sel() { return sel; },
  select(path) { select(path); G.scene?.editorTools && this.toolsChanged(); },
  /** перестроить панель после добавления/удаления объектов */
  structural,

  /** клавиши в режиме редактора; true — клавиша обработана */
  key(e) {
    if (G.scene?.editKey) return G.scene.editKey(e);
    const o = sel && G.get(sel);
    if (e.code === 'Escape') { select(null); return true; }
    if (!movable(o)) return false;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.code];
    if (!d) return false;
    o.x += d[0]; o.y += d[1];
    live(sel, selEl(), o);
    scheduleRefresh();
    return true;
  },

  /** рамка вокруг выбранного объекта */
  tick() {
    if (!G.editing || !sel) { if (!selBox.hidden) selBox.hidden = true; return; }
    const el = selEl();
    if (!el) { selBox.hidden = true; return; }
    const r = el.getBoundingClientRect(), o = G.get(sel);
    selBox.hidden = false;
    selBox.style.left = r.left + 'px'; selBox.style.top = r.top + 'px';
    selBox.style.width = r.width + 'px'; selBox.style.height = r.height + 'px';
    selH.hidden = !(o && typeof o.w === 'number') || !!el.dataset.nodrag;
    const label = movable(o) ? `${Math.round(o.x)}, ${Math.round(o.y)}${typeof o.w === 'number' ? ' · ' + Math.round(o.w) : ''}` : '';
    if (selL.textContent !== label) selL.textContent = label;
  },

  merge3
};

})();
