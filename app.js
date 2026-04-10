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
  let drawerHistory = [];
  let selectedText = '';
  let currentDrawerAction = '';

  // Chat state
  let chatHistory = [];
  let chatMode = 'free';

  // Challenge state
  let currentHintIndex = 0;

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
    currentUser = null; sectionData = null; chatHistory = [];
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

  // ==================== HOME ====================
  const MODULE_INDEX_PATH = 'index.json';
  const CATEGORY_ICONS = { 'Web Fundamentals':'🌐','Web Exploitation':'⚡','Network':'📡','Defense':'🛡','Systems':'💻','Other':'📚' };

  async function loadModuleCatalog() {
    const grid = document.getElementById('moduleGrid');
    if (!grid) return;
    try {
      let modules = [];
      try {
        const text = await P002Api.downloadFile(MODULE_INDEX_PATH);
        modules = JSON.parse(text).modules || [];
      } catch(e) {
        const items = await P002Api.listBucket('');
        modules = items.filter(f => !f.metadata && !f.name.startsWith('.')).map(f => ({
          key: f.name, title: f.name.replace(/module_|_/g,' ').trim(),
          category:'Other', difficulty:'intermediate', section_count:0, estimated_hours:0, icon:'📚'
        }));
      }
      if (!modules.length) { grid.innerHTML='<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">No modules found.</div>'; return; }
      const categories = {};
      modules.forEach(m => { const c=m.category||'Other'; if(!categories[c]) categories[c]=[]; categories[c].push(m); });
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
      grid.innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">Error: '+P002Security.escapeHtml(e.message)+'</div>';
    }
  }

  function buildIndexCard(m) {
    const card = document.createElement('div');
    card.style.cssText = 'margin:0 16px 8px;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color 0.15s,transform 0.15s;';
    const icon = m.icon || CATEGORY_ICONS[m.category] || '📚';
    const diff = m.difficulty || 'intermediate';
    const diffColors = { beginner:'var(--success)', intermediate:'var(--warn)', advanced:'var(--accent)' };
    card.innerHTML =
      '<div style="padding:14px 16px;display:flex;align-items:center;gap:14px;">'+
        '<div style="width:44px;height:44px;border-radius:10px;background:var(--accent-dim);border:1px solid rgba(255,77,77,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">'+icon+'</div>'+
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:'+(diffColors[diff]||'var(--warn)')+';margin-bottom:4px;">'+diff+'</div>'+
          '<div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);line-height:1.2;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+P002Security.escapeHtml(m.title)+'</div>'+
          '<div style="font-size:11px;color:var(--text-muted);">'+(m.section_count>0?m.section_count+' sections':'Loading...')+(m.estimated_hours>0?' · '+m.estimated_hours+'h':'')+'</div>'+
        '</div>'+
        '<div style="color:var(--text-dim);font-size:16px;">›</div>'+
      '</div>';
    card.addEventListener('mouseenter', () => { card.style.borderColor='var(--border2)'; card.style.transform='translateX(2px)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor='var(--border)'; card.style.transform=''; });
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
    document.getElementById('moduleSectionList').innerHTML = '<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;">Loading...</div>';
    try {
      const text = await P002Api.downloadFile(moduleKey + '/manifest.json');
      const manifest = JSON.parse(text);
      currentModule = manifest;
      renderModuleDetail(manifest);
    } catch(e) {
      document.getElementById('moduleDetailTitle').textContent = 'Failed to load';
      document.getElementById('moduleSectionList').innerHTML = '<div style="padding:20px 16px;color:var(--danger);font-size:13px;">'+P002Security.escapeHtml(e.message)+'</div>';
    }
  }

  function renderModuleDetail(manifest) {
    const totalMins = manifest.sections.reduce((a,s) => a+(s.minutes||0), 0);
    const hours = totalMins>0 ? (totalMins/60).toFixed(1) : (manifest.estimated_hours||'?');
    const flags = manifest.sections.filter(s=>s.has_flag).length;
    document.getElementById('moduleDetailCategory').textContent = (manifest.category||'')+(manifest.difficulty?' · '+manifest.difficulty:'');
    document.getElementById('moduleDetailTitle').textContent = manifest.title;
    document.getElementById('moduleDetailDesc').textContent = manifest.description||'';
    document.getElementById('moduleDetailStats').innerHTML =
      '<div class="module-stat"><span class="module-stat-value">'+manifest.sections.length+'</span><span class="module-stat-label">Sections</span></div>'+
      '<div class="module-stat"><span class="module-stat-value">'+hours+'h</span><span class="module-stat-label">Estimated</span></div>'+
      (flags>0?'<div class="module-stat"><span class="module-stat-value">'+flags+'</span><span class="module-stat-label">Flags</span></div>':'');
    const list = document.getElementById('moduleSectionList');
    list.innerHTML = '';
    manifest.sections.forEach((s,i) => {
      const row = document.createElement('div');
      row.className = 'section-row'+(s.has_flag?' has-flag':'');
      row.innerHTML =
        '<div class="section-num">'+String(i+1).padStart(2,'0')+'</div>'+
        '<div class="section-info">'+
          '<div class="section-title">'+P002Security.escapeHtml(s.title)+'</div>'+
          '<div class="section-meta-row">'+
            '<span class="section-time">⏱ '+(s.minutes||'?')+' min</span>'+
            '<span class="section-diff '+(s.difficulty||'beginner')+'">'+(s.difficulty||'')+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="section-flag">⚑</div>'+
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
      'Section '+(idx+1)+' of '+manifest.sections.length+' · '+(sectionMeta.difficulty||'')+' · '+(sectionMeta.minutes||'?')+' min';
    document.getElementById('sectionPreviewTitle').textContent = sectionMeta.title;
    document.getElementById('sectionPreviewDesc').textContent = sectionMeta.description||'';
    const body = document.getElementById('sectionPreviewBody');
    body.innerHTML = '';
    if (sectionMeta.has_flag) {
      const box = document.createElement('div');
      box.className = 'section-challenge-box';
      box.innerHTML = '<div class="section-challenge-label">⚑ Practice Challenge included</div><div class="section-challenge-text">'+P002Security.escapeHtml(sectionMeta.practice_question||'Hands-on challenge at the end')+'</div>';
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
      if (!validation.ok) { status.textContent = '✗ ' + validation.errors[0]; return; }
      sectionData = validation.data;
      btn.disabled = false;
      status.textContent = '';
      btn.textContent = validation.schema === 'reader' ? 'Start Reading →' : 'Start Session →';
    } catch(e) {
      status.textContent = '✗ Failed to load: ' + P002Security.escapeHtml(e.message);
    }
  }

  function backToHome() { currentModule = null; showScreen('homeScreen'); }
  function backToModule() { currentSectionMeta = null; sectionData = null; showScreen('moduleScreen'); }
  function backToSectionPreview() { closeDrawer(); removeTextSelectionHandler(); showScreen('sectionScreen'); }
  function showAdmin() { window.location.href = 'admin.html'; }

  // ==================== START READING ====================
  async function startReading() {
    if (!sectionData) return;
    // Detect schema directly from loaded data — avoid re-serializing which can corrupt validation
    const isReader = sectionData.meta && sectionData.content && Array.isArray(sectionData.content);
    if (!isReader) { startLegacySession(); return; }
    const meta = sectionData.meta;
    document.getElementById('readerChapter').textContent = 'Section '+meta.section+' of '+meta.total_sections+' · '+meta.module;
    document.getElementById('readerTitle').textContent = meta.title;
    document.getElementById('readerProgressFill').style.width = '0%';
    renderReaderContent();
    showScreen('readerScreen');
    document.getElementById('endBtn').style.display = 'block';
    document.getElementById('settingsBtn').style.display = 'none';
    initTextSelection();
    try { currentSessionId = await P002Api.createSession(meta.section, meta.module); } catch(e) {}
  }

  function endReading() {
    removeTextSelectionHandler();
    closeDrawer();
    document.getElementById('endBtn').style.display = 'none';
    document.getElementById('settingsBtn').style.display = 'block';
    showScreen('sectionScreen');
  }

  // ==================== READER RENDERER ====================
  function renderReaderContent() {
    const body = document.getElementById('readerBody');
    body.innerHTML = '';
    (sectionData.content || []).forEach(block => {
      const el = renderBlock(block);
      if (el) body.appendChild(el);
    });
    if (sectionData.challenge) {
      const ch = sectionData.challenge;
      const cta = document.createElement('div');
      cta.className = 'reader-challenge-cta';
      cta.innerHTML =
        '<div class="reader-cta-label">End of section</div>'+
        '<div class="reader-cta-title">'+P002Security.escapeHtml(ch.title||'Practice Challenge')+'</div>'+
        '<div class="reader-cta-desc">'+P002Security.escapeHtml(ch.description||'Apply what you just read.')+'</div>'+
        '<button class="reader-cta-btn" onclick="P002App.openChallenge()">🏴 Start Challenge →</button>'+
        '<div class="reader-cta-skip" onclick="P002App.skipChallenge()">Skip for now</div>';
      body.appendChild(cta);
    }
    const pf = document.getElementById('readerProgressFill');
    readerScrollHandler = () => {
      const pct = body.scrollHeight - body.clientHeight > 0
        ? Math.min(100, (body.scrollTop / (body.scrollHeight - body.clientHeight)) * 100) : 0;
      pf.style.width = pct + '%';
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
        return el;
      }
      case 'callout': {
        const el = document.createElement('div');
        el.className = 'content-callout';
        el.innerHTML = '<div class="content-callout-icon">⚡</div><div class="content-callout-text">'+formatBodyText(block.text||'')+'</div>';
        return el;
      }
      default: return null;
    }
  }

  function formatBodyText(text) {
    let s = P002Security.escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/`([^`]+)`/g, '<code>$1</code>')
         .replace(/\n\n/g, '</p><p>')
         .replace(/\n/g, '<br>');
    return s;
  }

  function removeTextSelectionHandler() {
    const body = document.getElementById('readerBody');
    if (body && readerScrollHandler) { body.removeEventListener('scroll', readerScrollHandler); readerScrollHandler = null; }
    document.removeEventListener('selectionchange', onSelectionChange);
    hidePopup();
  }

  // ==================== TEXT SELECTION ====================
  let selectionChangeTimeout = null;

  function initTextSelection() {
    document.addEventListener('selectionchange', onSelectionChange);
  }

  function onSelectionChange() {
    clearTimeout(selectionChangeTimeout);
    selectionChangeTimeout = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length < 3) { hidePopup(); return; }
      const readerBody = document.getElementById('readerBody');
      if (!readerBody) return;
      const range = sel.getRangeAt(0);
      if (!readerBody.contains(range.commonAncestorContainer)) { hidePopup(); return; }
      selectedText = text;
      showPopupNearSelection(range);
    }, 200);
  }

  function showPopupNearSelection(range) {
    const popup = document.getElementById('askAiPopup');
    const rect = range.getBoundingClientRect();
    let top = rect.top - 48 - 44;
    let left = rect.left;
    const popupWidth = 260;
    if (left + popupWidth > window.innerWidth - 10) left = window.innerWidth - popupWidth - 10;
    if (left < 10) left = 10;
    if (top < 58) top = rect.bottom - 48 + 10;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.classList.add('visible');
  }

  function hidePopup() { document.getElementById('askAiPopup').classList.remove('visible'); }

  async function callHaiku(systemPrompt, messages) {
    // Direct call to edge function with haiku model — cheaper for drawer quick Q&A
    const session = await P002Api.getSession();
    const token = session?.access_token;
    const resp = await fetch(
      'https://hmrnwvahkcoexjcxohel.supabase.co/functions/v1/claude-proxy',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          system: systemPrompt,
          messages: messages.slice(-4),
          model: 'haiku',
        }),
      }
    );
    if (!resp.ok) throw new Error('Haiku call failed: ' + resp.status);
    const data = await resp.json();
    return data.content?.[0]?.text || '';
  }

  async function handlePopupAction(action) {
    if (!selectedText) return;
    hidePopup();
    window.getSelection()?.removeAllRanges();
    if (action === 'chat') { openFreeChat(selectedText); return; }
    const labels = { explain:'Explain', example:'Example', deeper:'Go Deeper' };
    currentDrawerAction = action;
    drawerHistory = [];
    document.getElementById('drawerMode').textContent = labels[action] || 'Ask AI';
    document.getElementById('drawerContext').textContent = selectedText.slice(0,60)+(selectedText.length>60?'...':'');
    const qw = document.getElementById('drawerQuoteWrap');
    qw.style.display = 'block';
    document.getElementById('drawerQuote').textContent = '"'+selectedText.slice(0,120)+(selectedText.length>120?'...':'')+'"';
    document.getElementById('drawerResponse').textContent = '';
    document.getElementById('drawerChips').innerHTML = '';
    document.getElementById('drawerTyping').style.display = 'flex';
    openDrawer();
    try {
      const sp = buildDrawerSystemPrompt(action);
      const um = buildDrawerUserMessage(action, selectedText);
      const reply = await callHaiku(sp, [{role:'user',content:um}]);
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').innerHTML = formatBodyText(reply);
      drawerHistory = [{role:'user',content:um},{role:'assistant',content:reply}];
      renderDrawerChips();
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      document.getElementById('drawerResponse').textContent = 'Error: '+e.message;
    }
  }

  function buildDrawerSystemPrompt(action) {
    return 'You are an AI tutor for cybersecurity. Section: "'+(sectionData?.meta?.title||'')+'". Context: '+(sectionData?.ai_context||'')+'. Be concise — 2-4 sentences max unless a code example is needed.';
  }

  function buildDrawerUserMessage(action, text) {
    const prompts = {
      explain: 'Explain this simply: "'+text+'"',
      example: 'Give a concrete real-world example of: "'+text+'"',
      deeper: 'Go deeper on this — what would a beginner miss?: "'+text+'"'
    };
    return prompts[action] || 'Tell me about: "'+text+'"';
  }

  function renderDrawerChips() {
    const chips = document.getElementById('drawerChips');
    chips.innerHTML = '';
    ['Show me in code','Real attack example','Why does this matter','Test me'].forEach(opt => {
      const c = document.createElement('div');
      c.className = 'drawer-chip';
      c.textContent = opt;
      c.onclick = () => sendDrawerChipText(opt);
      chips.appendChild(c);
    });
  }

  async function sendDrawerChipText(text) {
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
    drawerHistory.push({role:'user',content:text});
    const responseEl = document.getElementById('drawerResponse');
    responseEl.innerHTML += '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,77,77,0.08);border-radius:8px;font-size:12px;color:#ccc;">'+P002Security.escapeHtml(text)+'</div>';
    try {
      const sp = buildDrawerSystemPrompt(currentDrawerAction);
      const reply = await callHaiku(sp, drawerHistory.slice(-4));
      document.getElementById('drawerTyping').style.display = 'none';
      drawerHistory.push({role:'assistant',content:reply});
      responseEl.innerHTML += '<div style="margin-top:8px;">'+formatBodyText(reply)+'</div>';
      renderDrawerChips();
    } catch(e) {
      document.getElementById('drawerTyping').style.display = 'none';
      responseEl.innerHTML += '<div style="color:var(--danger);font-size:12px;margin-top:8px;">Error: '+P002Security.escapeHtml(e.message)+'</div>';
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
    document.getElementById('messages').style.paddingTop = '';
    showScreen('chatScreen');
    const sp = buildFreeChatSystemPrompt();
    const um = contextText
      ? 'I want to ask about this: "'+contextText+'"'
      : 'Hi, I just finished reading the section and want to ask some questions.';
    chatHistory.push({role:'user',content:um});
    callClaude(sp, chatHistory);
  }

  function closeFreeChat() {
    document.getElementById('debriefBanner').style.display = 'none';
    showScreen('readerScreen');
  }

  function buildFreeChatSystemPrompt() {
    return 'You are an AI tutor. The student just read: "'+(sectionData?.meta?.title||'')+'". Context: '+(sectionData?.ai_context||'')+'. Answer questions clearly. Keep responses focused on the section content.';
  }

  // ==================== CHALLENGE ====================
  function openChallenge() {
    if (!sectionData?.challenge) return;
    const ch = sectionData.challenge;
    currentHintIndex = 0;
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
      const qEl = document.createElement('div');
      qEl.className = 'challenge-query';
      qEl.textContent = ch.query;
      body.appendChild(qEl);
    }
    if (ch.query) {
      const sim = document.createElement('div');
      sim.className = 'target-app';
      sim.innerHTML =
        '<div class="target-app-bar">'+
          '<div class="target-dot" style="background:#ff5f57"></div>'+
          '<div class="target-dot" style="background:#febc2e"></div>'+
          '<div class="target-dot" style="background:#28c840"></div>'+
          '<div class="target-url">vuln-lab.local/login</div>'+
        '</div>'+
        '<div class="target-app-body">'+
          '<div class="target-label">Username</div>'+
          '<input class="target-input" id="simUser" value="admin" readonly />'+
          '<div class="target-label" style="margin-top:8px;">Password</div>'+
          '<input class="target-input" id="simPass" placeholder="Enter password..." />'+
          '<button class="target-submit-btn" style="margin-top:10px;" onclick="P002App.trySimLogin()">Login</button>'+
          '<div id="simResult" style="margin-top:10px;font-size:12px;text-align:center;min-height:18px;"></div>'+
        '</div>';
      body.appendChild(sim);
    }
    const flagArea = document.createElement('div');
    flagArea.className = 'flag-area';
    flagArea.innerHTML =
      '<div class="flag-label">🏴 Your Payload</div>'+
      '<input class="flag-input" id="flagInput" placeholder="Enter your payload..." onkeydown="if(event.key===\'Enter\')P002App.submitFlag()" />'+
      '<button class="flag-submit" onclick="P002App.submitFlag()">Submit Flag</button>';
    body.appendChild(flagArea);
    const helpRow = document.createElement('div');
    helpRow.className = 'challenge-help-row';
    helpRow.innerHTML =
      '<button class="challenge-help-btn" onclick="P002App.backToReader()">📖 Review</button>'+
      '<button class="challenge-help-btn ai" onclick="P002App.showHint()">💡 Hint</button>'+
      '<button class="challenge-help-btn ai" onclick="P002App.openChallengeChat()">💬 Discuss</button>';
    body.appendChild(helpRow);
  }

  function trySimLogin() {
    const pass = document.getElementById('simPass')?.value || '';
    const result = document.getElementById('simResult');
    const flag = sectionData?.challenge?.flag || '';
    const isInjection = pass.includes("'") && (pass.toLowerCase().includes('or') || pass.includes('1=1') || pass.includes('--'));
    if (pass.toLowerCase().trim() === flag.toLowerCase().trim() || isInjection) {
      result.innerHTML = '<span style="color:#4ade80;">⚠️ SQL Error — Login bypassed!</span>';
      document.getElementById('flagInput').value = pass;
    } else if (pass === 'admin123' || pass === 'password') {
      result.innerHTML = '<span style="color:#4ade80;">✓ Login successful</span>';
    } else {
      result.innerHTML = '<span style="color:#ff4d4d;">✗ Invalid credentials</span>';
    }
  }

  function submitFlag() {
    const input = document.getElementById('flagInput');
    const submitted = P002Security.sanitizeInput(input.value.trim(), 200);
    const correct = sectionData?.challenge?.flag || '';
    if (!submitted) return;
    const norm = s => s.replace(/\s/g,'').toLowerCase();
    if (norm(submitted) === norm(correct)) {
      flagCaptured(submitted);
    } else {
      showToast('Incorrect — try again', false);
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => input.style.borderColor = '', 1500);
    }
  }

  async function flagCaptured(payload) {
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
    const hint = hints[currentHintIndex] || hints[hints.length-1];
    document.getElementById('hintLabel').textContent = 'Hint '+(currentHintIndex+1)+' of '+hints.length;
    document.getElementById('hintText').innerHTML = formatBodyText(hint);
    document.getElementById('hintDrawer').classList.add('visible');
  }

  function nextHint() {
    const hints = sectionData?.challenge?.hints || [];
    if (currentHintIndex < hints.length-1) { currentHintIndex++; showHint(); }
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
    document.getElementById('messages').style.paddingTop = '';
    showScreen('chatScreen');
    const sp = 'You are an AI tutor. Help the student with this challenge: "'+(sectionData?.challenge?.title||'')+'". Give hints without giving away the answer. Context: '+(sectionData?.ai_context||'');
    callClaude(sp, [{role:'user',content:"I'm stuck on the challenge, give me a hint."}]);
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
    document.getElementById('debriefBannerSub').textContent = (sectionData?.meta?.title||'')+' complete';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('messages').style.paddingTop = '60px';
    showScreen('chatScreen');
    const sp = 'You are an AI tutor debriefing a student. Section: "'+(sectionData?.meta?.title||'')+'". Context: '+(sectionData?.ai_context||'')+'. The student used payload: "'+payload+'". Explain in 3-4 sentences what happened and why it worked. Then offer to go deeper. Be direct.';
    const um = 'I just captured the flag with: "'+payload+'". Debrief me.';
    chatHistory.push({role:'user',content:um});
    callClaude(sp, chatHistory);
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
      const reply = await P002Api.callClaude(systemPrompt, messages.slice(-4), sig);
      removeTyping();
      chatHistory.push({role:'assistant',content:reply});
      addMessage('assistant', reply);
      if (chatMode === 'debrief' && chatHistory.length <= 3) {
        addChatChips(['How do I prevent this?','Real-world impact?','Go deeper on the query']);
      }
    } catch(e) {
      removeTyping();
      showToast('Error: '+P002Security.escapeHtml(e.message));
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
    chatHistory.push({role:'user',content:sanitized});
    document.querySelectorAll('.chat-chips').forEach(c => c.remove());
    const sp = chatMode === 'debrief'
      ? 'You are an AI tutor debriefing a cybersecurity challenge. Section: "'+(sectionData?.meta?.title||'')+'". Context: '+(sectionData?.ai_context||'')+'. Answer follow-up questions about what happened and why.'
      : buildFreeChatSystemPrompt();
    callClaude(sp, chatHistory);
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
        const s = P002Security.sanitizeInput(opt, 200);
        addMessage('user', s);
        chatHistory.push({role:'user',content:s});
        const sp = chatMode === 'debrief'
          ? 'You are an AI tutor debriefing. Context: '+(sectionData?.ai_context||'')
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

  function removeTyping() { const t = document.getElementById('typing-indicator'); if (t) t.remove(); }

  function formatChatMessage(text) {
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push('<pre><code>'+P002Security.escapeHtml(code.trim())+'</code></pre>');
      return '%%CB'+idx+'%%';
    });
    const inlineCode = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCode.length;
      inlineCode.push('<code>'+P002Security.escapeHtml(code)+'</code>');
      return '%%IC'+idx+'%%';
    });
    text = P002Security.escapeHtml(text);
    text = text.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
    codeBlocks.forEach((b,i) => { text = text.replace('%%CB'+i+'%%', b); });
    inlineCode.forEach((c,i) => { text = text.replace('%%IC'+i+'%%', c); });
    return text;
  }

  // ==================== LEGACY FALLBACK ====================
  function startLegacySession() {
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
    const sp = (sectionData?.system_prompt||'You are a cybersecurity instructor.') +
      (sectionData?.reading_material ? '\n\nREADING MATERIAL:\n'+sectionData.reading_material : '');
    callClaude(sp, [{role:'user',content:'Begin the lesson.'}]);
  }

  // ==================== UI HELPERS ====================
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function setStatus(online, label) {
    document.getElementById('statusDot').className = 'status-dot'+(online?' online':'');
    document.getElementById('statusText').textContent = label;
  }

  function showToast(msg, success = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = success ? 'var(--success)' : 'var(--surface)';
    toast.style.color = success ? '#000' : 'var(--text)';
    toast.style.border = '1px solid '+(success?'var(--success)':'var(--border2)');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function showAuthError(msg) { const el = document.getElementById('authError'); el.textContent = msg; el.style.display = 'block'; }
  function hideAuthError() { document.getElementById('authError').style.display = 'none'; }
  function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
  function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }

  // ==================== PUBLIC API ====================
  return {
    init, handleAuth, logout, switchTab,
    loadModuleCatalog, openModule, backToHome, backToModule,
    openSectionPreview, backToSectionPreview,
    startReading, endReading,
    handlePopupAction, closeDrawer, sendDrawerMessage,
    openFreeChat, closeFreeChat,
    openChallenge, skipChallenge, trySimLogin, submitFlag,
    showHint, nextHint, closeHintDrawer, openChallengeChat,
    continueAfterDebrief, backToReader,
    sendMessage, handleChatKey, autoResize,
    showAdmin, showToast,
  };

})();

window.addEventListener('load', P002App.init);
