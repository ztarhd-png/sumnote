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
  function parseLine(line) {
    const raw = line.trim();
    if (!raw || /^(#|\/\/)/.test(raw)) return { type: 'ignored', value: null };
    if (raw === '---') return { type: 'subtotal', value: null };
    const text = raw.replace(datePattern, '$1 ').trim();
    if (!text) return { type: 'ignored', value: null };
    const value = expression(text);
    if (value !== null) return { type: 'value', value };
    // An invalid expression must never silently turn into its last operand.
    if (/^[\d\s,.원억만천()+*/−-]+$/.test(text) && /[+*/()-]/.test(text)) return { type: 'invalid', value: null };
    const matches = [...text.replace(/−/g, '-').matchAll(new RegExp('[+-]?' + amountSource, 'g'))];
    if (!matches.length) return { type: 'ignored', value: null };
    const last = matches[matches.length - 1][0];
    const n = amount(last.replace(/^[+-]/, '')) * (last[0] === '-' ? -1 : 1);
    return { type: 'value', value: Number.isFinite(n) ? n : null };
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
