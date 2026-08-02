/* Command Center — Model Arena
 * Pick two local Ollama models + one prompt; the hub runs both sequentially
 * and returns their answers; you crown a winner and we keep a scoreboard.
 * Uses the shared postJSON() defined in index.html's inline script.
 */
window.CCArena = (function () {
  let last = { a: null, b: null, prompt: '' };

  const $ = (id) => document.getElementById(id);

  function renderRes(side, data) {
    if (!data) return;
    const out = $('arena-out-' + side);
    const meta = $('arena-meta-' + side);
    if (data.error) {
      out.textContent = '⚠ ' + data.error;
      meta.textContent = '';
      return;
    }
    out.textContent = data.text || '(empty)';
    meta.textContent = `${data.toks} tok · ${data.secs}s · ${data.tps} tok/s`;
  }

  function loadModels() {
    fetch('/arena/models').then(r => r.json()).then(d => {
      const models = d.models || [];
      const fus = d.fusions || [];
      const sa = $('arena-a'), sb = $('arena-b');
      sa.innerHTML = ''; sb.innerHTML = '';
      if (!models.length) {
        sa.innerHTML = '<option>(no models found)</option>';
        sb.innerHTML = '<option>(no models found)</option>';
        return;
      }
      models.forEach(m => {
        sa.appendChild(new Option(m, m));
        sb.appendChild(new Option(m, m));
      });
      // append saved fusion pairs so they're selectable in debates
      fus.forEach(f => {
        const label = '⚡ ' + f.name + ' (pair)';
        sa.appendChild(new Option(label, 'fusion:' + f.id));
        sb.appendChild(new Option(label, 'fusion:' + f.id));
      });
      if (models.length > 1) sb.selectedIndex = 1;
      renderScore(d.scores || {});
      // also feed the forge selectors (local models only)
      const fa = $('forge-a'), fb = $('forge-b');
      if (fa && !fa._filled) {
        models.forEach(m => { fa.appendChild(new Option(m, m)); fb.appendChild(new Option(m, m)); });
        if (models.length > 1) fb.selectedIndex = 1;
        fa._filled = true; fb._filled = true;
      }
    }).catch(() => {});
  }

  // --- Fusion forge (top of pairing space) ---
  function forgePair() {
    const name = $('forge-name').value.trim();
    const a = $('forge-a').value, b = $('forge-b').value;
    const status = $('forge-status');
    const confirm = $('forge-confirm');
    if (!name) { status.textContent = 'name your pair first'; $('forge-name').focus(); return; }
    if (!a || !b) { status.textContent = 'pick both local models'; return; }
    status.textContent = '⚡ forging ' + a + ' + ' + b + '…';
    confirm.style.display = 'none';
    fetch('/arena/fusion', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, model_a: a, model_b: b})
    }).then(r => r.json()).then(d => {
      if (!d.ok) { status.textContent = '⚠ ' + (d.error || 'forge failed'); return; }
      const fn = d.fusion.name, fa = d.fusion.model_a, fb = d.fusion.model_b;
      status.textContent = '';
      const cv = $('forge-evo-canvas');
      if (window.CCFusion && window.CCFusion.evolveAnim) {
        window.CCFusion.evolveAnim(fn, cv, () => {
          confirm.textContent = fa + ' and ' + fb + ' have been fused to create ' + fn + '!';
          confirm.style.display = 'block';
          $('forge-name').value = '';
          loadModels();
        });
      } else {
        confirm.textContent = fa + ' and ' + fb + ' have been fused to create ' + fn + '!';
        confirm.style.display = 'block';
        $('forge-name').value = '';
        loadModels();
      }
    }).catch(e => { status.textContent = '⚠ ' + e.message; });
  }

  function renderScore(scores) {
    const el = $('arena-score');
    const rows = Object.entries(scores).sort((a, b) =>
      (b[1].w - b[1].l) - (a[1].w - a[1].l));
    if (!rows.length) { el.innerHTML = '<span class="arena-score-empty">No battles yet — go make them fight.</span>'; return; }
    el.innerHTML = '<table class="arena-table"><tr><th>Model</th><th>W</th><th>L</th><th>D</th></tr>' +
      rows.map(([m, s]) => `<tr><td>${m}</td><td>${s.w}</td><td>${s.l}</td><td>${s.d}</td></tr>`).join('') +
      '</table>';
  }

  async function fight() {
    const a = $('arena-a').value, b = $('arena-b').value;
    const prompt = $('arena-prompt').value.trim();
    const status = $('arena-status');
    if (!a || !b || !prompt) { status.textContent = 'pick both models + a prompt'; return; }
    if (a === b) { status.textContent = 'A and B must differ'; return; }
    // a fusion pair selected on a side -> run the fused pair as that side
    const aFus = a.startsWith('fusion:') ? a.slice(7) : null;
    const bFus = b.startsWith('fusion:') ? b.slice(7) : null;
    if (aFus || bFus) {
      status.textContent = '⚡ running fusion pair(s)…';
      $('arena-out-a').textContent = 'thinking…';
      $('arena-out-b').textContent = 'thinking…';
      $('arena-meta-a').textContent = ''; $('arena-meta-b').textContent = '';
      $('arena-name-a').textContent = aFus ? '⚡ ' + a : a;
      $('arena-name-b').textContent = bFus ? '⚡ ' + b : b;
      try {
        if (aFus) {
          const d = await postJSON('/arena/fusion/run', { id: aFus, prompt });
          if (d.error) { status.textContent = '⚠ ' + d.error; return; }
          renderRes('a', { text: d.result.final, secs: d.result.secs, toks: 0, tps: 0 });
          $('arena-meta-a').textContent = 'fusion · ' + d.result.secs + 's';
        }
        if (bFus) {
          const d = await postJSON('/arena/fusion/run', { id: bFus, prompt });
          if (d.error) { status.textContent = '⚠ ' + d.error; return; }
          renderRes('b', { text: d.result.final, secs: d.result.secs, toks: 0, tps: 0 });
          $('arena-meta-b').textContent = 'fusion · ' + d.result.secs + 's';
        }
        if (!aFus) {  // B is a fusion but A is normal -> run A normally
          const d = await postJSON('/arena/round', { model_a: a, model_b: b, prompt });
          if (d.error) { status.textContent = '⚠ ' + d.error; return; }
          renderRes('a', d.a);
        }
        if (!bFus) {  // A is a fusion but B is normal -> run B normally
          const d = await postJSON('/arena/round', { model_a: a, model_b: b, prompt });
          if (d.error) { status.textContent = '⚠ ' + d.error; return; }
          renderRes('b', d.b);
        }
        last = { a, b, prompt };
        status.textContent = '✓ done — crown a winner';
      } catch (e) {
        status.textContent = '⚠ ' + e.message;
      }
      return;
    }
    status.textContent = '⚔ summoning the combatants…';
    $('arena-out-a').textContent = 'thinking…';
    $('arena-out-b').textContent = 'thinking…';
    $('arena-meta-a').textContent = ''; $('arena-meta-b').textContent = '';
    $('arena-name-a').textContent = a; $('arena-name-b').textContent = b;
    try {
      const d = await postJSON('/arena/round', { model_a: a, model_b: b, prompt });
      if (d.error) { status.textContent = '⚠ ' + d.error; return; }
      renderRes('a', d.a); renderRes('b', d.b);
      last = { a, b, prompt };
      status.textContent = '✓ done — crown a winner';
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
    }
  }

  async function fuse() {
    const a = $('arena-a').value, b = $('arena-b').value;
    const prompt = $('arena-prompt').value.trim();
    const status = $('arena-status');
    if (!a || !b || !prompt) { status.textContent = 'pick both models + a prompt'; return; }
    status.textContent = '⚡ fusing ' + a + ' → ' + b + '…';
    try {
      const d = await postJSON('/arena/pair/run', { model_a: a, model_b: b, prompt });
      if (d.error) { status.textContent = '⚠ ' + d.error; return; }
      const r = d.result;
      $('arena-pair-name').textContent = '(' + d.fusion + ')';
      $('arena-pair-draft').textContent = r.draft || '(empty)';
      $('arena-pair-final').textContent = r.final || '(empty)';
      $('arena-pair-meta').textContent = r.secs + 's';
      $('arena-pair-out').style.display = 'block';
      $('arena-ring').style.display = 'none';
      status.textContent = '✓ pair fused — see combined output below';
    } catch (e) {
      status.textContent = '⚠ ' + e.message;
    }
  }

  function setMode(mode) {
    document.querySelectorAll('.arena-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode));
    const isPair = mode === 'pair';
    $('arena-fight').style.display = isPair ? 'none' : '';
    $('arena-pair').style.display = isPair ? '' : 'none';
    $('arena-ring').style.display = isPair ? 'none' : '';
    $('arena-pair-out').style.display = 'none';
    $('arena-foot').style.display = isPair ? 'none' : '';
    $('arena-mode-note').textContent = isPair
      ? 'A drafts, B finishes — a single fused answer (like the Discord model pair).'
      : 'Each model answers the prompt; you judge the winner.';
  }

  function vote(winner) {
    if (!last.a || !last.b) return;
    postJSON('/arena/vote', { model_a: last.a, model_b: last.b, winner, prompt: last.prompt })
      .then(d => { if (d.scores) renderScore(d.scores); })
      .catch(() => {});
  }

  function bind() {
    $('arena-fight').onclick = fight;
    $('arena-pair').onclick = fuse;
    $('forge-btn').onclick = forgePair;
    $('arena-swap').onclick = () => {
      const sa = $('arena-a'), sb = $('arena-b');
      const t = sa.selectedIndex; sa.selectedIndex = sb.selectedIndex; sb.selectedIndex = t;
    };
    document.querySelectorAll('.arena-mode-btn').forEach(btn => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });
    document.querySelectorAll('.btn-win').forEach(btn => {
      btn.onclick = () => vote(btn.dataset.win);
    });
    $('arena-draw').onclick = () => vote('draw');
    $('arena-clear').onclick = () => renderScore({});
  }

  function mount() {
    if (!window.__arenaBound) {
      bind();
      window.__arenaBound = true;
      loadModels();
    }
  }

  return { mount };
})();
