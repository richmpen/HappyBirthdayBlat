/* ============================================================
   Обновляет версию сборки в index.html.
   Запускать перед коммитом, если менялись файлы в js/ или css/:
       node tools/bump-build.js
   Версия стоит в адресах стилей и скриптов (?v=…) и в window.BUILD.
   По ней игра понимает, что на сайте вышла новая версия, и сама
   перезагружается — иначе браузер до 10 минут показывал бы старую.
   Правки из редактора (data/game.json, картинки) версии не требуют.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'index.html');
const d = new Date(), p = n => String(n).padStart(2, '0');
const build = `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

let s = fs.readFileSync(file, 'utf8');
s = s.replace(/(href="css\/[a-z]+\.css)(\?v=[\w-]+)?"/g, `$1?v=${build}"`)
     .replace(/(src="js\/[a-z]+\.js)(\?v=[\w-]+)?"/g, `$1?v=${build}"`)
     .replace(/window\.BUILD = '[^']*'/, `window.BUILD = '${build}'`);
fs.writeFileSync(file, s, 'utf8');
console.log('build', build);
