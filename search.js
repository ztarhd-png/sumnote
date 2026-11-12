(function (root) {
  'use strict';
  // 단순 검색: 모든 노트에서 검색어의 낱말이 모두 들어 있는 줄을 찾는다.
  // 대소문자, 숫자 사이의 쉼표(12,000 = 12000), 빼기 기호(−/-)는 가리지 않는다.
  // 이 파일은 화면과 분리된 순수 로직이다(search.test.js로 검사).
  const Parser = typeof module !== 'undefined' && module.exports ? require('./parser.js') : root.SumParser;

  // 비교용 글자와, 그 글자가 원래 몇 번째 글자였는지(칠할 위치)를 함께 만든다.
  function folded(raw) {
    let text = '';
    const map = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === ',' && /\d/.test(raw[i - 1] || '') && /\d/.test(raw[i + 1] || '')) continue;
      for (const ch of c === '−' ? '-' : c.toLocaleLowerCase()) { text += ch; map.push(i); }
    }
    map.push(raw.length);
    return { text, map };
  }
  const terms = query => folded(String(query)).text.split(/\s+/).filter(Boolean);
  const hasAll = (raw, list) => { const t = folded(raw).text; return list.length > 0 && list.every(w => t.includes(w)); };

  // [{ noteId, titleHit, hits: [{ index, raw, value }] }] — index는 노트의 줄 번호(0 = 제목)다.
  function findLines(state, query) {
    const list = terms(query);
    if (!list.length) return [];
    const results = [];
    for (const note of state.notes) {
      const lines = Parser.parseNote(note.body).lines;
      const hits = [];
      lines.forEach((line, i) => {
        if (i > 0 && line.raw.trim() && hasAll(line.raw, list)) hits.push({ index: i, raw: line.raw, value: line.type === 'value' ? line.value : null });
      });
      const titleHit = hasAll(note.title || lines[0]?.raw || '', list);
      if (hits.length || titleHit) results.push({ noteId: note.id, titleHit, hits });
    }
    return results;
  }

  // 원문에서 검색어가 들어 있는 부분의 [시작, 끝] 위치. 겹치면 합친다.
  function marks(raw, query) {
    const { text, map } = folded(raw);
    const ranges = [];
    for (const w of terms(query)) {
      for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) ranges.push([map[at], map[at + w.length - 1] + 1]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
    }
    return merged;
  }

  const api = { findLines, marks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SumSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
