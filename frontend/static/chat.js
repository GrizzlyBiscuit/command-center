// Local AI Chat — talks to the user's offline model webhook (via /api/chat).
// Now with a model-profile selector (auto / qwen3:14b / hunyuan / qwen2.5:32b …).
(function () {
  var KEY = 'cc_chat_model';
  function addMsg(role, text) {
    var log = document.getElementById('chat-log'); if (!log) return;
    var d = document.createElement('div');
    d.className = 'chat-msg ' + (role === 'you' ? 'me' : 'ai');
    d.textContent = (role === 'you' ? 'You: ' : 'Local AI: ') + text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function setStatus(s) { var el = document.getElementById('chat-status'); if (el) el.textContent = s; }
  function currentModel() {
    var sel = document.getElementById('chat-model');
    return sel ? sel.value : 'auto';
  }
  function ensureContextConsent(msg) {
    var model = currentModel();
    if (!model || model === 'auto') return Promise.resolve(true);
    return fetch('/api/chat/context?model=' + encodeURIComponent(model))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.reduced) return true;
        var text = 'This model’s default context is ' + d.actual_context + ' tokens, not 65,536. ' +
                   'Use the reduced context window anyway?';
        return new Promise(function (resolve) {
          var ok = confirm(text);
          resolve(!!ok);
        });
      })
      .catch(function () { return true; });
  }
  function loadProfiles() {
    var sel = document.getElementById('chat-model'); if (!sel) return;
    fetch('/api/chat/models').then(function (r) { return r.json(); }).then(function (d) {
      var profiles = (d.profiles || []);
      // keep the "auto" default option, add the rest
      profiles.forEach(function (m) {
        if (m === 'auto') return;
        var o = document.createElement('option');
        o.value = m; o.textContent = m;
        sel.appendChild(o);
      });
      // restore saved choice
      try {
        var saved = localStorage.getItem(KEY);
        if (saved) sel.value = saved;
      } catch (e) {}
      sel.onchange = function () { try { localStorage.setItem(KEY, sel.value); } catch (e) {} };
    }).catch(function () {});
  }
  window.CCChat = {
    onShow: function () {
      loadProfiles();
      var form = document.getElementById('chat-form');
      var input = document.getElementById('chat-input');
      if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.onsubmit = function (e) {
          e.preventDefault();
          var msg = input.value.trim(); if (!msg) return;
          addMsg('you', msg); input.value = '';
          setStatus('thinking…');
          ensureContextConsent(msg).then(function (ok) {
            if (!ok) { setStatus('cancelled'); return; }
            fetch('/api/chat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: msg, model: currentModel() })
            })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.ok) {
                var via = (d.via || 'local') + (d.model && d.model !== 'auto' ? ' / ' + d.model : '');
                addMsg('ai', d.reply); setStatus('endpoint: ' + via);
              } else {
                addMsg('ai', '(no local model reachable — start Ollama or the webhook)');
                setStatus('endpoint: unreachable');
              }
            })
            .catch(function () { addMsg('ai', '(request failed)'); setStatus('endpoint: error'); });
        };
      }
      // probe which endpoint is reachable
      fetch('/api/chat/ping').then(function (r) { return r.json(); }).then(function (s) {
        var v = [];
        if (s.webhook) v.push('webhook');
        if (s.ollama) v.push('ollama');
        setStatus('endpoint: ' + (v.length ? v.join(' + ') : 'none reachable'));
      }).catch(function () {});
    },
    onHide: function () {}
  };
})();
