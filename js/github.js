/* ============================================================
   github.js — сохранение правок редактора прямо в репозиторий
   ------------------------------------------------------------
   Сайт на GitHub Pages — это просто файлы в репозитории. Кнопка
   «Сохранить» в редакторе делает ОДИН коммит: новый data/game.json
   + все загруженные картинки/звуки. Через 1–2 минуты GitHub сам
   пересобирает сайт, и изменения видят все.

   Для записи нужен токен GitHub:
   • владелец репозитория — fine-grained токен только на этот
     репозиторий с правом Contents: Read and write (его же можно
     лично передать художникам: он не даёт доступа ни к чему другому);
   • соавтор (Collaborator) — classic-токен с правом public_repo.
   Токен хранится только в браузере того, кто его ввёл,
   и в репозиторий не попадает.

   «Сохранять может любой»: владелец один раз встраивает свой
   токен в сайт (data/share.json, в слегка запутанном виде, чтобы
   GitHub не принял его за утёкший пароль). Тогда «Сохранить» с
   сайта работает у всех без ввода ключа. Важно: такой ключ может
   достать любой, кто откроет сайт, поэтому токен должен уметь
   менять только этот репозиторий (fine-grained, Contents).
   ============================================================ */
(() => {
'use strict';
const G = window.G;
const KEY = 'cherry.github';
const MASK = 'cherry-birthday-🍒';

/** токен ↔ строка для data/share.json: перевёрнут, перемешан с маской, base64 */
const xor = (str, k) => [...str].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ (k.charCodeAt(i % k.length) & 31))).join('');
const pack = t => btoa(xor([...t].reverse().join(''), MASK));
const unpack = s => { try { return [...xor(atob(s), MASK)].reverse().join(''); } catch { return ''; } };

const toBase64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(new Error('не удалось прочитать файл'));
  fr.readAsDataURL(blob);
});

function human(status, msg) {
  if (status === 401) return 'токен не подходит — проверь, что он скопирован целиком и не истёк';
  if (status === 403) return 'у токена нет права записи в этот репозиторий (нужно Contents: Read and write)';
  if (status === 404) return 'репозиторий или ветка не найдены (или токену они не видны)';
  if (status === 409 || status === 422) return 'репозиторий изменился во время сохранения — попробуй ещё раз';
  return `GitHub ответил ${status}: ${msg}`;
}

G.github = {
  /** владелец и репозиторий угадываются по адресу вида имя.github.io/репозиторий/ */
  detect() {
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return {};
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg && !seg.includes('.') ? seg : `${m[1]}.github.io` };
  },

  /** общий ключ сайта (data/share.json), если владелец разрешил сохранять всем */
  shared: null,
  async loadShared() {
    try {
      const r = await fetch('data/share.json?t=' + Date.now(), { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      this.shared = j?.k ? { token: unpack(j.k), owner: j.owner || '', repo: j.repo || '', branch: j.branch || '' } : null;
    } catch { this.shared = null; }
  },
  /** содержимое data/share.json для токена (пустой токен — запретить) */
  shareFile(s) {
    return JSON.stringify(s.token ? { k: pack(s.token), owner: s.owner, repo: s.repo, branch: s.branch } : {}, null, 2) + '\n';
  },

  settings() {
    const s = G.readLS(KEY, {}), d = this.detect(), c = G.cfg.github || {}, sh = this.shared || {};
    return {
      owner:  s.owner  || sh.owner  || c.owner  || d.owner || '',
      repo:   s.repo   || sh.repo   || c.repo   || d.repo  || '',
      branch: s.branch || sh.branch || c.branch || 'main',
      token:  s.token  || sh.token  || '',
      own:    !!s.token
    };
  },
  store(s) { G.writeLS(KEY, s); },
  ready() { const s = this.settings(); return !!(s.owner && s.repo && s.token); },

  async api(path, opt = {}) {
    const s = this.settings();
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
        method: opt.method || 'GET',
        headers: {
          Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${s.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opt.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: opt.body ? JSON.stringify(opt.body) : undefined
      });
    } catch {
      throw new Error('нет связи с GitHub — проверь интернет');
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).message; } catch {}
      const err = new Error(human(r.status, msg));
      err.status = r.status;
      throw err;
    }
    return opt.raw ? r.text() : r.json();
  },

  /** проверка доступа: существует ли репозиторий и можно ли в него писать */
  async check() {
    const repo = await this.api('');
    return { canPush: !!repo.permissions?.push, defaultBranch: repo.default_branch, name: repo.full_name };
  },

  /**
   * Один коммит: файлы + конфиг.
   * buildConfig(remote) получает конфиг, который сейчас лежит в репозитории
   * (его мог успеть поменять другой художник), и возвращает итоговый.
   */
  async commit({ files, buildConfig, message, onStep }) {
    const { branch } = this.settings();
    const blobs = [];
    for (let i = 0; i < files.length; i++) {
      onStep?.(`Загружаю файлы: ${i + 1} из ${files.length}…`);
      const r = await this.api('/git/blobs', { method: 'POST', body: { content: await toBase64(files[i].blob), encoding: 'base64' } });
      blobs.push({ path: files[i].path, sha: r.sha });
    }
    for (let attempt = 0; ; attempt++) {
      onStep?.('Записываю изменения…');
      const ref = await this.api(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const headSha = ref.object.sha;
      const head = await this.api(`/git/commits/${headSha}`);
      let remote = null;
      try { remote = JSON.parse(await this.api(`/contents/data/game.json?ref=${headSha}`, { raw: true })); }
      catch (e) { if (e.status !== 404 && !(e instanceof SyntaxError)) throw e; }
      const cfg = buildConfig(remote);
      const tree = await this.api('/git/trees', { method: 'POST', body: {
        base_tree: head.tree.sha,
        tree: [
          { path: 'data/game.json', mode: '100644', type: 'blob', content: JSON.stringify(cfg, null, 2) + '\n' },
          ...blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha }))
        ]
      } });
      const commit = await this.api('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [headSha] } });
      try {
        await this.api(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
        return { cfg, sha: commit.sha };
      } catch (e) {
        // кто-то сохранил одновременно с нами — берём свежую версию и повторяем
        if ((e.status === 422 || e.status === 409) && attempt < 3) continue;
        throw e;
      }
    }
  }
};

})();
