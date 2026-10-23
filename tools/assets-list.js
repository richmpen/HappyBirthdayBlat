/* ============================================================
   Список всех картинок проекта → data/assets.json.
   По нему редактор показывает «набор» картинок: заменить предмет
   в комнате, спрайт в диалоге, картинку слоя (F11).
       node tools/assets-list.js
   Запускается сам из bump-build.js и при «Сохранить» в start.bat.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = /^assets\/(dressup\/(items|thumbs)|fx|fonts|audio)\//;   // вещи одевашки и служебное — в набор не нужны

function list() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(png|webp|jpe?g|gif|svg)$/i.test(e.name) && !SKIP.test(rel)) out.push(rel);
    }
  })('assets');
  return out.sort();
}

function write() {
  const files = list();
  fs.writeFileSync(path.join(ROOT, 'data', 'assets.json'), JSON.stringify(files, null, 0).replace(/","/g, '",\n"') + '\n', 'utf8');
  return files.length;
}

module.exports = { write };
if (require.main === module) console.log('картинок:', write());
