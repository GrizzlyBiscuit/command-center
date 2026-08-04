(function(root, factory){
  const api = factory(root);
  if(typeof module === "object" && module.exports) module.exports = api;
  if(root) root.CCControllerNavigation = api;
})(typeof window !== "undefined" ? window : globalThis, function(root){
  "use strict";

  const DIRECTIONS = Object.freeze({
    navigateUp: "up",
    navigateDown: "down",
    navigateLeft: "left",
    navigateRight: "right",
  });

  function isTypingTarget(target){
    if(!target) return false;
    const tag = String(target.tagName || "").toUpperCase();
    return Boolean(target.isContentEditable)
      || tag === "TEXTAREA"
      || (tag === "INPUT" && !["button", "checkbox", "radio", "range", "submit"].includes(String(target.type || "text").toLowerCase()));
  }

  function isNativeActivationTarget(target){
    if(!target || typeof target.matches !== "function") return false;
    return target.matches("button, a[href], input, select, textarea, summary, [role='button'], [role='link'], [role='tab']");
  }

  function usesNativeDirectionalKeys(target){
    if(!target) return false;
    const tag = String(target.tagName || "").toUpperCase();
    if(tag === "SELECT") return true;
    if(tag !== "INPUT") return false;
    return ["date", "datetime-local", "month", "number", "range", "time", "week"].includes(String(target.type || "").toLowerCase());
  }

  function nextSectionIndex(currentIndex, count, delta){
    if(!Number.isInteger(count) || count <= 0) return -1;
    if(!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= count){
      return delta < 0 ? count - 1 : 0;
    }
    return (currentIndex + (delta < 0 ? -1 : 1) + count) % count;
  }

  function create(options = {}){
    const windowRef = options.window || root;
    const documentRef = options.document || windowRef.document;
    const Spatial = options.spatialNavigation || windowRef.CCSpatialNavigation;
    const Gamepads = options.gamepadController || windowRef.CCGamepadController;
    const Keyboard = options.keyboardControls || windowRef.CCKeyboardControls;
    if(!documentRef || !Spatial || !Gamepads || !Keyboard) return null;

    let previousFocus = null;
    let statusTimer = null;

    const help = documentRef.getElementById("cc-input-help");
    const helpPanel = help && help.querySelector(".cc-input-help-panel");
    const helpClose = documentRef.getElementById("cc-input-help-close");
    const helpButton = documentRef.getElementById("tb-input-help");
    const status = documentRef.getElementById("cc-controller-status");

    function isVisible(element){
      if(!element || element.hidden) return false;
      const style = windowRef.getComputedStyle?.(element);
      return !style || (style.display !== "none" && style.visibility !== "hidden");
    }

    function activeScope(){
      if(help && !help.hidden) return helpPanel || help;
      const kill = documentRef.getElementById("kill-confirm");
      if(kill && kill.classList.contains("on")) return kill;
      const caution = documentRef.getElementById("kb-wip-caution");
      if(isVisible(caution)) return caution.querySelector(".kb-pop-box") || caution;
      const kanban = documentRef.getElementById("kb-pop");
      if(isVisible(kanban)) return kanban.querySelector(".kb-pop-box") || kanban;
      return documentRef;
    }

    function candidateFilter(element){
      if(!element || element.closest("[data-controller-nav='off']")) return false;
      const sidebar = element.closest(".cc-sidebar");
      if(sidebar && sidebar.classList.contains("collapsed")) return false;
      const audioMenu = element.closest(".tb-audio-menu");
      if(audioMenu){
        const wrapper = audioMenu.closest(".tb-audio-wrap");
        if(!wrapper || !wrapper.classList.contains("open")) return false;
      }
      return true;
    }

    const spatial = Spatial.create({
      document: documentRef,
      getActiveScope: activeScope,
      candidateFilter,
      keyForElement(element){
        const tab = element && element.dataset && element.dataset.tab;
        if(tab) return `tab:${tab}`;
        return Spatial.defaultKeyForElement(element);
      },
    });

    function markInputMode(mode){
      if(documentRef.body) documentRef.body.dataset.inputMode = mode;
    }

    function showStatus(message){
      if(!status || !message) return;
      status.textContent = message;
      status.classList.add("show");
      if(statusTimer) windowRef.clearTimeout(statusTimer);
      statusTimer = windowRef.setTimeout(() => status.classList.remove("show"), 2200);
    }

    function openHelp(){
      if(!help || !help.hidden) return false;
      previousFocus = documentRef.activeElement;
      help.hidden = false;
      if(helpClose) helpClose.focus();
      return true;
    }

    function closeHelp(){
      if(!help || help.hidden) return false;
      help.hidden = true;
      if(previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
      previousFocus = null;
      return true;
    }

    function currentTabName(){
      return documentRef.querySelector(".tab-btn.active[data-tab]")?.dataset.tab || windowRef._ccCurrentTab || "home";
    }

    function focusPanel(name){
      const panel = documentRef.getElementById(`tab-${name}`);
      const target = spatial.candidates().find(element => panel?.contains(element));
      if(target) spatial.focus(target);
      else spatial.restore();
    }

    function showTab(name){
      if(typeof windowRef.showTab !== "function"){
        if(windowRef.location){ windowRef.location.href = `/#${name}`; return true; }
        return false;
      }
      windowRef.showTab(name);
      windowRef.requestAnimationFrame?.(() => focusPanel(name));
      return true;
    }

    function sectionButtons(){
      return Array.from(documentRef.querySelectorAll("button.tab-btn[data-tab]"));
    }

    function moveSection(delta){
      const buttons = sectionButtons();
      if(!buttons.length) return false;
      const current = buttons.findIndex(button => button.dataset.tab === currentTabName());
      const target = buttons[nextSectionIndex(current, buttons.length, delta)];
      return Boolean(target && showTab(target.dataset.tab));
    }

    function focusSidebar(){
      const shell = documentRef.querySelector(".app-shell");
      const collapsed = shell?.classList.contains("sidebar-collapsed");
      if(collapsed) documentRef.getElementById("cc-side-reopen")?.click();
      const target = documentRef.querySelector("button.tab-btn.active[data-tab]") || sectionButtons()[0];
      windowRef.requestAnimationFrame?.(() => spatial.focus(target));
      return Boolean(target);
    }

    function adjustRange(element, direction){
      if(!element || String(element.tagName || "").toUpperCase() !== "INPUT" || String(element.type).toLowerCase() !== "range") return false;
      try{
        if(direction < 0) element.stepDown();
        else element.stepUp();
      }catch(_error){ return false; }
      element.dispatchEvent(new windowRef.Event("input", {bubbles: true}));
      element.dispatchEvent(new windowRef.Event("change", {bubbles: true}));
      return true;
    }

    function arcadeVisible(){
      const panel = documentRef.getElementById("tab-arcade");
      return Boolean(panel && !panel.hidden && panel.style.display !== "none");
    }

    function arcadeDirection(action, source){
      if(!arcadeVisible() || !DIRECTIONS[action] || !windowRef.CCArcade?.isInputCaptured?.()) return false;
      if(source === "keyboard") return false;
      return Boolean(windowRef.CCArcade.handleDirection?.(DIRECTIONS[action]));
    }

    function goBack(detail = {}){
      if(closeHelp()) return true;
      const kill = documentRef.getElementById("kill-confirm");
      if(kill?.classList.contains("on")){
        documentRef.getElementById("kill-no")?.click();
        return true;
      }
      const caution = documentRef.getElementById("kb-wip-caution");
      if(isVisible(caution)){
        documentRef.getElementById("kb-wip-no")?.click();
        return true;
      }
      const kanban = documentRef.getElementById("kb-pop");
      if(isVisible(kanban)){
        documentRef.getElementById("kb-cancel")?.click();
        return true;
      }
      if(windowRef.CCArcade?.isInputCaptured?.()){
        windowRef.CCArcade.releaseInput?.();
        showStatus("Arcade controls released");
        return true;
      }
      if(windowRef.CCChess?.cancelSelection?.()) return true;
      if(windowRef.CCMusic?.handleInputAction?.("back", detail)) return true;
      const audio = documentRef.getElementById("tb-audio-wrap");
      if(audio?.classList.contains("open")){
        audio.classList.remove("open");
        return true;
      }
      if(isTypingTarget(documentRef.activeElement)){
        documentRef.activeElement.blur();
        return true;
      }
      return currentTabName() !== "home" && showTab("home");
    }

    function handleAction(action, detail = {}){
      const source = detail.source || "keyboard";
      markInputMode(source === "gamepad" ? "gamepad" : "keyboard");

      if(DIRECTIONS[action]){
        if(arcadeDirection(action, source)) return true;
        if(source === "keyboard" && arcadeVisible() && windowRef.CCArcade?.isInputCaptured?.()) return false;
        const active = documentRef.activeElement;
        if((action === "navigateLeft" || action === "navigateRight") && adjustRange(active, action === "navigateLeft" ? -1 : 1)) return true;
        if((action === "navigateLeft" || action === "navigateRight") && spatial.adjust?.(active, action === "navigateLeft" ? -1 : 1)) return true;
        return Boolean(spatial.move(DIRECTIONS[action]));
      }

      if(action === "select"){
        if(documentRef.activeElement?.id === "arc-stage" && windowRef.CCArcade?.captureInput?.()){
          showStatus("Arcade controls captured — press B or Escape to leave");
          return true;
        }
        if(source === "keyboard" && isNativeActivationTarget(documentRef.activeElement)) return false;
        if(isTypingTarget(documentRef.activeElement)) return false;
        return spatial.activate();
      }
      if(action === "back") return goBack(detail);
      if(activeScope() !== documentRef) return true;
      if(action === "secondaryAction"){
        if(windowRef.CCMusic?.handleInputAction?.(action, detail)) return true;
        documentRef.getElementById("tb-audio")?.click();
        return true;
      }
      if(action === "menu") return focusSidebar();
      if(action === "previousSection") return moveSection(-1);
      if(action === "nextSection") return moveSection(1);
      if(action === "home") return showTab("home");
      if(action === "help") return openHelp();
      return false;
    }

    function onKeydown(event){
      if(event.key === "Tab" && activeScope() !== documentRef){
        const items = spatial.candidates();
        if(items.length){
          const current = items.indexOf(documentRef.activeElement);
          const next = nextSectionIndex(current, items.length, event.shiftKey ? -1 : 1);
          spatial.focus(items[next]);
          event.preventDefault();
        }
        return;
      }
      const action = Keyboard.actionForEvent(event);
      if(!action) return;
      markInputMode("keyboard");
      if(isTypingTarget(event.target) && action !== "back") return;
      if(usesNativeDirectionalKeys(event.target) && action !== "back") return;
      if(handleAction(action, {source: "keyboard"})) event.preventDefault();
    }

    const gamepad = Gamepads.create({
      window: windowRef,
      document: documentRef,
      navigator: windowRef.navigator,
      onAction: handleAction,
      onStatus(nextStatus, detail){
        if(nextStatus === "connected"){
          const padNumber = Number.isInteger(detail.activeIndex) ? detail.activeIndex + 1 : 1;
          showStatus(`Controller ${padNumber} connected`);
        }else if(nextStatus === "disconnected") showStatus("Controller disconnected");
        else if(nextStatus === "unsupported" && detail.reason === "mapping") showStatus("Controller mapping is not supported");
      },
    });

    documentRef.addEventListener("keydown", onKeydown);
    documentRef.addEventListener("pointerdown", () => markInputMode("pointer"), {passive: true});
    helpClose?.addEventListener("click", closeHelp);
    helpButton?.addEventListener("click", openHelp);
    help?.addEventListener("click", event => { if(event.target === help) closeHelp(); });
    windowRef.addEventListener?.("pagehide", () => gamepad.stop());
    windowRef.addEventListener?.("pageshow", () => gamepad.start());
    gamepad.start();

    return {
      closeHelp,
      destroy(){
        gamepad.destroy();
        documentRef.removeEventListener("keydown", onKeydown);
        if(statusTimer) windowRef.clearTimeout(statusTimer);
      },
      gamepad,
      handleAction,
      openHelp,
      spatial,
    };
  }

  function start(){
    if(!root.document || root.__ccControllerNavigation) return root.__ccControllerNavigation || null;
    root.__ccControllerNavigation = create();
    return root.__ccControllerNavigation;
  }

  if(root.document){
    if(root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, {once: true});
    else start();
  }

  return {DIRECTIONS, create, isNativeActivationTarget, isTypingTarget, nextSectionIndex, start, usesNativeDirectionalKeys};
});
