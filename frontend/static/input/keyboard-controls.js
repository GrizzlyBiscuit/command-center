/* Portions adapted from Taeyeon Media Player (MIT); see THIRD_PARTY_NOTICES.md. */
(function(root,factory){
  "use strict";

  const api=factory();
  if(root)root.CCKeyboardControls=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";

  const ACTIONS=Object.freeze({
    ArrowUp:"navigateUp",
    KeyW:"navigateUp",
    ArrowDown:"navigateDown",
    KeyS:"navigateDown",
    ArrowLeft:"navigateLeft",
    KeyA:"navigateLeft",
    ArrowRight:"navigateRight",
    KeyD:"navigateRight",
    Enter:"select",
    NumpadEnter:"select",
    Space:"select",
    Escape:"back",
    KeyX:"secondaryAction",
    KeyY:"menu",
    ContextMenu:"menu",
    KeyQ:"previousSection",
    KeyE:"nextSection",
    Home:"home",
    F1:"help",
  });

  function eventCode(event){
    return typeof event?.code==="string"&&event.code
      ?event.code
      :typeof event?.key==="string"
        ?event.key
        :"";
  }

  function getAttribute(element,name){
    try{return typeof element?.getAttribute==="function"?element.getAttribute(name):null;}
    catch(_error){return null;}
  }

  /** True when app shortcuts should yield to a native editing/control surface. */
  function isNativeInputTarget(target){
    let current=target||null;
    while(current){
      const tag=String(current.tagName||"").toUpperCase();
      if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return true;
      if(current.isContentEditable)return true;
      const editable=getAttribute(current,"contenteditable");
      if(editable!==null&&String(editable).toLowerCase()!=="false")return true;
      const role=String(getAttribute(current,"role")||"").toLowerCase();
      if([
        "combobox","listbox","searchbox","slider","spinbutton","textbox",
      ].includes(role))return true;
      current=current.parentElement||null;
    }
    return false;
  }

  /** Map a keyboard event to a semantic app action without consuming it. */
  function actionForEvent(event,options={}){
    if(!event||event.altKey)return null;
    const code=eventCode(event);
    if(code==="Escape"&&!event.ctrlKey&&!event.metaKey)return "back";
    if(options.allowNativeTarget!==true&&isNativeInputTarget(event.target))return null;
    if(event.ctrlKey||event.metaKey){
      if(code==="ArrowLeft")return "previousSection";
      if(code==="ArrowRight")return "nextSection";
      return null;
    }
    if(code==="Slash"&&event.shiftKey)return "help";
    return ACTIONS[code]||null;
  }

  return {ACTIONS,actionForEvent,eventCode,isNativeInputTarget};
});
