// ================================================================
// PROJECT 002 -- app.js
// Reading platform logic
// Depends on: security.js, api.js, fetch.js
// ================================================================

window.P002App = (() => {

  // ==================== STATE ====================
  let currentUser = null;
  let sectionData = null;
  let currentSessionId = null;

  // Reader state
  let readerScrollHandler = null;

  // Drawer state
  let drawerHistory = [];
  let selectedText = '';
  let currentDrawerAction = '';

  // Chat state
  let chatHistory = [];
  let chatMode = 'free';
  let currentChallengePassed = false;

  // Challenge state
  let currentHintIndex = 0;

  // Knowledge check state
  let kcQuestions = [];
  let kcCurrentIdx = 0;
  let kcScore = 0;
  let kcAnswers = [];
  let kcExplainHistory = [];

  // Library state
  let libDotInterval = null;

  const LIB_SUGGESTIONS = ['electronics', 'science', 'history', 'medicine', 'engineering', 'mathematics', 'astronomy', 'chemistry'];

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
    loadMyCourses();
  }

  // ==================== COURSE CATALOG ====================
  async function loadMyCourses() {
    const grid = document.getElementById('moduleGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="skeleton-card"><div class="skeleton-line" style="height:10px;width:35%;"></div><div class="skeleton-line" style="height:16px;width:65%;margin-top:8px;"></div></div>';

    try {
      const { courses } = await P002Api.getMyCourses();

      if (!courses || !courses.length) {
        grid.innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">No courses yet — browse the library or upload a document to get started.</div>';
        return;
      }

      const byStatus = {
        generating: courses.filter(c => c.status === 'generating' || c.status === 'partial'),
        ready:      courses.filter(c => c.status === 'ready'),
        error:      courses.filter(c => c.status === 'error'),
      };

      grid.innerHTML = '';

      Object.entries(byStatus).forEach(([status, list]) => {
        if (!list.length) return;
        const labels = { generating: 'Generating', ready: 'Your Courses', error: 'Failed' };
        const group = document.createElement('div');
        group.style.cssText = 'margin-bottom:8px;';
        const label = document.createElement('div');
        label.style.cssText = 'padding:16px 16px 8px;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:var(--text-dim);';
        label.textContent = labels[status];
        group.appendChild(label);
        list.forEach(c => group.appendChild(buildCourseCard(c)));
        grid.appendChild(group);
      });

    } catch(e) {
      grid.innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">Error loading courses: ' + P002Security.escapeHtml(e.message) + '</div>';
    }
  }

  function buildCourseCard(course) {
    const card = document.createElement('div');
    card.style.cssText = 'margin:0 16px 8px;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color 0.15s,transform 0.15s;';

    const diffColors = { beginner: 'var(--success)', intermediate: 'var(--warn)', advanced: 'var(--accent)' };
    const statusColors = { ready: '', generating: 'var(--warn)', error: 'var(--danger)', partial: 'var(--warn)' };
    const icon = course.icon || '📚';
    const color = course.color || 'var(--accent)';

    card.innerHTML =
      '<div style="padding:14px 16px;display:flex;align-items:center;gap:14px;">' +
        '<div style="width:44px;height:44px;border-radius:10px;background:' + color + '22;border:1px solid ' + color + '44;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:' + (diffColors[course.difficulty] || 'var(--warn)') + ';margin-bottom:4px;">' + (course.difficulty || '') + '</div>' +
          '<div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);line-height:1.2;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + P002Security.escapeHtml(course.title) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">' +
            (course.status === 'generating' ? '⏳ Generating...' :
             course.status === 'error' ? '✗ Generation failed' :
             (course.section_count || 0) + ' sections' + (course.category ? ' · ' + course.category : '')) +
          '</div>' +
        '</div>' +
        '<div style="color:var(--text-dim);font-size:16px;">' + (course.status === 'generating' ? '⏳' : '›') + '</div>' +
      '</div>';

    card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--border2)'; card.style.transform = 'translateX(2px)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--border)'; card.style.transform = ''; });

    if (course.status === 'ready') {
      // Long press = edit, tap = open
      let pressTimer = null;
      let didLongPress = false;

      card.addEventListener('mousedown', () => {
        didLongPress = false;
        pressTimer = setTimeout(() => {
          didLongPress = true;
          editCourse(course);
        }, 600);
      });
      card.addEventListener('touchstart', () => {
        didLongPress = false;
        pressTimer = setTimeout(() => {
          didLongPress = true;
          editCourse(course);
        }, 600);
      }, { passive: true });
      card.addEventListener('mouseup', () => clearTimeout(pressTimer));
      card.addEventListener('touchend', () => clearTimeout(pressTimer));
      card.addEventListener('click', () => { if (!didLongPress) openCourse(course.id); });
    }
    return card;
  }

  function editCourse(course) {
    const existing = document.getElementById('editCourseModal');
    if (existing) existing.remove();

    // Common emojis for quick pick
    const emojis = ['📚','🧠','💡','🔬','⚡','🛡','🌐','💻','🔗','🧬','🏥','📖','🎯','⚙','🔐','🌿','🎓','📊','🧪','🌍'];

    const modal = document.createElement('div');
    modal.id = 'editCourseModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:flex-end;backdrop-filter:blur(4px);';

    modal.innerHTML =
      '<div style="background:#111013;border-radius:20px 20px 0 0;border:1px solid rgba(255,255,255,0.08);width:100%;padding:0 0 32px;">' +
        '<div style="padding:10px 0;display:flex;justify-content:center;">' +
          '<div style="width:36px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;"></div>' +
        '</div>' +
        '<div style="padding:8px 20px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="font-family:var(--font-display);font-size:17px;font-weight:800;color:var(--text);letter-spacing:-0.5px;">Edit course</div>' +
        '</div>' +
        '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">' +
          // Title
          '<div>' +
            '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Title</div>' +
            '<input id="editCourseTitle" value="' + P002Security.escapeHtml(course.title) + '" ' +
              'style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:var(--font-body);font-size:14px;color:var(--text);outline:none;box-sizing:border-box;" />' +
          '</div>' +
          // Emoji picker
          '<div>' +
            '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Icon</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
              emojis.map(e =>
                '<button class="emoji-pick-btn" data-emoji="' + e + '" style="width:38px;height:38px;border-radius:8px;font-size:18px;cursor:pointer;transition:all 0.15s;' +
                (e === (course.icon || '📚') ? 'background:rgba(255,77,77,0.15);border:1px solid rgba(255,77,77,0.4);' : 'background:var(--surface);border:1px solid var(--border);') +
                '">' + e + '</button>'
              ).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:0 20px;display:flex;gap:10px;">' +
          '<button id="editCourseCancel" style="flex:1;background:transparent;border:1px solid var(--border);border-radius:12px;padding:14px;font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--text-muted);cursor:pointer;">Cancel</button>' +
          '<button id="editCourseSave" style="flex:2;background:var(--accent);border:none;border-radius:12px;padding:14px;font-family:var(--font-display);font-size:15px;font-weight:800;color:#fff;cursor:pointer;">Save</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    let selectedEmoji = course.icon || '📚';

    // Emoji selection
    modal.querySelectorAll('.emoji-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedEmoji = btn.dataset.emoji;
        modal.querySelectorAll('.emoji-pick-btn').forEach(b => {
          const active = b.dataset.emoji === selectedEmoji;
          b.style.background = active ? 'rgba(255,77,77,0.15)' : 'var(--surface)';
          b.style.borderColor = active ? 'rgba(255,77,77,0.4)' : 'var(--border)';
        });
      });
    });

    document.getElementById('editCourseCancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('editCourseSave').addEventListener('click', async () => {
      const newTitle = document.getElementById('editCourseTitle').value.trim();
      if (!newTitle) return;
      try {
        const { error } = await P002Api.getClient()
          .from('courses')
          .update({ title: newTitle, icon: selectedEmoji, updated_at: new Date().toISOString() })
          .eq('id', course.id);
        if (error) throw error;
        modal.remove();
        showToast('Course updated', true);
        loadMyCourses(); // refresh home screen
      } catch(e) {
        showToast('Error: ' + e.message, false);
      }
    });
  }

  async function openCourse(courseId) {
    try {
      const { course, sections } = await P002Api.getCourse(courseId);
      // Store current course data
      window._currentCourse = { course, sections };
      // Render module detail screen using DB data
      renderCourseDetail(course, sections);
      showScreen('moduleScreen');
    } catch(e) {
      showToast('Error loading course: ' + e.message, false);
    }
  }

  function renderCourseDetail(course, sections) {
    document.getElementById('moduleDetailCategory').textContent = (course.category || '') + (course.difficulty ? ' · ' + course.difficulty : '');
    document.getElementById('moduleDetailTitle').textContent = course.title;
    document.getElementById('moduleDetailDesc').textContent = course.description || '';
    document.getElementById('moduleDetailStats').innerHTML =
      '<div class="module-stat"><span class="module-stat-value">' + sections.length + '</span><span class="module-stat-label">Sections</span></div>';

    const list = document.getElementById('moduleSectionList');
    list.innerHTML = '';
    sections.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'section-row';
      row.innerHTML =
        '<div class="section-num">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="section-info">' +
          '<div class="section-title">' + P002Security.escapeHtml(s.title) + '</div>' +
          '<div class="section-meta-row">' +
            '<span class="section-time">⏱ ' + (s.minutes || '?') + ' min</span>' +
            '<span class="section-diff ' + (s.difficulty || 'beginner') + '">' + (s.difficulty || '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="section-chevron">›</div>';
      row.addEventListener('click', () => openSectionFromDB(s, course, sections));
      list.appendChild(row);
    });
  }

  function openSectionFromDB(section, course, sections) {
    // Map DB section to sectionData format the reader expects
    sectionData = {
      meta: {
        title:          section.title,
        section:        section.section_number,
        total_sections: sections.length,
        module:         course.title,
      },
      content:         section.content_json || [],
      knowledge_check: section.knowledge_check_json || { questions: [] },
      challenge:       section.challenge_json || null,
      ai_context:      section.ai_context || '',
    };

    // Store for navigation
    window._currentSectionId = section.id;
    window._currentCourseId  = course.id;

    document.getElementById('sectionBackLabel').textContent = course.title;
    document.getElementById('sectionPreviewMeta').textContent =
      'Section ' + section.section_number + ' of ' + sections.length +
      ' · ' + (section.difficulty || '') +
      ' · ' + (section.minutes || '?') + ' min';
    document.getElementById('sectionPreviewTitle').textContent = section.title;
    document.getElementById('sectionPreviewDesc').textContent = section.description || '';
    document.getElementById('sectionPreviewBody').innerHTML = '';
    document.getElementById('sectionStartBtn').disabled = false;
    document.getElementById('sectionStartBtn').textContent = 'Start Reading →';
    document.getElementById('sectionStartStatus').textContent = '';

    showScreen('sectionScreen');
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

  // ==================== MODULE / SECTION NAV ====================

  function backToHome() { showScreen('homeScreen'); }
  function showAdmin() { window.location.href = '/project-002/admin.html'; }

  // ==================== START READING ====================
  async function startReading() {
    if (!sectionData) return;

    const validation = P002Security.validateLessonJson(JSON.stringify(sectionData));

    if (validation.schema === 'legacy') {
      startLegacySession();
      return;
    }

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

    const readerContent = document.getElementById('readerContent');
    const stickyBar = document.getElementById('readerStickyNext');
    if (stickyBar) stickyBar.style.display = 'none';
    if (readerContent) {
      readerScrollHandler = () => {
        const nearBottom = readerContent.scrollTop + readerContent.clientHeight >= readerContent.scrollHeight - 60;
        if (stickyBar) stickyBar.style.display = nearBottom ? 'flex' : 'none';
        const pct = readerContent.scrollHeight <= readerContent.clientHeight ? 100 :
          Math.min(100, Math.round((readerContent.scrollTop / (readerContent.scrollHeight - readerContent.clientHeight)) * 100));
        document.getElementById('readerProgressFill').style.width = pct + '%';
      };
      readerContent.addEventListener('scroll', readerScrollHandler);
    }

    const nextMeta = null; // TODO: wire to DB section list
    const nextTitle = document.getElementById('stickyNextTitle');
    if (nextTitle) nextTitle.textContent = nextMeta?.title || 'Module complete';

    try {
      currentSessionId = await P002Api.createSession(meta.section, meta.module);
    } catch(e) {
      console.warn('Session creation failed:', e.message);
    }
  }

  function backToSectionPreview() {
    closeDrawer();
    removeTextSelectionHandler();
    const readerContent = document.getElementById('readerContent');
    if (readerContent && readerScrollHandler) {
      readerContent.removeEventListener('scroll', readerScrollHandler);
      readerScrollHandler = null;
    }
    document.getElementById('endBtn').style.display = 'none';
    document.getElementById('settingsBtn').style.display = 'block';
    const stickyBar = document.getElementById('readerStickyNext');
    if (stickyBar) stickyBar.style.display = 'none';
    backToSectionList();
  }

  function endReading() {
    removeTextSelectionHandler();
    closeDrawer();
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

  function skipKcGoNext() { goToNextSection(); }

  function goToNextSection() {
    if (!window._currentCourse) { showScreen('homeScreen'); return; }
    const { course, sections } = window._currentCourse;
    const currentNum = sectionData?.meta?.section;
    const currentIdx = sections.findIndex(s => s.section_number === currentNum);
    const nextSection = sections[currentIdx + 1];
    if (nextSection) {
      openSectionFromDB(nextSection, course, sections);
    } else {
      // Last section — back to course detail
      showScreen('moduleScreen');
      showToast('Course complete!', true);
    }
  }

  function backToSectionList() {
    // Go back to course detail / section list
    if (window._currentCourse) {
      const { course, sections } = window._currentCourse;
      renderCourseDetail(course, sections);
    }
    showScreen('moduleScreen');
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

    const titleEl = document.getElementById('kcSectionTitle');
    if (titleEl) titleEl.textContent = sectionData?.meta?.title || 'Knowledge Check';

    showScreen('kcScreen');
    renderKcQuestion();
  }

  function renderKcQuestion() {
    const q = kcQuestions[kcCurrentIdx];
    if (!q) { showKcResults(); return; }

    const dotsEl = document.getElementById('kcDots');
    dotsEl.innerHTML = '';
    kcQuestions.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'kc-dot' + (i < kcCurrentIdx ? ' done' : i === kcCurrentIdx ? ' active' : '');
      dotsEl.appendChild(dot);
    });

    document.getElementById('kcCounter').textContent = (kcCurrentIdx + 1) + ' / ' + kcQuestions.length;
    document.getElementById('kcQuestion').textContent = q.question;
    document.getElementById('kcFeedback').style.display = 'none';
    document.getElementById('kcExplainDrawer').style.display = 'none';

    const optionsEl = document.getElementById('kcOptions');
    optionsEl.innerHTML = '';

    if (q.type === 'mc') {
      q.options.forEach((opt) => {
        const el = document.createElement('div');
        el.className = 'kc-option';
        el.dataset.value = opt.charAt(0);
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
    if (kcCurrentIdx >= kcQuestions.length) showKcResults();
    else renderKcQuestion();
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
    document.getElementById('kcResultsMissed').textContent = total - kcScore;

    const nextBtn = document.getElementById('kcResultsNextBtn');
    const hasNext = false; // TODO: wire to DB section list
    nextBtn.textContent = hasNext ? 'Next Section →' : 'Back to Module';
    nextBtn.onclick = hasNext ? goToNextSection : () => showScreen('moduleScreen');

    showScreen('kcResultsScreen');
  }

  function kcRetry() {
    kcCurrentIdx = 0; kcScore = 0; kcAnswers = [];
    renderKcQuestion();
    showScreen('kcScreen');
  }

  function kcReviewSection() { showScreen('readerScreen'); }

  // ==================== READER CONTENT ====================
  function renderReaderContent() {
    const body = document.getElementById('readerBody');
    body.innerHTML = '';
    const blocks = sectionData.content || [];
    blocks.forEach(block => { const el = renderBlock(block); if (el) body.appendChild(el); });

    if (sectionData.challenge) {
      const cta = document.createElement('div');
      cta.className = 'reader-challenge-cta';
      cta.innerHTML =
        '<div class="reader-cta-label">End of section</div>' +
        '<div class="reader-cta-title">' + P002Security.escapeHtml(sectionData.challenge.title || 'Practice Challenge') + '</div>' +
        '<div class="reader-cta-desc">' + P002Security.escapeHtml(sectionData.challenge.description || 'Apply what you just read in a hands-on challenge.') + '</div>' +
        '<button class="reader-cta-btn" onclick="P002App.openChallenge()">🚩 Start Challenge →</button>' +
        '<div class="reader-cta-skip" onclick="P002App.skipChallenge()">Skip for now</div>';
      body.appendChild(cta);
    }

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
        el.innerHTML = formatBodyText(block.text || '');
        return el;
      }
      case 'code': {
        const el = document.createElement('div');
        el.className = 'content-code';
        el.textContent = block.text || '';
        if (block.lang) el.dataset.lang = block.lang;
        return el;
      }
      case 'callout': {
        const el = document.createElement('div');
        el.className = 'content-callout';
        el.innerHTML = '<div class="content-callout-icon">⚡</div><div class="content-callout-text">' + formatBodyText(block.text || '') + '</div>';
        return el;
      }
      default: return null;
    }
  }

  function formatBodyText(text) {
    let safe = P002Security.escapeHtml(text);
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
      if (!text || text.length < 3) { hidePopup(); return; }
      const readerBody = document.getElementById('readerBody');
      if (!readerBody) return;
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (!readerBody.contains(container)) { hidePopup(); return; }
      selectedText = text;
      showPopupNearSelection(range);
    }, 200);
  }

  function showPopupNearSelection(range) {
    const popup = document.getElementById('askAiPopup');
    const rect = range.getBoundingClientRect();
    let top = rect.top - 48 - 10;
    let left = rect.left;
    const popupWidth = 280;
    if (left + popupWidth > window.innerWidth - 10) left = window.innerWidth - popupWidth - 10;
    if (left < 10) left = 10;
    if (top < 58) top = rect.bottom - 48 + 10;
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

    if (action === 'chat') { openFreeChat(selectedText); return; }

    const labels = { explain: 'Explain', example: 'Example', deeper: 'Go Deeper' };
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

    const systemPrompt = buildDrawerSystemPrompt(action);
    const userMsg = buildDrawerUserMessage(action, selectedText);

    try {
      const reply = await P002Api.callClaude(systemPrompt, [{ role: 'user', content: userMsg }]);
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').innerHTML = formatBodyText(reply);
      drawerHistory = [{ role: 'user', content: userMsg }, { role: 'assistant', content: reply }];
      renderDrawerChips();
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').textContent = 'Error: ' + e.message;
    }
  }

  function buildDrawerSystemPrompt(action) {
    const sectionTitle = sectionData?.meta?.title || '';
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor helping a student learn cybersecurity. The student is reading a section titled "${sectionTitle}". Context: ${aiContext}\n\nBe concise and direct. Responses should be 2-4 sentences max unless a code example is needed. No filler, no preamble.`;
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
    document.getElementById('messages').innerHTML = '';
    showScreen('chatScreen');

    if (contextText) {
      const systemPrompt = buildFreeChatSystemPrompt();
      const userMsg = 'I want to chat about this: "' + contextText + '"';
      addMessage('user', userMsg);
      chatHistory.push({ role: 'user', content: userMsg });
      callClaude(systemPrompt, chatHistory);
    } else {
      callClaude(buildFreeChatSystemPrompt(), [{ role: 'user', content: 'Hi, I just read the section and want to ask some questions.' }]);
    }
  }

  function closeFreeChat() {
    showScreen('readerScreen');
    document.getElementById('debriefBanner').style.display = 'none';
  }

  function buildFreeChatSystemPrompt() {
    const title = sectionData?.meta?.title || '';
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor for a cybersecurity learning platform. The student has just read a section titled "${title}". Context: ${aiContext}\n\nAnswer questions clearly and concisely. If they ask something off-topic, gently redirect to the section content. Don't be preachy. Keep responses focused.`;
  }

  // ==================== CHALLENGE ====================
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

    if (ch.query) {
      const queryEl = document.createElement('div');
      queryEl.className = 'challenge-query';
      queryEl.textContent = ch.query;
      body.appendChild(queryEl);
    }

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

    const flagArea = document.createElement('div');
    flagArea.className = 'flag-area';
    flagArea.innerHTML =
      '<div class="flag-label">🚩 Your Payload</div>' +
      '<input class="flag-input" id="flagInput" placeholder="Enter your payload..." ' +
        'onkeydown="if(event.key===\'Enter\')P002App.submitFlag()" />' +
      '<button class="flag-submit" onclick="P002App.submitFlag()">Submit Flag</button>';
    body.appendChild(flagArea);

    const helpRow = document.createElement('div');
    helpRow.className = 'challenge-help-row';
    helpRow.innerHTML =
      '<button class="challenge-help-btn" onclick="P002App.backToReader()">📖 Review</button>' +
      '<button class="challenge-help-btn ai" onclick="P002App.showHint()">💡 Hint</button>' +
      '<button class="challenge-help-btn ai" onclick="P002App.openChallengeChat()">💬 Discuss</button>';
    body.appendChild(helpRow);
  }

  function trySimLogin() {
    const pass = document.getElementById('simPass')?.value || '';
    const result = document.getElementById('simResult');
    const flag = sectionData?.challenge?.flag || '';
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
      const ns = submitted.replace(/\s/g, '').toLowerCase();
      const nc = correct.replace(/\s/g, '').toLowerCase();
      if (ns === nc) { flagCaptured(submitted); return; }
      showToast('Incorrect — try again', false);
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => input.style.borderColor = '', 1500);
    }
  }

  async function flagCaptured(payload) {
    currentChallengePassed = true;
    showToast('🏴 Flag captured!', true);
    try { if (currentSessionId) await P002Api.captureFlag(currentSessionId); } catch(e) {}
    openDebrief(payload);
  }

  function backToReader() { closeHintDrawer(); showScreen('readerScreen'); }
  function skipChallenge() { showScreen('homeScreen'); }

  // ==================== HINTS ====================
  function showHint() {
    const hints = sectionData?.challenge?.hints || [];
    if (!hints.length) { showToast('No hints available', false); return; }
    const hint = hints[currentHintIndex] || hints[hints.length - 1];
    document.getElementById('hintLabel').textContent = 'Hint ' + (currentHintIndex + 1) + ' of ' + hints.length;
    document.getElementById('hintText').innerHTML = formatBodyText(hint);
    document.getElementById('hintDrawer').classList.add('visible');
  }

  function nextHint() {
    const hints = sectionData?.challenge?.hints || [];
    if (currentHintIndex < hints.length - 1) { currentHintIndex++; showHint(); }
    else closeHintDrawer();
  }

  function closeHintDrawer() { document.getElementById('hintDrawer').classList.remove('visible'); }

  function openChallengeChat() {
    chatMode = 'free';
    chatHistory = [];
    document.getElementById('chatHeaderLabel').textContent = 'AI Tutor';
    document.getElementById('chatHeaderTitle').textContent = 'Challenge Help';
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('chatContinueBtn').style.display = 'none';
    document.getElementById('messages').innerHTML = '';
    showScreen('chatScreen');
    callClaude(buildChallengeChatSystemPrompt(), [{ role: 'user', content: "I'm stuck on the challenge. Give me a hint without giving away the answer." }]);
  }

  function buildChallengeChatSystemPrompt() {
    const ch = sectionData?.challenge;
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor helping a student with a cybersecurity challenge. Context: ${aiContext}\nChallenge: ${ch?.title || ''}. Description: ${ch?.description || ''}\nGive hints that guide without giving the answer directly. Keep responses concise.`;
  }

  // ==================== DEBRIEF ====================
  function openDebrief(payload) {
    chatMode = 'debrief';
    chatHistory = [];
    document.getElementById('chatHeaderLabel').textContent = 'Debrief';
    document.getElementById('chatHeaderTitle').textContent = sectionData?.meta?.title || 'Section complete';
    document.getElementById('chatContinueBtn').style.display = 'block';
    document.getElementById('debriefBanner').style.display = 'block';
    document.getElementById('debriefBannerTitle').textContent = 'Flag captured — ' + P002Security.escapeHtml(payload);
    document.getElementById('debriefBannerSub').textContent = (sectionData?.meta?.title || '') + ' complete';
    document.getElementById('messages').innerHTML = '';
    showScreen('chatScreen');
    document.getElementById('messages').style.paddingTop = '60px';
    const systemPrompt = buildDebriefSystemPrompt(payload);
    const userMsg = `I just captured the flag with payload: "${payload}". Debrief me on what I did and why it worked.`;
    chatHistory.push({ role: 'user', content: userMsg });
    callClaude(systemPrompt, chatHistory);
  }

  function buildDebriefSystemPrompt(payload) {
    const ch = sectionData?.challenge;
    const aiContext = sectionData?.ai_context || '';
    return `You are an AI tutor debriefing a student after they solved a cybersecurity challenge. Context: ${aiContext}\nThe student submitted payload: "${payload}". Flag: "${ch?.flag || ''}".\nExplain in 3-4 sentences: what their payload did, why it worked at the SQL/code level, and the real-world impact. Then offer to go deeper on any aspect. Be direct, no filler.`;
  }

  function continueAfterDebrief() {
    document.getElementById('debriefBanner').style.display = 'none';
    document.getElementById('messages').style.paddingTop = '';
    showScreen('homeScreen');
  }

  // ==================== CHAT ====================
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

  // ==================== LEGACY ====================

  // ==================== LIBRARY ====================

  function openLibrary() {
    // Reset to idle state
    document.getElementById('libIdle').style.display = 'flex';
    document.getElementById('libSearching').style.display = 'none';
    document.getElementById('libInputIdle').value = '';
    document.getElementById('libGoBtn').style.display = 'none';

    // Build suggestion pills if not already done
    const pillsEl = document.getElementById('libPills');
    if (pillsEl && !pillsEl.children.length) {
      LIB_SUGGESTIONS.forEach(s => {
        const pill = document.createElement('div');
        pill.className = 'lib-pill';
        pill.textContent = s;
        pill.onclick = () => { document.getElementById('libInputIdle').value = s; librarySearch(s); };
        pillsEl.appendChild(pill);
      });
    }

    showScreen('libraryScreen');
  }

  function closeLibrary() {
    libraryReset();
    showScreen('homeScreen');
  }

  async function librarySearch(query) {
    if (!query || !query.trim()) return;
    query = query.trim();

    // Switch to searching state
    document.getElementById('libIdle').style.display = 'none';
    document.getElementById('libSearching').style.display = 'flex';
    document.getElementById('libInputCompact').value = query;
    document.getElementById('libResultCount').style.display = 'none';
    document.getElementById('libClearBtn').style.display = 'none';
    document.getElementById('libDots').style.display = 'flex';

    // Animate spark
    const spark = document.getElementById('libCompactSpark');
    if (spark) spark.style.animation = 'libSparkPulse 1s ease infinite';

    // Animate dots
    let dotStep = 0;
    clearInterval(libDotInterval);
    libDotInterval = setInterval(() => {
      dotStep = (dotStep + 1) % 4;
      [0,1,2].forEach(i => {
        const d = document.getElementById('ld' + i);
        if (d) d.style.opacity = dotStep > i ? '1' : '0.15';
      });
    }, 280);

    // Loading state
    const resultsEl = document.getElementById('libResults');
    resultsEl.innerHTML =
      '<div class="lib-loading-state">' +
        '<svg width="30" height="30" viewBox="0 0 52 52" overflow="visible" style="animation:libSparkPulse 1.2s ease infinite">' +
          '<line x1="26" y1="4" x2="26" y2="48" stroke="rgba(255,77,77,0.35)" stroke-width="4.5" stroke-linecap="round"/>' +
          '<line x1="4" y1="26" x2="48" y2="26" stroke="rgba(255,77,77,0.35)" stroke-width="4.5" stroke-linecap="round"/>' +
          '<line x1="9.5" y1="9.5" x2="42.5" y2="42.5" stroke="rgba(255,77,77,0.2)" stroke-width="3.5" stroke-linecap="round"/>' +
          '<line x1="42.5" y1="9.5" x2="9.5" y2="42.5" stroke="rgba(255,77,77,0.2)" stroke-width="3.5" stroke-linecap="round"/>' +
          '<circle cx="26" cy="26" r="5.5" fill="rgba(255,77,77,0.35)"/>' +
        '</svg>' +
        '<div class="lib-loading-title">Searching...</div>' +
      '</div>';

    // Call fetch.js
    let books = [];
    try {
      books = await P002Fetch.searchLibrary(query);
    } catch(e) {
      console.warn('[Library] Search failed:', e.message);
    }

    // Stop loading
    clearInterval(libDotInterval);
    document.getElementById('libDots').style.display = 'none';
    document.getElementById('libClearBtn').style.display = 'flex';
    if (spark) spark.style.animation = '';

    // Show count
    document.getElementById('libResultCount').style.display = 'flex';
    document.getElementById('libResultLabel').textContent =
      books.length + ' RESULTS · PUBLIC DOMAIN · PRE-1928';

    renderLibraryResults(books, resultsEl);
  }

  function renderLibraryResults(books, container) {
    container.innerHTML = '';

    if (!books.length) {
      container.innerHTML =
        '<div class="lib-empty">' +
          '<div class="lib-empty-icon">&#128218;</div>' +
          '<div class="lib-empty-title">No results</div>' +
          '<div class="lib-empty-sub">Try a different search term.</div>' +
        '</div>';
      return;
    }

    const sourceColors = {
      'Wikipedia':   { bg: 'rgba(108,143,255,0.1)', border: 'rgba(108,143,255,0.25)', color: '#6c8fff' },
      'OpenStax':    { bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)',  color: '#4ade80' },
      'Archive.org': { bg: 'rgba(255,159,67,0.1)',  border: 'rgba(255,159,67,0.25)',  color: '#ff9f43' },
      'Gutenberg':   { bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)', color: '#a78bfa' },
    };
    const typeLabels = { article: 'Article', textbook: 'Textbook', book: 'Book' };

    books.forEach((book, i) => {
      const row = document.createElement('div');
      row.className = 'book-row';
      row.style.animationDelay = (i * 55) + 'ms';

      const sc = sourceColors[book.source] || sourceColors['Wikipedia'];
      const typeLabel = typeLabels[book.type] || 'Book';
      const yearStr = book.year && book.year > 0 ? book.year : '';
      const safeId = (book.id || '').replace(/[^a-zA-Z0-9-_]/g, '');
      const bookJson = JSON.stringify(book).replace(/"/g, '&quot;');

      row.innerHTML =
        '<div class="book-cover">' +
          '<svg style="opacity:0.1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>' +
          '<div class="book-cover-stripe"></div>' +
        '</div>' +
        '<div class="book-info">' +
          '<div class="book-title">' + P002Security.escapeHtml(book.title) + '</div>' +
          '<div class="book-author">' + P002Security.escapeHtml(book.author) + (yearStr ? ' &middot; ' + yearStr : '') + '</div>' +
          '<div class="book-tags">' +
            '<div class="book-tag" style="background:' + sc.bg + ';border-color:' + sc.border + ';color:' + sc.color + ';">' + P002Security.escapeHtml(book.source) + '</div>' +
            '<div class="book-tag">' + typeLabel + '</div>' +
            (book.subjects?.[0] ? '<div class="book-tag">' + P002Security.escapeHtml(book.subjects[0]) + '</div>' : '') +
          '</div>' +
          (book.description ? '<div class="book-desc">' + P002Security.escapeHtml(book.description) + '</div>' : '') +
          '<div class="book-actions">' +
            (book.textUrl ?
              '<a class="book-action-btn book-link" href="' + P002Security.escapeHtml(book.textUrl) + '" target="_blank" rel="noopener noreferrer">' +
                '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
                'View source' +
              '</a>'
            : '') +
            '<button class="book-action-btn book-import-btn" id="import-' + safeId + '" onclick="P002App.importBook(' + bookJson + ')">+ Import</button>' +
          '</div>' +
        '</div>';

      container.appendChild(row);
    });

    const spacer = document.createElement('div');
    spacer.style.height = '60px';
    container.appendChild(spacer);
  }

  async function importBook(book) {
    const safeId = (book.id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    const btn = document.getElementById('import-' + safeId);
    if (!btn || btn.classList.contains('imported') || btn.classList.contains('importing')) return;

    // Show course customization prompt
    const prefs = await showImportPrompt(book.title);
    if (!prefs) return; // user cancelled

    btn.classList.add('importing');
    btn.innerHTML = '<div class="book-spinner"></div>';

    try {
      // Fetch source text
      let rawText = '';
      let parsedSections = null;

      if (book.source === 'Wikipedia') {
        const result = await P002Fetch.fetchWikipediaWithSections(book.title);
        rawText = result.text;
        parsedSections = result.sections;
        if (parsedSections && parsedSections.length > 1) {
          rawText = parsedSections.map(s => '== ' + s.title + ' ==\n' + s.text).join('\n\n');
        }
      } else if (book.source === 'Gutenberg' && book.textUrl) {
        rawText = await P002Fetch.fetchBookText(book);
        parsedSections = P002Fetch.parseSourceSections(rawText, 'Gutenberg');
      } else if (book.textUrl) {
        rawText = 'Source: ' + book.textUrl + '\n\nTitle: ' + book.title + '\nAuthor: ' + book.author + '\n\n' + (book.description || '');
      } else {
        throw new Error('No text source available for this item');
      }

      if (!rawText || rawText.length < 100) throw new Error('Not enough content to generate a course');

      // Use natural section count unless user requested more
      if (parsedSections && parsedSections.length > 1) {
        const naturalCount = parsedSections.length;
        const requestedCount = prefs.sections || 8;
        prefs.sections = requestedCount > naturalCount ? requestedCount : naturalCount;
      }

      // Append user preferences to raw text so generation prompt picks them up
      const prefContext = '\n\n=== COURSE CUSTOMIZATION ===\n' +
        (prefs.focus    ? 'Focus on: ' + prefs.focus + '\n' : '') +
        (prefs.level    ? 'Target level: ' + prefs.level + '\n' : '') +
        (prefs.purpose  ? 'Purpose: ' + prefs.purpose + '\n' : '') +
        (prefs.include  ? 'Must include: ' + prefs.include + '\n' : '') +
        'Number of sections: ' + (prefs.sections || 8) + '\n' +
        'Creativity level: ' + (prefs.creativity || 5) + '/10\n';

      rawText = rawText + prefContext;

      btn.innerHTML = '0%';

      await P002Api.generateCourse(
        book.title,
        book.author,
        book.source.toLowerCase().replace('.', ''),
        book.textUrl || null,
        rawText,
        (pct, sectionTitle, done) => {
          btn.innerHTML = pct + '%';
          if (done) {
            btn.classList.remove('importing');
            btn.classList.add('imported');
            btn.innerHTML = '&#10003; Added';
          }
        },
        prefs.temperature || 0.7
      );

      showToast('&#128218; ' + book.title.slice(0, 30) + (book.title.length > 30 ? '...' : '') + ' — course ready!', true);

    } catch(e) {
      btn.classList.remove('importing');
      btn.innerHTML = '+ Import';
      showToast('Failed: ' + e.message, false);
      console.error('[importBook]', e);
    }
  }

  // Import customization prompt modal
  function showImportPrompt(bookTitle) {
    return new Promise((resolve) => {
      const existing = document.getElementById('importPromptModal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'importPromptModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:flex-end;backdrop-filter:blur(4px);';

      modal.innerHTML =
        '<div style="background:#111013;border-radius:20px 20px 0 0;border:1px solid rgba(255,255,255,0.08);width:100%;padding:0 0 32px;max-height:90vh;overflow-y:auto;">' +
          '<div style="padding:10px 0;display:flex;justify-content:center;">' +
            '<div style="width:36px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;"></div>' +
          '</div>' +
          '<div style="padding:8px 20px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
            '<div style="font-family:var(--font-display);font-size:17px;font-weight:800;color:var(--text);letter-spacing:-0.5px;margin-bottom:3px;">Customize your course</div>' +
            '<div style="font-size:11px;color:var(--text-dim);">' + P002Security.escapeHtml(bookTitle) + '</div>' +
          '</div>' +
          '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:16px;">' +

            // Focus
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Focus <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></div>' +
              '<input id="importFocus" placeholder="e.g. coping mechanisms, diagnosis criteria, treatment..." ' +
                'style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:var(--font-body);font-size:14px;color:var(--text);outline:none;box-sizing:border-box;" />' +
              '<div style="font-size:10px;color:var(--text-dim);margin-top:5px;">What specific aspect should this course focus on?</div>' +
            '</div>' +

            // Level
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Level</div>' +
              '<div style="display:flex;gap:8px;">' +
                ['Beginner', 'Intermediate', 'Advanced'].map(l =>
                  '<button class="import-level-btn" data-level="' + l.toLowerCase() + '" ' +
                  'style="flex:1;padding:9px 8px;border-radius:9px;font-family:var(--font-body);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;' +
                  (l === 'Beginner' ? 'background:rgba(255,77,77,0.1);border:1px solid rgba(255,77,77,0.3);color:var(--accent);' : 'background:var(--surface);border:1px solid var(--border);color:var(--text-dim);') +
                  '">' + l + '</button>'
                ).join('') +
              '</div>' +
            '</div>' +

            // Purpose
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Purpose <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></div>' +
              '<input id="importPurpose" placeholder="e.g. personal understanding, exam prep, professional training..." ' +
                'style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:var(--font-body);font-size:14px;color:var(--text);outline:none;box-sizing:border-box;" />' +
            '</div>' +

            // Must include
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">Must include <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></div>' +
              '<input id="importInclude" placeholder="e.g. DBT techniques, medication info, real examples..." ' +
                'style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:var(--font-body);font-size:14px;color:var(--text);outline:none;box-sizing:border-box;" />' +
            '</div>' +

            // Depth slider
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">' +
                'Depth &nbsp;<span id="importDepthVal" style="color:var(--accent);font-weight:800;font-family:var(--font-mono);">8</span> sections' +
              '</div>' +
              '<input id="importDepth" type="range" min="4" max="20" value="8" ' +
                'style="width:100%;accent-color:var(--accent);cursor:pointer;" />' +
              '<div style="display:flex;justify-content:space-between;margin-top:3px;">' +
                '<span style="font-size:9px;color:var(--text-dim);">Overview</span>' +
                '<span style="font-size:9px;color:var(--text-dim);">Standard</span>' +
                '<span style="font-size:9px;color:var(--text-dim);">Deep dive</span>' +
              '</div>' +
            '</div>' +

            // Creativity slider
            '<div>' +
              '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:7px;">' +
                'Creativity &nbsp;<span id="importCreativityLabel" style="color:var(--accent2);font-weight:800;font-family:var(--font-mono);">Balanced</span>' +
              '</div>' +
              '<input id="importCreativity" type="range" min="1" max="10" value="5" ' +
                'style="width:100%;accent-color:var(--accent2);cursor:pointer;" />' +
              '<div style="display:flex;justify-content:space-between;margin-top:3px;">' +
                '<span style="font-size:9px;color:var(--text-dim);">Source only</span>' +
                '<span style="font-size:9px;color:var(--text-dim);">Balanced</span>' +
                '<span style="font-size:9px;color:var(--text-dim);">Claude expands</span>' +
              '</div>' +
            '</div>' +

            // Keep tab open warning
            '<div style="background:rgba(255,159,67,0.08);border:1px solid rgba(255,159,67,0.2);border-radius:10px;padding:10px 14px;display:flex;gap:8px;align-items:flex-start;">' +
              '<span style="font-size:13px;flex-shrink:0;">&#9888;</span>' +
              '<span style="font-size:11px;color:var(--accent2);line-height:1.5;">Keep this tab open while your course generates. Leaving will stop generation.</span>' +
            '</div>' +

          '</div>' +
          '<div style="padding:0 20px;display:flex;gap:10px;">' +
            '<button id="importCancel" style="flex:1;background:transparent;border:1px solid var(--border);border-radius:12px;padding:14px;font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--text-muted);cursor:pointer;">Cancel</button>' +
            '<button id="importConfirm" style="flex:2;background:var(--accent);border:none;border-radius:12px;padding:14px;font-family:var(--font-display);font-size:15px;font-weight:800;color:#fff;cursor:pointer;">Build Course &#8594;</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(modal);

      // Level toggle
      let selectedLevel = 'beginner';
      modal.querySelectorAll('.import-level-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedLevel = btn.dataset.level;
          modal.querySelectorAll('.import-level-btn').forEach(b => {
            const active = b.dataset.level === selectedLevel;
            b.style.background = active ? 'rgba(255,77,77,0.1)' : 'var(--surface)';
            b.style.borderColor = active ? 'rgba(255,77,77,0.3)' : 'var(--border)';
            b.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
          });
        });
      });

      // Depth slider
      const depthSlider = document.getElementById('importDepth');
      const depthVal = document.getElementById('importDepthVal');
      depthSlider.addEventListener('input', () => {
        depthVal.textContent = depthSlider.value;
      });

      // Creativity slider
      const creativitySlider = document.getElementById('importCreativity');
      const creativityLabel = document.getElementById('importCreativityLabel');
      const creativityLabels = { 1:'Strict', 2:'Strict', 3:'Conservative', 4:'Conservative', 5:'Balanced', 6:'Balanced', 7:'Creative', 8:'Creative', 9:'Expansive', 10:'Expansive' };
      creativitySlider.addEventListener('input', () => {
        creativityLabel.textContent = creativityLabels[parseInt(creativitySlider.value)] || 'Balanced';
      });

      // Auto-focus
      setTimeout(() => document.getElementById('importFocus')?.focus(), 100);

      // Cancel
      document.getElementById('importCancel').addEventListener('click', () => { modal.remove(); resolve(null); });
      modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });

      // Confirm
      document.getElementById('importConfirm').addEventListener('click', () => {
        const creativity = parseInt(document.getElementById('importCreativity')?.value || '5');
        const prefs = {
          focus:       document.getElementById('importFocus')?.value?.trim() || '',
          level:       selectedLevel,
          purpose:     document.getElementById('importPurpose')?.value?.trim() || '',
          include:     document.getElementById('importInclude')?.value?.trim() || '',
          sections:    parseInt(document.getElementById('importDepth')?.value || '8'),
          creativity:  creativity,
          temperature: parseFloat((0.2 + (creativity - 1) * (0.9 / 9)).toFixed(2)), // maps 1-10 to 0.2-1.0
        };
        modal.remove();
        resolve(prefs);
      });

      // Enter = confirm
      ['importFocus', 'importPurpose', 'importInclude'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
          if (e.key === 'Enter') document.getElementById('importConfirm')?.click();
        });
      });
    });
  }


  function libraryReset() {
    clearInterval(libDotInterval);
    document.getElementById('libIdle').style.display = 'flex';
    document.getElementById('libSearching').style.display = 'none';
    document.getElementById('libInputIdle').value = '';
    document.getElementById('libGoBtn').style.display = 'none';
    document.getElementById('libInputCompact').value = '';
    document.getElementById('libResults').innerHTML = '';
    document.getElementById('libResultCount').style.display = 'none';
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
    loadMyCourses,
    openCourse,
    editCourse,
    renderCourseDetail,
    openSectionFromDB,
    backToHome,
    backToSectionPreview,
    backToSectionList,
    startReading,
    endReading,
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
    // Library
    openLibrary,
    closeLibrary,
    librarySearch,
    renderLibraryResults,
    importBook,
    showImportPrompt,
    libraryReset,
  };

})();

// Boot
window.addEventListener('load', P002App.init);
