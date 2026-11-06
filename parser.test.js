'use strict';
const assert = require('node:assert/strict');
const { parseLine, parseNote } = require('./parser.js');
const cases = [
  ['커피 12,000',12000], ['1.25',1.25], ['환불 -5000',-5000], ['환불 −5000원',-5000],
  ['3만',30000], ['1.5만원',15000], ['2천',2000], ['1억2천만',120000000],
  ['12000*3',36000], ['5000+3000',8000], ['(5000+3000)/2',4000], ['2+3*4',14],
  ['-2 * (3 + 4)',-14], ['1.5만원+2천원',17000], ['사과 2개 3000원',3000],
  ['식비 5000 교통 2000',2000], ['# 3000',null], [' // 5000',null], ['',null],
  ['12 30',30], ['5000 3000',3000], ['3만5천원',35000], ['2억3만4천',200034000], ['0.1+0.2',0.1+0.2], ['메모만',null], ['1/0',null], ['2+*3',null], ['2+',null], ['---',null], ['0',0]
];
for (const [line, expected] of cases) assert.equal(parseLine(line).value, expected, line);
const note = parseNote('식비 12000\n커피 3000\n---\n환불 -5000\n---\n2*1000\n# 9000');
assert.equal(note.total, 12000);
assert.equal(note.lines[2].value, 15000);
assert.equal(note.lines[4].value, -5000);
assert.equal(parseNote('---\n---').total, 0);
console.log(`파서 테스트 통과: ${cases.length + 4}개`);
