// Fusion Core — forge named model pairs (the same two-model "pair" the
// Discord relay uses: A drafts, B finishes). Saved pairs appear in every
// model dropdown and can be run through the gauntlet. Forging plays an
// evolve animation (two orbs merge + flash).
window.CCFusion = (function () {
  const $ = (id) => document.getElementById(id);
  let models = [];

  function loadModels(cb) {
    fetch('/arena/models').then(r => r.json()).then(d => {
      models = d.models || [];
      const sels = [$('fusion-a'), $('fusion-b')];
      sels.forEach(s => {
        if (!s) return;
        s.innerHTML = '';
        (models).forEach(m => {
          const o = document.createElement('option');
          o.value = m; o.textContent = m; s.appendChild(o);
        });
      });
      if (cb) cb();
    }).catch(() => {});
  }

  function refreshList() {
    fetch('/arena/fusions').then(r => r.json()).then(d => {
      const list = $('fusion-list');
      if (!list) return;
      const fus = (d.fusions || []);
      if (!fus.length) {
        list.innerHTML = '<p class="muted">No pairs forged yet. Forge one above &mdash; it will appear in your Arena, Maze, and Chat model dropdowns.</p>';
        return;
      }
      list.innerHTML = '';
      fus.forEach(f => {
        const card = document.createElement('div');
        card.className = 'fusion-card';
        card.innerHTML =
          '<div class="fusion-card-h"><span class="fusion-badge">&#9883;</span>' +
          '<span class="fusion-card-name" data-id="' + f.id + '">' + esc(f.name) + '</span></div>' +
          '<div class="fusion-card-pair">' + esc(f.model_a) + ' &#8594; ' + esc(f.model_b) + '</div>' +
          '<div class="fusion-card-actions">' +
          '<button class="btn-secondary fusion-run" data-id="' + f.id + '">Run gauntlet</button>' +
          '<button class="btn-ghost fusion-del" data-id="' + f.id + '">Delete</button>' +
          '</div>';
        list.appendChild(card);
      });
      list.querySelectorAll('.fusion-del').forEach(b => {
        b.onclick = () => delPair(b.getAttribute('data-id'));
      });
      list.querySelectorAll('.fusion-run').forEach(b => {
        b.onclick = () => runPair(b.getAttribute('data-id'));
      });
      list.querySelectorAll('.fusion-card-name').forEach(n => {
        n.ondblclick = () => rename(n);
      });
    }).catch(() => {});
  }

  function rename(span) {
    const id = span.getAttribute('data-id');
    const cur = span.textContent;
    const nv = prompt('Rename pair:', cur);
    if (!nv || !nv.trim() || nv.trim() === cur) return;
    fetch('/arena/fusion/' + id, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: nv.trim()})
    }).then(() => refreshList());
  }

  function delPair(id) {
    if (!confirm('Delete this pair?')) return;
    fetch('/arena/fusion/' + id, {method: 'DELETE'}).then(() => refreshList());
  }

  function runPair(id) {
    const p = prompt('Prompt for the pair:', 'Summarize the risks of running local LLMs on untrusted input.');
    if (!p) return;
    const out = $('fusion-evolve-name');
    out.textContent = 'Running…';
    fetch('/arena/fusion/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: id, prompt: p})
    }).then(r => r.json()).then(d => {
      if (!d.ok) { out.textContent = 'Error: ' + (d.error || '?'); return; }
      alert('FUSION ' + d.fusion + ' FINAL:\n\n' + d.result.final);
    }).catch(e => { out.textContent = 'Error: ' + e; });
  }

  function forge() {
    const name = $('fusion-name').value.trim();
    const a = $('fusion-a').value, b = $('fusion-b').value;
    if (!name) { $('fusion-name').focus(); return; }
    if (!a || !b) return;
    fetch('/arena/fusion', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, model_a: a, model_b: b})
    }).then(r => r.json()).then(d => {
      if (!d.ok) { alert('Forge failed: ' + (d.error || '?')); return; }
      $('fusion-name').value = '';
      evolveAnim(d.fusion.name);   // pokemon-evolve style
      refreshList();
      loadModels();                 // refresh other dropdowns too
    }).catch(e => alert('Forge error: ' + e));
  }

  // --- Pokemon-evolve style animation: two orbs spiral in, merge, flash ---
  // reusable: pass an optional canvas + onDone callback.
  function evolveAnim(name, canvasEl, onDone) {
    const cv = canvasEl || $('fusion-evo-canvas');
    if (!cv) { if (onDone) onDone(); return; }
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, cx = W/2, cy = H/2;
    let t = 0; const dur = 110;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      const prog = t / dur;
      // two orbs spiral toward center
      const ang = prog * Math.PI * 3;
      const dist = (1 - prog) * (W/2 - 30);
      const ax = cx + Math.cos(ang) * dist, ay = cy + Math.sin(ang) * dist;
      const bx = cx + Math.cos(ang + Math.PI) * dist, by = cy + Math.sin(ang + Math.PI) * dist;
      ctx.save();
      const grA = ctx.createRadialGradient(ax, ay, 2, ax, ay, 26);
      grA.addColorStop(0, '#7df9ff'); grA.addColorStop(1, 'rgba(125,249,255,0)');
      ctx.fillStyle = grA; ctx.beginPath(); ctx.arc(ax, ay, 26, 0, 7); ctx.fill();
      const grB = ctx.createRadialGradient(bx, by, 2, bx, by, 26);
      grB.addColorStop(0, '#ff7bff'); grB.addColorStop(1, 'rgba(255,123,255,0)');
      ctx.fillStyle = grB; ctx.beginPath(); ctx.arc(bx, by, 26, 0, 7); ctx.fill();
      ctx.restore();
      if (prog >= 1) {
        // merge flash
        const fl = (Math.sin(t) + 1) / 2;
        const gr = ctx.createRadialGradient(cx, cy, 4, cx, cy, 60);
        gr.addColorStop(0, 'rgba(255,255,255,' + (0.6 + fl*0.4) + ')');
        gr.addColorStop(0.5, 'rgba(255,123,255,0.5)');
        gr.addColorStop(1, 'rgba(125,249,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 60, 0, 7); ctx.fill();
        if (t < dur + 26) { t++; requestAnimationFrame(frame); }
        else { if (onDone) onDone(); }
        return;
      }
      t++; requestAnimationFrame(frame);
    }
    frame();
  }

  function esc(s) {
    return (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function mount() {
    loadModels();
    refreshList();
    const fb = $('fusion-forge');
    if (fb && !fb._wired) { fb._wired = true; fb.onclick = forge; }
  }

  return { mount, refreshList, loadModels, evolveAnim };
})();
