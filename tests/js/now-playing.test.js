const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Media = require("../../frontend/static/media/media-session.js");
const NowPlaying = require("../../frontend/static/media/now-playing.js");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("formats short and long media durations", () => {
  assert.equal(NowPlaying.formatTime(0), "0:00");
  assert.equal(NowPlaying.formatTime(65.9), "1:05");
  assert.equal(NowPlaying.formatTime(3661), "1:01:01");
});

test("builds an idle card model when no player owns the session", () => {
  const model = NowPlaying.viewModel(null, 1000);
  assert.equal(model.active, false);
  assert.equal(model.title, "Nothing playing");
  assert.equal(model.kindLabel, "Media");
  assert.equal(model.canPlayPause, false);
  assert.equal(model.targetLabel, "Ready");
  assert.equal(model.canOpen, false);
});

test("builds a projected video model with target and capabilities", () => {
  const state = Media.normalizeState({
    source: "video",
    kind: "video",
    title: "Local Film",
    subtitle: "Videos / Favorites",
    artwork: "/api/video/poster/opaque-id",
    playing: true,
    position: 20,
    duration: 100,
    volume: 0.4,
    target: { id: "computer", label: "Command Center PC", online: true },
    capabilities: { playPause: true, previous: true, next: false, seek: true, volume: true },
  }, 1000);
  const model = NowPlaying.viewModel(state, 6000);
  assert.equal(model.kindLabel, "Video");
  assert.equal(model.position, 25);
  assert.equal(model.progress, 250);
  assert.equal(model.elapsedLabel, "0:25");
  assert.equal(model.durationLabel, "1:40");
  assert.equal(model.targetLabel, "Command Center PC");
  assert.equal(model.canPrevious, true);
  assert.equal(model.canNext, false);
  assert.equal(model.openLabel, "Open Video");
  assert.equal(model.canOpen, true);
});

test("marks an offline playback target without hiding the current item", () => {
  const state = Media.normalizeState({
    source: "music",
    title: "Night Drive",
    active: true,
    target: { id: "computer", label: "Command Center PC", online: false },
  });
  const model = NowPlaying.viewModel(state);
  assert.equal(model.active, true);
  assert.equal(model.targetLabel, "Command Center PC offline");
});

test("card partial provides accessible controls for every shared command", () => {
  const template = read("frontend/templates/_now_playing_card.html");
  const script = read("frontend/static/media/now-playing.js");
  for (const id of [
    "cc-now-playing-card", "cc-now-playing-kind", "cc-now-playing-target", "cc-now-playing-open",
    "cc-now-playing-title", "cc-now-playing-previous", "cc-now-playing-play",
    "cc-now-playing-next", "cc-now-playing-progress", "cc-now-playing-volume",
  ]) assert.match(template, new RegExp(`id="${id}"`));
  assert.match(template, /aria-live="polite"/);
  assert.match(script, /showTab\?\.\(state\.source\)/);
  for (const action of ["play", "pause", "previous", "next", "seek", "volume"]) {
    assert.match(script, new RegExp(`"${action}"`));
  }
});
