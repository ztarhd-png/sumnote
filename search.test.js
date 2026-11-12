const assert = require('assert');
const S = require('./search.js');

const state = {
  version: 1,
  folders: [],
  notes: [
    { id: 'a', title: '옷 2020', body: '옷 2020\n2020-01-03 Nike Air 123,000\n2020-05-20 중고 판매 −45000\n\n# 2019년\n2019-04-01 구두 88000', folderId: null, updatedAt: '' },
    { id: 'b', title: '여행 경비', body: '여행 경비\n항공권 100\n숙소 nike 매장 50', folderId: null, updatedAt: '' }
  ]
};
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; } };

test('대소문자를 가리지 않고 모든 노트에서 줄을 찾는다', () => {
  const r = S.findLines(state, 'NIKE');
  assert.deepStrictEqual(r.map(x => [x.noteId, x.hits.map(h => h.index)]), [['a', [1]], ['b', [2]]]);
  assert.strictEqual(r[0].hits[0].value, 123000);
});
test('낱말이 여럿이면 한 줄에 모두 있어야 한다(순서는 상관없다)', () => {
  assert.deepStrictEqual(S.findLines(state, 'air 2020').map(x => x.hits.map(h => h.index)), [[1]]);
  assert.deepStrictEqual(S.findLines(state, '매장 air'), []);
});
test('숫자의 쉼표와 빼기 기호 모양은 가리지 않는다', () => {
  assert.strictEqual(S.findLines(state, '123000')[0].hits[0].index, 1);
  assert.strictEqual(S.findLines(state, '123,000')[0].hits[0].index, 1);
  assert.strictEqual(S.findLines(state, '-45000')[0].hits[0].index, 2);
});
test('제목만 맞는 노트도 알려 주고, 빈 검색어는 아무것도 찾지 않는다', () => {
  const r = S.findLines(state, '경비');
  assert.deepStrictEqual(r, [{ noteId: 'b', titleHit: true, hits: [] }]);
  assert.deepStrictEqual(S.findLines(state, '   '), []);
});
test('칠할 위치는 원문 기준이다', () => {
  const raw = '2020-01-03 Nike Air 123,000';
  assert.deepStrictEqual(S.marks(raw, 'nike 123000').map(([a, b]) => raw.slice(a, b)), ['Nike', '123,000']);
  assert.deepStrictEqual(S.marks('aaa', 'aa'), [[0, 2]]);
  assert.deepStrictEqual(S.marks('사과 사과', '사과 과'), [[0, 2], [3, 5]]);
});

console.log(`검색 테스트 통과: ${passed}개`);
