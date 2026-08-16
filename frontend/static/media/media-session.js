/* Shared, local-only playback state contract for Command Center media views. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMediaSession = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (defaultHost) {
  "use strict";

  const STATE_EVENT = "cc:media-state";
  const COMMAND_EVENT = "cc:media-command";
  const VALID_SOURCE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  const VALID_ACTIONS = new Set(["play", "pause", "toggle", "previous", "next", "seek", "volume"]);
  const registries = new WeakMap();

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function boundedText(value, fallback = "", maximum = 180) {
    return String(value == null ? fallback : value).trim().slice(0, maximum);
  }

  function sourceName(value) {
    const source = boundedText(value, "", 32).toLowerCase();
    if (!VALID_SOURCE.test(source)) throw new TypeError("A valid media source is required.");
    return source;
  }

  function safeArtwork(value) {
    const source = boundedText(value, "", 2048);
    if (!source) return "";
    return /^(?:https?:|blob:|data:image\/|\/(?!\/)|\.\.?\/)/i.test(source) ? source : "";
  }

  function normalizeTarget(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const targetValue = typeof source.target === "object" ? source.target : null;
    const id = boundedText(
      targetValue ? targetValue.id : source.target || source.output || "device",
      "device",
      32,
    ).toLowerCase();
    const fallbackLabel = id === "computer"
      ? "Command Center PC"
      : id === "device"
        ? "This device"
        : id.replace(/[-_]+/g, " ");
    const label = boundedText(targetValue?.label || source.targetLabel, fallbackLabel, 80);
    const onlineValue = targetValue?.online ?? source.targetOnline ?? source.rendererOnline;
    return Object.freeze({
      id,
      label,
      online: onlineValue == null ? null : onlineValue === true,
    });
  }

  function normalizeCapabilities(raw, active, duration) {
    const values = raw && typeof raw === "object" ? raw : {};
    const read = (name, fallback) => values[name] == null ? fallback : values[name] === true;
    return Object.freeze({
      playPause: read("playPause", active),
      previous: read("previous", false),
      next: read("next", false),
      seek: read("seek", active && duration > 0),
      volume: read("volume", active),
    });
  }

  function normalizeState(raw, now = Date.now()) {
    const sourceValue = raw && typeof raw === "object" ? raw : {};
    const source = sourceName(sourceValue.source || sourceValue.kind);
    const title = boundedText(sourceValue.title, "", 240);
    const active = sourceValue.active == null ? Boolean(title) : sourceValue.active === true;
    const duration = Math.max(0, finite(sourceValue.duration));
    const rawPosition = Math.max(0, finite(sourceValue.position));
    const position = duration > 0 ? Math.min(duration, rawPosition) : rawPosition;
    const volume = Math.max(0, Math.min(1, finite(sourceValue.volume, 0.8)));
    const kindValue = boundedText(sourceValue.kind || source, source, 24).toLowerCase();
    const kind = kindValue === "video" ? "video" : kindValue === "music" ? "music" : "media";
    return Object.freeze({
      source,
      kind,
      active,
      itemId: boundedText(sourceValue.itemId || sourceValue.id, "", 160),
      title,
      subtitle: boundedText(sourceValue.subtitle || sourceValue.meta, "", 300),
      artwork: safeArtwork(sourceValue.artwork || sourceValue.poster),
      playing: active && sourceValue.playing === true,
      position,
      duration,
      volume,
      target: normalizeTarget(sourceValue),
      capabilities: normalizeCapabilities(sourceValue.capabilities, active, duration),
      observedAt: finite(now, Date.now()),
    });
  }

  function registryFor(host) {
    if (!host || (typeof host !== "object" && typeof host !== "function")) {
      throw new TypeError("An event target is required.");
    }
    let registry = registries.get(host);
    if (!registry) {
      registry = { states: new Map(), sequence: 0, commandSequence: 0, activeSource: "" };
      registries.set(host, registry);
    }
    return registry;
  }

  function orderedStates(registry) {
    return [...registry.states.values()].sort((left, right) => {
      if (left.playing !== right.playing) return left.playing ? -1 : 1;
      return right.sequence - left.sequence;
    });
  }

  function currentState(registry) {
    const owned = registry.states.get(registry.activeSource);
    if (owned?.active) return owned;
    return orderedStates(registry).find(state => state.active) || null;
  }

  function eventFor(host, type, detail) {
    const EventType = host.CustomEvent || (typeof CustomEvent === "function" ? CustomEvent : null);
    return EventType ? new EventType(type, { detail }) : { type, detail };
  }

  function dispatch(host, type, detail) {
    if (typeof host.dispatchEvent !== "function") return false;
    return host.dispatchEvent(eventFor(host, type, detail));
  }

  function stateDetail(registry, changed = null, clearedSource = "") {
    return Object.freeze({
      current: currentState(registry),
      changed,
      clearedSource,
      states: Object.freeze(orderedStates(registry)),
    });
  }

  function publish(host, raw) {
    const registry = registryFor(host);
    const normalized = normalizeState(raw);
    const previousSourceState = registry.states.get(normalized.source) || null;
    const otherPlayingSources = orderedStates(registry)
      .filter(previous => previous.playing && previous.source !== normalized.source)
      .map(previous => previous.source);
    const state = Object.freeze({ ...normalized, sequence: ++registry.sequence });
    registry.states.set(state.source, state);
    const identityChanged = previousSourceState
      && (previousSourceState.itemId !== state.itemId
        || previousSourceState.title !== state.title
        || previousSourceState.subtitle !== state.subtitle
        || previousSourceState.artwork !== state.artwork);
    const beganPlaying = state.playing && !previousSourceState?.playing;
    const claimed = state.active && (
      raw?.claim === true
      || !previousSourceState?.active
      || identityChanged
      || beganPlaying
      || !registry.activeSource
    );
    if (claimed) registry.activeSource = state.source;
    dispatch(host, STATE_EVENT, stateDetail(registry, state));
    // A newly-started source owns playback. Ask the prior player to pause so
    // music and video cannot continue over one another.
    if (beganPlaying) {
      otherPlayingSources.forEach(source => command(host, { source, action: "pause" }));
    }
    return state;
  }

  function clear(host, sourceValue) {
    const registry = registryFor(host);
    const source = sourceName(sourceValue);
    const removed = registry.states.delete(source);
    if (registry.activeSource === source) {
      registry.activeSource = orderedStates(registry).find(state => state.active)?.source || "";
    }
    if (removed) dispatch(host, STATE_EVENT, stateDetail(registry, null, source));
    return removed;
  }

  function snapshot(host) {
    return currentState(registryFor(host || defaultHost));
  }

  function states(host) {
    return Object.freeze(orderedStates(registryFor(host || defaultHost)));
  }

  function activeSource(host) {
    return snapshot(host || defaultHost)?.source || "";
  }

  function subscribe(host, listener, options = {}) {
    if (typeof listener !== "function") throw new TypeError("A state listener is required.");
    const handler = event => listener(event?.detail?.current || null, event?.detail || {});
    host.addEventListener?.(STATE_EVENT, handler);
    if (options.immediate !== false) listener(snapshot(host), stateDetail(registryFor(host)));
    return () => host.removeEventListener?.(STATE_EVENT, handler);
  }

  function normalizeCommand(raw, registry) {
    const values = raw && typeof raw === "object" ? raw : {};
    const source = sourceName(values.source);
    let action = boundedText(values.action, "", 24).toLowerCase();
    if (!VALID_ACTIONS.has(action)) throw new TypeError(`Unsupported media command: ${action || "unknown"}`);
    if (action === "toggle") action = registry.states.get(source)?.playing ? "pause" : "play";
    let value = values.value;
    if (action === "seek") value = Math.max(0, finite(value));
    else if (action === "volume") value = Math.max(0, Math.min(1, finite(value)));
    else value = undefined;
    return Object.freeze({
      id: ++registry.commandSequence,
      source,
      action,
      value,
    });
  }

  function command(host, raw) {
    const registry = registryFor(host);
    const detail = normalizeCommand(raw, registry);
    dispatch(host, COMMAND_EVENT, detail);
    return detail;
  }

  function commandActive(action, value, host = defaultHost) {
    const active = snapshot(host);
    if (!active) return null;
    const requested = boundedText(action, "", 24).toLowerCase();
    const capability = requested === "toggle" || requested === "play" || requested === "pause"
      ? "playPause"
      : requested;
    if (Object.hasOwn(active.capabilities, capability) && !active.capabilities[capability]) return null;
    return command(host, { source: active.source, action: requested, value });
  }

  function onCommand(host, sourceValue, listener) {
    const source = sourceName(sourceValue);
    if (typeof listener !== "function") throw new TypeError("A command listener is required.");
    const handler = event => {
      const detail = event?.detail;
      if (detail?.source === source) listener(detail);
    };
    host.addEventListener?.(COMMAND_EVENT, handler);
    return () => host.removeEventListener?.(COMMAND_EVENT, handler);
  }

  function createPublisher(host, sourceValue) {
    const source = sourceName(sourceValue);
    return Object.freeze({
      clear: () => clear(host, source),
      onCommand: listener => onCommand(host, source, listener),
      publish: state => publish(host, { ...(state || {}), source }),
    });
  }

  function projectedPosition(state, now = Date.now()) {
    if (!state) return 0;
    const base = Math.max(0, finite(state.position));
    if (!state.playing) return base;
    const elapsed = Math.max(0, (finite(now) - finite(state.observedAt, now)) / 1000);
    const projected = base + elapsed;
    return finite(state.duration) > 0 ? Math.min(state.duration, projected) : projected;
  }

  return {
    COMMAND_EVENT,
    STATE_EVENT,
    VALID_ACTIONS,
    activeSource,
    clear,
    command,
    commandActive,
    createPublisher,
    normalizeState,
    onCommand,
    projectedPosition,
    publish,
    snapshot,
    states,
    subscribe,
  };
});
