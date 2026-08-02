# Kanban Backlog

- k1: **Chess moved into Arcade tab** [completed] by you
  - Done in-session — chess panel now lives inside Arcade alongside Snake + 2048.

- k2: **Spinning hero glyph removed** [completed] by agent
  - Removed .home-hero-glyph + glyph-spin keyframe. Verified gone.

- k3: **Theme Switcher** [completed] by agent
  - 5 synthwave palettes via CSS vars, persists across restarts.

- k4: **Audio Visualizer** [completed] by agent
  - Neon FFT bars tapping the audio engine analyser.

- k5: **Pomodoro Focus timer** [completed] by agent
  - Charging sun that detonates on completion.

- k6: **Launchpad** [completed] by agent
  - Pin local apps as glowing tiles.

- k7: **Arcade (Snake + 2048)** [completed] by agent
  - Synthwave-styled retro games.

- k8: **Local AI Chat + model profiles** [completed] by agent
  - Talks to localhost:8080 webhook; model dropdown (auto/qwen3/hunyuan/qwen2.5/deepseek).

- k9: **Notes scratchpad** [completed] by agent
  - Local markdown, live preview, auto-saved.

- k10: **Discord Console** [completed] by agent
  - Bot/gateway status + queue a message to a channel.

- k11: **Clock tab** [completed] by agent
  - Live neon clock + 5 timezones.

- k12: **Webhook Catcher** [completed] by agent
  - Local /api/incoming live event view.

- k13: **Kanban shared board** [completed] by agent
  - This board — you + agent add cards, column steers priority.

- k14: **Flicker mitigation — browser re-verify** [completed] by agent
  - The idle-flicker CSS/canvas fix (cached sprite, filter anims removed) was never re-verified in a real browser. Should confirm it actually stopped flickering.

- k15: **Verify hero gradient color in-browser** [completed] by agent
  - COMMAND CENTER gradient text fill added but never visually confirmed.

- k16: **Idle FX background verify** [completed] by agent
  - Confirm idle particle canvas + sun/grid bloom look right and don't flicker on the real pywebview surface.

- k17: **kanban edit (scroll)** [completed] by you
  - give the columns a shorter body and eliminate the scroll of the page itself. Add individual scrolls to each column

- k18: **kanban task edits** [completed] by you
  - Added Edit/Save per card; PUT writes title+desc without touching WIP.

- k19: **Save Camofox browser-verification skill** [completed] by agent
  - npm route to spin up Camofox (Docker daemon was wedged; npm i -g camofox-browser + fetch Camoufox binary + run server on :9377). Lets me visually verify CC web UIs instead of guessing.

- k20: **Wire Discord relay under hub watchdog** [completed] by agent
  - Relay currently launched as a manual background process I spawn; if it crashes nothing revives it. Hook it under the hub _relay_watchdog (bot/start with CSRF, or create the missing discord_relay_launcher.bat) so @Nyx + model pair survive crashes and reconnect.

- k21: **kanban edit** [completed] by you
  - add an edit button to the  tasks

- k22: **dark mode edit** [completed] by you
  - make the letters in "DARK MODE" on the dark mode tab, and the letters on the homepage "COMMAND CENTER" POP in neon blue when dark mode is on. Like they were a neon sign that gets turned on at night.

- k23: **Chess game formatting** [completed] by you
  - The chess game isn't formatted visually, the game board clips into the UI. We need the game board to scale accordingly with what is actually visible without scrolling.

- k24: **General UI issue** [completed] by you
  - Make it so if  anything was going to clip into something else, the thing that would clip just reduces in size to fit the window/sidebar position. do this with every page and all pages going forward.

- k25: **no idle** [completed] by you
  - Get rid of all idle features so it can free up some  processing power. make sure there's nothing in the code about idle process that  is running as a zombie.

- k27: **Hardening** [backlog] by you
  - General app hardening pass: tighten request handling, remove dead paths, and verify error boundaries.

- k28: **Secret hardening** [backlog] by you
  - Audit secrets handling and redaction paths. Ensure no credentials leak into logs, templates, or API responses.

- k29: **Silent exception audit** [backlog] by you
  - Find bare except/except Exception blocks that swallow errors; add logging or explicit handling.

- k30: **CORS headers** [backlog] by you
  - Add CORS headers for allowed origins or disable cross-origin access where not needed.

- k31: **Rate limiting** [backlog] by you
  - Add rate limiting on public endpoints to prevent abuse and accidental self-DoS from polling loops.

- k32: **Auth killswitch** [backlog] by you
  - Require auth or CSRF-gated confirmation for destructive actions like /api/hub/kill and admin routes.

- k33: **Ollama timeout audit** [backlog] by you
  - Audit Ollama HTTP timeouts and retry behavior; set sane read/connect timeouts and fallback behavior.

- k34: **HTTP helper** [backlog] by you
  - Centralize HTTP requests into one helper with consistent timeouts, headers, and error handling.

- k35: **Startup hooks** [backlog] by you
  - Review startup/shutdown hooks and ensure background workers/threads start cleanly and stop without orphans.

- k36: **Structured logging** [backlog] by you
  - Replace ad-hoc prints with structured logging; include timestamps, levels, and request context.

- k37: **Health endpoint** [backlog] by you
  - Add /health with minimal readiness checks and fast response for load balancers and watchdogs.

- k38: **Metrics endpoint** [backlog] by you
  - Add /metrics-style endpoint for route counts, active processes, relay/ollama state, and uptime.

- k39: **Activity timeline** [backlog] by you
  - Add an activity timeline or recent-events feed to the hub UI for ops visibility.

- k40: **Quick Actions bar** [backlog] by you
  - Add a quick actions bar on the home UI for common hub/relay/ollama actions.

- k41: **Resource alerts** [backlog] by you
  - Add resource alerts for CPU/RAM/disk thresholds with UI notification and optional webhook/log output.

- k42: **Startup sanity check** [backlog] by you
  - Run a startup sanity check on boot: verify required paths, ports, dependencies, and config before serving UI.

- k43: **Config validation** [backlog] by you
  - Validate config on startup and on /admin settings save; fail fast with actionable messages.

- k44: **Session hardening** [backlog] by you
  - Session hardening: review session cookie/token handling, expiration, and regeneration on auth changes.
