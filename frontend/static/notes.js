// Notes — local markdown scratchpad, auto-saved to localStorage.
(function () {
  var KEY = 'cc_notes';
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function md(src) {
    // tiny markdown: headings, bold, italic, code, lists, line breaks
    return esc(src)
      .replace(/^### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^## (.*)$/gm, '<h3>$1</h3>')
      .replace(/^# (.*)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }
  window.CCNotes = {
    onShow: function () {
      var area = document.getElementById('notes-area');
      var prev = document.getElementById('notes-preview');
      if (!area) return;
      var saved = '';
      try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
      area.value = saved;
      if (prev) prev.innerHTML = md(saved);
      if (!area.dataset.bound) {
        area.dataset.bound = '1';
        area.addEventListener('input', function () {
          try { localStorage.setItem(KEY, area.value); } catch (e) {}
          if (prev) prev.innerHTML = md(area.value);
        });
      }
    }
  };
})();
