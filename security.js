// ================================================================
// PROJECT 002 -- security.js
// Shared security utilities for index.html and admin.html
// ================================================================

window.P002Security = (() => {

  // ==================== CONSTANTS ====================
  const MAX_ZIP_SIZE = 10 * 1024 * 1024;
  const MAX_FILE_SIZE = 500 * 1024;
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
    'modules',
  ];
  const BUCKET_FOLDER = 'module_intro_web_apps';

  // ==================== HTML ESCAPING ====================
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

  function stripHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '');
  }

  // ==================== PATH SANITIZATION ====================
  function sanitizePath(rawPath, enforceFolder = true) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return null;

    let path = rawPath.replace(/\\/g, '/').trim();
    path = path.replace(/^\/+/, '');

    if (path.includes('..') || path.includes('%2e') || path.includes('%2E')) {
      console.warn('[Security] Path traversal attempt blocked:', rawPath);
      return null;
    }

    if (path.includes('\0') || path.includes('%00')) {
      console.warn('[Security] Null byte in path blocked:', rawPath);
      return null;
    }

    if (!/^[a-zA-Z0-9_\-./]+$/.test(path)) {
      console.warn('[Security] Invalid characters in path:', rawPath);
      return null;
    }

    const ext = '.' + path.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      console.warn('[Security] Extension not allowed:', ext);
      return null;
    }

    if (enforceFolder) {
      // Allow root-level index.json
      if (path === 'index.json') return path;
      const folder = path.split('/')[0];
      const inAllowedFolder = ALLOWED_FOLDERS.includes(folder);
      if (!inAllowedFolder) {
        if (!path.includes('/')) {
          path = BUCKET_FOLDER + '/' + path;
        } else {
          console.warn('[Security] Path outside allowed folders:', path);
          return null;
        }
      }
    }

    return path;
  }

  function getFilename(path) {
    return path.split('/').pop();
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 100);
  }

  // ==================== JSON VALIDATION ====================
  function safeParseJson(str) {
    try {
      const data = JSON.parse(str);
      return { ok: true, data, error: null };
    } catch (e) {
      return { ok: false, data: null, error: e.message };
    }
  }

  function validateLessonSchema(data) {
    const errors = [];

    for (const key of REQUIRED_TOP_KEYS) {
      if (!(key in data)) {
        errors.push('Missing required top-level key: "' + key + '"');
      }
    }

    if (errors.length > 0) return { valid: false, errors };

    if (typeof data.lesson !== 'object' || data.lesson === null) {
      errors.push('lesson must be an object');
    } else {
      for (const key of REQUIRED_LESSON_KEYS) {
        if (!(key in data.lesson)) {
          errors.push('Missing lesson.' + key);
        }
      }
      if (typeof data.lesson.section !== 'number') {
        errors.push('lesson.section must be a number');
      }
      if (typeof data.lesson.total_sections !== 'number') {
        errors.push('lesson.total_sections must be a number');
      }
    }

    if (!Array.isArray(data.teaching_path)) {
      errors.push('teaching_path must be an array');
    } else if (data.teaching_path.length === 0) {
      errors.push('teaching_path cannot be empty');
    } else {
      data.teaching_path.forEach((node, i) => {
        for (const key of REQUIRED_NODE_KEYS) {
          if (!(key in node)) {
            errors.push('teaching_path[' + i + '] missing required key: "' + key + '"');
          }
        }
        if (node.type && !VALID_NODE_TYPES.includes(node.type)) {
          errors.push('teaching_path[' + i + '] has unknown type: "' + node.type + '"');
        }
      });
    }

    if (typeof data.system_prompt !== 'string' || data.system_prompt.trim().length < 10) {
      errors.push('system_prompt must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }

  function validateLessonJson(jsonStr) {
    const parsed = safeParseJson(jsonStr);
    if (!parsed.ok) {
      return { ok: false, data: null, errors: ['Invalid JSON: ' + parsed.error] };
    }

    const schema = validateLessonSchema(parsed.data);
    if (!schema.valid) {
      return { ok: false, data: parsed.data, errors: schema.errors };
    }

    return { ok: true, data: parsed.data, errors: [] };
  }

  // ==================== MANIFEST VALIDATION ====================
  function validateManifestJson(jsonStr) {
    const errors = [];
    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch(e) {
      return { ok: false, errors: ['Invalid JSON: ' + e.message] };
    }

    if (typeof data !== 'object' || Array.isArray(data)) errors.push('Root must be an object');
    if (typeof data.module_key !== 'string' || !data.module_key.trim()) errors.push('Missing module_key string');
    if (typeof data.title !== 'string' || !data.title.trim()) errors.push('Missing title string');
    if (!Array.isArray(data.sections)) errors.push('sections must be an array');

    if (Array.isArray(data.sections)) {
      data.sections.forEach(function(s, i) {
        if (typeof s.file !== 'string' || !s.file.trim()) errors.push('Section ' + i + ' missing file');
        if (typeof s.title !== 'string' || !s.title.trim()) errors.push('Section ' + i + ' missing title');
        // Block lesson fields inside manifest sections
        if (s.system_prompt || s.teaching_path || s.simulation) {
          errors.push('Section ' + i + ' contains disallowed fields');
        }
      });
    }

    // Block lesson fields at top level
    var forbidden = ['system_prompt', 'teaching_path', 'simulation', 'teaching_rules'];
    forbidden.forEach(function(f) {
      if (data[f]) errors.push('Manifest contains disallowed field: ' + f);
    });

    // module_key must be safe
    if (data.module_key && !/^[a-z0-9_]+$/.test(data.module_key)) {
      errors.push('module_key must be lowercase letters, numbers, and underscores only');
    }

    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, data: data };
  }

  // ==================== ZIP PROCESSING ====================
  async function processLessonZip(file) {
    const results = [];

    if (file.size > MAX_ZIP_SIZE) {
      return {
        ok: false,
        error: 'ZIP file too large (' + (file.size / 1024 / 1024).toFixed(1) + 'MB). Max is 10MB.',
        results: []
      };
    }

    if (typeof JSZip === 'undefined') {
      return { ok: false, error: 'JSZip library not loaded', results: [] };
    }

    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      return { ok: false, error: 'Could not read ZIP: ' + e.message, results: [] };
    }

    const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);

    if (files.length === 0) {
      return { ok: false, error: 'ZIP is empty', results: [] };
    }

    for (const filename of files) {
      const result = { filename, path: null, ok: false, errors: [], content: null };

      const safePath = sanitizePath(filename);
      if (!safePath) {
        result.errors.push('Invalid or unsafe path: ' + filename);
        results.push(result);
        continue;
      }
      result.path = safePath;

      let content;
      try {
        content = await zip.files[filename].async('string');
      } catch (e) {
        result.errors.push('Could not read file: ' + e.message);
        results.push(result);
        continue;
      }

      if (content.length > MAX_FILE_SIZE) {
        result.errors.push('File too large (' + (content.length / 1024).toFixed(0) + 'KB). Max is 500KB.');
        results.push(result);
        continue;
      }

      // Route to correct validator based on filename
      const baseName = filename.split('/').pop();
      const validation = baseName === 'manifest.json'
        ? validateManifestJson(content)
        : validateLessonJson(content);

      if (!validation.ok) {
        result.errors = validation.errors;
        results.push(result);
        continue;
      }

      result.ok = true;
      result.content = JSON.stringify(validation.data, null, 2);
      results.push(result);
    }

    return { ok: true, error: null, results };
  }

  // ==================== INPUT SANITIZATION ====================
  function sanitizeInput(str, maxLength = 1000) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
      .slice(0, maxLength);
  }

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

  // ==================== RATE LIMITING ====================
  const _rateLimits = {};

  function checkRateLimit(key, maxCalls, windowMs) {
    const now = Date.now();
    if (!_rateLimits[key]) _rateLimits[key] = [];
    _rateLimits[key] = _rateLimits[key].filter(t => now - t < windowMs);
    if (_rateLimits[key].length >= maxCalls) return false;
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
    validateManifestJson,
    processLessonZip,
    detectPromptInjection,
    checkRateLimit,
    BUCKET_FOLDER,
    ALLOWED_FOLDERS,
    MAX_ZIP_SIZE,
    MAX_FILE_SIZE,
  };

})();

const escapeHtml = P002Security.escapeHtml;
