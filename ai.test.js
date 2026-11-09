const assert = require('assert');
const Ai = require('./ai.js');

const body = ['장보기', '사과 6,000', '우유 3,200', '', '---', '식빵 4,500'].join('\n');
const base = () => ({
  version: 1,
  folders: [{ id: 'f1', name: '일상' }],
  notes: [
    { id: 'a', title: '장보기', body, folderId: 'f1', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', title: '여행', body: '여행\n항공권 100\n\n', folderId: null, updatedAt: '2026-01-01T00:00:00.000Z' }
  ]
});
const plan = extra => ({ summary: '', cannot: '', order: [3, 2, 4, 5, 6], headings: [], remove: [], line_moves: [], note_moves: [], ...extra });
const NOW = '2026-02-02T00:00:00.000Z';
let ids = 0;
const run = (p, s = base()) => Ai.applyPlan(s, 'a', p, () => 'new' + ++ids, NOW);
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; } };

test('줄을 다시 배열하고 글자는 그대로', () => {
  const r = run(plan());
  assert.strictEqual(r.state.notes[0].body, ['장보기', '우유 3,200', '사과 6,000', '', '---', '식빵 4,500'].join('\n'));
  assert.strictEqual(r.preview.after, r.preview.before);
  assert.strictEqual(r.state.notes[0].updatedAt, NOW);
});
test('원본 state는 바뀌지 않는다', () => {
  const s = base(), copy = JSON.stringify(s);
  run(plan(), s);
  assert.strictEqual(JSON.stringify(s), copy);
});
test('걸러낸 줄은 빠지고 합계가 준다', () => {
  const r = run(plan({ order: [2, 4, 5, 6], remove: [3] }));
  assert.ok(!r.state.notes[0].body.includes('우유'));
  assert.deepStrictEqual(r.preview.removed, ['우유 3,200']);
  assert.strictEqual(r.preview.before - r.preview.after, 3200);
});
test('묶음 이름은 # 줄이라 합계에 들어가지 않는다', () => {
  const r = run(plan({ headings: [{ before: 3, text: '## 유제품 100\n' }] }));
  assert.strictEqual(r.state.notes[0].body.split('\n')[1], '# 유제품 100');
  assert.strictEqual(r.preview.after, r.preview.before);
});
test('기존 노트로 옮기면 끝의 빈 줄 뒤가 아니라 내용 바로 뒤에 붙는다', () => {
  const r = run(plan({ order: [2, 4, 5, 6], line_moves: [{ note: 2, new_title: '', lines: [3] }] }));
  assert.strictEqual(r.state.notes[1].body, '여행\n항공권 100\n우유 3,200');
  assert.deepStrictEqual(r.preview.moved, [{ title: '여행', isNew: false, lines: ['우유 3,200'] }]);
});
test('같은 제목의 새 노트는 하나로 합치고 원래 폴더에 만든다', () => {
  const r = run(plan({ order: [4, 5, 6], line_moves: [{ note: 0, new_title: '과일', lines: [2] }, { note: 0, new_title: '과일', lines: [3] }] }));
  assert.strictEqual(r.state.notes.length, 3);
  assert.strictEqual(r.state.notes[2].body, '과일\n사과 6,000\n우유 3,200');
  assert.strictEqual(r.state.notes[2].folderId, 'f1');
  assert.strictEqual(r.state.notes[2].title, '과일');
});
test('노트를 폴더로 옮기고 새 폴더도 만든다', () => {
  const r = run(plan({ order: [2, 3, 4, 5, 6], note_moves: [{ note: 2, folder: 1, new_folder: '' }, { note: 1, folder: 0, new_folder: '정산' }] }));
  assert.strictEqual(r.state.notes[1].folderId, 'f1');
  assert.strictEqual(r.state.folders[1].name, '정산');
  assert.strictEqual(r.state.notes[0].folderId, r.state.folders[1].id);
  assert.strictEqual(r.state.notes[1].updatedAt, base().notes[1].updatedAt, '폴더만 옮기면 수정 시각은 그대로');
});
test('폴더 0은 폴더 밖으로 뺀다', () => {
  assert.strictEqual(run(plan({ order: [2, 3, 4, 5, 6], note_moves: [{ note: 1, folder: 0, new_folder: '' }] })).state.notes[0].folderId, null);
});
test('아무것도 안 바뀌면 changed는 false', () => {
  assert.strictEqual(run(plan({ order: [2, 3, 4, 5, 6] })).preview.changed, false);
});

const bad = (name, p) => test('거부: ' + name, () => assert.ok(Ai.checkPlan(p, base(), 'a')));
test('올바른 계획은 통과', () => assert.strictEqual(Ai.checkPlan(plan(), base(), 'a'), null));
bad('줄 누락', plan({ order: [2, 3, 4, 5] }));
bad('줄 중복', plan({ order: [2, 2, 3, 4, 5, 6] }));
bad('제목 줄 포함', plan({ order: [1, 2, 3, 4, 5, 6] }));
bad('없는 줄', plan({ order: [2, 3, 4, 5, 6, 7] }));
bad('order와 remove 중복', plan({ remove: [2] }));
bad('order가 배열 아님', plan({ order: 'x' }));
bad('소수 줄번호', plan({ order: [2.5, 3, 4, 5, 6] }));
bad('제 노트로 이동', plan({ order: [2, 4, 5, 6], line_moves: [{ note: 1, new_title: '', lines: [3] }] }));
bad('없는 노트로 이동', plan({ order: [2, 4, 5, 6], line_moves: [{ note: 9, new_title: '', lines: [3] }] }));
bad('제목 없는 새 노트', plan({ order: [2, 4, 5, 6], line_moves: [{ note: 0, new_title: ' ', lines: [3] }] }));
bad('남지 않는 줄 앞의 묶음', plan({ order: [2, 4, 5, 6], remove: [3], headings: [{ before: 3, text: 'x' }] }));
bad('없는 폴더', plan({ note_moves: [{ note: 1, folder: 5, new_folder: '' }] }));
bad('없는 노트 폴더 이동', plan({ note_moves: [{ note: 0, folder: 1, new_folder: '' }] }));

test('요청: 브라우저 헤더, 본문에 값과 다른 노트 제목만', () => {
  const { url, init } = Ai.buildRequest({ apiKey: 'k', model: Ai.DEFAULT_MODEL, state: base(), noteId: 'a', request: '정렬' });
  assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(init.headers['x-api-key'], 'k');
  const sent = JSON.parse(init.body);
  assert.strictEqual(sent.model, 'claude-opus-5-5');
  assert.strictEqual(sent.fallbacks, 'default');
  assert.strictEqual(sent.output_config.format.type, 'json_schema');
  const text = sent.messages[0].content;
  assert.ok(text.includes('2\t사과 6,000\t금액 6000'));
  assert.ok(text.includes('5\t---\t소계선'));
  assert.ok(text.includes('여행'));
  assert.ok(!text.includes('항공권'), '다른 노트의 본문은 보내지 않는다');
});
test('요청: Haiku에는 fallbacks를 붙이지 않는다', () => {
  const { init } = Ai.buildRequest({ apiKey: 'k', model: 'claude-haiku-5-5', state: base(), noteId: 'a', request: 'x' });
  assert.strictEqual(JSON.parse(init.body).fallbacks, undefined);
  assert.strictEqual(init.headers['anthropic-beta'], undefined);
});
test('스키마: 모든 객체가 닫혀 있고 모든 필드가 필수', () => {
  const walk = s => {
    if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false); assert.deepStrictEqual(s.required, Object.keys(s.properties)); Object.values(s.properties).forEach(walk); }
    if (s.type === 'array') walk(s.items);
  };
  walk(Ai.SCHEMA);
});

test('응답: 마지막 글 블록을 읽는다', () => {
  const p = Ai.readResponse(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"order":[1]}' }] });
  assert.deepStrictEqual(p.order, [1]);
});
const fails = (name, status, data, word) => test('응답 오류: ' + name, () => assert.throws(() => Ai.readResponse(status, data), e => e instanceof Ai.AiError && e.message.includes(word)));
fails('잘못된 키', 401, {}, 'API 키');
fails('크레딧 부족', 400, { error: { message: 'Your credit balance is too low' } }, '크레딧');
fails('한도', 429, {}, '잠시 뒤');
fails('혼잡', 529, {}, '혼잡');
fails('거절', 200, { stop_reason: 'refusal', content: [] }, '처리하지 않겠다');
fails('잘림', 200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }, '너무 길어');
fails('JSON 아님', 200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }, '읽지 못했어요');

if (!process.exitCode) console.log(`${passed} tests passed`);
