const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs
  .readFileSync(path.join(root, relativePath), "utf8")
  .replace(/\r\n?/g, "\n");

const base = read("frontend/templates/base.html");
const panel = read("frontend/templates/_music_panel.html");
const app = read("frontend/static/music/music-app.js");
const css = read("frontend/static/music/local-player-ui.css");
const mediaUI = require(path.join(root, "frontend/static/media/media-ui.js"));

test("the local-player stylesheet is the final visual layer", () => {
  const modernIndex = base.indexOf("filename='modern.css'");
  const localPlayerIndex = base.indexOf("filename='music/local-player-ui.css'");

  assert.ok(modernIndex >= 0, "base should load modern.css");
  assert.ok(localPlayerIndex > modernIndex, "local-player-ui.css should load after modern.css");
  assert.equal(base.indexOf("filename='music/local-player-ui.css'", localPlayerIndex + 1), -1);

  const lyricsIndex = base.indexOf("filename='music/music-lyrics.js'");
  const appIndex = base.indexOf("filename='music/music-app.js'");
  assert.ok(lyricsIndex >= 0 && lyricsIndex < appIndex, "lyrics helpers should load before the music app");

  const ambientScenesIndex = panel.indexOf("filename='music/music-orbit-bloom-ambient-scenes.js'");
  const orbitBloomIndex = panel.indexOf("filename='music/music-orbit-bloom.js'");
  const classicModesIndex = panel.indexOf("filename='music/music-now-playing-visualizer.js'");
  assert.ok(
    ambientScenesIndex >= 0 && ambientScenesIndex < orbitBloomIndex && orbitBloomIndex < classicModesIndex,
    "visualizer helpers should load in dependency order before the deferred music app",
  );
});

test("the Music panel keeps its persistent player and exposes an album-first toolbar", () => {
  assert.match(
    panel,
    /<div[^>]*id="tab-music"[\s\S]*?<\/div>\s*<\/div>\s*<section[^>]*id="cc-music-player"/,
    "the player must remain a sibling outside the hidden Music tab",
  );
  assert.match(panel, /<button[^>]*class="[^"]*\bactive\b[^"]*"[^>]*data-music-view="albums"/);

  for (const id of [
    "cc-music-library-queue",
    "cc-music-library-queue-count",
    "cc-music-sort",
    "cc-music-play-shown",
    "cc-music-shuffle-shown",
    "cc-music-queue-body",
  ]) {
    assert.match(panel, new RegExp(`id="${id}"`), `${id} should stay wired`);
  }

  assert.match(panel, /<select[^>]*id="cc-music-sort"[^>]*aria-label="Album order or organization"/);
  assert.match(panel, /<option value="newest">Newest<\/option>/);
  assert.match(panel, /<option value="oldest">Oldest<\/option>/);
  assert.match(panel, /<option value="title">Title<\/option>/);
  assert.match(panel, /<option value="folder">Folder<\/option>/);
  assert.match(panel, /<option value="year">Year<\/option>/);
  assert.match(panel, /<div[^>]*class="cc-music-queue-body"[^>]*id="cc-music-queue-body"/);
  assert.match(panel, /<\/section>\s*<aside[^>]*id="cc-music-queue"/);
});

test("the mini player opens an accessible full-screen Now Playing dialog", () => {
  assert.match(
    panel,
    /<div[^>]*id="cc-music-player-open"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="Open Now Playing"[^>]*aria-controls="cc-music-now-playing"/,
  );
  assert.match(
    panel,
    /<section[^>]*id="cc-music-now-playing"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*hidden>/,
  );
  assert.match(
    panel,
    /<button[^>]*id="cc-music-now-playing-close"[^>]*aria-label="Collapse Now Playing"/,
  );
  for (const id of [
    "cc-music-now-playing-art",
    "cc-music-now-playing-title",
    "cc-music-now-playing-progress",
    "cc-music-now-playing-play",
    "cc-music-now-playing-volume",
    "cc-music-now-playing-story",
    "cc-music-now-playing-fullscreen",
    "cc-music-now-playing-scene",
    "cc-music-now-playing-scene-name",
    "cc-music-now-playing-glow",
  ]) {
    assert.match(panel, new RegExp(`id="${id}"`), `${id} should stay wired`);
  }
  assert.doesNotMatch(panel, /id="cc-music-now-playing-details-toggle"/);
  assert.doesNotMatch(panel, /id="cc-music-now-playing-details"/);
});

test("music defaults to sorted albums and synchronizes every playback surface", () => {
  assert.match(app, /view:\s*"albums"/);
  assert.match(app, /sort:\s*"newest"/);
  assert.match(app, /function sortAlbumGroups\(groups\)/);
  assert.match(app, /nodes\.sort\?\.addEventListener\("change"/);
  assert.match(app, /ALBUM_SORT_MODES\.includes\(nodes\.sort\.value\)/);

  assert.match(app, /function openNowPlaying\(\)/);
  assert.match(app, /function closeNowPlaying\(\{ restoreFocus = true \} = \{\}\)/);
  assert.match(app, /nodes\.playerOpen\?\.addEventListener\("click", openNowPlaying\)/);
  assert.match(app, /nodes\.nowPlayingClose\?\.addEventListener\("click", \(\) => closeNowPlaying\(\)\)/);
  assert.match(app, /root\.document\.addEventListener\("keydown", handleModalKeydown\)/);
  assert.match(app, /if \(queueIsOpen\(\)\) setQueueOpen\(false\)/);
  assert.match(app, /function applyModalInert\(\)/);

  assert.match(app, /function updateNowPlayingSurface\(track, playing\)/);
  assert.match(app, /updateNowPlayingSurface\(track, playing\)/);
  assert.match(app, /nodes\.nowPlayingProgress\.value = progressValue/);
  assert.match(app, /nodes\.nowPlayingVolume\.value = String\(playbackVolume\(\)\)/);
  assert.match(app, /function queueControls\(\)/);
  assert.match(app, /const queueHost = nodes\.queueBody \|\| nodes\.queue/);
  assert.match(app, /const Lyrics = root\.CCMusicLyrics/);
  assert.match(app, /function ensureNowPlayingLyrics\(track\)/);
  assert.match(app, /Lyrics\.activeLrcIndex\(state\.lyrics\.cues, playbackPosition\(\)\)/);
  assert.match(app, /function playShuffledTracks\(tracks\)/);
  assert.match(app, /cc-music-album-details-toggle/);
  assert.match(app, /cc-music-album-queue-button/);

  assert.doesNotMatch(`${panel}\n${app}`, /\b(video|interviews?|offline downloads?)\b/i);
});

test("shared media icons cover Music views and full-screen visualizer chrome", () => {
  for (const name of ["albums", "artists", "details", "folder", "glow", "settings", "stats"]) {
    assert.ok(mediaUI.icons.includes(name), `missing ${name} icon`);
    assert.ok(mediaUI.createIcon(name, { document: null }) === null);
  }
});

test("the late CSS owns the black artwork-first library and focused album view", () => {
  assert.match(
    css,
    /\/\* Full-screen Now Playing[\s\S]*?\.cc-music-now-playing\s*\{(?=[^}]*position:\s*fixed;)(?=[^}]*inset:\s*0;)(?=[^}]*background:\s*#000;)[^}]*\}/,
  );
  assert.match(
    css,
    /\.cc-music-album-grid\s*\{(?=[^}]*display:\s*grid;)(?=[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(165px,\s*100%\),\s*1fr\)\);)[^}]*\}/,
  );
  assert.match(
    css,
    /\.cc-music-album-artwork\s*\{(?=[^}]*width:\s*100%;)(?=[^}]*height:\s*auto;)(?=[^}]*aspect-ratio:\s*1\s*\/\s*1;)(?=[^}]*overflow:\s*hidden;)[^}]*\}/,
  );
  assert.match(
    css,
    /\.cc-music button\.cc-music-album-cover\s*\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);)(?=[^}]*height:\s*auto;)(?=[^}]*aspect-ratio:\s*auto;)(?=[^}]*align-items:\s*stretch;)(?=[^}]*justify-content:\s*stretch;)[^}]*\}/,
  );
  assert.match(css, /\.cc-music\s*\{(?=[^}]*width:\s*100%;)(?=[^}]*max-width:\s*none;)[^}]*\}/);
  assert.match(css, /\.cc-music-album-art\s*\{[^}]*object-fit:\s*cover;/);
  assert.match(
    css,
    /\.cc-music-album\.is-expanded\s*\{(?=[^}]*grid-column:\s*1\s*\/\s*-1;)(?=[^}]*grid-template-columns:\s*minmax\(260px,\s*360px\)\s*minmax\(520px,\s*760px\);)[^}]*\}/,
  );
  assert.match(
    css,
    /\.cc-music-album\.is-expanded \.cc-music-album-cover \.cc-music-album-artwork\s*\{(?=[^}]*grid-column:\s*1;)(?=[^}]*grid-row:\s*1;)[^}]*\}/,
  );
  assert.match(
    css,
    /\.cc-music-album\.is-expanded \.cc-music-album-cover \.cc-music-group-copy\s*\{(?=[^}]*grid-column:\s*1;)(?=[^}]*grid-row:\s*2;)[^}]*\}/,
  );
  assert.match(css, /\.cc-music-album-grid:has\(> \.cc-music-album\.is-expanded\)[^{]*\{\s*display:\s*none;/);

  const narrowStart = css.indexOf("@media (max-width: 860px)");
  const phoneStart = css.indexOf("@media (max-width: 440px)", narrowStart);
  assert.ok(narrowStart >= 0 && phoneStart > narrowStart);
  assert.doesNotMatch(css.slice(narrowStart, phoneStart), /\.cc-music-album-grid\s*\{[^}]*grid-template-columns:/);
  assert.match(css.slice(phoneStart), /\.cc-music-album-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
});

test("Synthwave leaves Music library surfaces translucent while Now Playing stays black", () => {
  assert.match(
    css,
    /html\[data-theme="synthwave"\] #tab-music,\s*html\[data-theme="synthwave"\] \.cc-music\s*\{[^}]*background:\s*transparent;/,
  );
  assert.match(css, /html\[data-theme="synthwave"\] \.cc-music-content\s*\{[^}]*background:\s*rgba\(2, 3, 14, 0\.08\);/);
  assert.match(css, /html\[data-theme="synthwave"\] \.cc-music-now-playing\s*\{[^}]*background:\s*#000;/);
});

test("desktop and mobile mini-player sizing remain deliberate", () => {
  assert.match(
    css,
    /#cc-music-player\s*\{(?=[^}]*position:\s*fixed;)(?=[^}]*grid-template-columns:\s*minmax\(240px,\s*420px\)\s*auto\s*minmax\(220px,\s*1fr\)\s*auto;)(?=[^}]*min-height:\s*80px;)[^}]*\}/,
  );
  assert.match(css, /\.cc-music-now img\s*\{(?=[^}]*width:\s*56px;)(?=[^}]*height:\s*56px;)[^}]*\}/);

  const mobileStart = css.indexOf("@media (max-width: 680px)");
  const mobileEnd = css.indexOf("@media (max-width: 440px)", mobileStart);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "mobile player rules should be bounded");
  const mobile = css.slice(mobileStart, mobileEnd);
  assert.match(
    mobile,
    /#cc-music-player,[\s\S]*?\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;)(?=[^}]*min-height:\s*66px;)[^}]*\}/,
  );
  assert.match(mobile, /\.cc-music-now img\s*\{(?=[^}]*width:\s*38px;)(?=[^}]*height:\s*38px;)[^}]*\}/);
  assert.match(mobile, /padding-bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(mobile, /\.cc-music-queue\s*\{(?=[^}]*top:\s*0;)[^}]*\}/);
  assert.match(mobile, /\.cc-music-queue-head\s*\{[^}]*padding-top:\s*calc\(14px \+ env\(safe-area-inset-top\)\);/);
});

test("Now Playing adapts from two columns to narrow screens", () => {
  assert.match(
    css,
    /\.cc-music-now-playing-body\s*\{[^}]*grid-template-columns:\s*minmax\(420px,\s*560px\)\s*minmax\(480px,\s*1fr\);/,
  );
  const tabletStart = css.indexOf("@media (max-width: 1099px)");
  const tabletEnd = css.indexOf("@media (max-width: 1120px)", tabletStart);
  assert.ok(tabletStart >= 0 && tabletEnd > tabletStart, "tablet Now Playing rules should be bounded");
  assert.match(
    css.slice(tabletStart, tabletEnd),
    /\.cc-music-now-playing-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*560px\);/,
  );

  const narrowStart = css.indexOf("@media (max-width: 860px)");
  const narrowEnd = css.indexOf("@media (max-width: 680px)", narrowStart);
  assert.ok(narrowStart >= 0 && narrowEnd > narrowStart, "narrow Now Playing rules should be bounded");
  const narrow = css.slice(narrowStart, narrowEnd);
  assert.match(narrow, /\.cc-music-now-playing-artwork\s*\{[^}]*width:\s*94vw;/);
  assert.match(narrow, /\.cc-music-now-playing-controls\s*\{[^}]*grid-template-columns:\s*minmax\(44px,\s*1fr\)\s*auto\s*minmax\(44px,\s*1fr\);/);
  assert.match(narrow, /\.cc-music-now-playing-volume\s*\{\s*display:\s*none;/);
});
