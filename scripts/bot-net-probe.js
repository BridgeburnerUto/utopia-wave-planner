// Intel-Bot network probe — paste into the console on the fund_dragon page, THEN type
// "dragon" into the in-game BOT box and hit Send.
//
// Hooks fetch / XMLHttpRequest / WebSocket and records every request and response so we can
// see how the bot panel talks to its server — URL, method, body, and the raw reply. If we can
// call that endpoint ourselves, the wave planner can pull the per-province dragon fund
// numbers on a timer instead of anyone copy-pasting.
//
// When the bot has answered, run:  __dumpNet()
// to get a select-all textarea (Ctrl+C, then Esc). Reload the page to remove the hooks.

(() => {
  if (window.__netLog) { console.log('probe already installed — run __dumpNet()'); return; }
  const log = window.__netLog = [];
  const clip = (s, n = 4000) => (typeof s === 'string' ? s : JSON.stringify(s) || String(s)).slice(0, n);
  const stamp = () => new Date().toISOString().slice(11, 23);

  // ── fetch ────────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url  = typeof input === 'string' ? input : input?.url;
    const meth = init?.method || (typeof input === 'object' && input?.method) || 'GET';
    const body = init?.body;
    const res  = await origFetch.apply(this, arguments);
    let text = '(unread)';
    try { text = await res.clone().text(); } catch (e) { text = '(clone failed: ' + e.message + ')'; }
    log.push(`[${stamp()}] FETCH ${meth} ${url}\n  body: ${clip(body, 1000)}\n  -> ${res.status}\n  ${clip(text)}`);
    return res;
  };

  // ── XMLHttpRequest ───────────────────────────────────────────────────────
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    this.addEventListener('load', () => {
      log.push(`[${stamp()}] XHR ${this.__m} ${this.__u}\n  body: ${clip(b, 1000)}\n  -> ${this.status}\n  ${clip(this.responseText)}`);
    });
    return XS.apply(this, arguments);
  };

  // ── WebSocket (the chat/bot panel may run over a socket) ─────────────────
  const OW = window.WebSocket;
  window.WebSocket = function (url, protos) {
    const ws = new OW(url, protos);
    log.push(`[${stamp()}] WS OPEN ${url}`);
    ws.addEventListener('message', (e) => log.push(`[${stamp()}] WS RECV ${url}\n  ${clip(e.data)}`));
    const os = ws.send.bind(ws);
    ws.send = (d) => { log.push(`[${stamp()}] WS SEND ${url}\n  ${clip(d, 1000)}`); return os(d); };
    return ws;
  };
  window.WebSocket.prototype = OW.prototype;

  window.__dumpNet = () => {
    const text = log.join('\n\n') || '(nothing captured yet)';
    console.log(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, {
      position: 'fixed', inset: '0', zIndex: 999999, width: '100%', height: '100%',
      fontFamily: 'monospace', fontSize: '12px', background: '#111', color: '#eee',
    });
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { ta.remove(); document.removeEventListener('keydown', esc); }
    });
    return '>>> Ctrl+C to copy, Esc to close';
  };

  console.log('net probe installed — run the bot "dragon" command, then call __dumpNet()');
})();
