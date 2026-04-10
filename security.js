


  function validateManifestJson(text) {
    const errors = [];
    let data;
    try {
      data = JSON.parse(text);
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
        if (s.system_prompt || s.teaching_path || s.simulation) {
          errors.push('Section ' + i + ' contains disallowed fields');
        }
      });
    }

    var forbidden = ['system_prompt', 'teaching_path', 'simulation', 'teaching_rules'];
    forbidden.forEach(function(f) {
      if (data[f]) errors.push('Manifest contains disallowed field: ' + f);
    });

    if (data.module_key && !/^[a-z0-9_]+$/.test(data.module_key)) {
      errors.push('module_key must be lowercase letters, numbers, and underscores only');
    }

    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, data: data };
  }
