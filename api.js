// ================================================================
// PROJECT 002 -- api.js
// Shared API layer for index.html and admin.html
// Handles all Supabase and Edge Function communication
// ================================================================

var P002Api = (() => {

  // ==================== CONFIG ====================
  const SUPABASE_URL = 'https://obobtgryhcrptcyaukvw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ib2J0Z3J5aGNycHRjeWF1a3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MTUxMzQsImV4cCI6MjA5MTI5MTEzNH0.o3Rq3VqTN6uWzX4Uqfqd8VpH2wlS5PmoDvtRQOMc9EU';
  const CLAUDE_PROXY    = `${SUPABASE_URL}/functions/v1/claude-proxy`;
  const ADMIN_PROXY     = `${SUPABASE_URL}/functions/v1/admin-proxy`;
  const GENERATE_PROXY  = `${SUPABASE_URL}/functions/v1/generate`;
  const BUCKET = 'project002-docs';

  // ==================== CLIENT ====================
  let _client = null;

  function getClient() {
    if (!_client) {
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _client;
  }

  // ==================== AUTH ====================
  async function getSession() {
    const { data: { session } } = await getClient().auth.getSession();
    return session;
  }

  async function getUser() {
    const { data: { user } } = await getClient().auth.getUser();
    return user;
  }

  async function signIn(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function signUp(email, password) {
    const { data, error } = await getClient().auth.signUp({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function signOut() {
    await getClient().auth.signOut();
  }

  async function isAdmin() {
    // Admin check handled server-side by admin-proxy.
    // Never expose admin UID client-side — we infer by whether admin-proxy
    // accepts a privileged call from this user.
    try {
      await adminRequest('get_stats');
      return true;
    } catch(e) {
      return false;
    }
  }

  // ==================== STORAGE ====================
  // Raw uploaded source files live in the BUCKET. These helpers wrap the
  // supabase storage client so admin.js doesn't have to poke at getClient()
  // directly. Server-side RLS / bucket policies still enforce admin-only.
  async function deleteFile(path) {
    const { error } = await getClient().storage
      .from(BUCKET)
      .remove([path]);
    if (error) throw error;
    return true;
  }

  async function listBucket(folder = '') {
    const { data, error } = await getClient().storage
      .from(BUCKET)
      .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    return data || [];
  }

  async function adminGetFile(path) {
    const { data, error } = await getClient().storage
      .from(BUCKET)
      .download(path);
    if (error) throw error;
    return await data.text();
  }

  async function adminSaveFile(path, content) {
    const blob = new Blob([content], { type: 'application/json' });
    const { error } = await getClient().storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true, contentType: 'application/json' });
    if (error) throw error;
    return true;
  }

  // ==================== SESSIONS ====================
  async function createSession(sectionNumber, module) {
    const user = await getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await getClient()
      .from('sessions')
      .insert({ user_id: user.id, section_number: sectionNumber, module })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  }

  async function getSessionMessages(sessionId) {
    const { data, error } = await getClient()
      .from('session_messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) return [];
    return data;
  }

  async function saveMessage(sessionId, role, content) {
    if (!sessionId) return;
    await getClient().from('session_messages').insert({ session_id: sessionId, role, content });
  }

  async function completeSession(sessionId) {
    if (!sessionId) return;
    await getClient().from('sessions').update({ completed_at: new Date().toISOString() }).eq('id', sessionId);
  }

  async function captureFlag(sessionId) {
    if (!sessionId) return;
    await getClient().from('sessions').update({ flag_captured: true }).eq('id', sessionId);
  }

  // ==================== CLAUDE PROXY ====================
  async function callClaude(systemPrompt, messages, systemSig = null, model = null) {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');

    const body = { system: systemPrompt, messages };
    if (systemSig) body.system_sig = systemSig;
    if (model) body.model = model;

    const response = await fetch(CLAUDE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || data.error);
    return data.content[0].text;
  }

  // ==================== ADMIN PROXY ====================
  async function adminRequest(action, payload = {}) {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');
    const response = await fetch(ADMIN_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ action, payload })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function adminGetSessions(limit = 100)       { return adminRequest('get_sessions', { limit }); }
  async function adminGetSessionMessages(sessionId)  { return adminRequest('get_session_messages', { session_id: sessionId }); }
  async function adminGetUsers()                     { return adminRequest('get_users'); }
  async function adminGetStats()                     { return adminRequest('get_stats'); }
  async function adminRunSql(query)                  { return adminRequest('run_sql', { query }); }
  async function adminDeleteSession(sessionId)       { return adminRequest('delete_session', { session_id: sessionId }); }
  async function adminBanUser(userId, ban = true)    { return adminRequest('disable_user', { user_id: userId, ban }); }

  // ==================== GENERATE PROXY ====================
  async function generateRequest(action, payload = {}) {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');
    const response = await fetch(GENERATE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // Init from raw text (library import)

  // Init from uploaded file in Storage

  // Generate one section — call in a loop

  // Poll generation status

  // Get full course + sections for reading
  async function getCourse(courseId) {
    return generateRequest('get_course', { course_id: courseId });
  }

  // Get all courses for current user
  async function getMyCourses() {
    return generateRequest('get_my_courses');
  }

  // Save reading/KC progress
  async function saveProgress(sectionId, courseId, read, kcScore) {
    return generateRequest('save_progress', {
      section_id: sectionId,
      course_id:  courseId,
      read,
      kc_score:   kcScore,
    });
  }

  // Regenerate an existing course via SSE — wipes sections, reruns pipeline using stored source text
  // onProgress(pct, sectionTitle, done) called after each section
  // onOutline(courseId, outline) called when outline is ready
  function regenerateCourse(courseId, onProgress, onOutline = null) {
    return new Promise((resolve, reject) => {
      const session = getSession();
      session.then(sess => {
        if (!sess) return reject(new Error('Not authenticated'));

        const body = JSON.stringify({
          action: 'regenerate_course',
          course_id: courseId,
        });

        fetch(GENERATE_PROXY, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sess.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body,
        }).then(response => {
          if (!response.ok) {
            response.json().then(d => reject(new Error(d.error || 'Regeneration failed')));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let sourceId = null;
          let outline = null;
          // Hoisted across processBuffer() calls so events split across network
          // chunks aren't dropped when the trailing blank-line delimiter arrives
          // in a later chunk.
          let eventName = '';
          let dataStr = '';

          function processBuffer() {
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop();

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                // SSE allows multiple data: lines per event — concatenate with \n
                dataStr = dataStr ? dataStr + '\n' + line.slice(6) : line.slice(6);
              } else if (line === '' && eventName && dataStr) {
                try {
                  const data = JSON.parse(dataStr);
                  if (eventName === 'outline') {
                    sourceId = data.source_id;
                    outline  = data.outline;
                    if (onOutline) onOutline(courseId, outline);
                  } else if (eventName === 'section_done') {
                    if (onProgress) onProgress(data.pct, data.title, data.done);
                  } else if (eventName === 'complete') {
                    resolve({ course_id: courseId, source_id: sourceId, outline });
                  } else if (eventName === 'error') {
                    reject(new Error(data.message));
                  }
                } catch(e) {}
                eventName = '';
                dataStr = '';
              }
            }
          }

          function read() {
            reader.read().then(({ done, value }) => {
              if (done) {
                // Flush any trailing event that wasn't terminated by a blank line
                if (buffer) { buffer += '\n'; processBuffer(); }
                if (outline) resolve({ course_id: courseId, source_id: sourceId, outline });
                else reject(new Error('Stream ended unexpectedly'));
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              processBuffer();
              read();
            }).catch(reject);
          }

          read();
        }).catch(reject);
      }).catch(reject);
    });
  }

  // Full generation via SSE — server-side loop, user can navigate freely
  // onProgress(pct, sectionTitle, done) called after each section
  // onOutline(courseId, outline) called when outline is ready
  function generateCourse(title, author, sourceType, sourceUrl, rawText, onProgress, temperature = 0.7, onOutline = null) {
    return new Promise((resolve, reject) => {
      const session = getSession();
      session.then(sess => {
        if (!sess) return reject(new Error('Not authenticated'));

        const body = JSON.stringify({
          action:      'generate_stream',
          title, author,
          source_type: sourceType,
          source_url:  sourceUrl,
          raw_text:    rawText,
          temperature,
        });

        fetch(GENERATE_PROXY, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sess.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body,
        }).then(response => {
          if (!response.ok) {
            response.json().then(d => reject(new Error(d.error || 'Generation failed')));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let courseId = null;
          let sourceId = null;
          let outline = null;
          // Hoisted across processBuffer() calls so events split across network
          // chunks aren't dropped when the trailing blank-line delimiter arrives
          // in a later chunk.
          let eventName = '';
          let dataStr = '';

          function processBuffer() {
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                // SSE allows multiple data: lines per event — concatenate with \n
                dataStr = dataStr ? dataStr + '\n' + line.slice(6) : line.slice(6);
              } else if (line === '' && eventName && dataStr) {
                try {
                  const data = JSON.parse(dataStr);
                  if (eventName === 'outline') {
                    courseId = data.course_id;
                    sourceId = data.source_id;
                    outline  = data.outline;
                    if (onOutline) onOutline(courseId, outline);
                  } else if (eventName === 'section_done') {
                    if (onProgress) onProgress(data.pct, data.title, data.done);
                  } else if (eventName === 'complete') {
                    resolve({ course_id: courseId, source_id: sourceId, outline });
                  } else if (eventName === 'error') {
                    reject(new Error(data.message));
                  }
                } catch(e) {}
                eventName = '';
                dataStr = '';
              }
            }
          }

          function read() {
            reader.read().then(({ done, value }) => {
              if (done) {
                // Flush any trailing event that wasn't terminated by a blank line
                if (buffer) { buffer += '\n'; processBuffer(); }
                if (courseId) resolve({ course_id: courseId, source_id: sourceId, outline });
                else reject(new Error('Stream ended unexpectedly'));
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              processBuffer();
              read();
            }).catch(reject);
          }

          read();
        }).catch(reject);
      }).catch(reject);
    });
  }

  // ==================== PROMPT SIGNING ====================
  // Removed: a client-side HMAC secret is inherently public. Any "signature"
  // produced with a client-shipped key can be forged by anyone who loads this
  // JS bundle, so it provides no authentication. Transport integrity is
  // already provided by HTTPS, and prompt authorization is enforced
  // server-side via the session JWT. If prompt-level auth is needed later,
  // do it by hashing+allowlisting on the server, never by signing on the
  // client.
  async function signPrompt(_prompt) { return null; }

  // ==================== PUBLIC API ====================
  return {
    SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET,
    getClient, getSession, getUser, signIn, signUp, signOut, isAdmin,
    deleteFile, listBucket, adminGetFile, adminSaveFile,
    createSession, getSessionMessages, saveMessage, completeSession, captureFlag,
    callClaude, signPrompt,
    adminRequest, adminGetSessions, adminGetSessionMessages, adminGetUsers,
    adminGetStats, adminRunSql, adminDeleteSession, adminBanUser,
    generateRequest,
    getCourse, getMyCourses, saveProgress, generateCourse, regenerateCourse,
  };

})();