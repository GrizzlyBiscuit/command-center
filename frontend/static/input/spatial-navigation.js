/* Portions adapted from Taeyeon Media Player (MIT); see THIRD_PARTY_NOTICES.md. */
(function(root,factory){
  "use strict";

  const api=factory(root);
  if(root)root.CCSpatialNavigation=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis,function(root){
  "use strict";

  const DIRECTIONS=Object.freeze(["up","down","left","right"]);
  const DEFAULT_SELECTOR=[
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[tabindex]",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='option']",
    "[data-spatial-key]",
  ].join(",");

  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

  function normalizeRect(rect){
    if(!rect)return null;
    const left=finite(rect.left,finite(rect.x));
    const top=finite(rect.top,finite(rect.y));
    const suppliedRight=Number(rect.right);
    const suppliedBottom=Number(rect.bottom);
    const suppliedWidth=Number(rect.width);
    const suppliedHeight=Number(rect.height);
    const right=Number.isFinite(suppliedRight)
      ?suppliedRight
      :left+(Number.isFinite(suppliedWidth)?suppliedWidth:0);
    const bottom=Number.isFinite(suppliedBottom)
      ?suppliedBottom
      :top+(Number.isFinite(suppliedHeight)?suppliedHeight:0);
    const width=Math.max(0,Number.isFinite(suppliedWidth)?suppliedWidth:right-left);
    const height=Math.max(0,Number.isFinite(suppliedHeight)?suppliedHeight:bottom-top);
    return {
      left,
      top,
      right:left+width,
      bottom:top+height,
      width,
      height,
      centerX:left+width/2,
      centerY:top+height/2,
    };
  }

  function intervalGap(startA,endA,startB,endB){
    if(endA<startB)return startB-endA;
    if(endB<startA)return startA-endB;
    return 0;
  }

  /**
   * Return a lower-is-better score, or Infinity when the candidate is not in
   * the requested direction. Aligned candidates receive a modest preference.
   */
  function scoreCandidate(originValue,candidateValue,direction,options={}){
    const origin=normalizeRect(originValue);
    const candidate=normalizeRect(candidateValue);
    if(!origin||!candidate||!DIRECTIONS.includes(direction))return Infinity;

    const horizontal=direction==="left"||direction==="right";
    const sign=direction==="left"||direction==="up"?-1:1;
    const originMain=horizontal?origin.centerX:origin.centerY;
    const candidateMain=horizontal?candidate.centerX:candidate.centerY;
    const mainDistance=(candidateMain-originMain)*sign;
    if(mainDistance<=finite(options.directionEpsilon,0.5))return Infinity;

    let mainGap;
    if(direction==="right")mainGap=Math.max(0,candidate.left-origin.right);
    else if(direction==="left")mainGap=Math.max(0,origin.left-candidate.right);
    else if(direction==="down")mainGap=Math.max(0,candidate.top-origin.bottom);
    else mainGap=Math.max(0,origin.top-candidate.bottom);

    const crossGap=horizontal
      ?intervalGap(origin.top,origin.bottom,candidate.top,candidate.bottom)
      :intervalGap(origin.left,origin.right,candidate.left,candidate.right);
    const crossDistance=Math.abs(
      (horizontal?candidate.centerY:candidate.centerX)
      -(horizontal?origin.centerY:origin.centerX)
    );
    const originCrossSize=horizontal?origin.height:origin.width;
    const beamPenalty=crossGap===0
      ?0
      :finite(options.offAxisPenalty,Math.max(40,originCrossSize/2));
    return mainGap
      +mainDistance*finite(options.mainCenterWeight,0.01)
      +crossGap*finite(options.crossAxisWeight,2)
      +crossDistance*finite(options.crossCenterWeight,0.001)
      +beamPenalty;
  }

  function readRect(item,getRect){
    try{
      return normalizeRect(getRect
        ?getRect(item)
        :typeof item?.getBoundingClientRect==="function"
          ?item.getBoundingClientRect()
          :item?.rect||item);
    }catch(_error){
      return null;
    }
  }

  function findBestCandidate(origin,candidates,direction,options={}){
    let best=null;
    let bestScore=Infinity;
    const getRect=options.getRect;
    for(const candidate of candidates||[]){
      const score=scoreCandidate(origin,readRect(candidate,getRect),direction,options);
      if(score<bestScore){
        best=candidate;
        bestScore=score;
      }
    }
    return best;
  }

  function findClosestCandidate(originValue,candidates,options={}){
    const origin=normalizeRect(originValue);
    if(!origin)return null;
    let best=null;
    let bestScore=Infinity;
    for(const candidate of candidates||[]){
      const rect=readRect(candidate,options.getRect);
      if(!rect)continue;
      const x=rect.centerX-origin.centerX;
      const y=rect.centerY-origin.centerY;
      const score=x*x+y*y;
      if(score<bestScore){
        best=candidate;
        bestScore=score;
      }
    }
    return best;
  }

  function findEntryCandidate(candidates,direction,options={}){
    const entries=(candidates||[])
      .map((candidate,index)=>({candidate,index,rect:readRect(candidate,options.getRect)}))
      .filter(entry=>entry.rect);
    entries.sort((a,b)=>{
      let primary;
      let secondary;
      if(direction==="left"){
        primary=b.rect.right-a.rect.right;
        secondary=a.rect.top-b.rect.top;
      }else if(direction==="up"){
        primary=b.rect.bottom-a.rect.bottom;
        secondary=a.rect.left-b.rect.left;
      }else if(direction==="right"){
        primary=a.rect.left-b.rect.left;
        secondary=a.rect.top-b.rect.top;
      }else{
        primary=a.rect.top-b.rect.top;
        secondary=a.rect.left-b.rect.left;
      }
      return primary||secondary||a.index-b.index;
    });
    return entries[0]?.candidate||null;
  }

  function getAttribute(element,name){
    try{return typeof element?.getAttribute==="function"?element.getAttribute(name):null;}
    catch(_error){return null;}
  }

  function defaultKeyForElement(element){
    const spatial=getAttribute(element,"data-spatial-key")??element?.dataset?.spatialKey;
    if(spatial!==null&&spatial!==undefined&&String(spatial)!=="")return `spatial:${spatial}`;
    const id=getAttribute(element,"id")??element?.id;
    if(id!==null&&id!==undefined&&String(id)!=="")return `id:${id}`;
    return null;
  }

  function unavailableInTree(element,scope,getStyle){
    let current=element;
    while(current){
      if(current.hidden||current.inert||getAttribute(current,"aria-hidden")==="true")return true;
      if(typeof getStyle==="function"){
        let style;
        try{style=getStyle(current);}catch(_error){style=null;}
        if(style&&(
          style.display==="none"
          ||style.visibility==="hidden"
          ||style.visibility==="collapse"
        ))return true;
      }
      if(current===scope)break;
      current=current.parentElement||null;
    }
    return false;
  }

  function isVisibleCandidate(element,options={}){
    if(
      !element
      ||element.isConnected===false
      ||element.disabled
      ||getAttribute(element,"aria-disabled")==="true"
    )return false;
    const scope=options.scope;
    if(
      scope
      &&scope!==options.document
      &&typeof scope.contains==="function"
      &&!scope.contains(element)
    )return false;
    if(unavailableInTree(element,scope,options.getComputedStyle))return false;
    const rect=readRect(element,options.getRect);
    return Boolean(rect&&rect.width>0&&rect.height>0);
  }

  function isAdjustableControl(element){
    const tag=String(element?.tagName||"").toUpperCase();
    return tag==="SELECT"||(tag==="INPUT"&&String(element?.type||"").toLowerCase()==="date");
  }

  function dispatchControlChange(element,options={}){
    if(typeof element?.dispatchEvent!=="function")return;
    const createEvent=options.createEvent||(type=>new root.Event(type,{bubbles:true}));
    element.dispatchEvent(createEvent("input"));
    element.dispatchEvent(createEvent("change"));
  }

  /** Adjust native picker controls without depending on an untrusted click. */
  function adjustControl(element,delta,options={}){
    if(
      !isAdjustableControl(element)
      ||!Number.isFinite(Number(delta))
      ||Number(delta)===0
    )return false;
    const direction=Number(delta)<0?-1:1;
    const tag=String(element.tagName||"").toUpperCase();
    if(tag==="SELECT"){
      const choices=Array.from(element.options||[]);
      let index=Number.isInteger(element.selectedIndex)?element.selectedIndex:-1;
      if(index<0)index=direction>0?-1:choices.length;
      do{index+=direction;}while(choices[index]?.disabled);
      if(index<0||index>=choices.length){
        if(!options.wrap)return false;
        index=direction>0?0:choices.length-1;
        while(choices[index]?.disabled)index+=direction;
        if(index<0||index>=choices.length)return false;
      }
      element.selectedIndex=index;
    }else{
      const before=String(element.value||"");
      try{
        if(direction>0)element.stepUp();
        else element.stepDown();
      }catch(_error){return false;}
      if(String(element.value||"")===before)return false;
    }
    dispatchControlChange(element,options);
    return true;
  }

  function create(options={}){
    const doc=options.document||root?.document||null;
    const getStyle=options.getComputedStyle
      ||(typeof root?.getComputedStyle==="function"?root.getComputedStyle.bind(root):null);
    const getRect=options.getRect;
    const keyForElement=options.keyForElement||defaultKeyForElement;
    let memory=null;

    function activeScope(){
      const source=options.getActiveScope
        ??options.getScope
        ??options.activeScope
        ??options.scope;
      const resolved=typeof source==="function"?source():source;
      return resolved||doc;
    }

    function candidates(){
      const scope=activeScope();
      let source;
      if(typeof options.getCandidates==="function")source=options.getCandidates(scope);
      else if(scope&&typeof scope.querySelectorAll==="function"){
        source=scope.querySelectorAll(options.candidateSelector||DEFAULT_SELECTOR);
      }else source=[];
      const unique=[];
      const seen=new Set();
      for(const element of Array.from(source||[])){
        if(seen.has(element))continue;
        seen.add(element);
        if(!isVisibleCandidate(element,{
          scope,
          document:doc,
          getComputedStyle:getStyle,
          getRect,
        }))continue;
        if(
          typeof options.candidateFilter==="function"
          &&!options.candidateFilter(element,scope)
        )continue;
        unique.push(element);
      }
      return unique;
    }

    function copyMemory(){
      return memory?{key:memory.key,rect:{...memory.rect}}:null;
    }

    function remember(element){
      const rect=readRect(element,getRect);
      if(!rect)return null;
      let key=null;
      try{key=keyForElement(element);}catch(_error){key=null;}
      memory={key:key??null,rect:{...rect}};
      return copyMemory();
    }

    function keyMatches(element,key){
      if(key===null||key===undefined)return false;
      try{return keyForElement(element)===key;}catch(_error){return false;}
    }

    function activeCandidate(items){
      let active;
      try{
        active=typeof options.getActiveElement==="function"
          ?options.getActiveElement()
          :doc?.activeElement;
      }catch(_error){active=null;}
      return items.includes(active)?active:null;
    }

    function rememberedCandidate(items){
      if(!memory||memory.key===null)return null;
      return items.find(element=>keyMatches(element,memory.key))||null;
    }

    function focusElement(element){
      if(!element||typeof element.focus!=="function")return false;
      try{element.focus({preventScroll:true});}
      catch(_error){
        try{element.focus();}catch(_fallbackError){return false;}
      }
      if(options.scroll!==false&&typeof element.scrollIntoView==="function"){
        const scrollOptions=options.scrollOptions
          ||{block:"nearest",inline:"nearest",behavior:"auto"};
        try{element.scrollIntoView(scrollOptions);}
        catch(_error){
          try{element.scrollIntoView();}catch(_fallbackError){/* Focus still succeeded. */}
        }
      }
      remember(element);
      return true;
    }

    function focus(element){
      if(!candidates().includes(element))return false;
      return focusElement(element);
    }

    function restore(){
      const items=candidates();
      if(!items.length)return null;
      const active=activeCandidate(items);
      if(active){remember(active);return active;}
      const target=rememberedCandidate(items)
        ||(memory&&findClosestCandidate(memory.rect,items,{getRect}))
        ||findEntryCandidate(items,"down",{getRect});
      return focusElement(target)?target:null;
    }

    function move(direction){
      if(!DIRECTIONS.includes(direction)){
        throw new TypeError(`Unknown spatial direction: ${direction}`);
      }
      const items=candidates();
      if(!items.length)return null;
      const active=activeCandidate(items);
      if(active)remember(active);
      const replacement=active||rememberedCandidate(items);
      const origin=readRect(replacement,getRect)||memory?.rect||null;
      let target=origin
        ?findBestCandidate(
          origin,
          items.filter(item=>item!==replacement),
          direction,
          {...options,getRect}
        )
        :null;
      if(!target&&replacement&&!active)target=replacement;
      if(!target&&!origin)target=findEntryCandidate(items,direction,{getRect});
      if(!target&&memory&&!replacement)target=findClosestCandidate(memory.rect,items,{getRect});
      return focusElement(target)?target:null;
    }

    function current(){
      const items=candidates();
      return activeCandidate(items)||rememberedCandidate(items)||null;
    }

    function activate(element){
      const items=candidates();
      let target=element;
      if(target&&!items.includes(target))return false;
      if(!target)target=activeCandidate(items)||rememberedCandidate(items);
      if(!target)target=restore();
      else if(!activeCandidate(items))focusElement(target);
      if(!target||typeof target.click!=="function")return false;
      remember(target);
      target.click();
      return true;
    }

    function adjust(element,delta,adjustOptions={}){
      const items=candidates();
      if(!items.includes(element)||!isAdjustableControl(element))return false;
      remember(element);
      return adjustControl(element,delta,{...options,...adjustOptions});
    }

    function forget(){memory=null;}

    return {
      activate,
      adjust,
      candidates,
      current,
      focus,
      forget,
      getMemory:copyMemory,
      move,
      remember,
      restore,
    };
  }

  return {
    DEFAULT_SELECTOR,
    DIRECTIONS,
    adjustControl,
    create,
    defaultKeyForElement,
    findBestCandidate,
    findClosestCandidate,
    findEntryCandidate,
    isAdjustableControl,
    isVisibleCandidate,
    normalizeRect,
    scoreCandidate,
  };
});
