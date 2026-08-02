/*
 * Command Center local video library.
 * Portions Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 *
 * Load video-domain.js and video-remote.js before this file. The backend
 * contract is rooted at /api/video; only opaque catalog IDs cross the LAN.
 */
(function (root) {
  "use strict";

  const Domain = root.CCVideoDomain;
  const Remote = root.CCVideoRemote;
  const API = Object.freeze({
    settings: "/api/video/settings",
    library: "/api/video/library",
    scan: "/api/video/scan",
    progress: "/api/video/progress",
  });
  const FINISHED_SCAN_STATES = new Set(["complete", "completed", "done", "ready", "success"]);
  const FAILED_SCAN_STATES = new Set(["error", "failed", "cancelled", "canceled"]);
  const ACTIVE_SCAN_STATES = new Set(["queued", "pending", "running", "scanning", "in_progress"]);
  const PROGRESS_SAVE_INTERVAL_MS = 10000;

  let app = null;

  function byId(id) {
    return root.document ? root.document.getElementById(id) : null;
  }

  function element(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function button(label, className, action) {
    const node = element("button", className, label);
    node.type = "button";
    if (action) node.addEventListener("click", action);
    return node;
  }

  function replace(node, ...children) {
    if (node) node.replaceChildren(...children.filter(Boolean));
  }

  function csrfToken() {
    return root.document?.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
    let body = options.body;
    if (body && typeof body !== "string" && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await root.fetch(url, { ...options, headers, body });
    } catch (cause) {
      const error = new Error("Could not reach the local video service.");
      error.cause = cause;
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    let data = null;
    try {
      data = contentType.includes("json") ? await response.json() : await response.text();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data && typeof data === "object" && (data.error || data.message || data.detail);
      const error = new Error(message || "Video service returned " + response.status + ".");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data == null || data === "" ? {} : data;
  }

  function normalizeVideo(raw) {
    const id = Domain.videoId(raw);
    if (id === null) return null;
    const mimeType = String(raw.mime_type || raw.mime || "video/mp4");
    const format = String(raw.format || mimeType.split("/").pop() || "video").replace(/^x-/, "");
    const providedStream = String(raw.stream_url || "");
    return {
      ...raw,
      id,
      title: String(raw.title || raw.name || "Untitled video"),
      folder: String(raw.folder || "(root)"),
      duration: Math.max(0, Number(raw.duration || raw.duration_seconds) || 0),
      byte_size: Math.max(0, Number(raw.byte_size || raw.size) || 0),
      modified_at: String(raw.modified_at || raw.updated_at || ""),
      mime_type: mimeType,
      format,
      stream_url: providedStream.startsWith("/api/video/stream/")
        ? providedStream
        : "/api/video/stream/" + encodeURIComponent(id),
      stable_key: Domain.stableVideoKey(raw),
    };
  }

  function normalizeProgress(raw) {
    const id = Domain.videoId(raw);
    if (id === null) return null;
    const duration = Math.max(0, Number(raw.duration || raw.duration_seconds) || 0);
    return {
      video_id: id,
      title: String(raw.title || "Untitled video"),
      folder: String(raw.folder || "(root)"),
      position: Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, Number(raw.position) || 0)),
      duration,
      completed: raw.completed === true,
      updated_at: String(raw.updated_at || ""),
      stream_url: String(raw.stream_url || ""),
    };
  }

  function libraryPayload(data) {
    const values = Array.isArray(data)
      ? data
      : data?.videos || data?.library?.videos || data?.items || [];
    const recentValues = data?.recent || data?.library?.recent || [];
    return {
      libraryId: String(data?.library_id || data?.library?.id || data?.id || "unconfigured"),
      videos: (Array.isArray(values) ? values : []).map(normalizeVideo).filter(Boolean),
      recent: (Array.isArray(recentValues) ? recentValues : []).map(normalizeProgress).filter(Boolean),
    };
  }

  function settingsPayload(data) {
    const source = data?.settings || data || {};
    return {
      folder: String(source.video_folder || source.folder || ""),
      folderName: String(source.folder_name || ""),
      libraryId: String(source.library_id || data?.library_id || ""),
      scan: source.scan || data?.scan || null,
      editable: source.editable !== false,
    };
  }

  function scanPayload(data) {
    const source = data?.scan || data?.job || data || {};
    return {
      id: source.scan_id || source.job_id || source.id || null,
      status: String(source.status || source.state || "queued").toLocaleLowerCase(),
      message: String(source.message || source.detail || ""),
      scanned: Number(source.scanned || source.files_scanned || source.processed || 0),
      total: Number(source.total || source.files_total || 0),
      pollUrl: source.poll_url || source.status_url || null,
    };
  }

  function createApp() {
    if (!Domain || !Remote || !root.document) return null;
    const nodes = {
      root: byId("cc-video-root"),
      search: byId("cc-video-search"),
      content: byId("cc-video-content"),
      status: byId("cc-video-status"),
      output: byId("cc-video-output"),
      outputStatus: byId("cc-video-output-status"),
      outputWrap: byId("cc-video-output")?.closest(".cc-video-output-wrap"),
      player: byId("cc-video-player"),
      screen: byId("cc-video-screen"),
      media: byId("cc-video-media"),
      placeholder: byId("cc-video-placeholder"),
      placeholderTitle: byId("cc-video-placeholder-title"),
      placeholderNote: byId("cc-video-placeholder-note"),
      nowTitle: byId("cc-video-now-title"),
      nowMeta: byId("cc-video-now-meta"),
      fullscreen: byId("cc-video-fullscreen"),
      previous: byId("cc-video-previous"),
      play: byId("cc-video-play"),
      next: byId("cc-video-next"),
      progress: byId("cc-video-progress"),
      elapsed: byId("cc-video-elapsed"),
      duration: byId("cc-video-duration"),
      volume: byId("cc-video-volume"),
      stop: byId("cc-video-stop"),
    };
    if (!nodes.root || !nodes.content || !nodes.media) return null;

    const state = {
      view: "library",
      query: "",
      loading: true,
      loadError: null,
      folder: "",
      folderName: "",
      editable: true,
      libraryId: "unconfigured",
      videos: [],
      videoById: new Map(),
      progressById: new Map(),
      recent: [],
      recentLoading: false,
      queue: [],
      queueIndex: -1,
      scan: null,
      scanTimer: null,
      remote: Remote.normalizePlaybackState({}),
      rendererError: "",
      lastProgressSaveAt: 0,
      progressTail: Promise.resolve(),
      sourceToken: 0,
      localVideoId: "",
      mediaReadyToken: -1,
      suppressPauseSave: false,
      nativeMetadataKey: "",
      nativePlaybackState: "none",
      sharedCommandUnsubscribe: null,
    };
    let remoteBridge = null;

    function currentVideo() {
      return state.queueIndex >= 0 ? state.videoById.get(state.queue[state.queueIndex]) || null : null;
    }

    function localSourceVideo() {
      return state.localVideoId ? state.videoById.get(state.localVideoId) || null : null;
    }

    function localSourceReady() {
      const video = localSourceVideo();
      return Boolean(
        video
        && video.id === currentVideo()?.id
        && state.mediaReadyToken === state.sourceToken
      );
    }

    function usingRemoteOutput() {
      return Boolean(remoteBridge?.isRemoteTarget());
    }

    function playbackIsPlaying() {
      return usingRemoteOutput() ? state.remote.playing : !nodes.media.paused && !nodes.media.ended;
    }

    function playbackPosition() {
      return usingRemoteOutput()
        ? Remote.projectedPosition(state.remote)
        : Number(nodes.media.currentTime) || 0;
    }

    function playbackDuration() {
      if (usingRemoteOutput()) return state.remote.duration || currentVideo()?.duration || 0;
      return Number.isFinite(nodes.media.duration) ? nodes.media.duration : currentVideo()?.duration || 0;
    }

    function playbackVolume() {
      return usingRemoteOutput() ? state.remote.volume : nodes.media.volume;
    }

    function opaqueVideoId(value) {
      return Domain.videoId(typeof value === "object" ? value : { id: value });
    }

    function setStatus(message, kind = "info") {
      if (!nodes.status) return;
      nodes.status.textContent = message || "";
      nodes.status.dataset.kind = kind;
      nodes.status.hidden = !message;
    }

    function videoMeta(video) {
      if (!video) return "";
      const values = [
        video.folder && video.folder !== "(root)" ? video.folder : "",
        String(video.format || "video").toUpperCase(),
        video.duration > 0 ? Domain.formatTime(video.duration) : "",
        Domain.formatBytes(video.byte_size),
      ].filter(Boolean);
      return values.join(" \u00b7 ");
    }

    function getPlaybackState() {
      const video = currentVideo();
      const target = remoteBridge?.getTarget() || Remote.OUTPUT_DEVICE;
      return Object.freeze({
        source: "video",
        kind: "video",
        active: Boolean(video),
        id: video?.id || null,
        itemId: video?.id || null,
        title: video?.title || "Nothing playing",
        subtitle: video ? videoMeta(video) : "Choose a video from the library",
        artwork: "",
        playing: Boolean(video && playbackIsPlaying()),
        position: video ? playbackPosition() : 0,
        duration: video ? playbackDuration() : 0,
        volume: playbackVolume(),
        output: target,
        target,
        targetLabel: target === Remote.OUTPUT_COMPUTER ? "Command Center PC" : "This device",
        targetOnline: target === Remote.OUTPUT_COMPUTER ? Boolean(state.remote.rendererOnline) : true,
        rendererOnline: Boolean(state.remote.rendererOnline),
        capabilities: {
          playPause: Boolean(video),
          previous: Boolean(video && (playbackPosition() > 5 || state.queueIndex > 0)),
          next: Boolean(video && state.queueIndex >= 0 && state.queueIndex < state.queue.length - 1),
          seek: Boolean(video),
          volume: true,
        },
      });
    }

    function publishPlayback() {
      const detail = getPlaybackState();
      if (typeof root.CustomEvent === "function") {
        root.dispatchEvent?.(new root.CustomEvent("cc:videoplaybackchange", { detail }));
      }
      root.CCMediaSession?.publish?.(root, detail);
      syncNativeMediaSession(detail);
    }

    function syncNativeMediaSession(fallbackState = null) {
      const mediaSession = root.navigator?.mediaSession;
      if (!mediaSession) return;
      const active = root.CCMediaSession?.snapshot?.(root) || (fallbackState?.active ? fallbackState : null);
      const playbackState = !active?.active ? "none" : active.playing ? "playing" : "paused";
      if (state.nativePlaybackState !== playbackState) {
        try { mediaSession.playbackState = playbackState; } catch {}
        state.nativePlaybackState = playbackState;
      }

      const metadataKey = active?.active
        ? [active.source, active.itemId, active.title, active.subtitle, active.artwork].join("\u0000")
        : "";
      if (metadataKey === state.nativeMetadataKey) return;
      state.nativeMetadataKey = metadataKey;
      try {
        if (!active?.active) {
          mediaSession.metadata = null;
          return;
        }
        const subtitleParts = String(active.subtitle || "").split(" \u00b7 ");
        const artist = active.kind === "music"
          ? subtitleParts.shift() || "Command Center"
          : String(active.subtitle || "Command Center Video");
        const album = active.kind === "music"
          ? subtitleParts.join(" \u00b7 ") || "Command Center Music"
          : "Command Center Video";
        if (typeof root.MediaMetadata === "function") {
          mediaSession.metadata = new root.MediaMetadata({
            title: String(active.title || "Untitled media"),
            artist,
            album,
            artwork: active.artwork ? [{ src: active.artwork, sizes: "512x512" }] : [],
          });
        }
      } catch {}
    }

    function updateOutputStatus() {
      const target = remoteBridge?.getTarget() || Remote.OUTPUT_DEVICE;
      if (nodes.output && nodes.output.value !== target) nodes.output.value = target;
      if (!nodes.outputStatus || !nodes.outputWrap) return;
      let label = "Video plays on this device.";
      let kind = "device";
      if (remoteBridge?.isRenderer()) {
        if (!remoteBridge.isRendererConnected()) {
          label = "PC player reconnecting - phone control is not ready yet.";
          kind = "offline";
        } else if (state.rendererError === "interaction_required") {
          label = "Press Play once here before starting video from the phone.";
          kind = "blocked";
        } else if (state.rendererError) {
          label = "PC video playback needs attention in this window.";
          kind = "blocked";
        } else {
          label = "This window is the Command Center PC video player.";
          kind = "online";
        }
      } else if (usingRemoteOutput()) {
        if (!state.remote.rendererOnline) {
          label = "PC offline - open the desktop Command Center window.";
          kind = "offline";
        } else if (state.remote.error === "interaction_required") {
          label = "PC needs one local Play press before remote video can start.";
          kind = "blocked";
        } else if (state.remote.error) {
          label = "PC video playback needs attention in the desktop window.";
          kind = "blocked";
        } else {
          label = "PC online - controls and video are routed there.";
          kind = "online";
        }
      } else if (state.remote.rendererOnline) {
        label = "Video plays here; the Command Center PC is available.";
      }
      if (nodes.outputStatus.textContent !== label) nodes.outputStatus.textContent = label;
      nodes.outputWrap.dataset.state = kind;
    }

    function knownQueueState(values, requestedIndex) {
      return Remote.filterQueueState(values, requestedIndex, id => state.videoById.has(id));
    }

    function applyRemoteSnapshot(snapshot) {
      state.remote = snapshot || Remote.normalizePlaybackState({});
      updateOutputStatus();
      if (!usingRemoteOutput()) {
        publishPlayback();
        return;
      }
      const known = knownQueueState(state.remote.queue, state.remote.index);
      const changed = known.index !== state.queueIndex
        || known.queue.length !== state.queue.length
        || known.queue.some((id, index) => id !== state.queue[index]);
      state.queue = known.queue;
      state.queueIndex = known.index;
      if (changed) renderContent();
      updatePlayer();
    }

    async function sendRemote(action, values = {}) {
      try {
        return await remoteBridge.command(action, values);
      } catch (error) {
        setStatus(error.message || "The Command Center PC could not be controlled.", "error");
        remoteBridge.refresh().catch(() => {});
        throw error;
      }
    }

    function sendRemoteLoad({ autoplay = false, position = 0 } = {}) {
      const bounded = Remote.boundQueueState(state.queue, state.queueIndex);
      return sendRemote("load", {
        queue: bounded.queue,
        index: bounded.index,
        autoplay: Boolean(autoplay),
        position: Math.max(0, Number(position) || 0),
      });
    }

    function progressFor(video) {
      return video ? state.progressById.get(video.id) || null : null;
    }

    function updateProgressRecord(record) {
      const normalized = normalizeProgress(record);
      if (!normalized) return;
      state.progressById.set(normalized.video_id, normalized);
      state.recent = [...state.progressById.values()]
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
        .slice(0, 100);
    }

    function persistProgress(video, values = {}) {
      if (!video || usingRemoteOutput()) return Promise.resolve(null);
      const now = Date.now();
      const force = values.force === true;
      if (!force && now - state.lastProgressSaveAt < PROGRESS_SAVE_INTERVAL_MS) return Promise.resolve(null);
      const position = Math.max(0, Number(values.position ?? nodes.media.currentTime) || 0);
      const duration = Math.max(0, Number(values.duration ?? nodes.media.duration) || video.duration || 0);
      const completed = values.completed === true || Domain.playbackCompleted(position, duration, false);
      if (!force && position < 1 && !completed) return Promise.resolve(null);
      state.lastProgressSaveAt = now;
      const optimistic = {
        video_id: video.id,
        title: video.title,
        folder: video.folder,
        position,
        duration,
        completed,
        updated_at: new Date(now).toISOString(),
        stream_url: video.stream_url,
      };
      updateProgressRecord(optimistic);
      if (state.view === "recent") renderContent();
      const execute = () => request(
        API.progress + "/" + encodeURIComponent(video.id),
        {
          method: "POST",
          body: { position, duration, completed },
          keepalive: values.keepalive === true,
        },
      ).then(saved => {
        updateProgressRecord(saved?.item || saved?.progress || saved || optimistic);
        return saved;
      }).catch(() => null);
      const pending = state.progressTail.then(execute, execute);
      state.progressTail = pending.catch(() => {});
      return pending;
    }

    function removeLocalSource() {
      state.sourceToken += 1;
      state.localVideoId = "";
      state.mediaReadyToken = -1;
      state.suppressPauseSave = true;
      nodes.media.pause();
      state.suppressPauseSave = false;
      nodes.media.removeAttribute("src");
      nodes.media.load();
    }

    function suspendLocalOutput() {
      const video = currentVideo();
      if (video && nodes.media.getAttribute("src")) {
        persistProgress(video, { force: true, keepalive: true });
      }
      removeLocalSource();
    }

    function handleTargetChange(target, previous) {
      if (target === Remote.OUTPUT_COMPUTER) {
        if (previous === Remote.OUTPUT_DEVICE) suspendLocalOutput();
        applyRemoteSnapshot(state.remote);
        setStatus("Playback controls now target the Command Center PC.", "success");
      } else {
        const known = knownQueueState(state.remote.queue, state.remote.index);
        state.queue = known.queue;
        state.queueIndex = known.index;
        if (currentVideo()) {
          selectCurrent({ autoplay: false, resumeAt: Remote.projectedPosition(state.remote) });
        }
        if (previous === Remote.OUTPUT_COMPUTER) {
          setStatus("Playback controls now target this device.", "success");
        }
        renderContent();
        updatePlayer();
      }
      updateOutputStatus();
    }

    async function chooseOutputTarget(value) {
      const target = value === Remote.OUTPUT_COMPUTER ? Remote.OUTPUT_COMPUTER : Remote.OUTPUT_DEVICE;
      const previous = remoteBridge.getTarget();
      if (target === previous) return;
      if (previous === Remote.OUTPUT_COMPUTER && target === Remote.OUTPUT_DEVICE) {
        if (nodes.output) nodes.output.disabled = true;
        try {
          await remoteBridge.pauseAndUseDevice();
        } catch {
          remoteBridge.setTarget(Remote.OUTPUT_DEVICE);
        } finally {
          if (nodes.output) nodes.output.disabled = remoteBridge.isRenderer();
        }
        return;
      }
      remoteBridge.setTarget(target);
    }

    function captureRendererState() {
      const bounded = Remote.boundQueueState(state.queue, state.queueIndex);
      return {
        queue: bounded.queue,
        index: bounded.index,
        playing: !nodes.media.paused && !nodes.media.ended,
        position: Number(nodes.media.currentTime) || 0,
        duration: Number.isFinite(nodes.media.duration) ? nodes.media.duration : currentVideo()?.duration || 0,
        volume: nodes.media.volume,
        error: state.rendererError,
      };
    }

    async function applyRendererCommand(command) {
      const values = command?.args && typeof command.args === "object" ? command.args : command || {};
      const action = String(command?.action || "").toLowerCase();
      if (action === "load") {
        const known = knownQueueState(values.queue, values.index ?? values.queue_index ?? 0);
        if (known.sourceLength && known.index < 0) {
          throw new Error("The PC video library is out of date. Rescan it before remote playback.");
        }
        const previousId = currentVideo()?.id || null;
        leaveCurrent();
        state.queue = known.queue;
        state.queueIndex = known.index;
        const nextId = currentVideo()?.id || null;
        if (nextId) root.showTab?.("video");
        if (!nextId) {
          closePlayer({ reportRemote: false });
        } else if (nextId !== previousId || !nodes.media.getAttribute("src")) {
          selectCurrent({
            autoplay: values.autoplay === true,
            resumeAt: Math.max(0, Number(values.position) || 0),
          });
        } else {
          seekTo(Math.max(0, Number(values.position) || 0), { reportRemote: false });
          if (values.autoplay === true) await play();
          else pause();
        }
        renderContent();
        updatePlayer();
        return;
      }
      if (action === "play") {
        await play();
        state.rendererError = "";
        return;
      }
      if (action === "pause") return pause();
      if (action === "next") return next();
      if (action === "previous") return previous();
      if (action === "stop") return closePlayer({ reportRemote: false });
      if (action === "seek") return seekTo(values.position, { reportRemote: false });
      if (action === "volume") return setVolume(values.volume, { reportRemote: false });
      throw new Error("Unsupported PC video command: " + (action || "unknown"));
    }

    function updateNav() {
      nodes.root.querySelectorAll("[data-video-view]").forEach(control => {
        const active = control.dataset.videoView === state.view;
        control.classList.toggle("is-active", active);
        control.classList.toggle("active", active);
        control.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (nodes.search) {
        const region = nodes.search.closest(".cc-video-search-wrap") || nodes.search;
        region.hidden = state.view === "settings";
      }
    }

    function filteredVideos(source = state.videos) {
      return Domain.searchVideos(source, state.query).sort(Domain.compareVideos);
    }

    function emptyState(title, message, actionLabel, action) {
      const box = element("section", "cc-video-empty");
      box.append(element("h4", "", title), element("p", "", message));
      if (actionLabel && action) box.append(button(actionLabel, "cc-video-primary", action));
      return box;
    }

    function progressBar(progress, video) {
      const percent = Domain.progressPercent(progress, video?.duration);
      if (percent <= 0) return null;
      const track = element("div", "cc-video-resume");
      track.setAttribute("aria-label", progress?.completed ? "Watched" : Math.round(percent) + "% watched");
      const value = element("span");
      value.style.width = percent + "%";
      track.append(value);
      return track;
    }

    function videoCard(video, sourceVideos) {
      const card = element("article", "cc-video-card");
      card.dataset.videoId = video.id;
      if (currentVideo()?.id === video.id) card.classList.add("is-current");
      const poster = element("div", "cc-video-poster", "\ud83c\udfac");
      poster.setAttribute("aria-hidden", "true");
      const copy = element("div", "cc-video-card-copy");
      copy.append(element("strong", "", video.title));
      copy.append(element("span", "", videoMeta(video) || "Local video"));
      const progress = progressFor(video);
      const resumeAt = Domain.resumePosition(progress, video.duration);
      const actions = element("div", "cc-video-card-actions");
      const label = resumeAt > 0 ? "Resume " + Domain.formatTime(resumeAt) : progress?.completed ? "Watch again" : "Play";
      const playButton = button(label, "cc-video-primary", () => playVideo(video.id, sourceVideos));
      playButton.setAttribute("aria-label", label + " " + video.title);
      actions.append(playButton);
      if (resumeAt > 0 || progress?.completed) {
        const restart = button("Start over", "cc-video-secondary", () => playVideo(video.id, sourceVideos, { startOver: true }));
        restart.setAttribute("aria-label", "Start " + video.title + " from the beginning");
        actions.append(restart);
      }
      card.append(poster, copy);
      const bar = progressBar(progress, video);
      if (bar) card.append(bar);
      card.append(actions);
      return card;
    }

    function renderLibrary() {
      const videos = filteredVideos();
      if (!videos.length) {
        return emptyState(
          state.videos.length ? "No matches" : "No videos yet",
          state.videos.length
            ? "Try a different video title or format."
            : "Choose a video folder in Settings, then scan it. MP4 and WebM work in modern browsers.",
          state.videos.length ? "Clear search" : "Open settings",
          () => state.videos.length ? clearSearch() : setView("settings"),
        );
      }
      const grid = element("div", "cc-video-grid");
      videos.forEach(video => grid.append(videoCard(video, videos)));
      return grid;
    }

    function recentVideos() {
      return state.recent
        .map(progress => state.videoById.get(progress.video_id))
        .filter(Boolean)
        .filter(video => Domain.searchVideos([video], state.query).length);
    }

    function renderRecent() {
      if (state.recentLoading) return emptyState("Loading recent videos...", "Reading shared playback history.");
      const videos = recentVideos();
      if (!videos.length) {
        return emptyState(
          state.query ? "No recent matches" : "Nothing watched yet",
          state.query ? "Try a different video title." : "Started videos and resume positions will appear here.",
          state.query ? "Clear search" : "Browse library",
          () => state.query ? clearSearch() : setView("library"),
        );
      }
      const grid = element("div", "cc-video-grid cc-video-recent-grid");
      videos.forEach(video => grid.append(videoCard(video, videos)));
      return grid;
    }

    function scanDescription() {
      if (!state.scan) return "Ready to scan the selected folder.";
      const progress = state.scan.total > 0
        ? " " + state.scan.scanned + "/" + state.scan.total
        : state.scan.scanned > 0 ? " " + state.scan.scanned + " files" : "";
      return state.scan.message || state.scan.status + progress;
    }

    function renderSettings() {
      const wrap = element("div", "cc-video-settings");
      const heading = element("div", "cc-video-settings-head");
      heading.append(
        element("h4", "", "Video folder"),
        element(
          "p",
          "cc-video-muted",
          state.editable
            ? "Pick the folder containing this Command Center's videos. Subfolders are included."
            : "You can browse and play this library here. Folder selection and rescanning are available only on the computer running Command Center.",
        ),
      );
      const label = element("label", "", "Folder path");
      label.htmlFor = "cc-video-folder";
      const input = element("input", "cc-video-folder");
      input.id = "cc-video-folder";
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = state.editable ? state.folder : state.folderName;
      input.placeholder = "C:\\Videos or /home/me/Videos";
      input.disabled = !state.editable;
      const actions = element("div", "cc-video-settings-actions");
      const browse = button("Browse...", "cc-video-secondary", () => browseFolder(input));
      browse.id = "cc-video-browse";
      const save = button("Save folder", "cc-video-primary", () => saveFolder(input.value));
      save.id = "cc-video-save-folder";
      const rescan = button("Rescan library", "cc-video-secondary", startScan);
      rescan.id = "cc-video-rescan";
      browse.disabled = !state.editable;
      save.disabled = !state.editable;
      rescan.disabled = !state.editable || ACTIVE_SCAN_STATES.has(state.scan?.status) || Boolean(state.scanTimer);
      if (rescan.disabled && state.editable) rescan.textContent = "Scanning...";
      const scan = element("p", "cc-video-scan-status", scanDescription());
      scan.id = "cc-video-scan-status";
      scan.setAttribute("role", "status");
      scan.setAttribute("aria-live", "polite");
      actions.append(browse, save, rescan);
      wrap.append(heading, label, input, actions, scan);
      return wrap;
    }

    function renderContent() {
      updateNav();
      if (state.loading) {
        replace(nodes.content, emptyState("Loading videos...", "Reading the local library."));
        return;
      }
      if (state.loadError) {
        replace(nodes.content, emptyState("Video library unavailable", state.loadError.message, "Try again", load));
        return;
      }
      if (state.view === "library") replace(nodes.content, renderLibrary());
      if (state.view === "recent") replace(nodes.content, renderRecent());
      if (state.view === "settings") replace(nodes.content, renderSettings());
    }

    function setView(view) {
      if (!["library", "recent", "settings"].includes(view)) return;
      state.view = view;
      renderContent();
      if (view === "recent") refreshProgress().catch(() => {});
    }

    function clearSearch() {
      state.query = "";
      if (nodes.search) nodes.search.value = "";
      renderContent();
    }

    function updatePlayer() {
      const video = currentVideo();
      if (nodes.player) nodes.player.hidden = !video;
      if (nodes.nowTitle) nodes.nowTitle.textContent = video ? video.title : "Nothing playing";
      if (nodes.nowMeta) {
        nodes.nowMeta.textContent = video
          ? videoMeta(video) + (usingRemoteOutput() ? " \u00b7 Playing on Command Center PC" : "")
          : "Choose a video from the library";
      }
      const localSource = Boolean(video && !usingRemoteOutput() && nodes.media.getAttribute("src"));
      if (nodes.placeholder) nodes.placeholder.hidden = localSource;
      if (nodes.placeholderTitle) nodes.placeholderTitle.textContent = video?.title || "Choose a video";
      if (nodes.placeholderNote) {
        nodes.placeholderNote.textContent = usingRemoteOutput()
          ? "Video is playing on the Command Center PC"
          : "Playback will appear here";
      }
      const playing = Boolean(video && playbackIsPlaying());
      if (nodes.play) {
        nodes.play.textContent = playing ? "Pause" : "Play";
        nodes.play.setAttribute("aria-label", playing ? "Pause video" : "Play video");
        nodes.play.setAttribute("aria-pressed", playing ? "true" : "false");
        nodes.play.disabled = !video;
      }
      if (nodes.previous) nodes.previous.disabled = !video;
      if (nodes.next) nodes.next.disabled = !video || state.queueIndex >= state.queue.length - 1;
      if (nodes.progress) nodes.progress.disabled = !video;
      if (nodes.stop) nodes.stop.disabled = !video;
      if (nodes.fullscreen) {
        nodes.fullscreen.disabled = !localSource;
        nodes.fullscreen.textContent = root.document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
      }
      if (nodes.volume && root.document.activeElement !== nodes.volume) {
        nodes.volume.value = String(playbackVolume());
      }
      updateTimeline();
      publishPlayback();
    }

    function updateTimeline() {
      const duration = playbackDuration();
      const current = playbackPosition();
      if (nodes.progress && root.document.activeElement !== nodes.progress) {
        nodes.progress.value = duration > 0 ? String(Math.round(current / duration * 1000)) : "0";
        nodes.progress.setAttribute("aria-valuetext", Domain.formatTime(current) + " of " + Domain.formatTime(duration));
      }
      if (nodes.elapsed) nodes.elapsed.textContent = Domain.formatTime(current);
      if (nodes.duration) nodes.duration.textContent = Domain.formatTime(duration);
    }

    function leaveCurrent({ completed = false } = {}) {
      const video = localSourceVideo() || currentVideo();
      if (!video || usingRemoteOutput() || !nodes.media.getAttribute("src")) return;
      persistProgress(video, {
        force: true,
        position: nodes.media.currentTime,
        duration: nodes.media.duration,
        completed,
      });
      state.suppressPauseSave = true;
      nodes.media.pause();
      state.suppressPauseSave = false;
    }

    function playVideo(videoId, sourceVideos, { startOver = false } = {}) {
      leaveCurrent();
      const ids = (Array.isArray(sourceVideos) ? sourceVideos : state.videos)
        .map(opaqueVideoId)
        .filter(id => state.videoById.has(id));
      const requestedId = opaqueVideoId(videoId);
      let index = ids.indexOf(requestedId);
      if (index < 0 && requestedId !== null && state.videoById.has(requestedId)) {
        ids.push(requestedId);
        index = ids.length - 1;
      }
      if (index < 0) return;
      state.queue = ids;
      state.queueIndex = index;
      const video = currentVideo();
      const resumeAt = startOver ? 0 : Domain.resumePosition(progressFor(video), video?.duration);
      selectCurrent({ autoplay: true, resumeAt });
      renderContent();
    }

    function selectCurrent({ autoplay = false, resumeAt } = {}) {
      const video = currentVideo();
      if (!video) {
        updatePlayer();
        return;
      }
      const position = resumeAt == null
        ? Domain.resumePosition(progressFor(video), video.duration)
        : Math.max(0, Number(resumeAt) || 0);
      if (usingRemoteOutput()) {
        removeLocalSource();
        updatePlayer();
        sendRemoteLoad({ autoplay, position }).catch(() => {});
        return;
      }
      const token = ++state.sourceToken;
      state.localVideoId = video.id;
      state.mediaReadyToken = -1;
      state.suppressPauseSave = true;
      nodes.media.pause();
      state.suppressPauseSave = false;
      nodes.media.src = video.stream_url;
      nodes.media.addEventListener("loadedmetadata", () => {
        if (token !== state.sourceToken || state.localVideoId !== video.id) return;
        state.mediaReadyToken = token;
        if (Number.isFinite(nodes.media.duration)) {
          video.duration = Math.max(0, nodes.media.duration);
          renderContent();
        }
        if (position > 0) {
          const limit = Number.isFinite(nodes.media.duration)
            ? Math.max(0, nodes.media.duration - 0.25)
            : position;
          nodes.media.currentTime = Math.min(position, limit);
        }
        updatePlayer();
      }, { once: true });
      nodes.media.load();
      updatePlayer();
      if (autoplay) {
        play().catch(error => {
          const blocked = error?.name === "NotAllowedError"
            || /not allowed|user gesture|interact/i.test(String(error?.message || ""));
          if (remoteBridge?.isRenderer()) {
            state.rendererError = blocked ? "interaction_required" : "playback_error";
            updateOutputStatus();
          }
          setStatus(
            blocked ? "Press Play once in this window to allow video playback." : error.message || "Playback could not start.",
            "error",
          );
        });
      }
    }

    async function play() {
      if (!currentVideo()) {
        const videos = filteredVideos();
        if (!videos.length) return;
        state.queue = videos.map(video => video.id);
        state.queueIndex = 0;
        selectCurrent({ autoplay: true });
        return;
      }
      if (usingRemoteOutput()) {
        await sendRemote("play");
        return;
      }
      root.CCMusic?.pause?.();
      root.CCAudio?.stop?.();
      if (!nodes.media.getAttribute("src")) selectCurrent({ autoplay: false });
      await nodes.media.play();
      state.rendererError = "";
      updatePlayer();
    }

    function pause() {
      if (usingRemoteOutput()) {
        sendRemote("pause").catch(() => {});
        return;
      }
      const wasPaused = nodes.media.paused;
      nodes.media.pause();
      if (wasPaused) persistProgress(currentVideo(), { force: true });
      updatePlayer();
    }

    function previous() {
      if (!currentVideo()) return;
      if (usingRemoteOutput()) {
        sendRemote("previous").catch(() => {});
        return;
      }
      if (nodes.media.currentTime > 5) {
        seekTo(0, { reportRemote: false });
        return;
      }
      const index = Domain.nextQueueIndex(state.queue.length, state.queueIndex, -1);
      if (index < 0) {
        seekTo(0, { reportRemote: false });
        return;
      }
      leaveCurrent();
      state.queueIndex = index;
      selectCurrent({ autoplay: true });
      renderContent();
    }

    function next({ ended = false } = {}) {
      if (!currentVideo()) return;
      if (usingRemoteOutput()) {
        if (!ended) sendRemote("next").catch(() => {});
        return;
      }
      const index = Domain.nextQueueIndex(state.queue.length, state.queueIndex, 1);
      if (index < 0) {
        if (ended) persistProgress(currentVideo(), { force: true, completed: true });
        updatePlayer();
        renderContent();
        return;
      }
      leaveCurrent({ completed: ended });
      state.queueIndex = index;
      selectCurrent({ autoplay: true });
      renderContent();
    }

    function seekTo(value, { reportRemote = true } = {}) {
      const position = Math.max(0, Number(value) || 0);
      if (usingRemoteOutput() && reportRemote) {
        sendRemote("seek", { position }).catch(() => {});
        return;
      }
      const duration = Number(nodes.media.duration);
      nodes.media.currentTime = Number.isFinite(duration) ? Math.min(position, duration) : position;
      updateTimeline();
      publishPlayback();
    }

    function setVolume(value, { reportRemote = true } = {}) {
      const volume = Number(value);
      if (!Number.isFinite(volume)) return;
      const bounded = Math.max(0, Math.min(1, volume));
      if (usingRemoteOutput() && reportRemote) {
        sendRemote("volume", { volume: bounded }).catch(() => {});
      } else {
        nodes.media.volume = bounded;
      }
      updatePlayer();
    }

    function closePlayer({ reportRemote = true } = {}) {
      const video = currentVideo();
      if (usingRemoteOutput() && reportRemote) sendRemote("stop").catch(() => {});
      else if (video) persistProgress(video, { force: true });
      removeLocalSource();
      state.queue = [];
      state.queueIndex = -1;
      renderContent();
      updatePlayer();
    }

    async function toggleFullscreen() {
      if (usingRemoteOutput() || !currentVideo()) return;
      try {
        if (root.document.fullscreenElement) await root.document.exitFullscreen();
        else await (nodes.screen.requestFullscreen?.() || nodes.media.requestFullscreen?.());
      } catch (error) {
        setStatus(error.message || "Fullscreen is unavailable.", "error");
      }
    }

    function setupSharedMediaSession() {
      state.sharedCommandUnsubscribe?.();
      state.sharedCommandUnsubscribe = root.CCMediaSession?.onCommand?.(root, "video", command => {
        const action = String(command?.action || "");
        if (action === "play") play().catch(error => setStatus(error.message, "error"));
        if (action === "pause") pause();
        if (action === "previous") previous();
        if (action === "next") next();
        if (action === "seek") seekTo(command.value);
        if (action === "volume") setVolume(command.value);
      }) || null;
    }

    function setupNativeMediaCommands() {
      if (!("mediaSession" in root.navigator)) return;
      const route = (action, value, fallback) => {
        const command = root.CCMediaSession?.commandActive?.(action, value, root);
        if (!command) fallback?.();
      };
      const handlers = {
        play: () => route("play", undefined, () => play()),
        pause: () => route("pause", undefined, pause),
        previoustrack: () => route("previous", undefined, previous),
        nexttrack: () => route("next", undefined, () => next()),
        seekto: detail => route("seek", detail?.seekTime, () => seekTo(detail?.seekTime)),
      };
      Object.entries(handlers).forEach(([name, handler]) => {
        try { root.navigator.mediaSession.setActionHandler(name, handler); } catch {}
      });
    }

    function handleInputAction(action) {
      if (action === "secondaryAction") {
        if (!currentVideo()) return false;
        if (playbackIsPlaying()) pause();
        else play().catch(error => setStatus(error.message, "error"));
        return true;
      }
      if (action !== "back") return false;
      const fullscreen = root.document.fullscreenElement;
      const ownsFullscreen = Boolean(
        fullscreen
        && (fullscreen === nodes.screen || fullscreen === nodes.media || nodes.screen?.contains(fullscreen)),
      );
      if (ownsFullscreen) {
        root.document.exitFullscreen?.();
        return true;
      }
      return false;
    }

    async function refreshProgress() {
      if (state.recentLoading) return;
      state.recentLoading = true;
      if (state.view === "recent") renderContent();
      try {
        const data = await request(API.progress + "?limit=100");
        const values = data?.items || data?.recent || [];
        if (Array.isArray(values)) {
          values.map(normalizeProgress).filter(Boolean).forEach(updateProgressRecord);
        }
      } catch (error) {
        if (state.view === "recent") setStatus(error.message, "error");
      } finally {
        state.recentLoading = false;
        if (state.view === "recent") renderContent();
      }
    }

    async function browseFolder(input) {
      const chooser = root.pywebview?.api?.choose_video_folder;
      if (typeof chooser !== "function") {
        setStatus("Native Browse is unavailable here. Paste or type the folder path instead.", "info");
        input.focus();
        input.select();
        return;
      }
      try {
        const result = await chooser.call(root.pywebview.api);
        const folder = typeof result === "string"
          ? result
          : result?.video_folder || result?.folder || result?.path;
        if (folder) {
          input.value = String(folder);
          input.focus();
        }
      } catch (error) {
        setStatus(error.message || "The folder picker could not open.", "error");
      }
    }

    async function saveFolder(value) {
      const folder = String(value || "").trim();
      if (!folder) {
        setStatus("Enter a video folder first.", "error");
        byId("cc-video-folder")?.focus();
        return;
      }
      setStatus("Saving video folder...", "info");
      try {
        let data;
        try {
          data = await request(API.settings, {
            method: "PUT",
            body: { video_folder: folder, recursive: true, scan: true },
          });
        } catch (error) {
          if (error.status !== 405) throw error;
          data = await request(API.settings, {
            method: "POST",
            body: { video_folder: folder, recursive: true, scan: true },
          });
        }
        const settings = settingsPayload(data);
        state.folder = settings.folder || folder;
        state.folderName = settings.folderName || state.folderName;
        state.editable = settings.editable;
        state.scan = settings.scan ? scanPayload(settings.scan) : null;
        if (state.scan && FINISHED_SCAN_STATES.has(state.scan.status)) {
          await scanComplete();
          return;
        }
        if (state.scan && ACTIVE_SCAN_STATES.has(state.scan.status)) {
          setStatus("Video folder saved. Scanning the library...", "success");
          pollScan(state.scan);
        } else {
          setStatus("Video folder saved.", "success");
        }
        renderContent();
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    async function startScan() {
      if (state.scanTimer) return;
      setStatus("Starting video scan...", "info");
      try {
        state.scan = scanPayload(await request(API.scan, { method: "POST", body: {} }));
        renderContent();
        if (FINISHED_SCAN_STATES.has(state.scan.status)) {
          await scanComplete();
          return;
        }
        if (FAILED_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Video scan failed.");
        if (!ACTIVE_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Video scan did not start.");
        pollScan(state.scan);
      } catch (error) {
        state.scanTimer = null;
        setStatus(error.message, "error");
        renderContent();
      }
    }

    function pollScan(scan) {
      if (state.scanTimer) root.clearTimeout(state.scanTimer);
      state.scanTimer = null;
      const encodedId = scan.id == null ? "" : encodeURIComponent(scan.id);
      let url = scan.pollUrl || (encodedId ? API.scan + "/" + encodedId : API.scan);
      let attempts = 0;
      const check = async () => {
        attempts += 1;
        try {
          let data;
          try {
            data = await request(url);
          } catch (error) {
            if (error.status !== 404 || !encodedId || url === API.scan) throw error;
            url = API.scan + "?scan_id=" + encodedId;
            data = await request(url);
          }
          state.scan = scanPayload(data);
          renderContent();
          if (FINISHED_SCAN_STATES.has(state.scan.status)) {
            state.scanTimer = null;
            await scanComplete();
            return;
          }
          if (FAILED_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Video scan failed.");
          if (attempts >= 240) throw new Error("The scan is still running. Reopen Video later to see the result.");
          state.scanTimer = root.setTimeout(check, 1000);
        } catch (error) {
          state.scanTimer = null;
          setStatus(error.message, "error");
          renderContent();
        }
      };
      state.scanTimer = root.setTimeout(check, 700);
    }

    async function scanComplete() {
      setStatus("Scan complete. Refreshing the video library...", "success");
      await load({ keepView: true });
      setStatus(state.videos.length + " video" + (state.videos.length === 1 ? "" : "s") + " ready.", "success");
    }

    async function load({ keepView = false } = {}) {
      const activeId = currentVideo()?.id || null;
      const activePosition = playbackPosition();
      const wasPlaying = playbackIsPlaying();
      state.loading = true;
      state.loadError = null;
      renderContent();
      try {
        const [settingsRaw, libraryRaw] = await Promise.all([
          request(API.settings).catch(error => ({ _error: error })),
          request(API.library),
        ]);
        const settings = settingsRaw?._error
          ? { folder: "", folderName: "", libraryId: "", scan: null, editable: false }
          : settingsPayload(settingsRaw);
        const library = libraryPayload(libraryRaw);
        state.folder = settings.folder;
        state.folderName = settings.folderName;
        state.editable = settings.editable;
        state.libraryId = library.libraryId !== "unconfigured"
          ? library.libraryId
          : settings.libraryId || "unconfigured";
        state.videos = library.videos;
        state.videoById = new Map(state.videos.map(video => [video.id, video]));
        state.progressById = new Map();
        state.recent = [];
        library.recent.forEach(updateProgressRecord);
        if (settings.scan) state.scan = scanPayload(settings.scan);
        if (usingRemoteOutput()) {
          applyRemoteSnapshot(state.remote);
        } else if (state.queue.length) {
          const known = knownQueueState(state.queue, state.queueIndex);
          state.queue = known.queue;
          state.queueIndex = known.index;
          if (!currentVideo()) {
            removeLocalSource();
          } else if (currentVideo()?.id !== activeId) {
            selectCurrent({ autoplay: wasPlaying, resumeAt: activePosition });
          }
        }
        if (!keepView) state.view = "library";
      } catch (error) {
        state.loadError = error;
      } finally {
        state.loading = false;
        renderContent();
        updatePlayer();
        if (state.scan && ACTIVE_SCAN_STATES.has(state.scan.status) && !state.scanTimer) pollScan(state.scan);
      }
    }

    remoteBridge = Remote.createBridge({
      host: root,
      storage: root.localStorage,
      request,
      captureRendererState,
      applyRendererCommand,
      onState: applyRemoteSnapshot,
      onTargetChange: handleTargetChange,
      onRendererChange: active => {
        if (nodes.output) {
          nodes.output.disabled = active;
          const deviceOption = nodes.output.querySelector('option[value="device"]');
          const computerOption = nodes.output.querySelector('option[value="computer"]');
          if (deviceOption) deviceOption.textContent = active ? "This device (Command Center PC)" : "This device";
          if (computerOption) computerOption.disabled = active;
        }
        updateOutputStatus();
      },
      onRendererConnectionChange: updateOutputStatus,
      onRendererError: error => {
        const blocked = error?.name === "NotAllowedError"
          || /not allowed|user gesture|interact/i.test(String(error?.message || ""));
        state.rendererError = blocked ? "interaction_required" : "playback_error";
        updateOutputStatus();
        setStatus(
          blocked
            ? "PC video needs one local Play press before phone control can start it."
            : error?.message || "The PC video player could not apply a remote command.",
          "error",
        );
      },
      onError: () => updateOutputStatus(),
    });
    if (nodes.output) nodes.output.value = remoteBridge.getTarget();
    updateOutputStatus();

    const sendRemoteSeek = Domain.debounce(value => {
      sendRemote("seek", { position: value }).catch(() => {});
    }, 120);
    const sendRemoteVolume = Domain.debounce(value => {
      sendRemote("volume", { volume: value }).catch(() => {});
    }, 120);

    function bind() {
      nodes.root.querySelectorAll("[data-video-view]").forEach(control => {
        control.addEventListener("click", () => setView(control.dataset.videoView));
      });
      if (nodes.search) {
        const applySearch = Domain.debounce(() => {
          state.query = nodes.search.value;
          renderContent();
        }, 180);
        nodes.search.addEventListener("input", applySearch);
      }
      nodes.output?.addEventListener("change", () => chooseOutputTarget(nodes.output.value));
      nodes.play?.addEventListener("click", () => {
        if (playbackIsPlaying()) pause();
        else play().catch(error => setStatus(error.message, "error"));
      });
      nodes.previous?.addEventListener("click", previous);
      nodes.next?.addEventListener("click", () => next());
      nodes.stop?.addEventListener("click", () => closePlayer());
      nodes.fullscreen?.addEventListener("click", toggleFullscreen);
      nodes.progress?.addEventListener("input", () => {
        const duration = playbackDuration();
        const position = duration > 0 ? Number(nodes.progress.value) / 1000 * duration : 0;
        if (usingRemoteOutput()) sendRemoteSeek(position);
        else seekTo(position, { reportRemote: false });
      });
      nodes.volume?.addEventListener("input", () => {
        const volume = Math.max(0, Math.min(1, Number(nodes.volume.value)));
        if (usingRemoteOutput()) sendRemoteVolume(volume);
        else setVolume(volume, { reportRemote: false });
      });

      nodes.media.addEventListener("play", () => {
        state.rendererError = "";
        root.CCMusic?.pause?.();
        root.CCAudio?.stop?.();
        updateOutputStatus();
        updatePlayer();
      });
      nodes.media.addEventListener("pause", () => {
        if (usingRemoteOutput() || state.suppressPauseSave || !localSourceReady()) return;
        persistProgress(localSourceVideo(), { force: true });
        updatePlayer();
      });
      nodes.media.addEventListener("ended", () => {
        if (usingRemoteOutput() || !localSourceReady()) return;
        next({ ended: true });
      });
      nodes.media.addEventListener("timeupdate", () => {
        if (usingRemoteOutput() || !localSourceReady()) return;
        updateTimeline();
        publishPlayback();
        persistProgress(localSourceVideo());
      });
      nodes.media.addEventListener("durationchange", updatePlayer);
      nodes.media.addEventListener("error", () => {
        if (!nodes.media.error) return;
        if (remoteBridge?.isRenderer()) state.rendererError = "playback_error";
        setStatus("This video could not be played. It may use a codec this browser does not support.", "error");
        updateOutputStatus();
        updatePlayer();
      });
      root.document.addEventListener("fullscreenchange", updatePlayer);
      root.document.addEventListener("visibilitychange", () => {
        if (root.document.hidden && localSourceReady()) {
          persistProgress(localSourceVideo(), { force: true, keepalive: true });
        }
      });
      root.addEventListener("pagehide", () => {
        if (localSourceReady()) {
          persistProgress(localSourceVideo(), { force: true, keepalive: true });
        }
        state.sharedCommandUnsubscribe?.();
        remoteBridge.stop();
      });
      root.addEventListener("cc:tabchange", event => {
        if (event.detail?.name === "video") onShow();
      });
      setupSharedMediaSession();
      setupNativeMediaCommands();
    }

    function onShow() {
      renderContent();
      updatePlayer();
      if (state.view === "recent") refreshProgress().catch(() => {});
    }

    bind();
    load().finally(() => remoteBridge.start());

    return Object.freeze({
      getPlaybackState,
      handleInputAction,
      isPlaying: playbackIsPlaying,
      next: () => next(),
      onShow,
      pause,
      play,
      previous,
      reload: () => load({ keepView: true }),
      seek: seekTo,
      setVolume,
      stop: closePlayer,
    });
  }

  const publicApi = {
    getPlaybackState() { return app?.getPlaybackState() || null; },
    handleInputAction(action, detail) { return app?.handleInputAction(action, detail) || false; },
    isPlaying() { return app?.isPlaying() || false; },
    next() { return app?.next(); },
    onShow() { return app?.onShow(); },
    pause() { return app?.pause(); },
    play() { return app?.play(); },
    previous() { return app?.previous(); },
    reload() { return app?.reload(); },
    seek(value) { return app?.seek(value); },
    setVolume(value) { return app?.setVolume(value); },
    stop() { return app?.stop(); },
  };
  root.CCVideo = Object.freeze(publicApi);

  function init() {
    if (!app) app = createApp();
  }
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
