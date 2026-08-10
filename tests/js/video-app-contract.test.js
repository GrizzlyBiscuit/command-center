const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const panel = read("frontend/templates/_video_panel.html");
const app = read("frontend/static/video/video-app.js");
const css = read("frontend/static/video/video.css");

test("video panel has library, recent, settings, output, and HTML5 player controls", () => {
  assert.match(panel, /id="tab-video"/);
  assert.match(panel, /data-video-view="library"/);
  assert.match(panel, /data-video-view="recent"/);
  assert.match(panel, /data-video-view="settings"/);
  assert.match(panel, /id="cc-video-output"/);
  assert.match(panel, /value="device"/);
  assert.match(panel, /value="computer"/);
  assert.match(panel, /<video id="cc-video-media"[^>]*playsinline/);
  for (const id of [
    "cc-video-play",
    "cc-video-previous",
    "cc-video-next",
    "cc-video-progress",
    "cc-video-volume",
  ]) assert.match(panel, new RegExp('id="' + id + '"'));
});

test("video library uses generic film tiles without thumbnail extraction", () => {
  assert.match(app, /element\("span", "cc-video-poster"/);
  assert.match(app, /createIcon\?\.\("film"/);
  assert.match(css, /\.cc-video-poster/);
  assert.doesNotMatch(panel + "\n" + app, /thumbnail_url|folder_cover|ffmpeg|youtube/i);
});

test("video cards prioritize one main target and retain stable secondary actions", () => {
  assert.match(app, /button\("", "cc-video-card-main"/);
  assert.match(app, /main\.dataset\.spatialKey = `video:\$\{opaqueVideoId\(video\)\}`/);
  assert.match(app, /restart\.dataset\.spatialKey = `video-restart:/);
  assert.match(app, /main\.setAttribute\("aria-current", "true"\)/);
  assert.match(app, /function syncVideoHighlights/);
  assert.match(css, /\.cc-video button\.cc-video-card-main\s*\{/);
  assert.match(css, /\.cc-video-card:focus-within\s*\{/);
});

test("video rerenders restore card focus by stable key", () => {
  assert.match(app, /function focusedContentKey/);
  assert.match(app, /function restoreContentFocus/);
  assert.match(app, /Array\.from\(nodes\.content\.querySelectorAll\("\[data-spatial-key\]"\)\)/);
  assert.match(app, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /const focusKey = focusedContentKey\(\)/);
  assert.match(app, /restoreContentFocus\(focusKey\)/);
});

test("video screen and icon transport are controller friendly", () => {
  assert.match(panel, /id="cc-video-screen"[^>]*role="button"[^>]*tabindex="0"[^>]*data-spatial-key="video-screen"/);
  assert.match(app, /nodes\.screen\?\.addEventListener\("keydown"/);
  assert.match(app, /\["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(app, /setControlIcon\(nodes\.play, playing \? "pause" : "play"/);
  assert.match(app, /fullscreen \? "fullscreenExit" : "fullscreen"/);
  assert.match(app, /webkitEnterFullscreen/);
  assert.match(app, /nodes\.player\?\.requestFullscreen/);
  assert.match(app, /setFallbackFullscreen\(true\)/);
  assert.match(app, /if \(!fullscreenActive\(\)\) setFallbackFullscreen\(true\)/);
  assert.match(app, /fullscreenerror/);
  assert.match(css, /\.cc-video-player\.is-fallback-fullscreen,[\s\S]*?\.cc-video-player:fullscreen,[\s\S]*?position:\s*fixed !important;[\s\S]*?height:\s*100dvh;/);
  assert.match(css, /\.cc-video-screen:fullscreen[\s\S]*?height:\s*100dvh[\s\S]*?object-fit:\s*contain/);
  assert.match(app, /` · \$\{state\.queueIndex \+ 1\} of \$\{state\.queue\.length\}`/);
});

test("video library stays visual and compact on phones", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 540px)"), css.indexOf("@media (max-width: 340px)"));
  assert.match(phone, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(phone, /\.cc-video-card-actions button\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  assert.match(phone, /\.cc-video-controls button\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(phone, /#cc-video-fullscreen\s*\{(?=[^}]*width:\s*44px;)(?=[^}]*height:\s*44px;)[^}]*\}/);
  assert.match(phone, /\.cc-video-controls label\[for="cc-video-volume"\],[\s\S]*?#cc-video-volume\s*\{\s*display:\s*none;/);
  assert.match(app, /nodes\.volume\?\.addEventListener\("change", handleVolumeInput\)/);
  assert.match(css, /@media \(max-width: 340px\)[\s\S]*?grid-template-columns:\s*1fr/);
});

test("video streams and shared progress use opaque catalog IDs", () => {
  assert.match(app, /function opaqueVideoId\(value\)/);
  assert.match(app, /"\/api\/video\/stream\/" \+ encodeURIComponent\(id\)/);
  assert.match(app, /API\.progress \+ "\/" \+ encodeURIComponent\(video\.id\)/);
  assert.match(app, /body: \{ position, duration, completed \}/);
  assert.doesNotMatch(app, /body:\s*\{[^}]*path/s);
});

test("video publishes to and consumes commands from the shared media session", () => {
  assert.match(app, /CCMediaSession\?\.publish\?\.\(root, detail\)/);
  assert.match(app, /CCMediaSession\?\.onCommand\?\.\(root, "video"/);
  assert.match(app, /CCMediaSession\?\.commandActive\?\.\(action, value, root\)/);
  assert.match(app, /source: "video"/);
  assert.match(app, /itemId: video\?\.id/);
  assert.match(app, /handleInputAction/);
});

test("video ignores stale media events after switching sources", () => {
  assert.match(app, /localVideoId: ""/);
  assert.match(app, /mediaReadyToken: -1/);
  assert.match(app, /function localSourceReady\(\)/);
  assert.match(app, /state\.mediaReadyToken === state\.sourceToken/);
  assert.match(app, /if \(usingRemoteOutput\(\) \|\| !localSourceReady\(\)\) return;/);
  assert.match(app, /persistProgress\(localSourceVideo\(\)\)/);
  assert.match(app, /video\.id === currentVideo\(\)\?\.id/);
  assert.match(app, /root\.document\.hidden && localSourceReady\(\)/);
  assert.match(app, /if \(localSourceReady\(\)\) \{\s*persistProgress\(localSourceVideo\(\), \{ force: true, keepalive: true \}\);/s);
});

test("video owns native Media Session state and restores the shared active item", () => {
  assert.match(app, /function syncNativeMediaSession\(fallbackState = null\)/);
  assert.match(app, /CCMediaSession\?\.snapshot\?\.\(root\)/);
  assert.match(app, /mediaSession\.playbackState = playbackState/);
  assert.match(app, /mediaSession\.metadata = null/);
  assert.match(app, /new root\.MediaMetadata/);
});

test("remote video renderer is distinct from music and reports browser playback state", () => {
  assert.match(app, /Remote\.createBridge/);
  assert.match(app, /function captureRendererState\(\)/);
  assert.match(app, /playing: !nodes\.media\.paused/);
  assert.match(app, /function applyRendererCommand\(command\)/);
  assert.match(app, /if \(nextId\) root\.showTab\?\.\("video"\)/);
  assert.match(app, /Command Center PC/);
});

test("host-only settings stay disabled while LAN clients retain playback", () => {
  assert.match(app, /You can browse and play this library here\./);
  assert.match(app, /browse\.disabled = !state\.editable/);
  assert.match(app, /save\.disabled = !state\.editable/);
  assert.match(app, /rescan\.disabled = !state\.editable/);
});
