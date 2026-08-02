/* Command Center — Maze Run
 * Watch local Ollama models solve a maze, turn-by-turn.
 *  - "Run (live)" streams each step over SSE so you see the agent reason.
 *  - "Replay" re-solves fully and animates the path fast.
 * Same maze (fixed seed) for both agents => fair race. Renders on a canvas.
 */
window.CCMaze = (function () {
  const $ = (id) => document.getElementById(id);
  let grid = null, start = null, exit = null, size = 13;
  let agents = {};          // model -> {path:[], color, done, outcome}
  let order = [];           // model names in race order
  let es = null;            // active EventSource
  let raf = null;           // replay animation handle
  const COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24'];

  let fusionMap = {};
  function loadModels() {
    fetch('/arena/models').then(r => r.json()).then(d => {
      const models = d.models || [];
      const fusions = d.fusions || [];
      fusionMap = {};
      fusions.forEach(f => { fusionMap[f.id] = f; });
      const sa = $('maze-a'), sb = $('maze-b');
      if (!models.length) {
        sa.innerHTML = '<option>(no models)</option>';
        sb.innerHTML = '<option>(none)</option>';
        return;
      }
      // Agent A: required (first model)
      sa.innerHTML = '';
      models.forEach(m => sa.appendChild(new Option(m, m)));
      fusions.forEach(f => sa.appendChild(new Option('⚡ ' + f.name + ' (pair)', 'fusion:' + f.id)));
      // Agent B: optional — lead with a (none) choice
      sb.innerHTML = '';
      sb.appendChild(new Option('(none)', ''));
      models.forEach(m => sb.appendChild(new Option(m, m)));
      fusions.forEach(f => sb.appendChild(new Option('⚡ ' + f.name + ' (pair)', 'fusion:' + f.id)));
      sb.value = '';  // default B = none
    }).catch(() => {});
  }

  // resolve a select value to a real model name (expand fusions to their A model)
  function realModel(v) {
    if (v && v.startsWith('fusion:')) {
      const f = fusionMap[v.slice(7)];
      return f ? f.model_a : v;
    }
    return v;
  }

  function cellPx() {
    const cv = $('maze-canvas');
    return Math.floor(Math.min(cv.width, cv.height) / size);
  }

  function drawMaze(highlight) {
    const cv = $('maze-canvas');
    const ctx = cv.getContext('2d');
    const px = cellPx();
    ctx.clearRect(0, 0, cv.width, cv.height);
    // background
    ctx.fillStyle = '#0b0b1a';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        const x = c * px, y = r * px;
        if (grid[r][c] === 1) {
          ctx.fillStyle = '#2a2a4a';
          ctx.fillRect(x, y, px, px);
          ctx.strokeStyle = '#3a3a5a';
          ctx.strokeRect(x + 0.5, y + 0.5, px - 1, px - 1);
        }
      }
    }
    // exit
    const ex = exit[1] * px, ey = exit[0] * px;
    ctx.fillStyle = '#34d399';
    ctx.fillRect(ex, ey, px, px);
    ctx.fillStyle = '#06281c';
    ctx.font = (px * 0.7) + 'px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('E', ex + px / 2, ey + px / 2);
    // start
    const sx = start[1] * px, sy = start[0] * px;
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(sx, sy, px, px);
    // agent trails + heads
    order.forEach((m, idx) => {
      const a = agents[m]; if (!a) return;
      const col = COLORS[idx % COLORS.length];
      // trail
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(2, px * 0.18);
      ctx.beginPath();
      a.path.forEach((p, i) => {
        const X = p[1] * px + px / 2, Y = p[0] * px + px / 2;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      // head
      const head = a.path[a.path.length - 1];
      if (head) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(head[1] * px + px / 2, head[0] * px + px / 2, px * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // highlight current cell of the focused agent (live mode)
    if (highlight) {
      const hx = highlight[1] * px, hy = highlight[0] * px;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, px - 2, px - 2);
    }
  }

  function renderBoard() {
    let html = '';
    order.forEach((m, idx) => {
      const a = agents[m]; if (!a) return;
      const col = COLORS[idx % COLORS.length];
      const last = a.path[a.path.length - 1];
      const oc = a.outcome || (a.path.length ? 'solving…' : 'idle');
      html += `<div class="maze-agent"><span class="maze-dot" style="background:${col}"></span>`
            + `<b>${m}</b> <span class="maze-oc">${oc}</span>`
            + `<span class="maze-step">step ${a.path.length}</span></div>`;
    });
    $('maze-board').innerHTML = html;
  }

  function renderScore() {
    if (!order.length) { $('maze-score').innerHTML = ''; return; }
    let html = '<table class="arena-table"><tr><th>Agent</th><th>Outcome</th><th>Steps</th></tr>';
    order.forEach((m, idx) => {
      const a = agents[m]; if (!a) return;
      const col = COLORS[idx % COLORS.length];
      const oc = a.outcome || 'solving…';
      html += `<tr><td><span class="maze-dot" style="background:${col}"></span>${m}</td>`
            + `<td>${oc}</td><td>${a.path.length}</td></tr>`;
    });
    html += '</table>';
    $('maze-score').innerHTML = html;
  }

  function stopAll() {
    if (es) { es.close(); es = null; }
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  // ---- LIVE mode: SSE step streaming ----
  function runLive() {
    stopAll();
    const aRaw = $('maze-a').value, bRaw = $('maze-b').value;
    const a = realModel(aRaw), b = realModel(bRaw);
    const models = [a]; if (b && b !== a) models.push(b);
    if (!a) { $('maze-status').textContent = 'pick at least Agent A'; return; }
    size = parseInt($('maze-size').value, 10);
    order = models.slice();
    agents = {}; models.forEach(m => agents[m] = { path: [], outcome: null });
    $('maze-status').textContent = '⏳ live — streaming steps…';
    renderBoard(); renderScore();
    const q = '/arena/maze/stream?size=' + size
      + '&model_a=' + encodeURIComponent(models[0])
      + (models[1] ? '&model_b=' + encodeURIComponent(models[1]) : '');
    es = new EventSource(q);
    es.addEventListener('maze', e => {
      const d = JSON.parse(e.data);
      grid = d.grid; start = d.start; exit = d.exit; size = d.size;
      drawMaze();
    });
    es.addEventListener('agent', e => {
      const m = JSON.parse(e.data).model;
      $('maze-status').textContent = '⏳ ' + m + ' is solving…';
    });
    es.addEventListener('step', e => {
      const d = JSON.parse(e.data);
      const ag = agents[d.model]; if (!ag) return;
      if (d.pos) ag.path.push(d.pos);
      drawMaze(d.pos);
      renderBoard();
    });
    es.addEventListener('done', e => {
      const d = JSON.parse(e.data);
      const ag = agents[d.model]; if (ag) { ag.outcome = d.outcome; ag.path.push(d.final_pos); }
      drawMaze(); renderBoard(); renderScore();
    });
    es.addEventListener('finish', e => {
      $('maze-status').textContent = '✓ done' + (winnerText() ? ' — ' + winnerText() : '');
      es.close(); es = null;
    });
    es.addEventListener('error', e => {
      $('maze-status').textContent = '⚠ stream error';
      if (es) { es.close(); es = null; }
    });
  }

  function winnerText() {
    const fin = order.filter(m => agents[m] && agents[m].outcome === 'exit');
    if (fin.length > 1) {
      // fewest steps wins
      fin.sort((x, y) => agents[x].path.length - agents[y].path.length);
      return fin[0] + ' wins (fewer steps)';
    }
    if (fin.length === 1) return fin[0] + ' escaped!';
    return 'nobody escaped';
  }

  // ---- REPLAY mode: full solve, then animate ----
  async function runReplay() {
    stopAll();
    const aRaw = $('maze-a').value, bRaw = $('maze-b').value;
    const a = realModel(aRaw), b = realModel(bRaw);
    const models = [a]; if (b && b !== a) models.push(b);
    if (!a) { $('maze-status').textContent = 'pick at least Agent A'; return; }
    size = parseInt($('maze-size').value, 10);
    $('maze-status').textContent = '⏳ solving (fast)…';
    let data;
    try {
      const r = await postJSON('/arena/maze', {
        model_a: models[0], model_b: models[1] || null, size, cap: 160,
      });
      data = r;
    } catch (err) {
      $('maze-status').textContent = '⚠ ' + err.message; return;
    }
    grid = data.grid; start = data.start; exit = data.exit; size = data.size;
    order = data.results.map(x => x.model);
    agents = {};
    data.results.forEach((res, idx) => {
      // rebuild path from steps (each step has 'pos' = position BEFORE the move)
      const path = res.steps.map(s => s.pos);
      path.push(res.final_pos);
      agents[res.model] = { path, outcome: res.outcome };
    });
    $('maze-status').textContent = '✓ solved — replaying…';
    renderBoard(); renderScore(); drawMaze();
    animateReplay();
  }

  function animateReplay() {
    // advance every agent one cell per tick
    let maxLen = Math.max(...order.map(m => agents[m].path.length));
    let i = 1;
    const px = cellPx();
    function tick() {
      order.forEach(m => {
        const a = agents[m];
        if (a.path.length > i) a._show = i; else a._show = a.path.length;
      });
      // draw with truncated paths
      const cv = $('maze-canvas');
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#0b0b1a'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < grid[0].length; c++) {
          if (grid[r][c] === 1) { ctx.fillStyle = '#2a2a4a'; ctx.fillRect(c*px, r*px, px, px); }
        }
      const ex = exit[1]*px, ey = exit[0]*px;
      ctx.fillStyle = '#34d399'; ctx.fillRect(ex, ey, px, px);
      const sx = start[1]*px, sy = start[0]*px;
      ctx.fillStyle = '#fbbf24'; ctx.fillRect(sx, sy, px, px);
      order.forEach((m, idx) => {
        const a = agents[m]; const col = COLORS[idx % COLORS.length];
        const upto = a.path.slice(0, i + 1);
        ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(2, px*0.18);
        ctx.beginPath();
        upto.forEach((p, k) => { const X=p[1]*px+px/2, Y=p[0]*px+px/2; k?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
        ctx.stroke(); ctx.globalAlpha = 1;
        const head = upto[upto.length-1];
        if (head) { ctx.fillStyle = col; ctx.beginPath();
          ctx.arc(head[1]*px+px/2, head[0]*px+px/2, px*0.32, 0, Math.PI*2); ctx.fill(); }
      });
      i++;
      if (i < maxLen) raf = requestAnimationFrame(tick);
      else { $('maze-status').textContent = '✓ replay done' + (winnerText() ? ' — ' + winnerText() : ''); }
    }
    tick();
  }

  function bind() {
    $('maze-run').onclick = runLive;
    $('maze-replay').onclick = runReplay;
  }

  function mount() {
    if (!window.__mazeBound) { bind(); window.__mazeBound = true; }
    loadModels();
    if (!grid) {
      // draw a placeholder
      $('maze-canvas').getContext('2d').fillStyle = '#0b0b1a';
      $('maze-canvas').getContext('2d').fillRect(0,0,520,520);
      $('maze-board').innerHTML = '<span class="muted">Hit Run to watch an agent solve the maze.</span>';
    }
  }

  return { mount };
})();
