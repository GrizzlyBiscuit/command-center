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
    chevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
    chevronUp: [["path", { d: "m6 15 6-6 6 6" }]],
    close: [["path", { d: "m6 6 12 12M18 6 6 18" }]],
    film: [
      ["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }],
      ["path", { d: "M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" }],
    ],
    fullscreen: [["path", { d: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" }]],
    fullscreenExit: [["path", { d: "M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" }]],
    music: [
      ["path", { d: "M9 18V5l10-2v13" }],
      ["circle", { cx: "6", cy: "18", r: "3" }],
      ["circle", { cx: "16", cy: "16", r: "3" }],
    ],
    next: [
      ["path", { d: "m6 5 9 7-9 7z", fill: "currentColor", stroke: "none" }],
      ["path", { d: "M18 5v14" }],
    ],
    pause: [
      ["rect", { x: "6", y: "5", width: "4", height: "14", rx: "1", fill: "currentColor", stroke: "none" }],
      ["rect", { x: "14", y: "5", width: "4", height: "14", rx: "1", fill: "currentColor", stroke: "none" }],
    ],
    play: [["path", { d: "m8 5 11 7-11 7z", fill: "currentColor", stroke: "none" }]],
    playNext: [
      ["path", { d: "m5 6 9 6-9 6z", fill: "currentColor", stroke: "none" }],
      ["path", { d: "M17 5v14M20 8v8M16 12h8" }],
    ],
    previous: [
      ["path", { d: "m18 5-9 7 9 7z", fill: "currentColor", stroke: "none" }],
      ["path", { d: "M6 5v14" }],
    ],
    queue: [["path", { d: "M4 6h11M4 12h11M4 18h8M19 15v6M16 18h6" }]],
    repeat: [["path", { d: "m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" }]],
    restart: [["path", { d: "M4 10a8 8 0 1 1 2 8M4 4v6h6" }]],
    shuffle: [["path", { d: "M16 3h5v5M4 20 21 3M4 4l5 5M15 15l6 6M16 21h5v-5" }]],
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
