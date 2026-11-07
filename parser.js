(function (root) {
  'use strict';
  const numberSource = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  // 금액은 숫자(쉼표·소수점)만. 6억·3만·12,000원처럼 숫자 바로 뒤에 글자가 붙으면
  // 표기용 글자로 보고 계산하지 않는다.
  const amountSource = numberSource;
  function amount(text) { return Number(text.replace(/,/g, '')); }

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
    // 줄 앞 번호(1. · 10. · 2))도 금액이 아니므로 같은 길이의 공백으로 바꾼다. 3.5 같은 소수는 그대로.
    const text = raw.replace(datePattern, (m, p) => p + ' '.repeat(m.length - p.length))
      .replace(/^(?:\s*\d{1,3}[.)](?!\d))+/, m => ' '.repeat(m.length));
    if (!text.trim()) return { type: 'ignored', value: null, spans: [] };
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
      // 2013~2014 · 3 ~ 5 · 10,000~20,000처럼 물결(~) 양쪽 숫자는 범위 표기이므로 뺀다(띄어 써도 같음).
      if (/^\s*[~～〜]/.test(s.slice(end)) || /[~～〜]\s*$/.test(s.slice(0, m.index))) continue;
      // 사칙연산은 하지 않는다. 5000-3000 · 12000*3 · 1/2처럼 기호로 숫자끼리 붙여 쓴 것은 글이다.
      // 5000 -3000처럼 띄우면 따로 떨어진 숫자 두 개(5000과 -3000)다.
      // 연산 기호가 숫자에 바로 붙어 있으면 뺀다. (숫자 자기 앞의 부호 -3000 · +3000은 숫자의 일부라 괜찮다.)
      if (/[+\-*/×÷=^]/.test(after) || /[+\-*/×÷=^]/.test(before)) continue;
      // 4,4 · 1,0000 · 1.2.3 · 12,34,567처럼 쉼표·점이 천 단위/소수점 규칙에 맞지 않아
      // 숫자가 쪼개진 경우: 쪼개진 조각은 모두 금액이 아니다(조각이 다른 숫자에 붙어 있으면 뺀다).
      const glued = (ch, next) => /\d/.test(ch) || (/[.,]/.test(ch) && /\d/.test(next || ''));
      if (glued(after, s[end + 1]) || glued(before, m.index > 1 ? s[m.index - 2] : '')) continue;
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
  const api = { parseLine, parseNote, titleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SumParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
