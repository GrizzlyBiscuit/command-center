/* Command Center music remote bridge. Copyright (c) 2026 sagan246. MIT. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMusicRemote = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const OUTPUT_KEY = "cc.music.output.v1";
  const RENDERER_KEY = "cc.music.renderer.v1";
  const OUTPUT_DEVICE = "device";
  const OUTPUT_COMPUTER = "computer";
  const MAX_QUEUE_TRACKS = 2000;
  const REPEAT_MODES = new Set(["off", "all", "one"]);
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function boundQueueState(values, requestedIndex = -1, limit = MAX_QUEUE_TRACKS) {
    const queue = (Array.isArray(values) ? values : [])
      .map(value => String(value || "").trim())
      .filter(Boolean);
    const maximum = Math.max(1, Math.trunc(finite(limit, MAX_QUEUE_TRACKS)));
    const unclampedIndex = Math.trunc(finite(requestedIndex, -1));
    const index = queue.length && unclampedIndex >= 0
      ? Math.max(0, Math.min(queue.length - 1, unclampedIndex))
      : -1;
    if (queue.length <= maximum) return { queue, index };
    const start = index < 0 ? 0 : Math.min(
      Math.max(0, index - Math.floor(maximum / 2)),
      queue.length - maximum,
    );
    return { queue: queue.slice(start, start + maximum), index: index < 0 ? -1 : index - start };
  }

  function sameQueue(left, right) {
    if (left === right) return true;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  function filterQueueState(values, requestedIndex, isKnown = () => true) {
    const source = (Array.isArray(values) ? values : [])
      .map(value => String(value || "").trim());
    const numericIndex = Math.trunc(finite(requestedIndex, -1));
    const selectedPosition = source.length && numericIndex >= 0
      ? Math.min(source.length - 1, numericIndex)
      : -1;
    const queue = [];
    let index = -1;
    source.forEach((id, position) => {
      if (!id || !isKnown(id)) return;
      if (position === selectedPosition) index = queue.length;
      queue.push(id);
    });
    return { queue, index, sourceLength: source.length };
  }

  function normalizePlaybackState(payload, now = Date.now(), previous = null) {
    const envelope = payload && typeof payload === "object" ? payload : {};
    const nested = envelope.state && typeof envelope.state === "object"
      ? envelope.state
      : envelope.status && typeof envelope.status === "object"
        ? envelope.status
        : {};
    const epoch = String(envelope.epoch || "");
    const queueRevision = Math.max(0, Math.trunc(finite(envelope.queue_revision)));
    const canReuseQueue = !Array.isArray(nested.queue)
      && previous
      && previous.epoch === epoch
      && previous.queueRevision === queueRevision;
    const requestedIndex = nested.index ?? nested.queue_index ?? (canReuseQueue ? previous.index : -1);
    const bounded = boundQueueState(canReuseQueue ? previous.queue : nested.queue, requestedIndex);
    const duration = Math.max(0, finite(nested.duration));
    const position = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, finite(nested.position)));
    const repeat = String(nested.repeat || "off").toLowerCase();
    return Object.freeze({
      rendererOnline: Boolean(envelope.renderer_online ?? envelope.online),
      epoch,
      revision: Math.max(0, Math.trunc(finite(envelope.revision))),
      queueRevision,
      ack: Math.max(0, Math.trunc(finite(envelope.ack))),
      queue: bounded.queue,
      index: bounded.index,
      playing: nested.playing === true,
      position,
      duration,
      volume: Math.max(0, Math.min(1, finite(nested.volume, 0.8))),
      repeat: REPEAT_MODES.has(repeat) ? repeat : "off",
      shuffle: nested.shuffle === true,
      error: String(nested.error || "").slice(0, 240),
      receivedAt: finite(now, Date.now()),
    });
  }

  function projectedPosition(snapshot, now = Date.now()) {
    if (!snapshot || !snapshot.playing) return Math.max(0, finite(snapshot?.position));
    const elapsed = Math.max(0, (finite(now) - finite(snapshot.receivedAt, now)) / 1000);
    const limit = finite(snapshot.duration) > 0 ? snapshot.duration : Number.MAX_SAFE_INTEGER;
    return Math.min(limit, Math.max(0, finite(snapshot.position) + elapsed));
  }

  function loadOutput(storage) {
    try {
      return storage?.getItem(OUTPUT_KEY) === OUTPUT_COMPUTER ? OUTPUT_COMPUTER : OUTPUT_DEVICE;
    } catch {
      return OUTPUT_DEVICE;
    }
  }

  function saveOutput(storage, value) {
    try { storage?.setItem(OUTPUT_KEY, value); } catch {}
  }

  function makeRendererId(cryptoObject) {
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return cryptoObject.randomUUID();
    }
    const random = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    return `${random()}${random()}-${random()}-4${random().slice(1)}-a${random().slice(1)}-${random()}${random()}${random()}`;
  }

  function loadRendererId(storage, cryptoObject) {
    try {
      const existing = String(storage?.getItem(RENDERER_KEY) || "").trim();
      if (UUID_PATTERN.test(existing)) return existing;
    } catch {}
    const created = makeRendererId(cryptoObject);
    try { storage?.setItem(RENDERER_KEY, created); } catch {}
    return created;
  }

  function createBridge(options = {}) {
    if (typeof options.request !== "function") throw new TypeError("request is required");
    const host = options.host || (typeof window !== "undefined" ? window : globalThis);
    const schedule = options.setTimeout || host.setTimeout?.bind(host) || setTimeout;
    const unschedule = options.clearTimeout || host.clearTimeout?.bind(host) || clearTimeout;
    const storage = options.storage || host.localStorage;
    const rendererId = loadRendererId(options.rendererStorage || host.sessionStorage, options.crypto || host.crypto);
    const controllerDelay = Math.max(250, finite(options.controllerDelay, 1000));
    const idleControllerDelay = Math.max(controllerDelay, finite(options.idleControllerDelay, 10000));
    const rendererDelay = Math.max(200, finite(options.rendererDelay, 700));
    let target = loadOutput(storage);
    let renderer = false;
    let rendererConnected = false;
    let running = false;
    let inFlight = false;
    let timer = null;
    let epoch = "";
    let acknowledged = 0;
    let refreshGeneration = 0;
    let commandTail = Promise.resolve();
    let awaitingAck = 0;
    let awaitingAckEpoch = "";
    let awaitingAckDeadline = 0;
    let pendingCommands = 0;
    let leavingRemote = false;
    let targetTransition = null;
    let rendererQueueReported = false;
    let reportedRendererQueue = [];
    let snapshot = normalizePlaybackState({});

    function emitState(next) {
      snapshot = next;
      options.onState?.(next);
      return next;
    }

    function ingest(payload) {
      const next = normalizePlaybackState(payload, Date.now(), snapshot);
      if (next.epoch && next.epoch !== epoch) {
        epoch = next.epoch;
        acknowledged = 0;
        rendererQueueReported = false;
      }
      if (snapshot.epoch && next.epoch === snapshot.epoch && next.revision < snapshot.revision) return snapshot;
      return emitState(next);
    }

    function setRendererConnected(value) {
      const next = value === true;
      if (next === rendererConnected) return;
      rendererConnected = next;
      options.onRendererConnectionChange?.(rendererConnected);
    }

    function setTarget(value) {
      const requested = value === OUTPUT_COMPUTER ? OUTPUT_COMPUTER : OUTPUT_DEVICE;
      const next = renderer ? OUTPUT_DEVICE : requested;
      if (next === target) return target;
      const previous = target;
      target = next;
      saveOutput(storage, target);
      options.onTargetChange?.(target, previous);
      if (running && !renderer) scheduleNext(0);
      return target;
    }

    function scheduleNext(delay) {
      if (!running) return;
      if (timer != null) unschedule(timer);
      timer = schedule(tick, delay);
    }

    async function heartbeat() {
      const captured = options.captureRendererState?.() || {};
      const bounded = boundQueueState(captured.queue, captured.index ?? captured.queue_index);
      const rendererState = { ...captured, index: bounded.index };
      if (!rendererQueueReported || !sameQueue(bounded.queue, reportedRendererQueue)) {
        rendererState.queue = bounded.queue;
        reportedRendererQueue = [...bounded.queue];
        rendererQueueReported = true;
      } else {
        delete rendererState.queue;
        delete rendererState.queue_index;
      }
      const payload = {
        renderer_id: rendererId,
        epoch,
        ack: acknowledged,
        state: rendererState,
      };
      const response = await options.request("/api/music/remote/renderer", {
        method: "POST",
        body: payload,
      });
      const responseEpoch = String(response?.epoch || "");
      if (responseEpoch && responseEpoch !== epoch) {
        epoch = responseEpoch;
        acknowledged = 0;
        rendererQueueReported = false;
      }
      const serverAck = Math.max(0, Math.trunc(finite(response?.ack)));
      if (serverAck > acknowledged) acknowledged = serverAck;
      if (response?.renderer === false || response?.claimed === false) {
        throw new Error(response?.error || "Another Command Center PC player is active.");
      }
      const leaseClaimed = response?.lease_claimed === true;
      if (leaseClaimed) rendererQueueReported = false;
      setRendererConnected(true);
      const commands = Array.isArray(response?.commands) ? [...response.commands] : [];
      commands.sort((left, right) => finite(left?.id) - finite(right?.id));
      let appliedAny = false;
      for (const command of commands) {
        const commandId = Math.max(0, Math.trunc(finite(command?.id)));
        if (!commandId || commandId <= acknowledged) continue;
        try {
          await options.applyRendererCommand?.(command);
        } catch (error) {
          options.onRendererError?.(error, command);
        } finally {
          acknowledged = commandId;
          appliedAny = true;
        }
      }
      ingest(response);
      return appliedAny || leaseClaimed;
    }

    async function refresh() {
      const generation = ++refreshGeneration;
      const query = snapshot.epoch
        ? `?epoch=${encodeURIComponent(snapshot.epoch)}&queue_revision=${snapshot.queueRevision}`
        : "";
      const payload = await options.request(`/api/music/remote${query}`);
      if (generation !== refreshGeneration) return snapshot;
      if (pendingCommands > 0) return snapshot;
      const responseEpoch = String(payload?.epoch || "");
      const responseAck = Math.max(0, Math.trunc(finite(payload?.ack)));
      const sameCommandEpoch = !awaitingAckEpoch || responseEpoch === awaitingAckEpoch;
      if (
        awaitingAck > 0
        && payload?.renderer_online === true
        && sameCommandEpoch
        && responseAck < awaitingAck
        && Date.now() < awaitingAckDeadline
      ) {
        return snapshot;
      }
      if (
        awaitingAck > 0
        && (payload?.renderer_online !== true
          || !sameCommandEpoch
          || responseAck >= awaitingAck
          || Date.now() >= awaitingAckDeadline)
      ) {
        awaitingAck = 0;
        awaitingAckEpoch = "";
        awaitingAckDeadline = 0;
      }
      return ingest(payload);
    }

    async function tick() {
      timer = null;
      if (!running || inFlight) return;
      inFlight = true;
      let immediate = false;
      try {
        if (renderer) immediate = await heartbeat();
        else await refresh();
      } catch (error) {
        if (renderer) {
          setRendererConnected(false);
          rendererQueueReported = false;
        }
        options.onError?.(error, { renderer });
        if (!renderer) emitState(normalizePlaybackState({ epoch, renderer_online: false }));
      } finally {
        inFlight = false;
        scheduleNext(immediate ? 0 : renderer
          ? rendererDelay
          : target === OUTPUT_COMPUTER
            ? awaitingAck > 0 ? Math.min(controllerDelay, 300) : controllerDelay
            : idleControllerDelay);
      }
    }

    function enableRenderer() {
      if (renderer) return;
      renderer = true;
      setRendererConnected(false);
      setTarget(OUTPUT_DEVICE);
      options.onRendererChange?.(true);
      scheduleNext(0);
    }

    function onPywebviewReady() {
      enableRenderer();
    }

    function start() {
      if (running) return;
      running = true;
      host.addEventListener?.("pywebviewready", onPywebviewReady);
      if (host.pywebview?.api) enableRenderer();
      else scheduleNext(0);
    }

    function stop() {
      running = false;
      if (timer != null) unschedule(timer);
      timer = null;
      host.removeEventListener?.("pywebviewready", onPywebviewReady);
      setRendererConnected(false);
    }

    function enqueueCommand(payload, { allowLeaving = false } = {}) {
      if (target !== OUTPUT_COMPUTER || renderer || (leavingRemote && !allowLeaving)) {
        return Promise.reject(new Error("Command Center PC is not the selected playback target."));
      }
      // A state read that began before this command cannot describe the
      // resulting playback state, even if its HTTP response arrives first.
      refreshGeneration += 1;
      pendingCommands += 1;
      const execute = async () => {
        try {
          if (target !== OUTPUT_COMPUTER || renderer || (leavingRemote && !allowLeaving)) {
            throw new Error("Command Center PC is not the selected playback target.");
          }
          const response = await options.request("/api/music/remote/command", {
            method: "POST",
            body: payload,
          });
          const commandId = Math.max(0, Math.trunc(finite(response?.command_id)));
          if (commandId > awaitingAck) {
            awaitingAck = commandId;
            awaitingAckEpoch = String(response?.epoch || snapshot.epoch || "");
            awaitingAckDeadline = Date.now() + 16000;
          }
          // The renderer immediately acknowledges and reports after applying the
          // command. Keep the controller's optimistic UI through that round trip.
          scheduleNext(500);
          return response;
        } finally {
          pendingCommands = Math.max(0, pendingCommands - 1);
        }
      };
      const pending = commandTail.then(execute, execute);
      commandTail = pending.catch(() => {});
      return pending;
    }

    function command(action, values = {}) {
      return enqueueCommand({ action, ...values });
    }

    function pauseAndUseDevice() {
      if (renderer || target !== OUTPUT_COMPUTER) {
        setTarget(OUTPUT_DEVICE);
        return Promise.resolve();
      }
      if (targetTransition) return targetTransition;
      leavingRemote = true;
      targetTransition = (async () => {
        try {
          await enqueueCommand({ action: "pause" }, { allowLeaving: true });
        } finally {
          setTarget(OUTPUT_DEVICE);
          leavingRemote = false;
          targetTransition = null;
        }
      })();
      return targetTransition;
    }

    return Object.freeze({
      command,
      enableRenderer,
      getSnapshot: () => snapshot,
      getTarget: () => target,
      isRenderer: () => renderer,
      isRendererConnected: () => rendererConnected,
      isRemoteTarget: () => target === OUTPUT_COMPUTER && !renderer,
      pauseAndUseDevice,
      refresh,
      setTarget,
      start,
      stop,
    });
  }

  return {
    MAX_QUEUE_TRACKS,
    OUTPUT_COMPUTER,
    OUTPUT_DEVICE,
    OUTPUT_KEY,
    RENDERER_KEY,
    boundQueueState,
    createBridge,
    filterQueueState,
    loadOutput,
    loadRendererId,
    normalizePlaybackState,
    projectedPosition,
    saveOutput,
  };
});
