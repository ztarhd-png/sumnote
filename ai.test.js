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
const plan = extra => ({ summary: '', cannot: '', order: [3, 2, 4, 5, 6], rewritten_lines: [], headings: [], remove: [], line_moves: [], note_moves: [], ...extra });
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
  assert.strictEqual(Ai.DEFAULT_MODEL, 'claude-haiku-5-5');
  const { url, init } = Ai.buildRequest({ apiKey: 'k', model: 'claude-opus-5-5', state: base(), noteId: 'a', request: '정렬' });
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

// 형식 바꾸기와 이중 검수
const dated = () => ({ version: 1, folders: [], notes: [
  { id: 'a', title: '기록', body: ['기록', '사과 6,000 2013.5.3', '우유 3,200 2014.1.2', '', '할인 -2,000 2012.3.4'].join('\n'), folderId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'b', title: '다른', body: '다른\n항공권 100', folderId: null, updatedAt: '2026-01-01T00:00:00.000Z' }
] });
const re = (lines, extra) => ({ summary: '', cannot: '', order: [2, 3, 4, 5], rewritten_lines: lines, headings: [], remove: [], line_moves: [], note_moves: [], ...extra });
const auditOf = p => { const s = dated(); const r = Ai.applyPlan(s, 'a', p, () => 'n', NOW); return { r, a: Ai.auditPlan(s, r.state, 'a', p) }; };
const good = ['# 2014년', '2014.1.2 우유 3200', '', '# 2013년', '2013.5.3 사과 6,000', '', '# 2012년', '2012.3.4 할인 -2,000'];

test('형식을 바꿔 다시 쓰면 제목은 그대로, 금액이 맞으면 통과', () => {
  const { r, a } = auditOf(re(good));
  assert.strictEqual(a.ok, true, a.problem);
  assert.strictEqual(r.state.notes[0].body, ['기록', ...good].join('\n'));
  assert.strictEqual(r.preview.before, r.preview.after);
  assert.strictEqual(a.amounts, 3);
  assert.deepStrictEqual(r.preview.rows[0], { text: '# 2014년', heading: true });
});
test('다시 쓴 줄 안의 줄바꿈은 줄로 나뉜다', () => {
  assert.strictEqual(auditOf(re(['a 3,200\nb 6,000', 'c -2,000'])).r.state.notes[0].body, '기록\na 3,200\nb 6,000\nc -2,000');
});
test('글자 변화를 알려 준다', () => {
  const { a } = auditOf(re(good));
  assert.ok(a.gained.some(([c]) => c === '년'));
  assert.deepStrictEqual(a.lost, []);
});
test('순서만 바꾸면 글자 변화를 따지지 않는다', () => {
  const p = re([], { order: [3, 2, 4, 5] });
  const { a } = auditOf(p);
  assert.strictEqual(a.ok, true); assert.strictEqual(a.rewritten, false); assert.deepStrictEqual(a.gained, []);
});
const caught = (name, lines, word, extra) => test('검수 실패: ' + name, () => { const { a } = auditOf(re(lines, extra)); assert.strictEqual(a.ok, false); assert.ok(a.problem.includes(word), a.problem); });
caught('금액을 바꿈', ['2014.1.2 우유 3201', '2013.5.3 사과 6,000', '2012.3.4 할인 -2,000'], '없어진 금액 1개: 3200');
caught('금액을 뺌', ['2014.1.2 우유', '2013.5.3 사과 6,000', '2012.3.4 할인 -2,000'], '없어진 금액');
caught('부호를 바꿈', ['2014.1.2 우유 3200', '2013.5.3 사과 6,000', '2012.3.4 할인 2,000'], '새로 생긴 금액 1개: 2000');
caught('금액을 합침', ['우유와 사과 9200', '2012.3.4 할인 -2,000'], '없어진 금액 2개: 3200, 6000');
caught('금액 줄을 #으로 숨김', ['# 2014.1.2 우유 3200', '2013.5.3 사과 6,000', '2012.3.4 할인 -2,000'], '없어진 금액');
caught('금액에 글자를 붙여 계산에서 빠짐', ['2014.1.2 우유 3200원', '2013.5.3 사과 6,000', '2012.3.4 할인 -2,000'], '없어진 금액');
caught('날짜가 금액으로 잡힘', ['2014 우유 3200', '2013.5.3 사과 6,000', '2012.3.4 할인 -2,000'], '새로 생긴 금액 1개: 2014');
test('두 금액을 맞바꾸면 합계는 같아도 위치는 금액 검사로 못 잡지만 글자는 같다(미리보기로 확인)', () => {
  assert.strictEqual(auditOf(re(['2014.1.2 우유 6000', '2013.5.3 사과 3200', '2012.3.4 할인 -2,000'])).a.ok, true);
});
test('지운 줄의 금액은 빠져도 통과하고 합계는 준다', () => {
  const { r, a } = auditOf(re(['2014.1.2 우유 3200', '2013.5.3 사과 6,000'], { order: [2, 3, 4], remove: [5] }));
  assert.strictEqual(a.ok, true, a.problem);
  assert.strictEqual(r.preview.after, 9200);
});
test('다른 노트로 옮긴 금액은 전체 합계에서 그대로 유지', () => {
  const { r, a } = auditOf(re(['2014.1.2 우유 3200', '2013.5.3 사과 6,000'], { order: [2, 3, 4], line_moves: [{ note: 2, new_title: '', lines: [5] }] }));
  assert.strictEqual(a.ok, true, a.problem);
  assert.ok(r.state.notes[1].body.endsWith('할인 -2,000 2012.3.4'));
});
test('rewritten_lines가 없으면 계획 거부', () => {
  const p = plan(); delete p.rewritten_lines;
  assert.ok(Ai.checkPlan(p, base(), 'a'));
});
test('요청: 재시도 때 지난 문제를 함께 보낸다', () => {
  const { init } = Ai.buildRequest({ apiKey: 'k', model: Ai.DEFAULT_MODEL, state: base(), noteId: 'a', request: 'x', problem: '없어진 금액 1개: 3200' });
  const sent = JSON.parse(init.body);
  assert.strictEqual(sent.stream, true);
  assert.ok(sent.messages[0].content.includes('없어진 금액 1개: 3200'));
});

// 스트리밍
const sse = chunks => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); chunks.forEach(x => c.enqueue(e.encode(x))); c.close(); } }));
const events = list => list.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const pending = [];
const atest = (name, fn) => pending.push(fn().then(() => { passed++; }, e => { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }));
const stream = [
  { type: 'message_start', message: {} },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'ping' },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"order":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '[2,"한글"]}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' }
];
atest('스트림: 글 블록을 모으고 진행량을 알린다', async () => {
  const seen = [];
  const data = await Ai.readStream(sse([events(stream)]), n => seen.push(n));
  assert.deepStrictEqual(Ai.readResponse(200, data), { order: [2, '한글'] });
  assert.strictEqual(seen[seen.length - 1], '{"order":[2,"한글"]}'.length);
});
atest('스트림: 한글이 조각 경계에서 잘려도 온전하다', async () => {
  const bytes = new TextEncoder().encode(events(stream));
  const cut = bytes.indexOf(0xed) + 1; // '한'의 첫 바이트 바로 뒤
  const r = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); } }));
  assert.deepStrictEqual(Ai.readResponse(200, await Ai.readStream(r)), { order: [2, '한글'] });
});
atest('스트림: 입력과 출력 토큰을 모은다', async () => {
  const withUsage = stream.map(e => e.type === 'message_start' ? { ...e, message: { usage: { input_tokens: 1000, output_tokens: 1 } } } : e.type === 'message_delta' ? { ...e, usage: { output_tokens: 2000 } } : e);
  assert.deepStrictEqual((await Ai.readStream(sse([events(withUsage)]))).usage, { input: 1000, output: 2000 });
});
test('비용: 모델 단가로 원화 계산', () => {
  const usage = { input: 1000000, output: 1000000 };
  assert.strictEqual(Math.round(Ai.costWon('claude-haiku-5-5', usage)), Math.round((0.5 + 2.5) * 1400));
  assert.strictEqual(Math.round(Ai.costWon('claude-haiku-5-5', { input: 100000, output: 0 })), 14);
  assert.strictEqual(Math.round(Ai.costWon('claude-sonnet-5-5', { input: 1000000, output: 0 })), 2800);
  assert.strictEqual(Math.round(Ai.costWon('claude-opus-5-5', { input: 0, output: 1000000 })), 28000);
});
test('비용 문구', () => {
  assert.strictEqual(Ai.costLabel(0.4), '1원 미만');
  assert.strictEqual(Ai.costLabel(1234.4), '약 1,234원');
});
atest('스트림: 도중의 혼잡 오류', async () => {
  await assert.rejects(Ai.readStream(sse([events([{ type: 'error', error: { type: 'overloaded_error', message: 'x' } }])])), e => e instanceof Ai.AiError && e.message.includes('혼잡'));
});
atest('스트림: 잘린 답은 읽지 못했다고 알린다', async () => {
  const cutoff = stream.slice(0, 7);
  assert.throws(() => Ai.readResponse(200, { stop_reason: null, content: [{ type: 'text', text: '{"order":' }] }), Ai.AiError);
  assert.ok(await Ai.readStream(sse([events(cutoff)])));
});

Promise.all(pending).then(() => { if (!process.exitCode) console.log(`${passed} tests passed`); });
