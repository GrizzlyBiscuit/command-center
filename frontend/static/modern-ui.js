(function () {
  "use strict";

  var VIEW_META = {
    home: {
      eyebrow: "Command Center",
      title: "Overview",
      description: "A clear view of local services, activity, and tools."
    },
    switches: {
      eyebrow: "Runtime",
      title: "Services",
      description: "Start, stop, and inspect the local model and relay services."
    },
    sys: {
      eyebrow: "Runtime",
      title: "System",
      description: "Monitor compute, memory, storage, network, and GPU health."
    },
    control: {
      eyebrow: "Runtime",
      title: "Agents",
      description: "Manage installed agents and work directly from the system console."
    },
    chat: {
      eyebrow: "AI Lab",
      title: "Chat",
      description: "Talk with a local model in a private, offline workspace."
    },
    arena: {
      eyebrow: "AI Lab",
      title: "Model Arena",
      description: "Compare local models side by side and evaluate their responses."
    },
    fusion: {
      eyebrow: "AI Lab",
      title: "Fusion",
      description: "Create reusable model pairs for drafting and refinement."
    },
    maze: {
      eyebrow: "AI Lab",
      title: "Maze",
      description: "Watch local models reason through the same live challenge."
    },
    music: {
      eyebrow: "Media",
      title: "Music",
      description: "Browse, queue, and play music stored on this computer."
    },
    video: {
      eyebrow: "Media",
      title: "Video",
      description: "Browse and play your local video library."
    },
    visualizer: {
      eyebrow: "Media",
      title: "Visualizer",
      description: "Turn the active audio source into a focused visual display."
    },
    kanban: {
      eyebrow: "Workspace",
      title: "Kanban",
      description: "Plan and track shared work across backlog, active, and completed."
    },
    notes: {
      eyebrow: "Workspace",
      title: "Notes",
      description: "Keep a private, auto-saved markdown scratchpad."
    },
    pomodoro: {
      eyebrow: "Workspace",
      title: "Focus",
      description: "Run a simple focus timer without leaving the workspace."
    },
    launchpad: {
      eyebrow: "Workspace",
      title: "Launchpad",
      description: "Keep frequently used local applications one click away."
    },
    discord: {
      eyebrow: "Integrations",
      title: "Discord",
      description: "Inspect the local Discord relay and send a message."
    },
    webhooks: {
      eyebrow: "Integrations",
      title: "Webhooks",
      description: "Review events arriving from local tools and automations."
    },
    arcade: {
      eyebrow: "More",
      title: "Arcade",
      description: "Take a break with the built-in local games."
    },
    settings: {
      eyebrow: "More",
      title: "Appearance",
      description: "Adjust the workspace palette and visual preferences."
    },
    changelog: {
      eyebrow: "More",
      title: "Changelog",
      description: "Review recent releases and product changes."
    },
    instructions: {
      eyebrow: "Workspace",
      title: "Setup",
      description: "Install local models, configure agents, and copy common commands."
    },
    botControl: {
      eyebrow: "Runtime",
      title: "Service Control",
      description: "Manage the local model server and Discord bridge."
    },
    agent: {
      eyebrow: "Runtime",
      title: "Agent Details",
      description: "Inspect this agent and run it with custom context."
    },
    adminLogin: {
      eyebrow: "Administration",
      title: "Admin sign in",
      description: "Authenticate to manage protected workspace settings."
    },
    adminSettings: {
      eyebrow: "Administration",
      title: "Admin settings",
      description: "Manage protected credentials for local integrations."
    },
    adminLog: {
      eyebrow: "Administration",
      title: "Activity log",
      description: "Review recent encrypted local activity."
    }
  };

  var shell = document.querySelector(".app-shell");
  var sidebar = document.getElementById("cc-sidebar");
  var sideToggle = document.getElementById("cc-side-toggle");
  var sideReopen = document.getElementById("cc-side-reopen");
  var mobileMenu = document.getElementById("cc-mobile-menu");
  var navSearch = document.getElementById("cc-nav-search");
  var navEmpty = document.getElementById("cc-nav-empty");
  var drawerBackgrounds = [
    document.querySelector(".app-main"),
    document.querySelector(".app-footer")
  ].filter(Boolean);
  var mobileQuery = window.matchMedia ? window.matchMedia("(max-width: 900px)") : null;
  var mobileDrawerOpen = false;

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function prepareIcons() {
    document.querySelectorAll(".app-shell svg").forEach(function (icon) {
      if (!icon.hasAttribute("fill")) icon.setAttribute("fill", "none");
      if (!icon.hasAttribute("stroke")) icon.setAttribute("stroke", "currentColor");
      if (!icon.hasAttribute("stroke-width")) icon.setAttribute("stroke-width", "1.8");
      if (!icon.hasAttribute("stroke-linecap")) icon.setAttribute("stroke-linecap", "round");
      if (!icon.hasAttribute("stroke-linejoin")) icon.setAttribute("stroke-linejoin", "round");
      if (!icon.hasAttribute("width")) icon.setAttribute("width", "18");
      if (!icon.hasAttribute("height")) icon.setAttribute("height", "18");
    });
  }

  function routeView() {
    var path = window.location.pathname || "/";
    if (path === "/" || path === "") {
      var hashName = normalize((window.location.hash || "").replace(/^#/, ""));
      return VIEW_META[hashName] ? hashName : "home";
    }
    if (path.indexOf("/changelog") === 0) return "changelog";
    if (path.indexOf("/instructions") === 0) return "instructions";
    if (path.indexOf("/darkmode") === 0) return "settings";
    if (path.indexOf("/bot-control") === 0) return "botControl";
    if (path.indexOf("/agent/") === 0) return "agent";
    if (path.indexOf("/admin/login") === 0) return "adminLogin";
    if (path.indexOf("/admin/settings") === 0) return "adminSettings";
    if (path.indexOf("/admin/log") === 0) return "adminLog";
    return "home";
  }

  function setStandaloneNavState(name) {
    if (typeof window.showTab === "function") return;
    var navTab = name;
    if (name === "botControl") navTab = "switches";
    if (name === "agent") navTab = "control";
    if (name === "instructions") navTab = "";
    if (name.indexOf("admin") === 0) navTab = "";

    document.querySelectorAll(".cc-side-nav .tab-btn[data-tab]").forEach(function (item) {
      var active = Boolean(navTab && item.dataset.tab === navTab);
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function updateView(name) {
    var viewName = VIEW_META[name] ? name : "home";
    var meta = VIEW_META[viewName];
    var eyebrow = document.getElementById("view-eyebrow");
    var title = document.getElementById("view-title");
    var description = document.getElementById("view-description");

    if (eyebrow) eyebrow.textContent = meta.eyebrow;
    if (title) title.textContent = meta.title;
    if (description) description.textContent = meta.description;
    if (shell) shell.dataset.currentView = viewName;
    setStandaloneNavState(viewName);
  }

  window.addEventListener("cc:tabchange", function (event) {
    var name = event && event.detail ? event.detail.name : "home";
    updateView(name);
    filterNavigation();
  });

  window.addEventListener("hashchange", function () {
    if (typeof window.showTab !== "function") updateView(routeView());
  });

  function filterNavigation() {
    if (!navSearch) return;
    var query = normalize(navSearch.value);
    var visibleCount = 0;

    document.querySelectorAll(".cc-nav-section").forEach(function (group) {
      var groupLabel = normalize(group.querySelector(".cc-nav-heading") && group.querySelector(".cc-nav-heading").textContent);
      var groupHasMatch = false;

      group.querySelectorAll(".tab-btn[data-tab]").forEach(function (item) {
        var label = normalize(item.querySelector(".label") && item.querySelector(".label").textContent);
        var searchable = [
          label,
          groupLabel,
          normalize(item.dataset.tab),
          normalize(item.getAttribute("data-tip"))
        ].join(" ");
        var matches = !query || searchable.indexOf(query) !== -1;
        item.hidden = !matches;
        if (query) {
          item.tabIndex = matches ? 0 : -1;
        } else if (typeof window.showTab === "function") {
          item.tabIndex = item.tagName === "A" || item.classList.contains("active") ? 0 : -1;
        } else {
          item.removeAttribute("tabindex");
        }
        if (matches) {
          groupHasMatch = true;
          visibleCount++;
        }
      });

      group.hidden = !groupHasMatch;
    });

    if (navEmpty) navEmpty.hidden = visibleCount !== 0;
    if (sidebar) sidebar.classList.toggle("is-filtering", Boolean(query));
  }

  function visibleNavigationItems() {
    return Array.from(document.querySelectorAll(".cc-side-nav .tab-btn[data-tab]")).filter(function (item) {
      return !item.hidden && !item.closest("[hidden]") && item.getAttribute("aria-hidden") !== "true";
    });
  }

  function visibleDrawerFocusables() {
    if (!sidebar) return [];
    return Array.from(sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (item) {
      return !item.hidden && !item.closest("[hidden]") && item.getClientRects().length > 0;
    });
  }

  if (navSearch) {
    navSearch.addEventListener("input", filterNavigation);
    navSearch.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && navSearch.value) {
        event.stopPropagation();
        navSearch.value = "";
        filterNavigation();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp" || (event.key === "Enter" && navSearch.value.trim())) {
        var results = visibleNavigationItems();
        if (!results.length) return;
        event.preventDefault();
        var result = event.key === "ArrowUp" ? results[results.length - 1] : results[0];
        if (event.key === "Enter") result.click();
        else result.focus();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    var tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    var isEditing = tagName === "input" || tagName === "textarea" || tagName === "select" || (target && target.isContentEditable);

    if (mobileDrawerOpen && event.key === "Tab") {
      var focusables = visibleDrawerFocusables();
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    if (event.key === "/" && !isEditing && navSearch && sidebar && !sidebar.inert) {
      event.preventDefault();
      navSearch.focus();
      navSearch.select();
      return;
    }

    if (event.key === "Escape" && mobileDrawerOpen) {
      event.preventDefault();
      setMobileDrawer(false, true);
    }
  });

  function setSidebarCollapsed(collapsed) {
    if (!shell || !sidebar) return;
    shell.classList.toggle("sidebar-collapsed", collapsed);
    sidebar.classList.toggle("collapsed", collapsed);
    sidebar.inert = collapsed;
    sidebar.setAttribute("aria-hidden", collapsed ? "true" : "false");
    if (sideToggle) sideToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (sideReopen) sideReopen.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function savedDesktopCollapsed() {
    try {
      return window.localStorage.getItem("cc_sidebar_collapsed") === "1";
    } catch (error) {
      return false;
    }
  }

  function isMobile() {
    return Boolean(mobileQuery && mobileQuery.matches);
  }

  function setMobileDrawer(open, returnFocus) {
    if (!shell || !sidebar || !mobileMenu) return;
    mobileDrawerOpen = Boolean(open && isMobile());
    shell.classList.toggle("mobile-nav-open", mobileDrawerOpen);
    document.body.classList.toggle("cc-mobile-nav-open", mobileDrawerOpen);
    mobileMenu.setAttribute("aria-expanded", mobileDrawerOpen ? "true" : "false");
    mobileMenu.setAttribute("aria-label", mobileDrawerOpen ? "Close navigation" : "Open navigation");
    drawerBackgrounds.forEach(function (element) {
      element.inert = mobileDrawerOpen;
    });

    if (isMobile()) {
      setSidebarCollapsed(!mobileDrawerOpen);
    }

    if (mobileDrawerOpen) {
      window.requestAnimationFrame(function () {
        if (navSearch) navSearch.focus();
      });
    } else if (returnFocus) {
      window.requestAnimationFrame(function () {
        try { mobileMenu.focus(); } catch (error) {}
      });
    }
  }

  function syncViewport() {
    if (isMobile()) {
      setMobileDrawer(false, false);
      return;
    }

    mobileDrawerOpen = false;
    if (shell) shell.classList.remove("mobile-nav-open");
    document.body.classList.remove("cc-mobile-nav-open");
    if (mobileMenu) {
      mobileMenu.setAttribute("aria-expanded", "false");
      mobileMenu.setAttribute("aria-label", "Open navigation");
    }
    setSidebarCollapsed(savedDesktopCollapsed());
  }

  if (mobileMenu) {
    mobileMenu.addEventListener("click", function () {
      setMobileDrawer(!mobileDrawerOpen, false);
    });
  }

  if (shell) {
    shell.addEventListener("click", function (event) {
      if (mobileDrawerOpen && event.target === shell) setMobileDrawer(false, true);
    });
  }

  if (sideToggle) {
    sideToggle.addEventListener("click", function (event) {
      if (isMobile()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMobileDrawer(false, false);
      }
    }, true);
  }

  if (sideReopen) {
    sideReopen.addEventListener("click", function (event) {
      if (isMobile()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMobileDrawer(true, false);
      }
    }, true);
  }

  document.querySelectorAll(".cc-side-nav .tab-btn[data-tab]").forEach(function (item) {
    item.addEventListener("click", function () {
      if (isMobile()) {
        window.setTimeout(function () { setMobileDrawer(false, true); }, 0);
      }
    });
  });

  if (mobileQuery) {
    if (typeof mobileQuery.addEventListener === "function") mobileQuery.addEventListener("change", syncViewport);
    else if (typeof mobileQuery.addListener === "function") mobileQuery.addListener(syncViewport);
  }

  function updateClock() {
    var timeElement = document.getElementById("workspace-time-value");
    var dateElement = document.getElementById("workspace-date-value");
    if (!timeElement && !dateElement) return;

    var now = new Date();
    if (timeElement) {
      timeElement.textContent = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit"
      }).format(now);
      timeElement.setAttribute("datetime", now.toISOString());
    }
    if (dateElement) {
      dateElement.textContent = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric"
      }).format(now);
    }
  }

  function updateConnectivity() {
    var status = document.getElementById("workspace-status");
    var label = document.getElementById("workspace-status-label");
    var online = navigator.onLine !== false;
    if (status) status.dataset.state = online ? "online" : "offline";
    if (label) label.textContent = online ? "Local workspace" : "Network offline";
  }

  prepareIcons();
  updateView(window._ccCurrentTab || routeView());
  filterNavigation();
  syncViewport();
  updateClock();
  updateConnectivity();
  window.setInterval(updateClock, 30000);
  window.addEventListener("online", updateConnectivity);
  window.addEventListener("offline", updateConnectivity);
})();
