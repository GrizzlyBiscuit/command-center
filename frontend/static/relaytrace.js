/* Command Center — Relay Trace (live model-pair activity).
 * Subscribes to the shared /stream SSE but shows ONLY relay-tagged events
 * (lines prefixed '⟳ '), so you watch the Discord model-pair think in real
 * time: recv -> model start -> model done -> sent. Reuses the Control-console
 * SSE plumbing; lazy mount() like the other tabs.
 */
window.CCRelayTrace = (function () {
  let es = null;
  let bound = false;

  const $ = (id) => document.getElementById(id);

  function setConnected(ok) {
    const dot = $('relay-trace-dot');
    const st = $('relay-trace-state');
    if (dot) dot.style.background = ok ? '#39ff14' : '#ff2d55';
    if (st) st.textContent = ok ? 'live' : 'disconnected';
  }

  function appendLine(text) {
    const out = $('relay-trace-output');
    if (!out) return;
    const line = document.createElement('div');
    line.className = 'term-line relay-line';
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  function openStream() {
    if (typeof EventSource === 'undefined') return;
    if (es) { try { es.close(); } catch (e) {} es = null; }
    es = new EventSource('/stream');
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      if (e.data && e.data.indexOf('⟳') === 0) {
        appendLine(e.data.replace(/^⟳\s*/, ''));
      }
    };
    es.onerror = () => {
      setConnected(false);
      appendLine('disconnected — retrying in 2s');
      setTimeout(() => { if (!es || es.readyState === EventSource.CLOSED) openStream(); }, 2000);
    };
  }

  function backfill() {
    fetch('/events/recent').then(r => r.json()).then(arr => {
      (arr || []).forEach(m => {
        if (typeof m === 'string' && m.indexOf('⟳') === 0) {
          appendLine(m.replace(/^⟳\s*/, ''));
        }
      });
    }).catch(() => {});
  }

  function bind() {
    const clear = $('relay-trace-clear');
    if (clear) clear.onclick = () => {
      const out = $('relay-trace-output');
      if (out) out.innerHTML = '';
    };
  }

  function mount() {
    if (!bound) { bind(); bound = true; }
    backfill();
    openStream();
  }

  return { mount };
})();
