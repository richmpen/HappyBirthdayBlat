/* ============================================================
   editor.js — редактор игры (F10 — настройки, F11 — слои)
   ------------------------------------------------------------
   • Объекты на экране можно таскать мышкой, колесом менять размер,
     стрелками двигать по пикселю.
   • F11 — список слоёв сцены: у каждой картинки — замена из набора
     (все картинки проекта) или со своего компьютера, слой выше/ниже,
     спрятать, дублировать, удалить.
   • Диалоги персонажей — как в новелле: у каждой фразы кто говорит,
     текст, спрайт слева и картинка на весь экран.
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
let localGit = null;                 // { name, branch } — start.bat сам отправляет правки на GitHub
const opened = new Set();     // раскрытые группы настроек
let fileInput = null, refreshT = 0, stateT = 0, noteT = 0;

/* ---------------- подписи полей ---------------- */
const LABELS = {
  x: 'X', y: 'Y', w: 'Ширина', h: 'Высота', img: 'Картинка', bg: 'Фон', name: 'Имя / название', title: 'Заголовок',
  subtitle: 'Подзаголовок', text: 'Текст', label: 'Надпись', lockedText: 'Текст, если дверь закрыта', to: 'Куда ведёт (id комнаты)',
  dialog: 'Диалог (строка с «>» в начале — говорит героиня)', dialogAfter: 'Диалог после прохождения',
  music: 'Музыка (пусто — общая музыка игры)', musicVolume: 'Громкость музыки (0–1)',
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
  fireworks: 'Салют', girls: 'Девочки', flame: 'Огонёк свечи', endTitle: 'Финальный заголовок', endText: 'Финальный текст', backButton: 'Кнопка «в меню»',
  artW: 'Ширина макета, px', neon: 'Неоновый цвет', back: 'Сцена: задний план', band: 'Персонажи (кадры меняются в такт)',
  front: 'Сцена: перед персонажами', overlay: 'Сцена: поверх нот', phrases: 'Фразы во время игры', phraseShow: 'Фраза видна, с',
  phraseGap: 'Пауза между фразами, с', frames: 'Кадры', every: 'Менять кадр каждые N долей', bounce: 'Подскок на долю, px',
  anim: 'Анимация: beam / glow / pulse / sway / twinkle', pivot: 'Точка привязки [0–1, 0–1]', phase: 'Сдвиг анимации',
  swing: 'Размах качания, °', alpha: 'Прозрачность (0–1)', ring: 'Кольцо кнопки', ringFill: 'Середина кнопки', ringSize: 'Размер кнопки',
  burst: 'Вспышка попадания', keySize: 'Размер букв клавиш', progress: 'Полоска песни', pause: 'Кнопка паузы', stars: 'Звёзды',
  starAt: 'Звёзды за долю идеального счёта', on: 'Звезда получена', off: 'Звезда пустая', menu: 'Меню (рамка)', maxRes: 'Макс. чёткость холста',
  walk: 'Порядок кадров шага (столбцы)', girlScale: 'Увеличение девочек на заставке', rim: 'Толщина бортика миски, px', stages: 'Тесто по стадиям (от светлого к красному)',
  art: 'Макет (слои, кнопки, искорки)', candles: 'Огоньки свечей', sparkles: 'Большие искорки',
  pill: 'Плашка подсказки', buttons: 'Кнопки (x — левый край, y — середина столбика)', bell: 'Кнопка звука', gallery: 'Галерея', galleryButton: 'Кнопка «галерея»',
  hints: 'Подсказки управления (сменяют друг друга)', edgeTop: 'Полоса рамки сверху', edgeBottom: 'Полоса рамки снизу', flower: 'Цветочек под круглые кнопки',
  btnDark: 'Кнопка (тёмная)', btnLight: 'Кнопка (светлая)', sparkleImg: 'Картинка искорки', playImg: 'Значок ▶', cherryImg: 'Значок вишенки', bellImg: 'Колокольчик',
  enter: 'Как появляется: left / up / drop / pop / fade', inDelay: 'Задержка появления, с',
  move: 'Стакан ездит { swing — размах, px; speed — скорость; faster — быстрее с каждым продуктом }', miss: 'Текст «мимо»',
  framed: 'Рамка вокруг катсцены',
  duck: 'Музыка в диалогах и катсценах (доля громкости, 0–1)', duckFade: 'Плавность приглушения, с',
  playlist: 'Песни по очереди', crossfade: 'Плавный переход между песнями, с', video: 'Видео (по кругу)',
  lena: 'Лена', balloons: 'Шарики', candle: 'Свечка (основание огонька)', spotlight: 'Гости появляются из полумрака', shadeColor: 'Цвет полумрака',
  light: 'Свет над гостем { dy, r }', wish: 'Реплика «загадай желание»', wishName: 'Кто говорит «загадай желание»', wishHint: 'Подсказка у свечки',
  end: 'Финальный экран', love: 'Строка «мы тебя любим»', heart: 'Сердечко', button: 'Кнопка', textImg: 'Надпись на кнопке',
  unlock: 'Когда открывается: пусто / all / kitchen / dressup / rhythm / finale / wish', locked: 'Надпись «закрыто»', close: 'Кнопка «закрыть»',
  garlandLeft: 'Гирлянда слева', garlandRight: 'Гирлянда справа',
  chars: 'Другие персонажи (просто разговор)', danceImg: 'Картинка «танцует» (после разговора)', danceWait: 'Пауза перед игрой, с',
  who: 'Кто говорит', sprite: 'Спрайт слева', pic: 'Картинка на весь экран', spriteEvery: 'Смена кадров спрайта, с',
  hide: 'Спрятан', novel: 'Портрет в диалогах (общий): x — середина, y — низ, h — высота', portrait: 'Портрет в диалоге (свой размер и место)', talkAfterGame: 'Сам заговаривает после мини-игры', dough: 'Тесто (поднимается из противня)', riseFrom: 'Насколько тесто сначала в противне, px', lift: 'Слой выше / ниже (+/−)'
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
const IMG_KEYS = /^(img|sprite|pic|danceImg|dough|imgFull|imgDone|bg|thumb|cover|portrait|wall|floor|closed|open|inside|sponge|cream|spatula|yolk|shell|drop|cherry|frame|flower|btnDark|btnLight|sparkleImg|playImg|cherryImg|bellImg|edgeTop|edgeBottom|textImg|garlandLeft|garlandRight)$/;
const AUD_KEYS = /^(music|audio|sound)$/;
function kind(p, key, val) {
  if (typeof val === 'number') return 'num';
  if (typeof val === 'boolean') return 'bool';
  val = String(val ?? '');
  if (AUD_KEYS.test(key) || /\.(mp3|ogg|wav|m4a)$/i.test(val) || /songs\.\d+\.src$/.test(p)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(val) || G.pending.has(val)) return 'image';
  if (/\.(mp4|webm)$/i.test(val) || key === 'video') return 'video';
  if (val && !/[\/.]/.test(val)) return /^#[0-9a-f]{6}$/i.test(val) ? 'color' : 'text';
  if (IMG_KEYS.test(key) || key === 'src') return 'image';
  if (/^#[0-9a-f]{6}$/i.test(val)) return 'color';
  return 'text';
}
const itemTitle = (v, i) => String(v.name || v.title || v.label || v.text || v.id || v.to || (typeof v.img === 'string' && v.img.split('/').pop()) || `№${i + 1}`).slice(0, 34);

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
    : (localGit ? 'Правок нет. Всё, что сохранишь, само уйдёт на GitHub.' : local ? 'Всё сохранено в папке проекта.' : 'Всё совпадает с сайтом.');
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

function mediaField(p, title, val, isAudio, isVideo) {
  const wrap = G.el('div', 'ed__f ed__f--media');
  wrap.innerHTML =
    `<span class="ed__k">${esc(title)}</span>
     <div class="ed__media">
       <span class="ed__thumb">${isAudio ? '♪' : isVideo ? '🎬' : '<img class="px" alt="">'}</span>
       <div class="ed__mbtns">
         <button type="button" class="ed__btn" data-a="pick">${isAudio ? 'Загрузить звук…' : isVideo ? 'Загрузить видео…' : 'Загрузить картинку…'}</button>
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
    if (a === 'pick') pickFile(isAudio ? 'audio/*' : isVideo ? 'video/*' : 'image/*', f => { const path = stashFile(f); setVal(p, path); show(path); });
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
  if (k === 'image' || k === 'audio' || k === 'video') return mediaField(p, title, val, k === 'audio', k === 'video');

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
  if (Array.isArray(obj)) { (DLG_PATH.test(path) ? novelFields : arrayFields)(box, path, obj); return; }
  Object.keys(obj).forEach(key => {
    const p = path ? `${path}.${key}` : key;
    if (!hidden(p)) box.appendChild(field(p, key, obj[key]));
  });
}

/** изменилась структура (добавили/удалили/переставили) — перестраиваем панель */
function structural() {
  touch();
  G.refresh();
  G.dialogRefresh?.();
  rebuild();
}

/* ============================================================
   НАБОР КАРТИНОК: выбрать из всех картинок проекта или загрузить свою
   ============================================================ */
let picker = null;
function closePicker() { picker?.remove(); picker = null; }
async function pickAsset(cb, opt = {}) {
  closePicker();
  const list = await G.assetList();
  const groups = new Map();
  for (const p of list) {
    const d = p.slice(0, p.lastIndexOf('/') + 1);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(p);
  }
  const pref = d => (opt.prefer && d.startsWith(opt.prefer) ? 0 : 1);
  const dirs = [...groups.keys()].sort((a, b) => pref(a) - pref(b) || a.localeCompare(b));
  picker = G.el('div', 'edpick');
  picker.innerHTML =
    `<div class="edpick__box">
       <div class="edpick__head"><b>${esc(opt.title || 'Выбери картинку')}</b>
         <input type="search" placeholder="поиск по имени файла…" spellcheck="false">
         <button class="ed__btn" data-a="up">⬆ Своя картинка…</button><button class="ed__btn" data-a="x" title="Закрыть (Esc)">✕</button></div>
       <div class="edpick__body"></div>
     </div>`;
  const body = picker.querySelector('.edpick__body'), search = picker.querySelector('input');
  const done = p => { closePicker(); cb(p); };
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    body.innerHTML = '';
    for (const d of dirs) {
      const items = groups.get(d).filter(p => !q || p.toLowerCase().includes(q));
      if (!items.length) continue;
      body.appendChild(G.el('div', 'ed__label', esc(d.replace(/^assets\//, '').replace(/\/$/, '') || 'assets')));
      const grid = G.el('div', 'ed__palgrid');
      items.forEach(p => {
        const b = G.el('button', 'ed__palitem', `<img loading="lazy" class="${/\.png$/i.test(p) ? 'px' : ''}" src="${G.asset(p)}" alt="">`);
        b.type = 'button'; b.title = p.split('/').pop();
        b.onclick = () => done(p);
        grid.appendChild(b);
      });
      body.appendChild(grid);
    }
    if (!body.childElementCount) body.innerHTML = '<p class="ed__note">Ничего не нашлось</p>';
  };
  search.oninput = fill;
  search.onkeydown = e => { if (e.key === 'Escape') closePicker(); };
  picker.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'x' || e.target === picker) closePicker();
    if (a === 'up') pickFile('image/*', f => done(stashFile(f)));
  };
  fill();
  document.body.appendChild(picker);
  search.focus();
}

/* ============================================================
   СЛОИ (F11): все картинки сцены, сверху — то, что выше
   ============================================================ */
let layersMode = false;
const imgKeyOf = o => ['img', 'src', 'bg', 'sprite', 'thumb'].find(k => typeof o[k] === 'string')
  || Object.keys(o).find(k => typeof o[k] === 'string' && IMG_KEYS.test(k));
function layerItems() {
  const seen = new Set(), out = [];
  view.querySelectorAll('[data-edit]').forEach((el, i) => {
    const path = el.dataset.edit, o = G.get(path);
    if (seen.has(path) || !o || typeof o !== 'object' || Array.isArray(o)) return;
    const key = imgKeyOf(o);
    if (!key) return;
    seen.add(path);
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    out.push({ el, path, o, key, z: Number.isNaN(z) ? 0 : z, i });
  });
  return out.sort((a, b) => (b.z - a.z) || (b.i - a.i));
}
/** слой выше (d = 1) или ниже (d = −1) соседа */
function shiftLayer(it, d, items) {
  const asc = [...items].reverse(), nb = asc[asc.indexOf(it) + d];
  if (!nb) return;
  if (/^world\./.test(it.path)) {           // в доме слой считается по «ногам», сдвигаем поправкой
    it.o.lift = (it.o.lift || 0) + (nb.z - it.z) + d;
    if (!it.o.lift) delete it.o.lift;
  } else it.o.z = Math.max(0, nb.z + d);
}
function buildLayers() {
  const box = $('#edLayers');
  if (!box) return;
  const items = layerItems();
  box.innerHTML = items.length ? '' : '<p class="ed__note">В этой сцене нет картинок-слоёв. (У одевашки свои инструменты — ниже.)</p>';
  items.forEach(it => {
    const parent = it.path.replace(/\.\d+$/, ''), idx = /\.(\d+)$/.exec(it.path)?.[1], arr = idx != null && G.get(parent);
    const inArr = Array.isArray(arr);
    const row = G.el('div', 'edl' + (it.path === sel ? ' is-sel' : '') + (it.o.hide ? ' is-off' : ''));
    const src = it.o[it.key];
    row.innerHTML =
      `<span class="edl__th">${src ? `<img class="px" src="${G.asset(src)}" alt="">` : '—'}</span>
       <span class="edl__n" title="${esc(pathTitle(it.path))}">${esc(itemTitle(it.o, +idx || 0))}<small>${esc(LABELS[parent.split(".").pop()] || "")}</small></span>
       <span class="ed__tools">
         <button class="ed__mini" data-a="eye" title="${it.o.hide ? 'Показать' : 'Спрятать'}">${it.o.hide ? '◌' : '👁'}</button>
         <button class="ed__mini" data-a="up" title="Слой выше">▲</button><button class="ed__mini" data-a="dn" title="Слой ниже">▼</button>
         <button class="ed__mini" data-a="img" title="Заменить картинку">🖼</button>
         <button class="ed__mini${it.o.flip ? ' is-on' : ''}" data-a="flip" title="Отразить">↔</button>
         ${inArr ? '<button class="ed__mini" data-a="dup" title="Дублировать">⧉</button><button class="ed__mini" data-a="del" title="Удалить">✕</button>' : ''}
       </span>`;
    row.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) { select(it.path); buildLayers(); return; }
      if (a === 'eye') { if (it.o.hide) delete it.o.hide; else it.o.hide = true; }
      if (a === 'flip') { if (it.o.flip) delete it.o.flip; else it.o.flip = true; }
      if (a === 'up' || a === 'dn') shiftLayer(it, a === 'up' ? 1 : -1, items);
      if (a === 'img') { pickAsset(p => { it.o[it.key] = p; if (/^world\./.test(it.path)) delete it.o.w; structural(); }, { title: 'Заменить картинку', prefer: (src || '').replace(/[^/]+$/, '') }); return; }
      if (a === 'dup') { const c = G.clone(it.o); if (typeof c.x === 'number') { c.x += 12; c.y += 8; } arr.splice(+idx + 1, 0, c); sel = `${parent}.${+idx + 1}`; }
      if (a === 'del') { if (!confirm('Удалить этот слой?')) return; arr.splice(+idx, 1); sel = null; }
      structural();
    };
    box.appendChild(row);
  });
}

/* ============================================================
   ДИАЛОГ-НОВЕЛЛА: фразы, спрайты, картинки
   ============================================================ */
const DLG_PATH = /^world\.rooms\.\w+\.(npc|chars\.\d+)\.(dialog|dialogAfter)$/;
function novelFields(box, path, arr) {
  const owner = G.get(path.replace(/\.\w+$/, '')) || {}, hero = G.cfg.texts.heroName;
  /** строка → объект (только когда её правят) */
  const line = i => {
    let v = arr[i];
    if (!v || typeof v !== 'object') {
      v = String(v ?? '');
      v = arr[i] = v.startsWith('>') ? { who: 'hero', text: v.slice(1).trim() } : { who: 'npc', text: v };
    }
    return v;
  };
  const head = G.el('div', 'ed__row ed__row--wrap');
  head.innerHTML = '<button class="ed__btn ed__btn--main" data-a="play">▶ Проиграть диалог</button><button class="ed__btn" data-a="addT">+ Фраза</button><button class="ed__btn" data-a="addP">+ Картинка</button>';
  head.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') { api.toggle(false); G.say(arr, owner.name); }
    if (a === 'addT') { arr.push({ who: 'npc', text: '' }); structural(); }
    if (a === 'addP') pickAsset(p => { arr.push({ pic: p, text: '' }); structural(); }, { title: 'Картинка в диалог', prefer: 'assets/cutscenes/' });
  };
  box.appendChild(head);
  const pp = path.replace(/.(dialog|dialogAfter)$/, '.portrait'), own = !!G.get(pp);
  const prow = G.el('div', 'ed__row ed__row--wrap');
  prow.innerHTML = own
    ? '<button class="ed__btn is-on" data-a="own">Портрет: свой у этого персонажа</button><button class="ed__btn" data-a="all">↺ Как у всех</button>'
    : '<button class="ed__btn" data-a="own">Свой размер и место портрета</button>';
  prow.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'own' && !own) G.set(pp, G.clone(G.cfg.novel || { x: 125, y: 540, h: 290 }));
    if (a === 'all') delete owner.portrait;
    if (a) structural();
  };
  box.appendChild(prow);
  box.appendChild(G.el('p', 'ed__note', 'Портрет двигается прямо на экране: начни диалог, нажми F10 и тащи портрет мышкой, колесо или уголок — размер.' + (own ? '' : ' Сейчас размер общий для всех диалогов.')));
  box.appendChild(G.el('p', 'ed__note', `«⏱ дальше само» — фраза или картинка сменится сама через столько секунд. Спрайт остаётся до следующей фразы со спрайтом. Если говорит не ${esc(owner.name || 'персонаж')}, спрайт темнеет. Картинка показывается только на своей фразе; фраза с картинкой без текста — просто картинка (клик — дальше).`));
  arr.forEach((raw, i) => {
    const v = raw && typeof raw === 'object' ? raw : { who: String(raw ?? '').startsWith('>') ? 'hero' : 'npc', text: String(raw ?? '').replace(/^>\s*/, '') };
    const who = v.who || (v.name ? v.name : 'npc');
    const isOther = who !== 'npc' && who !== 'hero';
    const sp = [].concat(v.sprite || []).filter(s => s && s !== '-');
    const now = G.dialogInfo?.(), isNow = now?.path === path && now.i === i;
    const row = G.el('div', 'edn' + (isNow ? ' is-now' : ''));
    row.innerHTML =
      `<div class="edn__top"><b>${i + 1}</b>${isNow ? '<em class="edn__now">сейчас на экране</em>' : ''}
         <select data-k="who"><option value="npc"${who === 'npc' ? ' selected' : ''}>${esc(owner.name || 'Персонаж')}</option>
           <option value="hero"${who === 'hero' ? ' selected' : ''}>${esc(hero)}</option><option value="other"${isOther ? ' selected' : ''}>другое имя…</option></select>
         <input type="text" data-k="name" value="${esc(isOther ? who : '')}" placeholder="имя"${isOther ? '' : ' hidden'}>
         <span class="ed__tools">${i > 0 ? '<button class="ed__mini" data-a="up" title="Выше">↑</button>' : ''}${i < arr.length - 1 ? '<button class="ed__mini" data-a="dn" title="Ниже">↓</button>' : ''}
           <button class="ed__mini" data-a="ins" title="Вставить фразу после">+</button><button class="ed__mini" data-a="del" title="Удалить">✕</button></span></div>
       <label class="edn__wait" title="Перейти к следующей фразе само, через столько секунд (пусто — по клику). У картинки без текста — сколько она висит.">⏱ дальше само через <input type="number" data-k="wait" min="0" step="0.5" value="${v.wait ?? ''}" placeholder="—"> с</label>
       <textarea data-k="text" rows="2" placeholder="${v.pic ? 'без текста — просто картинка' : 'текст фразы'}">${esc(v.text || '')}</textarea>
       <div class="edn__media">
         <span class="edn__m"><span class="ed__thumb">${sp.length ? `<img src="${G.asset(sp[0])}" alt="">` : v.sprite === '-' ? '∅' : '·'}</span>
           <span><b>Спрайт</b>${sp.length > 1 ? ` · кадров: ${sp.length}` : v.sprite === '-' ? ' · убран' : sp.length ? '' : ' · как раньше'}<br>
           <button class="ed__mini" data-a="spr" title="Выбрать спрайт">🖼</button>${sp.length ? '<button class="ed__mini" data-a="spr+" title="Добавить кадр (меняются по очереди)">+</button>' : ''}<button class="ed__mini" data-a="spr-" title="Убрать спрайт с экрана">∅</button><button class="ed__mini" data-a="spr0" title="Как у прошлой фразы">↺</button></span></span>
         <span class="edn__m"><span class="ed__thumb">${v.pic ? `<img src="${G.asset(v.pic)}" alt="">` : '·'}</span>
           <span><b>Картинка</b><br><button class="ed__mini" data-a="pic" title="Выбрать картинку на весь экран">🖼</button><button class="ed__mini" data-a="pic0" title="Без картинки">✕</button></span></span>
       </div>`;
    const q = k => row.querySelector(`[data-k="${k}"]`);
    q('text').oninput = e => { line(i).text = e.target.value; touch(); G.dialogRefresh?.(); };
    q('who').onchange = e => {
      const o = line(i), val = e.target.value;
      delete o.name;
      if (val === 'other') { o.who = q('name').value || 'Кто-то'; q('name').hidden = false; q('name').value = o.who; }
      else { o.who = val; q('name').hidden = true; }
      touch(); G.dialogRefresh?.();
    };
    q('name').oninput = e => { line(i).who = e.target.value || 'Кто-то'; touch(); G.dialogRefresh?.(); };
    q('wait').oninput = e => { const o = line(i), n = parseFloat(e.target.value); if (n > 0) o.wait = n; else delete o.wait; touch(); };
    row.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const o = line(i);
      if (a === 'up') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (a === 'dn') [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      if (a === 'ins') arr.splice(i + 1, 0, { who: o.who || 'npc', text: '' });
      if (a === 'del') arr.splice(i, 1);
      if (a === 'spr' || a === 'spr+') {
        pickAsset(p => {
          o.sprite = a === 'spr+' ? [].concat(o.sprite || []).filter(s => s && s !== '-').concat(p) : p;
          if (Array.isArray(o.sprite) && !o.spriteEvery) o.spriteEvery = 1;
          structural();
        }, { title: 'Спрайт для фразы', prefer: 'assets/novel/' });
        return;
      }
      if (a === 'spr-') o.sprite = '-';
      if (a === 'spr0') { delete o.sprite; delete o.spriteEvery; }
      if (a === 'pic') { pickAsset(p => { o.pic = p; structural(); }, { title: 'Картинка на весь экран', prefer: 'assets/cutscenes/' }); return; }
      if (a === 'pic0') delete o.pic;
      structural();
    };
    box.appendChild(row);
  });
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
    box.innerHTML = '<p class="ed__note">Кликни по объекту на экране: его можно тащить мышкой, колесо меняет размер, стрелки двигают по пикселю (Shift — по 10).</p>' +
      '<p class="ed__note"><b>Диалог:</b> кликни по персонажу — его фразы внизу, в «Диалог». Или начни разговор в игре и нажми F10 — откроется сразу этот диалог (можно и кликнуть по окну диалога).</p>';
    return;
  }
  box.appendChild(G.el('div', 'ed__seltitle', esc(pathTitle(sel))));
  const o = G.get(sel), key = o && typeof o === 'object' && !Array.isArray(o) && imgKeyOf(o);
  if (key) {
    const row = G.el('div', 'ed__row');
    row.innerHTML = `<button class="ed__btn${o.flip ? ' is-on' : ''}" data-a="flip">↔ Отразить</button><button class="ed__btn" data-a="img">🖼 Заменить картинку…</button>`;
    row.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'flip') { if (o.flip) delete o.flip; else o.flip = true; structural(); }
      if (a === 'img') pickAsset(p => { o[key] = p; if (/^world./.test(sel)) delete o.w; structural(); }, { title: 'Заменить картинку', prefer: String(o[key] || '').replace(/[^/]+$/, '') });
    };
    box.appendChild(row);
  }
  fields(box, sel);
}

function buildScene() {
  const sc = G.scene;
  $('#edScene').textContent = ({ title: 'главное меню', world: 'дом', kitchen: 'торт', dressup: 'одевашка',
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
    ['title', 'Главное меню'], ['gallery', '🖼 Галерея'],
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
  const s = G.github.settings(), box = $('#edGhBox'), own = G.readLS('cherry.github', {}), shared = !!G.github.shared?.token;
  const tokenBox =
    `<label class="ed__f"><span class="ed__k">Владелец (логин GitHub)</span><input type="text" id="ghOwner" value="${esc(own.owner || s.owner)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Репозиторий</span><input type="text" id="ghRepo" value="${esc(own.repo || s.repo)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Ветка</span><input type="text" id="ghBranch" value="${esc(own.branch || s.branch)}" spellcheck="false"></label>
     <label class="ed__f"><span class="ed__k">Токен доступа${shared ? ' (не нужен: у сайта есть общий ключ, он скрыт)' : ''}</span><input type="password" id="ghToken" value="${esc(own.token || '')}" autocomplete="new-password" data-lpignore="true" name="cherry-gh-token" placeholder="${shared ? 'пусто — сохраняется общим ключом' : 'github_pat_…'}"></label>
     <div class="ed__row"><button class="ed__btn" id="ghCheck">Проверить доступ</button></div>
     <div class="ed__note" id="ghMsg"></div>
     <p class="ed__note"><b>Владелец репозитория:</b> <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">создать Fine-grained token</a> →
       Repository access: <b>Only select repositories</b> → этот репозиторий → Permissions → <b>Contents: Read and write</b>, срок — какой разрешит GitHub (до года).
       Такой токен умеет менять только этот сайт.<br>
       <b>Соавтор (Collaborator):</b> <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=cherry-game" target="_blank" rel="noopener">создать classic-токен</a> с галочкой <b>public_repo</b>.</p>
     <div class="ed__label">Сохранять может любой</div>
     <p class="ed__note">${shared
       ? '✓ Сейчас <b>любой</b>, кто открыл сайт, может нажать F10 / F11, поправить и «Сохранить» — без ключа.'
       : 'Встроить токен выше в сайт: тогда любой, кто открыл игру, сможет править (F10 / F11) и сохранять — правки увидят все.'}
       Ключ при этом может достать любой посетитель, поэтому подходит только fine-grained токен на один этот репозиторий. Убрать доступ можно здесь же или удалив токен на GitHub.</p>
     <div class="ed__row"><button class="ed__btn ed__btn--main" id="ghShare">🌍 ${shared ? 'Обновить общий ключ' : 'Разрешить сохранять всем'}</button>${shared ? '<button class="ed__btn" id="ghUnshare">🚫 Запретить</button>' : ''}</div>`;
  if (local) {
    box.innerHTML = '<p class="ed__note ed__note--ok">' + (localGit
      ? `Игра запущена с компьютера. «Сохранить» сам отправляет правки на GitHub (${esc(localGit.name)}) — ничего вводить не нужно.`
      : 'Игра запущена с компьютера: «Сохранить» пишет прямо в папку проекта.') + '</p>' +
      `<details class="ed__more"><summary>Чтобы правили и сохраняли прямо с сайта все</summary>${tokenBox}</details>`;
  } else {
    box.innerHTML =
      (shared
        ? '<p class="ed__note ed__note--ok">Сохранять с сайта может любой: просто нажми «Сохранить» — через 1–2 минуты правки увидят все.</p>'
        : `<p class="ed__note"><b>Проще всего — без всяких ключей:</b> открой папку игры на своём компьютере и запусти <b>start.bat</b>.
             Откроется эта же игра, и там «Сохранить» сам отправляет правки на GitHub.</p>
           <div class="ed__row"><button class="ed__btn" id="ghExport">⬇ Забрать мои правки файлом</button></div>
           <p class="ed__note">Чтобы не потерять то, что уже подвигано здесь: скачай правки, а в игре из start.bat открой «Файл настроек» → «Загрузить».</p>`) +
      `<details class="ed__more"><summary>Сохранять прямо с сайта своим ключом GitHub</summary>${tokenBox}</details>`;
    $('#ghExport') && ($('#ghExport').onclick = () => $('#edExport').click());
  }
  if (localGit && !$('#ghOwner').value) { const [o, r] = localGit.name.split('/'); $('#ghOwner').value = o || ''; $('#ghRepo').value = r || ''; }
  const read = () => G.github.store({
    owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(),
    branch: $('#ghBranch').value.trim() || 'main', token: $('#ghToken').value.trim()
  });
  ['#ghOwner', '#ghRepo', '#ghBranch', '#ghToken'].forEach(q => { $(q).oninput = read; });
  const msg = (t, cls = '') => { const m = $('#ghMsg'); m.textContent = t; m.className = 'ed__note ' + cls; };
  $('#ghCheck').onclick = async () => {
    read();
    msg('Проверяю…');
    try {
      const r = await G.github.check();
      msg(r.canPush ? `✓ Доступ есть: ${r.name}. Можно сохранять.` : `Репозиторий ${r.name} виден, но права записи нет.`, r.canPush ? 'ed__note--ok' : 'ed__note--bad');
    } catch (e) { msg('✕ ' + e.message, 'ed__note--bad'); }
  };
  /** записать data/share.json: с токеном — сохранять могут все, пустой — никто без своего ключа */
  const setShared = async token => {
    read();
    const st = { ...G.github.settings(), token };
    const text = G.github.shareFile(st);
    if (local) {
      const r = await fetch('/__api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ path: 'data/share.json', base64: btoa(text) }] }) });
      const j = r.ok ? await r.json() : null;
      if (!r.ok) throw new Error('локальный сервер ответил ' + r.status);
      if (j?.error) throw new Error(j.error);
    } else {
      await G.github.commit({ files: [{ path: 'data/share.json', blob: new Blob([text], { type: 'application/json' }) }],
        buildConfig: remote => remote || G.base, message: token ? 'Редактор: сохранять может любой' : 'Редактор: общий ключ убран' });
    }
    G.github.shared = token ? { token, owner: st.owner, repo: st.repo, branch: st.branch } : null;
  };
  $('#ghShare').onclick = async () => {
    read();
    const t = $('#ghToken').value.trim();
    if (!t) { msg('Сначала вставь токен выше', 'ed__note--bad'); $('#ghToken').focus(); return; }
    if (!confirm('Встроить этот токен в сайт? После этого любой посетитель сможет менять игру (и при желании достать ключ). Токен должен быть fine-grained только на этот репозиторий.')) return;
    msg('Проверяю токен…');
    try {
      const r = await G.github.check();
      if (!r.canPush) throw new Error('у токена нет права записи в ' + r.name);
      msg('Встраиваю ключ в сайт…');
      await setShared(t);
      note('Готово! Через 1–2 минуты сохранять с сайта сможет любой 🍒');
      buildGithub();
    } catch (e) { msg('✕ ' + e.message, 'ed__note--bad'); }
  };
  $('#ghUnshare') && ($('#ghUnshare').onclick = async () => {
    if (!confirm('Убрать общий ключ с сайта? Сохранять смогут только те, у кого свой ключ или start.bat.')) return;
    try { await setShared(''); note('Общий ключ убран. Сам токен лучше ещё и удалить на GitHub.'); buildGithub(); }
    catch (e) { msg('✕ ' + e.message, 'ed__note--bad'); }
  });
}

function build() {
  built = true;
  panel.innerHTML = `
    <div class="ed__head"><b>🍒 Редактор</b><span id="edScene"></span><i class="ed__ver" title="Версия игры. Если после обновления сайта она старая — нажми Ctrl+F5">${esc(window.BUILD || '')}</i><button id="edClose" title="Закрыть (F10)">✕</button></div>
    <div class="ed__save">
      <div class="ed__state" id="edState"></div>
      <div class="ed__row">
        <button class="ed__btn ed__btn--main" id="edSave">💾 Сохранить на сайт</button>
        <button class="ed__btn" id="edRevert" title="Вернуть всё как на сайте">↺ Отменить правки</button>
      </div>
    </div>
    <div class="ed__body">
      <details class="ed__sec" id="edLayersSec"><summary>🧱 Слои сцены (F11)</summary><div id="edLayers"></div></details>
      <details class="ed__sec" open><summary>🎯 Выбранный объект</summary><div id="edSel"></div></details>
      <details class="ed__sec" open id="edToolsSec"><summary>🛠 Инструменты этой сцены</summary><div id="edTools"></div></details>
      <details class="ed__sec" open><summary>📄 Настройки этой сцены</summary><div id="edRoots"></div></details>
      <details class="ed__sec"><summary>🚪 Перейти в другое место игры</summary><div id="edNavBox"></div></details>
      <details class="ed__sec"><summary>🗂 Все настройки игры</summary><div id="edAll"></div></details>
      <details class="ed__sec" id="edGh"><summary>⚙ Как сохранить на сайт</summary><div id="edGhBox"></div></details>
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
  buildSel(); buildScene(); buildAll(); buildNav(); buildGithub(); buildLayers();
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
  if (!dirty() && !localGit) { note('Сохранять нечего — правок нет'); return; }
  if (!local && !G.github.ready()) {
    $('#edGh').open = true;
    $('#edGh').scrollIntoView({ behavior: 'smooth' });
    note('С сайта напрямую сохранить нельзя. Запусти start.bat в папке игры — там «Сохранить» работает сам', true);
    return;
  }
  busy = true; paintState();
  try {
    // в репозиторий идут только файлы, на которые ещё ссылается конфиг
    const text = JSON.stringify(G.cfg);
    const files = [...G.pending].filter(([p]) => text.includes(JSON.stringify(p))).map(([path, f]) => ({ path, blob: f.blob }));
    let result = G.cfg, sent = null;
    if (local) {
      const post = async (url, body) => {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
        if (!r.ok) throw new Error('локальный сервер ответил ' + r.status);
        return r.json();
      };
      const body = { files: [] };
      if (dirty()) {
        if (localGit) {                 // сначала забираем то, что сохранили другие, и сливаем со своим
          $('#edState').textContent = 'Смотрю, нет ли новых правок на GitHub…';
          const theirs = (await post('/__api/pull')).config;
          if (theirs) result = merge3(G.base, G.cfg, theirs);
        }
        body.config = result;
        for (const f of files) body.files.push({ path: f.path, base64: await toBase64(f.blob) });
      }
      $('#edState').textContent = localGit ? 'Отправляю на GitHub…' : 'Сохраняю…';
      sent = await post('/__api/save', body);
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
    if (sent?.error) note('На компьютере сохранено, но на GitHub не ушло: ' + sent.error + '. Нажми «Сохранить» ещё раз чуть позже.', true);
    else if (sent?.upToDate && !sent.committed) note('Всё уже на GitHub — новых правок нет');
    else note(local && !sent?.pushed ? 'Сохранено в папку проекта 🍒' : 'Сохранено на GitHub! Сайт обновится у всех через 1–2 минуты 🍒');
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
  if (built && G.editing) buildLayers();
  if (path && !layersMode) panel.querySelector('.ed__body').scrollTop = 0;
}
const selEl = () => sel ? view.querySelector(`[data-edit="${CSS.escape(sel)}"]`) : null;
/** у картинки без ширины (мебель в доме) ширину берём из самой картинки — тогда её можно растягивать */
function ensureW(o, el) {
  if (!o || typeof o.w === 'number') return !!o;
  if (typeof o.h === 'number' && typeof o.x === 'number' && !imgKeyOf(o)) return true;   // портрет в диалоге: только высота
  if (typeof o.x !== 'number' || !imgKeyOf(o)) return false;
  const im = el?.tagName === 'IMG' ? el : el?.querySelector('img');
  if (!im?.naturalWidth) return false;
  o.w = parseFloat(getComputedStyle(im).width) || im.naturalWidth;
  return true;
}
const movable = o => o && typeof o.x === 'number' && typeof o.y === 'number';

function live(path, el, o) {
  if (el) G.place(el, o);
  if (el?.id === 'novelSprite') G.placePortrait?.();
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
  if (!ensureW(o, el)) return;
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
  } else if (typeof o.h === 'number' && typeof o.w !== 'number') {   // портрет: тянем высоту
    o.h = Math.max(40, Math.round(drag.oh + dy));
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
  if (!ensureW(o, selEl())) return;
  e.preventDefault();
  const k = e.deltaY > 0 ? .96 : 1.04;
  if (typeof o.w !== 'number') { o.h = Math.max(40, G.round(o.h * k, 1)); live(sel, selEl(), o); G.placePortrait?.(); return; }
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
      fetch('/__api/ping').then(r => r.ok && r.json()).then(j => { if (j?.ok) { local = true; localGit = j.git || null; if (G.editing) { buildGithub(); paintState(); } } }).catch(() => {});
    addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
    if (new URLSearchParams(location.search).has('edit')) this.toggle(true);
  },

  toggle(force) {
    const on = force ?? !G.editing;
    if (force === undefined) layersMode = false;
    if (on === G.editing) return;
    G.editing = on;
    G.keys.clear();
    panel.hidden = !on;
    document.body.classList.toggle('editing', on);
    if (on) {
      if (!built) build();
      // открыли посреди разговора — сразу показываем этот диалог и текущую фразу
      const d = G.dialogInfo?.();
      if (d && G.get(d.path)) sel = d.path;
      rebuild(); paintState();
      if (d) requestAnimationFrame(() => panel.querySelector('.edn.is-now')?.scrollIntoView({ block: 'center' }));
    }
    else { sel = null; drag = null; selBox.hidden = true; closePicker(); layersMode = false; }
    G.scene?.onEdit?.(on);
    G.fit();
  },

  /** F11: слои сцены. Второй F11 закрывает редактор */
  layers() {
    if (G.editing && layersMode) { this.toggle(false); return; }
    layersMode = true;
    this.toggle(true);
    const sec = $('#edLayersSec');
    sec.open = true;
    buildLayers();
    panel.querySelector('.ed__body').scrollTop = 0;
  },
  pickAsset,

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
    if (picker) { if (e.code === 'Escape') closePicker(); return false; }
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
    selH.hidden = !(o && (typeof o.w === 'number' || typeof o.h === 'number' || (typeof o.x === 'number' && imgKeyOf(o)))) || !!el.dataset.nodrag;
    const label = movable(o) ? `${Math.round(o.x)}, ${Math.round(o.y)}${typeof o.w === 'number' ? ' · ' + Math.round(o.w) : ''}` : '';
    if (selL.textContent !== label) selL.textContent = label;
  },

  merge3
};

})();
