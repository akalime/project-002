// ================================================================
// fetch.js — P002 External API Layer
// Sources: Wikipedia, OpenStax, Archive.org, Gutenberg
// Exposes: window.P002Fetch
// Load before app.js
// ================================================================

window.P002Fetch = (() => {

  const TIMEOUT_MS = 6000;
  const PD_CUTOFF = 1928;

  const ENDPOINTS = {
    wikiSearch:  'https://en.wikipedia.org/w/api.php',
    openstax:    'https://openstax.org/api/v2/pages',
    archive:     'https://archive.org/advancedsearch.php',
    gutendex:    'https://gutendex.com/books',
    olCovers:    'https://covers.openlibrary.org/b/id',
  };

  const GUTENBERG_TOPIC_MAP = {
    science:     'natural history',
    physics:     'physics',
    chemistry:   'chemistry',
    biology:     'biology',
    mathematics: 'mathematics',
    math:        'mathematics',
    history:     'history',
    medicine:    'medicine',
    anatomy:     'anatomy',
    engineering: 'engineering',
    electronics: 'electrical engineering',
    electricity: 'electricity',
    astronomy:   'astronomy',
    philosophy:  'philosophy',
    psychology:  'psychology',
    economics:   'economics',
    geology:     'geology',
  };

  const OPENSTAX_SUBJECTS = {
    math: 'Math', mathematics: 'Math', calculus: 'Math', algebra: 'Math', statistics: 'Math',
    physics: 'Science', chemistry: 'Science', biology: 'Science', science: 'Science',
    anatomy: 'Science', astronomy: 'Science', microbiology: 'Science', nursing: 'Science', medicine: 'Science',
    history: 'Humanities', philosophy: 'Humanities',
    economics: 'Social Sciences', psychology: 'Social Sciences', sociology: 'Social Sciences',
    business: 'Business', accounting: 'Business',
  };

  // ==================== UTILS ====================

  async function safeFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
  }

  function normalize(raw, source, type) {
    return {
      id:           raw.id || (source + '-' + Math.random().toString(36).slice(2)),
      title:        (raw.title || 'Unknown Title').trim(),
      author:       (raw.author || 'Unknown').trim(),
      year:         raw.year || null,
      subjects:     (raw.subjects || []).slice(0, 3),
      source:       source,
      type:         type || 'book',
      textUrl:      raw.textUrl || null,
      coverUrl:     raw.coverUrl || null,
      description:  raw.description || null,
      publicDomain: true,
    };
  }

  // ==================== WIKIPEDIA ====================

  async function fetchWikipedia(query) {
    const url = ENDPOINTS.wikiSearch + '?' + new URLSearchParams({
      action: 'query', list: 'search', srsearch: query,
      srlimit: '6', srnamespace: '0', format: 'json', origin: '*',
    });
    const res = await safeFetch(url);
    const data = await res.json();
    return (data?.query?.search || []).map(item => normalize({
      id:          'wiki-' + item.pageid,
      title:       item.title,
      author:      'Wikipedia Contributors',
      year:        new Date().getFullYear(),
      subjects:    [query],
      textUrl:     'https://en.wikipedia.org/wiki/' + encodeURIComponent(item.title.replace(/ /g, '_')),
      description: item.snippet ? item.snippet.replace(/<[^>]+>/g, '').slice(0, 120) + '...' : null,
    }, 'Wikipedia', 'article'));
  }

  async function fetchWikipediaText(title) {
    const url = ENDPOINTS.wikiSearch + '?' + new URLSearchParams({
      action: 'query', prop: 'extracts', exlimit: '1',
      titles: title, explaintext: '1', format: 'json', origin: '*',
    });
    const res = await safeFetch(url);
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (!page || page.missing) throw new Error('Article not found');
    return page.extract || '';
  }

  // ==================== OPENSTAX ====================

  async function fetchOpenStax(query) {
    const url = ENDPOINTS.openstax + '?' + new URLSearchParams({
      type: 'openstax.books.Book',
      fields: 'title,slug,subjects,cover_url,authors,publish_date,description',
      limit: '250', offset: '0',
    });
    const res = await safeFetch(url);
    const data = await res.json();
    const books = data?.items || [];
    const q = query.toLowerCase();
    const matched = books.filter(b => {
      const title = (b.title || '').toLowerCase();
      const subjects = (b.subjects || []).map(s => (s.name || s).toLowerCase()).join(' ');
      return title.includes(q) || subjects.includes(q) ||
        (OPENSTAX_SUBJECTS[q] && subjects.includes(OPENSTAX_SUBJECTS[q].toLowerCase()));
    });
    return matched.slice(0, 5).map(b => normalize({
      id:          'openstax-' + b.slug,
      title:       b.title,
      author:      (b.authors || []).map(a => a.name || a).join(', ') || 'OpenStax',
      year:        b.publish_date ? new Date(b.publish_date).getFullYear() : null,
      subjects:    (b.subjects || []).map(s => s.name || s),
      textUrl:     'https://openstax.org/books/' + b.slug + '/pages/1-introduction',
      coverUrl:    b.cover_url || null,
      description: b.description ? b.description.replace(/<[^>]+>/g, '').slice(0, 120) + '...' : null,
    }, 'OpenStax', 'textbook'));
  }

  // ==================== ARCHIVE.ORG ====================
  // Books only, public domain texts
  // User isn't redistributing — they're generating new content from it

  async function fetchArchive(query) {
    const url = ENDPOINTS.archive + '?' + new URLSearchParams({
      q:      query + ' AND mediatype:texts AND subject:' + query,
      fl:     'identifier,title,creator,date,subject,description,format',
      rows:   '8',
      output: 'json',
      // Filter to public domain and freely available items
      fq:     'licenseurl:(*creativecommons* OR *publicdomain*) OR date:[* TO ' + PD_CUTOFF + ']',
    });

    const res = await safeFetch(url);
    const data = await res.json();
    const docs = data?.response?.docs || [];

    return docs
      .filter(d => {
        // Only include items that have downloadable text formats
        const fmt = Array.isArray(d.format) ? d.format : [d.format || ''];
        return fmt.some(f => f && (
          f.toLowerCase().includes('text') ||
          f.toLowerCase().includes('pdf') ||
          f.toLowerCase().includes('epub') ||
          f.toLowerCase().includes('djvu')
        ));
      })
      .slice(0, 5)
      .map(d => {
        const year = d.date ? parseInt(d.date) : null;
        const creator = Array.isArray(d.creator) ? d.creator[0] : (d.creator || 'Unknown');
        const subjects = Array.isArray(d.subject) ? d.subject : [d.subject || query];
        const desc = Array.isArray(d.description) ? d.description[0] : (d.description || null);
        return normalize({
          id:          'ia-' + d.identifier,
          title:       d.title || 'Unknown',
          author:      creator,
          year:        year,
          subjects:    subjects.slice(0, 3),
          textUrl:     'https://archive.org/download/' + d.identifier + '/' + d.identifier + '_djvu.txt',
          coverUrl:    'https://archive.org/services/img/' + d.identifier,
          description: desc ? desc.replace(/<[^>]+>/g, '').slice(0, 120) + '...' : null,
        }, 'Archive.org', 'book');
      });
  }

  // Fetch full Archive.org text for generation pipeline
  async function fetchArchiveText(identifier) {
    // Try djvu text first (cleanest), fall back to plain text
    const urls = [
      'https://archive.org/download/' + identifier + '/' + identifier + '_djvu.txt',
      'https://archive.org/download/' + identifier + '/' + identifier + '.txt',
    ];
    for (const url of urls) {
      try {
        const res = await safeFetch(url);
        const text = await res.text();
        if (text && text.length > 500) return text.trim();
      } catch(e) { continue; }
    }
    throw new Error('Could not fetch text for ' + identifier);
  }

  // ==================== GUTENBERG ====================

  async function fetchGutendex(query) {
    const topic = GUTENBERG_TOPIC_MAP[query.toLowerCase()] || query;
    const url = ENDPOINTS.gutendex + '/?topic=' + encodeURIComponent(topic) + '&languages=en';
    const res = await safeFetch(url);
    const data = await res.json();
    return (data.results || []).slice(0, 4).map(b => normalize({
      id:       'g-' + b.id,
      title:    b.title,
      author:   b.authors?.[0]?.name || 'Unknown',
      year:     null,
      subjects: b.subjects || [],
      textUrl:  b.formats?.['text/plain; charset=utf-8'] || b.formats?.['text/plain'] || null,
      coverUrl: b.formats?.['image/jpeg'] || null,
    }, 'Gutenberg', 'book'));
  }

  // ==================== FALLBACK ====================

  const FALLBACK = {
    science: [
      { id: 'openstax-university-physics-volume-1', title: 'University Physics Volume 1', author: 'OpenStax', year: 2016, subjects: ['Physics'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/university-physics-volume-1/pages/1-introduction', description: 'Mechanics, waves, and thermodynamics for university students.' },
      { id: 'openstax-chemistry-2e', title: 'Chemistry 2e', author: 'OpenStax', year: 2019, subjects: ['Chemistry'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/chemistry-2e/pages/1-introduction', description: 'Comprehensive introduction to chemistry.' },
      { id: 'openstax-biology-2e', title: 'Biology 2e', author: 'OpenStax', year: 2018, subjects: ['Biology'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/biology-2e/pages/1-introduction', description: 'Core concepts in biology.' },
    ],
    physics: [
      { id: 'openstax-university-physics-volume-1', title: 'University Physics Volume 1', author: 'OpenStax', year: 2016, subjects: ['Physics'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/university-physics-volume-1/pages/1-introduction', description: 'Mechanics, waves, and thermodynamics.' },
      { id: 'openstax-college-physics-2e', title: 'College Physics 2e', author: 'OpenStax', year: 2022, subjects: ['Physics'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/college-physics-2e/pages/1-introduction', description: 'Algebra-based introductory physics.' },
    ],
    chemistry: [
      { id: 'openstax-chemistry-2e', title: 'Chemistry 2e', author: 'OpenStax', year: 2019, subjects: ['Chemistry'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/chemistry-2e/pages/1-introduction', description: 'Comprehensive introduction to chemistry.' },
      { id: 'openstax-chemistry-atoms-first-2e', title: 'Chemistry: Atoms First 2e', author: 'OpenStax', year: 2019, subjects: ['Chemistry'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/chemistry-atoms-first-2e/pages/1-introduction', description: 'Chemistry from an atoms-first perspective.' },
    ],
    biology: [
      { id: 'openstax-biology-2e', title: 'Biology 2e', author: 'OpenStax', year: 2018, subjects: ['Biology'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/biology-2e/pages/1-introduction', description: 'Core concepts in biology.' },
      { id: 'openstax-microbiology', title: 'Microbiology', author: 'OpenStax', year: 2016, subjects: ['Microbiology'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/microbiology/pages/1-introduction', description: 'Comprehensive microbiology for pre-health students.' },
    ],
    mathematics: [
      { id: 'openstax-calculus-volume-1', title: 'Calculus Volume 1', author: 'OpenStax', year: 2016, subjects: ['Calculus'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/calculus-volume-1/pages/1-introduction', description: 'Single-variable calculus.' },
      { id: 'openstax-algebra-trigonometry', title: 'Algebra and Trigonometry', author: 'OpenStax', year: 2015, subjects: ['Algebra'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/algebra-and-trigonometry/pages/1-introduction', description: 'Algebra and trig for STEM preparation.' },
    ],
    history: [
      { id: 'openstax-us-history', title: 'U.S. History', author: 'OpenStax', year: 2014, subjects: ['History'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/us-history/pages/1-introduction', description: 'Comprehensive U.S. history.' },
      { id: 'openstax-world-history-volume-1', title: 'World History Volume 1', author: 'OpenStax', year: 2021, subjects: ['History'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/world-history-volume-1/pages/1-introduction', description: 'World history from ancient civilizations to 1500.' },
    ],
    psychology: [
      { id: 'openstax-psychology-2e', title: 'Psychology 2e', author: 'OpenStax', year: 2020, subjects: ['Psychology'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/psychology-2e/pages/1-introduction', description: 'Introduction to psychology.' },
    ],
    economics: [
      { id: 'openstax-principles-economics-3e', title: 'Principles of Economics 3e', author: 'OpenStax', year: 2022, subjects: ['Economics'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/principles-economics-3e/pages/1-introduction', description: 'Micro and macroeconomics fundamentals.' },
    ],
    medicine: [
      { id: 'openstax-anatomy-physiology', title: 'Anatomy and Physiology', author: 'OpenStax', year: 2013, subjects: ['Anatomy', 'Medicine'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/anatomy-and-physiology/pages/1-introduction', description: 'Human anatomy and physiology.' },
      { id: 'openstax-microbiology', title: 'Microbiology', author: 'OpenStax', year: 2016, subjects: ['Microbiology'], source: 'OpenStax', type: 'textbook', textUrl: 'https://openstax.org/books/microbiology/pages/1-introduction', description: 'Microbiology for pre-health students.' },
    ],
    electronics: [
      { id: 'wiki-electronics', title: 'Electronics', author: 'Wikipedia Contributors', year: 2024, subjects: ['Electronics'], source: 'Wikipedia', type: 'article', textUrl: 'https://en.wikipedia.org/wiki/Electronics', description: 'Overview of electronics, circuits, and components.' },
    ],
    engineering: [
      { id: 'wiki-engineering', title: 'Engineering', author: 'Wikipedia Contributors', year: 2024, subjects: ['Engineering'], source: 'Wikipedia', type: 'article', textUrl: 'https://en.wikipedia.org/wiki/Engineering', description: 'Application of scientific principles to design and build.' },
    ],
  };

  function getFallback(query) {
    const q = query.toLowerCase().trim();
    if (FALLBACK[q]) return FALLBACK[q].map(b => normalize(b, b.source, b.type));
    const keyInQuery = Object.keys(FALLBACK).find(k => q.includes(k));
    if (keyInQuery) return FALLBACK[keyInQuery].map(b => normalize(b, b.source, b.type));
    const queryInKey = Object.keys(FALLBACK).find(k => k.includes(q));
    if (queryInKey) return FALLBACK[queryInKey].map(b => normalize(b, b.source, b.type));
    return FALLBACK.science.map(b => normalize(b, b.source, b.type));
  }

  // ==================== PUBLIC API ====================

  async function searchLibrary(query) {
    if (!query || !query.trim()) return [];

    const results = [];
    const seen = new Set();

    const add = (books) => {
      books.forEach(b => {
        const key = b.title.toLowerCase();
        if (!seen.has(key)) { seen.add(key); results.push(b); }
      });
    };

    // 1. Wikipedia — modern, fast, covers everything
    try { add(await fetchWikipedia(query)); }
    catch(e) { console.warn('[P002Fetch] Wikipedia failed:', e.message); }

    // 2. OpenStax — free peer-reviewed textbooks
    try { add(await fetchOpenStax(query)); }
    catch(e) { console.warn('[P002Fetch] OpenStax failed:', e.message); }

    // 3. Archive.org — books, public domain, broad catalog
    try { add(await fetchArchive(query)); }
    catch(e) { console.warn('[P002Fetch] Archive.org failed:', e.message); }

    // 4. Gutenberg — classic texts as supplement
    try { add(await fetchGutendex(query)); }
    catch(e) { console.warn('[P002Fetch] Gutendex failed:', e.message); }

    if (!results.length) {
      console.info('[P002Fetch] Using fallback for:', query);
      return getFallback(query);
    }

    return results;
  }

  // Fetch content for generation pipeline
  async function fetchBookText(item) {
    if (!item.textUrl) throw new Error('No text URL for this item');

    if (item.source === 'Wikipedia') {
      return await fetchWikipediaText(item.title);
    }

    if (item.source === 'Archive.org') {
      const identifier = item.id.replace('ia-', '');
      return await fetchArchiveText(identifier);
    }

    if (item.source === 'Gutenberg') {
      const res = await safeFetch(item.textUrl);
      const text = await res.text();
      return stripGutenbergBoilerplate(text);
    }

    // OpenStax — return URL for pipeline
    return item.textUrl;
  }

  function stripGutenbergBoilerplate(text) {
    const startMarker = text.indexOf('*** START OF');
    if (startMarker !== -1) {
      const afterStart = text.indexOf('\n', startMarker);
      text = text.slice(afterStart + 1);
    }
    const endMarker = text.indexOf('*** END OF');
    if (endMarker !== -1) text = text.slice(0, endMarker);
    return text.trim();
  }

  async function searchNASA(query)  { throw new Error('NASA not yet implemented'); }
  async function searchArxiv(query) { throw new Error('arXiv not yet implemented'); }

  return {
    searchLibrary,
    fetchBookText,
    searchNASA,
    searchArxiv,
    _fetchWikipedia:  fetchWikipedia,
    _fetchOpenStax:   fetchOpenStax,
    _fetchArchive:    fetchArchive,
    _fetchGutendex:   fetchGutendex,
  };

})();
