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
   ============================================================ */
(() => {
'use strict';
const G = window.G;
const KEY = 'cherry.github';

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

  settings() {
    const s = G.readLS(KEY, {}), d = this.detect(), c = G.cfg.github || {};
    return {
      owner:  s.owner  || c.owner  || d.owner || '',
      repo:   s.repo   || c.repo   || d.repo  || '',
      branch: s.branch || c.branch || 'main',
      token:  s.token  || ''
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
