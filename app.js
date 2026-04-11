// ================================================================
// PROJECT 002 -- app.js
// Reading platform logic
// Depends on: security.js, api.js
// ================================================================

window.P002App = (() => {

  // ==================== STATE ====================
  let currentUser = null;
  let sectionData = null;
  let currentSessionId = null;
  let selectedModule = null;
  let currentModule = null;
  let currentSectionMeta = null;
  let selectedSection = null;

  // Reader state
  let readerScrollHandler = null;

  // Drawer state
  let drawerHistory = [];       // [{role, content}] for drawer conversation
  let selectedText = '';
  let currentDrawerAction = '';

  // Chat state (free chat + debrief)
  let chatHistory = [];
  let chatMode = 'free';        // 'free' | 'debrief'
  let currentChallengePassed = false;

  // Challenge state
  let currentHintIndex = 0;

  // Knowledge check state
  let kcQuestions = [];
  let kcCurrentIdx = 0;
  let kcScore = 0;
  let kcAnswers = [];         // {correct: bool, type: string} per question
  let kcExplainHistory = [];

  // ==================== INIT ====================
  async function init() {
    try {
      const session = await P002Api.getSession();
      if (session) {
        currentUser = session.user;
        await postLogin();
      } else {
        showScreen('authScreen');
        setStatus(false, 'not authenticated');
      }
    } catch(e) {
      showScreen('authScreen');
      setStatus(false, 'offline');
    }
    document.getElementById('loadingOverlay').style.opacity = '0';
    setTimeout(() => document.getElementById('loadingOverlay').style.display = 'none', 400);
  }

  async function postLogin() {
    setStatus(true, currentUser.email.split('@')[0]);
    document.getElementById('logoutBtn').style.display = 'block';
    document.getElementById('settingsBtn').style.display = 'block';
    if (P002Api.isAdmin(currentUser)) {
      document.getElementById('adminBtn').style.display = 'block';
    }
    showScreen('homeScreen');
    loadModuleCatalog();
  }

  // ==================== AUTH ====================
  let authMode = 'login';

  async function handleAuth() {
    const email = P002Security.sanitizeInput(document.getElementById('authEmail').value.trim());
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authBtn');

    if (!email || !password) { showAuthError('Email and password required'); return; }

    btn.disabled = true;
    btn.textContent = authMode === 'login' ? 'Logging in...' : 'Creating account...';

    try {
      if (authMode === 'login') {
        currentUser = await P002Api.signIn(email, password);
      } else {
        currentUser = await P002Api.signUp(email, password);
      }
      await postLogin();
    } catch(e) {
      showAuthError('Error: ' + (e.message || JSON.stringify(e)));
    }

    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Login' : 'Sign Up';
  }

  async function logout() {
    await P002Api.signOut();
    currentUser = null;
    sectionData = null;
    chatHistory = [];
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('settingsBtn').style.display = 'none';
    document.getElementById('endBtn').style.display = 'none';
    document.getElementById('adminBtn').style.display = 'none';
    showScreen('authScreen');
    setStatus(false, 'logged out');
  }

  function switchTab(mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach((t, i) => {
      t.classList.toggle('active', (i === 0 && mode === 'login') || (i === 1 && mode === 'signup'));
    });
    document.getElementById('authBtn').textContent = mode === 'login' ? 'Login' : 'Sign Up';
    hideAuthError();
  }

  // ==================== HOME SCREEN ====================
  const MODULE_INDEX_PATH = 'index.json';

  const CATEGORY_ICONS = {
    'Web Fundamentals': '??',
    'Web Exploitation': '⚡',
    'Network': '??',
    'Defense': '??',
    'Systems': '??',
    'Other': '??',
  };

  async function loadModuleCatalog() {
    const grid = document.getElementById('moduleGrid');
    if (!grid) return;

    try {
      let modules = [];
      try {
        const text = await P002Api.downloadFile(MODULE_INDEX_PATH);
        const parsed = JSON.parse(text);
        modules = parsed.modules || [];
      } catch(e) {
        const items = await P002Api.listBucket('');
        const folders = items.filter(f => !f.metadata && !f.name.startsWith('.'));
        modules = folders.map(f => ({
          key: f.name,
          title: f.name.replace(/module_|_/g, ' ').trim(),
          category: 'Other',
          difficulty: 'intermediate',
          section_count: 0,
          estimated_hours: 0,
          icon: '??'
        }));
      }

      if (!modules.length) {
        grid.innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">No modules found. Upload content via the admin panel.</div>';
        return;
      }

      const categories = {};
      modules.forEach(m => {
        const cat = m.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(m);
      });

      grid.innerHTML = '';

      Object.entries(categories).forEach(([cat, mods]) => {
        const group = document.createElement('div');
        group.style.cssText = 'margin-bottom:8px;';
        const label = document.createElement('div');
        label.style.cssText = 'padding:16px 16px 8px;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:var(--text-dim);';
        label.textContent = cat;
        group.appendChild(label);
        mods.forEach(m => group.appendChild(buildIndexCard(m)));
        grid.appendChild(group);
      });

    } catch(e) {
      grid.innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">Error: ' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  function buildIndexCard(m) {
    const card = document.createElement('div');
    card.style.cssText = 'margin:0 16px 8px;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color 0.15s,transform 0.15s;';

    const icon = m.icon || CATEGORY_ICONS[m.category] || '??';
    const secs = m.section_count || 0;
    const hrs = m.estimated_hours || 0;
    const diff = m.difficulty || 'intermediate';
    const diffColors = { beginner: 'var(--success)', intermediate: 'var(--warn)', advanced: 'var(--accent)' };

    card.innerHTML =
      '<div style="padding:14px 16px;display:flex;align-items:center;gap:14px;">' +
        '<div style="width:44px;height:44px;border-radius:10px;background:var(--accent-dim);border:1px solid rgba(255,77,77,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:' + (diffColors[diff] || 'var(--warn)') + ';margin-bottom:4px;">' + diff + '</div>' +
          '<div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);line-height:1.2;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + P002Security.escapeHtml(m.title) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">' + (secs > 0 ? secs + ' sections' : 'Loading...') + (hrs > 0 ? ' · ' + hrs + 'h' : '') + '</div>' +
        '</div>' +
        '<div style="color:var(--text-dim);font-size:16px;">›</div>' +
      '</div>';

    card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--border2)'; card.style.transform = 'translateX(2px)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--border)'; card.style.transform = ''; });
    card.addEventListener('click', () => openModule(m.key || m.module_key));
    return card;
  }

  // ==================== MODULE / SECTION NAV ====================
  async function openModule(moduleKey) {
    selectedModule = moduleKey;
    showScreen('moduleScreen');

    document.getElementById('moduleDetailTitle').textContent = 'Loading...';
    document.getElementById('moduleDetailDesc').textContent = '';
    document.getElementById('moduleDetailCategory').textContent = '';
    document.getElementById('moduleDetailStats').innerHTML = '';
    document.getElementById('moduleSectionList').innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">Loading sections...</div>';

    try {
      const text = await P002Api.downloadFile(moduleKey + '/manifest.json');
      const manifest = JSON.parse(text);
      currentModule = manifest;
      renderModuleDetail(manifest);
    } catch(e) {
      document.getElementById('moduleDetailTitle').textContent = 'Failed to load';
      document.getElementById('moduleSectionList').innerHTML = '<div style="padding:20px 16px;color:var(--danger);font-size:13px;">' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  function renderModuleDetail(manifest) {
    const totalMins = manifest.sections.reduce((a, s) => a + (s.minutes || 0), 0);
    const hours = totalMins > 0 ? (totalMins / 60).toFixed(1) : (manifest.estimated_hours || '?');
    const flags = manifest.sections.filter(s => s.has_flag).length;

    document.getElementById('moduleDetailCategory').textContent = (manifest.category || '') + (manifest.difficulty ? ' · ' + manifest.difficulty : '');
    document.getElementById('moduleDetailTitle').textContent = manifest.title;
    document.getElementById('moduleDetailDesc').textContent = manifest.description || '';
    document.getElementById('moduleDetailStats').innerHTML =
      '<div class="module-stat"><span class="module-stat-value">' + manifest.sections.length + '</span><span class="module-stat-label">Sections</span></div>' +
      '<div class="module-stat"><span class="module-stat-value">' + hours + 'h</span><span class="module-stat-label">Estimated</span></div>' +
      (flags > 0 ? '<div class="module-stat"><span class="module-stat-value">' + flags + '</span><span class="module-stat-label">Flags</span></div>' : '');

    const list = document.getElementById('moduleSectionList');
    list.innerHTML = '';

    manifest.sections.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'section-row' + (s.has_flag ? ' has-flag' : '');
      row.innerHTML =
        '<div class="section-num">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="section-info">' +
          '<div class="section-title">' + P002Security.escapeHtml(s.title) + '</div>' +
          '<div class="section-meta-row">' +
            '<span class="section-time">⏱ ' + (s.minutes || '?') + ' min</span>' +
            '<span class="section-diff ' + (s.difficulty || 'beginner') + '">' + (s.difficulty || '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="section-flag">⚑</div>' +
        '<div class="section-chevron">›</div>';
      row.addEventListener('click', () => openSectionPreview(s, i, manifest));
      list.appendChild(row);
    });
  }

  async function openSectionPreview(sectionMeta, idx, manifest) {
    currentSectionMeta = sectionMeta;
    selectedSection = manifest.module_key + '/' + sectionMeta.file;
    sectionData = null;

    document.getElementById('sectionBackLabel').textContent = manifest.title;
    document.getElementById('sectionPreviewMeta').textContent =
      'Section ' + (idx + 1) + ' of ' + manifest.sections.length +
      ' · ' + (sectionMeta.difficulty || '') +
      ' · ' + (sectionMeta.minutes || '?') + ' min';
    document.getElementById('sectionPreviewTitle').textContent = sectionMeta.title;
    document.getElementById('sectionPreviewDesc').textContent = sectionMeta.description || '';

    const body = document.getElementById('sectionPreviewBody');
    body.innerHTML = '';

    if (sectionMeta.has_flag) {
      const box = document.createElement('div');
      box.className = 'section-challenge-box';
      box.innerHTML =
        '<div class="section-challenge-label">⚑ Practice Challenge included</div>' +
        '<div class="section-challenge-text">' + P002Security.escapeHtml(sectionMeta.practice_question || 'Hands-on challenge at the end of this section') + '</div>';
      body.appendChild(box);
    }

    showScreen('sectionScreen');

    const btn = document.getElementById('sectionStartBtn');
    const status = document.getElementById('sectionStartStatus');
    btn.disabled = true;
    status.textContent = 'Loading section...';

    try {
      const text = await P002Api.downloadFile(selectedSection);
      const validation = P002Security.validateLessonJson(text);
      if (!validation.ok) {
        status.textContent = '✗ ' + validation.errors[0];
        return;
      }
      sectionData = validation.data;
      btn.disabled = false;
      status.textContent = '';

      // Update button text based on schema
      btn.textContent = validation.schema === 'reader' ? 'Start Reading →' : 'Start Session →';
    } catch(e) {
      status.textContent = '✗ Failed to load: ' + P002Security.escapeHtml(e.message);
    }
  }

  function backToHome() { currentModule = null; showScreen('homeScreen'); }
  function backToModule() { currentSectionMeta = null; sectionData = null; showScreen('moduleScreen'); }
  function backToSectionPreview() {
    closeDrawer();
    removeTextSelectionHandler();
    showScreen('sectionScreen');
  }
  function showAdmin() { window.location.href = '/project-002/admin.html'; }

  // ==================== START READING ====================
  async function startReading() {
    if (!sectionData) return;

    const validation = P002Security.validateLessonJson(JSON.stringify(sectionData));

    // Legacy section — fall back to old chat-based session
    if (validation.schema === 'legacy') {
      startLegacySession();
      return;
    }

    // New reader schema
    const meta = sectionData.meta;
    document.getElementById('readerChapter').textContent =
      'Section ' + meta.section + ' of ' + meta.total_sections + ' · ' + meta.module;
    document.getElementById('readerTitle').textContent = meta.title;
    document.getElementById('readerProgressFill').style.width = '0%';

    renderReaderContent();
    showScreen('readerScreen');
    document.getElementById('endBtn').style.display = 'block';
    document.getElementById('settingsBtn').style.display = 'none';

    initTextSelection();

    // Sticky next bar — show when reader hits bottom
    const readerContent = document.getElementById('readerContent');
    const stickyBar = document.getElementById('readerStickyNext');
    if (stickyBar) stickyBar.style.display = 'none';
    if (readerContent) {
      readerScrollHandler = () => {
        const nearBottom = readerContent.scrollTop + readerContent.clientHeight >= readerContent.scrollHeight - 60;
        if (stickyBar) stickyBar.style.display = nearBottom ? 'flex' : 'none';
        // Update progress fill
        const pct = readerContent.scrollHeight <= readerContent.clientHeight ? 100 :
          Math.min(100, Math.round((readerContent.scrollTop / (readerContent.scrollHeight - readerContent.clientHeight)) * 100));
        document.getElementById('readerProgressFill').style.width = pct + '%';
      };
      readerContent.addEventListener('scroll', readerScrollHandler);
    }

    // Populate sticky next bar title
    const nextMeta = currentModule?.sections?.[currentModule.sections.indexOf(currentSectionMeta) + 1];
    const nextTitle = document.getElementById('stickyNextTitle');
    if (nextTitle) nextTitle.textContent = nextMeta?.title || 'Module complete';

    // Create session for progress tracking
    try {
      currentSessionId = await P002Api.createSession(meta.section, meta.module);
    } catch(e) {
      console.warn('Session creation failed:', e.message);
    }
  }

  function endReading() {
    removeTextSelectionHandler();
    closeDrawer();
    // Remove scroll handler
    const readerContent = document.getElementById('readerContent');
    if (readerContent && readerScrollHandler) {
      readerContent.removeEventListener('scroll', readerScrollHandler);
      readerScrollHandler = null;
    }
    const stickyBar = document.getElementById('readerStickyNext');
    if (stickyBar) stickyBar.style.display = 'none';
    document.getElementById('endBtn').style.display = 'none';
    document.getElementById('settingsBtn').style.display = 'block';
    showScreen('sectionScreen');
  }

  // ==================== STICKY NEXT BAR ====================
  function stickyNextTapped() {
    // If knowledge_check exists, go to KC prompt screen
    // Otherwise go straight to next section
    const kcData = sectionData?.knowledge_check;
    if (kcData?.questions?.length > 0) {
      showKcPrompt();
    } else {
      goToNextSection();
    }
  }

  function showKcPrompt() {
    const kcData = sectionData.knowledge_check;
    const qCount = kcData.questions.length;
    document.getElementById('kcPromptCount').textContent = qCount + ' question' + (qCount !== 1 ? 's' : '') + ' · ~' + Math.ceil(qCount * 0.5) + ' min';
    showScreen('kcPromptScreen');
  }

  function skipKcGoNext() {
    goToNextSection();
  }

  function goToNextSection() {
    if (!currentModule || !currentSectionMeta) { showScreen('moduleScreen'); return; }
    const sections = currentModule.sections;
    const idx = sections.findIndex(s => s.file === currentSectionMeta.file);
    if (idx === -1 || idx >= sections.length - 1) {
      showScreen('moduleScreen');
      return;
    }
    const nextMeta = sections[idx + 1];
    openSectionPreview(nextMeta, idx + 1, currentModule);
  }

  // ==================== KNOWLEDGE CHECK ====================
  function startKnowledgeCheck() {
    const kcData = sectionData?.knowledge_check;
    if (!kcData?.questions?.length) return;

    kcQuestions = kcData.questions;
    kcCurrentIdx = 0;
    kcScore = 0;
    kcAnswers = [];
    kcExplainHistory = [];

    // Set section title in KC header
    const titleEl = document.getElementById('kcSectionTitle');
    if (titleEl) titleEl.textContent = sectionData?.meta?.title || 'Knowledge Check';

    showScreen('kcScreen');
    renderKcQuestion();
  }

  function renderKcQuestion() {
    const q = kcQuestions[kcCurrentIdx];
    if (!q) { showKcResults(); return; }

    // Progress dots
    const dotsEl = document.getElementById('kcDots');
    dotsEl.innerHTML = '';
    kcQuestions.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'kc-dot' +
        (i < kcCurrentIdx ? ' done' : i === kcCurrentIdx ? ' active' : '');
      dotsEl.appendChild(dot);
    });

    document.getElementById('kcCounter').textContent = (kcCurrentIdx + 1) + ' / ' + kcQuestions.length;
    document.getElementById('kcQuestion').textContent = q.question;
    document.getElementById('kcFeedback').style.display = 'none';
    document.getElementById('kcExplainDrawer').style.display = 'none';

    const optionsEl = document.getElementById('kcOptions');
    optionsEl.innerHTML = '';

    if (q.type === 'mc') {
      q.options.forEach((opt, i) => {
        const el = document.createElement('div');
        el.className = 'kc-option';
        el.dataset.value = opt.charAt(0); // A, B, C, D
        el.innerHTML = '<div class="kc-letter">' + opt.charAt(0) + '</div><div class="kc-opt-text">' + P002Security.escapeHtml(opt.slice(3)) + '</div>';
        el.onclick = () => selectKcOption(el, opt.charAt(0));
        optionsEl.appendChild(el);
      });
    } else if (q.type === 'tf') {
      ['True', 'False'].forEach(val => {
        const el = document.createElement('div');
        el.className = 'kc-option';
        el.dataset.value = val;
        el.innerHTML = '<div class="kc-letter">' + val.charAt(0) + '</div><div class="kc-opt-text">' + val + '</div>';
        el.onclick = () => selectKcOption(el, val);
        optionsEl.appendChild(el);
      });
    } else if (q.type === 'sa') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:0;width:100%;';
      wrap.innerHTML = '<textarea id="kcSaInput" placeholder="Type your answer..." style="width:100%;background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:12px;font-size:13px;color:#ccc;font-family:inherit;resize:none;min-height:80px;outline:none;box-sizing:border-box;"></textarea>';
      optionsEl.appendChild(wrap);
    }

    const submitBtn = document.getElementById('kcSubmitBtn');
    submitBtn.textContent = 'Check Answer';
    submitBtn.disabled = q.type !== 'sa';
    submitBtn.className = 'kc-submit' + (q.type === 'sa' ? '' : ' disabled');
    submitBtn.onclick = submitKcAnswer;

    // Enable SA button when text entered
    if (q.type === 'sa') {
      setTimeout(() => {
        const ta = document.getElementById('kcSaInput');
        if (ta) ta.addEventListener('input', () => {
          submitBtn.disabled = ta.value.trim().length < 3;
          submitBtn.className = 'kc-submit' + (ta.value.trim().length < 3 ? ' disabled' : '');
        });
      }, 50);
    }
  }

  function selectKcOption(el, value) {
    document.querySelectorAll('#kcOptions .kc-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    el.dataset.selected = value;
    const btn = document.getElementById('kcSubmitBtn');
    btn.disabled = false;
    btn.className = 'kc-submit';
  }

  async function submitKcAnswer() {
    const q = kcQuestions[kcCurrentIdx];
    const feedbackEl = document.getElementById('kcFeedback');
    const submitBtn = document.getElementById('kcSubmitBtn');
    submitBtn.disabled = true;

    let isCorrect = false;
    let userAnswer = '';

    if (q.type === 'mc') {
      const selected = document.querySelector('#kcOptions .kc-option.selected');
      if (!selected) return;
      userAnswer = selected.dataset.value;
      isCorrect = userAnswer === q.answer;
      // Mark options
      document.querySelectorAll('#kcOptions .kc-option').forEach(o => {
        if (o.dataset.value === q.answer) o.classList.add('correct');
        else if (o.dataset.value === userAnswer && !isCorrect) o.classList.add('wrong');
      });
    } else if (q.type === 'tf') {
      const selected = document.querySelector('#kcOptions .kc-option.selected');
      if (!selected) return;
      userAnswer = selected.dataset.value;
      const correctStr = q.answer === true ? 'True' : 'False';
      isCorrect = userAnswer === correctStr;
      document.querySelectorAll('#kcOptions .kc-option').forEach(o => {
        if (o.dataset.value === correctStr) o.classList.add('correct');
        else if (o.dataset.value === userAnswer && !isCorrect) o.classList.add('wrong');
      });
    } else if (q.type === 'sa') {
      const ta = document.getElementById('kcSaInput');
      userAnswer = ta?.value?.trim() || '';
      ta.disabled = true;
      // Grade with AI
      feedbackEl.style.display = 'block';
      document.getElementById('kcFeedbackIcon').textContent = '···';
      document.getElementById('kcFeedbackText').textContent = 'Grading...';
      document.getElementById('kcFeedbackText').className = 'kc-result-text';
      document.getElementById('kcExplanation').textContent = '';
      document.getElementById('kcNextBtn').style.display = 'none';
      document.getElementById('kcExplainBtn').style.display = 'none';

      try {
        const sp = 'You are grading a short answer question. Respond with JSON only: {"correct": true/false, "feedback": "1-2 sentence feedback"}';
        const msg = 'Question: ' + q.question + '\nModel answer: ' + q.sample_answer + '\nKey points: ' + (q.key_points || []).join(', ') + '\nStudent answer: ' + userAnswer;
        const reply = await P002Api.callClaude(sp, [{role:'user', content: msg}], null, 'haiku');
        const clean = reply.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
        const graded = JSON.parse(clean);
        isCorrect = graded.correct === true;
        showKcFeedback(isCorrect, graded.feedback || q.sample_answer, q.type);
      } catch(e) {
        // Fallback — mark as informational
        isCorrect = true;
        showKcFeedback(true, q.sample_answer, q.type);
      }
      kcAnswers.push({ correct: isCorrect, type: q.type });
      if (isCorrect) kcScore++;
      return;
    }

    kcAnswers.push({ correct: isCorrect, type: q.type });
    if (isCorrect) kcScore++;
    showKcFeedback(isCorrect, q.explanation, q.type);
  }

  function showKcFeedback(isCorrect, explanation, type) {
    const feedbackEl = document.getElementById('kcFeedback');
    feedbackEl.style.display = 'block';

    document.getElementById('kcFeedbackIcon').textContent = isCorrect ? '✓' : '✗';
    const resultText = document.getElementById('kcFeedbackText');
    resultText.textContent = isCorrect ? 'Correct' : (type === 'sa' ? 'See model answer' : 'Not quite');
    resultText.className = 'kc-result-text ' + (isCorrect ? 'correct' : 'wrong');

    document.getElementById('kcExplanation').textContent = explanation || '';

    const nextBtn = document.getElementById('kcNextBtn');
    const isLast = kcCurrentIdx >= kcQuestions.length - 1;
    nextBtn.textContent = isLast ? 'See Results' : 'Next Question →';
    nextBtn.className = 'kc-next-btn' + (isLast ? ' last' : '');
    nextBtn.style.display = 'block';
    nextBtn.onclick = kcNextQuestion;

    const explainBtn = document.getElementById('kcExplainBtn');
    explainBtn.style.display = (!isCorrect && type !== 'sa') ? 'block' : 'none';
  }

  function kcNextQuestion() {
    document.getElementById('kcExplainDrawer').style.display = 'none';
    kcCurrentIdx++;
    if (kcCurrentIdx >= kcQuestions.length) {
      showKcResults();
    } else {
      renderKcQuestion();
    }
  }

  async function kcOpenExplain() {
    const q = kcQuestions[kcCurrentIdx];
    const drawer = document.getElementById('kcExplainDrawer');
    drawer.style.display = 'block';
    document.getElementById('kcExplainResponse').textContent = '···';
    document.getElementById('kcExplainInput').value = '';
    kcExplainHistory = [];

    const sp = buildDrawerSystemPrompt('explain') + ' The student got this question wrong: "' + q.question + '"';
    const msg = 'Explain why the correct answer is right and why the student might have gotten confused. Keep it under 100 words.';
    kcExplainHistory = [{role:'user', content: msg}];

    try {
      const reply = await P002Api.callClaude(sp, kcExplainHistory, null, 'haiku');
      document.getElementById('kcExplainResponse').innerHTML = formatBodyText(reply);
      kcExplainHistory.push({role:'assistant', content: reply});
    } catch(e) {
      document.getElementById('kcExplainResponse').textContent = 'Could not load explanation.';
    }
  }

  async function kcSendExplainMessage() {
    const input = document.getElementById('kcExplainInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    kcExplainHistory.push({role:'user', content: text});
    document.getElementById('kcExplainResponse').textContent = '···';
    try {
      const reply = await P002Api.callClaude(buildDrawerSystemPrompt('explain'), kcExplainHistory.slice(-4), null, 'haiku');
      document.getElementById('kcExplainResponse').innerHTML = formatBodyText(reply);
      kcExplainHistory.push({role:'assistant', content: reply});
    } catch(e) {
      document.getElementById('kcExplainResponse').textContent = 'Error: ' + e.message;
    }
  }

  function showKcResults() {
    const total = kcQuestions.length;
    const pct = total > 0 ? Math.round((kcScore / total) * 100) : 0;

    document.getElementById('kcResultsScore').textContent = kcScore + '/' + total;
    document.getElementById('kcResultsPct').textContent = pct + '%';
    document.getElementById('kcResultsTotal').textContent = total;

    let icon = '📖', title = 'Keep it up';
    if (pct === 100) { icon = '🏴'; title = 'Section cleared'; }
    else if (pct >= 67) { icon = '✓'; title = 'Almost there'; }
    else { icon = '⚡'; title = 'Review recommended'; }

    document.getElementById('kcResultsIcon').textContent = icon;
    document.getElementById('kcResultsTitle').textContent = title;

    const missed = total - kcScore;
    document.getElementById('kcResultsMissed').textContent = missed;

    const nextBtn = document.getElementById('kcResultsNextBtn');
    const hasNext = currentModule?.sections &&
      currentModule.sections.findIndex(s => s.file === currentSectionMeta?.file) < currentModule.sections.length - 1;
    nextBtn.textContent = hasNext ? 'Next Section →' : 'Back to Module';
    nextBtn.onclick = hasNext ? goToNextSection : () => showScreen('moduleScreen');

    showScreen('kcResultsScreen');
  }

  function kcRetry() {
    kcCurrentIdx = 0;
    kcScore = 0;
    kcAnswers = [];
    renderKcQuestion();
    showScreen('kcScreen');
  }

  function kcReviewSection() {
    showScreen('readerScreen');
  }
  function renderReaderContent() {
    const body = document.getElementById('readerBody');
    body.innerHTML = '';

    const blocks = sectionData.content || [];

    blocks.forEach(block => {
      const el = renderBlock(block);
      if (el) body.appendChild(el);
    });

    // Challenge CTA at end if challenge exists
    if (sectionData.challenge) {
      const cta = document.createElement('div');
      cta.className = 'reader-challenge-cta';
      cta.innerHTML =
        '<div class="reader-cta-label">End of section</div>' +
        '<div class="reader-cta-title">' + P002Security.escapeHtml(sectionData.challenge.title || 'Practice Challenge') + '</div>' +
        '<div class="reader-cta-desc">' + P002Security.escapeHtml(sectionData.challenge.description || 'Apply what you just read in a hands-on challenge.') + '</div>' +
        '<button class="reader-cta-btn" onclick="P002App.openChallenge()">?? Start Challenge →</button>' +
        '<div class="reader-cta-skip" onclick="P002App.skipChallenge()">Skip for now</div>';
      body.appendChild(cta);
    }

    // Track read progress on scroll
    const progressFill = document.getElementById('readerProgressFill');
    readerScrollHandler = () => {
      const scrollTop = body.scrollTop;
      const scrollHeight = body.scrollHeight - body.clientHeight;
      const pct = scrollHeight > 0 ? Math.min(100, (scrollTop / scrollHeight) * 100) : 0;
      progressFill.style.width = pct + '%';
    };
    body.addEventListener('scroll', readerScrollHandler);
  }

  function renderBlock(block) {
    switch(block.type) {
      case 'heading': {
        const el = document.createElement('div');
        el.className = 'content-heading';
        el.textContent = block.text || '';
        return el;
      }
      case 'body': {
        const el = document.createElement('div');
        el.className = 'content-body';
        // Allow basic markdown: **bold**, `code`
        el.innerHTML = formatBodyText(block.text || '');
        return el;
      }
      case 'code': {
        const el = document.createElement('div');
        el.className = 'content-code';
        el.textContent = block.text || '';
        if (block.lang) {
          el.dataset.lang = block.lang;
        }
        return el;
      }
      case 'callout': {
        const el = document.createElement('div');
        el.className = 'content-callout';
        el.innerHTML =
          '<div class="content-callout-icon">⚡</div>' +
          '<div class="content-callout-text">' + formatBodyText(block.text || '') + '</div>';
        return el;
      }
      default:
        return null;
    }
  }

  function formatBodyText(text) {
    // Escape HTML first
    let safe = P002Security.escapeHtml(text);
    // Parse markdown headings before other formatting
    safe = safe
      .replace(/^### (.+)$/gm, '<strong style="font-size:13px;color:var(--text);">$1</strong>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:15px;color:var(--text);display:block;margin:10px 0 4px;">$1</strong>')
      .replace(/^# (.+)$/gm, '<strong style="font-size:17px;color:var(--text);display:block;margin:14px 0 6px;">$1</strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return safe;
  }

  function removeTextSelectionHandler() {
    const body = document.getElementById('readerBody');
    if (body && readerScrollHandler) {
      body.removeEventListener('scroll', readerScrollHandler);
      readerScrollHandler = null;
    }
    document.removeEventListener('selectionchange', onSelectionChange);
    hidePopup();
  }

  // ==================== TEXT SELECTION + POPUP ====================
  let selectionChangeTimeout = null;

  function initTextSelection() {
    document.addEventListener('selectionchange', onSelectionChange);
  }

  function onSelectionChange() {
    clearTimeout(selectionChangeTimeout);
    selectionChangeTimeout = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (!text || text.length < 3) {
        hidePopup();
        return;
      }

      // Only trigger if selection is inside reader body
      const readerBody = document.getElementById('readerBody');
      if (!readerBody) return;

      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (!readerBody.contains(container)) {
        hidePopup();
        return;
      }

      selectedText = text;
      showPopupNearSelection(range);
    }, 200);
  }

  function showPopupNearSelection(range) {
    const popup = document.getElementById('askAiPopup');
    const rect = range.getBoundingClientRect();

    let top = rect.top - 48 - 10; // above selection, account for header
    let left = rect.left;

    // Keep popup on screen
    const popupWidth = 280;
    if (left + popupWidth > window.innerWidth - 10) {
      left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) left = 10;

    // If too close to top, show below
    if (top < 58) {
      top = rect.bottom - 48 + 10;
      // Move caret to top
      popup.style.setProperty('--caret-top', 'none');
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.classList.add('visible');
  }

  function hidePopup() {
    document.getElementById('askAiPopup').classList.remove('visible');
  }

  async function handlePopupAction(action) {
    if (!selectedText) return;
    hidePopup();
    window.getSelection()?.removeAllRanges();

    if (action === 'chat') {
      // Open full chat with context
      openFreeChat(selectedText);
      return;
    }

    // Open drawer
    const labels = {
      explain: 'Explain',
      example: 'Example',
      deeper: 'Go Deeper'
    };

    currentDrawerAction = action;
    drawerHistory = [];

    document.getElementById('drawerMode').textContent = labels[action] || 'Ask AI';
    document.getElementById('drawerContext').textContent = selectedText.slice(0, 60) + (selectedText.length > 60 ? '...' : '');

    const quoteWrap = document.getElementById('drawerQuoteWrap');
    quoteWrap.style.display = 'block';
    document.getElementById('drawerQuote').textContent = '"' + selectedText.slice(0, 120) + (selectedText.length > 120 ? '...' : '') + '"';

    document.getElementById('drawerResponse').textContent = '';
    document.getElementById('drawerChips').innerHTML = '';
    document.getElementById('drawerTyping').style.display = 'flex';

    openDrawer();

    // Call Claude
    const systemPrompt = buildDrawerSystemPrompt(action);
    const userMsg = buildDrawerUserMessage(action, selectedText);

    try {
      const reply = await P002Api.callClaude(systemPrompt, [{ role: 'user', content: userMsg }]);
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').innerHTML = formatBodyText(reply);
      drawerHistory = [
        { role: 'user', content: userMsg },
        { role: 'assistant', content: reply }
      ];
      renderDrawerChips();
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').textContent = 'Error: ' + e.message;
    }
  }

  function buildDrawerSystemPrompt(action) {
    const sectionTitle = sectionData?.meta?.title || '';
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor helping a student learn cybersecurity. The student is reading a section titled "${sectionTitle}". Context: ${aiContext}

Be concise and direct. Responses should be 2-4 sentences max unless a code example is needed. No filler, no preamble.`;
  }

  function buildDrawerUserMessage(action, text) {
    const prompts = {
      explain: `Explain this in simple terms: "${text}"`,
      example: `Give me a concrete real-world example of: "${text}"`,
      deeper: `Go deeper on this concept: "${text}" — what's the technical detail a beginner would miss?`
    };
    return prompts[action] || `Tell me about: "${text}"`;
  }

  function renderDrawerChips() {
    const chips = document.getElementById('drawerChips');
    const options = ['Show me in code', 'Real attack example', 'Why does this matter', 'Test me on this'];
    chips.innerHTML = '';
    options.forEach(opt => {
      const chip = document.createElement('div');
      chip.className = 'drawer-chip';
      chip.textContent = opt;
      chip.onclick = () => sendDrawerChip(opt);
      chips.appendChild(chip);
    });
  }

  async function sendDrawerChip(text) {
    document.getElementById('drawerChips').innerHTML = '';
    await sendDrawerMessageText(text);
  }

  async function sendDrawerMessage() {
    const input = document.getElementById('drawerInput');
    const text = P002Security.sanitizeInput(input.value.trim(), 500);
    if (!text) return;
    input.value = '';
    await sendDrawerMessageText(text);
  }

  async function sendDrawerMessageText(text) {
    document.getElementById('drawerTyping').style.display = 'flex';
    document.getElementById('drawerSendBtn').disabled = true;

    drawerHistory.push({ role: 'user', content: text });

    // Append user message to response area
    const responseEl = document.getElementById('drawerResponse');
    responseEl.innerHTML += '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,77,77,0.08);border-radius:8px;font-size:12px;color:#ccc;">' + P002Security.escapeHtml(text) + '</div>';

    try {
      const systemPrompt = buildDrawerSystemPrompt(currentDrawerAction);
      const reply = await P002Api.callClaude(systemPrompt, drawerHistory.slice(-10));
      document.getElementById('drawerTyping').style.display = 'none';
      drawerHistory.push({ role: 'assistant', content: reply });
      responseEl.innerHTML += '<div style="margin-top:8px;">' + formatBodyText(reply) + '</div>';
      renderDrawerChips();
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      responseEl.innerHTML += '<div style="color:var(--danger);font-size:12px;margin-top:8px;">Error: ' + P002Security.escapeHtml(e.message) + '</div>';
    }

    document.getElementById('drawerSendBtn').disabled = false;

    // Scroll drawer to bottom
    const scroll = document.getElementById('drawerScroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  function openDrawer() {
    document.getElementById('aiDrawer').classList.add('visible');
    document.getElementById('aiDrawerOverlay').classList.add('visible');
  }

  function closeDrawer() {
    document.getElementById('aiDrawer').classList.remove('visible');
    document.getElementById('aiDrawerOverlay').classList.remove('visible');
    hidePopup();
  }

  // ==================== FREE CHAT ====================
  function openFreeChat(contextText) {
    chatMode = 'free';
    chatHistory = [];

    document.getElementById('chatHeaderLabel').textContent = 'AI Tutor';
    document.getElementById('chatHeaderTitle').textContent = sectionData?.meta?.title || 'Free chat';
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('chatContinueBtn').style.display = 'none';

    const msgs = document.getElementById('messages');
    msgs.innerHTML = '';

    showScreen('chatScreen');

    // Open with context if text was selected
    if (contextText) {
      const systemPrompt = buildFreeChatSystemPrompt();
      const userMsg = 'I want to chat about this: "' + contextText + '"';
      addMessage('user', userMsg);
      chatHistory.push({ role: 'user', content: userMsg });
      callClaude(systemPrompt, chatHistory);
    } else {
      // Open with greeting
      const systemPrompt = buildFreeChatSystemPrompt();
      callClaude(systemPrompt, [{ role: 'user', content: 'Hi, I just read the section and want to ask some questions.' }]);
    }
  }

  function closeFreeChat() {
    showScreen('readerScreen');
    document.getElementById('debriefBanner').style.display = 'none';
  }

  function buildFreeChatSystemPrompt() {
    const title = sectionData?.meta?.title || '';
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor for a cybersecurity learning platform. The student has just read a section titled "${title}". Context: ${aiContext}

Answer questions clearly and concisely. If they ask something off-topic, gently redirect to the section content. Don't be preachy. Keep responses focused.`;
  }

  // ==================== CHALLENGE SCREEN ====================
  function openChallenge() {
    if (!sectionData?.challenge) return;
    const ch = sectionData.challenge;
    currentHintIndex = 0;
    currentChallengePassed = false;

    document.getElementById('challengeBackLabel').textContent = sectionData.meta?.title || 'Back to reading';
    document.getElementById('challengeTitle').textContent = ch.title || 'Practice Challenge';
    document.getElementById('challengeDesc').textContent = ch.description || '';

    renderChallengeBody(ch);
    showScreen('challengeScreen');
  }

  function renderChallengeBody(ch) {
    const body = document.getElementById('challengeBody');
    body.innerHTML = '';

    // Query display
    if (ch.query) {
      const queryEl = document.createElement('div');
      queryEl.className = 'challenge-query';
      queryEl.textContent = ch.query;
      body.appendChild(queryEl);
    }

    // Simulated target app (login form for SQLi)
    if (ch.sim_type === 'login' || ch.query) {
      const sim = document.createElement('div');
      sim.className = 'target-app';
      sim.innerHTML =
        '<div class="target-app-bar">' +
          '<div class="target-dot" style="background:#ff5f57"></div>' +
          '<div class="target-dot" style="background:#febc2e"></div>' +
          '<div class="target-dot" style="background:#28c840"></div>' +
          '<div class="target-url">vuln-lab.local/login</div>' +
        '</div>' +
        '<div class="target-app-body">' +
          '<div class="target-label">Username</div>' +
          '<input class="target-input" id="simUser" value="admin" readonly />' +
          '<div class="target-label" style="margin-top:8px;">Password</div>' +
          '<input class="target-input" id="simPass" placeholder="Enter password..." />' +
          '<button class="target-submit-btn" style="margin-top:10px;" onclick="P002App.trySimLogin()">Login</button>' +
          '<div id="simResult" style="margin-top:10px;font-size:12px;text-align:center;min-height:18px;"></div>' +
        '</div>';
      body.appendChild(sim);
    }

    // Flag submission area
    const flagArea = document.createElement('div');
    flagArea.className = 'flag-area';
    flagArea.innerHTML =
      '<div class="flag-label">?? Your Payload</div>' +
      '<input class="flag-input" id="flagInput" placeholder="Enter your payload..." ' +
        'onkeydown="if(event.key===&#39;Enter&#39;)P002App.submitFlag()" />' +
      '<button class="flag-submit" onclick="P002App.submitFlag()">Submit Flag</button>';
    body.appendChild(flagArea);

    // Help row
    const helpRow = document.createElement('div');
    helpRow.className = 'challenge-help-row';
    helpRow.innerHTML =
      '<button class="challenge-help-btn" onclick="P002App.backToReader()">?? Review</button>' +
      '<button class="challenge-help-btn ai" onclick="P002App.showHint()">?? Hint</button>' +
      '<button class="challenge-help-btn ai" onclick="P002App.openChallengeChat()">?? Discuss</button>';
    body.appendChild(helpRow);
  }

  function trySimLogin() {
    const pass = document.getElementById('simPass')?.value || '';
    const result = document.getElementById('simResult');
    const flag = sectionData?.challenge?.flag || '';

    // Check if the payload is the flag or contains injection
    const isInjection = pass.includes("'") && (pass.toLowerCase().includes('or') || pass.includes('1=1') || pass.includes('--'));

    if (pass.toLowerCase().trim() === flag.toLowerCase().trim() || isInjection) {
      result.innerHTML = '<span style="color:#4ade80;">⚠️ SQL Error — Login bypassed! Access granted.</span>';
      document.getElementById('flagInput').value = pass;
    } else if (pass === 'admin123' || pass === 'password') {
      result.innerHTML = '<span style="color:#4ade80;">✓ Login successful (correct credentials)</span>';
    } else {
      result.innerHTML = '<span style="color:#ff4d4d;">✗ Invalid credentials</span>';
    }
  }

  function submitFlag() {
    const input = document.getElementById('flagInput');
    const submitted = P002Security.sanitizeInput(input.value.trim(), 200);
    const correct = sectionData?.challenge?.flag || '';

    if (!submitted) return;

    if (submitted.toLowerCase() === correct.toLowerCase()) {
      flagCaptured(submitted);
    } else {
      // Fuzzy match for common variations
      const normalizedSubmit = submitted.replace(/\s/g, '').toLowerCase();
      const normalizedCorrect = correct.replace(/\s/g, '').toLowerCase();
      if (normalizedSubmit === normalizedCorrect) {
        flagCaptured(submitted);
        return;
      }
      showToast('Incorrect — try again', false);
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => input.style.borderColor = '', 1500);
    }
  }

  async function flagCaptured(payload) {
    currentChallengePassed = true;
    showToast('?? Flag captured!', true);

    try {
      if (currentSessionId) await P002Api.captureFlag(currentSessionId);
    } catch(e) { /* non-critical */ }

    // Go to debrief
    openDebrief(payload);
  }

  function backToReader() {
    closeHintDrawer();
    showScreen('readerScreen');
  }

  function skipChallenge() {
    showScreen('homeScreen');
  }

  // ==================== HINT SYSTEM ====================
  function showHint() {
    const hints = sectionData?.challenge?.hints || [];
    if (!hints.length) {
      showToast('No hints available', false);
      return;
    }

    const hint = hints[currentHintIndex] || hints[hints.length - 1];
    document.getElementById('hintLabel').textContent = 'Hint ' + (currentHintIndex + 1) + ' of ' + hints.length;
    document.getElementById('hintText').innerHTML = formatBodyText(hint);

    document.getElementById('hintDrawer').classList.add('visible');
  }

  function nextHint() {
    const hints = sectionData?.challenge?.hints || [];
    if (currentHintIndex < hints.length - 1) {
      currentHintIndex++;
      showHint();
    } else {
      closeHintDrawer();
    }
  }

  function closeHintDrawer() {
    document.getElementById('hintDrawer').classList.remove('visible');
  }

  function openChallengeChat() {
    chatMode = 'free';
    chatHistory = [];
    document.getElementById('chatHeaderLabel').textContent = 'AI Tutor';
    document.getElementById('chatHeaderTitle').textContent = 'Challenge Help';
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('chatContinueBtn').style.display = 'none';

    const msgs = document.getElementById('messages');
    msgs.innerHTML = '';
    showScreen('chatScreen');

    const systemPrompt = buildChallengeChatSystemPrompt();
    callClaude(systemPrompt, [{ role: 'user', content: "I'm stuck on the challenge. Give me a hint without giving away the answer." }]);
  }

  function buildChallengeChatSystemPrompt() {
    const ch = sectionData?.challenge;
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor helping a student with a cybersecurity challenge. Context: ${aiContext}

Challenge: ${ch?.title || ''}. Description: ${ch?.description || ''}

Give hints that guide without giving the answer directly. If they're really stuck after 3 messages, you can give more direct guidance. Keep responses concise.`;
  }

  // ==================== DEBRIEF ====================
  function openDebrief(payload) {
    chatMode = 'debrief';
    chatHistory = [];

    document.getElementById('chatHeaderLabel').textContent = 'Debrief';
    document.getElementById('chatHeaderTitle').textContent = sectionData?.meta?.title || 'Section complete';
    document.getElementById('chatContinueBtn').style.display = 'block';

    // Show debrief banner
    document.getElementById('debriefBanner').style.display = 'block';
    document.getElementById('debriefBannerTitle').textContent = 'Flag captured — ' + P002Security.escapeHtml(payload);
    document.getElementById('debriefBannerSub').textContent = (sectionData?.meta?.title || '') + ' complete';

    const msgs = document.getElementById('messages');
    msgs.innerHTML = '';
    showScreen('chatScreen');

    // Adjust messages padding to account for debrief banner
    msgs.style.paddingTop = '60px';

    // Auto-debrief
    const systemPrompt = buildDebriefSystemPrompt(payload);
    const userMsg = `I just captured the flag with payload: "${payload}". Debrief me on what I did and why it worked.`;
    chatHistory.push({ role: 'user', content: userMsg });
    callClaude(systemPrompt, chatHistory);
  }

  function buildDebriefSystemPrompt(payload) {
    const ch = sectionData?.challenge;
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor debriefing a student after they solved a cybersecurity challenge. Context: ${aiContext}

The student submitted payload: "${payload}". Flag: "${ch?.flag || ''}".

Explain in 3-4 sentences: what their payload did, why it worked at the SQL/code level, and the real-world impact. Then offer to go deeper on any aspect. Be direct, no filler.`;
  }

  function continueAfterDebrief() {
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('messages').style.paddingTop = '';
    showScreen('homeScreen');
  }

  // ==================== CHAT (shared) ====================
  async function callClaude(systemPrompt, messages) {
    document.getElementById('sendBtn').disabled = true;
    showTyping();

    try {
      const sig = await P002Api.signPrompt(systemPrompt);
      const trimmed = messages.slice(-20);
      const reply = await P002Api.callClaude(systemPrompt, trimmed, sig);
      removeTyping();

      chatHistory.push({ role: 'assistant', content: reply });
      addMessage('assistant', reply);

      // Add quick reply chips for debrief
      if (chatMode === 'debrief' && chatHistory.length <= 3) {
        addChatChips(['How do I prevent this?', "What's the real-world impact?", 'Go deeper on the query']);
      }

    } catch(e) {
      removeTyping();
      showToast('Error: ' + P002Security.escapeHtml(e.message));
    }

    document.getElementById('sendBtn').disabled = false;
    document.getElementById('userInput').focus();
  }

  function sendMessage() {
    const input = document.getElementById('userInput');
    const text = input.value.trim();
    if (!text || document.getElementById('sendBtn').disabled) return;

    const sanitized = P002Security.sanitizeInput(text, 2000);
    addMessage('user', sanitized);
    input.value = '';
    input.style.height = 'auto';

    chatHistory.push({ role: 'user', content: sanitized });

    // Remove chips
    document.querySelectorAll('.chat-chips').forEach(c => c.remove());

    const systemPrompt = chatMode === 'debrief'
      ? buildDebriefSystemPrompt(sectionData?.challenge?.flag || '')
      : buildFreeChatSystemPrompt();

    callClaude(systemPrompt, chatHistory);
  }

  function addChatChips(options) {
    const msgs = document.getElementById('messages');
    const wrap = document.createElement('div');
    wrap.className = 'chat-chips';
    options.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'chat-chip';
      chip.textContent = opt;
      chip.onclick = () => {
        wrap.remove();
        const sanitized = P002Security.sanitizeInput(opt, 200);
        addMessage('user', sanitized);
        chatHistory.push({ role: 'user', content: sanitized });
        const sp = chatMode === 'debrief'
          ? buildDebriefSystemPrompt(sectionData?.challenge?.flag || '')
          : buildFreeChatSystemPrompt();
        callClaude(sp, chatHistory);
      };
      wrap.appendChild(chip);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ==================== MESSAGE RENDERING ====================
  function addMessage(role, content) {
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = formatChatMessage(content);
    div.appendChild(bubble);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTyping() {
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = 'typing-indicator';
    const bubble = document.createElement('div');
    bubble.className = 'typing-bubble';
    bubble.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    div.appendChild(bubble);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('typing-indicator');
    if (t) t.remove();
  }

  function formatChatMessage(text) {
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + P002Security.escapeHtml(code.trim()) + '</code></pre>');
      return '%%CB' + idx + '%%';
    });
    const inlineCode = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCode.length;
      inlineCode.push('<code>' + P002Security.escapeHtml(code) + '</code>');
      return '%%IC' + idx + '%%';
    });
    text = P002Security.escapeHtml(text);
    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
    codeBlocks.forEach((b, i) => { text = text.replace('%%CB' + i + '%%', b); });
    inlineCode.forEach((c, i) => { text = text.replace('%%IC' + i + '%%', c); });
    return text;
  }

  // ==================== LEGACY FALLBACK ====================
  // For old-schema sections — keeps basic chat working
  function startLegacySession() {
    showToast('Legacy section format — basic chat mode', false);
    // Minimal fallback: open a free chat screen
    chatMode = 'free';
    chatHistory = [];
    document.getElementById('chatHeaderLabel').textContent = 'Session';
    document.getElementById('chatHeaderTitle').textContent = sectionData?.lesson?.title || 'Lesson';
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('chatContinueBtn').style.display = 'none';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('messages').style.paddingTop = '';
    showScreen('chatScreen');
    document.getElementById('endBtn').style.display = 'block';

    const sp = (sectionData?.system_prompt || 'You are a cybersecurity instructor.') +
      (sectionData?.reading_material ? '\n\nREADING MATERIAL:\n' + sectionData.reading_material : '');
    callClaude(sp, [{ role: 'user', content: 'Begin the lesson.' }]);
  }

  // ==================== UI HELPERS ====================
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function setStatus(online, label) {
    document.getElementById('statusDot').className = 'status-dot' + (online ? ' online' : '');
    document.getElementById('statusText').textContent = label;
  }

  function showToast(msg, success = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = success ? 'var(--success)' : 'var(--surface)';
    toast.style.color = success ? '#000' : 'var(--text)';
    toast.style.border = '1px solid ' + (success ? 'var(--success)' : 'var(--border2)');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideAuthError() {
    document.getElementById('authError').style.display = 'none';
  }

  function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ==================== PUBLIC API ====================
  return {
    init,
    handleAuth,
    logout,
    switchTab,
    loadModuleCatalog,
    openModule,
    backToHome,
    backToModule,
    openSectionPreview,
    backToSectionPreview,
    startReading,
    endReading,
    // Sticky next + KC flow
    stickyNextTapped,
    skipKcGoNext,
    startKnowledgeCheck,
    submitKcAnswer,
    kcNextQuestion,
    kcOpenExplain,
    kcSendExplainMessage,
    kcRetry,
    kcReviewSection,
    goToNextSection,
    // Reader drawer
    handlePopupAction,
    closeDrawer,
    sendDrawerMessage,
    openFreeChat,
    closeFreeChat,
    openChallenge,
    skipChallenge,
    trySimLogin,
    submitFlag,
    showHint,
    nextHint,
    closeHintDrawer,
    openChallengeChat,
    continueAfterDebrief,
    backToReader,
    sendMessage,
    handleChatKey,
    autoResize,
    showAdmin,
    showToast,
  };

})();

// Boot
window.addEventListener('load', P002App.init);