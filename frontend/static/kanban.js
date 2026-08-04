// Kanban — shared task board between you and the agent.
// Cards live server-side (Desktop\Ai\kanban.jsonl) so BOTH sides
// can add/move them; this UI polls so a card the agent adds appears
// live on your screen. "by" tells who created it.
(function () {
  var COLS = ['backlog', 'wip', 'completed'];
  var LABELS = { backlog: 'Backlog', wip: 'WIP', completed: 'Completed' };
  var POLL_MS = 1500, timer = null, busy = false;
  var WIP_RETRY_DELAY = 4 * 60 * 1000; // 4 minutes without completion = retry
  var wipTriggered = {}; // cardId -> timestamp when /api/wip/run was fired
  var wipRetryTimer = null;

  function colEl(c) { return document.getElementById('kb-' + c); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  function render(cards) {
    var counts = { backlog: 0, wip: 0, completed: 0 };
    COLS.forEach(function (c) { var e = colEl(c); if (e) e.innerHTML = ''; });
    (cards || []).forEach(function (card) {
      var c = (card.column && COLS.indexOf(card.column) >= 0) ? card.column : 'backlog';
      counts[c]++;
      var host = colEl(c); if (!host) return;
      var el = document.createElement('div');
      el.className = 'kb-card by-' + (card.by === 'agent' ? 'agent' : 'you');
      if (card.red) el.className += ' red';
      el.dataset.id = card.id;
      var head = document.createElement('div');
      head.className = 'kb-card-title';
      head.textContent = card.title || '(untitled)';
      el.appendChild(head);
      if (card.desc) {
        var d = document.createElement('div');
        d.className = 'kb-card-desc';
        d.textContent = card.desc;
        el.appendChild(d);
      }
      var meta = document.createElement('div');
      meta.className = 'kb-card-meta';
      meta.textContent = (card.by === 'agent' ? 'agent • ' : 'you • ') + (card.updated || card.created || '');
      el.appendChild(meta);
      // click the card body to auto-advance one column:
      // Backlog -> WIP -> Completed (arrows still allow precise moves)
      el.onclick = function () {
        var order = COLS.indexOf(card.column);
        if (order >= 0 && order < COLS.length - 1) requestMove(card.id, COLS[order + 1], card.title);
      };
      // move buttons (cycle: backlog -> wip -> completed)
      var acts = document.createElement('div');
      acts.className = 'kb-card-acts';
      var order = COLS.indexOf(c);
      if (order > 0) {
        var back = document.createElement('button');
        back.className = 'kb-move'; back.textContent = '◀ ' + LABELS[COLS[order - 1]];
        back.onclick = function (e) { e.stopPropagation(); move(card.id, COLS[order - 1]); };
        acts.appendChild(back);
      }
      if (order < COLS.length - 1) {
        var fwd = document.createElement('button');
        fwd.className = 'kb-move kb-fwd';
        fwd.textContent = LABELS[COLS[order + 1]] + ' ▶';
        fwd.onclick = function (e) { e.stopPropagation(); requestMove(card.id, COLS[order + 1], card.title); };
        acts.appendChild(fwd);
      }
      var del = document.createElement('button');
      del.className = 'kb-del'; del.textContent = '✕';
      del.onclick = function (e) { e.stopPropagation(); delCard(card.id); };
      acts.appendChild(del);
      var edit = document.createElement('button');
      edit.className = 'kb-edit'; edit.textContent = 'Edit';
      edit.onclick = function (e) { e.stopPropagation(); startEdit(card, el); };
      acts.appendChild(edit);
      el.appendChild(acts);
      host.appendChild(el);
    });
    var total = cards ? cards.length : 0;
    var cnt = document.getElementById('kb-count');
    if (cnt) cnt.textContent = total + ' task' + (total === 1 ? '' : 's') +
      '  •  ' + counts.wip + ' active';
  }

  function startEdit(card, el) {
    if (el.dataset.editing === '1') return;
    el.dataset.editing = '1';
    var titleInput = document.createElement('input');
    titleInput.className = 'kb-title-edit';
    titleInput.value = card.title || '';
    titleInput.placeholder = 'Title';
    var descInput = document.createElement('textarea');
    descInput.className = 'kb-desc-edit';
    descInput.value = card.desc || '';
    descInput.placeholder = 'Description';
    var acts = el.querySelector('.kb-card-acts');
    var saveBtn = document.createElement('button');
    saveBtn.className = 'kb-save'; saveBtn.textContent = 'Save';
    saveBtn.onclick = function (e) {
      e.stopPropagation();
      fetch('/api/kanban/' + encodeURIComponent(card.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput.value.trim(), desc: descInput.value.trim() })
      }).then(function (r) { return r.json(); }).then(function () {
        el.dataset.editing = '0';
        load();
      });
    };
    // swap title/desc text for inputs
    var titleEl = el.querySelector('.kb-card-title');
    var descEl = el.querySelector('.kb-card-desc');
    if (titleEl) {
      titleInput.style.marginBottom = descEl ? '6px' : '0';
      titleEl.replaceWith(titleInput);
    }
    if (descEl) descEl.replaceWith(descInput);
    acts.insertBefore(saveBtn, acts.firstChild);
    try { titleInput.focus(); } catch (e) {}
  }

  var lastSig = '';  // signature of last rendered board; skip churn when unchanged
  function load() {
    if (busy) return;
    busy = true;
    fetch('/api/kanban').then(function (r) { return r.json(); })
      .then(function (d) {
        var cards = d.cards || [];
        markWipStuck(cards);
        // cheap signature: id+column+updated — only re-render when it changed
        var sig = cards.map(function (c) { return c.id + ':' + c.column + ':' + (c.updated || ''); }).join('|');
        if (sig === lastSig) return;   // board unchanged -> don't touch the DOM
        lastSig = sig;
        render(cards);
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }

  function add(title, desc) {
    return fetch('/api/kanban', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, desc: desc || '', by: 'you' })
    }).then(function (r) { return r.json(); });
  }
  // Intercept moves INTO WIP: ask for confirmation via the caution
  // modal. If confirmed, perform the move + tell the backend to start the
  // agent on that task. Other moves (backlog<->completed, etc.) happen immediately.
  function requestMove(id, col, title) {
    if (col !== 'wip') { return move(id, col); }
    return showWipCaution(title || '(task)', function (yes) {
      if (!yes) return;                 // No -> stay put, do nothing
      move(id, 'wip').then(function () {
        // Yes -> persist the intent + fire the agent job
        fetch('/api/wip/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, title: title || '' })
        }).catch(function () {});
        wipTriggered[id] = Date.now();
        fetch('/api/wip/run', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && j.nudge) flashWip(j.nudge);
          })
          .catch(function () {});
      });
    });
  }

  function move(id, col) {
    return fetch('/api/kanban/' + encodeURIComponent(id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column: col })
    }).then(load);
  }

  // ---- WIP caution modal ----
  function showWipCaution(title, cb) {
    var ov = document.getElementById('kb-wip-caution');
    var opener = document.activeElement;
    var msg = document.getElementById('kb-wip-msg');
    if (!ov) { cb(true); return; }       // no modal in DOM -> just proceed
    if (msg) msg.textContent = title;
    ov.style.display = 'flex';
    var yes = document.getElementById('kb-wip-yes');
    var no = document.getElementById('kb-wip-no');
    function cleanup() {
      ov.style.display = 'none';
      yes.onclick = null; no.onclick = null;
      if (opener && opener.isConnected && opener.focus) { try { opener.focus(); } catch (e) {} }
    }
    if (no) { try { no.focus(); } catch (e) {} }
    yes.onclick = function () { cleanup(); cb(true); };
    no.onclick = function () { cleanup(); cb(false); };
  }
  function flashWip(text) {
    var el = document.getElementById('kb-wip-flash');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 6000);
  }
  function markWipStuck(cards) {
    var now = Date.now();
    var changed = false;
    (cards || []).forEach(function (c) {
      if (c.column !== 'wip' || !c.id) return;
      var host = colEl('wip');
      if (!host) return;
      var el = host.querySelector('[data-id="' + c.id.replace(/"/g, '\\"') + '"]');
      if (!el) return;
      var triggered = wipTriggered[c.id];
      var age = triggered ? (now - triggered) : 0;
      if (!triggered) {
        wipTriggered[c.id] = now;
        changed = true;
        return;
      }
      if (age >= WIP_RETRY_DELAY && !el.classList.contains('wip-stuck')) {
        el.classList.add('wip-stuck');
        var acts = el.querySelector('.kb-card-acts');
        if (acts && !document.getElementById('wip-retry-' + c.id)) {
          var btn = document.createElement('button');
          btn.className = 'kb-move kb-retry';
          btn.textContent = 'Retry agent';
          btn.id = 'wip-retry-' + c.id;
          btn.onclick = function (e) { e.stopPropagation(); retryWip(c.id); };
          acts.appendChild(btn);
        }
      }
    });
    if (changed || Object.keys(wipTriggered).length) {
      scheduleWipRetryScan();
    }
  }
  function retryWip(id) {
    var card = findCard(id);
    if (!card || card.column !== 'wip') return;
    wipTriggered[id] = Date.now();
    fetch('/api/wip/run', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.nudge) flashWip(j.nudge);
        else flashWip('Retrying agent for: ' + (card.title || id));
      })
      .catch(function () { flashWip('Retry failed for: ' + (card.title || id)); });
  }
  function findCard(id) {
    var cards = [];
    document.querySelectorAll('.kb-card').forEach(function (el) {
      if (el.dataset.id === id) {
        var titleEl = el.querySelector('.kb-card-title');
        var colEl2 = el.closest('.kb-col');
        var col = colEl2 ? colEl2.dataset.col : null;
        cards.push({ id: el.dataset.id, title: titleEl ? titleEl.textContent : '', column: col });
      }
    });
    return cards[0];
  }
  function scheduleWipRetryScan() {
    if (wipRetryTimer) return;
    wipRetryTimer = setTimeout(function () {
      wipRetryTimer = null;
      if (!busy) scanWipAges();
    }, WIP_RETRY_DELAY);
  }
  function scanWipAges() {
    var cards = [];
    document.querySelectorAll('.kb-card').forEach(function (el) {
      var titleEl = el.querySelector('.kb-card-title');
      var colEl2 = el.closest('.kb-col');
      cards.push({ id: el.dataset.id, title: titleEl ? titleEl.textContent : '', column: colEl2 ? colEl2.dataset.col : null, el: el });
    });
    var now = Date.now();
    var needsRetry = false;
    cards.forEach(function (c) {
      if (c.column !== 'wip' || !c.id) return;
      var triggered = wipTriggered[c.id];
      var age = triggered ? (now - triggered) : 0;
      if (age >= WIP_RETRY_DELAY && !c.el.classList.contains('wip-stuck')) {
        c.el.classList.add('wip-stuck');
        var acts = c.el.querySelector('.kb-card-acts');
        if (acts && !document.getElementById('wip-retry-' + c.id)) {
          var btn = document.createElement('button');
          btn.className = 'kb-move kb-retry';
          btn.textContent = 'Retry agent';
          btn.id = 'wip-retry-' + c.id;
          btn.onclick = function (e) { e.stopPropagation(); retryWip(c.id); };
          acts.appendChild(btn);
        }
        needsRetry = true;
      }
    });
    if (needsRetry) scheduleWipRetryScan();
  }
  function delCard(id) {
    return fetch('/api/kanban/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(load);
  }

  // ---- Add-task popover ----
  function openPop() {
    var pop = document.getElementById('kb-pop');
    var t = document.getElementById('kb-title');
    var d = document.getElementById('kb-desc');
    if (pop) { pop._ccOpener = document.activeElement; pop.style.display = 'flex'; }
    if (t) { t.value = ''; try { t.focus(); } catch (e) {} }
    if (d) d.value = '';
  }
  function closePop() {
    var pop = document.getElementById('kb-pop');
    if (pop) {
      pop.style.display = 'none';
      if (pop._ccOpener && pop._ccOpener.isConnected && pop._ccOpener.focus) {
        try { pop._ccOpener.focus(); } catch (e) {}
      }
      pop._ccOpener = null;
    }
  }
  function savePop() {
    var t = document.getElementById('kb-title');
    var d = document.getElementById('kb-desc');
    if (!t) return;
    var title = t.value.trim();
    if (!title) { try { t.focus(); } catch (e) {} return; }
    add(title, d ? d.value.trim() : '').then(function () {
      closePop(); load();
    });
  }

  window.CCKanban = {
    onShow: function () {
      // bind popover controls once
      var add = document.getElementById('kb-add');
      if (add && !add.dataset.b) {
        add.dataset.b = '1';
        add.onclick = openPop;
      }
      var save = document.getElementById('kb-save');
      if (save && !save.dataset.b) {
        save.dataset.b = '1';
        save.onclick = savePop;
      }
      var cancel = document.getElementById('kb-cancel');
      if (cancel && !cancel.dataset.b) {
        cancel.dataset.b = '1';
        cancel.onclick = closePop;
      }
      var pop = document.getElementById('kb-pop');
      if (pop && !pop.dataset.b) {
        pop.dataset.b = '1';
        // click outside the box closes
        pop.addEventListener('click', function (e) {
          if (e.target === pop) closePop();
        });
        // Enter in title = save; Ctrl+Enter in desc = save
        var t = document.getElementById('kb-title');
        if (t) t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); savePop(); } });
        var d = document.getElementById('kb-desc');
        if (d) d.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); savePop(); } });
      }
      load();
      if (timer) clearInterval(timer);
      timer = setInterval(load, POLL_MS);  // live: agent-added cards appear
    },
    onHide: function () { if (timer) { clearInterval(timer); timer = null; } },
    // called by the AGENT side to drop a card in without touching the UI.
    // defaults to 'wip' (WIP) so a task the agent picks up
    // auto-appears in the WIP column.
    addByAgent: function (title, desc, col) {
      return fetch('/api/kanban', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, desc: desc || '', column: col || 'wip', by: 'agent' })
      }).then(function (r) { return r.json(); });
    }
  };
})();
