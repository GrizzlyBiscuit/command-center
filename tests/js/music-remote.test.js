const assert = require("node:assert/strict");
const test = require("node:test");

const Remote = require("../../frontend/static/music/music-remote.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("normalizes bounded, path-free renderer state", () => {
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
      repeat: "ONE",
      shuffle: true,
      path: "C:\\private\\song.mp3",
    },
  }, 1000);
  assert.equal(state.rendererOnline, true);
  assert.deepEqual(state.queue, ["opaque-a", "opaque-b"]);
  assert.equal(state.index, 1);
  assert.equal(state.position, 240);
  assert.equal(state.volume, 1);
  assert.equal(state.repeat, "one");
  assert.equal(state.path, undefined);
});

test("bounds large queues around the selected track", () => {
  const ids = Array.from({ length: Remote.MAX_QUEUE_TRACKS + 25 }, (_, index) => `track-${index}`);
  const bounded = Remote.boundQueueState(ids, ids.length - 3);
  assert.equal(bounded.queue.length, Remote.MAX_QUEUE_TRACKS);
  assert.equal(bounded.queue[bounded.index], ids.at(-3));
  assert.ok(bounded.queue.includes(ids.at(-1)));
  assert.equal(Remote.boundQueueState(ids, -1).index, -1);
});

test("filters queue state by source position so duplicate tracks keep their index", () => {
  const filtered = Remote.filterQueueState(
    ["same", "missing", "same"],
    2,
    id => id === "same",
  );
  assert.deepEqual(filtered.queue, ["same", "same"]);
  assert.equal(filtered.index, 1);
});

test("queue deltas preserve only the matching epoch and queue revision", () => {
  const initial = Remote.normalizePlaybackState({
    epoch: "epoch-a",
    queue_revision: 3,
    state: { queue: ["a", "b"], index: 0, playing: false },
  }, 1000);
  const delta = Remote.normalizePlaybackState({
    epoch: "epoch-a",
    queue_revision: 3,
    state: { index: 1, playing: true },
  }, 2000, initial);
  assert.deepEqual(delta.queue, ["a", "b"]);
  assert.equal(delta.index, 1);

  const mismatchedRevision = Remote.normalizePlaybackState({
    epoch: "epoch-a",
    queue_revision: 4,
    state: { index: 1 },
  }, 3000, delta);
  assert.deepEqual(mismatchedRevision.queue, []);
  const restarted = Remote.normalizePlaybackState({
    epoch: "epoch-b",
    queue_revision: 3,
    state: { index: 1 },
  }, 4000, delta);
  assert.deepEqual(restarted.queue, []);
});

test("output selection defaults safely to this device and persists explicitly", () => {
  const storage = memoryStorage();
  assert.equal(Remote.loadOutput(storage), Remote.OUTPUT_DEVICE);
  Remote.saveOutput(storage, Remote.OUTPUT_COMPUTER);
  assert.equal(Remote.loadOutput(storage), Remote.OUTPUT_COMPUTER);
  Remote.saveOutput(storage, "surprise-speaker");
  assert.equal(Remote.loadOutput(storage), Remote.OUTPUT_DEVICE);
});

test("renderer identity survives reloads in the same window session", () => {
  const storage = memoryStorage();
  const first = Remote.loadRendererId(storage, {
    randomUUID: () => "12345678-1234-4123-a123-123456789abc",
  });
  const second = Remote.loadRendererId(storage, {
    randomUUID: () => "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });
  assert.equal(first, "12345678-1234-4123-a123-123456789abc");
  assert.equal(second, first);
});

test("projects remote progress only while the PC reports playing", () => {
  const playing = Remote.normalizePlaybackState({
    state: { playing: true, position: 10, duration: 20 },
  }, 1000);
  const paused = Remote.normalizePlaybackState({
    state: { playing: false, position: 10, duration: 20 },
  }, 1000);
  assert.equal(Remote.projectedPosition(playing, 4500), 13.5);
  assert.equal(Remote.projectedPosition(playing, 20000), 20);
  assert.equal(Remote.projectedPosition(paused, 4500), 10);
});

test("controller commands require the PC target and use the CSRF-aware request adapter", async () => {
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
  await bridge.command("play");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/music/remote/command");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, { action: "play" });
});

test("controller commands are delivered in invocation order", async () => {
  const calls = [];
  const releases = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    request: (url, options) => new Promise(resolve => {
      calls.push({ url, action: options.body.action });
      releases.push(() => resolve({ accepted: true }));
    }),
  });
  const load = bridge.command("load", { queue: ["a"], index: 0 });
  const pause = bridge.command("pause");
  await Promise.resolve();
  assert.deepEqual(calls.map(call => call.action), ["load"]);
  releases.shift()();
  await load;
  await Promise.resolve();
  assert.deepEqual(calls.map(call => call.action), ["load", "pause"]);
  releases.shift()();
  await pause;
});

test("leaving PC output creates a pause barrier and rejects later PC commands", async () => {
  const calls = [];
  const releases = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    request: (_url, options) => new Promise(resolve => {
      calls.push(options.body.action);
      releases.push(() => resolve({ accepted: true }));
    }),
  });
  const play = bridge.command("play");
  await Promise.resolve();
  const leaving = bridge.pauseAndUseDevice();
  await assert.rejects(() => bridge.command("load", { queue: ["a"], index: 0 }), /not the selected/);
  releases.shift()();
  await play;
  await Promise.resolve();
  assert.deepEqual(calls, ["play", "pause"]);
  releases.shift()();
  await leaving;
  assert.equal(bridge.getTarget(), Remote.OUTPUT_DEVICE);
  assert.deepEqual(calls, ["play", "pause"]);
});

test("stale refreshes cannot overwrite newer remote state", async () => {
  const releases = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage(),
    request: () => new Promise(resolve => releases.push(resolve)),
  });
  const older = bridge.refresh();
  const newer = bridge.refresh();
  releases[1]({ epoch: "epoch-a", revision: 2, queue_revision: 1, state: { queue: ["new"], index: 0 } });
  await newer;
  releases[0]({ epoch: "epoch-a", revision: 1, queue_revision: 1, state: { queue: ["old"], index: 0 } });
  await older;
  assert.equal(bridge.getSnapshot().revision, 2);
  assert.deepEqual(bridge.getSnapshot().queue, ["new"]);
});

test("refreshes started before or during a pending command are ignored", async () => {
  const reads = [];
  let releaseCommand;
  const states = [];
  let firstRead = true;
  const bridge = Remote.createBridge({
    storage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    onState: state => states.push(state),
    request: (url) => {
      if (url === "/api/music/remote/command") {
        return new Promise(resolve => { releaseCommand = resolve; });
      }
      if (firstRead) {
        firstRead = false;
        return Promise.resolve({ epoch: "epoch-a", revision: 1, queue_revision: 1, ack: 0, renderer_online: true, state: { queue: ["base"], index: 0 } });
      }
      return new Promise(resolve => reads.push(resolve));
    },
  });
  await bridge.refresh();
  const beforeCommand = bridge.refresh();
  const command = bridge.command("play");
  await Promise.resolve();
  const duringCommand = bridge.refresh();
  reads.shift()({ epoch: "epoch-a", revision: 2, queue_revision: 1, ack: 0, renderer_online: true, state: { queue: ["stale-before"], index: 0 } });
  reads.shift()({ epoch: "epoch-a", revision: 3, queue_revision: 1, ack: 0, renderer_online: true, state: { queue: ["stale-during"], index: 0 } });
  await Promise.all([beforeCommand, duringCommand]);
  assert.equal(states.length, 1);
  assert.deepEqual(bridge.getSnapshot().queue, ["base"]);
  releaseCommand({ accepted: true, command_id: 1, epoch: "epoch-a", ack: 0 });
  await command;
});

test("refresh requests omit an unchanged queue by epoch and revision", async () => {
  const urls = [];
  const bridge = Remote.createBridge({
    storage: memoryStorage(),
    request: async url => {
      urls.push(url);
      return urls.length === 1
        ? { epoch: "epoch-a", revision: 2, queue_revision: 7, state: { queue: ["a"], index: 0 } }
        : { epoch: "epoch-a", revision: 3, queue_revision: 7, state: { index: 0, position: 2 } };
    },
  });
  await bridge.refresh();
  await bridge.refresh();
  assert.equal(urls[0], "/api/music/remote");
  assert.equal(urls[1], "/api/music/remote?epoch=epoch-a&queue_revision=7");
  assert.deepEqual(bridge.getSnapshot().queue, ["a"]);
});

test("controller ignores playback snapshots until its command is acknowledged", async () => {
  let phase = 0;
  const bridge = Remote.createBridge({
    storage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    request: async (url) => {
      if (url === "/api/music/remote/command") {
        return { accepted: true, command_id: 5, epoch: "epoch-a", ack: 4 };
      }
      phase += 1;
      if (phase === 1) {
        return { epoch: "epoch-a", revision: 1, queue_revision: 1, ack: 4, renderer_online: true, state: { queue: ["old"], index: 0 } };
      }
      if (phase === 2) {
        return { epoch: "epoch-a", revision: 2, queue_revision: 1, ack: 4, renderer_online: true, state: { index: 0, playing: false } };
      }
      return { epoch: "epoch-a", revision: 3, queue_revision: 2, ack: 5, renderer_online: true, state: { queue: ["new"], index: 0, playing: true } };
    },
  });
  await bridge.refresh();
  await bridge.command("load", { queue: ["new"], index: 0 });
  await bridge.refresh();
  assert.deepEqual(bridge.getSnapshot().queue, ["old"]);
  assert.equal(bridge.getSnapshot().revision, 1);
  await bridge.refresh();
  assert.deepEqual(bridge.getSnapshot().queue, ["new"]);
  assert.equal(bridge.getSnapshot().ack, 5);
});

test("renderer heartbeats send the queue only when it changes", async () => {
  const scheduled = [];
  const bodies = [];
  const connections = [];
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
    captureRendererState: () => ({ queue: ["a", "b"], index: 1, playing: false }),
    onRendererConnectionChange: value => connections.push(value),
    request: async (_url, options) => {
      bodies.push(options.body);
      return { renderer: true, renderer_online: true, epoch: "epoch-a", revision: bodies.length, queue_revision: 1, ack: 0, state: { index: 1 }, commands: [] };
    },
  });
  bridge.start();
  await scheduled.shift()();
  await scheduled.shift()();
  await scheduled.shift()();
  bridge.stop();
  assert.deepEqual(bodies[0].state.queue, ["a", "b"]);
  assert.deepEqual(bodies[1].state.queue, ["a", "b"]); // epoch was learned after the first claim
  assert.equal(bodies[2].state.queue, undefined);
  assert.deepEqual(connections, [true, false]);
});

test("same-epoch lease reclaim immediately resends the renderer queue", async () => {
  const scheduled = [];
  const bodies = [];
  let heartbeat = 0;
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
      heartbeat += 1;
      return {
        renderer: true,
        renderer_online: true,
        lease_claimed: heartbeat === 1 || heartbeat === 3,
        epoch: "epoch-a",
        revision: heartbeat,
        queue_revision: heartbeat >= 3 ? 2 : 1,
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
  await scheduled.shift()();
  bridge.stop();
  assert.deepEqual(bodies[0].state.queue, ["a"]);
  assert.deepEqual(bodies[1].state.queue, ["a"]);
  assert.equal(bodies[2].state.queue, undefined);
  assert.deepEqual(bodies[3].state.queue, ["a"]);
});

test("PC renderer resets acknowledgements on server epoch change and applies each command once", async () => {
  const scheduled = [];
  const applied = [];
  let heartbeat = 0;
  const host = {
    pywebview: { api: {} },
    localStorage: memoryStorage({ [Remote.OUTPUT_KEY]: Remote.OUTPUT_COMPUTER }),
    crypto: { randomUUID: () => "12345678-1234-4123-a123-123456789abc" },
    addEventListener() {},
    removeEventListener() {},
  };
  const bridge = Remote.createBridge({
    host,
    storage: host.localStorage,
    setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    captureRendererState: () => ({ queue: [], index: -1 }),
    applyRendererCommand: async command => applied.push(command.id),
    request: async (url, options) => {
      assert.equal(url, "/api/music/remote/renderer");
      heartbeat += 1;
      if (heartbeat === 1) {
        assert.equal(options.body.ack, 0);
        return { renderer: true, renderer_online: true, epoch: "epoch-a", ack: 0, state: {}, commands: [{ id: 1, action: "next" }] };
      }
      if (heartbeat === 2) {
        assert.equal(options.body.ack, 1);
        return { renderer: true, renderer_online: true, epoch: "epoch-a", ack: 1, state: {}, commands: [{ id: 1, action: "next" }] };
      }
      assert.equal(options.body.ack, 1);
      return { renderer: true, renderer_online: true, epoch: "epoch-b", ack: 0, state: {}, commands: [{ id: 1, action: "play" }] };
    },
  });

  bridge.start();
  assert.equal(bridge.isRenderer(), true);
  assert.equal(bridge.getTarget(), Remote.OUTPUT_DEVICE);
  await scheduled.shift()();
  await scheduled.shift()();
  await scheduled.shift()();
  bridge.stop();
  assert.deepEqual(applied, [1, 1]);
});
