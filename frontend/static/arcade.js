// Arcade — Synthwave Snake + 2048. Arrow keys or WASD. Self-contained.
(function () {
  var stage, scoreEl, raf = null, game = 'snake', snake = null, board = null;
  var score = 0;
  var inputCaptured = false;

  function captureInput() {
    if (game === 'chess' || !stage) return false;
    inputCaptured = true;
    stage.dataset.inputCaptured = 'true';
    stage.setAttribute('aria-label', 'Arcade game controls active. Press Escape or controller B to leave.');
    try { stage.focus({ preventScroll: true }); } catch (e) { try { stage.focus(); } catch (_) {} }
    return true;
  }

  function releaseInput() {
    inputCaptured = false;
    if (stage) {
      delete stage.dataset.inputCaptured;
      stage.setAttribute('aria-label', 'Arcade game area. Press Enter or controller A to play.');
    }
    return true;
  }

  // ---------- SNAKE ----------
  function snakeStart() {
    var size = 20, cell = 18, n = size;
    stage.innerHTML = '';
    var c = document.createElement('canvas');
    c.width = c.height = n * cell;
    c.className = 'arc-canvas';
    stage.appendChild(c);
    var ctx = c.getContext('2d');
    snake = { c: c, ctx: ctx, n: n, cell: cell, body: [], dir: { x: 1, y: 0 }, food: null, dead: false };
    snake.body = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    placeFood();
    score = 0; updateScore();
    loop();
  }
  function placeFood() {
    var free = [];
    for (var y = 0; y < snake.n; y++) for (var x = 0; x < snake.n; x++) {
      if (!snake.body.some(function (b) { return b.x === x && b.y === y; })) free.push({ x: x, y: y });
    }
    snake.food = free[Math.floor(Math.random() * free.length)] || { x: 0, y: 0 };
  }
  function loop() {
    if (game !== 'snake') return;
    raf = setTimeout(function () {
      if (!snake || snake.dead) return;
      var head = { x: snake.body[0].x + snake.dir.x, y: snake.body[0].y + snake.dir.y };
      if (head.x < 0 || head.y < 0 || head.x >= snake.n || head.y >= snake.n ||
          snake.body.some(function (b) { return b.x === head.x && b.y === head.y; })) {
        snake.dead = true; drawSnake(); return;
      }
      snake.body.unshift(head);
      if (snake.food && head.x === snake.food.x && head.y === snake.food.y) {
        score += 10; updateScore(); placeFood();
      } else snake.body.pop();
      drawSnake();
      loop();
    }, 110);
  }
  function drawSnake() {
    var ctx = snake.ctx, n = snake.n, c = snake.cell;
    ctx.clearRect(0, 0, n * c, n * c);
    ctx.fillStyle = 'rgba(20,4,40,0.6)'; ctx.fillRect(0, 0, n * c, n * c);
    // grid
    ctx.strokeStyle = 'rgba(185,87,255,0.12)';
    for (var i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * c, 0); ctx.lineTo(i * c, n * c); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * c); ctx.lineTo(n * c, i * c); ctx.stroke(); }
    if (snake.food) {
      ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ff8a3c'; ctx.shadowBlur = 12;
      ctx.fillRect(snake.food.x * c + 3, snake.food.y * c + 3, c - 6, c - 6);
      ctx.shadowBlur = 0;
    }
    for (var k = 0; k < snake.body.length; k++) {
      var b = snake.body[k];
      var grad = ctx.createLinearGradient(b.x * c, b.y * c, b.x * c + c, b.y * c + c);
      grad.addColorStop(0, '#ff2d95'); grad.addColorStop(1, '#35c4ff');
      ctx.fillStyle = grad; ctx.shadowColor = '#ff2d95'; ctx.shadowBlur = 8;
      ctx.fillRect(b.x * c + 1, b.y * c + 1, c - 2, c - 2);
    }
    ctx.shadowBlur = 0;
    if (snake.dead) {
      ctx.fillStyle = 'rgba(255,45,85,0.85)'; ctx.font = 'bold 28px Orbitron, monospace';
      ctx.textAlign = 'center'; ctx.fillText('GAME OVER', n * c / 2, n * c / 2);
    }
  }

  // ---------- 2048 ----------
  function t2048Start() {
    stage.innerHTML = '';
    var grid = document.createElement('div'); grid.className = 't2048';
    stage.appendChild(grid);
    board = { el: grid, cells: [], state: null };
    board.state = Array.from({ length: 4 }, function () { return [0, 0, 0, 0]; });
    addTile(); addTile();
    draw2048();
  }
  function addTile() {
    var empt = [];
    board.state.forEach(function (row, y) { row.forEach(function (v, x) { if (!v) empt.push([x, y]); }); });
    if (!empt.length) return;
    var p = empt[Math.floor(Math.random() * empt.length)];
    board.state[p[1]][p[0]] = Math.random() < 0.9 ? 2 : 4;
  }
  function draw2048() {
    board.el.innerHTML = '';
    board.state.forEach(function (row, y) {
      row.forEach(function (v, x) {
        var d = document.createElement('div');
        d.className = 't2048-cell' + (v ? ' v' + (v <= 2048 ? v : 'big') : '');
        d.textContent = v ? v : '';
        board.el.appendChild(d);
      });
    });
  }
  function slide(row) {
    var arr = row.filter(Boolean), moved = false;
    for (var i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) { arr[i] *= 2; score += arr[i]; arr.splice(i + 1, 1); moved = true; }
    }
    while (arr.length < 4) arr.push(0);
    for (var j = 0; j < 4; j++) if (row[j] !== arr[j]) moved = true;
    return { row: arr, moved: moved };
  }
  function move2048(dx, dy) {
    if (!board) return;
    var s = board.state, moved = false;
    function rot() { s = s[0].map(function (_, i) { return s.map(function (r) { return r[i]; }).reverse(); }); }
    var turns = dy === -1 ? 0 : dy === 1 ? 2 : dx === 1 ? 1 : 3;
    for (var t = 0; t < turns; t++) rot();
    for (var y = 0; y < 4; y++) { var r = slide(s[y]); s[y] = r.row; if (r.moved) moved = true; }
    for (var t2 = 0; t2 < (4 - turns) % 4; t2++) rot();
    if (moved) { addTile(); draw2048(); updateScore(); }
  }

  function updateScore() { if (scoreEl) scoreEl.textContent = 'Score: ' + score; }

  function handleDirection(direction) {
    if (game === 'snake' && snake && !snake.dead) {
      if (direction === 'up') { if (snake.dir.y === 0) snake.dir = { x: 0, y: -1 }; }
      else if (direction === 'down') { if (snake.dir.y === 0) snake.dir = { x: 0, y: 1 }; }
      else if (direction === 'left') { if (snake.dir.x === 0) snake.dir = { x: -1, y: 0 }; }
      else if (direction === 'right') { if (snake.dir.x === 0) snake.dir = { x: 1, y: 0 }; }
      else return false;
      return true;
    } else if (game === '2048' && board) {
      if (direction === 'up') move2048(0, -1);
      else if (direction === 'down') move2048(0, 1);
      else if (direction === 'left') move2048(-1, 0);
      else if (direction === 'right') move2048(1, 0);
      else return false;
      return true;
    }
    return false;
  }

  function onKey(e) {
    var panel = document.getElementById('tab-arcade');
    if (!panel || panel.hidden || panel.style.display === 'none' || !inputCaptured) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    var key = e.key.toLowerCase();
    var direction = key === 'arrowup' || key === 'w' ? 'up'
      : key === 'arrowdown' || key === 's' ? 'down'
      : key === 'arrowleft' || key === 'a' ? 'left'
      : key === 'arrowright' || key === 'd' ? 'right'
      : null;
    if (direction && handleDirection(direction)) e.preventDefault();
  }

  function showGame(g) {
    game = g;
    var stage = document.getElementById('arc-stage');
    var score = document.getElementById('arc-score');
    var chess = document.getElementById('arc-chess');
    if (g === 'chess') {
      releaseInput();
      if (stage) stage.style.display = 'none';
      if (score) score.style.display = 'none';
      if (chess) chess.style.display = '';
      if (window.CCChess) window.CCChess.mount();
    } else {
      if (chess) chess.style.display = 'none';
      if (stage) stage.style.display = '';
      if (score) score.style.display = '';
      if (g === 'snake') snakeStart(); else t2048Start();
    }
  }

  window.CCArcade = {
    captureInput: captureInput,
    handleDirection: handleDirection,
    isInputCaptured: function () { return inputCaptured; },
    onShow: function () {
      stage = document.getElementById('arc-stage');
      scoreEl = document.getElementById('arc-score');
      if (!stage) return;
      // respect last-selected game (default snake)
      showGame(game || 'snake');
      if (!window.__arcKey) {
        window.__arcKey = 1;
        document.addEventListener('keydown', onKey);
      }
    },
    onHide: function () { releaseInput(); if (raf) { clearTimeout(raf); raf = null; } },
    releaseInput: releaseInput
  };

  // tab switcher inside arcade
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.arc-tab').forEach(function (b) {
      b.onclick = function () {
        releaseInput();
        document.querySelectorAll('.arc-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        if (window.CCArcade && document.getElementById('tab-arcade').style.display !== 'none') {
          showGame(b.dataset.game);
        } else {
          game = b.dataset.game; // remember selection for when arcade is shown
        }
      };
    });
  });
})();
