"""Command Center — Maze engine for the Agent Arena.

Generates a solvable grid maze, then drives one or two local Ollama models
through it TURN-BY-TURN, exactly as if the model were trapped inside:
each step it sees the maze as ASCII + its current cell + the legal moves,
and must reply with ONE direction (up/down/left/right). The harness validates
the move against the walls, advances the agent, and repeats until the exit is
reached or a step cap is hit.

Two render paths in the UI:
  * LIVE  — the hub streams each step over SSE so you watch the agent reason.
  * REPLAY — the hub solves fully, returns the path, and the canvas animates
             it fast (good for slow models / re-watching a race).
"""
import random
import json
import urllib.request
import urllib.error

MAZE_SEED = 1337  # fixed so a "race" pits both models on the SAME maze

# Direction vectors. dy is NEGATIVE-up because row 0 is the top of the grid.
DIRS = {
    "up": (-1, 0),
    "down": (1, 0),
    "left": (0, -1),
    "right": (0, 1),
}


def gen_maze(cols=13, rows=13, seed=MAZE_SEED):
    """Recursive-backtracker maze on a (rows x cols) cell grid.

    Returns a WALL grid: grid[r][c] == 1 means wall, 0 means open.
    Cells are at odd indices; walls between them are carved out. The border
    is always wall. Guaranteed to have a path from (1,1) to (rows-2, cols-2).
    """
    # force odd dimensions
    rows = rows if rows % 2 == 1 else rows + 1
    cols = cols if cols % 2 == 1 else cols + 1
    grid = [[1 for _ in range(cols)] for _ in range(rows)]
    rng = random.Random(seed)
    start = (1, 1)
    grid[1][1] = 0
    stack = [start]
    while stack:
        r, c = stack[-1]
        neigh = []
        for (dr, dc) in ((-2, 0), (2, 0), (0, -2), (0, 2)):
            nr, nc = r + dr, c + dc
            if 0 < nr < rows - 1 and 0 < nc < cols - 1 and grid[nr][nc] == 1:
                neigh.append((nr, nc, dr, dc))
        if neigh:
            nr, nc, dr, dc = rng.choice(neigh)
            grid[r + dr // 2][c + dc // 2] = 0  # knock out wall between
            grid[nr][nc] = 0
            stack.append((nr, nc))
        else:
            stack.pop()
    exit_cell = (rows - 2, cols - 2)
    grid[exit_cell[0]][exit_cell[1]] = 0
    return grid, start, exit_cell


def legal_moves(grid, pos):
    r, c = pos
    out = []
    for name, (dr, dc) in DIRS.items():
        nr, nc = r + dr, c + dc
        if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]) and grid[nr][nc] == 0:
            out.append(name)
    return out


def render(grid, pos, exit_cell, path_so_far=None):
    """ASCII view of the maze with the agent (@) and exit (E)."""
    path_so_far = path_so_far or []
    marked = set(path_so_far)
    lines = []
    for r, row in enumerate(grid):
        chars = []
        for c, v in enumerate(row):
            if (r, c) == pos:
                chars.append("@")
            elif (r, c) == exit_cell:
                chars.append("E")
            elif (r, c) in marked:
                chars.append(".")
            else:
                chars.append("#" if v == 1 else " ")
        lines.append("".join(chars))
    return "\n".join(lines)


def parse_move(text):
    """Pull the first valid direction word out of a model reply."""
    if not text:
        return None
    low = text.lower()
    # order matters: 'left'/'right' before 'down' (substring safety)
    for d in ("up", "down", "left", "right"):
        if d in low:
            return d
    return None


def _ollama_chat(model, prompt, num_ctx=4096, timeout=60):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"num_ctx": num_ctx, "temperature": 0.0, "num_predict": 24},
    }).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.loads(r.read().decode())
        return (resp.get("message", {}).get("content") or "").strip()
    except urllib.error.URLError as e:
        raise RuntimeError("ollama: " + str(e))


def solve(grid, model, start, exit_cell, step_cap=160, seed=MAZE_SEED,
          num_ctx=4096, per_step_timeout=45):
    """Run ONE model through the maze. Returns a step log (list of dicts)."""
    rng = random.Random(seed)
    pos = start
    visited = set([pos])
    visited_list = [pos]
    steps = []
    outcome = "running"
    consec_revisit = 0
    for i in range(step_cap):
        legal = legal_moves(grid, pos)
        if pos == exit_cell:
            outcome = "exit"
            break
        if not legal:
            outcome = "trapped"
            break
        ascii_view = render(grid, pos, exit_cell, list(visited))
        prev = visited_list[-1] if len(visited_list) > 1 else None
        prompt = (
            "You are trapped in a maze. Grid (rows top->bottom, cols left->right):\n"
            "'#' = wall, ' ' = open, '@' = YOU, 'E' = exit, '.' = your trail.\n\n"
            f"{ascii_view}\n\n"
            f"You are at {pos}. Exit is at {exit_cell}. Legal moves: {', '.join(legal)}.\n"
            "STRATEGY: explore NEW open cells ('.' means already visited — avoid them "
            "unless every option is visited). Do NOT immediately reverse your last "
            "move unless it's a dead end. Prefer the move that heads generally toward "
            "the exit's row/column. Pick the single best word.\n"
            "Reply with EXACTLY ONE word — up, down, left, or right. No other text."
        )
        try:
            reply = _ollama_chat(model, prompt, num_ctx=num_ctx,
                                 timeout=per_step_timeout)
        except Exception as e:
            steps.append({"step": i, "pos": pos, "legal": legal,
                          "move": None, "reply": "", "error": str(e)})
            outcome = "error"
            break
        move = parse_move(reply)
        entry = {"step": i, "pos": pos, "legal": legal,
                 "move": move, "reply": reply[:120]}
        if move is None or move not in legal:
            entry["illegal"] = True
            # Give the model a second (and third) chance with a nudge instead
            # of ending the game on one dumb guess.
            nudged = False
            for _ in range(2):
                nudge_prompt = (
                    f"ILLEGAL: '{move}' is not a legal move. From {pos} the only "
                    f"open neighbours are: {', '.join(legal)}. Look at the maze — "
                    f"'#' is wall. Reply with EXACTLY ONE of: {', '.join(legal)}."
                )
                try:
                    reply2 = _ollama_chat(model, nudge_prompt, num_ctx=num_ctx,
                                          timeout=per_step_timeout)
                except Exception:
                    break
                move2 = parse_move(reply2)
                if move2 and move2 in legal:
                    move = move2
                    entry["move"] = move2
                    entry["reply"] = reply2[:120]
                    entry["illegal"] = False
                    entry["nudged"] = True
                    nudged = True
                    break
            if not nudged:
                steps.append(entry)
                outcome = "invalid"
                break
        # detect oscillation (revisiting a cell already on the trail)
        dr, dc = DIRS[move]
        npos = (pos[0] + dr, pos[1] + dc)
        steps.append(entry)
        if npos in visited:
            entry["revisit"] = True
            consec_revisit += 1
        else:
            consec_revisit = 0
        pos = npos
        visited.add(pos)
        visited_list.append(pos)
        if pos == exit_cell:
            outcome = "exit"
            break
        # Loop detection: a 2-cell ping-pong is normal backtracking, but a
        # sustained oscillation (10+ consecutive revisits) or returning to the
        # START cell means the agent is truly stuck — end it so the game isn't
        # an infinite bounce. Otherwise let it explore up to the step cap.
        if pos == start:
            outcome = "looping"
            break
        if consec_revisit >= 10:
            outcome = "looping"
            break
    if outcome == "running":
        outcome = "gaveup"  # hit the step cap without escaping
    return {
        "model": model,
        "steps": steps,
        "outcome": outcome,
        "final_pos": pos,
        "visited_count": len(visited),
    }
