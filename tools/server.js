/* ============================================================
   Локальный сервер: игра на своём компьютере.
   Запуск: start.bat (или `node tools/server.js`).
   Раздаёт файлы, как GitHub Pages, а редактор (F10) в этом режиме
   сохраняет правки прямо в папку проекта и сам отправляет их на
   GitHub обычным git — тем входом, что уже есть на компьютере.
   Никаких токенов вводить не нужно.
     PORT=8123  другой порт
     OPEN=1     открыть игру в браузере после запуска
     NOGIT=1    только писать в папку, на GitHub ничего не отправлять
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const URL_ = `http://localhost:${PORT}`;
const CONFIG = path.join(ROOT, 'data', 'game.json');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

/** путь из запроса → файл внутри проекта (или null, если пытаются выйти наружу) */
function resolve(rel) {
  const full = path.resolve(ROOT, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null;
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

/* ---------------- git ---------------- */
const run = (args, ms = 90000) => new Promise(res => {
  execFile('git', args, { cwd: ROOT, timeout: ms, windowsHide: true, maxBuffer: 1 << 24 }, (err, out, errOut) =>
    res({ ok: !err, out: String(out || '').trim(), err: String(errOut || '').trim() || (err ? err.message : '') }));
});
// команды git идут строго по очереди
let queue = Promise.resolve();
const locked = fn => (queue = queue.then(fn, fn));

let repo = null;          // { remote, branch, name } — если проект лежит в git с адресом GitHub
async function detectRepo() {
  if (process.env.NOGIT) return null;
  const inside = await run(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out !== 'true') return null;
  const remote = await run(['remote', 'get-url', 'origin']);
  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!remote.ok || !branch.ok || branch.out === 'HEAD') return null;
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(\.git)?$/.exec(remote.out);
  return { remote: remote.out, branch: branch.out, name: m ? m[1] : remote.out };
}

/** понятное объяснение, почему git не справился */
function why(text) {
  const t = String(text || '');
  if (/could not resolve host|unable to access|failed to connect|timed out|ETIMEDOUT/i.test(t)) return 'нет связи с GitHub (проверь интернет)';
  if (/authentication failed|permission.*denied|403|could not read username|logon failed/i.test(t)) return 'GitHub не пустил: войди в GitHub на этом компьютере (появится окно входа) и нажми «Сохранить» ещё раз';
  if (/conflict/i.test(t)) return 'правки на GitHub и на компьютере не сошлись сами — напиши тому, кто ведёт проект';
  return t.split('\n').filter(Boolean).pop() || 'git не ответил';
}

/** забрать с GitHub то, что сохранили другие */
async function pull() {
  if (!repo) return { ok: true, pulled: false };
  const r = await run(['pull', '--rebase', '--autostash', 'origin', repo.branch]);
  if (r.ok) return { ok: true, pulled: !/up to date/i.test(r.out) };
  await run(['rebase', '--abort']);
  return { ok: false, error: why(r.err || r.out) };
}

/** закоммитить указанные файлы (если менялись) и отправить всё неотправленное на GitHub */
async function publish(paths, message) {
  if (!repo) return { git: false };
  let committed = false;
  if (paths.length) {
    await run(['add', '--', ...paths]);
    const changed = await run(['status', '--porcelain', '--', ...paths]);
    if (changed.out) {
      const c = await run(['commit', '-m', message, '--', ...paths]);
      if (!c.ok) return { git: true, pushed: false, error: why(c.err || c.out) };
      committed = true;
    }
  }
  const ahead = await run(['rev-list', '--count', `origin/${repo.branch}..HEAD`]);
  if (ahead.ok && ahead.out === '0') return { git: true, committed, pushed: false, upToDate: true };
  let p = await run(['push', 'origin', `HEAD:${repo.branch}`]);
  if (!p.ok && /rejected|fetch first|non-fast-forward/i.test(p.err)) {   // кто-то успел сохранить раньше
    const pl = await pull();
    if (!pl.ok) return { git: true, committed, pushed: false, error: pl.error };
    p = await run(['push', 'origin', `HEAD:${repo.branch}`]);
  }
  return p.ok ? { git: true, committed, pushed: true } : { git: true, committed, pushed: false, error: why(p.err || p.out) };
}

/* ---------------- сервер ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const json = (code, o) => send(code, JSON.stringify(o), MIME['.json']);
  try {
    if (url.pathname === '/__api/ping') return json(200, { ok: true, git: repo ? { name: repo.name, branch: repo.branch } : null });

    // свежие настройки с GitHub — редактор сольёт их со своими правками перед сохранением
    if (url.pathname === '/__api/pull' && req.method === 'POST') {
      const r = await locked(pull);
      if (!r.ok) console.log('не получилось забрать правки с GitHub: ' + r.error);
      return json(200, { ...r, config: JSON.parse(fs.readFileSync(CONFIG, 'utf8')) });
    }

    if (url.pathname === '/__api/save' && req.method === 'POST') {
      const { config, files = [] } = JSON.parse((await readBody(req)).toString('utf8'));
      const paths = [];
      for (const f of files) {
        const full = /^assets\//.test(f.path) && resolve(f.path);
        if (!full) return send(400, 'bad path: ' + f.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.from(f.base64, 'base64'));
        paths.push(f.path);
      }
      if (config) {
        fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');
        paths.push('data/game.json');
        console.log(`сохранено: data/game.json${files.length ? ' + файлов: ' + files.length : ''}`);
      }
      const g = await locked(() => publish(paths, `Редактор: правки игры${files.length ? ` (+${files.length} файл.)` : ''}`));
      if (g.pushed) console.log('отправлено на GitHub: ' + repo.name);
      else if (g.error) console.log('на GitHub не отправилось: ' + g.error);
      return json(200, { ok: true, ...g });
    }

    let file = resolve(decodeURIComponent(url.pathname));
    if (!file) return send(403, 'forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(500, String(e.message || e));
  }
});

const openBrowser = () => { if (process.env.OPEN) execFile('cmd', ['/c', 'start', '', URL_], { windowsHide: true }, () => {}); };

server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`\n  Игра уже запущена в другом окне — открываю ${URL_}\n`);
  openBrowser();
  setTimeout(() => process.exit(0), 1500);
});

(async () => {
  repo = await detectRepo();
  if (repo) {
    console.log(`\n  Забираю свежую версию с GitHub (${repo.name})…`);
    const r = await pull();
    console.log(r.ok ? (r.pulled ? '  Обновлено.' : '  Уже свежая.') : '  Не получилось: ' + r.error + '. Работаем с тем, что есть на компьютере.');
  }
  server.listen(PORT, () => {
    console.log(`\n  🍒 Игра открыта: ${URL_}`);
    console.log(repo ? `  «Сохранить» в редакторе (F10) отправляет правки на GitHub: ${repo.name}` : '  «Сохранить» в редакторе (F10) пишет в папку проекта.');
    console.log('  (чтобы остановить — закрой это окно)\n');
    openBrowser();
  });
})();
