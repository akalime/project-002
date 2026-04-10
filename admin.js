// ================================================================
// PROJECT 002 -- admin.js
// Admin panel logic for admin.html
// Depends on: security.js, api.js
// ================================================================

const P002Admin = (() => {

  // ==================== STATE ====================
  let currentUser = null;
  let currentFile = null;
  let editorDirty = false;
  let currentSession = null;
  let currentTest = 'lesson';
  let currentRule = 'system_prompt';

  // ==================== INIT ====================
  async function init() {
    try {
      const session = await P002Api.getSession();
      if (session && P002Api.isAdmin(session.user)) {
        currentUser = session.user;
        showApp();
      }
    } catch(e) {
      console.error('Init error:', e);
    }
  }

  function showApp() {
    document.getElementById('authScreen').style.display = 'none';
    const app = document.getElementById('appShell');
    app.style.display = 'flex';
    app.style.flex = '1';
    app.style.minHeight = '0';
    switchPanel('lessons');
  }

  // ==================== AUTH ====================
  async function doLogin() {
    const email = P002Security.sanitizeInput(document.getElementById('authEmail').value.trim());
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authBtn');
    const err = document.getElementById('authError');

    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Authenticating...';

    try {
      const user = await P002Api.signIn(email, password);
      if (!P002Api.isAdmin(user)) throw new Error('Not authorized as admin');
      currentUser = user;
      showApp();
    } catch(e) {
      err.textContent = e.message;
      err.style.display = 'block';
    }

    btn.disabled = false;
    btn.textContent = 'Access Admin';
  }

  async function doLogout() {
    await P002Api.signOut();
    location.reload();
  }

  // ==================== PANEL SWITCHING ====================
  function switchPanel(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.topbar-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-bottom-nav-btn').forEach(b => b.classList.remove('active'));
    const panelId = 'panel' + name.charAt(0).toUpperCase() + name.slice(1);
    const navId = 'nav' + name.charAt(0).toUpperCase() + name.slice(1);
    const mnavId = 'mnav' + name.charAt(0).toUpperCase() + name.slice(1);
    document.getElementById(panelId)?.classList.add('active');
    document.getElementById(navId)?.classList.add('active');
    document.getElementById(mnavId)?.classList.add('active');
    closeSidebar();

    switch(name) {
      case 'lessons': loadFiles(); break;
      case 'sessions': loadSessions(); break;
      case 'users': loadUsers(); break;
      case 'stats': loadStats(); break;
      case 'rules': loadRule(currentRule, null); break;
    }
  }

  // ==================== MOBILE SIDEBAR ====================
  function toggleSidebar() {
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel) return;
    const sidebar = activePanel.querySelector('.file-browser, .sessions-list, .test-sidebar, .rules-sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    } else {
      sidebar.classList.add('open');
      overlay.classList.add('open');
    }
  }

  function closeSidebar() {
    document.querySelectorAll('.file-browser, .sessions-list, .test-sidebar, .rules-sidebar')
      .forEach(s => s.classList.remove('open'));
    document.getElementById('mobileOverlay')?.classList.remove('open');
  }

  // ==================== FILE BROWSER ====================
  async function loadFiles() {
    const tree = document.getElementById('fileTree');
    tree.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const data = await P002Api.listBucket('');
      tree.innerHTML = '';

      const folders = data.filter(f => !f.metadata);
      for (const folder of folders) {
        const folderEl = await buildFolderEl(folder.name);
        tree.appendChild(folderEl);
      }

      const rootFiles = data.filter(f => f.metadata);
      rootFiles.forEach(f => tree.appendChild(buildFileEl(f, '')));

    } catch(e) {
      tree.innerHTML = `<div style="padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--danger);">Error: ${P002Security.escapeHtml(e.message)}</div>`;
    }
  }

  async function buildFolderEl(folderName) {
    const folder = document.createElement('div');
    folder.className = 'fb-folder';

    const nameEl = document.createElement('div');
    nameEl.className = 'fb-folder-name open';
    nameEl.innerHTML = `<span class="fb-arrow">▶</span> 📁 ${P002Security.escapeHtml(folderName)}`;

    const filesEl = document.createElement('div');
    filesEl.className = 'fb-files';

    nameEl.onclick = () => {
      nameEl.classList.toggle('open');
      filesEl.style.display = nameEl.classList.contains('open') ? 'block' : 'none';
    };

    folder.appendChild(nameEl);
    folder.appendChild(filesEl);

    try {
      const data = await P002Api.listBucket(folderName);
      data.forEach(f => filesEl.appendChild(buildFileEl(f, folderName)));
    } catch(e) {}

    return folder;
  }

  function buildFileEl(file, folder) {
    const path = folder ? `${folder}/${file.name}` : file.name;
    const el = document.createElement('div');
    el.className = 'fb-file';
    el.dataset.path = path;

    const isJson = file.name.endsWith('.json');
    el.innerHTML = `
      <span class="fb-file-icon">${isJson ? '{ }' : '📄'}</span>
      <span style="flex:1">${P002Security.escapeHtml(file.name)}</span>
      <div class="fb-file-actions">
        <span class="fb-file-action" onclick="event.stopPropagation();P002Admin.deleteFile('${P002Security.escapeHtml(path)}')">✕</span>
      </div>`;

    el.onclick = () => { openFile(path, el); closeSidebar(); };
    return el;
  }

  async function openFile(path, el) {
    if (editorDirty && !confirm('Discard unsaved changes?')) return;

    // Validate path
    const safePath = P002Security.sanitizePath(path);
    if (!safePath) { toast('Invalid file path', 'err'); return; }

    document.querySelectorAll('.fb-file').forEach(f => f.classList.remove('active'));
    if (el) el.classList.add('active');

    currentFile = safePath;
    editorDirty = false;

    const textarea = document.getElementById('editorTextarea');
    const empty = document.getElementById('editorEmpty');
    const statusbar = document.getElementById('editorStatusbar');

    textarea.value = 'Loading...';
    textarea.style.display = 'block';
    empty.style.display = 'none';
    statusbar.style.display = 'flex';

    document.getElementById('editorFilename').textContent = safePath;
    document.getElementById('editorFilename').className = 'editor-filename';
    document.getElementById('btnValidate').style.display = '';
    document.getElementById('btnFormat').style.display = '';
    document.getElementById('btnSave').style.display = '';
    document.getElementById('editorValidateStatus').style.display = 'none';
    document.getElementById('editorPath').textContent = safePath;

    try {
      const data = await P002Api.adminGetFile(safePath);
      try {
        textarea.value = JSON.stringify(JSON.parse(data.content), null, 2);
      } catch {
        textarea.value = data.content;
      }
      updateEditorStatus();
    } catch(e) {
      textarea.value = `Error loading file: ${e.message}`;
    }
  }

  function onEditorChange() {
    editorDirty = true;
    document.getElementById('editorFilename').className = 'editor-filename dirty';
    updateEditorStatus();
    document.getElementById('editorValidateStatus').style.display = 'none';
  }

  function updateEditorStatus() {
    const text = document.getElementById('editorTextarea').value;
    const lines = text.split('\n').length;
    const size = (new Blob([text]).size / 1024).toFixed(1);
    document.getElementById('editorLines').textContent = `${lines} lines`;
    document.getElementById('editorSize').textContent = `${size} KB`;
  }

  function validateEditor() {
    const text = document.getElementById('editorTextarea').value;
    const status = document.getElementById('editorValidateStatus');
    status.style.display = '';

    const result = P002Security.validateLessonJson(text);
    if (result.ok) {
      status.textContent = '✓ Valid JSON -- schema OK';
      status.className = 'editor-validate-status ok';
    } else {
      status.textContent = '✗ ' + result.errors[0];
      status.className = 'editor-validate-status err';
    }
  }

  function formatEditor() {
    const textarea = document.getElementById('editorTextarea');
    const parsed = P002Security.safeParseJson(textarea.value);
    if (!parsed.ok) { toast('Invalid JSON -- cannot format', 'err'); return; }
    textarea.value = JSON.stringify(parsed.data, null, 2);
    editorDirty = true;
    updateEditorStatus();
    toast('Formatted', 'ok');
  }

  function handleEditorKey(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      e.target.value = e.target.value.substring(0, start) + '  ' + e.target.value.substring(end);
      e.target.selectionStart = e.target.selectionEnd = start + 2;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEditor();
    }
  }

  async function saveEditor() {
    if (!currentFile) return;
    const text = document.getElementById('editorTextarea').value;

    // Full validation before save
    const validation = P002Security.validateLessonJson(text);
    if (!validation.ok) {
      toast('Cannot save -- ' + validation.errors[0], 'err');
      return;
    }

    const btn = document.getElementById('btnSave');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
      await P002Api.adminSaveFile(currentFile, JSON.stringify(validation.data, null, 2));
      editorDirty = false;
      document.getElementById('editorFilename').className = 'editor-filename';
      document.getElementById('editorFilename').textContent = currentFile;
      toast('Saved: ' + currentFile, 'ok');
    } catch(e) {
      toast('Save failed: ' + e.message, 'err');
    }

    btn.textContent = '💾 Save';
    btn.disabled = false;
  }

  async function deleteFile(path) {
    const safePath = P002Security.sanitizePath(path);
    if (!safePath) { toast('Invalid path', 'err'); return; }
    if (!confirm(`Delete ${safePath}? This cannot be undone.`)) return;

    try {
      const sb = P002Api.getClient();
      const { error } = await sb.storage.from(P002Api.BUCKET).remove([safePath]);
      if (error) throw error;
      toast('Deleted: ' + safePath, 'ok');
      if (currentFile === safePath) resetEditor();
      loadFiles();
    } catch(e) {
      toast('Delete failed: ' + e.message, 'err');
    }
  }

  function resetEditor() {
    currentFile = null;
    editorDirty = false;
    document.getElementById('editorTextarea').style.display = 'none';
    document.getElementById('editorEmpty').style.display = 'flex';
    document.getElementById('editorStatusbar').style.display = 'none';
    document.getElementById('editorFilename').textContent = 'No file selected';
    document.getElementById('btnValidate').style.display = 'none';
    document.getElementById('btnFormat').style.display = 'none';
    document.getElementById('btnSave').style.display = 'none';
  }

  function refreshFiles() { loadFiles(); }

  // ==================== NEW FILE ====================
  function showNewFileModal() { document.getElementById('newFileModal').style.display = 'flex'; }

  async function createNewFile() {
    const rawName = document.getElementById('newFileName').value.trim();
    const rawFolder = document.getElementById('newFileFolder').value.trim();
    if (!rawName) return;

    const name = P002Security.sanitizeFilename(rawName);
    const path = P002Security.sanitizePath(`${rawFolder}/${name}`);
    if (!path) { toast('Invalid file path', 'err'); return; }

    const template = {
      system_prompt: 'You are a cybersecurity instructor teaching hands-on penetration testing skills.',
      lesson: {
        title: 'New Section',
        module: 'Introduction to Web Applications',
        section: 0,
        total_sections: 17,
        difficulty: 'beginner',
        prerequisites: [],
        has_practice_box: false,
        estimated_read_minutes: 10,
        practice_question: null,
        practice_flag: null
      },
      simulation: null,
      teaching_path: [{
        id: '1',
        type: 'knowledge_probe',
        phase: 'entry',
        prompt: 'What do you already know about this topic?',
        purpose: 'Calibrate starting point.'
      }],
      teaching_rules: {
        never_do: ['Give direct answers before the learner attempts'],
        always_do: ['Probe existing knowledge before teaching'],
        pacing: 'If overwhelmed -- switch to direct delivery. If breezing through -- increase depth.'
      },
      datasets: {},
      session_summary: {
        description: 'Populated by AI at lesson completion.',
        concepts_mastered: [],
        struggled_with: [],
        flag_captured: false
      },
      metadata: { source: 'Manual', version: '1.0' }
    };

    try {
      await P002Api.adminSaveFile(path, JSON.stringify(template, null, 2));
      toast('Created: ' + path, 'ok');
      closeModal('newFileModal');
      loadFiles();
      setTimeout(() => openFile(path, null), 500);
    } catch(e) {
      toast('Create failed: ' + e.message, 'err');
    }
  }

  // ==================== ZIP UPLOAD ====================
  function showZipModal() { document.getElementById('zipModal').style.display = 'flex'; }

  async function handleZipUpload() {
    const fileInput = document.getElementById('zipFileInput');
    const file = fileInput.files[0];
    if (!file) { toast('Select a ZIP file first', 'err'); return; }
    if (!file.name.endsWith('.zip')) { toast('File must be a .zip', 'err'); return; }

    const output = document.getElementById('zipOutput');
    const btn = document.getElementById('btnUploadZip');
    output.innerHTML = '<div style="color:var(--info)">Processing ZIP...</div>';
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      const result = await P002Security.processLessonZip(file);

      if (!result.ok) {
        output.innerHTML = `<div style="color:var(--red)">✗ ${P002Security.escapeHtml(result.error)}</div>`;
        return;
      }

      const { results } = result;
      let html = '';
      let uploadCount = 0;
      let failCount = 0;

      for (const r of results) {
        if (r.ok) {
          html += `<div style="color:var(--green)">⟳ Uploading ${P002Security.escapeHtml(r.path)}...</div>`;
          output.innerHTML = html;
          try {
            await P002Api.adminSaveFile(r.path, r.content);
            html = html.replace(`⟳ Uploading ${P002Security.escapeHtml(r.path)}...`, `✓ ${P002Security.escapeHtml(r.path)}`);
            uploadCount++;
          } catch(e) {
            html = html.replace(`⟳ Uploading ${P002Security.escapeHtml(r.path)}...`, `✗ ${P002Security.escapeHtml(r.path)} -- Upload failed: ${P002Security.escapeHtml(e.message)}`);
            failCount++;
          }
        } else {
          html += `<div style="color:var(--red)">✗ ${P002Security.escapeHtml(r.filename)} -- ${P002Security.escapeHtml(r.errors.join(', '))}</div>`;
          failCount++;
        }
        output.innerHTML = html;
      }

      html += `<div style="margin-top:12px;color:var(--info)">Done: ${uploadCount} uploaded, ${failCount} failed</div>`;
      output.innerHTML = html;

      if (uploadCount > 0) {
        toast(`${uploadCount} file(s) uploaded`, 'ok');
        loadFiles();
      }

    } catch(e) {
      output.innerHTML = `<div style="color:var(--red)">Error: ${P002Security.escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Upload & Extract';
      fileInput.value = '';
    }
  }

  // ==================== AI RULES ====================
  async function loadRule(ruleKey, el) {
    if (el) {
      document.querySelectorAll('.rules-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
    }
    currentRule = ruleKey;

    const textarea = document.getElementById('rulesTextarea');
    const filename = document.getElementById('rulesFilename');
    filename.textContent = ruleKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (['system_prompt', 'teaching_balance', 'confidentiality', 'sequencing'].includes(ruleKey)) {
      textarea.value = 'Loading...';
      try {
        const data = await P002Api.adminGetFile('module_intro_web_apps/section_09.json');
        const parsed = P002Security.safeParseJson(data.content);
        if (!parsed.ok) throw new Error('Invalid JSON in section_09');
        const json = parsed.data;
        const sp = json.system_prompt || '';

        if (ruleKey === 'system_prompt') {
          textarea.value = sp;
        } else if (ruleKey === 'teaching_balance') {
          const start = sp.indexOf('TEACHING BALANCE');
          textarea.value = start !== -1 ? sp.substring(start) : 'Teaching balance rules not found.';
        } else if (ruleKey === 'confidentiality') {
          const start = sp.indexOf('CONFIDENTIALITY');
          const end = sp.indexOf('\n\nTEACHING VARIETY', start);
          textarea.value = start !== -1 ? sp.substring(start, end !== -1 ? end : undefined) : 'Confidentiality rules not found.';
        } else if (ruleKey === 'sequencing') {
          const start = sp.indexOf('CRITICAL SEQUENCING');
          const end = sp.indexOf('\n\nTEACHING BALANCE', start);
          textarea.value = start !== -1 ? sp.substring(start, end !== -1 ? end : undefined) : 'Sequencing rules not found.';
        }
      } catch(e) {
        textarea.value = 'Error loading: ' + e.message;
      }
    } else {
      textarea.value = `// Edit ${ruleKey} in the Lessons tab by opening the section JSON file.`;
    }
  }

  async function saveRule() {
    toast('Edit rules directly in the JSON editor (Lessons tab)', 'warn');
  }

  // ==================== TEST MODE ====================
  function selectTest(testKey, el) {
    document.querySelectorAll('.test-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    currentTest = testKey;
    const titles = {
      lesson: 'Lesson Flow Test',
      flag: 'Flag Validator',
      sim: 'Sim UI Test',
      cli: 'CLI Command Test',
      json: 'JSON Validator -- All Sections'
    };
    document.getElementById('testTitle').textContent = titles[testKey];
    document.getElementById('testOutput').textContent = 'Run a test to see output...';
    document.getElementById('testOutput').className = 'test-output';
  }

  async function runTest() {
    const output = document.getElementById('testOutput');
    const section = document.getElementById('testSection')?.value;
    const input = P002Security.sanitizeInput(document.getElementById('testInput')?.value || '');
    output.textContent = 'Running...';
    output.className = 'test-output';

    try {
      switch(currentTest) {
        case 'flag': await runFlagTest(input, section, output); break;
        case 'json': await runJsonValidation(output); break;
        case 'lesson': await runLessonTest(section, input, output); break;
        case 'sim': runSimTest(output); break;
        case 'cli': await runCliTest(input, output); break;
      }
    } catch(e) {
      output.innerHTML = `<span class="test-result-fail">ERROR: ${P002Security.escapeHtml(e.message)}</span>`;
    }
  }

  async function runFlagTest(input, section, output) {
    if (!section) { output.textContent = 'Select a section first'; return; }
    const data = await P002Api.adminGetFile(`module_intro_web_apps/${section}`);
    const parsed = P002Security.safeParseJson(data.content);
    if (!parsed.ok) { output.textContent = 'Invalid JSON in section file'; return; }
    const flag = parsed.data.lesson?.practice_flag || parsed.data.simulation?.flag;
    if (!flag) { output.innerHTML = `<span class="test-result-info">ℹ No flag defined for this section</span>`; return; }
    const match = input.trim().toLowerCase() === flag.toLowerCase();
    output.innerHTML =
      `<span class="test-result-info">Expected: ${P002Security.escapeHtml(flag)}</span>\n` +
      `<span class="test-result-info">Submitted: ${P002Security.escapeHtml(input || '(empty)')}</span>\n` +
      (match ? `<span class="test-result-pass">✓ PASS</span>` : `<span class="test-result-fail">✗ FAIL</span>`);
  }

  async function runJsonValidation(output) {
    output.textContent = 'Validating all sections...\n';
    const sections = Array.from({length: 17}, (_, i) => `section_${String(i+1).padStart(2,'0')}`);
    let results = '';
    let passed = 0;
    let failed = 0;

    for (const s of sections) {
      try {
        const data = await P002Api.adminGetFile(`module_intro_web_apps/${s}.json`);
        const validation = P002Security.validateLessonJson(data.content);
        if (validation.ok) {
          results += `<span class="test-result-pass">✓ ${s}.json -- valid</span>\n`;
          passed++;
        } else {
          results += `<span class="test-result-fail">✗ ${s}.json -- ${P002Security.escapeHtml(validation.errors[0])}</span>\n`;
          failed++;
        }
      } catch(e) {
        results += `<span class="test-result-fail">✗ ${s}.json -- ${P002Security.escapeHtml(e.message)}</span>\n`;
        failed++;
      }
      output.innerHTML = results;
    }

    results += `\n<span class="test-result-info">Result: ${passed} passed, ${failed} failed</span>`;
    output.innerHTML = results;
  }

  async function runLessonTest(section, input, output) {
    if (!section) { output.textContent = 'Select a section first'; return; }
    if (!input) { output.textContent = 'Enter a test message'; return; }
    output.textContent = 'Calling Claude...';

    const data = await P002Api.adminGetFile(`module_intro_web_apps/${section}`);
    const parsed = P002Security.safeParseJson(data.content);
    if (!parsed.ok) { output.textContent = 'Invalid JSON'; return; }
    const json = parsed.data;
    const node = json.teaching_path?.[0];
    const sp = `${json.system_prompt}\n\nCURRENT NODE:\n${JSON.stringify(node, null, 2)}\n\nTEACHING RULES:\n${JSON.stringify(json.teaching_rules, null, 2)}`;

    const reply = await P002Api.callClaude(sp, [{ role: 'user', content: input }]);
    output.innerHTML = `<span class="test-result-info">// Input: ${P002Security.escapeHtml(input)}</span>\n\n<span class="test-result-pass">// AI Response:</span>\n${P002Security.escapeHtml(reply)}`;
  }

  function runSimTest(output) {
    output.innerHTML = `<span class="test-result-info">Open the teaching app and start a XSS session to test the sim environment.</span>`;
  }

  async function runCliTest(input, output) {
    if (!input) { output.textContent = 'Enter a CLI command to test'; return; }
    output.textContent = 'Simulating...';
    const reply = await P002Api.callClaude(
      'You are a terminal simulator for a cybersecurity teaching platform. Simulate realistic terminal output for penetration testing commands.',
      [{ role: 'user', content: `Simulate: ${input}` }]
    );
    output.textContent = reply;
  }

  // ==================== SESSIONS ====================
  async function loadSessions() {
    const list = document.getElementById('sessionsList');
    list.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const data = await P002Api.adminGetSessions(100);
      list.innerHTML = '';

      if (!data.sessions.length) {
        list.innerHTML = '<div class="loading">No sessions found</div>';
        return;
      }

      data.sessions.forEach(s => {
        const el = document.createElement('div');
        el.className = 'session-item';
        el.dataset.id = s.id;
        el.innerHTML = `
          <div class="session-item-top">
            <div class="session-item-id">${P002Security.escapeHtml(s.id.slice(0,12))}...</div>
            <div class="session-item-status ${s.completed_at ? 'complete' : 'active'}">${s.completed_at ? 'done' : 'active'}</div>
          </div>
          <div class="session-item-meta">
            <span>§${s.section_number || '?'}</span>
            <span>${s.flag_captured ? '🏴' : ''}</span>
            <span>${new Date(s.started_at).toLocaleDateString()}</span>
          </div>`;
        el.onclick = () => { viewSession(s, el); closeSidebar(); };
        list.appendChild(el);
      });
    } catch(e) {
      list.innerHTML = `<div style="padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--danger);">Error: ${P002Security.escapeHtml(e.message)}</div>`;
    }
  }

  async function viewSession(session, el) {
    document.querySelectorAll('.session-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    currentSession = session;

    document.getElementById('sessionDetailTitle').textContent = `Session ${session.id.slice(0,8)} -- §${session.section_number}`;
    document.getElementById('btnDeleteSession').style.display = '';

    const msgs = document.getElementById('sessionMessages');
    msgs.innerHTML = '<div class="loading">Loading messages...</div>';

    try {
      const data = await P002Api.adminGetSessionMessages(session.id);
      msgs.innerHTML = '';

      if (!data.messages.length) {
        msgs.innerHTML = '<div class="loading">No messages</div>';
        return;
      }

      data.messages.forEach(m => {
        const el = document.createElement('div');
        el.className = `session-msg ${m.role}`;
        el.innerHTML = `<div class="session-msg-role">${m.role}</div>${P002Security.escapeHtml(m.content)}`;
        msgs.appendChild(el);
      });

      msgs.scrollTop = msgs.scrollHeight;
    } catch(e) {
      msgs.innerHTML = `<div style="color:var(--danger);font-size:11px;font-family:'JetBrains Mono',monospace;">Error: ${P002Security.escapeHtml(e.message)}</div>`;
    }
  }

  async function deleteCurrentSession() {
    if (!currentSession) return;
    if (!confirm('Delete this session and all messages?')) return;

    try {
      await P002Api.adminDeleteSession(currentSession.id);
      toast('Session deleted', 'ok');
      currentSession = null;
      document.getElementById('sessionDetailTitle').textContent = 'Select a session to view';
      document.getElementById('btnDeleteSession').style.display = 'none';
      document.getElementById('sessionMessages').innerHTML = '<div class="loading">Select a session</div>';
      loadSessions();
    } catch(e) {
      toast('Delete failed: ' + e.message, 'err');
    }
  }

  // ==================== USERS ====================
  async function loadUsers() {
    const table = document.getElementById('usersTable');
    table.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const data = await P002Api.adminGetUsers();
      const cols = 'grid-template-columns: 2fr 1.5fr 80px 120px 120px 100px';

      table.innerHTML = `
        <div class="data-table-header" style="${cols}">
          <span>Email</span><span>ID</span><span>Verified</span><span>Last Login</span><span>Created</span><span>Actions</span>
        </div>
        ${data.users.map(u => `
          <div class="data-table-row" style="${cols}">
            <span class="highlight">${P002Security.escapeHtml(u.email || '')}</span>
            <span>${P002Security.escapeHtml(u.id.slice(0,8))}...</span>
            <span class="${u.confirmed ? 'good' : 'bad'}">${u.confirmed ? '✓' : '✗'}</span>
            <span>${u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</span>
            <span>${new Date(u.created_at).toLocaleDateString()}</span>
            <div class="row-actions">
              ${u.id !== P002Api.ADMIN_USER_ID
                ? `<button class="row-btn danger" onclick="P002Admin.banUser('${P002Security.escapeHtml(u.id)}')">Ban</button>`
                : `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--accent);">YOU</span>`
              }
            </div>
          </div>`).join('')}`;
    } catch(e) {
      table.innerHTML = `<div style="padding:16px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--danger);">Error: ${P002Security.escapeHtml(e.message)}</div>`;
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

  function showInviteModal() { document.getElementById('inviteModal').style.display = 'flex'; }

  async function createUser() {
    const email = P002Security.sanitizeInput(document.getElementById('inviteEmail').value.trim());
    const password = document.getElementById('invitePassword').value;
    if (!email || !password) { toast('Email and password required', 'err'); return; }
    try {
      await P002Api.adminCreateUser(email, password);
      toast('User created: ' + email, 'ok');
      closeModal('inviteModal');
      loadUsers();
    } catch(e) {
      toast('Error: ' + e.message, 'err');
    }
  }

  // ==================== STATS ====================
  async function loadStats() {
    const grid = document.getElementById('statsGrid');
    grid.innerHTML = '<div class="loading">Loading...</div>';
    try {
      const data = await P002Api.adminGetStats();
      grid.innerHTML = `
        <div class="stat-card"><div class="stat-value">${data.total_sessions}</div><div class="stat-label">Total Sessions</div></div>
        <div class="stat-card"><div class="stat-value">${data.completed_sessions}</div><div class="stat-label">Completed</div></div>
        <div class="stat-card"><div class="stat-value">${data.flags_captured}</div><div class="stat-label">Flags Captured</div></div>
        <div class="stat-card"><div class="stat-value">${data.total_messages}</div><div class="stat-label">Total Messages</div></div>
        <div class="stat-card"><div class="stat-value">${data.user_messages}</div><div class="stat-label">User Messages</div></div>
        <div class="stat-card"><div class="stat-value">${data.ai_messages}</div><div class="stat-label">AI Responses</div></div>`;
    } catch(e) {
      grid.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--danger);">Error: ${P002Security.escapeHtml(e.message)}</div>`;
    }
  }

  async function runSql() {
    const input = P002Security.sanitizeInput(document.getElementById('sqlInput').value.trim());
    const output = document.getElementById('sqlOutput');
    if (!input) return;
    output.style.display = 'block';
    output.style.color = '';
    output.textContent = 'Running...';
    try {
      const data = await P002Api.adminRunSql(input);
      output.textContent = JSON.stringify(data.rows, null, 2);
    } catch(e) {
      output.style.color = 'var(--danger)';
      output.textContent = 'Error: ' + e.message;
    }
  }

  // ==================== HELPERS ====================
  function closeModal(id) { document.getElementById(id).style.display = 'none'; }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.background = type === 'ok' ? 'var(--surface)' : type === 'err' ? 'var(--danger)' : 'var(--warn-dim)';
    el.style.color = type === 'ok' ? 'var(--accent)' : type === 'err' ? '#fff' : 'var(--warn)';
    el.style.border = `1px solid ${type === 'ok' ? 'var(--accent)' : type === 'err' ? 'var(--danger)' : 'var(--warn)'}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ==================== PUBLIC API ====================
  return {
    init,
    doLogin,
    doLogout,
    switchPanel,
    toggleSidebar,
    closeSidebar,
    loadFiles,
    openFile,
    onEditorChange,
    validateEditor,
    formatEditor,
    handleEditorKey,
    saveEditor,
    deleteFile,
    refreshFiles,
    showNewFileModal,
    createNewFile,
    showZipModal,
    handleZipUpload,
    loadRule,
    saveRule,
    selectTest,
    runTest,
    loadSessions,
    deleteCurrentSession,
    loadUsers,
    banUser,
    showInviteModal,
    createUser,
    loadStats,
    runSql,
    closeModal,
  };

})();

// Boot
window.addEventListener('load', P002Admin.init);
