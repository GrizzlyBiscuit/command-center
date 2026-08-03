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
const {
  dockVisibility,
  readPlayerHiddenPreference,
  writePlayerHiddenPreference,
} = require(path.join(__dirname, "..", "..", "frontend", "static", "music", "music-app.js"));

test("music app keeps opaque track IDs end-to-end", () => {
  assert.match(appSource, /function opaqueTrackId\(value\)/);
  assert.doesNotMatch(appSource, /Number\(item\.track_id\)/);
  assert.doesNotMatch(appSource, /Number\(trackId\)/);
});

test("persistent dock and restore control follow track and preference state", () => {
  assert.deepEqual(dockVisibility(false, false), { playerHidden: true, restoreHidden: true });
  assert.deepEqual(dockVisibility(false, true), { playerHidden: true, restoreHidden: true });
  assert.deepEqual(dockVisibility(true, false), { playerHidden: false, restoreHidden: true });
  assert.deepEqual(dockVisibility(true, true), { playerHidden: true, restoreHidden: false });
  assert.match(appSource, /syncDockVisibility\(track\)/);
  assert.doesNotMatch(appSource, /nodes\.player\.hidden = !track/);
});

test("player visibility preference is local, guarded, and presentation-only", () => {
  const values = new Map();
  const host = { localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  } };
  assert.equal(readPlayerHiddenPreference(host), false);
  writePlayerHiddenPreference(host, true);
  assert.equal(readPlayerHiddenPreference(host), true);
  writePlayerHiddenPreference(host, false);
  assert.equal(readPlayerHiddenPreference(host), false);
  assert.equal(readPlayerHiddenPreference({ get localStorage() { throw new Error("denied"); } }), false);

  const handler = appSource.match(/function setPlayerHidden\(hidden\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.match(handler, /writePlayerHiddenPreference/);
  assert.match(handler, /aria-expanded", "false"/);
  assert.match(handler, /focusTarget\.focus\(\)/);
  assert.doesNotMatch(handler, /pause\(|\.pause\(|stop|clearQueue|sendRemote/);
});

test("remote music stays playable while host-only folder controls are disabled", () => {
  assert.match(appSource, /You can browse and play this library here\./);
  assert.match(appSource, /browse\.disabled = !state\.editable/);
  assert.match(appSource, /save\.disabled = !state\.editable/);
  assert.match(appSource, /rescan\.disabled = !state\.editable/);
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

test("albums render as controller-friendly artwork cards while artists keep group rows", () => {
  assert.match(appSource, /type === "album" \? " cc-music-album-grid" : ""/);
  assert.match(appSource, /button\("", "cc-music-album-cover"\)/);
  assert.match(appSource, /Domain\.albumArtworkTrack\(group\)/);
  assert.match(appSource, /albumCover\.dataset\.spatialKey = `music-album:\$\{opaqueTrackId\(group\.tracks\[0\]\)\}`/);
  assert.match(appSource, /`Open album \$\{group\.label\} by \$\{group\.artist\}`/);
  assert.match(appSource, /trackArtwork\(artworkTrack, "cc-music-album-art"\)/);
  assert.doesNotMatch(appSource, /track\.(?:path|filename)/);
});

test("album cards expand across the grid and Back restores the opening control", () => {
  assert.match(appSource, /card\.classList\.toggle\("is-expanded", opening\)/);
  assert.match(appSource, /querySelectorAll\("\.cc-music-group\.is-expanded"\)/);
  assert.match(appSource, /trigger\.dataset\.groupReturnFocus = "true"/);
  assert.match(appSource, /querySelector\('\[data-group-return-focus="true"\]'\)/);
  assert.match(appSource, /returnFocus\.focus\(\)/);
  assert.match(cssSource, /\.cc-music-album-grid\s*\{[\s\S]*?repeat\(auto-fill, minmax\(min\(185px, 100%\), 1fr\)\)/);
  assert.match(cssSource, /\.cc-music-album\.is-expanded\s*\{\s*grid-column:\s*1 \/ -1;/);
});

test("album artwork stays square, cropped, responsive, and keeps a visible fallback", () => {
  assert.match(cssSource, /\.cc-music button\.cc-music-album-cover\s*\{[\s\S]*?aspect-ratio:\s*1 \/ 1;[\s\S]*?overflow:\s*hidden;/);
  assert.match(cssSource, /\.cc-music-album-art\s*\{[\s\S]*?object-fit:\s*cover;/);
  assert.match(cssSource, /\.cc-music-album-art\.is-missing\s*\{\s*opacity:\s*0;/);
  assert.match(cssSource, /\.cc-music-album-art-fallback\s*\{[\s\S]*?radial-gradient/);
  assert.match(cssSource, /@media \(max-width: 520px\)[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("dock avoids the open sidebar and stays below modal layers", () => {
  assert.match(cssSource, /#cc-music-player\s*\{[\s\S]*?left:\s*252px;[\s\S]*?z-index:\s*500;/);
  assert.match(cssSource, /\.app-shell\.sidebar-collapsed #cc-music-player\s*\{\s*left:\s*18px;/);
  assert.match(cssSource, /\.cc-music,\s*\.cc-music-player,\s*\.cc-music-player-show\s*\{[\s\S]*?--music-cyan:[\s\S]*?--music-purple:/);
  assert.match(cssSource, /@media \(max-width: 1050px\)[\s\S]*?#cc-music-player\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
});

test("phone dock stays in one compact safe-area row", () => {
  const start = cssSource.indexOf("@media (max-width: 680px)");
  const end = cssSource.indexOf("@media (max-width: 520px)", start);
  assert.ok(start >= 0 && end > start, "phone dock media query should precede narrower album rules");
  const mobile = cssSource.slice(start, end);
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\) auto auto;/);
  assert.match(mobile, /left:\s*max\(6px, env\(safe-area-inset-left\)\)/);
  assert.match(mobile, /\.cc-music-now img\s*\{[\s\S]*?width:\s*38px;[\s\S]*?height:\s*38px;/);
  assert.match(cssSource, /\.cc-music-now:has\(> img\[hidden\]\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(mobile, /#cc-music-shuffle,[\s\S]*?\.cc-music-timeline,[\s\S]*?display:\s*none;/);
  assert.match(mobile, /\.cc-music-player-tools\s*\{[\s\S]*?grid-column:\s*auto;/);
  assert.match(mobile, /\.cc-music-transport button\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(mobile, /padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
});

test("trusted playback initializes and resumes the shared analyser graph", () => {
  assert.match(appSource, /getAnalyser\(\);\s*const resume = state\.audioContext\?\.state === "suspended"/);
  assert.match(appSource, /Promise\.all\(\[resume, playback\]\)/);
  assert.match(appSource, /cc:ambientaudiochange/);
  assert.match(appSource, /syncAmbientControls/);
});
