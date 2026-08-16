/* Shared, dependency-free media icons for LAN/offline playback controls. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMediaUI = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = Object.freeze({
    add: [["path", { d: "M12 5v14M5 12h14" }]],
    albums: [
      ["rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }],
      ["path", { d: "M8 4V2h12a2 2 0 0 1 2 2v12h-2" }],
    ],
    artists: [
      ["circle", { cx: "9", cy: "8", r: "3" }],
      ["path", { d: "M3 20a6 6 0 0 1 12 0M16 5h5M18.5 2.5v5M17 12h4M19 10v4" }],
    ],
    chevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
    chevronLeft: [["path", { d: "m15 18-6-6 6-6" }]],
    chevronUp: [["path", { d: "m6 15 6-6 6 6" }]],
    close: [["path", { d: "m6 6 12 12M18 6 6 18" }]],
    details: [["path", { d: "M12 5v14M5 12h14" }]],
    film: [
      ["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }],
      ["path", { d: "M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" }],
    ],
    folder: [["path", { d: "M3 7h7l2 3h9v9H3zM3 7v12" }]],
    fullscreen: [["path", { d: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" }]],
    fullscreenExit: [["path", { d: "M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" }]],
    glow: [
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" }],
    ],
    music: [
      ["path", { d: "M9 18V5l10-2v13" }],
      ["circle", { cx: "6", cy: "18", r: "3" }],
      ["circle", { cx: "16", cy: "16", r: "3" }],
    ],
    next: [
      ["path", { d: "M18 5v14" }],
      ["path", { d: "m6 6 8 6-8 6z", fill: "currentColor", stroke: "none" }],
    ],
    pause: [["path", { d: "M8 5v14M16 5v14" }]],
    play: [["path", { d: "m8 5 11 7-11 7z", fill: "currentColor", stroke: "none" }]],
    playNext: [
      ["path", { d: "m5 6 9 6-9 6z", fill: "currentColor", stroke: "none" }],
      ["path", { d: "M17 5v14M20 8v8M16 12h8" }],
    ],
    previous: [
      ["path", { d: "M6 5v14" }],
      ["path", { d: "m18 6-8 6 8 6z", fill: "currentColor", stroke: "none" }],
    ],
    queue: [
      ["path", { d: "M8 6h13M8 12h13M8 18h13" }],
      ["path", { d: "M3 6h.01M3 12h.01M3 18h.01" }],
    ],
    repeat: [["path", { d: "m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" }]],
    restart: [["path", { d: "M4 10a8 8 0 1 1 2 8M4 4v6h6" }]],
    shuffle: [["path", { d: "M4 7h3c4 0 5 10 9 10h4m-3-3 3 3-3 3M4 17h3c1.6 0 2.7-1.6 3.7-3.6M13.2 8.7C14 7.7 14.9 7 16 7h4m-3-3 3 3-3 3" }]],
    settings: [
      ["path", { d: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" }],
      ["circle", { cx: "16", cy: "6", r: "2" }],
      ["circle", { cx: "8", cy: "12", r: "2" }],
      ["circle", { cx: "13", cy: "18", r: "2" }],
    ],
    stats: [["path", { d: "M4 20V10M10 20V4M16 20v-7M22 20V7M2 20h22" }]],
    trash: [["path", { d: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" }]],
  });

  function createIcon(name, options = {}) {
    const documentRef = options.document || root?.document;
    const definition = ICONS[name];
    if (!documentRef || !definition) return null;
    const svg = documentRef.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", options.className || "cc-media-icon");
    definition.forEach(([tag, attributes]) => {
      const child = documentRef.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, value));
      svg.append(child);
    });
    return svg;
  }

  function setButtonIcon(control, name, label, options = {}) {
    if (!control) return control;
    const icon = createIcon(name, { document: control.ownerDocument });
    const hasRequestedIcon = control.dataset.mediaIcon === name
      && control.querySelector?.(".cc-media-icon");
    if (!hasRequestedIcon) {
      if (icon) control.replaceChildren(icon);
      else control.textContent = options.fallback || label || "";
    }
    control.dataset.mediaIcon = name;
    control.classList.add("cc-media-icon-button");
    if (label) {
      control.setAttribute("aria-label", label);
      control.title = options.title || label;
    }
    return control;
  }

  return Object.freeze({ createIcon, icons: Object.freeze(Object.keys(ICONS)), setButtonIcon });
});
