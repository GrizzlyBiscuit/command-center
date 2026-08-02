// Discord Console — shows bot/gateway status and can fire a message.
(function () {
  function log(s) {
    var el = document.getElementById('dc-log'); if (!el) return;
    el.textContent += s + '\n';
    el.scrollTop = el.scrollHeight;
  }
  function setStatus(s) { var el = document.getElementById('dc-status'); if (el) el.textContent = s; }
  window.CCDiscord = {
    onShow: function () {
      var form = document.getElementById('dc-send');
      if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.onsubmit = function (e) {
          e.preventDefault();
          var ch = document.getElementById('dc-channel').value.trim();
          var msg = document.getElementById('dc-msg').value.trim();
          if (!ch || !msg) return;
          log('> send to ' + ch + ': ' + msg);
          fetch('/api/discord/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: ch, message: msg }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { log(d.ok ? '< sent OK' : '< error: ' + (d.error || '?')); })
            .catch(function () { log('< request failed'); });
          document.getElementById('dc-msg').value = '';
        };
      }
      // poll status
      function refresh() {
        fetch('/bot/status').then(function (r) { return r.json(); }).then(function (s) {
          setStatus('bot: ' + (s.relay ? 'running' : 'stopped') + ' · ollama: ' + (s.ollama ? 'up' : 'down'));
        }).catch(function () { setStatus('status: error'); });
      }
      refresh();
      if (!window.__dcTimer) { window.__dcTimer = setInterval(refresh, 5000); }
    },
    onHide: function () {}
  };
})();
