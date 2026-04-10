// ================================================================
// PROJECT 002 -- admin.js (rebuilt)
// Mobile-first admin: Home · Generate · Files · Sessions
// ================================================================

window.P002Admin = (() => {

  // ── STATE ──────────────────────────────────────────────────────
  let currentUser = null;
  let currentTab = 'home';

  // Files state
  let openFilePath = null;
  let rawDirty = false;
  let blockSections = null;   // parsed section data in block editor
  let blockDirty = false;
  let selectedBlockIdx = null;
  let drawerPendingText = null;
  let drawerHistory = [];
  let scHistory = [];

  // Generate state
  let genPdfFile = null;
  let genSections = [];       // array of {meta, content, challenge, ai_context}
  let genEditingIdx = null;

  // Sessions state
  let currentSessionId = null;
  let sessionsView = 'sessions'; // 'sessions' | 'users'

  // Drag state
  let dragSrcIdx = null;

  // ── INIT ───────────────────────────────────────────────────────
  async function init() {
    try {
      const session = await P002Api.getSession();
      if (session && P002Api.isAdmin(session.user)) {
        currentUser = session.user;
        showApp();
      }
    } catch(e) { console.error('Init error:', e); }
  }

  function showApp() {
    document.getElementById('authScreen').style.display = 'none';
    const shell = document.getElementById('appShell');
    shell.style.display = 'flex';
    switchTab('home');
  }

  // ── AUTH ───────────────────────────────────────────────────────
  async function doLogin() {
    const email = P002Security.sanitizeInput(document.getElementById('authEmail').value.trim());
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authBtn');
    const err = document.getElementById('authError');
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Authenticating...';
    try {
      const user = await P002Api.signIn(email, password);
      if (!P002Api.isAdmin(user)) throw new Error('Not authorized as admin');
      currentUser = user;
      showApp();
    } catch(e) {
      err.textContent = e.message;
      err.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'Access Admin';
  }

  async function doLogout() {
    await P002Api.signOut();
    location.reload();
  }

  // ── TABS ───────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.btab').forEach(b => b.classList.remove('active'));
    document.getElementById('screen' + cap(name)).classList.add('active');
    document.getElementById('tab-' + name)?.classList.add('active');
    currentTab = name;
    if (name === 'home') loadHomeStats();
    if (name === 'files') loadFiles();
    if (name === 'sessions') loadSessions();
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── HOME ───────────────────────────────────────────────────────
  async function loadHomeStats() {
    try {
      const data = await P002Api.adminGetStats();
      document.getElementById('statSessions').textContent = data.total_sessions ?? '—';
      document.getElementById('statFlags').textContent = data.flags_captured ?? '—';
    } catch(e) {}
    try {
      const items = await P002Api.listBucket('');
      const folders = items.filter(f => !f.metadata);
      document.getElementById('statModules').textContent = folders.length;
      document.getElementById('homeFilesMeta').textContent = folders.length + ' modules · ' + items.length + ' total files';
    } catch(e) {}
  }

  // ── GENERATE ───────────────────────────────────────────────────
  function handlePdfDrop(e) {
    e.preventDefault();
    document.getElementById('uploadZone').classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.pdf')) setPdfFile(file);
  }

  function handlePdfSelect(e) {
    const file = e.target.files[0];
    if (file) setPdfFile(file);
  }

  function setPdfFile(file) {
    genPdfFile = file;
    const zone = document.getElementById('uploadZone');
    zone.classList.add('has-file');
    document.getElementById('uzFilename').style.display = 'block';
    document.getElementById('uzFilename').textContent = '✓ ' + file.name;
    document.getElementById('uzTitle').textContent = 'PDF selected';
    document.getElementById('uzSub').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
    // Auto-fill key from filename
    const key = 'module_' + file.name.replace('.pdf','').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    if (!document.getElementById('genKey').value) document.getElementById('genKey').value = key;
  }

  async function startGeneration() {
    if (!genPdfFile) { toast('Select a PDF first', 'err'); return; }
    const key = document.getElementById('genKey').value.trim();
    const title = document.getElementById('genTitle').value.trim();
    if (!key || !title) { toast('Module key and title required', 'err'); return; }

    const pageFrom = parseInt(document.getElementById('genPageFrom').value) || 1;
    const pageTo = parseInt(document.getElementById('genPageTo').value) || 9999;

    showGenStep(2);
    document.getElementById('genProgressTitle').textContent = title;
    genSections = [];

    logGen('working', '⟳ Loading PDF.js...');
    await loadPdfJs();

    logGen('working', '⟳ Extracting pages ' + pageFrom + '–' + pageTo + '...');
    let chapters;
    try {
      const sectionsPerChapter = parseInt(document.getElementById('genSectionsPerChapter').value) || 3;
      chapters = await extractPdfChapters(genPdfFile, pageFrom, pageTo, sectionsPerChapter);
      logGen('ok', '✓ Extracted — ' + chapters.length + ' sections detected');
    } catch(e) {
      logGen('err', '✗ PDF extraction failed: ' + e.message);
      return;
    }

    const total = chapters.length;
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const pct = Math.round((i / total) * 100);
      updateProgress(pct, 'Section ' + (i+1) + ' of ' + total, ch.title + ' — generating...');
      logGen('working', '⟳ Section ' + String(i+1).padStart(2,'0') + ' generating — ' + ch.title + '...');
      try {
        const section = await generateSection(ch, i+1, total, key, title,
          getCategory(),
          document.getElementById('genDifficulty').value);
        genSections.push(section);
        logGen('ok', '✓ Section ' + String(i+1).padStart(2,'0') + ' done — ' + section.meta.title +
          ' (' + section.meta.minutes + ' min, ' + section.content.length + ' blocks)');
        const remaining = Math.round((total - i - 1) * 35);
        document.getElementById('genTimeEst').textContent = remaining > 0 ? '~' + remaining + 's remaining · using Sonnet' : 'Almost done...';
      } catch(e) {
        logGen('err', '✗ Section ' + (i+1) + ' failed: ' + e.message);
      }
      // Rate limit buffer — 500ms between calls
      await new Promise(r => setTimeout(r, 500));
    }

    updateProgress(100, 'Complete', 'All sections generated');
    logGen('ok', '✓ Done — ' + genSections.length + ' sections generated');
    showGenReview();
  }

  async function loadPdfJs() {
    if (window.pdfjsLib) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  async function extractPdfChapters(file, pageFrom, pageTo, sectionsPerChapter) {
    pageFrom = pageFrom || 1;
    pageTo = pageTo || 9999;
    sectionsPerChapter = sectionsPerChapter || 3;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const startPage = Math.max(1, pageFrom);
    const endPage = Math.min(numPages, pageTo);
    let fullText = '';

    for (let p = startPage; p <= endPage; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(function(i) { return i.str; }).join(' ');
      fullText += pageText + '\n';
    }

    // Try chapter detection
    const chapterPattern = /Chapter\s+\d+|CHAPTER\s+\d+/gm;
    const matches = Array.from(fullText.matchAll(chapterPattern));

    let rawChapters = [];
    if (matches.length >= 2) {
      for (let i = 0; i < matches.length; i++) {
        const s = matches[i].index;
        const e = i < matches.length - 1 ? matches[i+1].index : fullText.length;
        const text = fullText.slice(s, e).trim();
        if (text.length > 300) {
          const titleLine = text.split('\\n')[0].trim().slice(0, 80);
          rawChapters.push({ title: titleLine, text: text });
        }
      }
    }

    if (rawChapters.length === 0) {
      // Fallback: treat whole text as one chapter
      rawChapters = [{ title: 'Content', text: fullText }];
    }

    // Split each chapter into sectionsPerChapter sub-sections
    const sections = [];
    rawChapters.forEach(function(chapter, chIdx) {
      const words = chapter.text.split(/\s+/).filter(function(w) { return w.length > 0; });
      const subChunkSize = Math.ceil(words.length / sectionsPerChapter);
      for (let s = 0; s < sectionsPerChapter; s++) {
        const chunk = words.slice(s * subChunkSize, (s + 1) * subChunkSize).join(' ');
        if (chunk.trim().length > 100) {
          const partLabel = sectionsPerChapter > 1 ? ' (Part ' + (s+1) + ')' : '';
          sections.push({
            title: chapter.title + partLabel,
            text: chunk.slice(0, 4000),
            chapterNum: chIdx + 1,
            partNum: s + 1
          });
        }
      }
    });

    return sections.slice(0, 20);
  }

  async function generateSection(chapter, sectionNum, totalSections, moduleKey, moduleTitle, category, difficulty) {
    const systemPrompt = `You are a cybersecurity curriculum developer. Convert source material into an educational reader section in JSON format.

CRITICAL RULES:
- Rewrite ALL content completely in your own words. Never reproduce source text verbatim.
- The output must be valid JSON only — no markdown, no backticks, no explanation.
- Keep content educational and accurate but completely rewritten.

OUTPUT SCHEMA:
{
  "meta": {
    "title": "Section title (5 words max)",
    "module": "${moduleTitle}",
    "section": ${sectionNum},
    "total_sections": ${totalSections},
    "difficulty": "${difficulty}",
    "minutes": (estimated reading time 8-20)
  },
  "content": [
    {"type": "heading", "text": "..."},
    {"type": "body", "text": "..."},
    {"type": "code", "lang": "sql|bash|python|text", "text": "..."},
    {"type": "callout", "text": "..."}
  ],
  "challenge": null or {
    "title": "...",
    "description": "...",
    "query": "...",
    "flag": "the answer",
    "sim_type": "login|source|comment|http|api|files|none",
    "hints": ["hint1", "hint2", "hint3"]
  },
  "ai_context": "2-3 sentence summary of what this section covers for the AI tutor"
}

Include 10-16 content blocks. This may be one part of a larger chapter — focus only on the concepts in the provided content. Add a challenge only if the content covers something directly hands-on and exploitable.`;

    const userMsg = `Convert this chapter into a reader section. Chapter title: "${chapter.title}"\n\nContent:\n${chapter.text}`;

    // Use P002Api.callClaude — has correct headers including apikey for Supabase CORS
    const rawText = await P002Api.callClaude(systemPrompt, [{ role: 'user', content: userMsg }], null, 'sonnet');

    // Strip any markdown fencing and parse JSON
    const clean = rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  }

  function showGenReview() {
    showGenStep(3);
    const title = document.getElementById('genTitle').value.trim();
    document.getElementById('genReviewTitle').textContent = title;
    const flags = genSections.filter(s => s.challenge).length;
    document.getElementById('genReviewMeta').textContent = genSections.length + ' sections · ' + flags + ' flags';

    const valid = genSections.every(s => s.meta && s.content && Array.isArray(s.content));
    document.getElementById('genReviewValid').textContent = valid ? '✓ all valid' : '⚠ review warnings';

    const list = document.getElementById('genSectionList');
    list.innerHTML = '';
    genSections.forEach((s, i) => {
      const blocks = s.content?.length || 0;
      const isShort = blocks < 10;
      const row = document.createElement('div');
      row.className = 'section-row' + (isShort ? ' warn' : '');
      row.innerHTML =
        '<div class="sr-num">' + String(i+1).padStart(2,'0') + '</div>' +
        '<div class="sr-info">' +
          '<div class="sr-title">' + P002Security.escapeHtml(s.meta?.title || 'Section ' + (i+1)) + '</div>' +
          '<div class="sr-meta">' + (s.meta?.minutes||'?') + ' min · ' + blocks + ' blocks' + (s.challenge ? ' · 🏴' : '') + (isShort ? ' — short?' : '') + '</div>' +
        '</div>' +
        '<div class="sr-badge ' + (isShort ? 'warn' : s.challenge ? 'flag' : 'ok') + '">' + (isShort ? '⚠' : s.challenge ? '🏴' : '✓') + '</div>' +
        '<button class="sr-edit" onclick="P002Admin.editGenSection(' + i + ')">✏</button>';
      list.appendChild(row);
    });
  }

  function editGenSection(idx) {
    genEditingIdx = idx;
    const section = genSections[idx];
    document.getElementById('sectionEditInfo').textContent = 'Section ' + (idx+1) + ' — ' + (section.meta?.title || '');
    document.getElementById('sectionEditTextarea').value = JSON.stringify(section, null, 2);
    document.getElementById('sectionEditModal').style.display = 'flex';
  }

  function saveSectionEdit() {
    const text = document.getElementById('sectionEditTextarea').value;
    try {
      const parsed = JSON.parse(text);
      genSections[genEditingIdx] = parsed;
      closeModal('sectionEditModal');
      showGenReview();
      toast('Section updated', 'ok');
    } catch(e) {
      toast('Invalid JSON: ' + e.message, 'err');
    }
  }

  async function deployModule() {
    const key = document.getElementById('genKey').value.trim();
    const title = document.getElementById('genTitle').value.trim();
    toast('Deploying ' + genSections.length + ' files...', 'ok');

    // Build manifest
    const sections = genSections.map((s, i) => ({
      file: 'section_' + String(i+1).padStart(2,'0') + '.json',
      title: s.meta?.title || 'Section ' + (i+1),
      difficulty: s.meta?.difficulty || 'beginner',
      minutes: s.meta?.minutes || 10,
      has_flag: !!s.challenge
    }));

    const totalMins = sections.reduce((a, s) => a + s.minutes, 0);
    const manifest = {
      module_key: key,
      title,
      description: '',
      category: getCategory(),
      difficulty: document.getElementById('genDifficulty').value,
      estimated_hours: parseFloat((totalMins / 60).toFixed(1)),
      icon: '🔒',
      sections
    };

    try {
      await P002Api.adminSaveFile(key + '/manifest.json', JSON.stringify(manifest, null, 2));
      for (let i = 0; i < genSections.length; i++) {
        const fname = key + '/section_' + String(i+1).padStart(2,'0') + '.json';
        await P002Api.adminSaveFile(fname, JSON.stringify(genSections[i], null, 2));
      }
      showGenStep(4);
      document.getElementById('doneSub').textContent = title + ' is live. Rebuild Index to make it appear in the app.';
      document.getElementById('doneStats').innerHTML =
        doneStatHtml(genSections.length, 'Sections') +
        doneStatHtml(sections.filter(s=>s.has_flag).length, 'Flags') +
        doneStatHtml(Math.ceil(totalMins/60) + 'h', 'Content');
    } catch(e) {
      toast('Deploy failed: ' + e.message, 'err');
    }
  }

  function doneStatHtml(val, lbl) {
    return '<div class="done-stat"><div class="done-stat-val">' + val + '</div><div class="done-stat-lbl">' + lbl + '</div></div>';
  }

  async function downloadModuleZip() {
    const key = document.getElementById('genKey').value.trim();
    const title = document.getElementById('genTitle').value.trim();
    toast('Building ZIP...', 'ok');
    try {
      const JSZip = window.JSZip;
      const zip = new JSZip();
      const folder = zip.folder(key);
      const sections = genSections.map((s, i) => ({
        file: 'section_' + String(i+1).padStart(2,'0') + '.json',
        title: s.meta?.title || 'Section ' + (i+1),
        difficulty: s.meta?.difficulty || 'beginner',
        minutes: s.meta?.minutes || 10,
        has_flag: !!s.challenge
      }));
      const totalMins = sections.reduce((a, s) => a + s.minutes, 0);
      const manifest = {
        module_key: key, title,
        description: '',
        category: getCategory(),
        difficulty: document.getElementById('genDifficulty').value,
        estimated_hours: parseFloat((totalMins / 60).toFixed(1)),
        icon: '🔒', sections
      };
      folder.file('manifest.json', JSON.stringify(manifest, null, 2));
      genSections.forEach((s, i) => {
        folder.file('section_' + String(i+1).padStart(2,'0') + '.json', JSON.stringify(s, null, 2));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = key + '.zip';
      a.click();
    } catch(e) {
      toast('ZIP failed: ' + e.message, 'err');
    }
  }

  function resetGenerate() {
    genPdfFile = null;
    genSections = [];
    showGenStep(1);
    document.getElementById('uploadZone').classList.remove('has-file');
    document.getElementById('uzFilename').style.display = 'none';
    document.getElementById('uzTitle').textContent = 'Drop a PDF here';
    document.getElementById('uzSub').textContent = 'or tap to browse · max 50MB';
    document.getElementById('genKey').value = '';
    document.getElementById('genTitle').value = '';
    document.getElementById('genLog').innerHTML = '';
    document.getElementById('pdfFileInput').value = '';
  }

  function showGenStep(n) {
    [1,2,3,4].forEach(i => {
      const el = document.getElementById('genStep' + i);
      if (el) el.style.display = i === n ? 'flex' : 'none';
    });
  }

  function logGen(type, msg) {
    const log = document.getElementById('genLog');
    const div = document.createElement('div');
    div.className = 'log-' + type;
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function updateProgress(pct, title, sub) {
    document.getElementById('genProgPct').textContent = pct + '%';
    document.getElementById('genProgTitle').textContent = title;
    document.getElementById('genProgSub').textContent = sub;
    document.getElementById('genProgFill').style.width = pct + '%';
  }

  // ── FILES ──────────────────────────────────────────────────────
  async function loadFiles() {
    showFilesView('list');
    const list = document.getElementById('fileList');
    list.innerHTML = '<div class="loading-center">Loading...</div>';
    try {
      const items = await P002Api.listBucket('');
      list.innerHTML = '';
      const folders = items.filter(f => !f.metadata && !f.name.startsWith('.'));
      const rootFiles = items.filter(f => f.metadata);

      for (const folder of folders) {
        const folderEl = await buildFolderItem(folder.name);
        list.appendChild(folderEl);
      }
      rootFiles.forEach(f => list.appendChild(buildFileItem(f, '')));
    } catch(e) {
      list.innerHTML = '<div class="loading-center" style="color:var(--accent);">Error: ' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  async function buildFolderItem(folderName) {
    const el = document.createElement('div');
    el.className = 'folder-item';

    const header = document.createElement('div');
    header.className = 'folder-header';
    const arrow = document.createElement('div');
    arrow.className = 'folder-arrow';
    arrow.textContent = '▶';
    header.innerHTML =
      '<div class="folder-icon">📁</div>' +
      '<div class="folder-name">' + P002Security.escapeHtml(folderName) + '</div>';
    header.insertBefore(arrow, header.firstChild);

    const filesDiv = document.createElement('div');
    filesDiv.className = 'folder-files';

    let loaded = false;
    header.onclick = async () => {
      const isOpen = filesDiv.classList.contains('open');
      if (!isOpen && !loaded) {
        loaded = true;
        filesDiv.innerHTML = '<div style="padding:8px 12px;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);">Loading...</div>';
        try {
          const data = await P002Api.listBucket(folderName);
          filesDiv.innerHTML = '';
          data.forEach(f => filesDiv.appendChild(buildFileItem(f, folderName)));
        } catch(e) {}
      }
      filesDiv.classList.toggle('open', !isOpen);
      arrow.classList.toggle('open', !isOpen);
    };

    el.appendChild(header);
    el.appendChild(filesDiv);
    return el;
  }

  function buildFileItem(file, folder) {
    const path = folder ? folder + '/' + file.name : file.name;
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML =
      '<div class="file-dot"></div>' +
      '<div class="file-name">' + P002Security.escapeHtml(file.name) + '</div>' +
      '<div class="file-size">' + (file.metadata?.size ? Math.ceil(file.metadata.size/1024) + 'KB' : '') + '</div>' +
      '<button class="file-del" onclick="event.stopPropagation();P002Admin.deleteFile(\'' + P002Security.escapeHtml(path) + '\')">🗑</button>';
    el.onclick = () => openFile(path, file.name);
    return el;
  }

  async function openFile(path, name) {
    const safePath = P002Security.sanitizePath(path);
    if (!safePath) { toast('Invalid path', 'err'); return; }
    openFilePath = safePath;

    try {
      const data = await P002Api.adminGetFile(safePath);
      const content = data.content;
      const isSection = name.match(/^section_\d+\.json$/) && content.includes('"content"');

      if (isSection) {
        // Block editor
        try {
          const parsed = JSON.parse(content);
          if (parsed.meta && parsed.content && Array.isArray(parsed.content)) {
            blockSections = parsed;
            blockDirty = false;
            openBlockEditor(safePath);
            return;
          }
        } catch(e) {}
      }

      // Raw editor
      openRawEditor(safePath, content);
    } catch(e) {
      toast('Failed to load: ' + e.message, 'err');
    }
  }

  async function deleteFile(path) {
    if (!confirm('Delete ' + path + '?')) return;
    try {
      await P002Api.deleteFile(path);
      toast('Deleted', 'ok');
      loadFiles();
    } catch(e) {
      toast('Delete failed: ' + e.message, 'err');
    }
  }

  function showFilesView(which) {
    document.getElementById('filesListView').style.display = which === 'list' ? 'flex' : 'none';
    document.getElementById('blockEditorView').style.display = which === 'block' ? 'flex' : 'none';
    document.getElementById('rawEditorView').style.display = which === 'raw' ? 'flex' : 'none';
  }

  // ── BLOCK EDITOR ──────────────────────────────────────────────
  function openBlockEditor(path) {
    showFilesView('block');
    document.getElementById('beFilename').textContent = path;
    document.getElementById('beUnsaved').style.display = 'none';
    selectedBlockIdx = null;
    renderBlocks();
  }

  function closeBlockEditor() {
    if (blockDirty && !confirm('Discard unsaved changes?')) return;
    blockDirty = false;
    blockSections = null;
    closeAiDrawer();
    closeSectionChat();
    showFilesView('list');
  }

  function renderBlocks() {
    const container = document.getElementById('beBlocks');
    container.innerHTML = '';
    if (!blockSections?.content) return;

    // Insert zone at the top
    container.appendChild(buildInsertZone(0));

    blockSections.content.forEach((block, i) => {
      container.appendChild(buildBlockEl(block, i));
      container.appendChild(buildInsertZone(i + 1));
    });
  }

  function buildInsertZone(afterIdx) {
    const el = document.createElement('div');
    el.className = 'block-insert';
    el.innerHTML = '<div class="block-insert-line"></div><button class="block-insert-btn" onclick="P002Admin.insertBlockAt(' + afterIdx + ')">+ insert</button><div class="block-insert-line"></div>';
    return el;
  }

  function buildBlockEl(block, idx) {
    const el = document.createElement('div');
    el.className = 'content-block' + (idx === selectedBlockIdx ? ' selected' : '');
    el.dataset.idx = idx;
    el.draggable = true;

    const typeLabel = block.type + (block.lang ? ' · ' + block.lang : '');
    const contentClass = block.type === 'heading' ? 'heading' : block.type === 'code' ? 'code' : block.type === 'callout' ? 'callout' : '';
    const preview = block.text ? block.text.slice(0, 120) + (block.text.length > 120 ? '...' : '') : '';

    el.innerHTML =
      '<div class="cb-type-row">' +
        '<div class="cb-type">' + P002Security.escapeHtml(typeLabel) + (idx === selectedBlockIdx ? ' <span class="cb-type-tag">● selected</span>' : '') + '</div>' +
        '<div class="cb-drag-handle" title="Drag to reorder">⠿</div>' +
      '</div>' +
      '<div class="cb-content ' + contentClass + '">' + P002Security.escapeHtml(preview) + '</div>';

    // Click to select
    el.onclick = (e) => {
      if (e.target.classList.contains('cb-drag-handle')) return;
      selectBlock(idx);
    };

    // Drag handlers
    el.addEventListener('dragstart', e => {
      dragSrcIdx = idx;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragSrcIdx !== null && dragSrcIdx !== idx) {
        const blocks = blockSections.content;
        const [moved] = blocks.splice(dragSrcIdx, 1);
        blocks.splice(idx, 0, moved);
        blockDirty = true;
        document.getElementById('beUnsaved').style.display = 'block';
        renderBlocks();
      }
    });

    // Show popup if selected
    if (idx === selectedBlockIdx) {
      const popup = document.createElement('div');
      popup.className = 'block-popup';
      popup.innerHTML =
        '<button class="bp-btn primary" onclick="P002Admin.blockAction(\'expand\')">Expand</button>' +
        '<button class="bp-btn" onclick="P002Admin.blockAction(\'rework\')">Rework</button>' +
        '<button class="bp-btn" onclick="P002Admin.blockAction(\'example\')">Example</button>' +
        '<button class="bp-btn" onclick="P002Admin.blockAction(\'split\')">Split</button>' +
        '<button class="bp-btn danger" onclick="P002Admin.deleteBlock(' + idx + ')">🗑</button>';
      el.appendChild(popup);
    }

    return el;
  }

  function selectBlock(idx) {
    if (selectedBlockIdx === idx) {
      selectedBlockIdx = null;
    } else {
      selectedBlockIdx = idx;
    }
    renderBlocks();
    // Scroll selected block into view
    setTimeout(() => {
      const selected = document.querySelector('.content-block.selected');
      if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function insertBlockAt(idx) {
    // Show type picker
    const container = document.getElementById('beBlocks');
    // Remove any existing picker
    document.querySelectorAll('.block-type-picker').forEach(p => p.remove());

    const zones = container.querySelectorAll('.block-insert');
    const zone = zones[idx];
    if (!zone) return;

    const picker = document.createElement('div');
    picker.className = 'block-type-picker';
    picker.style.position = 'relative';
    picker.style.bottom = 'auto';
    picker.style.left = 'auto';
    picker.style.transform = 'none';
    picker.style.display = 'flex';
    picker.innerHTML =
      '<button class="btp-btn" onclick="P002Admin.doInsertBlock('+idx+',\'heading\')">Heading</button>' +
      '<button class="btp-btn" onclick="P002Admin.doInsertBlock('+idx+',\'body\')">Body</button>' +
      '<button class="btp-btn" onclick="P002Admin.doInsertBlock('+idx+',\'code\')">Code</button>' +
      '<button class="btp-btn" onclick="P002Admin.doInsertBlock('+idx+',\'callout\')">Callout</button>' +
      '<button class="btp-btn" onclick="document.querySelectorAll(\'.block-type-picker\').forEach(p=>p.remove())">✕</button>';
    zone.appendChild(picker);
  }

  function doInsertBlock(idx, type) {
    document.querySelectorAll('.block-type-picker').forEach(p => p.remove());
    const newBlock = { type, text: type === 'heading' ? 'New Heading' : type === 'code' ? '// code here' : 'New ' + type + ' block.' };
    if (type === 'code') newBlock.lang = 'text';
    blockSections.content.splice(idx, 0, newBlock);
    blockDirty = true;
    document.getElementById('beUnsaved').style.display = 'block';
    selectedBlockIdx = idx;
    renderBlocks();
  }

  function deleteBlock(idx) {
    if (!confirm('Delete this block?')) return;
    blockSections.content.splice(idx, 1);
    selectedBlockIdx = null;
    blockDirty = true;
    document.getElementById('beUnsaved').style.display = 'block';
    renderBlocks();
  }

  async function blockAction(action) {
    if (selectedBlockIdx === null) return;
    const block = blockSections.content[selectedBlockIdx];
    const labels = { expand: 'Expand', rework: 'Rework', example: 'Add Example', split: 'Split' };
    const prompts = {
      expand: 'Expand this content block with more depth and detail. Return only the new text content, no JSON wrapper.',
      rework: 'Rework this content block — different explanation, same concept. Return only the new text content.',
      example: 'Add a concrete real-world example to illustrate this. Return only the example text.',
      split: 'This block is too long. Split it into two shorter blocks. Return as JSON array: [{"type":"body","text":"..."},{"type":"body","text":"..."}]'
    };

    openAiDrawer(labels[action], block.text);
    document.getElementById('drawerTyping').style.display = 'flex';
    document.getElementById('drawerResponse').textContent = '';
    document.getElementById('drawerActions').style.display = 'none';

    const sp = 'You are a cybersecurity curriculum editor. Edit content blocks for an educational reader platform. Section: "' + (blockSections?.meta?.title || '') + '". ' + (blockSections?.ai_context || '') + ' Be concise and educational.';
    const msg = prompts[action] + '\n\nBlock content: "' + block.text + '"';

    try {
      const reply = await P002Api.callClaude(sp, [{ role: 'user', content: msg }], null, 'haiku');
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').innerHTML = formatResponse(reply);
      document.getElementById('drawerActions').style.display = 'flex';
      drawerPendingText = reply;
      drawerHistory = [{ role: 'user', content: msg }, { role: 'assistant', content: reply }];
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').textContent = 'Error: ' + e.message;
    }
  }

  function applyDrawerEdit() {
    if (selectedBlockIdx === null || !drawerPendingText) return;
    const block = blockSections.content[selectedBlockIdx];

    // Check if response is a JSON array (split action)
    try {
      const parsed = JSON.parse(drawerPendingText.trim());
      if (Array.isArray(parsed)) {
        blockSections.content.splice(selectedBlockIdx, 1, ...parsed);
        toast('Block split into ' + parsed.length, 'ok');
        selectedBlockIdx = null;
        blockDirty = true;
        document.getElementById('beUnsaved').style.display = 'block';
        closeAiDrawer();
        renderBlocks();
        return;
      }
    } catch(e) {}

    block.text = drawerPendingText;
    // Mark updated
    blockDirty = true;
    document.getElementById('beUnsaved').style.display = 'block';
    closeAiDrawer();
    renderBlocks();
    // Highlight updated block
    setTimeout(() => {
      const blocks = document.querySelectorAll('.content-block');
      if (blocks[selectedBlockIdx]) blocks[selectedBlockIdx].classList.add('updated');
    }, 50);
    toast('Block updated', 'ok');
    drawerPendingText = null;
    selectedBlockIdx = null;
  }

  async function sendDrawerMessage() {
    const input = document.getElementById('drawerInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    drawerHistory.push({ role: 'user', content: text });
    document.getElementById('drawerTyping').style.display = 'flex';
    document.getElementById('drawerActions').style.display = 'none';
    const sp = 'You are a cybersecurity curriculum editor. Edit content blocks for an educational reader. Section: "' + (blockSections?.meta?.title || '') + '".';
    try {
      const reply = await P002Api.callClaude(sp, drawerHistory.slice(-4), null, 'haiku');
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').innerHTML += '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">' + formatResponse(reply) + '</div>';
      document.getElementById('drawerActions').style.display = 'flex';
      drawerPendingText = reply;
      drawerHistory.push({ role: 'assistant', content: reply });
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
    }
  }

  function openAiDrawer(mode, quote) {
    document.getElementById('aiDrawer').style.display = 'block';
    document.getElementById('drawerMode').textContent = mode;
    document.getElementById('drawerQuote').textContent = '"' + (quote||'').slice(0,100) + (quote?.length > 100 ? '...' : '') + '"';
    drawerHistory = [];
    drawerPendingText = null;
  }

  function closeAiDrawer() {
    document.getElementById('aiDrawer').style.display = 'none';
    drawerPendingText = null;
    drawerHistory = [];
  }

  // Section chat
  function openSectionChat() {
    document.getElementById('sectionChat').style.display = 'flex';
    document.getElementById('scMsgs').innerHTML = '';
    scHistory = [];
    addScMsg('ai', 'Ready. Ask me to rework, deepen, add content, generate a challenge, or restructure this section.');
  }

  function closeSectionChat() {
    document.getElementById('sectionChat').style.display = 'none';
    scHistory = [];
  }

  async function sendScMessage() {
    const input = document.getElementById('scInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    scChip(text);
  }

  async function scChip(text) {
    addScMsg('user', text);
    scHistory.push({ role: 'user', content: text });
    const sp = 'You are a cybersecurity curriculum editor helping to improve a section. Section title: "' + (blockSections?.meta?.title || '') + '". Content has ' + (blockSections?.content?.length || 0) + ' blocks. Context: ' + (blockSections?.ai_context || '') + '. Provide specific, actionable suggestions. Keep responses concise.';
    const typingEl = addScMsg('ai', '···');
    try {
      const reply = await P002Api.callClaude(sp, scHistory.slice(-4), null, 'haiku');
      typingEl.innerHTML = formatResponse(reply);
      scHistory.push({ role: 'assistant', content: reply });
    } catch(e) {
      typingEl.textContent = 'Error: ' + e.message;
    }
  }

  function addScMsg(role, text) {
    const msgs = document.getElementById('scMsgs');
    const div = document.createElement('div');
    div.className = 'sc-' + role;
    div.innerHTML = formatResponse(text);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  async function deepenSection() {
    openSectionChat();
    await scChip('This section needs more technical depth. What specific content should I add or expand?');
  }

  function addBlock() {
    insertBlockAt(blockSections.content.length);
  }

  async function saveBlockEditor() {
    if (!openFilePath || !blockSections) return;
    const btn = document.getElementById('beSaveBtn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
      await P002Api.adminSaveFile(openFilePath, JSON.stringify(blockSections, null, 2));
      blockDirty = false;
      document.getElementById('beUnsaved').style.display = 'none';
      toast('Saved', 'ok');
    } catch(e) {
      toast('Save failed: ' + e.message, 'err');
    }
    btn.textContent = '✓ Save';
    btn.disabled = false;
  }

  // ── RAW EDITOR ────────────────────────────────────────────────
  function openRawEditor(path, content) {
    showFilesView('raw');
    openFilePath = path;
    rawDirty = false;
    document.getElementById('rawFilename').textContent = path;
    document.getElementById('rawValidateStatus').style.display = 'none';
    const textarea = document.getElementById('rawTextarea');
    try {
      textarea.value = JSON.stringify(JSON.parse(content), null, 2);
    } catch(e) {
      textarea.value = content;
    }
    updateRawStatus();
  }

  function closeRawEditor() {
    if (rawDirty && !confirm('Discard unsaved changes?')) return;
    rawDirty = false;
    showFilesView('list');
  }

  function onRawChange() {
    rawDirty = true;
    updateRawStatus();
    document.getElementById('rawValidateStatus').style.display = 'none';
  }

  function updateRawStatus() {
    const text = document.getElementById('rawTextarea').value;
    document.getElementById('rawLines').textContent = text.split('\n').length + ' lines';
    document.getElementById('rawSize').textContent = (new Blob([text]).size / 1024).toFixed(1) + ' KB';
  }

  function validateRaw() {
    const text = document.getElementById('rawTextarea').value;
    const status = document.getElementById('rawValidateStatus');
    status.style.display = 'block';
    try {
      JSON.parse(text);
      status.textContent = '✓ Valid JSON';
      status.className = 'raw-validate-status ok';
    } catch(e) {
      status.textContent = '✗ ' + e.message;
      status.className = 'raw-validate-status err';
    }
  }

  function formatRaw() {
    const textarea = document.getElementById('rawTextarea');
    try {
      textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
      updateRawStatus();
      toast('Formatted', 'ok');
    } catch(e) {
      toast('Invalid JSON', 'err');
    }
  }

  function handleRawKey(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = e.target.selectionStart;
      e.target.value = e.target.value.substring(0, s) + '  ' + e.target.value.substring(e.target.selectionEnd);
      e.target.selectionStart = e.target.selectionEnd = s + 2;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveRaw(); }
  }

  async function saveRaw() {
    if (!openFilePath) return;
    const text = document.getElementById('rawTextarea').value;
    try {
      JSON.parse(text); // validate before save
    } catch(e) {
      toast('Invalid JSON — fix errors before saving', 'err');
      return;
    }
    try {
      await P002Api.adminSaveFile(openFilePath, text);
      rawDirty = false;
      toast('Saved', 'ok');
    } catch(e) {
      toast('Save failed: ' + e.message, 'err');
    }
  }

  // ── ZIP UPLOAD ────────────────────────────────────────────────
  function showUploadZipModal() {
    document.getElementById('zipModal').style.display = 'flex';
    document.getElementById('zipOutput').style.display = 'none';
  }

  async function handleZipUpload() {
    const fileInput = document.getElementById('zipFileInput');
    const file = fileInput.files[0];
    if (!file) { toast('Select a ZIP first', 'err'); return; }

    const output = document.getElementById('zipOutput');
    const btn = document.getElementById('btnUploadZip');
    output.style.display = 'block';
    output.innerHTML = '<span style="color:var(--orange);">Processing ZIP...</span>';
    btn.disabled = true; btn.textContent = 'Processing...';

    try {
      const result = await P002Security.processLessonZip(file);
      if (!result.ok) { output.innerHTML = '<span style="color:var(--accent);">✗ ' + P002Security.escapeHtml(result.error) + '</span>'; return; }

      let html = ''; let ok = 0; let fail = 0;
      for (const r of result.results) {
        if (r.ok) {
          html += '<span style="color:var(--orange);">⟳ ' + P002Security.escapeHtml(r.path) + '...</span>\n';
          output.innerHTML = html;
          try {
            await P002Api.adminSaveFile(r.path, r.content);
            html = html.replace('⟳ ' + P002Security.escapeHtml(r.path) + '...', '✓ ' + P002Security.escapeHtml(r.path));
            ok++;
          } catch(e) { html += '<span style="color:var(--accent);">✗ ' + P002Security.escapeHtml(r.path) + '</span>\n'; fail++; }
        } else {
          html += '<span style="color:var(--accent);">✗ ' + P002Security.escapeHtml(r.filename) + ' — ' + P002Security.escapeHtml((r.errors||[]).join(', ')) + '</span>\n';
          fail++;
        }
        output.innerHTML = html;
      }
      html += '<span style="color:var(--text-muted);">\nDone: ' + ok + ' uploaded, ' + fail + ' failed</span>';
      output.innerHTML = html;
      if (ok > 0) { toast(ok + ' file(s) uploaded', 'ok'); loadFiles(); }
    } catch(e) {
      output.innerHTML = '<span style="color:var(--accent);">Error: ' + P002Security.escapeHtml(e.message) + '</span>';
    } finally {
      btn.disabled = false; btn.textContent = '▶ Upload';
      fileInput.value = '';
    }
  }

  // ── REBUILD INDEX ─────────────────────────────────────────────
  async function rebuildIndex() {
    toast('Rebuilding index...', 'ok');
    const btn = document.getElementById('btnRebuildIndex');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Building...'; }
    try {
      const items = await P002Api.listBucket('');
      const folders = items.filter(f => !f.metadata && !f.name.startsWith('.'));
      const modules = [];

      for (const folder of folders) {
        try {
          const data = await P002Api.adminGetFile(folder.name + '/manifest.json');
          const manifest = JSON.parse(data.content);
          const totalMins = (manifest.sections||[]).reduce((a,s) => a+(s.minutes||0), 0);
          modules.push({
            key: manifest.module_key || folder.name,
            module_key: manifest.module_key || folder.name,
            title: manifest.title || folder.name,
            category: manifest.category || 'Other',
            difficulty: manifest.difficulty || 'intermediate',
            section_count: (manifest.sections||[]).length,
            estimated_hours: totalMins > 0 ? parseFloat((totalMins/60).toFixed(1)) : (manifest.estimated_hours||0),
            icon: manifest.icon || null
          });
        } catch(e) {
          modules.push({ key: folder.name, module_key: folder.name, title: folder.name.replace(/module_|_/g,' ').trim(), category:'Other', difficulty:'intermediate', section_count:0, estimated_hours:0, icon:null });
        }
      }

      await P002Api.adminSaveFile('index.json', JSON.stringify({ updated: new Date().toISOString().split('T')[0], modules }, null, 2));
      toast('Index rebuilt — ' + modules.length + ' modules', 'ok');
      document.getElementById('homeIndexMeta').textContent = 'Last rebuilt just now · ' + modules.length + ' modules';
    } catch(e) {
      toast('Rebuild failed: ' + e.message, 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Rebuild Index'; }
  }

  // ── SESSIONS ──────────────────────────────────────────────────
  async function loadSessions() {
    showSessionsView('sessions');
    const list = document.getElementById('sessionList');
    list.innerHTML = '<div class="loading-center">Loading...</div>';
    try {
      const data = await P002Api.adminGetSessions(50);
      list.innerHTML = '';
      if (!data.sessions?.length) {
        list.innerHTML = '<div class="loading-center">No sessions yet</div>';
        return;
      }
      data.sessions.forEach(s => {
        const el = document.createElement('div');
        el.className = 'session-row';
        const colors = ['rgba(255,77,77,0.15)', 'rgba(74,222,128,0.15)', 'rgba(255,159,67,0.15)', 'rgba(100,100,255,0.15)'];
        const textColors = ['#ff4d4d','#4ade80','#ff9f43','#8888ff'];
        const ci = s.id.charCodeAt(0) % 4;
        const initial = (s.user_email || s.user_id || '?').charAt(0).toUpperCase();
        el.innerHTML =
          '<div class="sess-avatar" style="background:' + colors[ci] + ';color:' + textColors[ci] + ';">' + initial + '</div>' +
          '<div class="sess-info">' +
            '<div class="sess-user">' + P002Security.escapeHtml(s.user_email || s.user_id?.slice(0,8) || '—') + '</div>' +
            '<div class="sess-meta">' + P002Security.escapeHtml(s.module || 'Unknown') + ' · Ch.' + (s.section_number||'?') + '</div>' +
          '</div>' +
          '<div class="sess-flag">' + (s.flag_captured ? '🏴' : '—') + '</div>' +
          '<div class="sess-time">' + timeAgo(s.started_at) + '</div>';
        el.onclick = () => viewSession(s);
        list.appendChild(el);
      });
    } catch(e) {
      list.innerHTML = '<div class="loading-center" style="color:var(--accent);">Error: ' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  async function viewSession(session) {
    currentSessionId = session.id;
    document.getElementById('sdTitle').textContent = 'Session · ' + P002Security.escapeHtml(session.module || '') + ' Ch.' + (session.section_number||'?');
    document.getElementById('sessionsListView').style.display = 'none';
    document.getElementById('sessionDetailView').style.display = 'flex';

    const msgs = document.getElementById('sdMessages');
    msgs.innerHTML = '<div class="loading-center">Loading...</div>';
    try {
      const data = await P002Api.adminGetSessionMessages(session.id);
      msgs.innerHTML = '';
      if (!data.messages?.length) { msgs.innerHTML = '<div class="loading-center">No messages</div>'; return; }
      data.messages.forEach(m => {
        const el = document.createElement('div');
        el.className = 'sd-msg ' + m.role;
        el.innerHTML = '<div class="sd-msg-role">' + m.role + '</div>' + P002Security.escapeHtml(m.content);
        msgs.appendChild(el);
      });
      msgs.scrollTop = msgs.scrollHeight;
    } catch(e) {
      msgs.innerHTML = '<div class="loading-center" style="color:var(--accent);">Error: ' + e.message + '</div>';
    }
  }

  function closeSessionDetail() {
    document.getElementById('sessionDetailView').style.display = 'none';
    document.getElementById('sessionsListView').style.display = 'flex';
    currentSessionId = null;
  }

  async function deleteCurrentSession() {
    if (!currentSessionId || !confirm('Delete this session?')) return;
    try {
      await P002Api.adminDeleteSession(currentSessionId);
      toast('Session deleted', 'ok');
      closeSessionDetail();
      loadSessions();
    } catch(e) {
      toast('Delete failed: ' + e.message, 'err');
    }
  }

  function showSessionsView(which) {
    sessionsView = which;
    document.getElementById('toggleSessions').classList.toggle('active', which === 'sessions');
    document.getElementById('toggleUsers').classList.toggle('active', which === 'users');
    document.getElementById('sessionsListView').style.display = which === 'sessions' ? 'flex' : 'none';
    document.getElementById('usersListView').style.display = which === 'users' ? 'flex' : 'none';
    document.getElementById('sessionDetailView').style.display = 'none';
    if (which === 'users') loadUsers();
    if (which === 'sessions') loadSessions();
  }

  async function loadUsers() {
    const list = document.getElementById('userList');
    list.innerHTML = '<div class="loading-center">Loading...</div>';
    try {
      const data = await P002Api.adminGetUsers();
      list.innerHTML = '';
      if (!data.users?.length) { list.innerHTML = '<div class="loading-center">No users</div>'; return; }
      data.users.forEach(u => {
        const el = document.createElement('div');
        el.className = 'user-row';
        const initial = (u.email || '?').charAt(0).toUpperCase();
        const isAdmin = u.id === P002Api.ADMIN_USER_ID;
        el.innerHTML =
          '<div class="user-avatar">' + initial + '</div>' +
          '<div class="user-info">' +
            '<div class="user-email">' + P002Security.escapeHtml(u.email || u.id) + '</div>' +
            '<div class="user-meta">Joined ' + new Date(u.created_at).toLocaleDateString() + (u.last_sign_in_at ? ' · Last seen ' + timeAgo(u.last_sign_in_at) : '') + '</div>' +
          '</div>' +
          (isAdmin ? '<div style="font-family:var(--font-mono);font-size:8px;color:var(--accent);background:var(--accent-dim);border-radius:4px;padding:2px 7px;">YOU</div>' :
            '<button class="user-ban" onclick="P002Admin.banUser(\'' + P002Security.escapeHtml(u.id) + '\')">Ban</button>');
        list.appendChild(el);
      });
    } catch(e) {
      list.innerHTML = '<div class="loading-center" style="color:var(--accent);">Error: ' + e.message + '</div>';
    }
  }

  async function banUser(userId) {
    if (!confirm('Ban this user?')) return;
    try {
      await P002Api.adminBanUser(userId, true);
      toast('User banned', 'ok');
      loadUsers();
    } catch(e) {
      toast('Error: ' + e.message, 'err');
    }
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function formatResponse(text) {
    if (!text) return '';
    let s = P002Security.escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:9px;color:#ffd166;background:#050505;padding:1px 5px;border-radius:3px;">$1</code>')
         .replace(/\n/g, '<br>');
    return s;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs / 24) + 'd';
  }

  function handleCategoryChange() {
    const sel = document.getElementById('genCategory');
    const custom = document.getElementById('genCategoryCustom');
    if (sel.value === '__new__') {
      custom.style.display = 'block';
      custom.focus();
    } else {
      custom.style.display = 'none';
    }
  }

  function cancelCustomCategory() {
    document.getElementById('genCategory').value = 'Other';
    document.getElementById('genCategoryCustom').style.display = 'none';
  }

  function getCategory() {
    const sel = document.getElementById('genCategory');
    if (sel.value === '__new__') {
      return document.getElementById('genCategoryCustom').value.trim() || 'Other';
    }
    return sel.value;
  }

  function closeModal(id) {
    document.getElementById(id).style.display = 'none';
  }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast';
    const colors = {
      ok: { bg: 'var(--surface)', color: 'var(--success)', border: 'rgba(74,222,128,0.3)' },
      err: { bg: 'var(--accent-dim)', color: 'var(--accent)', border: 'rgba(255,77,77,0.3)' },
      warn: { bg: 'var(--orange-dim)', color: 'var(--orange)', border: 'rgba(255,159,67,0.3)' }
    };
    const c = colors[type] || colors.ok;
    el.style.cssText = 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  return {
    init, doLogin, doLogout,
    switchTab,
    // Generate
    handlePdfDrop, handlePdfSelect, startGeneration,
    editGenSection, saveSectionEdit, deployModule, downloadModuleZip, resetGenerate,
    // Files
    loadFiles, openFile, deleteFile, closeBlockEditor, closeRawEditor,
    selectBlock, insertBlockAt, doInsertBlock, deleteBlock, addBlock,
    blockAction, applyDrawerEdit, sendDrawerMessage, closeAiDrawer,
    openSectionChat, closeSectionChat, sendScMessage, scChip, deepenSection,
    saveBlockEditor,
    onRawChange, validateRaw, formatRaw, handleRawKey, saveRaw,
    showUploadZipModal, handleZipUpload,
    rebuildIndex,
    // Sessions
    loadSessions, viewSession, closeSessionDetail, deleteCurrentSession,
    showSessionsView, loadUsers, banUser,
    handleCategoryChange, cancelCustomCategory, getCategory,
    closeModal,
  };

})();

window.addEventListener('load', P002Admin.init);
