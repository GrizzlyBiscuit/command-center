/* Command Center — System Monitor
 * Toggle-gated polling of /sys/stats. The GPU counter sweep is only run while
 * the monitor is ON (flip the switch). Draws synthwave gauges + a CPU sparkline.
 * Written to be null-safe: every DOM access is guarded so a missing element
 * can never throw and blank the whole panel ("shows nothing" bug).
 */
(function () {
  let on = false, timer = null, cpuHist = [];

  function el(id) { return typeof id === 'string' ? document.getElementById(id) : (id || null); }
  function setText(id, txt) { const e = el(id); if (e) e.textContent = txt; }
  function setClass(id, cls) { const e = el(id); if (e) e.className = cls; }
  function show(id, disp) { const e = el(id); if (e) e.style.display = disp; }

  function setBar(bar, pct) {
    if (!bar) return;
    const node = (typeof bar === 'string') ? document.getElementById(bar) : bar;
    if (!node) return;
    const v = Math.max(0, Math.min(100, pct || 0));
    node.style.width = v + '%';
    node.style.background = v > 85
      ? 'linear-gradient(90deg,#ff2d95,#ff6b3d)'
      : v > 60
        ? 'linear-gradient(90deg,#ffd23f,#ff2d95)'
        : 'linear-gradient(90deg,#35c4ff,#7a5cff)';
  }

  function drawSpark(canvas, hist) {
    if (!canvas) return;
    try {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 240, h = canvas.clientHeight || 36;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(53,196,255,0.15)';
      ctx.beginPath(); ctx.moveTo(0, h - 1); ctx.lineTo(w, h - 1); ctx.stroke();
      if (hist.length < 2) return;
      ctx.beginPath();
      hist.forEach((v, i) => {
        const x = (i / (hist.length - 1)) * w;
        const y = h - (v / 100) * (h - 4) - 2;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#35c4ff'); grad.addColorStop(1, '#ff2d95');
      ctx.strokeStyle = grad; ctx.lineWidth = 2;
      ctx.shadowColor = '#35c4ff'; ctx.shadowBlur = 6;
      ctx.stroke();
    } catch (e) { /* canvas unavailable — skip sparkline */ }
  }

  function render(d) {
    if (!d) return;
    cpuHist.push(d.cpu);
    if (cpuHist.length > 60) cpuHist.shift();
    setText('sys-cpu-val', d.cpu + '%');
    setBar('sys-cpu-bar', d.cpu);
    drawSpark(el('sys-cpu-spark'), cpuHist);
    if (d.cpu_per_core && d.cpu_per_core.length)
      setText('sys-cpu-cores', d.cpu_per_core.map((c, i) => 'c' + i + ':' + c + '%').join('  '));

    setText('sys-ram-val', d.ram_pct + '%');
    setBar('sys-ram-bar', d.ram_pct);
    setText('sys-ram-sub', d.ram_used_gb + ' / ' + d.ram_total_gb + ' GB');

    setText('sys-disk-val', d.disk_pct + '%');
    setBar('sys-disk-bar', d.disk_pct);
    setText('sys-disk-sub', d.disk_used_gb + ' / ' + d.disk_total_gb + ' GB');

    setText('sys-net-sub', '↑ ' + d.net_sent_mb + ' MB   ↓ ' + d.net_recv_mb + ' MB');

    const o = el('sys-ollama');
    if (o) { o.textContent = 'Ollama: ' + (d.ollama ? 'up' : 'down'); o.className = 'sys-ollama ' + (d.ollama ? 'on' : 'off'); }

    const wrap = el('sys-gpus');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!d.gpus || !d.gpus.length) {
      wrap.innerHTML = '<div class="sys-gpu-card"><div class="sys-sub">GPU counters unavailable on this machine</div></div>';
      return;
    }
    d.gpus.forEach(g => {
      const dedPct = g.ded_total_mb ? Math.round((g.ded_used_mb / g.ded_total_mb) * 100) : 0;
      const shuPct = g.shu_total_mb ? Math.round((g.shu_used_mb / g.shu_total_mb) * 100) : 0;
      const card = document.createElement('div');
      card.className = 'sys-gpu-card';
      card.innerHTML =
        '<div class="sys-card-title">' + (g.name || 'GPU') + ' <span>' + g.util + '%</span></div>' +
        '<div class="sys-sub">Dedicated (physical): ' + g.ded_used_mb + ' / ' + g.ded_total_mb + ' MB</div>' +
        '<div class="sys-bar"><div class="sys-bar-fill"></div></div>' +
        '<div class="sys-sub">Shared (system RAM): ' + g.shu_used_mb + ' / ' + g.shu_total_mb + ' MB</div>' +
        '<div class="sys-bar"><div class="sys-bar-fill"></div></div>';
      wrap.appendChild(card);
      const bars = card.querySelectorAll('.sys-bar-fill');
      setBar(bars[0], dedPct);
      setBar(bars[1], shuPct);
    });
  }

  async function tick() {
    if (!on) return;
    try {
      const r = await fetch('/sys/stats');
      const d = await r.json();
      render(d);
    } catch (e) { /* network/counter hiccup — keep polling, don't blank the panel */ }
  }

  function start() {
    on = true;
    setText('sys-state', 'ON');
    setClass('sys-state', 'power-label on');
    show('sys-body', '');
    show('sys-off-note', 'none');
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1500);
  }
  function stop() {
    on = false;
    setText('sys-state', 'OFF');
    setClass('sys-state', 'power-label');
    show('sys-body', 'none');
    show('sys-off-note', '');
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.CCSys = {
    mount() {
      const t = el('sys-toggle');
      if (t) t.onchange = e => (e.target.checked ? start() : stop());
    },
    onShow() { if (window.CCSys) window.CCSys.mount(); }
  };
})();
