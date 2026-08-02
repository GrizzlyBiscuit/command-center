/* Command Center — Chess (client-side engine + UI)
 * Full rules: castling, en passant, promotion, check/checkmate/stalemate.
 * AI: negamax + alpha-beta, difficulty 1..10. Optional "vs Local Model"
 * routes move selection through /games/ai-move (Ollama), validated locally.
 * Board orientation: array row 0 = rank 8 (top), row 7 = rank 1 (bottom).
 * White at bottom.  Piece codes: 'wP','bK', etc.
 */
(function () {
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  const GLYPH = { wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
                  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟' };
  const PIECE_NAME = { K:'king', Q:'queen', R:'rook', B:'bishop', N:'knight', P:'pawn' };

  function newBoard() {
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    const back = ['R','N','B','Q','K','B','N','R'];
    for (let f = 0; f < 8; f++) {
      b[7][f] = 'w' + back[f];
      b[6][f] = 'wP';
      b[1][f] = 'bP';
      b[0][f] = 'b' + back[f];
    }
    return b;
  }

  let S = null; // game state

  function initState() {
    S = { board: newBoard(), turn: 'w',
          cast: { wk:true, wq:true, bk:true, bq:true },
          ep: null, last: null, over: null };
  }

  const color = p => p ? p[0] : null;
  const opp = c => c === 'w' ? 'b' : 'w';
  const clone = s => JSON.parse(JSON.stringify(s));

  // ---- move generation ----
  function pseudo(s, r, c) {
    const b = s.board, p = b[r][c], out = [];
    if (!p) return out;
    const col = color(p), t = p[1];
    const add = (tr, tc, flags) => {
      if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
        const q = b[tr][tc];
        if (!q || color(q) !== col) out.push({ from:[r,c], to:[tr,tc], flags: flags || [] });
      }
    };
    const slide = dirs => {
      for (const [dr, dc] of dirs) {
        let tr = r + dr, tc = c + dc;
        while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
          const q = b[tr][tc];
          if (!q) out.push({ from:[r,c], to:[tr,tc], flags: [] });
          else { if (color(q) !== col) out.push({ from:[r,c], to:[tr,tc], flags: [] }); break; }
          tr += dr; tc += dc;
        }
      }
    };
    if (t === 'P') {
      const d = col === 'w' ? -1 : 1;
      const start = col === 'w' ? 6 : 1;
      const promoRow = col === 'w' ? 0 : 7;
      if (r + d >= 0 && r + d < 8 && !b[r + d][c]) {
        if (r + d === promoRow) for (const pc of 'QRBN') out.push({ from:[r,c], to:[r+d,c], flags:['promo', pc] });
        else {
          out.push({ from:[r,c], to:[r+d,c], flags: [] });
          if (r === start && !b[r + 2*d][c]) out.push({ from:[r,c], to:[r+2*d,c], flags:['double'] });
        }
      }
      for (const dc of [-1, 1]) {
        const tr = r + d, tc = c + dc;
        if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
          const q = b[tr][tc];
          if (q && color(q) !== col) {
            if (tr === promoRow) for (const pc of 'QRBN') out.push({ from:[r,c], to:[tr,tc], flags:['promo', pc] });
            else out.push({ from:[r,c], to:[tr,tc], flags: [] });
          } else if (s.ep && tr === s.ep[0] && tc === s.ep[1]) {
            out.push({ from:[r,c], to:[tr,tc], flags:['ep'] });
          }
        }
      }
    } else if (t === 'N') {
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr, c+dc);
    } else if (t === 'K') {
      for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (dr||dc) add(r+dr, c+dc);
      // castling
      if (col === 'w' && r === 7 && c === 4) {
        if (s.cast.wk && !b[7][5] && !b[7][6] && b[7][7]==='wR' && !att(s,7,4,'b') && !att(s,7,5,'b') && !att(s,7,6,'b'))
          out.push({ from:[r,c], to:[7,6], flags:['castleK'] });
        if (s.cast.wq && !b[7][1] && !b[7][2] && !b[7][3] && b[7][0]==='wR' && !att(s,7,4,'b') && !att(s,7,3,'b') && !att(s,7,2,'b'))
          out.push({ from:[r,c], to:[7,2], flags:['castleQ'] });
      }
      if (col === 'b' && r === 0 && c === 4) {
        if (s.cast.bk && !b[0][5] && !b[0][6] && b[0][7]==='bR' && !att(s,0,4,'w') && !att(s,0,5,'w') && !att(s,0,6,'w'))
          out.push({ from:[r,c], to:[0,6], flags:['castleK'] });
        if (s.cast.bq && !b[0][1] && !b[0][2] && !b[0][3] && b[0][0]==='bR' && !att(s,0,4,'w') && !att(s,0,3,'w') && !att(s,0,2,'w'))
          out.push({ from:[r,c], to:[0,2], flags:['castleQ'] });
      }
    } else if (t === 'B') slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    else if (t === 'R') slide([[-1,0],[1,0],[0,-1],[0,1]]);
    else if (t === 'Q') slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    return out;
  }

  function att(s, r, c, by) {
    const b = s.board;
    const pr = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      const cc = c + dc;
      if (pr >= 0 && pr < 8 && cc >= 0 && cc < 8 && b[pr][cc] === by + 'P') return true;
    }
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const rr=r+dr, cc=c+dc;
      if (rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr][cc]===by+'N') return true;
    }
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (dr||dc) {
      const rr=r+dr, cc=c+dc;
      if (rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr][cc]===by+'K') return true;
    }
    for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let rr=r+dr, cc=c+dc;
      while (rr>=0&&rr<8&&cc>=0&&cc<8) {
        const q=b[rr][cc];
        if (q){ if(color(q)===by&&(q[1]==='B'||q[1]==='Q')) return true; break; }
        rr+=dr; cc+=dc;
      }
    }
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let rr=r+dr, cc=c+dc;
      while (rr>=0&&rr<8&&cc>=0&&cc<8) {
        const q=b[rr][cc];
        if (q){ if(color(q)===by&&(q[1]==='R'||q[1]==='Q')) return true; break; }
        rr+=dr; cc+=dc;
      }
    }
    return false;
  }

  function kingsq(s, col) {
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (s.board[r][c]===col+'K') return [r,c];
    return null;
  }
  function incheck(s, col) { const k = kingsq(s, col); return k && att(s, k[0], k[1], opp(col)); }

  function apply(s, m) {
    const ns = clone(s), b = ns.board;
    const [fr, fc] = m.from, [tr, tc] = m.to, p = b[fr][fc];
    b[tr][tc] = p; b[fr][fc] = null;
    const col = color(p);
    if (m.flags.includes('ep')) b[fr][tc] = null;
    if (m.flags.includes('promo')) b[tr][tc] = col + m.flags[1];
    if (m.flags.includes('castleK')) { if (col==='w'){b[7][5]=b[7][7];b[7][7]=null;} else {b[0][5]=b[0][7];b[0][7]=null;} }
    if (m.flags.includes('castleQ')) { if (col==='w'){b[7][3]=b[7][0];b[7][0]=null;} else {b[0][3]=b[0][0];b[0][0]=null;} }
    if (p==='wK'){ns.cast.wk=ns.cast.wq=false;}
    if (p==='bK'){ns.cast.bk=ns.cast.bq=false;}
    if (fr===7&&fc===7) ns.cast.wk=false;
    if (fr===7&&fc===0) ns.cast.wq=false;
    if (fr===0&&fc===7) ns.cast.bk=false;
    if (fr===0&&fc===0) ns.cast.bq=false;
    ns.ep = null;
    if (m.flags.includes('double')) { const d = col==='w'?-1:1; ns.ep=[fr+d, tc]; }
    ns.turn = opp(col);
    ns.last = { from: m.from, to: m.to, flags: m.flags };
    return ns;
  }

  function legal(s) {
    const out = [], col = s.turn;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      const p = s.board[r][c];
      if (p && color(p) === col) for (const m of pseudo(s, r, c)) {
        const ns = apply(s, m);
        if (!incheck(ns, col)) out.push(m);
      }
    }
    return out;
  }

  // ---- AI ----
  function evaluate(s) {
    let sc = 0;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      const p = s.board[r][c];
      if (p) sc += (color(p)==='w' ? VAL[p[1]] : -VAL[p[1]]);
    }
    return sc;
  }
  function negamax(s, depth, alpha, beta, level) {
    const moves = legal(s);
    if (!moves.length) return incheck(s, s.turn) ? -100000 - depth : 0;
    if (depth === 0) {
      let e = evaluate(s);
      if (level < 10) e += (Math.floor(Math.random() * ((10 - level) * 6 + 1))) * (s.turn === 'w' ? 1 : -1);
      return s.turn === 'w' ? e : -e;
    }
    moves.sort((a, b) => (s.board[b.to[0]][b.to[1]] ? 1 : 0) - (s.board[a.to[0]][a.to[1]] ? 1 : 0));
    let best = -1e9;
    for (const m of moves) {
      const sc = -negamax(apply(s, m), depth - 1, -beta, -alpha, level);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function bestMove(s, level) {
    const moves = legal(s);
    if (!moves.length) return null;
    if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];
    const depth = Math.min(4, Math.max(1, Math.round(level / 2.5)));
    if (level <= 5 && Math.random() < (6 - level) / 12) return moves[Math.floor(Math.random() * moves.length)];
    for (let i = moves.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [moves[i],moves[j]]=[moves[j],moves[i]]; }
    let best = null, bs = -1e9;
    for (const m of moves) {
      const sc = -negamax(apply(s, m), depth - 1, -1e9, 1e9, level);
      if (sc > bs) { bs = sc; best = m; }
    }
    return best;
  }

  // ---- helpers ----
  const sqName = ([r,c]) => 'abcdefgh'[c] + (8 - r);
  const eq = (a, b) => a[0]===b[0] && a[1]===b[1];

  // ---- UI ----
  let sel = null, legalForSel = [], flipped = false, thinking = false;
  let cursor = [7, 0];
  let vsModel = false;

  function el(id) { return document.getElementById(id); }

  function render() {
    const boardEl = el('cc-board');
    if (!boardEl) return;
    const restoreFocus = boardEl.contains(document.activeElement);
    boardEl.innerHTML = '';
    const rows = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
    const cols = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
    for (const r of rows) {
      for (const c of cols) {
        const sq = document.createElement('button');
        sq.type = 'button';
        sq.setAttribute('role', 'gridcell');
        sq.className = 'cc-sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.r = r; sq.dataset.c = c;
        sq.dataset.spatialKey = 'chess-' + r + '-' + c;
        sq.tabIndex = eq(cursor, [r, c]) ? 0 : -1;
        if (S.last && (eq(S.last.from,[r,c]) || eq(S.last.to,[r,c]))) sq.classList.add('lastmove');
        if (sel && eq(sel,[r,c])) sq.classList.add('sel');
        const isTarget = legalForSel.some(m => eq(m.to, [r,c]));
        if (isTarget) sq.classList.add(S.board[r][c] ? 'cap' : 'move');
        const p = S.board[r][c];
        const state = p ? (color(p) === 'w' ? 'white ' : 'black ') + PIECE_NAME[p[1]] : 'empty';
        const targetState = isTarget ? (p ? ', available capture' : ', available move') : '';
        sq.setAttribute('aria-label', sqName([r, c]) + ', ' + state + targetState);
        sq.setAttribute('aria-selected', sel && eq(sel, [r, c]) ? 'true' : 'false');
        if (p) { const g = document.createElement('span'); g.className='cc-pc '+(color(p)==='w'?'w':'b'); g.textContent = GLYPH[p]; sq.appendChild(g); }
        // coord labels on edge squares
        if ((flipped ? c===7 : c===0)) { const l=document.createElement('span'); l.className='cc-rank'; l.textContent=8-r; sq.appendChild(l); }
        if ((flipped ? r===0 : r===7)) { const l=document.createElement('span'); l.className='cc-file'; l.textContent='abcdefgh'[c]; sq.appendChild(l); }
        sq.onclick = () => onSquare(r, c);
        sq.onfocus = () => {
          cursor = [r, c];
          boardEl.querySelectorAll('.cc-sq').forEach(node => { node.tabIndex = node === sq ? 0 : -1; });
        };
        boardEl.appendChild(sq);
      }
    }
    updateStatus();
    if (restoreFocus) {
      const active = boardEl.querySelector('[data-r="' + cursor[0] + '"][data-c="' + cursor[1] + '"]');
      if (active) { try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); } }
    }
  }

  function updateStatus() {
    const st = el('cc-status');
    if (!st) return;
    if (S.over) { st.textContent = S.over; st.className = 'cc-status over'; return; }
    const chk = incheck(S, S.turn) ? ' — CHECK!' : '';
    st.textContent = (S.turn === 'w' ? 'White' : 'Black') + ' to move' + chk + (thinking ? ' · thinking…' : '');
    st.className = 'cc-status' + (chk ? ' check' : '');
  }

  function onSquare(r, c) {
    if (thinking || S.over) return;
    cursor = [r, c];
    const p = S.board[r][c];
    if (sel) {
      const moves = legalForSel.filter(m => eq(m.to, [r, c]));
      if (moves.length) { doMove(pickPromo(moves)); return; }
      if (p && color(p) === S.turn) { sel = [r, c]; legalForSel = legal(S).filter(m => eq(m.from, [r, c])); render(); return; }
      sel = null; legalForSel = []; render(); return;
    }
    if (p && color(p) === S.turn) { sel = [r, c]; legalForSel = legal(S).filter(m => eq(m.from, [r, c])); render(); }
  }

  function pickPromo(moves) {
    if (moves.length === 1) return moves[0];
    // promotion — default queen (could add a chooser later)
    const q = moves.find(m => m.flags[1] === 'Q');
    return q || moves[0];
  }

  function checkEnd() {
    const moves = legal(S);
    if (!moves.length) {
      S.over = incheck(S, S.turn)
        ? 'Checkmate — ' + (S.turn === 'w' ? 'Black' : 'White') + ' wins!'
        : 'Stalemate — draw.';
      return true;
    }
    return false;
  }

  function doMove(m) {
    S = apply(S, m);
    sel = null; legalForSel = [];
    render();
    if (checkEnd()) { render(); return; }
    // AI reply (AI plays Black)
    if (S.turn === 'b') aiReply();
  }

  async function aiReply() {
    thinking = true; updateStatus();
    await new Promise(res => setTimeout(res, 150));
    let move = null;
    if (vsModel) move = await modelMove();
    if (!move) move = bestMove(S, parseInt(el('cc-level').value, 10));
    thinking = false;
    if (move) { S = apply(S, move); render(); checkEnd(); render(); }
    else updateStatus();
  }

  async function modelMove() {
    // Ask the local model pair to pick from the legal moves; validate locally.
    try {
      const moves = legal(S).map(m => sqName(m.from) + sqName(m.to) + (m.flags[1] || ''));
      const r = await fetch('/games/ai-move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: boardText(), legal: moves, turn: S.turn })
      });
      const d = await r.json();
      if (d && d.move) {
        const cand = legal(S).find(m => (sqName(m.from)+sqName(m.to)+(m.flags[1]||'')) === d.move);
        if (cand) return cand;
      }
    } catch (e) {}
    return null; // fall back to local engine
  }

  function boardText() {
    let out = '';
    for (let r=0;r<8;r++){ let row='';
      for (let c=0;c<8;c++){ const p=S.board[r][c]; row += p ? (color(p)==='w'?p[1]:p[1].toLowerCase()) : '.'; }
      out += (8-r)+' '+row+'\n';
    }
    return out + '  abcdefgh';
  }

  function newGame() { initState(); sel=null; legalForSel=[]; thinking=false; cursor=[7,0]; render(); }

  window.CCChess = {
    cancelSelection() {
      if (!sel) return false;
      sel = null; legalForSel = []; render();
      const square = el('cc-board') && el('cc-board').querySelector('[data-r="' + cursor[0] + '"][data-c="' + cursor[1] + '"]');
      if (square) { try { square.focus({ preventScroll: true }); } catch (e) { square.focus(); } }
      return true;
    },
    mount() {
      if (!S) initState();
      render();
      const nb = el('cc-new'); if (nb) nb.onclick = newGame;
      const fb = el('cc-flip'); if (fb) fb.onclick = () => { flipped = !flipped; render(); };
      const lv = el('cc-level'); const lvOut = el('cc-level-out');
      if (lv && lvOut) { lvOut.textContent = lv.value; lv.oninput = () => lvOut.textContent = lv.value; }
      const vm = el('cc-vsmodel'); if (vm) vm.onchange = e => { vsModel = e.target.checked; };
    }
  };
})();
