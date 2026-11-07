(function (root) {
  'use strict';
  const numberSource = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  const unitSource = numberSource + '(?:천(?:억|만)?|억|만)';
  const amountSource = '(?:(?:' + unitSource + ')+(?:' + numberSource + ')?|' + numberSource + ')(?:원)?';
  function amount(text) {
    let sum = 0, chunk = 0, pending = 0;
    const parts = text.replace(/[,원]/g, '').match(/\d+(?:\.\d+)?|억|만|천/g) || [];
    for (const part of parts) {
      if (part === '천') { chunk += pending * 1000; pending = 0; }
      else if (part === '만') { sum += (chunk + pending) * 1e4; chunk = 0; pending = 0; }
      else if (part === '억') { sum = (sum + chunk + pending) * 1e8; chunk = 0; pending = 0; }
      else pending = Number(part);
    }
    return sum + chunk + pending;
  }

  function expression(source) {
    const s = source.replace(/−/g, '-').trim();
    const tokens = s.match(new RegExp(amountSource + '|[()+*/-]', 'g')) || [];
    if (tokens.join('') !== s.replace(/\s/g, '') || !tokens.length) return null;
    let i = 0;
    function atom() {
      if (tokens[i] === '+' || tokens[i] === '-') { const sign = tokens[i++] === '-' ? -1 : 1; return sign * atom(); }
      if (tokens[i] === '(') { i++; const v = add(); if (tokens[i++] !== ')') throw Error(); return v; }
      if (!tokens[i] || !/^\d/.test(tokens[i])) throw Error();
      return amount(tokens[i++]);
    }
    function multiply() { let v = atom(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], b = atom(); v = op === '*' ? v * b : v / b; } return v; }
    function add() { let v = multiply(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], b = multiply(); v = op === '+' ? v + b : v - b; } return v; }
    try { const value = add(); return i === tokens.length && Number.isFinite(value) ? value : null; } catch (_) { return null; }
  }
  // 날짜(2025.8.18. · 2025-08-22 · 2025/8/1 · 9.1.)는 금액이 아니므로 계산 전에 지운다.
  // (lookbehind 없이 작성: 오래된 iOS Safari에서도 동작)
  const datePattern = /(^|[^\d.,])(?:\d{4}\s?[./-]\s?\d{1,2}\s?[./-]\s?\d{1,2}\.?|\d{1,2}\.\d{1,2}\.)(?!\d)/g;
  // spans: 합계에 들어간 숫자의 위치 [시작, 끝, 부호] — 본문에서 파랑/빨강으로 칠한다.
  function parseLine(line) {
    const lead = line.length - line.trimStart().length;
    const raw = line.trim();
    if (!raw || /^(#|\/\/)/.test(raw)) return { type: 'ignored', value: null, spans: [] };
    if (raw === '---') return { type: 'subtotal', value: null, spans: [] };
    // 날짜는 같은 길이의 공백으로 바꿔 글자 위치를 그대로 둔다.
    const text = raw.replace(datePattern, (m, p) => p + ' '.repeat(m.length - p.length));
    if (!text.trim()) return { type: 'ignored', value: null, spans: [] };
    const value = expression(text);
    if (value !== null) {
      const a = text.search(/\S/), b = text.replace(/\s+$/, '').length;
      return { type: 'value', value, spans: [[lead + a, lead + b, Math.sign(value)]] };
    }
    // An invalid expression must never silently turn into its last operand.
    if (/^[\d\s,.원억만천()+*/−-]+$/.test(text) && /[+*/()-]/.test(text)) return { type: 'invalid', value: null, spans: [] };
    // 한 줄의 금액은 모두 더한다(SumsApp과 같음: '국세 24990 지방세 2490' → 27,480).
    // 3월·4대보험·25년·2잔·10%·14:30처럼 글자나 기호에 붙은 숫자는 금액이 아니다.
    const s = text.replace(/−/g, '-');
    const attached = /[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ%:]/;
    const spans = [];
    let sum = 0;
    for (const m of s.matchAll(new RegExp('[+-]?' + amountSource, 'g'))) {
      const after = s[m.index + m[0].length] || '', before = m.index ? s[m.index - 1] : '';
      if (attached.test(after) || before === ':') continue;
      const n = amount(m[0].replace(/^[+-]/, '')) * (m[0][0] === '-' ? -1 : 1);
      sum += n;
      spans.push([lead + m.index, lead + m.index + m[0].length, Math.sign(n)]);
    }
    if (!spans.length) return { type: 'ignored', value: null, spans };
    return { type: 'value', value: Number.isFinite(sum) ? sum : null, spans };
  }
  function parseNote(text) {
    let total = 0, section = 0;
    const lines = text.split('\n').map(raw => {
      const parsed = parseLine(raw);
      if (parsed.type === 'subtotal') { parsed.value = section; section = 0; }
      else if (parsed.value !== null) { total += parsed.value; section += parsed.value; }
      return { raw, ...parsed };
    });
    return { lines, total };
  }
  const api = { parseLine, parseNote, expression };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SumParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
