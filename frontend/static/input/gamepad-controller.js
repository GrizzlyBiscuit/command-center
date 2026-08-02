/* Portions adapted from Taeyeon Media Player (MIT); see THIRD_PARTY_NOTICES.md. */
(function(root,factory){
  "use strict";

  const api=factory(root);
  if(root)root.CCGamepadController=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis,function(root){
  "use strict";

  const DEFAULTS=Object.freeze({
    buttonThreshold:0.5,
    deadzone:0.55,
    initialRepeatDelay:300,
    repeatInterval:100,
  });

  // Standard Gamepad mapping. Guide, triggers, and stick presses are
  // intentionally unbound so this adapter only reports application actions.
  const BUTTON_ACTIONS=Object.freeze([
    Object.freeze({index:0,action:"select",control:"a"}),
    Object.freeze({index:1,action:"back",control:"b"}),
    Object.freeze({index:2,action:"secondaryAction",control:"x"}),
    Object.freeze({index:3,action:"menu",control:"y"}),
    Object.freeze({index:4,action:"previousSection",control:"leftBumper"}),
    Object.freeze({index:5,action:"nextSection",control:"rightBumper"}),
    Object.freeze({index:8,action:"home",control:"view"}),
    Object.freeze({index:9,action:"help",control:"menu"}),
  ]);

  const REPEAT_ACTIONS=Object.freeze([
    Object.freeze({action:"navigateUp",dpadIndex:12,axisIndex:1,axisSign:-1,dpadControl:"dpadUp",axisControl:"leftStickUp"}),
    Object.freeze({action:"navigateDown",dpadIndex:13,axisIndex:1,axisSign:1,dpadControl:"dpadDown",axisControl:"leftStickDown"}),
    Object.freeze({action:"navigateLeft",dpadIndex:14,axisIndex:0,axisSign:-1,dpadControl:"dpadLeft",axisControl:"leftStickLeft"}),
    Object.freeze({action:"navigateRight",dpadIndex:15,axisIndex:0,axisSign:1,dpadControl:"dpadRight",axisControl:"leftStickRight"}),
  ]);

  function clamp(value,min,max){return Math.min(max,Math.max(min,value));}

  function buttonValue(button){
    if(typeof button==="number")return clamp(Number.isFinite(button)?button:0,0,1);
    const value=Number(button?.value);
    if(Number.isFinite(value))return clamp(value,0,1);
    return button?.pressed?1:0;
  }

  function isButtonPressed(button,threshold=DEFAULTS.buttonThreshold){
    return Boolean(button?.pressed)||buttonValue(button)>=threshold;
  }

  function axisValue(axes,index){
    const value=Number(axes?.[index]);
    return Number.isFinite(value)?clamp(value,-1,1):0;
  }

  function isStandardGamepad(gamepad){
    return Boolean(gamepad)&&gamepad.connected!==false&&gamepad.mapping==="standard";
  }

  function repeatControlSnapshot(gamepad,definition,deadzone,buttonThreshold){
    const dpadValue=buttonValue(gamepad.buttons?.[definition.dpadIndex]);
    const dpadDown=isButtonPressed(gamepad.buttons?.[definition.dpadIndex],buttonThreshold);
    const rawAxis=axisValue(gamepad.axes,definition.axisIndex);
    const axisAmount=definition.axisSign<0?-rawAxis:rawAxis;
    const axisDown=axisAmount>=deadzone;
    return {
      down:dpadDown||axisDown,
      value:dpadDown?dpadValue:Math.max(0,axisAmount),
      control:dpadDown?definition.dpadControl:definition.axisControl,
    };
  }

  /** Copy the mutable browser Gamepad object into a stable snapshot. */
  function snapshotGamepad(gamepad,options={}){
    if(!isStandardGamepad(gamepad))return null;
    const deadzone=Number.isFinite(options.deadzone)?options.deadzone:DEFAULTS.deadzone;
    const buttonThreshold=Number.isFinite(options.buttonThreshold)
      ?options.buttonThreshold
      :DEFAULTS.buttonThreshold;
    const buttons={};
    BUTTON_ACTIONS.forEach(definition=>{
      const value=buttonValue(gamepad.buttons?.[definition.index]);
      buttons[definition.action]={
        down:isButtonPressed(gamepad.buttons?.[definition.index],buttonThreshold),
        value,
        control:definition.control,
      };
    });
    const repeats={};
    REPEAT_ACTIONS.forEach(definition=>{
      repeats[definition.action]=repeatControlSnapshot(
        gamepad,
        definition,
        deadzone,
        buttonThreshold
      );
    });
    return {
      index:Number.isInteger(gamepad.index)?gamepad.index:0,
      id:String(gamepad.id||""),
      mapping:gamepad.mapping,
      browserTimestamp:Number.isFinite(Number(gamepad.timestamp))?Number(gamepad.timestamp):0,
      buttons,
      repeats,
    };
  }

  function hasRisingActivity(snapshot,previous){
    return BUTTON_ACTIONS.some(({action})=>
      snapshot.buttons[action].down&&!previous?.buttons?.[action]?.down
    )||REPEAT_ACTIONS.some(({action})=>
      snapshot.repeats[action].down&&!previous?.repeats?.[action]?.down
    );
  }

  /** Pick the newest browser timestamp, preserving the current pad on ties. */
  function chooseActiveIndex(snapshots,activityIndices,currentIndex){
    if(!snapshots.length)return null;
    const available=new Set(snapshots.map(snapshot=>snapshot.index));
    const candidates=snapshots.filter(snapshot=>activityIndices.includes(snapshot.index));
    if(candidates.length){
      const newest=Math.max(...candidates.map(snapshot=>snapshot.browserTimestamp));
      const newestCandidates=candidates.filter(snapshot=>snapshot.browserTimestamp===newest);
      if(newestCandidates.some(snapshot=>snapshot.index===currentIndex))return currentIndex;
      return newestCandidates[0].index;
    }
    if(available.has(currentIndex))return currentIndex;
    return snapshots[0].index;
  }

  /**
   * Advance a held-control repeat state without catch-up bursts after a slow
   * frame. Suppressed controls must be released before they can emit again.
   */
  function advanceRepeat(previous,isDown,time,options={}){
    const initialDelay=Number.isFinite(options.initialDelay)
      ?options.initialDelay
      :DEFAULTS.initialRepeatDelay;
    const interval=Number.isFinite(options.interval)?options.interval:DEFAULTS.repeatInterval;
    const enabled=options.enabled!==false;
    const state=previous||{down:false,nextAt:0,suppressed:false};
    if(!isDown){
      return {state:{down:false,nextAt:0,suppressed:false},fire:false,repeat:false};
    }
    if(!state.down){
      if(!enabled){
        return {state:{down:true,nextAt:Infinity,suppressed:true},fire:false,repeat:false};
      }
      return {
        state:{down:true,nextAt:time+initialDelay,suppressed:false},
        fire:true,
        repeat:false,
      };
    }
    if(state.suppressed||!enabled){
      return {
        state:{down:true,nextAt:Infinity,suppressed:true},
        fire:false,
        repeat:false,
      };
    }
    if(time>=state.nextAt){
      return {
        state:{down:true,nextAt:time+interval,suppressed:false},
        fire:true,
        repeat:true,
      };
    }
    return {state:{...state},fire:false,repeat:false};
  }

  function create(options={}){
    const windowRef=options.window||root;
    const documentRef=options.document||windowRef?.document||null;
    const navigatorRef=options.navigator||windowRef?.navigator||null;
    const onAction=typeof options.onAction==="function"?options.onAction:()=>{};
    const onStatus=typeof options.onStatus==="function"?options.onStatus:()=>{};
    const now=typeof options.now==="function"?options.now:()=>Date.now();
    const deadzone=Number.isFinite(options.deadzone)?options.deadzone:DEFAULTS.deadzone;
    const buttonThreshold=Number.isFinite(options.buttonThreshold)
      ?options.buttonThreshold
      :DEFAULTS.buttonThreshold;
    const initialRepeatDelay=Number.isFinite(options.initialRepeatDelay)
      ?options.initialRepeatDelay
      :DEFAULTS.initialRepeatDelay;
    const repeatInterval=Number.isFinite(options.repeatInterval)
      ?options.repeatInterval
      :DEFAULTS.repeatInterval;
    const fallbackRequest=callback=>windowRef.setTimeout(()=>callback(now()),16);
    const fallbackCancel=id=>windowRef.clearTimeout(id);
    const requestFrame=options.requestAnimationFrame
      ||windowRef?.requestAnimationFrame?.bind(windowRef)
      ||fallbackRequest;
    const cancelFrame=options.cancelAnimationFrame
      ||windowRef?.cancelAnimationFrame?.bind(windowRef)
      ||fallbackCancel;

    let running=false;
    let destroyed=false;
    let frameId=null;
    let activeIndex=null;
    let previousPads=new Map();
    let repeatStates=new Map();
    let status="disconnected";
    let statusSignature="";
    let connectedIndices=[];
    let inputEnabled=false;
    let needsPrime=true;
    let lifecycleListenersAttached=false;

    function markNeedsPrime(){needsPrime=true;}

    const lifecycleListeners=[
      [documentRef,"visibilitychange"],
      [windowRef,"blur"],
      [windowRef,"focus"],
      [windowRef,"pagehide"],
      [windowRef,"pageshow"],
    ];

    function attachLifecycleListeners(){
      if(lifecycleListenersAttached)return;
      lifecycleListeners.forEach(([target,event])=>target?.addEventListener?.(event,markNeedsPrime));
      lifecycleListenersAttached=true;
    }

    function detachLifecycleListeners(){
      if(!lifecycleListenersAttached)return;
      lifecycleListeners.forEach(([target,event])=>target?.removeEventListener?.(event,markNeedsPrime));
      lifecycleListenersAttached=false;
    }

    function pageIsActive(){
      if(documentRef?.hidden||documentRef?.visibilityState==="hidden")return false;
      if(typeof documentRef?.hasFocus==="function"&&!documentRef.hasFocus())return false;
      return true;
    }

    function statusDetail(reason,snapshots,unsupportedPads){
      return {
        reason,
        activeIndex,
        connectedIndices:snapshots.map(snapshot=>snapshot.index),
        unsupportedIndices:unsupportedPads.map(gamepad=>
          Number.isInteger(gamepad.index)?gamepad.index:0
        ),
        inputEnabled,
      };
    }

    function updateStatus(nextStatus,reason,snapshots=[],unsupportedPads=[]){
      status=nextStatus;
      connectedIndices=snapshots.map(snapshot=>snapshot.index);
      const detail=statusDetail(reason,snapshots,unsupportedPads);
      const signature=JSON.stringify([
        nextStatus,
        reason,
        detail.activeIndex,
        detail.connectedIndices,
        detail.unsupportedIndices,
      ]);
      if(signature===statusSignature)return;
      statusSignature=signature;
      onStatus(nextStatus,detail);
    }

    function actionDetail(snapshot,control,value,time,repeat){
      return {
        source:"gamepad",
        gamepadIndex:snapshot.index,
        gamepadId:snapshot.id,
        control,
        value,
        timestamp:time,
        repeat:Boolean(repeat),
      };
    }

    function emitButtonEdges(snapshot,previous,time,enabled){
      if(!enabled)return;
      BUTTON_ACTIONS.forEach(({action})=>{
        const current=snapshot.buttons[action];
        if(current.down&&!previous?.buttons?.[action]?.down){
          onAction(action,actionDetail(snapshot,current.control,current.value,time,false));
        }
      });
    }

    function updateRepeats(snapshot,time,enabled){
      let padStates=repeatStates.get(snapshot.index);
      if(!padStates){
        padStates=new Map();
        repeatStates.set(snapshot.index,padStates);
      }
      REPEAT_ACTIONS.forEach(({action})=>{
        const control=snapshot.repeats[action];
        const result=advanceRepeat(padStates.get(action),control.down,time,{
          enabled,
          initialDelay:initialRepeatDelay,
          interval:repeatInterval,
        });
        padStates.set(action,result.state);
        if(result.fire){
          onAction(action,actionDetail(
            snapshot,
            control.control,
            control.value,
            time,
            result.repeat
          ));
        }
      });
    }

    function removeMissingPadState(snapshots){
      const present=new Set(snapshots.map(snapshot=>snapshot.index));
      [...repeatStates.keys()].forEach(index=>{
        if(!present.has(index))repeatStates.delete(index);
      });
    }

    function readPads(){
      if(typeof navigatorRef?.getGamepads!=="function"){
        return {supported:false,reason:"gamepad-api",snapshots:[],unsupportedPads:[]};
      }
      let gamepads;
      try{gamepads=navigatorRef.getGamepads();}
      catch{
        return {supported:false,reason:"gamepad-api-error",snapshots:[],unsupportedPads:[]};
      }
      const all=Array.from(gamepads||[]).filter(gamepad=>gamepad&&gamepad.connected!==false);
      const standard=all.filter(isStandardGamepad);
      return {
        supported:true,
        reason:"",
        snapshots:standard.map(gamepad=>snapshotGamepad(gamepad,{deadzone,buttonThreshold})),
        unsupportedPads:all.filter(gamepad=>!isStandardGamepad(gamepad)),
      };
    }

    function poll(time=now()){
      if(destroyed)return;
      inputEnabled=pageIsActive();
      const primeCurrentInputs=inputEnabled&&needsPrime;
      const result=readPads();
      if(!result.supported){
        activeIndex=null;
        previousPads=new Map();
        repeatStates=new Map();
        updateStatus("unsupported",result.reason);
        return;
      }
      const {snapshots,unsupportedPads}=result;
      removeMissingPadState(snapshots);
      if(!snapshots.length){
        activeIndex=null;
        previousPads=new Map();
        updateStatus(
          unsupportedPads.length?"unsupported":"disconnected",
          unsupportedPads.length?"mapping":"no-gamepad",
          snapshots,
          unsupportedPads
        );
        if(inputEnabled)needsPrime=false;
        return;
      }

      const activityIndices=snapshots
        .filter(snapshot=>hasRisingActivity(snapshot,previousPads.get(snapshot.index)))
        .map(snapshot=>snapshot.index);
      activeIndex=chooseActiveIndex(snapshots,activityIndices,activeIndex);
      updateStatus("connected","standard",snapshots,unsupportedPads);

      snapshots.forEach(snapshot=>{
        const enabled=inputEnabled&&!primeCurrentInputs&&snapshot.index===activeIndex;
        emitButtonEdges(snapshot,previousPads.get(snapshot.index),time,enabled);
        updateRepeats(snapshot,time,enabled);
      });
      previousPads=new Map(snapshots.map(snapshot=>[snapshot.index,snapshot]));
      if(inputEnabled)needsPrime=false;
    }

    function tick(timestamp){
      if(!running||destroyed)return;
      try{poll(Number.isFinite(timestamp)?timestamp:now());}
      finally{
        if(running&&!destroyed)frameId=requestFrame(tick);
      }
    }

    function start(){
      if(destroyed)return false;
      if(running)return true;
      running=true;
      needsPrime=true;
      attachLifecycleListeners();
      statusSignature="";
      poll(now());
      if(running&&!destroyed)frameId=requestFrame(tick);
      return true;
    }

    function stop(){
      if(!running)return false;
      running=false;
      if(frameId!==null)cancelFrame(frameId);
      frameId=null;
      detachLifecycleListeners();
      needsPrime=true;
      previousPads=new Map();
      repeatStates=new Map();
      return true;
    }

    function destroy(){
      if(destroyed)return;
      stop();
      destroyed=true;
      activeIndex=null;
      connectedIndices=[];
    }

    function getState(){
      return {
        running,
        destroyed,
        status,
        activeIndex,
        connectedIndices:[...connectedIndices],
        inputEnabled,
      };
    }

    return {destroy,getState,start,stop};
  }

  return {
    BUTTON_ACTIONS,
    DEFAULTS,
    REPEAT_ACTIONS,
    advanceRepeat,
    buttonValue,
    chooseActiveIndex,
    create,
    isButtonPressed,
    isStandardGamepad,
    snapshotGamepad,
  };
});
