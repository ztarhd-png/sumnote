(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'sumnote.data.v1', BACKUP_KEY = 'sumnote.lastBackup', UI_KEY = 'sumnote.ui';
  let appVersion = null; // 설치된 버전은 서비스 워커(sw.js의 VERSION)에게 물어서 받는다.
  const fmt = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(Object.is(n, -0) ? 0 : n);
  const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const now = new Date().toISOString();
  let state, storageBroken = false, currentNote = null, query = '', namingAction, deleteAction, toastTimer;
  let searchAi = null, searchRun = null; // AI 검색 결과(또는 진행 중 표시)와 그 요청
  const SYNC_KEY = 'sumnote.sync';
  let syncCfg = {}, syncTimer = null, syncing = false, syncAgain = false, syncWarned = false;
  try { syncCfg = JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (_) {}
  function validData(data) {
    return data && data.version === 1 && Array.isArray(data.notes) && Array.isArray(data.folders)
      && data.folders.every(f => f && typeof f.id === 'string' && typeof f.name === 'string' && f.name.trim())
      && new Set(data.folders.map(f => f.id)).size === data.folders.length
      && data.notes.every(n => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.updatedAt === 'string' && Number.isFinite(Date.parse(n.updatedAt)) && (n.folderId === null || data.folders.some(f => f.id === n.folderId)))
      && new Set(data.notes.map(n => n.id)).size === data.notes.length;
  }
  const SAMPLE_FOLDER = '일상 기록';
  const SAMPLES = [
    { title: '이번 주 장보기', body: ['이번 주 장보기', '사과 6,000', '우유 3,200', '식빵 4,500', '달걀 7,800', '---', '주방 세제 4,900', '할인 -2,000'].join('\n'), inFolder: true },
    { title: '제주 여행 준비', body: ['제주 여행 준비', '항공권 178,000', '숙소 240,000', '렌터카 65,000', '# 설레는 여행 준비'].join('\n'), inFolder: false },
    { title: '작은 모임 정산', body: ['작은 모임 정산', '저녁 78,000', '카페 24,000', '간식 12,000'].join('\n'), inFolder: true }
  ];
  function starter() {
    const folder = id();
    return { version: 1, folders: [{ id: folder, name: SAMPLE_FOLDER }], notes: SAMPLES.map(s => ({ id: id(), title: s.title, body: s.body, folderId: s.inFolder ? folder : null, updatedAt: now })) };
  }
  // 처음 열었을 때 넣어 둔 샘플을 손대지 않은 상태인지 (가져오기 때 샘플을 대신 지우기 위해)
  function onlySamples() {
    return state.notes.length > 0 && state.folders.every(f => f.name === SAMPLE_FOLDER)
      && state.notes.every(n => SAMPLES.some(s => s.body === n.body));
  }
  // 노트 제목은 본문의 첫 줄이다. 예전처럼 제목을 따로 가진 노트는 제목을 첫 줄로 옮긴다(한 번만, 합계는 그대로).
  function titleFirst(notes) {
    let moved = false;
    for (const n of notes) {
      const title = n.title.trim();
      if (title && title !== titleOf(n.body)) { n.body = title + (n.body ? '\n' + n.body : ''); moved = true; }
      n.title = titleOf(n.body);
    }
    return moved;
  }
  const nameOf = n => n.title || '새 노트';
  function titleOf(body) { return body.split('\n', 1)[0].trim(); }
  try { const saved = localStorage.getItem(KEY); if (saved) { state = JSON.parse(saved); if (!validData(state)) throw Error(); titleFirst(state.notes); } else state = starter(); }
  catch (_) { state = { version: 1, folders: [], notes: [] }; storageBroken = true; }
  function toast(message, action) {
    const box = $('toast'); box.textContent = message;
    if (action) { const b = element('button', 'toast-action', action.label); b.onclick = () => { box.hidden = true; action.run(); }; box.append(b); }
    box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, action ? 9000 : 3500);
  }
  function persist(fromSync) {
    // 저장 상태는 문제가 있을 때만 위쪽 막대에 보인다.
    const warn = text => { $('save-status').textContent = text; $('save-status').hidden = false; };
    if (storageBroken) { warn('저장 확인 필요'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); if (!$('save-status').hidden) $('save-status').hidden = true; if (!fromSync) scheduleSync(); return true; }
    catch (_) { warn('저장 공간 부족'); toast('저장하지 못했어요. JSON 백업으로 노트를 보관해 주세요.'); return false; }
  }
  function active() { return state.notes.find(n => n.id === currentNote); }
  function total(note) { return SumParser.parseNote(note.body).total; }
  function ordered(notes) { return [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); }
  function icon(name) { const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'i'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(ns, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg; }
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function dateLabel(date) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(date)); }
  // 화면 상태(마지막으로 연 노트, 펼쳐 둔 폴더)는 노트 데이터와 따로 저장한다.
  let ui = {}; try { ui = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) {}
  const openFolders = new Set(Array.isArray(ui.open) ? ui.open.slice(0, 1) : []); // '' = 폴더 없는 노트 묶음
  // 폴더는 한 번에 하나만 펼친다. 다른 폴더를 펼치면 앞의 폴더는 저절로 접힌다.
  function openOnly(key) { openFolders.clear(); openFolders.add(key); }
  let justOpened = null;
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ lastNote: currentNote, open: [...openFolders] })); } catch (_) {} }
  const sumOf = notes => notes.reduce((s, n) => s + total(n), 0);
  const folderName = folderId => state.folders.find(f => f.id === folderId)?.name || '폴더 없음';
  function noteRow(note, showFolder) {
    const row = element('button', 'tree-note' + (note.id === currentNote ? ' active' : ''));
    const name = element('span', 'tree-name', nameOf(note));
    if (showFolder) name.append(element('small', '', folderName(note.folderId)));
    const sum = total(note);
    row.append(name, element('span', 'tree-sum' + (sum < 0 ? ' neg' : ''), fmt(sum)));
    row.onclick = () => openNote(note.id, true);
    return row;
  }
  function renderTree() {
    const tree = $('tree'); tree.replaceChildren();
    $('search-summary').hidden = !query && !searchAi;
    if (query || searchAi) { renderSearch(tree); return; }
    const groups = state.folders.map(f => ({ key: f.id, name: f.name, folder: f }));
    if (state.notes.some(n => !n.folderId)) groups.push({ key: '', name: '폴더 없음', folder: null });
    for (const g of groups) {
      const notes = ordered(state.notes.filter(n => (n.folderId || '') === g.key));
      const open = openFolders.has(g.key);
      const head = element('div', 'tree-folder' + (open ? ' open' : '') + (justOpened === g.key ? ' just-opened' : ''));
      const toggle = element('button', 'tree-toggle');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.append(icon('chevron'), icon('folder'), element('span', 'tree-name', g.name), element('span', 'tree-sum', notes.length ? fmt(sumOf(notes)) : ''));
      toggle.onclick = () => { if (open) openFolders.delete(g.key); else { openOnly(g.key); justOpened = g.key; } saveUi(); renderTree(); };
      head.append(toggle);
      // + : 이 폴더에 바로 새 노트
      const add = element('button', 'icon-button tree-edit tree-add');
      add.setAttribute('aria-label', g.name + '에 새 노트'); add.append(icon('plus'));
      add.onclick = () => newNote(g.key);
      head.append(add);
      if (g.folder) {
        const edit = element('button', 'icon-button tree-edit');
        edit.setAttribute('aria-label', g.name + ' 폴더 편집'); edit.append(icon('pencil'));
        edit.onclick = () => editFolder(g.folder);
        head.append(edit);
      }
      tree.append(head);
      if (open) {
        // 방금 펼친 폴더만 미끄러지듯 나타나게 한다(타이핑 중 다시 그릴 때는 움직이지 않게).
        const list = element('div', 'tree-notes' + (justOpened === g.key ? ' glide-in' : ''));
        notes.forEach(n => list.append(noteRow(n)));
        if (!notes.length) list.append(element('p', 'tree-empty', '노트 없음'));
        tree.append(list);
      }
    }
    if (!groups.length) tree.append(element('p', 'tree-empty', '+ 버튼으로 폴더를 만들어 보세요.'));
    justOpened = null;
  }
  // 검색 결과: 노트마다 맞는 줄을 보여 주고, 줄을 누르면 그 노트의 그 줄로 간다.
  const SEARCH_LINES_PER_NOTE = 30;
  function hitRow(note, index, raw, ranges, reason) {
    const row = element('button', 'tree-hit'), text = element('span', 'tree-hit-text');
    let at = 0;
    for (const [a, b] of ranges || []) { if (a > at) text.append(raw.slice(at, a)); text.append(element('mark', '', raw.slice(a, b))); at = b; }
    text.append(raw.slice(at));
    row.append(text);
    if (reason) row.append(element('small', '', reason));
    row.onclick = () => { openNote(note.id, true); revealLine(index); };
    return row;
  }
  function revealLine(index) {
    requestAnimationFrame(() => {
      const row = $('note-ink').children[index]; if (!row) return;
      row.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      row.classList.remove('ink-flash'); void row.offsetWidth; row.classList.add('ink-flash');
    });
  }
  function renderSearch(tree) {
    const summary = $('search-summary');
    if (searchAi?.running) { summary.textContent = 'AI가 모든 노트를 살펴보는 중이에요…'; return; }
    if (searchAi?.hits) {
      // AI가 고른 순서대로, 노트별로 묶는다. 그 사이 줄이 움직였으면 같은 글자의 줄을 다시 찾는다.
      const groups = new Map();
      for (const h of searchAi.hits) {
        const n = state.notes.find(x => x.id === h.noteId); if (!n) continue;
        const lines = n.body.split('\n');
        const index = lines[h.index] === h.raw ? h.index : lines.indexOf(h.raw);
        if (index < 0) continue;
        if (!groups.has(n)) groups.set(n, []);
        if (index > 0) groups.get(n).push({ ...h, index });
      }
      let total = 0, count = 0;
      if (searchAi.summary) tree.append(element('p', 'search-note', searchAi.summary));
      for (const [n, hits] of groups) {
        tree.append(noteRow(n, true));
        const parsed = SumParser.parseNote(n.body).lines;
        for (const h of hits) { count++; if (parsed[h.index]?.type === 'value') total += parsed[h.index].value; tree.append(hitRow(n, h.index, h.raw, null, h.reason)); }
      }
      if (!groups.size) tree.append(element('p', 'tree-empty', '관련된 내용을 찾지 못했어요.'));
      summary.textContent = `AI 검색 · 노트 ${groups.size}개 · 줄 ${count}개 · 합계 ${fmt(total)}원 · 비용 ${searchAi.cost}`;
      return;
    }
    if (searchAi?.error) tree.append(element('p', 'search-note search-error', searchAi.error));
    if (!query) { summary.hidden = true; return; }
    const results = SumSearch.findLines(state, query);
    const notes = ordered(results.map(r => state.notes.find(n => n.id === r.noteId)));
    let total = 0, count = 0;
    for (const n of notes) {
      const { hits } = results.find(r => r.noteId === n.id);
      tree.append(noteRow(n, true));
      hits.slice(0, SEARCH_LINES_PER_NOTE).forEach(h => tree.append(hitRow(n, h.index, h.raw, SumSearch.marks(h.raw, query))));
      if (hits.length > SEARCH_LINES_PER_NOTE) tree.append(element('p', 'tree-more', `외 ${hits.length - SEARCH_LINES_PER_NOTE}줄`));
      count += hits.length;
      for (const h of hits) if (h.value !== null) total += h.value;
    }
    if (!notes.length) tree.append(element('p', 'tree-empty', '일치하는 내용이 없어요. 뜻으로 찾으려면 AI 검색을 눌러 보세요.'));
    summary.textContent = `노트 ${notes.length}개 · 줄 ${count}개 · 합계 ${fmt(total)}원`;
  }
  function renderLines() {
    const n = active(); if (!n) return;
    const parsed = SumParser.parseNote(n.body);
    // 본문 아래 층: 줄마다 같은 글자를 그리고, 합계에 들어간 숫자만 파랑/빨강으로 칠한다.
    const ink = document.createDocumentFragment(), numbers = document.createDocumentFragment();
    parsed.lines.forEach((line, i) => {
      const row = element('div', 'ink-line');
      let at = 0;
      for (const [a, b, sign] of line.spans) {
        if (a > at) row.append(line.raw.slice(at, a));
        row.append(element('span', sign < 0 ? 'neg' : sign > 0 ? 'pos' : '', line.raw.slice(a, b)));
        at = b;
      }
      if (at < line.raw.length) row.append(line.raw.slice(at));
      ink.append(row);
      numbers.append(element('div', '', String(i + 1).padStart(2, '0')));
    });
    $('note-ink').replaceChildren(ink);
    $('line-numbers').replaceChildren(numbers);
    fitLines();
    $('note-total').textContent = fmt(parsed.total); $('copy-total').classList.toggle('neg', parsed.total < 0);
  }
  // 긴 줄은 화면 폭에서 줄바꿈된다. 줄번호는 그 줄이 차지한 높이만큼 내려가고,
  // 입력칸 높이는 그려진 글자 높이에 맞춘다.
  function fitLines() {
    const rows = $('note-ink').children, numbers = $('line-numbers').children;
    for (let i = 0; i < rows.length; i++) if (numbers[i]) numbers[i].style.height = rows[i].offsetHeight + 'px';
    const height = $('note-ink').offsetHeight + 8 + 'px';
    if ($('note-body').style.height !== height) $('note-body').style.height = height;
    syncInk();
  }
  function renderEditor() {
    const n = active();
    $('editor').hidden = $('total-bar').hidden = $('edit-note').hidden = $('ai-open').hidden = !n;
    $('empty-state').hidden = !!n;
    $('note-heading').textContent = n ? nameOf(n) : '숨노트';
    $('note-heading').disabled = !n;
    if (!n) return;
    $('note-body').value = n.body;
    renderLines();
  }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); }
  function openNote(noteId, closeMenu) {
    flushSave();
    const prev = active();
    if (prev && prev.id !== noteId && !prev.body.trim()) { state.notes = state.notes.filter(n => n !== prev); persist(); }
    currentNote = noteId;
    const n = active(); if (n) openOnly(n.folderId || '');
    saveUi();
    if (closeMenu) closeSidebar();
    renderTree(); renderEditor();
    window.scrollTo(0, 0);
  }
  const latest = () => ordered(state.notes)[0]?.id || null;
  function changeNote() { const n = active(); if (!n) return; n.updatedAt = new Date().toISOString(); persist(); renderTree(); }
  function fillFolders(select, selected) {
    select.replaceChildren();
    for (const f of [{ id: '', name: '폴더 없음' }, ...state.folders]) { const option = element('option', '', f.name); option.value = f.id; select.append(option); }
    select.value = selected || '';
  }
  // 이름 입력 시트. withFolder를 주면 넣을 폴더도 함께 고른다.
  function askName(title, initial, action, withFolder) {
    namingAction = action; $('form-title').textContent = title; $('name-input').value = initial;
    $('name-folder').hidden = withFolder === undefined;
    if (withFolder !== undefined) fillFolders($('name-folder'), withFolder);
    $('form-dialog').showModal(); setTimeout(() => { $('name-input').focus(); $('name-input').select(); }, 30);
  }
  function confirmDelete(title, description, action, label) { deleteAction = action; $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-delete').textContent = label || '삭제'; $('confirm-dialog').showModal(); $('cancel-delete').focus(); }
  // 새 노트는 묻지 않고 바로 열린다. 첫 줄에 쓴 글이 제목이 된다.
  // inFolder를 주면(폴더 줄의 +) 그 폴더에, 아니면 지금 보던 노트의 폴더에 만든다.
  function newNote(inFolder) {
    const folderId = typeof inFolder === 'string' ? inFolder || null : active()?.folderId || null;
    const n = { id: id(), title: '', body: '', folderId, updatedAt: new Date().toISOString() };
    state.notes.push(n); query = ''; $('search').value = ''; stopSearchAi(); persist(); openNote(n.id, true); $('note-body').focus();
  }
  $('name-form').onsubmit = event => {
    event.preventDefault(); const name = $('name-input').value.trim();
    if (!name) { $('name-input').setCustomValidity('이름을 입력해 주세요.'); $('name-input').reportValidity(); return; }
    $('form-dialog').close(); namingAction(name, $('name-folder').value || null);
  };
  $('name-input').oninput = () => $('name-input').setCustomValidity('');
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  $('cancel-delete').onclick = () => $('confirm-dialog').close();
  $('confirm-delete').onclick = () => { $('confirm-dialog').close(); deleteAction(); };
  $('new-note').onclick = $('empty-new').onclick = () => newNote();
  $('new-folder').onclick = () => askName('새 폴더', '', name => { const f = { id: id(), name }; state.folders.push(f); openOnly(f.id); persist(); saveUi(); renderTree(); });
  // 노트 편집: 폴더 이동 · CSV · 삭제
  $('edit-note').onclick = $('note-heading').onclick = () => {
    const n = active(); if (!n) return;
    fillFolders($('edit-folder'), n.folderId);
    $('edit-date').textContent = dateLabel(n.updatedAt) + ' 수정';
    $('edit-dialog').showModal();
  };
  $('edit-form').onsubmit = event => {
    event.preventDefault(); const n = active(); if (!n) return;
    const folderId = $('edit-folder').value || null;
    if (folderId !== n.folderId) { n.folderId = folderId; openOnly(folderId || ''); saveUi(); changeNote(); renderEditor(); }
    $('edit-dialog').close();
  };
  $('delete-note').onclick = () => {
    const n = active(); if (!n) return; $('edit-dialog').close();
    confirmDelete('노트를 삭제할까요?', `‘${nameOf(n)}’ 노트를 삭제하면 되돌릴 수 없어요.`, () => { state.notes = state.notes.filter(v => v.id !== n.id); persist(); openNote(latest()); });
  };
  // 폴더 편집: 이름 · 삭제 (노트는 '폴더 없음'으로 남는다)
  let editingFolder = null;
  function editFolder(folder) {
    editingFolder = folder; $('folder-name').value = folder.name;
    const notes = state.notes.filter(n => n.folderId === folder.id);
    $('folder-info').textContent = `노트 ${notes.length}개 · 합계 ${fmt(sumOf(notes))}원`;
    $('folder-dialog').showModal();
  }
  $('folder-form').onsubmit = event => {
    event.preventDefault(); const name = $('folder-name').value.trim(); if (!name || !editingFolder) return;
    editingFolder.name = name; persist(); renderTree(); $('folder-dialog').close();
  };
  $('delete-folder').onclick = () => {
    const f = editingFolder; if (!f) return; $('folder-dialog').close();
    confirmDelete('폴더를 삭제할까요?', `‘${f.name}’ 폴더만 삭제합니다. 안의 노트는 ‘폴더 없음’에 남아요.`, () => {
      state.notes.forEach(n => { if (n.folderId === f.id) n.folderId = null; });
      state.folders = state.folders.filter(v => v.id !== f.id); openFolders.delete(f.id); persist(); saveUi(); renderTree();
    });
  };
  function syncInk() { const b = $('note-body'); $('note-ink').style.transform = `translate(${-b.scrollLeft}px, ${-b.scrollTop}px)`; }
  $('note-body').addEventListener('scroll', syncInk);
  $('note-body').addEventListener('select', syncInk);
  // 화면 폭이 바뀌면(회전·창 크기) 줄바꿈 위치가 달라지므로 줄번호와 높이를 다시 맞춘다.
  let inkWidth = 0;
  const refit = () => { const w = $('note-ink').clientWidth; if (w && w !== inkWidth) { inkWidth = w; if (active() && !editing) fitLines(); } };
  if (window.ResizeObserver) new ResizeObserver(refit).observe($('note-ink'));
  addEventListener('resize', refit); addEventListener('orientationchange', () => setTimeout(refit, 200));
  document.fonts?.ready.then(() => active() && fitLines());
  // 타자 중에는 화면(형광펜·합계)만 바로 고치고, 저장과 왼쪽 메뉴 갱신은 손을 멈춘 뒤에 한 번 한다.
  // 앱을 내리거나 다른 노트로 옮기면 기다리지 않고 바로 저장한다.
  // 쓰는 동안은 보통 메모장: 형광펜·줄번호·합계·제목·왼쪽 메뉴를 전혀 다시 그리지 않는다.
  // (아이폰 한글 키보드는 조합 중인 글자를 직접 그리므로, 그 사이 화면을 고치면 글자가 꼬인다.)
  // 위쪽 '저장'을 누르거나 키보드를 내리면 그때 한 번에 색과 합계를 맞춘다.
  // 글 자체는 쓰는 동안에도 손을 멈추면 저장소에 저장된다(화면은 그대로).
  let saveTimer = null, composing = false, editing = false;
  function flushSave() {
    if (!saveTimer) return; clearTimeout(saveTimer); saveTimer = null;
    persist(); if (!editing) renderTree();
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 400); }
  function takeInput() {
    const n = active(); if (!n) return null;
    n.body = $('note-body').value; n.title = titleOf(n.body); n.updatedAt = new Date().toISOString();
    return n;
  }
  // 글이 길어져도 가려지지 않게 입력칸 높이만 늘린다(글자는 건드리지 않음).
  function growOnly() { const b = $('note-body'); if (b.scrollHeight > b.clientHeight) b.style.height = b.scrollHeight + 'px'; }
  function applyNote() {
    const n = active(); if (!n) return;
    $('note-heading').textContent = nameOf(n);
    renderLines();
    clearTimeout(saveTimer); saveTimer = null; persist(); renderTree();
  }
  function startEditing() { if (editing) return; editing = true; document.body.classList.add('editing'); }
  $('note-body').addEventListener('focus', startEditing);
  // 저장 버튼 또는 키보드 내림: 메모장 모드를 끝내고 색·줄번호·합계·제목을 한 번에 맞춘다.
  function finishEditing() {
    editing = false; composing = false; document.body.classList.remove('editing');
    if (takeInput()) applyNote();
  }
  $('note-body').addEventListener('blur', finishEditing);
  $('save-note').onclick = () => { finishEditing(); $('note-body').blur(); };
  $('note-body').addEventListener('compositionstart', () => { composing = true; });
  $('note-body').addEventListener('compositionend', () => { composing = false; growOnly(); });
  $('note-body').oninput = event => {
    startEditing(); // 포커스 이벤트를 놓친 경우에도 쓰기 시작하면 메모장 모드로
    if (!takeInput()) return;
    if (!composing && !event.isComposing) growOnly();
    scheduleSave();
  };
  // 아이폰 키보드가 올라오면 화면(보이는 영역)이 아래로 밀려 위쪽 막대가 화면 밖으로 나간다.
  // 보이는 영역이 밀린 만큼 위쪽 막대(제목·저장)와 노트합계를 따라 내려 항상 보이게 한다.
  // 글자는 건드리지 않고 두 막대의 위치(transform)만 바꾼다.
  if (window.visualViewport) {
    let shift = 0;
    const follow = () => {
      const next = Math.max(0, Math.round(visualViewport.offsetTop));
      if (next === shift) return; shift = next;
      const t = shift ? `translate3d(0, ${shift}px, 0)` : '';
      document.querySelector('.topbar').style.transform = t; $('total-bar').style.transform = t;
    };
    visualViewport.addEventListener('resize', follow); visualViewport.addEventListener('scroll', follow);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  addEventListener('pagehide', flushSave);
  $('search').oninput = () => { stopSearchAi(); query = $('search').value.trim(); renderTree(); };
  $('search-plain').onclick = () => {
    stopSearchAi(); query = $('search').value.trim();
    if (!query) { toast('찾을 말을 적어 주세요.'); $('search').focus(); return; }
    $('search').blur(); renderTree();
  };
  $('menu-toggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('menu-toggle').setAttribute('aria-expanded', String(open)); };
  // 바깥을 누르면 메뉴를 닫는다. 폴더를 누르면 나무를 다시 그려 누른 요소가 문서에서 빠지므로,
  // contains() 대신 이벤트가 지나온 경로(composedPath)로 판단한다.
  document.addEventListener('click', e => {
    const path = e.composedPath();
    if (path.some(el => el.tagName === 'DIALOG') || path.includes($('sidebar')) || path.includes($('menu-toggle'))) return;
    closeSidebar();
  });
  function lastBackup() { try { return localStorage.getItem(BACKUP_KEY); } catch (_) { return null; } }
  function showAppInfo() {
    const at = lastBackup();
    $('app-info').textContent = `버전 ${appVersion || '확인 중'} · 마지막 백업 ${at ? new Date(at).toLocaleDateString('ko-KR') : '없음'}`;
  }
  $('settings').onclick = () => { showAppInfo(); $('settings-dialog').showModal(); };
  async function copy(text) {
    try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const input = element('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw Error(); } toast('복사했어요.'); }
    catch (_) { toast('복사하지 못했어요. 브라우저 권한을 확인해 주세요.'); }
  }
  $('copy-total').onclick = () => { if (active()) copy(fmt(total(active()))); };
  function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = element('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  function safeFilename(name) { return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || '노트'; }
  $('export-csv').onclick = () => { const n = active(); if (!n) return; const quote = s => '"' + String(s).replace(/"/g, '""') + '"'; const rows = [['원문', '값'], ...SumParser.parseNote(n.body).lines.map(l => [l.raw, l.value ?? ''])]; download('\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n'), safeFilename(n.title) + '.csv', 'text/csv;charset=utf-8'); };
  // 아이폰에서는 공유 시트를 열어 '파일에 저장'으로 바로 보관할 수 있게 한다. 공유를 못 하면 내려받기로.
  $('backup').onclick = async () => {
    const name = '숨노트-백업-' + new Date().toISOString().slice(0, 10) + '.json', json = JSON.stringify(state, null, 2);
    const done = () => { try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (_) {} showAppInfo(); };
    const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); done(); toast('백업 파일을 보냈어요.'); }
      catch (error) { if (error.name !== 'AbortError') { download(json, name, 'application/json'); done(); } }
      return;
    }
    download(json, name, 'application/json'); done();
  };
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
      titleFirst(notes);
      const replaceSamples = onlySamples();
      const base = replaceSamples ? { folders: [], notes: [] } : state;
      const merged = { version: 1, folders: [...base.folders, ...folders], notes: [...base.notes, ...notes] };
      // Save the entire import before replacing the current in-memory collection.
      localStorage.setItem(KEY, JSON.stringify(merged)); state = merged;
      openNote(latest(), true); $('settings-dialog').close(); toast(`노트 ${notes.length}개를 가져왔어요.` + (replaceSamples ? ' 샘플 노트는 정리했어요.' : ''));
    } catch (error) { toast(error.name === 'QuotaExceededError' ? '저장 공간이 부족해 가져오지 못했어요.' : '숨노트 JSON 백업 파일인지 확인해 주세요. (최대 10MB)'); }
    finally { $('import-file').value = ''; }
  };
  // AI 정리: AI는 줄 번호로 된 계획만 돌려주고, 줄을 옮기는 일은 앱이 원래 글자 그대로 한다(ai.js).
  // 키와 모델은 노트 데이터와 따로 저장해 JSON 백업에 들어가지 않게 한다.
  const AI_KEY = 'sumnote.ai';
  let aiConfig = {}; try { aiConfig = JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch (_) {}
  // 기본 모델이 Haiku로 바뀌었다. 예전 기본값으로 저장된 Opus만 한 번 옮기고, 그 뒤에 고른 모델은 건드리지 않는다.
  if (aiConfig.key && !aiConfig.picked && aiConfig.model === 'claude-opus-5-5') { aiConfig = { key: aiConfig.key, model: AiPlan.DEFAULT_MODEL, picked: true }; saveAiConfig(); }
  let aiRun = null, aiPending = null;
  const AI_HISTORY_KEY = 'sumnote.ai.history', AI_HISTORY_MAX_SIZE = 2000000;
  let aiHistory = []; try { const saved = JSON.parse(localStorage.getItem(AI_HISTORY_KEY)); if (Array.isArray(saved)) aiHistory = saved; } catch (_) {}
  // 저장 공간이 모자라면 노트 저장이 우선이므로 오래된 기록부터 뺀다.
  function saveAiHistory() {
    aiHistory.length = Math.min(aiHistory.length, AiPlan.HISTORY_LIMIT);
    for (;;) {
      try {
        const text = JSON.stringify(aiHistory);
        if (text.length > AI_HISTORY_MAX_SIZE) throw Error('size');
        localStorage.setItem(AI_HISTORY_KEY, text);
        return;
      } catch (_) { if (aiHistory.length <= 1) return; aiHistory.pop(); }
    }
  }
  const AI_PANELS = ['ai-key-form', 'ai-ask', 'ai-wait', 'ai-result', 'ai-history'];
  function aiShow(panel) { AI_PANELS.forEach(p => { $(p).hidden = p !== panel; }); }
  function aiError(message) { $('ai-error').textContent = message || ''; $('ai-error').hidden = !message; }
  function aiAsk() {
    const n = active();
    $('ai-target').textContent = n ? `‘${nameOf(n)}’ ${n.body.split('\n').length}줄` : '';
    $('ai-history-open').hidden = !aiHistory.length;
    $('ai-history-open').textContent = `되돌리기 기록 ${aiHistory.length}`;
    aiShow('ai-ask');
  }
  function aiKeyPanel() {
    $('ai-key').value = ''; $('ai-key').placeholder = aiConfig.key ? '저장된 키를 그대로 씁니다' : 'sk-ant-';
    $('ai-model').value = aiConfig.model || AiPlan.DEFAULT_MODEL;
    $('ai-forget').hidden = !aiConfig.key;
    aiShow('ai-key-form');
  }
  // AI 검색: 버튼을 눌렀을 때만 보낸다. 결과는 사이드바에 단순 검색과 같은 모양으로 보여 준다.
  let aiKeyForSearch = false;
  function stopSearchAi() {
    if (searchRun) { searchRun.abort(); searchRun = null; }
    $('search-ai').textContent = 'AI 검색';
    searchAi = null;
  }
  async function runSearchAi(text) {
    flushSave(); stopSearchAi();
    const controller = new AbortController(); searchRun = controller;
    query = text; searchAi = { running: true };
    $('search-ai').textContent = '멈추기'; $('search').blur(); renderTree();
    let spent = 0, timer, timedOut = false;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000); };
    try {
      kick();
      const { url, init } = AiPlan.buildSearchRequest({ apiKey: aiConfig.key, model: aiConfig.model, state, query: text });
      const response = await fetch(url, { ...init, signal: controller.signal });
      const data = response.status === 200 ? await AiPlan.readStream(response, kick) : await response.json().catch(() => null);
      if (data?.usage) spent += AiPlan.costWon(aiConfig.model, data.usage);
      const result = AiPlan.checkSearch(AiPlan.readResponse(response.status, data), state);
      if (searchRun === controller) searchAi = { ...result, cost: AiPlan.costLabel(spent) };
    } catch (error) {
      if (searchRun !== controller) return;
      const reason = timedOut ? '시간이 너무 오래 걸려 멈췄어요. 다시 해 주세요.' : error instanceof AiPlan.AiError ? error.message : '인터넷에 연결되어 있는지 확인해 주세요.';
      searchAi = { error: spent ? `AI 검색 실패: ${reason} (이번 비용 ${AiPlan.costLabel(spent)})` : `AI 검색 실패: ${reason}` };
    } finally {
      clearTimeout(timer);
      if (searchRun === controller) { searchRun = null; $('search-ai').textContent = 'AI 검색'; renderTree(); }
    }
  }
  $('search-ai').onclick = () => {
    if (searchRun) { stopSearchAi(); renderTree(); return; }
    const text = $('search').value.trim();
    if (!text) { toast('찾을 내용을 적어 주세요.'); $('search').focus(); return; }
    if (!aiConfig.key) { aiKeyForSearch = true; aiError(''); aiKeyPanel(); $('ai-dialog').showModal(); return; }
    runSearchAi(text);
  };
  function saveAiConfig() { try { localStorage.setItem(AI_KEY, JSON.stringify(aiConfig)); return true; } catch (_) { return false; } }
  $('ai-model').replaceChildren(...AiPlan.MODELS.map(m => { const o = element('option', '', m.label); o.value = m.id; return o; }));
  $('ai-open').onclick = () => {
    if (!active()) return;
    if (editing) finishEditing();
    flushSave(); aiError('');
    if (aiConfig.key) aiAsk(); else aiKeyPanel();
    $('ai-dialog').showModal();
  };
  $('ai-settings').onclick = () => { aiError(''); aiKeyPanel(); };
  $('ai-key-form').onsubmit = event => {
    event.preventDefault();
    const key = $('ai-key').value.trim() || aiConfig.key;
    if (!key) { aiError('API 키를 넣어 주세요.'); return; }
    aiConfig = { key, model: $('ai-model').value, picked: true };
    if (!saveAiConfig()) { aiError('키를 저장하지 못했어요. 브라우저 저장소를 확인해 주세요.'); return; }
    if (aiKeyForSearch) { aiKeyForSearch = false; $('ai-dialog').close(); $('search-ai').click(); return; }
    aiError(''); aiAsk();
  };
  $('ai-forget').onclick = () => {
    aiConfig = {}; try { localStorage.removeItem(AI_KEY); } catch (_) {}
    aiError(''); aiKeyPanel();
  };
  function renderAiPreview(p) {
    const box = $('ai-preview'); box.replaceChildren();
    const line = (cls, text) => box.append(element('div', 'ai-line ' + cls, text));
    line('ai-title', p.title || '새 노트');
    p.rows.forEach(r => line(r.heading ? 'ai-heading' : '', r.text));
    for (const m of p.moved) {
      line('ai-section', `‘${m.title}’${m.isNew ? ' 새 노트' : ''}로 옮김 ${m.lines.length}줄`);
      m.lines.forEach(t => line('', t));
    }
    if (p.removed.length) {
      line('ai-section ai-danger', `지워지는 줄 ${p.removed.length}개`);
      p.removed.forEach(t => line('ai-removed', t));
    }
    if (p.noteMoves.length) {
      line('ai-section', '폴더 이동');
      p.noteMoves.forEach(m => line('', `${m.title} → ${m.folder}`));
    }
    box.scrollTop = 0;
  }
  function renderAiAudit(audit, p) {
    const totals = p.before === p.after ? `합계 ${fmt(p.after)}원 그대로` : `합계 ${fmt(p.before)}원 → ${fmt(p.after)}원`;
    $('ai-total').textContent = `검수 통과: 금액 ${fmt(audit.amounts)}개 일치, ${totals}`;
    const words = list => list.slice(0, 12).map(([ch, n]) => `${ch} ${fmt(n)}`).join(', ') + (list.length > 12 ? ' 등' : '');
    const parts = [];
    if (audit.lost.length) parts.push('사라진 글자: ' + words(audit.lost));
    if (audit.gained.length) parts.push('새 글자: ' + words(audit.gained));
    $('ai-chars').textContent = parts.join(' / ') || (audit.rewritten ? '글자 변화 없음' : '');
    $('ai-chars').hidden = !$('ai-chars').textContent;
  }
  async function runAi(request) {
    const n = active(); if (!n || aiRun) return;
    if (n.body.split('\n').length > AiPlan.MAX_LINES) { aiError(`한 번에 ${fmt(AiPlan.MAX_LINES)}줄까지 정리할 수 있어요.`); return; }
    aiError(''); aiShow('ai-wait');
    const run = aiRun = { controller: new AbortController(), timedOut: false };
    // 데이터가 오가는 동안에는 기다리고, 2분 동안 아무것도 오지 않으면 멈춘다.
    let timer;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => { run.timedOut = true; run.controller.abort(); }, 120000); };
    const status = text => { $('ai-wait-text').textContent = text; };
    let spent = 0; // 재시도까지 합친 이번 정리의 비용(원)
    try {
      const base = JSON.stringify(state);
      let plan, result, audit, problem = '';
      // 검수를 통과하지 못하면 무엇이 틀렸는지 알려 주고 한 번 더 시킨다.
      for (let attempt = 0; attempt < 2; attempt++) {
        kick();
        const lead = attempt ? '금액이 맞지 않아 다시 정리하는 중이에요' : '정리하는 중이에요';
        status(lead);
        const { url, init } = AiPlan.buildRequest({ apiKey: aiConfig.key, model: aiConfig.model, state, noteId: n.id, request, problem });
        const response = await fetch(url, { ...init, signal: run.controller.signal });
        const data = response.status === 200
          ? await AiPlan.readStream(response, length => { kick(); if (length) status(`${lead} (${fmt(length)}자)`); })
          : await response.json().catch(() => null);
        if (data?.usage) spent += AiPlan.costWon(aiConfig.model, data.usage);
        plan = AiPlan.readResponse(response.status, data);
        if (plan?.cannot) throw new AiPlan.AiError(plan.cannot);
        const broken = AiPlan.checkPlan(plan, state, n.id);
        if (broken) { problem = '모든 줄 번호를 order, remove, line_moves 중 한 곳에 정확히 한 번씩 넣어야 한다.'; audit = null; if (attempt) throw new AiPlan.AiError(broken); continue; }
        result = AiPlan.applyPlan(state, n.id, plan, id, new Date().toISOString());
        audit = AiPlan.auditPlan(state, result.state, n.id, plan);
        if (audit.ok) break;
        problem = audit.problem;
      }
      if (!audit?.ok) throw new AiPlan.AiError(`금액 검수를 두 번 통과하지 못해 적용하지 않았어요. ${audit?.problem || ''}`.trim());
      if (!result.preview.changed) throw new AiPlan.AiError('바꿀 것이 없어요. 이미 요청대로 되어 있어요.');
      aiPending = { base, state: result.state, summary: plan.summary || request, title: nameOf(n) };
      $('ai-summary').textContent = plan.summary || '이렇게 정리할게요.';
      renderAiPreview(result.preview);
      renderAiAudit(audit, result.preview);
      $('ai-cost').textContent = `이번 비용 ${AiPlan.costLabel(spent)}`;
      aiShow('ai-result');
    } catch (error) {
      if (run.controller.signal.aborted && !run.timedOut) return;
      aiAsk();
      const reason = run.timedOut ? '시간이 너무 오래 걸려 멈췄어요. 다시 해 주세요.' : error instanceof AiPlan.AiError ? error.message : '인터넷에 연결되어 있는지 확인해 주세요.';
      aiError(spent ? `${reason} (이번 비용 ${AiPlan.costLabel(spent)})` : reason);
    } finally { clearTimeout(timer); if (aiRun === run) aiRun = null; }
  }
  $('ai-ask').onsubmit = event => {
    event.preventDefault();
    const request = $('ai-request').value.trim();
    if (!request) { aiError('어떻게 정리할지 적어 주세요.'); return; }
    runAi(request);
  };
  // 긴 요청도 끝까지 보이게 입력칸을 글에 맞춰 늘린다.
  function fitAiRequest() { const t = $('ai-request'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; }
  $('ai-request').addEventListener('input', fitAiRequest);
  document.querySelectorAll('[data-ask]').forEach(b => { b.onclick = () => { $('ai-request').value = b.dataset.ask; runAi(b.dataset.ask); }; });
  $('ai-cancel').onclick = () => { aiRun?.controller.abort(); aiAsk(); };
  $('ai-again').onclick = () => { aiPending = null; aiAsk(); $('ai-request').focus(); };
  $('ai-dialog').addEventListener('close', () => { aiKeyForSearch = false; aiRun?.controller.abort(); aiPending = null; aiError(''); $('ai-request').value = ''; $('ai-request').style.height = ''; });
  function aiRollback(index) {
    const previous = state, next = AiPlan.rollbackState(state, aiHistory.slice(0, index + 1));
    if (!validData(next)) { toast('되돌리지 못했어요. 기록을 읽을 수 없어요.'); return; }
    state = next;
    if (!persist()) { state = previous; return; }
    aiHistory.splice(0, index + 1); saveAiHistory();
    if (!active()) currentNote = latest();
    const n = active(); if (n) openOnly(n.folderId || '');
    saveUi(); renderTree(); renderEditor();
    if ($('ai-dialog').open) $('ai-dialog').close();
    toast('되돌렸어요.');
  }
  // 직접 고친 내용이 함께 사라지거나 여러 단계를 건너뛸 때는 먼저 묻는다. confirmAlways는 기록 화면에서 고를 때다.
  function askRollback(index, confirmAlways) {
    const entries = aiHistory.slice(0, index + 1);
    const edited = AiPlan.editedSince(state, entries);
    if (!edited && !confirmAlways) { aiRollback(index); return; }
    const parts = [`‘${entries[index].title}’ 노트가 이 정리를 하기 전으로 돌아가요.`];
    if (index) parts.push(`더 최근의 AI 정리 ${index}개도 함께 취소돼요.`);
    if (edited) parts.push('AI 정리 뒤에 직접 고친 내용도 그 노트에서는 사라져요.');
    confirmDelete('이때로 되돌릴까요?', parts.join(' '), () => aiRollback(index), '되돌리기');
  }
  const aiTime = iso => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  function aiHistoryPanel() {
    $('ai-history-list').replaceChildren(...aiHistory.map((entry, index) => {
      const row = element('li', 'ai-history-row');
      const text = element('div', 'ai-history-text');
      text.append(element('span', 'ai-history-summary', entry.summary), element('small', '', `${aiTime(entry.at)} ${entry.title}`));
      const button = element('button', 'chip', '되돌리기');
      button.type = 'button';
      button.onclick = () => askRollback(index, true);
      row.append(text, button);
      return row;
    }));
    aiError(''); aiShow('ai-history');
  }
  $('ai-history-open').onclick = aiHistoryPanel;
  $('ai-history-back').onclick = aiAsk;
  $('ai-apply').onclick = () => {
    if (!aiPending) return;
    const before = JSON.stringify(state);
    if (before !== aiPending.base || !validData(aiPending.state)) { aiError('노트가 바뀌어서 적용하지 않았어요. 다시 해 주세요.'); aiPending = null; aiAsk(); return; }
    const previous = state;
    state = aiPending.state;
    if (!persist()) { state = previous; aiError('저장하지 못해 적용하지 않았어요.'); return; }
    aiHistory.unshift(AiPlan.historyEntry(previous, state, { id: id(), at: new Date().toISOString(), summary: aiPending.summary, title: aiPending.title }));
    saveAiHistory();
    const n = active(); if (n) openOnly(n.folderId || '');
    saveUi(); renderTree(); renderEditor();
    $('ai-dialog').close();
    toast('정리했어요.', { label: '되돌리기', run: () => askRollback(0, false) });
  };
  // GitHub 동기화(sync.js): 본인의 비공개 저장소에 노트 전체를 둔다. 토큰은 노트 데이터와 따로 저장해 백업에 들어가지 않는다.
  // 고치면 몇 초 뒤에 올리고, 앱을 열거나 다시 볼 때 받는다. 쓰는 중에는 건드리지 않는다.
  function saveSyncCfg() { try { if (syncCfg.token) localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); else localStorage.removeItem(SYNC_KEY); } catch (_) {} }
  function scheduleSync(delay) { if (!syncCfg.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, delay ?? 4000); }
  const emptyish = () => !state.notes.length || onlySamples();
  function applySynced(next) {
    const previous = state; state = next;
    if (!persist(true)) { state = previous; return false; }
    if (!active()) currentNote = latest();
    const n = active(); if (n) openOnly(n.folderId || '');
    saveUi(); renderTree(); renderEditor();
    return true;
  }
  async function syncNow(manual) {
    if (!syncCfg.token || storageBroken) return;
    if (syncing) { syncAgain = true; return; }
    clearTimeout(syncTimer); syncTimer = null;
    if (editing) return; // 쓰기를 마치면(저장) 다시 예약된다.
    syncing = true; syncShow();
    try {
      for (let attempt = 0; ; attempt++) {
        flushSave();
        const localText = JSON.stringify(state);
        const remote = await SumSync.readFile(syncCfg, fetch);
        // 받는 사이에 쓰기 시작했으면 이번에는 손대지 않는다.
        if (editing || JSON.stringify(state) !== localText) { syncAgain = true; return; }
        let remoteState = null;
        if (remote) {
          try { remoteState = JSON.parse(remote.text); } catch (_) {}
          if (!validData(remoteState)) throw new SumSync.SyncError(`GitHub의 ${SumSync.FILE}이 숨노트 데이터가 아니에요. 저장소의 파일을 확인해 주세요.`, 'bad');
          titleFirst(remoteState.notes);
        }
        let next = state, conflicts = 0;
        if (remote && remote.sha !== syncCfg.sha) {
          // 처음 연결한 기기에 샘플뿐이면 GitHub의 노트로 바꾼다. 아니면 합친다(글은 사라지지 않는다).
          if (!syncCfg.base && emptyish()) next = remoteState;
          else ({ state: next, conflicts } = SumSync.merge(syncCfg.base, state, remoteState, id));
        }
        const nextText = JSON.stringify(next);
        const pulled = nextText !== localText;
        if (pulled && !applySynced(next)) throw new SumSync.SyncError('받은 노트를 저장하지 못했어요. 저장 공간을 확인해 주세요.', 'fail');
        let sha = remote ? remote.sha : null;
        // 샘플만 있는 새 기기는 올리지 않는다(다른 기기의 노트에 샘플이 섞이지 않게).
        const push = remote ? nextText !== JSON.stringify(remoteState) : !emptyish();
        if (push) {
          try { sha = await SumSync.writeFile(syncCfg, JSON.stringify(next, null, 1), sha, fetch); }
          catch (error) { if (error.kind === 'conflict' && attempt < 3) continue; throw error; }
        }
        if (push || remote) { syncCfg.sha = sha; syncCfg.base = SumSync.marksOf(next); }
        syncCfg.at = new Date().toISOString(); syncCfg.error = ''; saveSyncCfg();
        if (conflicts) toast(`두 기기에서 같은 노트를 다르게 고쳐, 이 기기의 것 ${conflicts}개를 ‘(충돌 사본)’으로 남겼어요.`);
        else if (pulled) toast('다른 기기에서 고친 내용을 받았어요.');
        return;
      }
    } catch (error) {
      const message = error instanceof SumSync.SyncError ? error.message : '동기화하지 못했어요. 잠시 뒤에 다시 해 주세요.';
      if (error.kind === 'offline') { if (manual) syncError(message); return; }
      syncCfg.error = message; saveSyncCfg();
      if (!manual && !syncWarned) { syncWarned = true; toast('GitHub 동기화를 확인해 주세요. ' + message); }
    } finally {
      syncing = false; syncShow();
      if (syncAgain) { syncAgain = false; scheduleSync(1000); }
    }
  }
  function syncError(message) { $('sync-error').textContent = message || ''; $('sync-error').hidden = !message; }
  function syncShow() {
    const on = !!syncCfg.token;
    $('sync-brief').textContent = on ? (syncCfg.error ? '확인 필요' : '켜짐') : '꺼짐';
    $('sync-form').hidden = on; $('sync-on').hidden = !on;
    if (!on) return;
    $('sync-where').textContent = `${syncCfg.owner}/${syncCfg.repo} 저장소에 맞추고 있어요.`;
    $('sync-when').textContent = syncing ? '맞추는 중…' : syncCfg.at ? `마지막으로 맞춘 때: ${aiTime(syncCfg.at)}` : '아직 맞추지 않았어요.';
    $('sync-now').disabled = syncing;
    if (syncCfg.error) syncError(syncCfg.error);
  }
  // 'sumnote-data', '아이디/sumnote-data', 저장소 주소 모두 받는다.
  function repoInput(text) {
    const parts = text.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').split('/').filter(Boolean);
    return parts.length >= 2 ? { owner: parts[0], repo: parts[1] } : { owner: '', repo: parts[0] || '' };
  }
  $('sync-open').onclick = () => { syncError(''); syncShow(); $('sync-dialog').showModal(); };
  $('sync-form').onsubmit = async event => {
    event.preventDefault();
    const token = $('sync-token').value.trim(), where = repoInput($('sync-repo').value);
    if (!where.repo) { syncError('저장소 이름을 적어 주세요.'); return; }
    if (!token) { syncError('토큰을 붙여 넣어 주세요.'); return; }
    const button = $('sync-connect'); button.disabled = true; button.textContent = '확인 중…'; syncError('');
    try {
      const owner = where.owner || await SumSync.whoAmI(token, fetch);
      const found = await SumSync.checkRepo({ owner, repo: where.repo, token }, fetch);
      syncCfg = { owner: found.owner, repo: found.repo, token };
      saveSyncCfg(); $('sync-token').value = ''; syncWarned = false;
      await syncNow(true);
      syncShow();
      if (!syncCfg.error && syncCfg.at) toast('GitHub과 연결했어요.');
    } catch (error) { syncError(error instanceof SumSync.SyncError ? error.message : '연결하지 못했어요. 잠시 뒤에 다시 해 주세요.'); }
    finally { button.disabled = false; button.textContent = '연결'; }
  };
  $('sync-now').onclick = async () => { syncError(''); syncCfg.error = ''; await syncNow(true); syncShow(); };
  $('sync-off').onclick = () => confirmDelete('연결을 끊을까요?', '이 기기에서 토큰만 지워요. 이 기기의 노트와 GitHub의 파일은 그대로 남아요.', () => {
    clearTimeout(syncTimer); syncCfg = {}; saveSyncCfg(); syncError(''); syncShow();
  }, '연결 끊기');
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (syncTimer) syncNow(); });
  addEventListener('online', () => syncNow());
  openNote(state.notes.some(n => n.id === ui.lastNote) ? ui.lastNote : latest());
  if (storageBroken) { $('save-status').textContent = '저장 확인 필요'; $('save-status').hidden = false; toast('기존 데이터를 읽지 못했어요. 원본 보호를 위해 자동 저장을 멈췄어요.'); } else persist();
  syncShow(); syncNow();
  // 저장소 공간이 부족할 때 브라우저가 이 앱의 데이터를 먼저 지우지 않도록 요청한다(지원하는 브라우저만).
  navigator.storage?.persist?.().catch(() => {});
  // 업데이트: 새 버전은 뒤에서 받아 두기만 하고, 사용자가 '업데이트'를 누를 때 바꾼다.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    const sw = navigator.serviceWorker;
    let updating = false;
    const askVersion = () => {
      if (!sw.controller) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = e => { appVersion = e.data; showAppInfo(); };
      sw.controller.postMessage('version', [channel.port2]);
    };
    sw.addEventListener('controllerchange', () => { if (updating) location.reload(); else askVersion(); });
    window.addEventListener('load', () => {
      sw.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
        // 처음 설치할 때(기존 버전이 없을 때)는 알릴 필요가 없다.
        const offer = () => { if (reg.waiting && sw.controller) $('update-ready').hidden = false; };
        offer();
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (next) next.addEventListener('statechange', () => { if (next.state === 'installed') offer(); });
        });
        $('update-ready').onclick = () => {
          if (!reg.waiting) return;
          updating = true; $('update-ready').disabled = true; $('update-ready').textContent = '바꾸는 중…';
          reg.waiting.postMessage('skipWaiting');
        };
        // 홈 화면 앱은 닫지 않고 다시 띄우는 경우가 많아, 돌아올 때도 새 버전을 확인한다.
        const check = () => reg.update().catch(() => {});
        check();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      }).catch(() => {});
      askVersion();
    });
  }
})();
