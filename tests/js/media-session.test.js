const assert = require("node:assert/strict");
const test = require("node:test");

const Media = require("../../frontend/static/media/media-session.js");

class FakeHost {
  constructor() {
    this.listeners = new Map();
    this.CustomEvent = class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

test("normalizes the path-free shared playback shape", () => {
  const state = Media.normalizeState({
    source: "MUSIC",
    kind: "music",
    itemId: "opaque-track-id",
    title: "Night Drive",
    subtitle: "Neon Artist",
    artwork: "javascript:alert(1)",
    playing: true,
    position: 900,
    duration: 240,
    volume: 8,
    target: "computer",
    rendererOnline: false,
    capabilities: { previous: true, next: true },
    path: "C:\\private\\track.mp3",
  }, 1000);

  assert.equal(state.source, "music");
  assert.equal(state.itemId, "opaque-track-id");
  assert.equal(state.position, 240);
  assert.equal(state.volume, 1);
  assert.equal(state.artwork, "");
  assert.deepEqual(state.target, { id: "computer", label: "Command Center PC", online: false });
  assert.equal(state.capabilities.previous, true);
  assert.equal(state.path, undefined);
  assert.throws(() => Media.normalizeState({ source: "../music" }), /valid media source/);
});

test("the most recently claimed source stays active through routine updates", () => {
  const host = new FakeHost();
  Media.publish(host, { source: "music", title: "Song", active: true });
  Media.publish(host, { source: "video", title: "Film", active: true });
  assert.equal(Media.activeSource(host), "video");

  Media.publish(host, { source: "music", title: "Song", active: true, position: 12 });
  assert.equal(Media.activeSource(host), "video");

  Media.publish(host, { source: "music", title: "Different song", active: true });
  assert.equal(Media.activeSource(host), "music");
  Media.publish(host, { source: "video", title: "Film", active: true, claim: true });
  assert.equal(Media.activeSource(host), "video");
});

test("starting another source requests a pause from the previous player", () => {
  const host = new FakeHost();
  const commands = [];
  Media.onCommand(host, "music", command => commands.push(command));
  Media.publish(host, { source: "music", title: "Song", active: true, playing: true });
  Media.publish(host, { source: "video", title: "Film", active: true, playing: false });
  assert.equal(commands.length, 0);

  Media.publish(host, { source: "video", title: "Film", active: true, playing: true });
  assert.equal(Media.activeSource(host), "video");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].source, "music");
  assert.equal(commands[0].action, "pause");
});

test("active commands route only to the selected source and normalize toggle", () => {
  const host = new FakeHost();
  const musicCommands = [];
  const videoCommands = [];
  Media.onCommand(host, "music", command => musicCommands.push(command));
  Media.onCommand(host, "video", command => videoCommands.push(command));
  assert.equal(Media.commandActive("toggle", undefined, host), null);

  Media.publish(host, {
    source: "video",
    title: "Film",
    active: true,
    playing: false,
    capabilities: { playPause: true, previous: false, next: true },
  });
  assert.equal(Media.commandActive("toggle", undefined, host).action, "play");
  assert.equal(Media.commandActive("previous", undefined, host), null);
  assert.equal(Media.commandActive("next", undefined, host).action, "next");
  assert.equal(musicCommands.length, 0);
  assert.deepEqual(videoCommands.map(command => command.action), ["play", "next"]);

  Media.publish(host, {
    source: "video",
    title: "Film",
    active: true,
    playing: true,
    capabilities: { playPause: true },
  });
  assert.equal(Media.commandActive("toggle", undefined, host).action, "pause");
});

test("state subscriptions receive the current snapshot and can unsubscribe", () => {
  const host = new FakeHost();
  const seen = [];
  const unsubscribe = Media.subscribe(host, state => seen.push(state?.title || "empty"));
  Media.publish(host, { source: "music", title: "One", active: true });
  unsubscribe();
  Media.publish(host, { source: "music", title: "Two", active: true });
  assert.deepEqual(seen, ["empty", "One"]);
});

test("projects progress only while playback is running", () => {
  const paused = Media.normalizeState({
    source: "music", title: "Song", playing: false, position: 10, duration: 30,
  }, 1000);
  const playing = Media.normalizeState({
    source: "music", title: "Song", playing: true, position: 10, duration: 30,
  }, 1000);
  assert.equal(Media.projectedPosition(paused, 6000), 10);
  assert.equal(Media.projectedPosition(playing, 6000), 15);
  assert.equal(Media.projectedPosition(playing, 999000), 30);
});
