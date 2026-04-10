// ================================================================
// PROJECT 002 -- api.js
// Shared API layer for index.html and admin.html
// Handles all Supabase and Edge Function communication
// ================================================================

const P002Api = (() => {

  // ==================== CONFIG ====================
  const SUPABASE_URL = 'https://obobtgryhcrptcyaukvw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ib2J0Z3J5aGNycHRjeWF1a3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MTUxMzQsImV4cCI6MjA5MTI5MTEzNH0.o3Rq3VqTN6uWzX4Uqfqd8VpH2wlS5PmoDvtRQOMc9EU';
  const ADMIN_USER_ID = '33a3fc69-5fad-4344-ba69-c1a4381be3d5';
  const CLAUDE_PROXY = `${SUPABASE_URL}/functions/v1/claude-proxy`;
  const ADMIN_PROXY = `${SUPABASE_URL}/functions/v1/admin-proxy`;
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

  function isAdmin(user) {
    return user?.id === ADMIN_USER_ID;
  }

  // ==================== STORAGE ====================
  async function listBucket(folder = '') {
    const { data, error } = await getClient().storage
      .from(BUCKET)
      .list(folder, { limit: 100, sortBy: { column: 'name' } });
    if (error) throw error;
    return data || [];
  }

  async function downloadFile(path) {
    const { data, error } = await getClient().storage
      .from(BUCKET)
      .download(path);
    if (error) throw error;
    return await data.text();
  }

  async function uploadFile(path, content, contentType = 'application/json') {
    const blob = new Blob([content], { type: contentType });
    const { error } = await getClient().storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true });
    if (error) throw error;
    return true;
  }

  async function deleteFile(path) {
    const { error } = await getClient().storage
      .from(BUCKET)
      .remove([path]);
    if (error) throw error;
    return true;
  }

  // ==================== SESSIONS ====================
  async function createSession(sectionNumber, module) {
    const user = await getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await getClient()
      .from('sessions')
      .insert({
        user_id: user.id,
        section_number: sectionNumber,
        module: module
      })
      .select()
      .single();

    if (error) throw error;
    return data.id;
  }

  async function getLastSession(sectionNumber, module) {
    const { data, error } = await getClient()
      .from('sessions')
      .select('id, section_number, flag_captured, started_at')
      .eq('section_number', sectionNumber)
      .eq('module', module)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
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
    await getClient().from('session_messages').insert({
      session_id: sessionId,
      role,
      content
    });
  }

  async function completeSession(sessionId) {
    if (!sessionId) return;
    await getClient().from('sessions').update({
      completed_at: new Date().toISOString()
    }).eq('id', sessionId);
  }

  async function captureFlag(sessionId) {
    if (!sessionId) return;
    await getClient().from('sessions').update({
      flag_captured: true
    }).eq('id', sessionId);
  }

  // ==================== CLAUDE PROXY ====================
  async function callClaude(systemPrompt, messages, systemSig = null) {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');

    const body = {
      system: systemPrompt,
      messages: messages
    };

    if (systemSig) body.system_sig = systemSig;

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

  async function adminGetSessions(limit = 100) {
    return adminRequest('get_sessions', { limit });
  }

  async function adminGetSessionMessages(sessionId) {
    return adminRequest('get_session_messages', { session_id: sessionId });
  }

  async function adminGetUsers() {
    return adminRequest('get_users');
  }

  async function adminGetStats() {
    return adminRequest('get_stats');
  }

  async function adminRunSql(query) {
    return adminRequest('run_sql', { query });
  }

  async function adminSaveFile(path, content) {
    return adminRequest('save_bucket_file', { path, content });
  }

  async function adminGetFile(path) {
    return adminRequest('get_bucket_file', { path });
  }

  async function adminListFiles(folder) {
    return adminRequest('list_bucket_files', { folder });
  }

  async function adminDeleteSession(sessionId) {
    return adminRequest('delete_session', { session_id: sessionId });
  }

  async function adminBanUser(userId, ban = true) {
    return adminRequest('disable_user', { user_id: userId, ban });
  }

  async function adminCreateUser(email, password) {
    return adminRequest('create_user', { email, password });
  }

  // ==================== PROMPT SIGNING ====================
  const PROMPT_SECRET = 'REPLACE_WITH_YOUR_PROMPT_SECRET';

  async function signPrompt(prompt) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(PROMPT_SECRET);
    const msgData = encoder.encode(prompt);
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, msgData);
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  // ==================== PUBLIC API ====================
  return {
    // Config
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    ADMIN_USER_ID,
    BUCKET,

    // Client
    getClient,

    // Auth
    getSession,
    getUser,
    signIn,
    signUp,
    signOut,
    isAdmin,

    // Storage
    listBucket,
    downloadFile,
    uploadFile,
    deleteFile,

    // Sessions
    createSession,
    getLastSession,
    getSessionMessages,
    saveMessage,
    completeSession,
    captureFlag,

    // Claude
    callClaude,
    signPrompt,

    // Admin
    adminRequest,
    adminGetSessions,
    adminGetSessionMessages,
    adminGetUsers,
    adminGetStats,
    adminRunSql,
    adminSaveFile,
    adminGetFile,
    adminListFiles,
    adminDeleteSession,
    adminBanUser,
    adminCreateUser,
  };

})();
