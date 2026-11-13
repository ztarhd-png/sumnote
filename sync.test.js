const assert = require('assert');
const S = require('./sync.js');

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push(Promise.resolve().then(fn).then(() => { passed++; }, e => { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }));
const note = (id, body, folderId = null, updatedAt = '2026-01-01T00:00:00.000Z') => ({ id, title: body.split('\n')[0], body, folderId, updatedAt });
const data = (notes, folders = []) => ({ version: 1, folders, notes });
let n = 0;
const newId = () => 'copy' + (++n);
const bodies = s => s.notes.map(x => x.id + ':' + x.body);

const base = data([note('a', '장보기\n사과 6000'), note('b', '여행\n항공 100'), note('c', '모임\n저녁 30000', 'f')], [{ id: 'f', name: '일상' }]);
const marks = S.marksOf(base);

test('한쪽만 바꾼 노트는 바꾼 쪽을 쓴다', () => {
  const local = data([note('a', '장보기\n사과 6000\n우유 3000'), base.notes[1], base.notes[2]], base.folders);
  const remote = data([base.notes[0], note('b', '여행\n항공 120'), base.notes[2]], base.folders);
  const { state, conflicts } = S.merge(marks, local, remote, newId);
  assert.strictEqual(conflicts, 0);
  assert.deepStrictEqual(bodies(state), ['a:장보기\n사과 6000\n우유 3000', 'b:여행\n항공 120', 'c:모임\n저녁 30000']);
});
test('양쪽이 다르게 고친 노트는 둘 다 남긴다(이 기기 것은 사본)', () => {
  const local = data([note('a', '장보기\n사과 7000'), base.notes[1], base.notes[2]], base.folders);
  const remote = data([note('a', '장보기\n사과 8000'), base.notes[1], base.notes[2]], base.folders);
  const { state, conflicts } = S.merge(marks, local, remote, newId);
  assert.strictEqual(conflicts, 1);
  assert.deepStrictEqual(bodies(state).slice(0, 2), ['a:장보기\n사과 8000', 'copy1:장보기 (충돌 사본)\n사과 7000']);
  assert.strictEqual(state.notes[1].title, '장보기 (충돌 사본)');
});
test('지운 노트는 다른 쪽이 고치지 않았을 때만 지운다', () => {
  const local = data([base.notes[1], base.notes[2]], base.folders); // a 지움
  const remote = data([base.notes[0], note('b', '여행\n항공 120')], base.folders); // c 지움, b 고침
  assert.deepStrictEqual(bodies(S.merge(marks, local, remote, newId).state), ['b:여행\n항공 120']);
  const edited = data([base.notes[0], base.notes[1]], base.folders); // c 지움
  const keep = data([...base.notes.slice(0, 2), note('c', '모임\n저녁 35000', 'f')], base.folders); // c 고침
  assert.deepStrictEqual(bodies(S.merge(marks, edited, keep, newId).state).pop(), 'c:모임\n저녁 35000');
});
test('새 노트는 양쪽 모두 남기고, 같은 내용이면 나중 시각을 쓴다', () => {
  const local = data([...base.notes, note('x', '새것 1', null, '2026-02-01T00:00:00.000Z')], base.folders);
  const remote = data([...base.notes, note('y', '새것 2'), ], base.folders);
  assert.deepStrictEqual(S.merge(marks, local, remote, newId).state.notes.map(x => x.id), ['a', 'b', 'c', 'y', 'x']);
  const touched = data([{ ...base.notes[0], updatedAt: '2026-03-01T00:00:00.000Z' }, base.notes[1], base.notes[2]], base.folders);
  assert.strictEqual(S.merge(marks, touched, base, newId).state.notes[0].updatedAt, '2026-03-01T00:00:00.000Z');
});
test('폴더: 이름 바꾼 쪽을 쓰고, 안에 노트가 남아 있으면 지우지 않는다', () => {
  const renamed = data(base.notes, [{ id: 'f', name: '생활' }]);
  assert.strictEqual(S.merge(marks, base, renamed, newId).state.folders[0].name, '생활');
  assert.strictEqual(S.merge(marks, renamed, base, newId).state.folders[0].name, '생활');
  const gone = data([base.notes[0], base.notes[1], note('c', '모임\n저녁 30000')], []); // 폴더를 지우며 노트는 밖으로
  const r = S.merge(marks, gone, base, newId).state;
  assert.deepStrictEqual([r.folders.length, r.notes[2].folderId], [0, null]);
  const added = data([...base.notes, note('z', '추가', 'f')], base.folders);
  const r2 = S.merge(marks, data(base.notes.slice(0, 2), []), added, newId).state; // 폴더와 c를 지웠는데 상대가 그 폴더에 새 노트
  assert.deepStrictEqual([r2.folders.map(f => f.id), r2.notes.map(x => x.id)], [['f'], ['a', 'b', 'z']]);
});
test('처음 맞출 때(기록 없음)는 모두 합친다', () => {
  const { state } = S.merge(null, data([note('p', '폰')]), data([note('q', 'PC')]), newId);
  assert.deepStrictEqual(state.notes.map(x => x.id), ['q', 'p']);
});
test('한글을 base64로 주고받는다', () => {
  const text = JSON.stringify(base) + '−₩😀'.repeat(20000);
  assert.strictEqual(S.fromBase64(S.toBase64(text)), text);
  assert.strictEqual(S.fromBase64(S.toBase64('가').replace(/(.{2})/, '$1\n')), '가');
});

// 가짜 GitHub
function fakeGitHub(opts = {}) {
  const files = {}; let shaN = 0; const log = [];
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fetchFn = async (url, init = {}) => {
    log.push((init.method || 'GET') + ' ' + url.replace('https://api.github.com', ''));
    if (opts.offline) throw new TypeError('Failed to fetch');
    if (init.headers.Authorization !== 'Bearer good') return reply(401, {});
    if (url.endsWith('/user')) return reply(200, { login: 'me' });
    if (url.endsWith('/repos/me/data')) return reply(200, { private: !opts.public, name: 'data', owner: { login: 'me' } });
    if (url.endsWith('/repos/me/data/contents/sumnote.json')) {
      const f = files.main;
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body);
        if ((f && body.sha !== f.sha) || (!f && body.sha)) return reply(409, {});
        files.main = { sha: 's' + (++shaN), text: S.fromBase64(body.content) };
        return reply(201, { content: { sha: files.main.sha } });
      }
      if (!f) return reply(404, {});
      if (init.headers.Accept.includes('raw')) return reply(200, f.text);
      return reply(200, opts.big ? { sha: f.sha, content: '', encoding: 'none' } : { sha: f.sha, content: S.toBase64(f.text), encoding: 'base64' });
    }
    return reply(404, {});
  };
  return { files, fetchFn, log };
}
const cfg = { owner: 'me', repo: 'data', token: 'good' };

test('파일이 없으면 null, 올리고 다시 읽는다', async () => {
  const gh = fakeGitHub();
  assert.strictEqual(await S.readFile(cfg, gh.fetchFn), null);
  const sha = await S.writeFile(cfg, '{"a":"한글"}', null, gh.fetchFn);
  assert.deepStrictEqual(await S.readFile(cfg, gh.fetchFn), { sha, text: '{"a":"한글"}' });
  await assert.rejects(S.writeFile(cfg, 'x', 'old', gh.fetchFn), e => e.kind === 'conflict');
  await assert.rejects(S.writeFile(cfg, 'x', null, gh.fetchFn), e => e.kind === 'conflict');
});
test('1MB가 넘는 파일은 내용을 따로 받는다', async () => {
  const gh = fakeGitHub({ big: true });
  await S.writeFile(cfg, '큰 파일', null, gh.fetchFn);
  assert.strictEqual((await S.readFile(cfg, gh.fetchFn)).text, '큰 파일');
});
test('공개 저장소, 틀린 토큰, 없는 저장소, 끊긴 인터넷을 알려 준다', async () => {
  await assert.rejects(S.checkRepo(cfg, fakeGitHub({ public: true }).fetchFn), e => e.kind === 'public');
  await assert.rejects(S.readFile({ ...cfg, token: 'bad' }, fakeGitHub().fetchFn), e => e.kind === 'auth' && /토큰/.test(e.message));
  await assert.rejects(S.readFile({ ...cfg, repo: 'nope' }, fakeGitHub().fetchFn), e => e.kind === 'auth' && /저장소/.test(e.message));
  await assert.rejects(S.readFile(cfg, fakeGitHub({ offline: true }).fetchFn), e => e.kind === 'offline');
  assert.strictEqual(await S.whoAmI('good', fakeGitHub().fetchFn), 'me');
  assert.deepStrictEqual(await S.checkRepo(cfg, fakeGitHub().fetchFn), { owner: 'me', repo: 'data' });
});

Promise.all(pending).then(() => console.log(`동기화 테스트 통과: ${passed}개`));
