// ================================================================
// fetch.js — P002 External API Layer
// All third-party data fetching lives here
// Exposes: window.P002Fetch
// Load before app.js
// ================================================================

window.P002Fetch = (() => {

  // ==================== CONFIG ====================
  const TIMEOUT_MS = 6000;
  const PD_CUTOFF = 1928; // Public domain cutoff year

  const ENDPOINTS = {
    gutendex:    'https://gutendex.com/books',
    openLibrary: 'https://openlibrary.org/search.json',
    olCovers:    'https://covers.openlibrary.org/b/id',
    archive:     'https://archive.org/advancedsearch.php',
  };

  // ==================== FALLBACK DATA ====================
  // Used when APIs are blocked by CORS in dev/PWA context
  const FALLBACK = {
    electronics: [
      { id: 'g-21289', title: 'Experimental Researches in Electricity', author: 'Michael Faraday', year: 1839, subjects: ['Electricity', 'Magnetism'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/21289/pg21289.txt' },
      { id: 'g-13476', title: 'A Treatise on Electricity and Magnetism', author: 'James Clerk Maxwell', year: 1873, subjects: ['Electromagnetism', 'Physics'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/13476/pg13476.txt' },
      { id: 'g-28498', title: 'Wireless Telegraphy and Telephony', author: 'Alfred Thomas Story', year: 1904, subjects: ['Radio', 'Telegraph'], source: 'Gutenberg', textUrl: null },
      { id: 'g-14846', title: 'Electricity for Boys', author: 'J.S. Zerbe', year: 1914, subjects: ['Electricity', 'Education'], source: 'Gutenberg', textUrl: null },
      { id: 'ol-1', title: 'The Boy Electrician', author: 'J.W. Sims', year: 1907, subjects: ['Electricity', 'Experiments'], source: 'Open Library', textUrl: null },
    ],
    science: [
      { id: 'g-2009', title: 'On the Origin of Species', author: 'Charles Darwin', year: 1859, subjects: ['Evolution', 'Biology'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/2009/pg2009.txt' },
      { id: 'g-5001', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein', year: 1920, subjects: ['Physics', 'Relativity'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/5001/pg5001.txt' },
      { id: 'g-4942', title: 'Mathematical Principles of Natural Philosophy', author: 'Isaac Newton', year: 1687, subjects: ['Physics', 'Mathematics'], source: 'Gutenberg', textUrl: null },
      { id: 'ol-2', title: 'The Principles of Chemistry', author: 'Dmitri Mendeleev', year: 1891, subjects: ['Chemistry', 'Elements'], source: 'Open Library', textUrl: null },
    ],
    history: [
      { id: 'g-890',  title: 'The History of the Decline and Fall of the Roman Empire', author: 'Edward Gibbon', year: 1776, subjects: ['Rome', 'History'], source: 'Gutenberg', textUrl: null },
      { id: 'g-132',  title: 'The Art of War', author: 'Sun Tzu', year: 500, subjects: ['Military', 'Strategy'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/132/pg132.txt' },
      { id: 'g-3776', title: 'Common Sense', author: 'Thomas Paine', year: 1776, subjects: ['Revolution', 'Politics'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/3776/pg3776.txt' },
      { id: 'g-1404', title: 'The Federalist Papers', author: 'Hamilton, Madison, Jay', year: 1788, subjects: ['Politics', 'Constitution'], source: 'Gutenberg', textUrl: null },
    ],
    medicine: [
      { id: 'ol-3', title: "Gray's Anatomy", author: 'Henry Gray', year: 1858, subjects: ['Anatomy', 'Medicine'], source: 'Open Library', textUrl: null },
      { id: 'ol-4', title: 'On the Fabric of the Human Body', author: 'Andreas Vesalius', year: 1543, subjects: ['Anatomy', 'Surgery'], source: 'Open Library', textUrl: null },
      { id: 'ol-5', title: 'The Merck Manual', author: 'Merck & Co.', year: 1899, subjects: ['Medicine', 'Reference'], source: 'Open Library', textUrl: null },
    ],
    engineering: [
      { id: 'g-8491', title: 'The Steam Engine Explained', author: 'Dionysius Lardner', year: 1836, subjects: ['Steam', 'Engineering'], source: 'Gutenberg', textUrl: null },
      { id: 'ol-6',  title: 'Bridges and How They Are Built', author: 'F.E. Kidder', year: 1900, subjects: ['Bridges', 'Structural'], source: 'Open Library', textUrl: null },
      { id: 'ol-7',  title: 'A Manual of Steam Engineering', author: 'Walter Rogers', year: 1887, subjects: ['Steam', 'Boilers'], source: 'Open Library', textUrl: null },
    ],
    mathematics: [
      { id: 'g-21076', title: 'Elements', author: 'Euclid', year: 300, subjects: ['Geometry', 'Mathematics'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/21076/pg21076.txt' },
      { id: 'g-38769', title: 'A Course of Pure Mathematics', author: 'G.H. Hardy', year: 1908, subjects: ['Analysis', 'Calculus'], source: 'Gutenberg', textUrl: null },
      { id: 'g-25447', title: 'Introduction to Mathematical Philosophy', author: 'Bertrand Russell', year: 1919, subjects: ['Logic', 'Philosophy'], source: 'Gutenberg', textUrl: null },
    ],
    astronomy: [
      { id: 'ol-8',   title: 'Astronomy for Amateurs', author: 'Camille Flammarion', year: 1904, subjects: ['Astronomy', 'Stars'], source: 'Open Library', textUrl: null },
      { id: 'g-9785', title: 'A Text-Book of Astronomy', author: 'George Comstock', year: 1901, subjects: ['Astronomy', 'Physics'], source: 'Gutenberg', textUrl: null },
    ],
    chemistry: [
      { id: 'g-16294', title: 'The Principles of Chemistry', author: 'Dmitri Mendeleev', year: 1891, subjects: ['Chemistry', 'Periodic Table'], source: 'Gutenberg', textUrl: null },
      { id: 'ol-9',   title: 'A Manual of Chemistry', author: 'William Thomas Brande', year: 1819, subjects: ['Chemistry', 'Elements'], source: 'Open Library', textUrl: null },
    ],
    programming: [
      { id: 'g-84',   title: 'Frankenstein', author: 'Mary Shelley', year: 1818, subjects: ['Fiction', 'Science'], source: 'Gutenberg', textUrl: 'https://www.gutenberg.org/cache/epub/84/pg84.txt' },
    ],
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

  function normalize(raw, source) {
    return {
      id:          raw.id || (source + '-' + Math.random().toString(36).slice(2)),
      title:       (raw.title || 'Unknown Title').trim(),
      author:      (raw.author || 'Unknown').trim(),
      year:        raw.year || null,
      subjects:    (raw.subjects || []).slice(0, 3),
      source:      source,
      textUrl:     raw.textUrl || null,
      coverUrl:    raw.coverUrl || null,
      publicDomain: true,
    };
  }

  function getFallback(query) {
    const q = query.toLowerCase();
    const key = Object.keys(FALLBACK).find(k => q.includes(k));
    return (key ? FALLBACK[key] : FALLBACK.science).map(b => normalize(b, b.source));
  }

  // ==================== GUTENDEX ====================

  async function fetchGutendex(query) {
    const url = ENDPOINTS.gutendex + '/?search=' + encodeURIComponent(query) + '&languages=en';
    const res = await safeFetch(url);
    const data = await res.json();
    return (data.results || []).slice(0, 8).map(b => normalize({
      id:       'g-' + b.id,
      title:    b.title,
      author:   b.authors?.[0]?.name || 'Unknown',
      year:     null, // Gutendex doesn't return year reliably
      subjects: b.subjects || [],
      textUrl:  b.formats?.['text/plain; charset=utf-8'] ||
                b.formats?.['text/plain'] ||
                null,
      coverUrl: b.formats?.['image/jpeg'] || null,
    }, 'Gutenberg'));
  }

  // ==================== OPEN LIBRARY ====================

  async function fetchOpenLibrary(query) {
    const url = ENDPOINTS.openLibrary +
      '?q=' + encodeURIComponent(query) +
      '&fields=key,title,author_name,cover_i,subject,first_publish_year' +
      '&filter=ebooks&limit=8&sort=editions';
    const res = await safeFetch(url);
    const data = await res.json();
    return (data.docs || [])
      .filter(b => !b.first_publish_year || b.first_publish_year < PD_CUTOFF)
      .slice(0, 6)
      .map(b => normalize({
        id:       'ol-' + (b.key || '').replace('/works/', ''),
        title:    b.title,
        author:   b.author_name?.[0] || 'Unknown',
        year:     b.first_publish_year || null,
        subjects: b.subject || [],
        textUrl:  null,
        coverUrl: b.cover_i
          ? ENDPOINTS.olCovers + '/' + b.cover_i + '-M.jpg'
          : null,
      }, 'Open Library'));
  }

  // ==================== ARCHIVE.ORG ====================
  // Future — placeholder for now

  async function fetchArchive(query) {
    const url = ENDPOINTS.archive +
      '?q=' + encodeURIComponent(query) +
      '+AND+mediatype:texts+AND+licenseurl:*publicdomain*' +
      '&fl=identifier,title,creator,date,subject' +
      '&rows=6&output=json';
    const res = await safeFetch(url);
    const data = await res.json();
    return (data.response?.docs || []).map(b => normalize({
      id:      'ia-' + b.identifier,
      title:   b.title || 'Unknown',
      author:  Array.isArray(b.creator) ? b.creator[0] : (b.creator || 'Unknown'),
      year:    b.date ? parseInt(b.date) : null,
      subjects: Array.isArray(b.subject) ? b.subject : [],
      textUrl: 'https://archive.org/download/' + b.identifier + '/' + b.identifier + '_djvu.txt',
    }, 'Internet Archive'));
  }

  // ==================== PUBLIC API ====================

  // Main search — tries live APIs, falls back to mock on failure
  async function searchLibrary(query) {
    if (!query || !query.trim()) return [];

    const results = [];

    // Try Gutendex
    try {
      const gutenbergBooks = await fetchGutendex(query);
      results.push(...gutenbergBooks);
    } catch(e) {
      console.warn('[P002Fetch] Gutendex failed:', e.message);
    }

    // Try Open Library
    try {
      const olBooks = await fetchOpenLibrary(query);
      // Deduplicate by title
      const existingTitles = new Set(results.map(b => b.title.toLowerCase()));
      olBooks.forEach(b => {
        if (!existingTitles.has(b.title.toLowerCase())) results.push(b);
      });
    } catch(e) {
      console.warn('[P002Fetch] Open Library failed:', e.message);
    }

    // If both failed, use fallback
    if (!results.length) {
      console.info('[P002Fetch] Using fallback data for:', query);
      return getFallback(query);
    }

    return results;
  }

  // Fetch raw text content of a book for generation pipeline
  async function fetchBookText(textUrl) {
    if (!textUrl) throw new Error('No text URL provided');
    const res = await safeFetch(textUrl);
    const text = await res.text();
    // Strip Gutenberg header/footer boilerplate
    return stripGutenbergBoilerplate(text);
  }

  function stripGutenbergBoilerplate(text) {
    // Remove everything before "*** START OF" marker
    const startMarker = text.indexOf('*** START OF');
    if (startMarker !== -1) {
      const afterStart = text.indexOf('\n', startMarker);
      text = text.slice(afterStart + 1);
    }
    // Remove everything after "*** END OF" marker
    const endMarker = text.indexOf('*** END OF');
    if (endMarker !== -1) {
      text = text.slice(0, endMarker);
    }
    return text.trim();
  }

  // Future: OpenStax
  async function searchOpenStax(query) {
    // TODO: OpenStax doesn't have a public API yet
    // Will scrape or use their subject catalog
    throw new Error('OpenStax not yet implemented');
  }

  // Future: NASA Technical Reports
  async function searchNASA(query) {
    // TODO: https://ntrs.nasa.gov/api/citations/search?query=
    throw new Error('NASA search not yet implemented');
  }

  // Future: arXiv papers
  async function searchArxiv(query) {
    // TODO: http://export.arxiv.org/api/query?search_query=
    throw new Error('arXiv search not yet implemented');
  }

  // ==================== EXPOSE ====================
  return {
    searchLibrary,
    fetchBookText,
    searchOpenStax,
    searchNASA,
    searchArxiv,
    // Internals exposed for testing
    _fetchGutendex:    fetchGutendex,
    _fetchOpenLibrary: fetchOpenLibrary,
    _fetchArchive:     fetchArchive,
  };

})();
