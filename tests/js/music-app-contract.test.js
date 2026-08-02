const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "static", "music", "music-app.js"),
  "utf8",
);
const cssSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "static", "music", "music.css"),
  "utf8",
);

test("music app keeps opaque track IDs end-to-end", () => {
  assert.match(appSource, /function opaqueTrackId\(value\)/);
  assert.doesNotMatch(appSource, /Number\(item\.track_id\)/);
  assert.doesNotMatch(appSource, /Number\(trackId\)/);
});

test("persistent dock is revealed when a current track exists", () => {
  assert.match(appSource, /nodes\.player\.hidden = !track/);
});

test("stats payload contains only trusted identity, time, boolean play count, and event id", () => {
  const payloadMatch = appSource.match(/const payload = \{([\s\S]*?)\n\s*\};\n\s*request\(API\.stats/);
  assert.ok(payloadMatch, "stats payload should be posted through API.stats");
  const payload = payloadMatch[1];
  assert.match(payload, /track_id: trackId/);
  assert.match(payload, /seconds/);
  assert.match(payload, /count_play: countPlay/);
  assert.match(payload, /client_event_id: clientEventId\(\)/);
  assert.doesNotMatch(payload, /path|title|artist|album/);
});

test("automatic stats flush cannot recurse through collection", () => {
  assert.match(appSource, /flushListening\(\{ collect: false \}\)/);
  assert.match(appSource, /if \(collect\) collectListeningTime\(\{ autoFlush: false \}\)/);
});

test("controller actions are explicitly scoped to player state and open drawers", () => {
  assert.match(appSource, /function handleInputAction\(action\)/);
  assert.match(appSource, /action === "secondaryAction"/);
  assert.match(appSource, /if \(!currentTrack\(\)\) return false/);
  assert.match(appSource, /action !== "back"/);
  assert.match(appSource, /handleInputAction\(action, detail\)/);
});

test("dock avoids the open sidebar and stays below modal layers", () => {
  assert.match(cssSource, /#cc-music-player\s*\{[\s\S]*?left:\s*252px;[\s\S]*?z-index:\s*500;/);
  assert.match(cssSource, /\.app-shell\.sidebar-collapsed #cc-music-player\s*\{\s*left:\s*18px;/);
  assert.match(cssSource, /\.cc-music,\s*\.cc-music-player\s*\{[\s\S]*?--music-cyan:[\s\S]*?--music-purple:/);
  assert.match(cssSource, /@media \(max-width: 1050px\)[\s\S]*?#cc-music-player\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
});

test("trusted playback initializes and resumes the shared analyser graph", () => {
  assert.match(appSource, /getAnalyser\(\);\s*const resume = state\.audioContext\?\.state === "suspended"/);
  assert.match(appSource, /Promise\.all\(\[resume, playback\]\)/);
  assert.match(appSource, /cc:ambientaudiochange/);
  assert.match(appSource, /syncAmbientControls/);
});
