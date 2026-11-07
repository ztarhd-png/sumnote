(function (root) {
  'use strict';
  const numberSource = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  // 금액은 숫자(쉼표·소수점)만. 6억·3만·12,000원처럼 숫자 바로 뒤에 글자가 붙으면
  // 표기용 글자로 보고 계산하지 않는다.
  const amountSource = numberSource;
  function amount(text) { return Number(text.replace(/,/g, '')); }

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
    if (/^[\d\s,.()+*/−-]+$/.test(text) && /[+*/()-]/.test(text)) return { type: 'invalid', value: null, spans: [] };
    // 한 줄의 금액은 모두 더한다(SumsApp과 같음: '국세 24990 지방세 2490' → 27,480).
    // 6억·12,000원·3월·4대보험·25년·2잔·10%·14:30처럼 글자나 기호가 바로 뒤에 붙은 숫자는 금액이 아니다.
    const s = text.replace(/−/g, '-');
    // 마운트타입4·P5B3-KR·A4처럼 글자 바로 뒤에 붙은 숫자도 글자의 일부다:
    // 앞에 글자가 붙었거나, 뒤에 '-'나 '/'를 사이에 두고 글자가 이어지면 뺀다.
    const attached = /[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ%:_]/, code = /[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_:]/;
    const spans = [];
    let sum = 0;
    for (const m of s.matchAll(new RegExp('[+-]?' + amountSource, 'g'))) {
      const end = m.index + m[0].length, after = s[end] || '', before = m.index ? s[m.index - 1] : '';
      if (attached.test(after) || code.test(before)) continue;
      if (/[-/]/.test(after) && attached.test(s[end + 1] || '')) continue;
      const n = amount(m[0].replace(/^[+-]/, '')) * (m[0][0] === '-' ? -1 : 1);
      sum += n;
      spans.push([lead + m.index, lead + m.index + m[0].length, Math.sign(n)]);
    }
    if (!spans.length) return { type: 'ignored', value: null, spans };
    return { type: 'value', value: Number.isFinite(sum) ? sum : null, spans };
  }
  // 노트의 첫 줄은 제목이다. 제목은 합계에 넣지 않는다.
  function titleOf(text) { return text.split('\n', 1)[0].trim(); }
  function parseNote(text) {
    let total = 0, section = 0;
    const lines = text.split('\n').map((raw, i) => {
      if (i === 0) return { raw, type: 'title', value: null, spans: [] };
      const parsed = parseLine(raw);
      if (parsed.type === 'subtotal') { parsed.value = section; section = 0; }
      else if (parsed.value !== null) { total += parsed.value; section += parsed.value; }
      return { raw, ...parsed };
    });
    return { lines, total };
  }
  const api = { parseLine, parseNote, expression, titleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SumParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
