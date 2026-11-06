(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'sumnote.data.v1';
  const fmt = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(Object.is(n, -0) ? 0 : n);
  const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const now = new Date().toISOString();
  let state, storageBroken = false, currentFolder = null, currentNote = null, query = '', namingAction, deleteAction, toastTimer;
  function validData(data) {
    return data && data.version === 1 && Array.isArray(data.notes) && Array.isArray(data.folders)
      && data.folders.every(f => f && typeof f.id === 'string' && typeof f.name === 'string' && f.name.trim())
      && new Set(data.folders.map(f => f.id)).size === data.folders.length
      && data.notes.every(n => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.updatedAt === 'string' && Number.isFinite(Date.parse(n.updatedAt)) && (n.folderId === null || data.folders.some(f => f.id === n.folderId)))
      && new Set(data.notes.map(n => n.id)).size === data.notes.length;
  }
  function starter() {
    const folder = id();
    return { version: 1, folders: [{ id: folder, name: '일상 기록' }], notes: [
      { id: id(), title: '이번 주 장보기', body: '사과 6,000\n우유 3,200\n식빵 4,500\n달걀 7,800\n---\n주방 세제 4,900\n할인 -2,000', folderId: folder, updatedAt: now },
      { id: id(), title: '제주 여행 준비', body: '항공권 178,000\n숙소 24만원\n렌터카 65,000\n# 설레는 여행 준비', folderId: null, updatedAt: now },
      { id: id(), title: '작은 모임 정산', body: '저녁 78,000\n카페 24,000\n간식 12,000', folderId: folder, updatedAt: now }
    ] };
  }
  try { const saved = localStorage.getItem(KEY); if (saved) { state = JSON.parse(saved); if (!validData(state)) throw Error(); } else state = starter(); }
  catch (_) { state = { version: 1, folders: [], notes: [] }; storageBroken = true; }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
  function persist() {
    if (storageBroken) { $('save-status').textContent = '저장 확인 필요'; return false; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); $('save-status').textContent = '✓ 자동 저장됨'; return true; }
    catch (_) { $('save-status').textContent = '저장 공간 부족'; toast('저장하지 못했어요. JSON 백업으로 노트를 보관해 주세요.'); return false; }
  }
  function active() { return state.notes.find(n => n.id === currentNote); }
  function total(note) { return SumParser.parseNote(note.body).total; }
  function ordered(notes) { return [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); }
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function dateLabel(date) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(date)); }
  function renderNav() {
    $('note-count').textContent = state.notes.length;
    $('all-notes').classList.toggle('active', currentFolder === null);
    $('folders').replaceChildren();
    for (const folder of state.folders) {
      const button = element('button', 'nav-item folder-item' + (currentFolder === folder.id ? ' active' : ''));
      button.append(element('span', '', '▱'), element('span', 'folder-name', folder.name));
      button.append(element('small', '', fmt(state.notes.filter(n => n.folderId === folder.id).reduce((s, n) => s + total(n), 0))));
      button.title = folder.name + ' · 폴더 합계';
      button.onclick = () => selectFolder(folder.id);
      $('folders').append(button);
    }
    const f = state.folders.find(f => f.id === currentFolder);
    $('collection-title').replaceChildren(document.createTextNode(query ? '검색 결과' : f?.name || '모든 노트'), element('span', '', '.'));
    $('collection-actions').hidden = !f || !!query;
    if (f) $('folder-total').textContent = '폴더 합계 ' + fmt(state.notes.filter(n => n.folderId === f.id).reduce((s, n) => s + total(n), 0)) + '원';
  }
  function renderCards() {
    renderNav();
    const matches = state.notes.filter(n => query ? (n.title + '\n' + n.body).toLocaleLowerCase().includes(query) : currentFolder === null || n.folderId === currentFolder);
    $('notes').replaceChildren();
    for (const note of ordered(matches)) {
      const card = element('button', 'note-card' + (note.id === currentNote ? ' selected' : ''));
      card.setAttribute('aria-pressed', String(note.id === currentNote));
      const top = element('div', 'card-top'); top.append(element('span', '', '▤'), element('small', '', dateLabel(note.updatedAt)));
      const bottom = element('div', 'card-total'); bottom.append(element('span', '', '합계'));
      const value = element('strong', '', fmt(total(note))); value.append(element('small', '', '원')); bottom.append(value);
      card.append(top, element('h3', '', note.title || '이름 없는 노트'), element('div', 'note-preview', note.body.split('\n').find(l => l.trim()) || '첫 줄을 적어 보세요.'), bottom);
      card.onclick = () => { currentNote = note.id; renderCards(); renderEditor(); };
      $('notes').append(card);
    }
    if (!matches.length) $('notes').append(element('div', 'empty', query ? '일치하는 노트가 없어요.' : '아직 노트가 없어요. 새 노트를 만들어 보세요.'));
    $('search-summary').hidden = !query;
    if (query) {
      let matchingTotal = 0, count = 0;
      for (const n of state.notes) for (const l of SumParser.parseNote(n.body).lines) if (l.raw.toLocaleLowerCase().includes(query)) { count++; if (l.type === 'value') matchingTotal += l.value; }
      $('search-summary').textContent = `노트 ${matches.length}개 · 일치하는 줄 ${count}개 · 매칭 라인 합계 ${fmt(matchingTotal)}원`;
    }
  }
  function renderLines() {
    const n = active(); if (!n) return;
    const parsed = SumParser.parseNote(n.body);
    $('line-numbers').replaceChildren(); $('line-values').replaceChildren();
    parsed.lines.forEach((line, i) => {
      $('line-numbers').append(element('div', '', String(i + 1).padStart(2, '0')));
      const label = line.type === 'subtotal' ? '소계 ' + fmt(line.value) : line.type === 'invalid' ? '수식 확인' : line.value === null ? '' : fmt(line.value);
      const button = element('button', line.type, label);
      button.disabled = line.value === null;
      if (line.value !== null) { button.setAttribute('aria-label', `${i + 1}번째 줄 ${label} 복사`); button.onclick = () => copy(fmt(line.value)); }
      $('line-values').append(button);
    });
    $('note-body').style.height = Math.max(224, parsed.lines.length * 32) + 'px';
    $('note-total').textContent = fmt(parsed.total);
    $('valued-count').textContent = parsed.lines.filter(l => l.type === 'value').length + '개 줄을 더했어요';
  }
  function renderEditor() {
    const n = active(); $('editor').hidden = !n; if (!n) return;
    $('note-title').value = n.title; $('note-body').value = n.body;
    $('note-date').textContent = dateLabel(n.updatedAt) + ' 수정';
    $('note-folder').replaceChildren();
    for (const f of [{ id: '', name: '폴더 없음' }, ...state.folders]) { const option = element('option', '', f.name); option.value = f.id; $('note-folder').append(option); }
    $('note-folder').value = n.folderId || '';
    renderLines();
  }
  function selectFolder(folder) {
    currentFolder = folder; query = ''; $('search').value = '';
    const notes = ordered(state.notes.filter(n => folder === null || n.folderId === folder));
    currentNote = notes[0]?.id || null;
    $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false');
    renderCards(); renderEditor();
  }
  function changeNote() { const n = active(); if (!n) return; n.updatedAt = new Date().toISOString(); persist(); renderCards(); $('note-date').textContent = dateLabel(n.updatedAt) + ' 수정'; }
  function askName(title, initial, action) { namingAction = action; $('form-title').textContent = title; $('name-input').value = initial; $('form-dialog').showModal(); setTimeout(() => { $('name-input').focus(); $('name-input').select(); }, 30); }
  function confirmDelete(title, description, action) { deleteAction = action; $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-dialog').showModal(); $('cancel-delete').focus(); }
  function newNote() { askName('새 노트', '', name => { const n = { id: id(), title: name, body: '', folderId: currentFolder, updatedAt: new Date().toISOString() }; state.notes.push(n); currentNote = n.id; query = ''; $('search').value = ''; persist(); renderCards(); renderEditor(); $('note-body').focus(); }); }
  $('name-form').onsubmit = event => { event.preventDefault(); const name = $('name-input').value.trim(); if (!name) { $('name-input').setCustomValidity('이름을 입력해 주세요.'); $('name-input').reportValidity(); return; } $('form-dialog').close(); namingAction(name); };
  $('name-input').oninput = () => $('name-input').setCustomValidity('');
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  $('cancel-delete').onclick = () => $('confirm-dialog').close();
  $('confirm-delete').onclick = () => { $('confirm-dialog').close(); deleteAction(); };
  $('new-note').onclick = $('mobile-new').onclick = newNote;
  $('new-folder').onclick = () => askName('새 폴더', '', name => { const f = { id: id(), name }; state.folders.push(f); persist(); selectFolder(f.id); });
  $('rename-folder').onclick = () => { const f = state.folders.find(f => f.id === currentFolder); if (f) askName('폴더 이름 변경', f.name, name => { f.name = name; persist(); renderNav(); renderEditor(); }); };
  $('delete-folder').onclick = () => { const f = state.folders.find(f => f.id === currentFolder); if (f) confirmDelete('폴더를 삭제할까요?', `‘${f.name}’ 폴더만 삭제합니다. 안의 노트는 모든 노트에 남아요.`, () => { state.notes.forEach(n => { if (n.folderId === f.id) n.folderId = null; }); state.folders = state.folders.filter(v => v.id !== f.id); persist(); selectFolder(null); }); };
  $('delete-note').onclick = () => { const n = active(); if (n) confirmDelete('노트를 삭제할까요?', `‘${n.title || '이름 없는 노트'}’ 노트를 삭제하면 되돌릴 수 없어요.`, () => { state.notes = state.notes.filter(v => v.id !== n.id); persist(); selectFolder(currentFolder); }); };
  $('rename-note').onclick = () => { const n = active(); if (n) askName('노트 이름 변경', n.title, name => { n.title = name; changeNote(); $('note-title').value = name; }); };
  $('note-title').oninput = () => { const n = active(); if (n) { n.title = $('note-title').value; changeNote(); } };
  $('note-title').onblur = () => { const n = active(); if (n && !n.title.trim()) { n.title = '이름 없는 노트'; $('note-title').value = n.title; changeNote(); } };
  $('note-body').oninput = () => { const n = active(); if (n) { n.body = $('note-body').value; renderLines(); changeNote(); } };
  $('note-folder').onchange = () => { const n = active(); if (n) { n.folderId = $('note-folder').value || null; changeNote(); } };
  $('all-notes').onclick = () => selectFolder(null);
  $('search').oninput = () => { query = $('search').value.trim().toLocaleLowerCase(); renderCards(); };
  $('menu-toggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('menu-toggle').setAttribute('aria-expanded', String(open)); };
  document.addEventListener('click', e => { if (!$('sidebar').contains(e.target) && !$('menu-toggle').contains(e.target)) { $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); } });
  $('settings').onclick = $('examples').onclick = () => $('settings-dialog').showModal();
  async function copy(text) {
    try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const input = element('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw Error(); } toast('복사했어요.'); }
    catch (_) { toast('복사하지 못했어요. 브라우저 권한을 확인해 주세요.'); }
  }
  $('copy-total').onclick = () => { if (active()) copy(fmt(total(active()))); };
  function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = element('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  function safeFilename(name) { return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || '노트'; }
  $('export-csv').onclick = () => { const n = active(); if (!n) return; const quote = s => '"' + String(s).replace(/"/g, '""') + '"'; const rows = [['원문', '값'], ...SumParser.parseNote(n.body).lines.map(l => [l.raw, l.value ?? ''])]; download('\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n'), safeFilename(n.title) + '.csv', 'text/csv;charset=utf-8'); };
  $('backup').onclick = () => download(JSON.stringify(state, null, 2), '숨노트-백업-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
  $('import-button').onclick = () => $('import-file').click();
  $('import-file').onchange = async () => {
    const file = $('import-file').files[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('size');
      const data = JSON.parse(await file.text()); if (!validData(data)) throw Error('format');
      if (storageBroken) { toast('기존 저장소를 읽을 수 없어 가져오기를 중단했어요. 브라우저 저장소를 확인해 주세요.'); return; }
      const folderIds = new Map(data.folders.map(f => [f.id, id()]));
      const folders = data.folders.map(f => ({ id: folderIds.get(f.id), name: f.name }));
      const notes = data.notes.map(n => ({ id: id(), title: n.title, body: n.body, folderId: folderIds.get(n.folderId) || null, updatedAt: n.updatedAt }));
      const merged = { version: 1, folders: [...state.folders, ...folders], notes: [...state.notes, ...notes] };
      // Save the entire import before replacing the current in-memory collection.
      localStorage.setItem(KEY, JSON.stringify(merged)); state = merged;
      selectFolder(null); $('settings-dialog').close(); toast(`노트 ${notes.length}개를 가져왔어요.`);
    } catch (error) { toast(error.name === 'QuotaExceededError' ? '저장 공간이 부족해 가져오지 못했어요.' : '숨노트 JSON 백업 파일인지 확인해 주세요. (최대 10MB)'); }
    finally { $('import-file').value = ''; }
  };
  currentNote = ordered(state.notes)[0]?.id || null;
  renderCards(); renderEditor();
  if (storageBroken) { $('save-status').textContent = '저장 확인 필요'; toast('기존 데이터를 읽지 못했어요. 원본 보호를 위해 자동 저장을 멈췄어요.'); } else persist();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
})();
