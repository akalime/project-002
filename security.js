// ================================================================
// PROJECT 002 — security.js
// Shared security utilities for index.html and admin.html
// ================================================================

const P002Security = (() => {

  // ==================== CONSTANTS ====================
  const MAX_ZIP_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_FILE_SIZE = 500 * 1024;       // 500KB per file
  const ALLOWED_EXTENSIONS = ['.json'];
  const REQUIRED_TOP_KEYS = ['system_prompt', 'lesson', 'teaching_path'];
  const REQUIRED_LESSON_KEYS = ['title', 'module', 'section', 'total_sections', 'difficulty'];
  const REQUIRED_NODE_KEYS = ['id', 'type', 'phase'];
  const VALID_NODE_TYPES = [
    'knowledge_probe', 'concept_delivery', 'scenario_application',
    'attack_examples', 'comprehension_check', 'practice_transition',
    'extension', 'session_wrap'
  ];
  const ALLOWED_FOLDERS = [
    'module_intro_web_apps',
    'module_sql_injection',
    'module_js_deobfuscation',
    'module_network_enumeration',
    'module_web_requests',
    'modules', // generic fallback
  ];
  const BUCKET_FOLDER = 'module_intro_web_apps'; // default

  // ==================== HTML ESCAPING ====================
  /**
   * Escape HTML special characters to prevent XSS
   * Use this for any user-supplied content inserted into the DOM
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Strip all HTML tags from a string
   */
  function stripHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '');
  }

  // ==================== PATH SANITIZATION ====================
  /**
   * Sanitize a file path — strip path traversal, enforce bucket folder
   * Returns null if path is invalid
   */
  function sanitizePath(rawPath, enforceFolder = true) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return null;

    // Normalize slashes
    let path = rawPath.replace(/\\/g, '/').trim();

    // Strip leading slashes
    path = path.replace(/^\/+/, '');

    // Block path traversal
    if (path.includes('..') || path.includes('%2e') || path.includes('%2E')) {
      console.warn('[Security] Path traversal attempt blocked:', rawPath);
      return null;
    }

    // Block null bytes
    if (path.includes('\0') || path.includes('%00')) {
      console.warn('[Security] Null byte in path blocked:', rawPath);
      return null;
    }

    // Only allow alphanumeric, hyphens, underscores, dots, forward slashes
    if (!/^[a-zA-Z0-9_\-./]+$/.test(path)) {
      console.warn('[Security] Invalid characters in path:', rawPath);
      return null;
    }

    // Enforce extension
    const ext = '.' + path.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      console.warn('[Security] Extension not allowed:', ext);
      return null;
    }

    // Enforce bucket folder prefix
    if (enforceFolder) {
      const folder = path.split('/')[0];
      const inAllowedFolder = ALLOWED_FOLDERS.includes(folder);
      if (!inAllowedFolder) {
        // Auto-prefix if just a filename with no folder
        if (!path.includes('/')) {
          path = `${BUCKET_FOLDER}/${path}`;
        } else {
          console.warn('[Security] Path outside allowed folders:', path);
          return null;
        }
      }
    }

    return path;
  }

  /**
   * Get just the filename from a path
   */
  function getFilename(path) {
    return path.split('/').pop();
  }

  // ==================== JSON VALIDATION ====================
  /**
   * Safely parse JSON — returns { ok, data, error }
   */
  function safeParseJson(str) {
    try {
      const data = JSON.parse(str);
      return { ok: true, data, error: null };
    } catch (e) {
      return { ok: false, data: null, error: e.message };
    }
  }

  /**
   * Validate a lesson JSON against the required schema
   * Returns { valid: bool, errors: string[] }
   */
  function validateLessonSchema(data) {
    const errors = [];

    // Check top-level keys
    for (const key of REQUIRED_TOP_KEYS) {
      if (!(key in data)) {
        errors.push(`Missing required top-level key: "${key}"`);
      }
    }

    if (errors.length > 0) return { valid: false, errors };

    // Validate lesson object
    if (typeof data.lesson !== 'object' || data.lesson === null) {
      errors.push('lesson must be an object');
    } else {
      for (const key of REQUIRED_LESSON_KEYS) {
        if (!(key in data.lesson)) {
          errors.push(`Missing lesson.${key}`);
        }
      }
      if (typeof data.lesson.section !== 'number') {
        errors.push('lesson.section must be a number');
      }
      if (typeof data.lesson.total_sections !== 'number') {
        errors.push('lesson.total_sections must be a number');
      }
    }

    // Validate teaching_path
    if (!Array.isArray(data.teaching_path)) {
      errors.push('teaching_path must be an array');
    } else if (data.teaching_path.length === 0) {
      errors.push('teaching_path cannot be empty');
    } else {
      data.teaching_path.forEach((node, i) => {
        for (const key of REQUIRED_NODE_KEYS) {
          if (!(key in node)) {
            errors.push(`teaching_path[${i}] missing required key: "${key}"`);
          }
        }
        if (node.type && !VALID_NODE_TYPES.includes(node.type)) {
          errors.push(`teaching_path[${i}] has unknown type: "${node.type}"`);
        }
      });
    }

    // Validate system_prompt
    if (typeof data.system_prompt !== 'string' || data.system_prompt.trim().length < 10) {
      errors.push('system_prompt must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Full validation pipeline for a lesson JSON string
   * Returns { ok, data, errors }
   */
  function validateLessonJson(jsonStr) {
    // Step 1: Parse
    const parsed = safeParseJson(jsonStr);
    if (!parsed.ok) {
      return { ok: false, data: null, errors: [`Invalid JSON: ${parsed.error}`] };
    }

    // Step 2: Schema check
    const schema = validateLessonSchema(parsed.data);
    if (!schema.valid) {
      return { ok: false, data: parsed.data, errors: schema.errors };
    }

    return { ok: true, data: parsed.data, errors: [] };
  }

  // ==================== ZIP PROCESSING ====================
  /**
   * Process a ZIP file and extract valid lesson JSONs
   * Returns { results: [{filename, path, ok, errors, content}] }
   * Requires JSZip to be loaded
   */
  async function processLessonZip(file) {
    const results = [];

    // Size check
    if (file.size > MAX_ZIP_SIZE) {
      return {
        ok: false,
        error: `ZIP file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.`,
        results: []
      };
    }

    // Load JSZip
    if (typeof JSZip === 'undefined') {
      return { ok: false, error: 'JSZip library not loaded', results: [] };
    }

    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      return { ok: false, error: `Could not read ZIP: ${e.message}`, results: [] };
    }

    const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);

    if (files.length === 0) {
      return { ok: false, error: 'ZIP is empty', results: [] };
    }

    // Process each file
    for (const filename of files) {
      const result = { filename, path: null, ok: false, errors: [], content: null };

      // Sanitize path
      const safePath = sanitizePath(filename);
      if (!safePath) {
        result.errors.push(`Invalid or unsafe path: ${filename}`);
        results.push(result);
        continue;
      }
      result.path = safePath;

      // Extract content
      let content;
      try {
        content = await zip.files[filename].async('string');
      } catch (e) {
        result.errors.push(`Could not read file: ${e.message}`);
        results.push(result);
        continue;
      }

      // Size check per file
      if (content.length > MAX_FILE_SIZE) {
        result.errors.push(`File too large (${(content.length / 1024).toFixed(0)}KB). Max is 500KB.`);
        results.push(result);
        continue;
      }

      // Validate JSON and schema
      const validation = validateLessonJson(content);
      if (!validation.ok) {
        result.errors = validation.errors;
        results.push(result);
        continue;
      }

      // All good
      result.ok = true;
      result.content = JSON.stringify(validation.data, null, 2);
      results.push(result);
    }

    return { ok: true, error: null, results };
  }

  // ==================== INPUT SANITIZATION ====================
  /**
   * Sanitize a filename for display/storage
   */
  function sanitizeFilename(name) {
    return name
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 100);
  }

  /**
   * Sanitize user input for use in queries or display
   * Strips control characters, limits length
   */
  function sanitizeInput(str, maxLength = 1000) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
      .trim()
      .slice(0, maxLength);
  }

  /**
   * Check if a string looks like a prompt injection attempt
   * Returns true if suspicious
   */
  function detectPromptInjection(str) {
    if (typeof str !== 'string') return false;
    const lower = str.toLowerCase();
    const patterns = [
      'ignore previous instructions',
      'ignore all instructions',
      'disregard your',
      'you are now',
      'new instructions:',
      'system prompt:',
      '[system]',
      '<<sys>>',
      'jailbreak',
      'dan mode',
    ];
    return patterns.some(p => lower.includes(p));
  }

  // ==================== RATE LIMITING (client-side) ====================
  const _rateLimits = {};

  /**
   * Simple client-side rate limiter
   * Returns true if action is allowed, false if rate limited
   */
  function checkRateLimit(key, maxCalls, windowMs) {
    const now = Date.now();
    if (!_rateLimits[key]) _rateLimits[key] = [];

    // Clear old entries
    _rateLimits[key] = _rateLimits[key].filter(t => now - t < windowMs);

    if (_rateLimits[key].length >= maxCalls) {
      return false;
    }

    _rateLimits[key].push(now);
    return true;
  }

  // ==================== PUBLIC API ====================
  return {
    escapeHtml,
    stripHtml,
    sanitizePath,
    sanitizeFilename,
    sanitizeInput,
    getFilename,
    safeParseJson,
    validateLessonSchema,
    validateLessonJson,
    processLessonZip,
    detectPromptInjection,
    checkRateLimit,
    BUCKET_FOLDER,
    ALLOWED_FOLDERS,
    MAX_ZIP_SIZE,
    MAX_FILE_SIZE,
  };

})();

// Alias for convenience
const escapeHtml = P002Security.escapeHtml;
