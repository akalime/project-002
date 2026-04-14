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
      if (session && await P002Api.isAdmin()) {
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
      if (!(await P002Api.isAdmin())) throw new Error('Not authorized as admin');
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
    if (name === 'files') loadModuleEditor();
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
    // Leave key blank — user fills it in manually
    // (auto-fill from full PDF title creates overly long keys)
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
        document.getElementById('genTimeEst').textContent = remaining > 0 ? '~' + remaining + 's remaining · using ' + (document.getElementById('genModel')?.value || 'sonnet') : 'Almost done...';
      } catch(e) {
        logGen('err', '✗ Section ' + (i+1) + ' failed: ' + e.message);
      }
      // Rate limit buffer — 3000ms between calls
      await new Promise(r => setTimeout(r, 3000));
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
    const systemPrompt = `You are a curriculum developer. Convert source material into an educational reader section in JSON format.

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
  "challenge": null,
  "knowledge_check": {
    "source": "extracted or generated",
    "questions": [
      {
        "type": "mc",
        "question": "...",
        "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
        "answer": "A",
        "explanation": "1-2 sentences explaining why"
      },
      {
        "type": "tf",
        "question": "True or false: ...",
        "answer": true,
        "explanation": "1-2 sentences explaining why"
      },
      {
        "type": "sa",
        "question": "...",
        "sample_answer": "2-3 sentence model answer for AI grading",
        "key_points": ["point1", "point2", "point3"]
      }
    ]
  },
  "ai_context": "2-3 sentence summary of what this section covers for the AI tutor"
}

STRICT RULES — you MUST follow these:
- Write exactly 6-8 content blocks, no more
- Each body block: 1-2 sentences only
- Pick the 3-4 most important concepts, ignore everything else
- challenge must always be null
- For knowledge_check: generate exactly 5 questions. Mix mc, tf, sa types.
- If the source material contains review questions, extract up to 5 of them and set source to "extracted". Otherwise generate and set source to "generated".
- Every question MUST relate directly to content in this section only
- Each explanation: 1 sentence max
- Your ENTIRE JSON response must be under 1800 tokens`;

    const userMsg = `Convert this chapter into a reader section. Chapter title: "${chapter.title}"\n\nContent:\n${chapter.text}`;

    // Use direct fetch with correct headers — needs max_tokens: 4096 for full JSON output
    // Force token refresh before each API call
    const { data: { session: freshSession } } = await P002Api.getClient().auth.getSession();
    const genSession = freshSession || await P002Api.getSession();
    const genResponse = await fetch(P002Api.SUPABASE_URL + '/functions/v1/claude-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + genSession.access_token,
        'apikey': P002Api.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
        model: (document.getElementById('genModel')?.value || 'haiku'),
        max_tokens: 1800,
      })
    });
    if (!genResponse.ok) throw new Error('API error: ' + genResponse.status);
    const genData = await genResponse.json();
    if (genData.error) throw new Error(genData.error);
    const rawText = genData.content?.[0]?.text || '';

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
      const isShort = blocks < 6;
      const qCount = s.knowledge_check?.questions?.length || 0;
      const qSource = s.knowledge_check?.source || '';
      const row = document.createElement('div');
      row.className = 'section-row' + (isShort ? ' warn' : '');
      row.innerHTML =
        '<div class="sr-num">' + String(i+1).padStart(2,'0') + '</div>' +
        '<div class="sr-info">' +
          '<div class="sr-title">' + P002Security.escapeHtml(s.meta?.title || 'Section ' + (i+1)) + '</div>' +
          '<div class="sr-meta">' + (s.meta?.minutes||'?') + ' min · ' + blocks + ' blocks' +
          (qCount > 0 ? ' · ' + qCount + 'Q' + (qSource === 'extracted' ? ' 📖' : ' ✦') : ' · no Qs') +
          (isShort ? ' — short?' : '') + '</div>' +
        '</div>' +
        '<div class="sr-badge ' + (isShort ? 'warn' : qCount >= 5 ? 'ok' : 'warn') + '">' + (isShort ? '⚠' : qCount >= 5 ? '✓' : '⚠') + '</div>' +
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

  // ── MODULE EDITOR ─────────────────────────────────────────────
  // State
  let meView = 'list';          // 'list' | 'module' | 'section' | 'edit-meta'
  let meCurrentModule = null;   // { folderName, manifest }
  let meCurrentSection = null;  // { file, idx }
  let meBlockTab = 'blocks';    // 'blocks' | 'questions' | 'chat' | 'raw'
  let meChatHistory = [];

  // ── MODULE LIST ────────────────────────────────────────────────
  async function loadModuleEditor() {
    showMeView('list');
    const list = document.getElementById('meModuleList');
    list.innerHTML = '<div class="loading-center">Loading...</div>';
    try {
      const items = await P002Api.listBucket('');
      const folders = items.filter(f => !f.metadata && !f.name.startsWith('.') && f.name.startsWith('module_') && f.name.length <= 60);

      list.innerHTML = '';
      if (!folders.length) {
        list.innerHTML = '<div class="loading-center">No modules yet — use Generate to create one.</div>';
        return;
      }

      // Group by category — need manifests
      const modules = [];
      for (const folder of folders) {
        try {
          const data = await P002Api.adminGetFile(folder.name + '/manifest.json');
          const manifest = JSON.parse(data.content);
          modules.push({ folderName: folder.name, manifest });
        } catch(e) {
          modules.push({ folderName: folder.name, manifest: {
            title: folder.name.replace(/module_|_/g, ' ').trim(),
            category: 'Other', difficulty: 'beginner',
            section_count: 0, estimated_hours: 0, icon: '📚',
            sections: [], module_key: folder.name
          }});
        }
      }

      // Group by category
      const cats = {};
      modules.forEach(m => {
        const cat = m.manifest.category || 'Other';
        if (!cats[cat]) cats[cat] = [];
        cats[cat].push(m);
      });

      Object.entries(cats).forEach(([cat, mods]) => {
        const catLabel = document.createElement('div');
        catLabel.className = 'me-cat-label';
        catLabel.textContent = cat;
        list.appendChild(catLabel);
        mods.forEach(m => list.appendChild(buildModuleCard(m)));
      });
    } catch(e) {
      list.innerHTML = '<div class="loading-center" style="color:var(--accent);">Error: ' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  function buildModuleCard(m) {
    const el = document.createElement('div');
    el.className = 'me-module-card';
    const diff = m.manifest.difficulty || 'beginner';
    const diffColors = { beginner: 'var(--success)', intermediate: 'var(--warn)', advanced: 'var(--accent)' };
    el.innerHTML =
      '<div class="me-card-icon">' + (m.manifest.icon || '📚') + '</div>' +
      '<div class="me-card-info">' +
        '<div class="me-card-diff" style="color:' + (diffColors[diff] || 'var(--warn)') + ';">' + diff + '</div>' +
        '<div class="me-card-title">' + P002Security.escapeHtml(m.manifest.title || m.folderName) + '</div>' +
        '<div class="me-card-meta">' + (m.manifest.sections?.length || 0) + ' sections · ' + (m.manifest.estimated_hours || 0) + 'h</div>' +
      '</div>' +
      '<div class="me-card-arrow">›</div>';
    el.onclick = () => openModuleDetail(m);
    return el;
  }

  // ── MODULE DETAIL ──────────────────────────────────────────────
  async function openModuleDetail(m) {
    meCurrentModule = m;
    showMeView('module');

    const manifest = m.manifest;
    document.getElementById('meModuleIcon').textContent = manifest.icon || '📚';
    document.getElementById('meModuleCat').textContent = (manifest.category || 'Other').toUpperCase();
    document.getElementById('meModuleTitle').textContent = manifest.title || m.folderName;
    document.getElementById('meModuleSections').textContent = manifest.sections?.length || 0;
    document.getElementById('meModuleHours').textContent = (manifest.estimated_hours || 0) + 'h';
    document.getElementById('meModuleFlags').textContent = (manifest.sections || []).filter(s => s.has_flag).length;

    renderSectionList();
  }

  function renderSectionList() {
    const list = document.getElementById('meSectionList');
    list.innerHTML = '';
    const sections = meCurrentModule.manifest.sections || [];
    if (!sections.length) {
      list.innerHTML = '<div class="loading-center">No sections yet.</div>';
      return;
    }
    sections.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'me-section-row';
      const qCount = 0; // would need to load section to know
      row.innerHTML =
        '<div class="me-sec-num">' + String(i+1).padStart(2,'0') + '</div>' +
        '<div class="me-sec-info">' +
          '<div class="me-sec-title">' + P002Security.escapeHtml(s.title || s.file) + '</div>' +
          '<div class="me-sec-meta">' + (s.minutes || '?') + ' min · ' + (s.difficulty || '') + '</div>' +
        '</div>' +
        '<div class="me-sec-badges">' +
          '<div class="me-sec-badge ' + (s.has_flag ? 'flag' : '') + '">' + (s.has_flag ? '🏴' : '') + '</div>' +
        '</div>' +
        '<div class="me-sec-arrow">›</div>';
      row.onclick = () => openSectionEditor(s, i);
      list.appendChild(row);
    });
  }

  async function openSectionEditor(sectionMeta, idx) {
    meCurrentSection = { ...sectionMeta, idx };
    showMeView('section');
    meBlockTab = 'blocks';
    document.getElementById('meSectionFilename').textContent = meCurrentModule.folderName + '/' + sectionMeta.file;
    document.getElementById('meSectionTitle').textContent = sectionMeta.title || sectionMeta.file;
    document.getElementById('meSectionUnsaved').style.display = 'none';
    selectedBlockIdx = null;
    blockSections = null;
    blockDirty = false;

    switchBlockTab('blocks');

    // Load section JSON
    const path = meCurrentModule.folderName + '/' + sectionMeta.file;
    try {
      const data = await P002Api.adminGetFile(path);
      const parsed = JSON.parse(data.content);
      blockSections = parsed;
      openFilePath = path;
      renderMeBlocks();
    } catch(e) {
      toast('Failed to load section: ' + e.message, 'err');
    }
  }

  function switchBlockTab(tab) {
    meBlockTab = tab;
    document.querySelectorAll('.me-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('meTabBlocks').style.display = tab === 'blocks' ? 'flex' : 'none';
    document.getElementById('meTabQuestions').style.display = tab === 'questions' ? 'flex' : 'none';
    document.getElementById('meTabChat').style.display = tab === 'chat' ? 'flex' : 'none';
    document.getElementById('meTabRaw').style.display = tab === 'raw' ? 'flex' : 'none';

    if (tab === 'questions' && blockSections) renderMeQuestions();
    if (tab === 'raw' && blockSections) {
      document.getElementById('meRawTextarea').value = JSON.stringify(blockSections, null, 2);
      updateMeRawStatus();
    }
  }

  // ── BLOCKS TAB ────────────────────────────────────────────────
  function renderMeBlocks() {
    const container = document.getElementById('meBlockList');
    container.innerHTML = '';
    if (!blockSections?.content) return;

    container.appendChild(buildMeInsertZone(0));
    blockSections.content.forEach((block, i) => {
      container.appendChild(buildMeBlockEl(block, i));
      container.appendChild(buildMeInsertZone(i + 1));
    });
  }

  function buildMeInsertZone(afterIdx) {
    const el = document.createElement('div');
    el.className = 'block-insert';
    el.innerHTML = '<div class="block-insert-line"></div><button class="block-insert-btn" onclick="P002Admin.meInsertBlockAt(' + afterIdx + ')">+ insert</button><div class="block-insert-line"></div>';
    return el;
  }

  function buildMeBlockEl(block, idx) {
    const el = document.createElement('div');
    const isSelected = idx === selectedBlockIdx;
    el.className = 'me-block' + (isSelected ? ' selected' : '') + (block.type === 'callout' ? ' callout' : '') + (block.type === 'heading' ? ' heading' : '');
    el.dataset.idx = idx;

    const preview = block.text ? block.text.slice(0, 100) + (block.text.length > 100 ? '...' : '') : '';
    el.innerHTML =
      '<div class="me-block-type">' + (block.type + (block.lang ? ' · ' + block.lang : '')) + (isSelected ? ' <span>● selected</span>' : '') + '<span class="me-block-drag">⠿</span></div>' +
      '<div class="me-block-preview">' + P002Security.escapeHtml(preview) + '</div>';

    el.onclick = () => selectMeBlock(idx);

    el.draggable = true;
    el.addEventListener('dragstart', e => { dragSrcIdx = idx; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (dragSrcIdx !== null && dragSrcIdx !== idx) {
        const [moved] = blockSections.content.splice(dragSrcIdx, 1);
        blockSections.content.splice(idx, 0, moved);
        markMeDirty();
        renderMeBlocks();
      }
    });

    return el;
  }

  function selectMeBlock(idx) {
    selectedBlockIdx = selectedBlockIdx === idx ? null : idx;
    renderMeBlocks();
    // Show/hide tray
    const tray = document.getElementById('meBlockTray');
    tray.style.display = selectedBlockIdx !== null ? 'flex' : 'none';
    if (selectedBlockIdx !== null) {
      setTimeout(() => {
        const selected = document.querySelector('.me-block.selected');
        if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  function meInsertBlockAt(idx) {
    document.querySelectorAll('.block-type-picker').forEach(p => p.remove());
    const zones = document.getElementById('meBlockList').querySelectorAll('.block-insert');
    const zone = zones[idx];
    if (!zone) return;
    const picker = document.createElement('div');
    picker.className = 'block-type-picker';
    picker.style.cssText = 'position:relative;bottom:auto;left:auto;transform:none;display:flex;';
    picker.innerHTML = [
      '<button class="btp-btn" onclick="P002Admin.meDoInsertBlock(' + idx + ',&quot;heading&quot;)">Heading</button>',
      '<button class="btp-btn" onclick="P002Admin.meDoInsertBlock(' + idx + ',&quot;body&quot;)">Body</button>',
      '<button class="btp-btn" onclick="P002Admin.meDoInsertBlock(' + idx + ',&quot;code&quot;)">Code</button>',
      '<button class="btp-btn" onclick="P002Admin.meDoInsertBlock(' + idx + ',&quot;callout&quot;)">Callout</button>',
      '<button class="btp-btn" onclick="this.closest(\".block-type-picker\").remove()">✕</button>'
    ].join('');
    zone.appendChild(picker);
  }

  function meDoInsertBlock(idx, type) {
    document.querySelectorAll('.block-type-picker').forEach(p => p.remove());
    const newBlock = { type, text: type === 'heading' ? 'New Heading' : type === 'code' ? '// code here' : 'New ' + type + ' block.' };
    if (type === 'code') newBlock.lang = 'text';
    blockSections.content.splice(idx, 0, newBlock);
    selectedBlockIdx = idx;
    markMeDirty();
    renderMeBlocks();
  }

  function meDeleteBlock() {
    if (selectedBlockIdx === null) return;
    if (!confirm('Delete this block?')) return;
    blockSections.content.splice(selectedBlockIdx, 1);
    selectedBlockIdx = null;
    document.getElementById('meBlockTray').style.display = 'none';
    markMeDirty();
    renderMeBlocks();
  }

  async function meBlockAction(action) {
    if (selectedBlockIdx === null || !blockSections) return;
    const block = blockSections.content[selectedBlockIdx];
    const labels = { expand: 'Expand', rework: 'Rework', example: 'Example', split: 'Split' };
    const prompts = {
      expand: 'Expand this content block with more depth. Return only the new text.',
      rework: 'Rework this block — different explanation, same concept. Return only the new text.',
      example: 'Add a concrete real-world example. Return only the example text.',
      split: 'Split into two shorter blocks. Return JSON array: [{"type":"body","text":"..."},{"type":"body","text":"..."}]'
    };

    // Show AI panel
    document.getElementById('meAiPanel').style.display = 'flex';
    document.getElementById('meAiMode').textContent = labels[action];
    document.getElementById('meAiResponse').textContent = '···';
    document.getElementById('meAiApplyBtn').style.display = 'none';
    drawerPendingText = null;

    const sp = 'You are a curriculum editor. Edit content blocks for an educational reader. Section: "' + (blockSections?.meta?.title || '') + '". Be concise and educational.';
    const msg = prompts[action] + '\n\nBlock: "' + block.text + '"';

    try {
      const reply = await P002Api.callClaude(sp, [{ role: 'user', content: msg }], null, 'haiku');
      document.getElementById('meAiResponse').innerHTML = formatResponse(reply);
      document.getElementById('meAiApplyBtn').style.display = 'block';
      drawerPendingText = reply;
      drawerHistory = [{ role: 'user', content: msg }, { role: 'assistant', content: reply }];
    } catch(e) {
      document.getElementById('meAiResponse').textContent = 'Error: ' + e.message;
    }
  }

  async function meAiSend() {
    const input = document.getElementById('meAiInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    drawerHistory.push({ role: 'user', content: text });
    document.getElementById('meAiResponse').textContent = '···';
    const sp = 'You are a curriculum editor. Section: "' + (blockSections?.meta?.title || '') + '".';
    try {
      const reply = await P002Api.callClaude(sp, drawerHistory.slice(-4), null, 'haiku');
      document.getElementById('meAiResponse').innerHTML += '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">' + formatResponse(reply) + '</div>';
      drawerPendingText = reply;
      drawerHistory.push({ role: 'assistant', content: reply });
      document.getElementById('meAiApplyBtn').style.display = 'block';
    } catch(e) {
      document.getElementById('meAiResponse').textContent = 'Error: ' + e.message;
    }
  }

  function meAiApply() {
    if (selectedBlockIdx === null || !drawerPendingText) return;
    try {
      const parsed = JSON.parse(drawerPendingText.trim());
      if (Array.isArray(parsed)) {
        blockSections.content.splice(selectedBlockIdx, 1, ...parsed);
        toast('Split into ' + parsed.length + ' blocks', 'ok');
        selectedBlockIdx = null;
        document.getElementById('meBlockTray').style.display = 'none';
        document.getElementById('meAiPanel').style.display = 'none';
        markMeDirty();
        renderMeBlocks();
        return;
      }
    } catch(e) {}
    blockSections.content[selectedBlockIdx].text = drawerPendingText;
    markMeDirty();
    document.getElementById('meAiPanel').style.display = 'none';
    renderMeBlocks();
    toast('Block updated', 'ok');
    drawerPendingText = null;
  }

  // ── QUESTIONS TAB ─────────────────────────────────────────────
  function renderMeQuestions() {
    const list = document.getElementById('meQuestionList');
    list.innerHTML = '';
    const qs = blockSections?.knowledge_check?.questions || [];
    const source = blockSections?.knowledge_check?.source || 'generated';

    document.getElementById('meQMeta').textContent = qs.length + ' questions · ' + source;

    if (!qs.length) {
      list.innerHTML = '<div class="loading-center">No questions — tap Regenerate below.</div>';
      return;
    }

    qs.forEach((q, i) => {
      const row = document.createElement('div');
      row.className = 'me-q-row';
      const typeColors = { mc: '#6495ed', tf: '#4ade80', sa: '#ff9f43' };
      const typeLabels = { mc: 'MC', tf: 'T/F', sa: 'SA' };
      row.innerHTML =
        '<div class="me-q-badge" style="color:' + (typeColors[q.type] || '#666') + ';border-color:' + (typeColors[q.type] || '#666') + '33;">' + (typeLabels[q.type] || q.type) + '</div>' +
        '<div class="me-q-info">' +
          '<div class="me-q-num">Q' + (i+1) + '</div>' +
          '<div class="me-q-text">' + P002Security.escapeHtml(q.question) + '</div>' +
        '</div>' +
        '<div class="me-q-arrow">›</div>';
      row.onclick = () => openQuestionEdit(i);
      list.appendChild(row);
    });
  }

  function openQuestionEdit(idx) {
    const q = blockSections.knowledge_check.questions[idx];
    document.getElementById('meQEditIdx').value = idx;
    document.getElementById('meQEditTextarea').value = JSON.stringify(q, null, 2);
    document.getElementById('meQEditModal').style.display = 'flex';
  }

  function saveQuestionEdit() {
    const idx = parseInt(document.getElementById('meQEditIdx').value);
    try {
      const parsed = JSON.parse(document.getElementById('meQEditTextarea').value);
      blockSections.knowledge_check.questions[idx] = parsed;
      closeModal('meQEditModal');
      markMeDirty();
      renderMeQuestions();
      toast('Question updated', 'ok');
    } catch(e) {
      toast('Invalid JSON: ' + e.message, 'err');
    }
  }

  async function regenerateQuestions() {
    if (!blockSections) return;
    toast('Regenerating questions...', 'ok');
    const sp = 'You are a curriculum developer. Generate knowledge check questions for this section. Return JSON only: {"source":"generated","questions":[...]}. Each question: {type:"mc"|"tf"|"sa", question:"...", options(mc only):["A. ...","B. ...","C. ...","D. ..."], answer:"A"|true|false, explanation:"...", sample_answer(sa only):"...", key_points(sa only):[...]}. Generate 5 questions mixing all types. 1 sentence explanations only.';
    const msg = 'Section: "' + blockSections.meta?.title + '"\n\n' + (blockSections.content || []).map(b => b.text || '').join(' ').slice(0, 2000);
    try {
      const reply = await P002Api.callClaude(sp, [{ role: 'user', content: msg }], null, 'haiku');
      const clean = reply.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(clean);
      blockSections.knowledge_check = parsed;
      markMeDirty();
      renderMeQuestions();
      toast('Questions regenerated', 'ok');
    } catch(e) {
      toast('Failed: ' + e.message, 'err');
    }
  }

  // ── SECTION CHAT TAB ─────────────────────────────────────────
  async function meChatSend() {
    const input = document.getElementById('meChatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    meChatHistory.push({ role: 'user', content: text });
    addMeChatMsg('user', text);
    const sp = 'You are a curriculum editor. Section: "' + (blockSections?.meta?.title || '') + '". ' + (blockSections?.ai_context || '') + ' Be concise and actionable.';
    const typingEl = addMeChatMsg('ai', '···');
    try {
      const reply = await P002Api.callClaude(sp, meChatHistory.slice(-4), null, 'haiku');
      typingEl.innerHTML = formatResponse(reply);
      meChatHistory.push({ role: 'assistant', content: reply });
    } catch(e) {
      typingEl.textContent = 'Error: ' + e.message;
    }
  }

  function addMeChatMsg(role, text) {
    const msgs = document.getElementById('meChatMsgs');
    const div = document.createElement('div');
    div.className = 'sc-' + (role === 'ai' ? 'ai' : 'user');
    div.innerHTML = formatResponse(text);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  // ── RAW TAB ──────────────────────────────────────────────────
  function updateMeRawStatus() {
    const text = document.getElementById('meRawTextarea').value;
    document.getElementById('meRawLines').textContent = text.split('\n').length + ' lines';
    document.getElementById('meRawSize').textContent = (new Blob([text]).size / 1024).toFixed(1) + ' KB';
  }

  function onMeRawChange() {
    blockDirty = true;
    updateMeRawStatus();
    document.getElementById('meSectionUnsaved').style.display = 'block';
  }

  function formatMeRaw() {
    const ta = document.getElementById('meRawTextarea');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      updateMeRawStatus();
      toast('Formatted', 'ok');
    } catch(e) { toast('Invalid JSON', 'err'); }
  }

  function validateMeRaw() {
    const text = document.getElementById('meRawTextarea').value;
    try {
      JSON.parse(text);
      toast('✓ Valid JSON', 'ok');
    } catch(e) {
      toast('✗ ' + e.message, 'err');
    }
  }

  // ── SAVE ─────────────────────────────────────────────────────
  async function saveSectionEditor() {
    if (!openFilePath || !blockSections) return;

    // If on raw tab, sync raw textarea back to blockSections
    if (meBlockTab === 'raw') {
      try {
        blockSections = JSON.parse(document.getElementById('meRawTextarea').value);
      } catch(e) {
        toast('Invalid JSON in raw editor', 'err');
        return;
      }
    }

    const btn = document.getElementById('meSaveBtn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
      await P002Api.adminSaveFile(openFilePath, JSON.stringify(blockSections, null, 2));
      blockDirty = false;
      document.getElementById('meSectionUnsaved').style.display = 'none';
      toast('Saved', 'ok');
    } catch(e) {
      toast('Save failed: ' + e.message, 'err');
    }
    btn.textContent = '✓ Save';
    btn.disabled = false;
  }

  function markMeDirty() {
    blockDirty = true;
    document.getElementById('meSectionUnsaved').style.display = 'block';
  }

  // ── EDIT MODULE METADATA ──────────────────────────────────────
  function openEditModuleMeta() {
    if (!meCurrentModule) return;
    const manifest = meCurrentModule.manifest;
    document.getElementById('meEditTitle').value = manifest.title || '';
    document.getElementById('meEditCategory').value = manifest.category || '';
    document.getElementById('meEditDifficulty').value = manifest.difficulty || 'beginner';

    // Icon picker
    const icons = ['🔒','💻','🛡','⚡','🌐','🔧','📡','💾','🔍','🏴','📚','💉','🧩','⚙️','🖥'];
    const picker = document.getElementById('meEditIconPicker');
    picker.innerHTML = '';
    icons.forEach(icon => {
      const btn = document.createElement('button');
      btn.className = 'me-icon-opt' + (icon === (manifest.icon || '📚') ? ' selected' : '');
      btn.textContent = icon;
      btn.onclick = () => { document.querySelectorAll('.me-icon-opt').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); };
      picker.appendChild(btn);
    });

    document.getElementById('meEditKey').textContent = manifest.module_key || meCurrentModule.folderName;
    showMeView('edit-meta');
  }

  async function saveModuleMeta() {
    if (!meCurrentModule) return;
    const manifest = meCurrentModule.manifest;
    manifest.title = document.getElementById('meEditTitle').value.trim();
    manifest.category = document.getElementById('meEditCategory').value.trim();
    manifest.difficulty = document.getElementById('meEditDifficulty').value;
    const selectedIcon = document.querySelector('.me-icon-opt.selected');
    if (selectedIcon) manifest.icon = selectedIcon.textContent;

    try {
      await P002Api.adminSaveFile(meCurrentModule.folderName + '/manifest.json', JSON.stringify(manifest, null, 2));
      toast('Module updated', 'ok');
      showMeView('module');
      document.getElementById('meModuleTitle').textContent = manifest.title;
      document.getElementById('meModuleIcon').textContent = manifest.icon || '📚';
      document.getElementById('meModuleCat').textContent = (manifest.category || '').toUpperCase();
    } catch(e) {
      toast('Save failed: ' + e.message, 'err');
    }
  }

  async function deleteCurrentModule() {
    if (!meCurrentModule) return;
    if (!confirm('Delete "' + meCurrentModule.manifest.title + '" and all its files? Cannot be undone.')) return;
    await deleteFolder(meCurrentModule.folderName);
    showMeView('list');
    loadModuleEditor();
  }

  // ── ZIP IMPORT ────────────────────────────────────────────────
  function showModuleZipImport() {
    document.getElementById('meZipModal').style.display = 'flex';
    document.getElementById('meZipOutput').style.display = 'none';
  }

  async function handleModuleZipImport() {
    const fileInput = document.getElementById('meZipFileInput');
    const file = fileInput.files[0];
    if (!file) { toast('Select a ZIP first', 'err'); return; }

    const output = document.getElementById('meZipOutput');
    const btn = document.getElementById('meBtnUploadZip');
    output.style.display = 'block';
    output.innerHTML = '<span style="color:var(--orange);">Processing...</span>';
    btn.disabled = true;

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
      html += '\n<span style="color:var(--text-muted);">Done: ' + ok + ' uploaded, ' + fail + ' failed</span>';
      output.innerHTML = html;
      if (ok > 0) { toast(ok + ' files imported', 'ok'); loadModuleEditor(); }
    } catch(e) {
      output.innerHTML = '<span style="color:var(--accent);">Error: ' + P002Security.escapeHtml(e.message) + '</span>';
    } finally {
      btn.disabled = false; btn.textContent = '▶ Import';
      fileInput.value = '';
    }
  }

  // ── VIEW MANAGEMENT ───────────────────────────────────────────
  function showMeView(view) {
    meView = view;
    document.getElementById('meViewList').style.display = view === 'list' ? 'flex' : 'none';
    document.getElementById('meViewModule').style.display = view === 'module' ? 'flex' : 'none';
    document.getElementById('meViewSection').style.display = view === 'section' ? 'flex' : 'none';
    document.getElementById('meViewEditMeta').style.display = view === 'edit-meta' ? 'flex' : 'none';
  }

  function meBackToList() {
    if (blockDirty && !confirm('Discard unsaved changes?')) return;
    blockDirty = false;
    blockSections = null;
    showMeView('list');
    loadModuleEditor();
  }

  function meBackToModule() {
    if (blockDirty && !confirm('Discard unsaved changes?')) return;
    blockDirty = false;
    blockSections = null;
    selectedBlockIdx = null;
    document.getElementById('meBlockTray').style.display = 'none';
    document.getElementById('meAiPanel').style.display = 'none';
    showMeView('module');
  }

  function meBackToModuleFromEdit() {
    showMeView('module');
  }

  // ── MODULE EDITOR ─────────────────────────────────────────────
  async function deleteFolder(folderName) {
    try {
      toast('Deleting files...', 'ok');
      const files = await P002Api.listBucket(folderName);
      if (!files.length) { toast('Folder empty or already deleted', 'warn'); return; }
      let deleted = 0; let failed = 0;
      for (const f of files) {
        const path = folderName + '/' + f.name;
        try {
          await P002Api.adminRequest('delete_bucket_file', { path });
          deleted++;
        } catch(e) {
          try { await P002Api.deleteFile(path); deleted++; } catch(e2) { failed++; }
        }
      }
      toast('Deleted ' + deleted + ' files' + (failed ? ', ' + failed + ' failed' : ''), failed ? 'warn' : 'ok');
    } catch(e) {
      toast('Delete failed: ' + e.message, 'err');
    }
  }

  // ── REBUILD INDEX ─────────────────────────────────────────────
  async function rebuildIndex() {
    toast('Rebuilding index...', 'ok');
    const btn = document.getElementById('btnRebuildIndex');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Building...'; }
    try {
      const items = await P002Api.listBucket('');
      const folders = items.filter(f => !f.metadata && !f.name.startsWith('.') && f.name.startsWith('module_'));
      const modules = [];

      for (const folder of folders) {
        // Skip folders with overly long names (bad auto-generated keys)
        if (folder.name.length > 60) {
          console.warn('Skipping long folder name:', folder.name);
          continue;
        }
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
      const metaEl = document.getElementById('homeIndexMeta');
      if (metaEl) metaEl.textContent = 'Last rebuilt just now · ' + modules.length + ' modules';
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
        // Mark the currently-logged-in admin so we don't offer a Ban button
        // against themselves. ADMIN_USER_ID was removed from the client API
        // deliberately — there is no list of admin UIDs exposed to the browser.
        const isAdmin = currentUser && u.id === currentUser.id;
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
    s = s
      .replace(/^### (.+)$/gm, '<strong style="font-size:10px;color:#ccc;display:block;margin:6px 0 2px;">$1</strong>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:11px;color:#ddd;display:block;margin:8px 0 3px;">$1</strong>')
      .replace(/^# (.+)$/gm, '<strong style="font-size:12px;color:#eee;display:block;margin:10px 0 4px;">$1</strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
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
    // Module editor
    loadModuleEditor, meBackToList, meBackToModule, meBackToModuleFromEdit,
    openModuleDetail, openSectionEditor, switchBlockTab,
    selectMeBlock, meInsertBlockAt, meDoInsertBlock, meDeleteBlock, meBlockAction, meAiApply, meAiSend,
    renderMeQuestions, openQuestionEdit, saveQuestionEdit, regenerateQuestions,
    meChatSend,
    onMeRawChange, validateMeRaw, formatMeRaw, updateMeRawStatus,
    saveSectionEditor,
    openEditModuleMeta, saveModuleMeta, deleteCurrentModule,
    showModuleZipImport, handleModuleZipImport,
    deleteFolder,
    rebuildIndex,
    // Sessions
    loadSessions, viewSession, closeSessionDetail, deleteCurrentSession,
    showSessionsView, loadUsers, banUser,
    handleCategoryChange, cancelCustomCategory, getCategory,
    closeModal,
  };

})();

window.addEventListener('load', P002Admin.init);
