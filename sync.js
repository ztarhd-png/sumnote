(function (root) {
  'use strict';
  // GitHub 동기화: 본인의 비공개 저장소에 노트 전체를 JSON 파일 하나로 둔다.
  // 화면과 분리된 순수 로직이다(sync.test.js로 검사). 네트워크는 fetch를 넘겨받아 쓴다.
  const API = 'https://api.github.com';
  const FILE = 'sumnote.json';

  class SyncError extends Error {
    constructor(message, kind) { super(message); this.kind = kind || 'fail'; }
  }

  // ---- 세 갈래 합치기 ----
  // 마지막으로 맞춘 때의 모습(base)은 노트마다 짧은 지문만 남겨 둔다(저장 공간을 아끼려고).
  function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }
  const noteMark = n => hash(n.body + '\u0000' + (n.folderId || ''));
  function marksOf(state) {
    const notes = {}, folders = {};
    for (const n of state.notes) notes[n.id] = noteMark(n);
    for (const f of state.folders) folders[f.id] = f.name;
    return { notes, folders };
  }
  const later = (a, b) => (Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a);
  const sameNote = (a, b) => a.body === b.body && (a.folderId || null) === (b.folderId || null);
  function unionIds(first, second) {
    const ids = first.map(x => x.id);
    const seen = new Set(ids);
    for (const x of second) if (!seen.has(x.id)) { seen.add(x.id); ids.push(x.id); }
    return ids;
  }
  // 한쪽만 바꾼 노트는 바꾼 쪽을, 양쪽이 다르게 바꾼 노트는 GitHub 쪽을 두고 이 기기의 것은 사본으로 남긴다.
  // 한쪽에서 지운 노트는, 다른 쪽이 그 사이 고치지 않았을 때만 지운다. 글은 어느 경우에도 사라지지 않는다.
  function merge(base, local, remote, newId) {
    const b = base || { notes: {}, folders: {} };
    const L = new Map(local.notes.map(n => [n.id, n])), R = new Map(remote.notes.map(n => [n.id, n]));
    const notes = [];
    let conflicts = 0;
    for (const nid of unionIds(remote.notes, local.notes)) {
      const l = L.get(nid), r = R.get(nid), mark = b.notes[nid];
      if (l && r) {
        if (sameNote(l, r)) notes.push({ ...later(l, r) });
        else if (mark === noteMark(l)) notes.push({ ...r });
        else if (mark === noteMark(r)) notes.push({ ...l });
        else {
          conflicts++;
          notes.push({ ...r });
          const lines = l.body.split('\n');
          lines[0] = (lines[0].trim() || '새 노트') + ' (충돌 사본)';
          const body = lines.join('\n');
          notes.push({ ...l, id: newId(), body, title: lines[0].trim() });
        }
      } else if (l) {
        if (mark === undefined || mark !== noteMark(l)) notes.push({ ...l });
      } else if (mark === undefined || mark !== noteMark(r)) notes.push({ ...r });
    }
    const LF = new Map(local.folders.map(f => [f.id, f])), RF = new Map(remote.folders.map(f => [f.id, f]));
    const used = new Set(notes.map(n => n.folderId).filter(Boolean));
    const folders = [];
    for (const fid of unionIds(remote.folders, local.folders)) {
      const l = LF.get(fid), r = RF.get(fid), name = b.folders[fid];
      if (l && r) folders.push({ ...(l.name === r.name || name === l.name ? r : l) });
      else {
        const only = l || r;
        // 다른 쪽에서 지운 폴더라도 그 안에 남은 노트가 있으면 폴더를 지우지 않는다.
        if (name === undefined || name !== only.name || used.has(fid)) folders.push({ ...only });
      }
    }
    const kept = new Set(folders.map(f => f.id));
    for (const n of notes) if (n.folderId && !kept.has(n.folderId)) n.folderId = null;
    return { state: { version: 1, folders, notes }, conflicts };
  }

  // ---- 파일 주고받기 ----
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const headers = (token, accept) => ({ Authorization: 'Bearer ' + token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const repoUrl = cfg => `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const fileUrl = cfg => `${repoUrl(cfg)}/contents/${FILE}`;

  async function call(fetchFn, url, init) {
    try { return await fetchFn(url, { cache: 'no-store', ...init }); }
    catch (_) { throw new SyncError('인터넷에 연결되지 않아 나중에 다시 맞출게요.', 'offline'); }
  }
  function failure(status, what) {
    if (status === 401) return new SyncError('토큰이 틀렸거나 기한이 지났어요. 새 토큰을 넣어 주세요.', 'auth');
    if (status === 403) return new SyncError('토큰에 이 저장소의 Contents 읽기·쓰기 권한이 있는지 확인해 주세요.', 'auth');
    if (status === 404) return new SyncError('저장소를 찾지 못했어요. 저장소 이름과, 토큰을 만들 때 이 저장소를 골랐는지 확인해 주세요.', 'auth');
    return new SyncError(`GitHub이 응답하지 않아요(${what} ${status}). 잠시 뒤에 다시 해 주세요.`, 'fail');
  }

  // 토큰 주인의 아이디 (저장소 이름만 적었을 때)
  async function whoAmI(token, fetchFn) {
    const res = await call(fetchFn, API + '/user', { headers: headers(token) });
    if (!res.ok) throw failure(res.status, '사용자');
    return (await res.json()).login;
  }
  // 저장소가 있고, 비공개인지
  async function checkRepo(cfg, fetchFn) {
    const res = await call(fetchFn, repoUrl(cfg), { headers: headers(cfg.token) });
    if (!res.ok) throw failure(res.status, '저장소');
    const repo = await res.json();
    if (!repo.private) throw new SyncError('공개 저장소예요. 노트가 누구에게나 보이게 되므로 연결하지 않았어요. 저장소를 비공개로 바꾸거나 새 비공개 저장소를 만들어 주세요.', 'public');
    if (repo.permissions && !repo.permissions.push) throw failure(403);
    return { owner: repo.owner.login, repo: repo.name };
  }
  // { sha, text } 또는 파일이 아직 없으면 null
  async function readFile(cfg, fetchFn) {
    const res = await call(fetchFn, fileUrl(cfg), { headers: headers(cfg.token) });
    if (res.status === 404) { await checkRepo(cfg, fetchFn); return null; }
    if (!res.ok) throw failure(res.status, '읽기');
    const meta = await res.json();
    if (meta.content && meta.encoding === 'base64') return { sha: meta.sha, text: fromBase64(meta.content) };
    // 1MB가 넘는 파일은 내용을 따로 받는다.
    const raw = await call(fetchFn, fileUrl(cfg), { headers: headers(cfg.token, 'application/vnd.github.raw+json') });
    if (!raw.ok) throw failure(raw.status, '읽기');
    return { sha: meta.sha, text: await raw.text() };
  }
  // 새 sha를 돌려준다. 그 사이 다른 기기가 먼저 올렸으면 kind 'conflict'로 실패한다.
  async function writeFile(cfg, text, sha, fetchFn, message) {
    const body = { message: message || '숨노트 동기화', content: toBase64(text) };
    if (sha) body.sha = sha;
    const res = await call(fetchFn, fileUrl(cfg), { method: 'PUT', headers: { ...headers(cfg.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) throw new SyncError('다른 기기가 먼저 올렸어요.', 'conflict');
    if (!res.ok) throw failure(res.status, '쓰기');
    return (await res.json()).content.sha;
  }

  const api = { FILE, SyncError, hash, marksOf, merge, toBase64, fromBase64, whoAmI, checkRepo, readFile, writeFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SumSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
