const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const base = read("frontend/templates/base.html");
const index = read("frontend/templates/index.html");
const panel = read("frontend/templates/_music_panel.html");
const app = read("frontend/static/music/music-app.js");
const controller = read("frontend/static/input/controller-navigation.js");
const visualizer = read("frontend/static/visualizer.js");

test("Music sidebar, panel, and scripts are wired in dependency order", () => {
  assert.match(base, /data-tab="music"/);
  assert.match(panel, /id="tab-music"/);
  assert.match(index, /['"]music['"]/);
  const domain = base.indexOf("music/music-domain.js");
  const musicApp = base.indexOf("music/music-app.js");
  const inputAdapter = base.indexOf("input/controller-navigation.js");
  assert.ok(domain >= 0 && domain < musicApp && musicApp < inputAdapter);
});

test("persistent player is a sibling outside the hidden Music panel", () => {
  assert.match(panel, /<\/div>\s*<section class="cc-music-player" id="cc-music-player"/);
  for(const id of [
    "cc-music-audio", "cc-music-play", "cc-music-previous", "cc-music-next",
    "cc-music-progress", "cc-music-volume", "cc-music-queue",
  ]) assert.match(panel, new RegExp(`id="${id}"`));
});

test("music delegates contextual controller actions without taking panel bumpers", () => {
  assert.match(controller, /CCMusic\?\.handleInputAction\?\.\("back"/);
  assert.match(controller, /CCMusic\?\.handleInputAction\?\.\(action/);
  assert.match(controller, /action === "previousSection"\) return moveSection\(-1\)/);
  assert.match(controller, /action === "nextSection"\) return moveSection\(1\)/);
  assert.match(app, /function handleInputAction\(action\)/);
});

test("visualizer prefers active library music and falls back to ambient audio", () => {
  const music = visualizer.indexOf("window.CCMusic.getAnalyser");
  const ambient = visualizer.indexOf("window.CCAudio.getAnalyser");
  assert.ok(music >= 0 && music < ambient);
});

test("music UI remains music-only", () => {
  assert.doesNotMatch(`${panel}\n${app}`, /\b(video|interviews?|offline downloads?)\b/i);
});
