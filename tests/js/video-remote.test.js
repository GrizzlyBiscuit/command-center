const assert = require("node:assert/strict");
const test = require("node:test");

const Remote = require("../../frontend/static/video/video-remote.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("normalizes bounded, path-free video renderer state", () => {
  const state = Remote.normalizePlaybackState({
    renderer_online: true,
    epoch: "server-one",
    revision: 4,
    state: {
      queue: ["opaque-a", "opaque-b", ""],
      queue_index: 99,
      playing: true,
      position: 500,
      duration: 240,
      volume: 9,
      path: "C:\\private\\movie.mp4",
    },
  }, 1000);
  assert.equal(state.rendererOnline, true);
  assert.deepEqual(state.queue, ["opaque-a", "opaque-b"]);
  assert.equal(state.index, 1);
  assert.equal(state.position, 240);
  assert.equal(state.volume, 1);
  assert.equal(state.path, undefined);
});

test("bounds large video queues around the selected item", () => {
  const ids = Array.from({ length: Remote.MAX_QUEUE_VIDEOS + 20 }, (_, index) => "video-" + index);
  const bounded = Remote.boundQueueState(ids, ids.length - 2);
  assert.equal(bounded.queue.length, Remote.MAX_QUEUE_VIDEOS);
  assert.equal(bounded.queue[bounded.index], ids.at(-2));
  assert.ok(bounded.queue.includes(ids.at(-1)));
});

test("filters unknown IDs without losing a duplicate selected position", () => {
  const filtered = Remote.filterQueueState(
    ["same", "missing", "same"],
    2,
    id => id === "same",
  );
  assert.deepEqual(filtered.queue, ["same", "same"]);
  assert.equal(filtered.index, 1);
});

test("queue deltas reuse only the matching epoch and queue revision", () => {
  const initial = Remote.normalizePlaybackState({
    epoch: "epoch-a",
    queue_revision: 3,
    state: { queue: ["a", "b"], index: 0 },
  }, 1000);
  const delta = Remote.normalizePlaybackState({
    epoch: "epoch-a",
    queue_revision: 3,
    state: { index: 1, playing: true },
  }, 2000, initial);
  assert.deepEqual(delta.queue, ["a", "b"]);
  assert.equal(delta.index, 1);
  const restarted = Remote.normalizePlaybackState({
    epoch: "epoch-b",
    queue_revision: 3,
    state: { index: 1 },
  }, 3000, delta);
  assert.deepEqual(restarted.queue, []);
});

test("output target is stored separately from music playback", () => {
  const storage = memoryStorage();
  assert.equal(Remote.loadOutput(storage), Remote.OUTPUT_DEVICE);
  Remote.saveOutput(storage, Remote.OUTPUT_COMPUTER);
  assert.equal(Remote.loadOutput(storage), Remote.OUTPUT_COMPUTER);
  assert.equal(Remote.OUTPUT_KEY, "cc.video.output.v1");
  assert.equal(Remote.RENDERER_KEY, "cc.video.renderer.v1");
});

test("projects PC position only while remote video is playing", () => {
  const playing = Remote.normalizePlaybackState({
    state: { playing: true, position: 10, duration: 20 },
  }, 1000);
  const paused = Remote.normalizePlaybackState({
    state: { playing: false, position: 10, duration: 20 },
  }, 1000);
  assert.equal(Remote.projectedPosition(playing, 4500), 13.5);
  assert.equal(Remote.projectedPosition(paused, 4500), 10);
});

test("controller commands use video endpoints and require the PC target", async () => {
  const calls = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage(),
    request: async (url, options) => {
      calls.push({ url, options });
      return { renderer_online: true, epoch: "e1", state: {} };
    },
  });
  await assert.rejects(() => bridge.command("play"), /not the selected/);
  bridge.setTarget(Remote.OUTPUT_COMPUTER);
  await bridge.command("seek", { position: 42 });
  assert.equal(calls[0].url, "/api/video/remote/command");
  assert.deepEqual(calls[0].options.body, { action: "seek", position: 42 });
});

test("leaving PC video output serializes a final pause", async () => {
  const calls = [];
  const releases = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    request: (_url, options) => new Promise(resolve => {
      calls.push(options.body.action);
      releases.push(resolve);
    }),
  });
  const play = bridge.command("play");
  await Promise.resolve();
  const leaving = bridge.pauseAndUseDevice();
  releases.shift()({ accepted: true });
  await play;
  await Promise.resolve();
  assert.deepEqual(calls, ["play", "pause"]);
  releases.shift()({ accepted: true });
  await leaving;
  assert.equal(bridge.getTarget(), Remote.OUTPUT_DEVICE);
});

test("renderer heartbeats report the queue only when it changes", async () => {
  const scheduled = [];
  const bodies = [];
  const host = {
    pywebview: { api: {} },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    crypto: { randomUUID: () => "12345678-1234-4123-a123-123456789abc" },
    addEventListener() {},
    removeEventListener() {},
  };
  const bridge = Remote.createBridge({
    host,
    storage: host.localStorage,
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    captureRendererState: () => ({ queue: ["a"], index: 0, playing: false }),
    request: async (_url, options) => {
      bodies.push(options.body);
      return {
        renderer: true,
        renderer_online: true,
        epoch: "epoch-a",
        revision: bodies.length,
        queue_revision: 1,
        ack: 0,
        state: { index: 0 },
        commands: [],
      };
    },
  });
  bridge.start();
  await scheduled.shift()();
  await scheduled.shift()();
  await scheduled.shift()();
  bridge.stop();
  assert.deepEqual(bodies[0].state.queue, ["a"]);
  assert.deepEqual(bodies[1].state.queue, ["a"]);
  assert.equal(bodies[2].state.queue, undefined);
});
