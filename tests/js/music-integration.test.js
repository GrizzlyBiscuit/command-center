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
const visualizer = require(path.join(root, "frontend/static/visualizer.js"));

test("Music sidebar, panel, and scripts are wired in dependency order", () => {
  assert.match(base, /data-tab="music"/);
  assert.match(panel, /id="tab-music"/);
  assert.match(index, /['"]music['"]/);
  const domain = base.indexOf("music/music-domain.js");
  const remote = base.indexOf("music/music-remote.js");
  const musicApp = base.indexOf("music/music-app.js");
  const inputAdapter = base.indexOf("input/controller-navigation.js");
  assert.ok(domain >= 0 && domain < remote && remote < musicApp && musicApp < inputAdapter);
  assert.match(panel, /id="cc-music-output"/);
  assert.match(panel, /value="device"/);
  assert.match(panel, /value="computer"/);
});

test("persistent player is a sibling outside the hidden Music panel", () => {
  assert.match(panel, /<\/div>\s*<section class="cc-music-player" id="cc-music-player"/);
  for(const id of [
    "cc-music-audio", "cc-music-play", "cc-music-previous", "cc-music-next",
    "cc-music-progress", "cc-music-volume", "cc-music-queue",
    "cc-music-player-hide", "cc-music-player-show",
  ]) assert.match(panel, new RegExp(`id="${id}"`));
  assert.match(panel, /id="cc-music-player-hide"[^>]*aria-label="Hide music player"[^>]*aria-controls="cc-music-player"/);
  assert.match(
    panel,
    /<\/section>\s*<aside class="cc-music-queue" id="cc-music-queue"[\s\S]*?<\/aside>\s*<button type="button" class="cc-music-player-show" id="cc-music-player-show"[^>]*aria-label="Show music player"[^>]*hidden>/,
    "the fixed queue must be a viewport-level sibling, not a child of the filtered mini player",
  );
  const playerMarkup = panel.slice(panel.indexOf('<section class="cc-music-player"'), panel.indexOf('<aside class="cc-music-queue"'));
  assert.doesNotMatch(playerMarkup, /id="cc-music-queue"/);
});

test("music delegates contextual controller actions without taking panel bumpers", () => {
  assert.match(controller, /CCMusic\?\.handleInputAction\?\.\("back"/);
  assert.match(controller, /CCMusic\?\.handleInputAction\?\.\(action/);
  assert.match(controller, /action === "previousSection"\) return moveSection\(-1\)/);
  assert.match(controller, /action === "nextSection"\) return moveSection\(1\)/);
  assert.match(app, /function handleInputAction\(action\)/);
});

test("visualizer prefers active library music and falls back to ambient audio", () => {
  const calls = [];
  const musicAnalyser = { source: "music" };
  const ambientAnalyser = { source: "ambient" };
  const host = {
    CCMusic: {
      isPlaying: () => true,
      getAnalyser: () => { calls.push("music"); return musicAnalyser; },
    },
    CCAudio: {
      getAnalyser: () => { calls.push("ambient"); return ambientAnalyser; },
    },
  };
  assert.equal(visualizer.resolveAnalyser(host), musicAnalyser);
  assert.deepEqual(calls, ["music"]);

  host.CCMusic.isPlaying = () => false;
  assert.equal(visualizer.resolveAnalyser(host), ambientAnalyser);
  assert.deepEqual(calls, ["music", "ambient"]);
});

test("music UI remains music-only", () => {
  assert.doesNotMatch(`${panel}\n${app}`, /\b(video|interviews?|offline downloads?)\b/i);
});
