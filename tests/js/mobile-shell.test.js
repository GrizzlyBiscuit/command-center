const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const base = fs.readFileSync(path.join(root, "frontend/templates/base.html"), "utf8");
const musicPanel = fs.readFileSync(path.join(root, "frontend/templates/_music_panel.html"), "utf8");
const modernUi = fs.readFileSync(path.join(root, "frontend/static/modern-ui.js"), "utf8");
const modern = fs.readFileSync(path.join(root, "frontend/static/modern.css"), "utf8");
const musicCss = fs.readFileSync(path.join(root, "frontend/static/music/local-player-ui.css"), "utf8");

test("phone shell shows only the navigation button in its compact top area", () => {
  assert.match(base, /id="cc-mobile-menu"[^>]*aria-label="Open navigation"/);
  assert.match(base, /class="workspace-view-copy workspace-heading-copy"/);

  const mobileStart = modern.lastIndexOf("@media (max-width: 680px)");
  const mobile = modern.slice(mobileStart);
  assert.match(mobile, /\.workspace-heading-copy,\s*\.workspace-topbar-side\s*\{\s*display:\s*none;/);
  assert.match(mobile, /\.workspace-topbar,[\s\S]*?min-height:\s*58px;[\s\S]*?background:\s*transparent !important;/);
  assert.match(mobile, /#cc-mobile-menu\s*\{\s*pointer-events:\s*auto;/);
});

test("Music folds the main navigation opener into its phone toolbar", () => {
  assert.match(musicPanel, /class="cc-music-mobile-menu"[^>]*id="cc-music-mobile-menu"[^>]*aria-controls="cc-sidebar"/);
  assert.match(modernUi, /var mobileMenuTriggers = \[mobileMenu, musicMobileMenu\]\.filter\(Boolean\)/);
  assert.match(modernUi, /mobileMenuTriggers\.forEach\(function \(trigger\)/);

  const phone = musicCss.slice(musicCss.indexOf("@media (max-width: 680px)"));
  assert.match(phone, /\.app-shell\[data-current-view="music"\] \.workspace-topbar\s*\{\s*display:\s*none;/);
  assert.match(phone, /\.cc-music \.cc-music-mobile-menu\s*\{\s*display:\s*inline-grid !important;/);
  assert.match(phone, /\.cc-music-views \[data-music-view="stats"\]\s*\{\s*display:\s*none;/);
  assert.match(phone, /\.cc-music-head\s*\{\s*top:\s*0;/);
});
