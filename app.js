(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'sumnote.data.v1', BACKUP_KEY = 'sumnote.lastBackup', UI_KEY = 'sumnote.ui';
  let appVersion = null; // 설치된 버전은 서비스 워커(sw.js의 VERSION)에게 물어서 받는다.
  const fmt = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(Object.is(n, -0) ? 0 : n);
  const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const now = new Date().toISOString();
  let state, storageBroken = false, currentNote = null, query = '', namingAction, deleteAction, toastTimer;
  function validData(data) {
    return data && data.version === 1 && Array.isArray(data.notes) && Array.isArray(data.folders)
      && data.folders.every(f => f && typeof f.id === 'string' && typeof f.name === 'string' && f.name.trim())
      && new Set(data.folders.map(f => f.id)).size === data.folders.length
      && data.notes.every(n => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.updatedAt === 'string' && Number.isFinite(Date.parse(n.updatedAt)) && (n.folderId === null || data.folders.some(f => f.id === n.folderId)))
      && new Set(data.notes.map(n => n.id)).size === data.notes.length;
  }
  const SAMPLE_FOLDER = '일상 기록';
  const SAMPLES = [
    { title: '이번 주 장보기', body: ['사과 6,000', '우유 3,200', '식빵 4,500', '달걀 7,800', '---', '주방 세제 4,900', '할인 -2,000'].join('\n'), inFolder: true },
    { title: '제주 여행 준비', body: ['항공권 178,000', '숙소 240,000', '렌터카 65,000', '# 설레는 여행 준비'].join('\n'), inFolder: false },
    { title: '작은 모임 정산', body: ['저녁 78,000', '카페 24,000', '간식 12,000'].join('\n'), inFolder: true }
  ];
  function starter() {
    const folder = id();
    return { version: 1, folders: [{ id: folder, name: SAMPLE_FOLDER }], notes: SAMPLES.map(s => ({ id: id(), title: s.title, body: s.body, folderId: s.inFolder ? folder : null, updatedAt: now })) };
  }
  // 처음 열었을 때 넣어 둔 샘플을 손대지 않은 상태인지 (가져오기 때 샘플을 대신 지우기 위해)
  function onlySamples() {
    return state.notes.length > 0 && state.folders.every(f => f.name === SAMPLE_FOLDER)
      && state.notes.every(n => SAMPLES.some(s => s.title === n.title && s.body === n.body));
  }
  try { const saved = localStorage.getItem(KEY); if (saved) { state = JSON.parse(saved); if (!validData(state)) throw Error(); } else state = starter(); }
  catch (_) { state = { version: 1, folders: [], notes: [] }; storageBroken = true; }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
  function persist() {
    // 저장 상태는 문제가 있을 때만 위쪽 막대에 보인다.
    const warn = text => { $('save-status').textContent = text; $('save-status').hidden = false; };
    if (storageBroken) { warn('저장 확인 필요'); return false; }
    try { localStorage.setItem(KEY, JSON.stringify(state)); $('save-status').hidden = true; return true; }
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
    const name = element('span', 'tree-name', note.title || '이름 없는 노트');
    if (showFolder) name.append(element('small', '', folderName(note.folderId)));
    const sum = total(note);
    row.append(name, element('span', 'tree-sum' + (sum < 0 ? ' neg' : ''), fmt(sum)));
    row.onclick = () => openNote(note.id, true);
    return row;
  }
  function renderTree() {
    const tree = $('tree'); tree.replaceChildren();
    $('search-summary').hidden = !query;
    if (query) {
      const matches = ordered(state.notes.filter(n => (n.title + '\n' + n.body).toLocaleLowerCase().includes(query)));
      matches.forEach(n => tree.append(noteRow(n, true)));
      if (!matches.length) tree.append(element('p', 'tree-empty', '일치하는 노트가 없어요.'));
      let matchingTotal = 0, count = 0;
      for (const n of state.notes) for (const l of SumParser.parseNote(n.body).lines) if (l.raw.toLocaleLowerCase().includes(query)) { count++; if (l.type === 'value') matchingTotal += l.value; }
      $('search-summary').textContent = `노트 ${matches.length}개 · 일치하는 줄 ${count}개 · 합계 ${fmt(matchingTotal)}원`;
      return;
    }
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
  function renderLines() {
    const n = active(); if (!n) return;
    const parsed = SumParser.parseNote(n.body);
    $('line-numbers').replaceChildren(); $('line-values').replaceChildren();
    // 본문 아래 층: 같은 글자를 그리고, 합계에 들어간 숫자만 파랑/빨강으로 칠한다.
    const ink = document.createDocumentFragment();
    parsed.lines.forEach((line, i) => {
      if (i) ink.append('\n');
      let at = 0;
      for (const [a, b, sign] of line.spans) {
        if (a > at) ink.append(line.raw.slice(at, a));
        ink.append(element('span', sign < 0 ? 'neg' : sign > 0 ? 'pos' : '', line.raw.slice(a, b)));
        at = b;
      }
      if (at < line.raw.length) ink.append(line.raw.slice(at));
    });
    $('note-ink').replaceChildren(ink);
    parsed.lines.forEach((line, i) => {
      $('line-numbers').append(element('div', '', String(i + 1).padStart(2, '0')));
      const label = line.type === 'subtotal' ? '소계 ' + fmt(line.value) : line.type === 'invalid' ? '수식 확인' : line.value === null ? '' : fmt(line.value);
      const button = element('button', line.type + (line.value > 0 ? ' pos' : line.value < 0 ? ' neg' : ''), label);
      button.disabled = line.value === null;
      if (line.value !== null) { button.setAttribute('aria-label', `${i + 1}번째 줄 ${label} 복사`); button.onclick = () => copy(fmt(line.value)); }
      $('line-values').append(button);
    });
    // 높이는 줄 수만큼. 화면을 다 채우는 최소 높이는 CSS가 맡는다.
    $('note-body').style.height = parsed.lines.length * 34 + 8 + 'px';
    syncInk();
    $('note-total').textContent = fmt(parsed.total); $('copy-total').classList.toggle('neg', parsed.total < 0);
  }
  function renderEditor() {
    const n = active();
    $('editor').hidden = $('total-bar').hidden = $('edit-note').hidden = !n;
    $('empty-state').hidden = !!n;
    $('note-heading').textContent = n ? n.title || '이름 없는 노트' : '숨노트';
    $('note-heading').disabled = !n;
    if (!n) return;
    $('note-body').value = n.body;
    renderLines();
  }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); }
  function openNote(noteId, closeMenu) {
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
  function confirmDelete(title, description, action) { deleteAction = action; $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-dialog').showModal(); $('cancel-delete').focus(); }
  function newNote() {
    askName('새 노트', '', (name, folderId) => {
      const n = { id: id(), title: name, body: '', folderId, updatedAt: new Date().toISOString() };
      state.notes.push(n); query = ''; $('search').value = ''; persist(); openNote(n.id, true); $('note-body').focus();
    }, active()?.folderId || '');
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
  $('new-note').onclick = $('empty-new').onclick = newNote;
  $('new-folder').onclick = () => askName('새 폴더', '', name => { const f = { id: id(), name }; state.folders.push(f); openOnly(f.id); persist(); saveUi(); renderTree(); });
  // 노트 편집: 이름 · 폴더 이동 · CSV · 삭제
  $('edit-note').onclick = $('note-heading').onclick = () => {
    const n = active(); if (!n) return;
    $('edit-title').value = n.title; fillFolders($('edit-folder'), n.folderId);
    $('edit-date').textContent = dateLabel(n.updatedAt) + ' 수정';
    $('edit-dialog').showModal();
  };
  $('edit-form').onsubmit = event => {
    event.preventDefault(); const n = active(); if (!n) return;
    const title = $('edit-title').value.trim() || '이름 없는 노트', folderId = $('edit-folder').value || null;
    if (title !== n.title || folderId !== n.folderId) { n.title = title; n.folderId = folderId; openOnly(folderId || ''); saveUi(); changeNote(); renderEditor(); }
    $('edit-dialog').close();
  };
  $('delete-note').onclick = () => {
    const n = active(); if (!n) return; $('edit-dialog').close();
    confirmDelete('노트를 삭제할까요?', `‘${n.title || '이름 없는 노트'}’ 노트를 삭제하면 되돌릴 수 없어요.`, () => { state.notes = state.notes.filter(v => v.id !== n.id); persist(); openNote(latest()); });
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
  $('note-body').oninput = () => { const n = active(); if (n) { n.body = $('note-body').value; renderLines(); changeNote(); } };
  $('search').oninput = () => { query = $('search').value.trim().toLocaleLowerCase(); renderTree(); };
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
      const replaceSamples = onlySamples();
      const base = replaceSamples ? { folders: [], notes: [] } : state;
      const merged = { version: 1, folders: [...base.folders, ...folders], notes: [...base.notes, ...notes] };
      // Save the entire import before replacing the current in-memory collection.
      localStorage.setItem(KEY, JSON.stringify(merged)); state = merged;
      openNote(latest(), true); $('settings-dialog').close(); toast(`노트 ${notes.length}개를 가져왔어요.` + (replaceSamples ? ' 샘플 노트는 정리했어요.' : ''));
    } catch (error) { toast(error.name === 'QuotaExceededError' ? '저장 공간이 부족해 가져오지 못했어요.' : '숨노트 JSON 백업 파일인지 확인해 주세요. (최대 10MB)'); }
    finally { $('import-file').value = ''; }
  };
  openNote(state.notes.some(n => n.id === ui.lastNote) ? ui.lastNote : latest());
  if (storageBroken) { $('save-status').textContent = '저장 확인 필요'; $('save-status').hidden = false; toast('기존 데이터를 읽지 못했어요. 원본 보호를 위해 자동 저장을 멈췄어요.'); } else persist();
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
