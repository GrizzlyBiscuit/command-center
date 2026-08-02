// Launchpad — pin local apps/commands and open them with one click.
(function () {
  var KEY = 'cc_launchpad';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function render() {
    var grid = document.getElementById('lp-grid'); if (!grid) return;
    var list = load();
    grid.innerHTML = '';
    if (!list.length) {
      grid.innerHTML = '<p class="lp-empty">No apps pinned yet — add one above.</p>';
      return;
    }
    list.forEach(function (item, i) {
      var tile = document.createElement('div');
      tile.className = 'lp-tile';
      tile.innerHTML = '<div class="lp-tile-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="lp-tile-path">' + escapeHtml(item.path || '') + '</div>' +
        '<div class="lp-tile-acts"><button class="lp-open" data-i="' + i + '">Open</button>' +
        '<button class="lp-del" data-i="' + i + '">✕</button></div>';
      grid.appendChild(tile);
    });
    grid.querySelectorAll('.lp-open').forEach(function (b) {
      b.onclick = function () { openApp(load()[parseInt(b.dataset.i, 10)]); };
    });
    grid.querySelectorAll('.lp-del').forEach(function (b) {
      b.onclick = function () {
        var l = load(); l.splice(parseInt(b.dataset.i, 10), 1); save(l); render();
      };
    });
  }
  function openApp(item) {
    if (!item || !item.path) return;
    // try the pywebview bridge first (can spawn processes on the host),
    // fall back to a best-effort shell open.
    var a = window.pywebview && window.pywebview.api;
    if (a && a.open_app) { a.open_app(item.path); return; }
    // fallback: navigate (works for some schemes) — logged only
    fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.path }) }).catch(function () {});
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  window.CCLaunch = {
    onShow: function () {
      render();
      var form = document.getElementById('lp-add');
      if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.onsubmit = function (e) {
          e.preventDefault();
          var name = document.getElementById('lp-name').value.trim();
          var path = document.getElementById('lp-path').value.trim();
          if (!name) return;
          var l = load(); l.push({ name: name, path: path }); save(l); render();
          document.getElementById('lp-name').value = '';
          document.getElementById('lp-path').value = '';
        };
      }
    }
  };
})();
