/* Home dashboard card for the active Command Center media source. */
(function (root, factory) {
  "use strict";
  const media = typeof module === "object" && module.exports
    ? require("./media-session.js")
    : root?.CCMediaSession;
  const api = factory(root, media);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCNowPlaying = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function (root, Media) {
  "use strict";

  let instance = null;

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(finite(value)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function kindLabel(kind) {
    if (kind === "music") return "Music";
    if (kind === "video") return "Video";
    return "Media";
  }

  function viewModel(state, now = Date.now()) {
    if (!state?.active) {
      return Object.freeze({
        active: false,
        source: "",
        kind: "media",
        kindLabel: "Media",
        glyph: "\u266b",
        title: "Nothing playing",
        subtitle: "Start music or a video to control it here.",
        artwork: "",
        playing: false,
        position: 0,
        duration: 0,
        elapsedLabel: "0:00",
        durationLabel: "0:00",
        progress: 0,
        volume: 0.8,
        targetLabel: "Ready",
        openLabel: "Open player",
        canOpen: false,
        canPlayPause: false,
        canPrevious: false,
        canNext: false,
        canSeek: false,
        canVolume: false,
      });
    }
    const duration = Math.max(0, finite(state.duration));
    const rawPosition = Media?.projectedPosition
      ? Media.projectedPosition(state, now)
      : Math.max(0, finite(state.position));
    const position = duration > 0 ? Math.min(duration, rawPosition) : rawPosition;
    const target = state.target && typeof state.target === "object" ? state.target : {};
    const targetLabel = target.online === false
      ? `${target.label || "Playback device"} offline`
      : target.label || "This device";
    const capabilities = state.capabilities || {};
    return Object.freeze({
      active: true,
      source: String(state.source || ""),
      kind: state.kind === "video" ? "video" : state.kind === "music" ? "music" : "media",
      kindLabel: kindLabel(state.kind),
      glyph: state.kind === "video" ? "\u25b6" : "\u266b",
      title: String(state.title || "Untitled media"),
      subtitle: String(state.subtitle || (state.kind === "video" ? "Local video" : "Local music")),
      artwork: String(state.artwork || ""),
      playing: state.playing === true,
      position,
      duration,
      elapsedLabel: formatTime(position),
      durationLabel: formatTime(duration),
      progress: duration > 0 ? Math.round(position / duration * 1000) : 0,
      volume: Math.max(0, Math.min(1, finite(state.volume, 0.8))),
      targetLabel,
      openLabel: `Open ${kindLabel(state.kind)}`,
      canOpen: state.source === "music" || state.source === "video",
      canPlayPause: capabilities.playPause === true,
      canPrevious: capabilities.previous === true,
      canNext: capabilities.next === true,
      canSeek: capabilities.seek === true && duration > 0,
      canVolume: capabilities.volume === true,
    });
  }

  function nodesFor(document) {
    const byId = id => document.getElementById(id);
    return {
      card: byId("cc-now-playing-card"),
      heading: byId("cc-now-playing-heading"),
      kind: byId("cc-now-playing-kind"),
      target: byId("cc-now-playing-target"),
      open: byId("cc-now-playing-open"),
      artwork: byId("cc-now-playing-artwork"),
      glyph: byId("cc-now-playing-glyph"),
      title: byId("cc-now-playing-title"),
      subtitle: byId("cc-now-playing-subtitle"),
      previous: byId("cc-now-playing-previous"),
      play: byId("cc-now-playing-play"),
      next: byId("cc-now-playing-next"),
      elapsed: byId("cc-now-playing-elapsed"),
      progress: byId("cc-now-playing-progress"),
      duration: byId("cc-now-playing-duration"),
      volume: byId("cc-now-playing-volume"),
    };
  }

  function render(nodes, state, now = Date.now(), activeElement = null) {
    if (!nodes?.card) return null;
    const view = viewModel(state, now);
    nodes.card.dataset.state = !view.active ? "empty" : view.playing ? "playing" : "paused";
    nodes.card.dataset.kind = view.kind;
    nodes.card.dataset.source = view.source;
    if (nodes.heading) nodes.heading.textContent = view.kindLabel;
    if (nodes.kind) nodes.kind.textContent = view.kindLabel;
    if (nodes.target) nodes.target.textContent = view.targetLabel;
    if (nodes.open) {
      nodes.open.textContent = view.openLabel;
      nodes.open.disabled = !view.canOpen;
    }
    if (nodes.title) nodes.title.textContent = view.title;
    if (nodes.subtitle) nodes.subtitle.textContent = view.subtitle;
    if (nodes.glyph) {
      nodes.glyph.textContent = view.glyph;
      nodes.glyph.hidden = Boolean(view.artwork);
    }
    if (nodes.artwork) {
      if (view.artwork) {
        if (nodes.artwork.getAttribute("src") !== view.artwork) nodes.artwork.src = view.artwork;
        nodes.artwork.hidden = false;
      } else {
        nodes.artwork.removeAttribute("src");
        nodes.artwork.hidden = true;
      }
    }
    if (nodes.play) {
      nodes.play.textContent = view.playing ? "\u23f8" : "\u25b6";
      nodes.play.setAttribute("aria-label", view.playing ? `Pause ${view.kindLabel.toLowerCase()}` : `Play ${view.kindLabel.toLowerCase()}`);
      nodes.play.setAttribute("aria-pressed", view.playing ? "true" : "false");
      nodes.play.disabled = !view.canPlayPause;
    }
    if (nodes.previous) nodes.previous.disabled = !view.canPrevious;
    if (nodes.next) nodes.next.disabled = !view.canNext;
    if (nodes.progress && activeElement !== nodes.progress) nodes.progress.value = String(view.progress);
    if (nodes.progress) {
      nodes.progress.disabled = !view.canSeek;
      nodes.progress.setAttribute("aria-valuetext", `${view.elapsedLabel} of ${view.durationLabel}`);
    }
    if (nodes.elapsed) nodes.elapsed.textContent = view.elapsedLabel;
    if (nodes.duration) nodes.duration.textContent = view.durationLabel;
    if (nodes.volume && activeElement !== nodes.volume) nodes.volume.value = String(view.volume);
    if (nodes.volume) nodes.volume.disabled = !view.canVolume;
    return view;
  }

  function createCard(options = {}) {
    if (!Media) return null;
    const host = options.host || root;
    const document = options.document || host?.document;
    if (!document) return null;
    const nodes = nodesFor(document);
    if (!nodes.card) return null;
    let state = Media.snapshot(host);
    let destroyed = false;

    const draw = (now = Date.now()) => render(nodes, state, now, document.activeElement);
    const send = (action, value) => {
      if (!state?.active) return null;
      return Media.command(host, { source: state.source, action, value });
    };
    const onPlay = () => send(state?.playing ? "pause" : "play");
    const onPrevious = () => send("previous");
    const onNext = () => send("next");
    const onOpen = () => {
      if (state?.active && (state.source === "music" || state.source === "video")) {
        host.showTab?.(state.source);
      }
    };
    const onProgressInput = () => {
      if (!state?.duration || !nodes.elapsed) return;
      nodes.elapsed.textContent = formatTime(Number(nodes.progress.value) / 1000 * state.duration);
    };
    const onProgressChange = () => {
      if (!state?.duration) return;
      send("seek", Number(nodes.progress.value) / 1000 * state.duration);
    };
    const onVolumeChange = () => send("volume", Number(nodes.volume.value));
    const onArtworkError = () => {
      nodes.artwork.hidden = true;
      if (nodes.glyph) nodes.glyph.hidden = false;
    };

    nodes.play?.addEventListener("click", onPlay);
    nodes.previous?.addEventListener("click", onPrevious);
    nodes.next?.addEventListener("click", onNext);
    nodes.open?.addEventListener("click", onOpen);
    nodes.progress?.addEventListener("input", onProgressInput);
    nodes.progress?.addEventListener("change", onProgressChange);
    nodes.volume?.addEventListener("change", onVolumeChange);
    nodes.artwork?.addEventListener("error", onArtworkError);

    const unsubscribe = Media.subscribe(host, next => {
      state = next;
      draw();
    }, { immediate: false });
    const schedule = options.setInterval || host?.setInterval?.bind(host) || setInterval;
    const unschedule = options.clearInterval || host?.clearInterval?.bind(host) || clearInterval;
    const timer = schedule(() => {
      if (!destroyed && state?.playing && document.activeElement !== nodes.progress) draw();
    }, 1000);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unschedule(timer);
      nodes.play?.removeEventListener("click", onPlay);
      nodes.previous?.removeEventListener("click", onPrevious);
      nodes.next?.removeEventListener("click", onNext);
      nodes.open?.removeEventListener("click", onOpen);
      nodes.progress?.removeEventListener("input", onProgressInput);
      nodes.progress?.removeEventListener("change", onProgressChange);
      nodes.volume?.removeEventListener("change", onVolumeChange);
      nodes.artwork?.removeEventListener("error", onArtworkError);
    }

    draw();
    return Object.freeze({ destroy, render: draw, state: () => state });
  }

  function mount(options = {}) {
    if (instance) return instance;
    instance = createCard(options);
    return instance;
  }

  if (root?.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
    } else {
      mount();
    }
  }

  return { createCard, formatTime, kindLabel, mount, render, viewModel };
});
