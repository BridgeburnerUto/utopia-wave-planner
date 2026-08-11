// Dragon page probe v2 — click "Dragons" in the game nav FIRST, then paste this into the
// browser console on that page. Dumps the live page's content area: text, every table
// row-by-row, every form field, and every link (so we can find the Slay tab).
//
// Output lands in a full-screen textarea, pre-selected — just hit Ctrl+C, then Esc.
// Nothing is sent anywhere; this only reads the page you are already looking at.

(() => {
  const out = [];

  const dumpTables = (root) =>
    [...root.querySelectorAll('table')].map((t, i) => {
      const rows = [...t.querySelectorAll('tr')].map(tr =>
        [...tr.querySelectorAll('th,td')].map(c => c.innerText.trim().replace(/\s+/g, ' ')).join(' | ')
      ).filter(Boolean);
      return `-- table ${i} (${rows.length} rows) --\n` + rows.join('\n');
    }).join('\n') || '(no tables)';

  const dumpForms = (root) =>
    [...root.querySelectorAll('form')].map(f =>
      `${(f.method || 'get').toUpperCase()} ${f.getAttribute('action')} :: ` +
      [...f.querySelectorAll('input,select,textarea')]
        .map(i => `${i.name || i.id || '?'}[${i.type || i.tagName.toLowerCase()}]`).join(', ')
    ).join('\n') || '(no forms)';

  const dumpLinks = (root) =>
    [...new Set([...root.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))]
      .filter(h => h && !/^(#|javascript:)/.test(h)).join('\n') || '(no links)';

  const cont = document.getElementById('dynamic_content')
            || document.querySelector('#content-area, #main, .content')
            || document.body;

  out.push(`==== ${location.pathname}${location.search} ====`);
  out.push(`--- text ---\n${cont.innerText.trim()}`);
  out.push(`--- tables ---\n${dumpTables(cont)}`);
  out.push(`--- forms ---\n${dumpForms(cont)}`);
  out.push(`--- links in content ---\n${dumpLinks(cont)}`);

  const text = out.join('\n\n');
  console.log(text);

  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, {
    position: 'fixed', inset: '0', zIndex: 999999, width: '100%', height: '100%',
    fontFamily: 'monospace', fontSize: '12px', background: '#111', color: '#eee',
  });
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  const esc = (e) => { if (e.key === 'Escape') { ta.remove(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  console.log('>>> textarea open and selected — press Ctrl+C to copy, then Esc to close');
})();
