const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const index = read("frontend/templates/index.html");
const standalone = read("frontend/templates/darkmode.html");
const theme = read("frontend/static/theme.js");
const music = read("frontend/static/music/music-app.js");
const css = read("frontend/static/modern.css");

test("Appearance exposes a saved music mini-player switch on both surfaces", () => {
  for (const template of [index, standalone]) {
    assert.match(template, /Show music mini player/);
    assert.match(template, /type="checkbox"[^>]*role="switch"[^>]*data-music-player-toggle/);
    assert.match(template, /Playback continues\./);
  }
  assert.match(theme, /MUSIC_PLAYER_HIDDEN_KEY = 'cc\.music\.player\.hidden\.v1'/);
  assert.match(theme, /CCMusic\.setPlayerVisible\(visible\)/);
  assert.match(theme, /cc:musicplayervisibilitychange/);
});

test("Music publishes synchronized visibility controls without stealing switch focus", () => {
  assert.match(music, /setPlayerVisible: visible => setPlayerHidden\(!Boolean\(visible\), \{ restoreFocus: false \}\)/);
  assert.match(music, /isPlayerVisible: \(\) => !state\.playerHidden/);
  assert.match(music, /new root\.CustomEvent\("cc:musicplayervisibilitychange"/);
  assert.match(music, /detail: \{ visible: !state\.playerHidden \}/);
});

test("the switch is compact, accessible, and phone friendly", () => {
  assert.match(css, /\.appearance-toggle-row \{(?=[^}]*display: flex;)(?=[^}]*justify-content: space-between;)[^}]*\}/);
  assert.match(css, /\.appearance-toggle-row input\[role="switch"\] \{(?=[^}]*width: 44px;)(?=[^}]*height: 24px;)[^}]*\}/);
  assert.match(css, /\.appearance-toggle-row input\[role="switch"\]:focus-visible \{[^}]*outline:/);
});
