// Webhook Catcher — live view of POSTs to /api/incoming (local only).
(function () {
  var logEl, countEl, timer = null;
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function render(events) {
    if (!logEl) return;
    if (!events.length) {
      logEl.innerHTML = '<div class="wh-empty">No events yet. POST to <code>/api/incoming?source=NAME</code> (or hit "Send test event").</div>';
      if (countEl) countEl.textContent = '0 events';
      return;
    }
    // newest first
    var html = '';
    for (var i = events.length - 1; i >= 0; i--) {
      var e = events[i];
      var body = (e.body || '').slice(0, 600);
      html += '<div class="wh-ev"><span class="wh-ts">' + esc(e.ts) + '</span>'
            + ' <span class="wh-src">' + esc(e.source) + '</span>'
            + ' <span class="wh-ip">' + esc(e.ip) + '</span>'
            + '<pre class="wh-body">' + esc(body) + '</pre></div>';
    }
    logEl.innerHTML = html;
    if (countEl) countEl.textContent = events.length + ' events';
  }
  function poll() {
    // always fetch the full recent buffer (server caps at 200) — the live
    // view is a persistent tail, not just "events newer than last tick".
    fetch('/api/incoming')
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d.events || []); })
      .catch(function () {});
  }
  window.CCWebhooks = {
    onShow: function () {
      logEl = document.getElementById('wh-log');
      countEl = document.getElementById('wh-count');
      poll();
      if (timer) clearInterval(timer);
      timer = setInterval(poll, 1500);
      var clear = document.getElementById('wh-clear');
      if (clear) clear.onclick = function () {
        // wipe the server-side buffer too, then the view stays empty
        // until a brand-new event arrives.
        fetch('/api/incoming', { method: 'DELETE' })
          .then(function () { render([]); })
          .catch(function () { render([]); });
      };
      var test = document.getElementById('wh-test');
      if (test) test.onclick = function () {
        fetch('/api/incoming?source=selftest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hello: 'world', ts: Date.now() })
        }).then(poll).catch(function () {});
      };
    },
    onHide: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
})();
