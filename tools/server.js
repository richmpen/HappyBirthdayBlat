/* ============================================================
   Локальный сервер для проверки игры на своём компьютере.
   Запуск: start.bat (или `node tools/server.js`).
   Умеет то же, что и GitHub Pages (раздаёт файлы), плюс
   редактор (F10) в этом режиме сохраняет правки прямо в папку
   проекта — без токена и без интернета.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 8080;
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  try {
    if (url.pathname === '/__api/ping') return send(200, '{"ok":true}', MIME['.json']);

    if (url.pathname === '/__api/save' && req.method === 'POST') {
      const { config, files = [] } = JSON.parse((await readBody(req)).toString('utf8'));
      for (const f of files) {
        const full = /^assets\//.test(f.path) && resolve(f.path);
        if (!full) return send(400, 'bad path: ' + f.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.from(f.base64, 'base64'));
      }
      fs.writeFileSync(path.join(ROOT, 'data', 'game.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log(`сохранено: data/game.json${files.length ? ' + файлов: ' + files.length : ''}`);
      return send(200, '{"ok":true}', MIME['.json']);
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
}).listen(PORT, () => {
  console.log(`\n  🍒 Игра открыта: http://localhost:${PORT}\n  (чтобы остановить — закрой это окно)\n`);
});
