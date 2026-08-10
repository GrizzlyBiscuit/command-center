const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const arcade = read("frontend/static/arcade.js");
const modern = read("frontend/static/modern.css");

test("Snake resolves every game color from the active theme", () => {
  assert.match(arcade, /function themeColor\(styles, name, fallback\)/);
  assert.match(arcade, /function arcadePalette\(\)[\s\S]*?getComputedStyle\(document\.documentElement\)/);
  for (const variable of ["--bg", "--border-soft", "--warning", "--accent-3", "--accent", "--accent-2", "--danger"]) {
    assert.match(arcade, new RegExp(`themeColor\\(styles, '${variable}'`));
  }
  assert.match(arcade, /function drawSnake\(\)[\s\S]*?var palette = arcadePalette\(\)/);
});

test("Arcade chrome, 2048, and Chess use shared palette variables", () => {
  assert.match(modern, /\.arc-tab\.active\s*\{(?=[^}]*var\(--accent\))(?=[^}]*var\(--accent-2\))[^}]*\}/);
  assert.match(modern, /\.arc-canvas,\s*\.t2048,\s*\.cc-board\s*\{(?=[^}]*var\(--border\))(?=[^}]*var\(--arcade-glow\))[^}]*\}/);
  assert.match(modern, /\.t2048-cell\.v2\s*\{[^}]*var\(--accent-2\)/);
  assert.match(modern, /\.t2048-cell:is\(\.v128, \.v256, \.v512\)\s*\{[^}]*var\(--success\)/);
  assert.match(modern, /\.t2048-cell:is\(\.v1024, \.v2048, \.vbig\)[\s\S]*?var\(--warning\)/);
  assert.match(modern, /\.cc-sq\.light\s*\{[^}]*var\(--accent\)/);
  assert.match(modern, /\.cc-sq\.sel\s*\{(?=[^}]*var\(--accent\))(?=[^}]*var\(--warning\))[^}]*\}/);
  assert.match(modern, /\.cc-sq\.move::after\s*\{[^}]*var\(--success\)/);
  assert.match(modern, /\.cc-sq\.cap::after\s*\{[^}]*var\(--danger\)/);
  assert.match(modern, /\.cc-pc\.b\s*\{[^}]*var\(--accent\)/);
});

test("Starlight visibly drifts, twinkles, and sends frequent meteors", () => {
  assert.match(modern, /html\[data-theme="starlight"\] body::before\s*\{(?=[^}]*cc-starlight-drift 16s linear infinite alternate)(?=[^}]*cc-starlight-twinkle 3\.6s ease-in-out infinite)[^}]*\}/);
  assert.match(modern, /@keyframes cc-starlight-twinkle\s*\{[\s\S]*?opacity: 0\.94;[\s\S]*?brightness\(1\.42\)/);
  assert.match(modern, /html\[data-theme="starlight"\] body::after\s*\{[^}]*cc-starlight-meteor 6\.8s/);
  assert.match(modern, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?html\[data-theme="starlight"\] body::before,[\s\S]*?html\[data-theme="starlight"\] body::after,[\s\S]*?animation: none !important;/);
});

test("Ice Age carries animated snow and crystalline ice behind Arcade", () => {
  assert.match(modern, /html\[data-theme="iceage"\] body::before\s*\{(?=[^}]*radial-gradient\(circle)(?=[^}]*animation:\s*cc-iceage-snow 13s linear infinite;)[^}]*\}/);
  assert.match(modern, /html\[data-theme="iceage"\] body::after\s*\{(?=[^}]*clip-path:\s*polygon)(?=[^}]*animation:\s*cc-iceage-glint 7s ease-in-out infinite alternate;)[^}]*\}/);
  assert.match(modern, /@keyframes cc-iceage-snow\b/);
  assert.match(modern, /@keyframes cc-iceage-glint\b/);
});

test("Forest and Ember keep their atmospheric animation behind Arcade", () => {
  assert.match(modern, /html\[data-theme="forest"\] body::before\s*\{(?=[^}]*cc-forest-fireflies 11s)(?=[^}]*cc-forest-flicker 3\.8s)[^}]*\}/);
  assert.match(modern, /html\[data-theme="forest"\] body::after\s*\{[^}]*animation:\s*cc-forest-sway 9s/);
  assert.match(modern, /html\[data-theme="ember"\] body::before\s*\{[^}]*animation:\s*cc-ember-rise 9s linear infinite;/);
  assert.match(modern, /html\[data-theme="ember"\] body::after\s*\{[^}]*animation:\s*cc-ember-breathe 4\.6s/);
});
