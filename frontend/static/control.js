/* Command Center — Control Panel (Agent Manager + System Console).
 * Wires the previously-dead terminal: type "run <agent>" (or click a card's
 * Run button) to execute an agent; live output streams in from /stream (SSE).
 * Lessons from Model Arena: lazy mount(), null-safe DOM, real wiring.
 */
window.CCControl = (function () {
  let es = null;        // EventSource (one per session)
  let bound = false;

  const $ = (id) => document.getElementById(id);
  const csrf = () =>
    ((document.querySelector('input[name=csrf_token]') || {}).value) || '';

  function appendLine(text) {
    const out = $('terminal-output');
    if (!out) return;
    const line = document.createElement('div');
    line.className = 'term-line';
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  // /run reads request.form['name'] + ['context'], NOT the 'payload' wrapper
  // the Arena-style postJSON uses — so a dedicated plain-form poster.
  function postForm(url, fields) {
    const fd = new FormData();
    fd.append('csrf_token', csrf());
    Object.keys(fields).forEach(k => fd.append(k, fields[k]));
    return fetch(url, { method: 'POST', body: fd }).then(r => r.json());
  }

  function runAgent(raw) {
    const cmd = (raw || '').trim();
    if (!cmd) return;
    const name = cmd.replace(/^run\s+/i, '').trim();
    if (!name) { appendLine('usage: run <agent-name>'); return; }
    appendLine('> run ' + name);
    postForm('/run', { name: name, context: '{}' })
      .then(d => {
        if (d && d.ok) {
          const r = d.result;
          const s = (typeof r === 'string') ? r : JSON.stringify(r);
          appendLine('result: ' + (s || '(no output)').slice(0, 600));
        } else {
          appendLine('error: ' + ((d && d.error) || 'unknown'));
        }
      })
      .catch(e => appendLine('error: ' + e.message));
  }

  function openStream() {
    if (typeof EventSource === 'undefined') return;
    if (es) { try { es.close(); } catch (e) {} es = null; }
    es = new EventSource('/stream');
    es.onopen = () => { if ($('stream-state')) $('stream-state').textContent = 'live'; };
    es.onmessage = e => { if (e.data) appendLine(e.data); };
    es.onerror = () => {
      appendLine('disconnected — retrying in 2s');
      const st = $('stream-state'); if (st) st.textContent = 'disconnected';
      setTimeout(() => { if (!es || es.readyState === EventSource.CLOSED) openStream(); }, 2000);
    };
  }

  function backfill() {
    fetch('/events/recent').then(r => r.json()).then(arr => {
      (arr || []).forEach(m => appendLine(m));
    }).catch(() => {});
  }

  function bind() {
    const send = $('terminal-send');
    if (send) send.onclick = () => {
      const i = $('terminal-input');
      if (i) { runAgent(i.value); i.value = ''; }
    };
    const inp = $('terminal-input');
    if (inp) inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { runAgent(inp.value); inp.value = ''; }
    });
    document.querySelectorAll('.agent-run').forEach(b => {
      b.onclick = () => runAgent(b.dataset.agent);
    });
  }

  function mount() {
    if (!bound) { bind(); bound = true; }
    const out = $('terminal-output');
    if (out) out.innerHTML = '';
    appendLine('— System Console ready. Type "run <agent>" or hit Run. —');
    backfill();
    openStream();
  }

  return { mount };
})();
