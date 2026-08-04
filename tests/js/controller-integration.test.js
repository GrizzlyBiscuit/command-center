const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const base = read("frontend/templates/base.html");
const index = read("frontend/templates/index.html");
const arcade = read("frontend/static/arcade.js");
const chess = read("frontend/static/chess.js");

test("input scripts load in dependency order", () => {
  const scripts = [
    "input/keyboard-controls.js",
    "input/spatial-navigation.js",
    "input/gamepad-controller.js",
    "input/controller-navigation.js",
  ];
  let cursor = -1;
  for(const script of scripts){
    const position = base.indexOf(script);
    assert.ok(position > cursor, `${script} should load after its dependencies`);
    cursor = position;
  }
});

test("every sidebar tab button has a matching panel", () => {
  const tabs = Array.from(base.matchAll(/<button[^>]+class="tab-btn"[^>]+data-tab="([^"]+)"/g), match => match[1]);
  assert.ok(tabs.length > 10, "expected the Command Center panel buttons");
  for(const tab of tabs) assert.match(index, new RegExp(`id="tab-${tab}"`));
  assert.doesNotMatch(base, /data-tab="relay"\s+r(?:\s|$)/);
});

test("modal markup is parsed before the page script and exposes dialog semantics", () => {
  assert.ok(base.indexOf('id="kill-confirm"') < base.indexOf("<main"));
  assert.match(base, /role="dialog" aria-modal="true" aria-labelledby="kill-confirm-title"/);
  assert.match(index, /id="kb-wip-caution" role="dialog" aria-modal="true"/);
  assert.match(index, /id="kb-pop" role="dialog" aria-modal="true"/);
});

test("arcade input requires explicit capture and exposes release hooks", () => {
  assert.match(index, /id="arc-stage" tabindex="0" role="application"/);
  assert.match(arcade, /function captureInput\(\)/);
  assert.match(arcade, /function releaseInput\(\)/);
  assert.match(arcade, /!inputCaptured/);
  assert.match(arcade, /onHide: function \(\) \{ releaseInput\(\)/);
});

test("chess squares expose keyboard and spatial-navigation controls", () => {
  assert.match(index, /id="cc-board" role="grid"/);
  assert.match(chess, /document\.createElement\('button'\)/);
  assert.match(chess, /sq\.dataset\.spatialKey/);
  assert.match(chess, /sq\.setAttribute\('aria-label'/);
  assert.match(chess, /cancelSelection\(\)/);
});
