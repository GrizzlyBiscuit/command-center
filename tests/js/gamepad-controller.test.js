const assert=require("node:assert/strict");
const test=require("node:test");
const path=require("node:path");

global.window={};
const Gamepads=require(path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "static",
  "input",
  "gamepad-controller.js"
));

function button(input=false){
  if(typeof input==="number")return {pressed:input>=0.5,value:input};
  if(input&&typeof input==="object")return {...input};
  return {pressed:Boolean(input),value:input?1:0};
}

function gamepad({
  index=0,
  id=`Xbox pad ${index}`,
  mapping="standard",
  connected=true,
  timestamp=0,
  buttons={},
  axes=[0,0,0,0],
}={}){
  const values=Array.from({length:17},()=>button());
  Object.entries(buttons).forEach(([buttonIndex,value])=>{
    values[Number(buttonIndex)]=button(value);
  });
  return {index,id,mapping,connected,timestamp,buttons:values,axes:[...axes]};
}

function fakeScheduler(){
  let currentTime=0;
  let nextId=1;
  const callbacks=new Map();
  return {
    now:()=>currentTime,
    request(callback){
      const id=nextId++;
      callbacks.set(id,callback);
      return id;
    },
    cancel(id){callbacks.delete(id);},
    step(time){
      currentTime=time;
      const pending=[...callbacks.values()];
      callbacks.clear();
      pending.forEach(callback=>callback(time));
    },
    get pending(){return callbacks.size;},
  };
}

function fakeEventTarget(properties={}){
  const listeners=new Map();
  return Object.assign(properties,{
    addEventListener(type,listener){
      if(!listeners.has(type))listeners.set(type,new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);},
    dispatch(type){
      [...(listeners.get(type)||[])].forEach(listener=>listener({type,target:this}));
    },
  });
}

function harness(initialPads=[],extraOptions={}){
  let pads=initialPads;
  let focused=true;
  const scheduler=fakeScheduler();
  const actions=[];
  const statuses=[];
  const document=fakeEventTarget({
    hidden:false,
    visibilityState:"visible",
    hasFocus:()=>focused,
  });
  const navigator={getGamepads:()=>pads};
  const windowRef=fakeEventTarget({document,navigator,setTimeout,clearTimeout});
  const controller=Gamepads.create({
    window:windowRef,
    document,
    navigator,
    now:scheduler.now,
    requestAnimationFrame:callback=>scheduler.request(callback),
    cancelAnimationFrame:id=>scheduler.cancel(id),
    onAction:(action,detail)=>actions.push({action,detail}),
    onStatus:(status,detail)=>statuses.push({status,detail}),
    ...extraOptions,
  });
  return {
    actions,
    controller,
    document,
    navigator,
    scheduler,
    statuses,
    window:windowRef,
    setFocused(value){focused=value;},
    setPads(value){pads=value;},
  };
}

test("publishes the generic mapping through CommonJS and the browser global",()=>{
  assert.equal(window.CCGamepadController,Gamepads);
  assert.deepEqual(Gamepads.BUTTON_ACTIONS.map(({action})=>action),[
    "select",
    "back",
    "secondaryAction",
    "menu",
    "previousSection",
    "nextSection",
    "home",
    "help",
  ]);
  assert.deepEqual(Gamepads.REPEAT_ACTIONS.map(({action})=>action),[
    "navigateUp","navigateDown","navigateLeft","navigateRight",
  ]);
  assert.ok(Object.isFrozen(Gamepads.BUTTON_ACTIONS));
  assert.ok(Object.isFrozen(Gamepads.REPEAT_ACTIONS));
});

test("pure helpers normalize buttons and accept connected standard pads",()=>{
  assert.equal(Gamepads.buttonValue(undefined),0);
  assert.equal(Gamepads.buttonValue({pressed:true}),1);
  assert.equal(Gamepads.buttonValue({pressed:false,value:1.5}),1);
  assert.equal(Gamepads.buttonValue(-0.4),0);
  assert.equal(Gamepads.isButtonPressed({pressed:false,value:0.49}),false);
  assert.equal(Gamepads.isButtonPressed({pressed:false,value:0.5}),true);
  assert.equal(Gamepads.isStandardGamepad(gamepad()),true);
  assert.equal(Gamepads.isStandardGamepad(gamepad({mapping:""})),false);
  assert.equal(Gamepads.isStandardGamepad(gamepad({connected:false})),false);
});

test("snapshotGamepad applies deadzones and gives D-pad controls precedence",()=>{
  const below=Gamepads.snapshotGamepad(gamepad({axes:[0.54,-0.54,0,-1]}));
  assert.equal(below.repeats.navigateRight.down,false);
  assert.equal(below.repeats.navigateUp.down,false);
  assert.equal(Object.hasOwn(below.repeats,"volumeUp"),false);

  const active=Gamepads.snapshotGamepad(gamepad({
    axes:[0.75,-0.8,0,1],
    buttons:{12:true},
  }));
  assert.deepEqual(active.repeats.navigateUp,{down:true,value:1,control:"dpadUp"});
  assert.deepEqual(active.repeats.navigateRight,{
    down:true,value:0.75,control:"leftStickRight",
  });
  assert.equal(active.repeats.navigateDown.down,false);
  assert.equal(active.buttons.select.down,false);
});

test("advanceRepeat fires immediately, then at delay and interval boundaries",()=>{
  let result=Gamepads.advanceRepeat(undefined,true,10,{});
  assert.equal(result.fire,true);
  assert.equal(result.repeat,false);
  assert.equal(result.state.nextAt,310);

  result=Gamepads.advanceRepeat(result.state,true,309,{});
  assert.equal(result.fire,false);
  result=Gamepads.advanceRepeat(result.state,true,310,{});
  assert.equal(result.fire,true);
  assert.equal(result.repeat,true);
  assert.equal(result.state.nextAt,410);

  result=Gamepads.advanceRepeat(result.state,true,900,{});
  assert.equal(result.fire,true);
  assert.equal(result.state.nextAt,1000,"slow frames do not cause catch-up bursts");
  result=Gamepads.advanceRepeat(result.state,false,901,{});
  assert.deepEqual(result.state,{down:false,nextAt:0,suppressed:false});
});

test("disabled repeat controls remain suppressed until released",()=>{
  let result=Gamepads.advanceRepeat(undefined,true,0,{enabled:false});
  assert.equal(result.fire,false);
  assert.equal(result.state.suppressed,true);
  result=Gamepads.advanceRepeat(result.state,true,1000,{enabled:true});
  assert.equal(result.fire,false);
  result=Gamepads.advanceRepeat(result.state,false,1001,{enabled:true});
  result=Gamepads.advanceRepeat(result.state,true,1002,{enabled:true});
  assert.equal(result.fire,true);
});

test("mapped buttons emit rising edges while media-oriented controls stay unbound",()=>{
  const h=harness([gamepad()]);
  h.controller.start();
  h.setPads([gamepad({timestamp:10,buttons:{
    0:true,
    1:true,
    2:true,
    3:true,
    4:true,
    5:true,
    6:0.75,
    7:0.8,
    8:true,
    9:true,
    10:true,
    11:true,
    16:true,
  }})]);
  h.scheduler.step(10);

  assert.deepEqual(h.actions.map(call=>call.action),[
    "select","back","secondaryAction","menu","previousSection","nextSection","home","help",
  ]);
  assert.ok(h.actions.every(call=>call.detail.source==="gamepad"));
  assert.ok(h.actions.every(call=>call.detail.repeat===false));
  assert.ok(!h.actions.some(call=>[
    "leftTrigger","rightTrigger","leftStickPress","rightStickPress","guide",
  ].includes(call.detail.control)));

  h.setPads([gamepad({timestamp:11,buttons:{0:true,2:true,6:0.9}})]);
  h.scheduler.step(11);
  assert.equal(h.actions.length,8,"held action buttons do not repeat");

  h.setPads([gamepad({timestamp:12})]);
  h.scheduler.step(12);
  h.setPads([gamepad({timestamp:13,buttons:{2:true}})]);
  h.scheduler.step(13);
  assert.equal(h.actions.at(-1).action,"secondaryAction");
  assert.equal(h.actions.length,9,"a release permits the next rising edge");
});

test("D-pad and left stick use immediate, delayed, and interval navigation",()=>{
  const h=harness([gamepad()]);
  h.controller.start();
  h.setPads([gamepad({timestamp:10,buttons:{12:true}})]);
  h.scheduler.step(10);
  assert.deepEqual(h.actions.map(call=>[call.action,call.detail.repeat]),[
    ["navigateUp",false],
  ]);

  h.scheduler.step(309);
  assert.equal(h.actions.length,1);
  h.scheduler.step(310);
  assert.deepEqual(h.actions.at(-1),{
    action:"navigateUp",
    detail:{
      source:"gamepad",
      gamepadIndex:0,
      gamepadId:"Xbox pad 0",
      control:"dpadUp",
      value:1,
      timestamp:310,
      repeat:true,
    },
  });
  h.scheduler.step(409);
  assert.equal(h.actions.length,2);
  h.scheduler.step(410);
  assert.equal(h.actions.length,3);

  h.setPads([gamepad({timestamp:420})]);
  h.scheduler.step(420);
  h.setPads([gamepad({timestamp:430,axes:[-0.54,0,0,0]})]);
  h.scheduler.step(430);
  assert.equal(h.actions.length,3);
  h.setPads([gamepad({timestamp:440,axes:[-0.56,0,0,0]})]);
  h.scheduler.step(440);
  assert.equal(h.actions.at(-1).action,"navigateLeft");
  assert.equal(h.actions.at(-1).detail.control,"leftStickLeft");
});

test("the most recently active standard pad owns emitted actions",()=>{
  const h=harness([gamepad({index:0}),gamepad({index:1})]);
  h.controller.start();
  assert.equal(h.controller.getState().activeIndex,0);

  h.setPads([
    gamepad({index:0,timestamp:1}),
    gamepad({index:1,timestamp:10,buttons:{0:true}}),
  ]);
  h.scheduler.step(10);
  assert.equal(h.controller.getState().activeIndex,1);
  assert.equal(h.actions.at(-1).detail.gamepadIndex,1);

  h.setPads([
    gamepad({index:0,timestamp:20,buttons:{2:true}}),
    gamepad({index:1,timestamp:11}),
  ]);
  h.scheduler.step(20);
  assert.equal(h.controller.getState().activeIndex,0);
  assert.equal(h.actions.at(-1).action,"secondaryAction");
  assert.equal(h.actions.at(-1).detail.gamepadIndex,0);

  h.setPads([gamepad({index:0,timestamp:21}),gamepad({index:1,timestamp:21})]);
  h.scheduler.step(21);
  h.setPads([
    gamepad({index:0,timestamp:100,buttons:{0:true}}),
    gamepad({index:1,timestamp:200,buttons:{0:true}}),
  ]);
  h.scheduler.step(22);
  assert.equal(h.controller.getState().activeIndex,1,"newer browser timestamp wins");
  assert.equal(h.actions.at(-1).detail.gamepadIndex,1);
});

test("visibility and focus suspend input until held controls are released",()=>{
  const h=harness([gamepad()]);
  h.controller.start();
  h.document.hidden=true;
  h.document.visibilityState="hidden";
  h.setPads([gamepad({timestamp:10,buttons:{0:true},axes:[0,-0.8,0,0]})]);
  h.scheduler.step(10);
  assert.equal(h.actions.length,0);
  assert.equal(h.controller.getState().inputEnabled,false);

  h.document.hidden=false;
  h.document.visibilityState="visible";
  h.scheduler.step(20);
  assert.equal(h.actions.length,0,"held controls do not fire on visibility restoration");
  h.setPads([gamepad({timestamp:30})]);
  h.scheduler.step(30);
  h.setPads([gamepad({timestamp:40,buttons:{0:true},axes:[0,-0.8,0,0]})]);
  h.scheduler.step(40);
  assert.deepEqual(h.actions.map(call=>call.action),["select","navigateUp"]);

  h.setFocused(false);
  h.setPads([gamepad({timestamp:50})]);
  h.scheduler.step(50);
  h.setPads([gamepad({timestamp:60,buttons:{2:true}})]);
  h.scheduler.step(60);
  assert.equal(h.actions.length,2);
  h.setFocused(true);
  h.scheduler.step(70);
  assert.equal(h.actions.length,2,"held buttons do not fire on focus restoration");
  h.setPads([gamepad({timestamp:80})]);
  h.scheduler.step(80);
  h.setPads([gamepad({timestamp:90,buttons:{2:true}})]);
  h.scheduler.step(90);
  assert.equal(h.actions.at(-1).action,"secondaryAction");
});

test("lifecycle priming suppresses controls held while frames are suspended",()=>{
  const h=harness([gamepad()]);
  h.controller.start();
  h.document.hidden=true;
  h.document.visibilityState="hidden";
  h.document.dispatch("visibilitychange");

  h.setPads([gamepad({timestamp:10,buttons:{0:true},axes:[0,-0.8,0,0]})]);
  h.document.hidden=false;
  h.document.visibilityState="visible";
  h.document.dispatch("visibilitychange");
  h.scheduler.step(20);
  assert.equal(h.actions.length,0,"first visible snapshot primes held controls");

  h.setPads([gamepad({timestamp:30})]);
  h.scheduler.step(30);
  h.setPads([gamepad({timestamp:40,buttons:{0:true},axes:[0,-0.8,0,0]})]);
  h.scheduler.step(40);
  assert.deepEqual(h.actions.map(call=>call.action),["select","navigateUp"]);
});

test("restart priming suppresses controls held across stop and start",()=>{
  const h=harness([gamepad()]);
  h.controller.start();
  h.controller.stop();
  h.setPads([gamepad({timestamp:10,buttons:{2:true},axes:[0,0.8,0,0]})]);
  h.controller.start();
  assert.equal(h.actions.length,0,"start primes held controls synchronously");

  h.setPads([gamepad({timestamp:20})]);
  h.scheduler.step(20);
  h.setPads([gamepad({timestamp:30,buttons:{2:true},axes:[0,0.8,0,0]})]);
  h.scheduler.step(30);
  assert.deepEqual(h.actions.map(call=>call.action),["secondaryAction","navigateDown"]);
});

test("status reports unsupported APIs, mappings, connection, and disconnection",()=>{
  const unsupported=[];
  const noApi=Gamepads.create({
    window:{navigator:{},document:{hidden:false,hasFocus:()=>true},setTimeout,clearTimeout},
    navigator:{},
    document:{hidden:false,hasFocus:()=>true},
    requestAnimationFrame:()=>1,
    cancelAnimationFrame:()=>{},
    onStatus:(status,detail)=>unsupported.push({status,detail}),
  });
  noApi.start();
  assert.equal(unsupported[0].status,"unsupported");
  assert.equal(unsupported[0].detail.reason,"gamepad-api");
  noApi.destroy();

  const h=harness([gamepad({mapping:"xinput"})]);
  h.controller.start();
  assert.equal(h.statuses.at(-1).status,"unsupported");
  assert.equal(h.statuses.at(-1).detail.reason,"mapping");
  assert.deepEqual(h.statuses.at(-1).detail.unsupportedIndices,[0]);

  h.setPads([gamepad({index:2})]);
  h.scheduler.step(10);
  assert.equal(h.statuses.at(-1).status,"connected");
  assert.equal(h.statuses.at(-1).detail.activeIndex,2);
  assert.deepEqual(h.statuses.at(-1).detail.connectedIndices,[2]);

  const count=h.statuses.length;
  h.scheduler.step(20);
  assert.equal(h.statuses.length,count,"unchanged statuses are not repeated each frame");
  h.setPads([]);
  h.scheduler.step(30);
  assert.equal(h.statuses.at(-1).status,"disconnected");
  assert.equal(h.statuses.at(-1).detail.reason,"no-gamepad");
});

test("getGamepads failures report unsupported without breaking the loop",()=>{
  const h=harness([]);
  h.navigator.getGamepads=()=>{throw new Error("permission denied");};
  h.controller.start();
  assert.equal(h.statuses.at(-1).status,"unsupported");
  assert.equal(h.statuses.at(-1).detail.reason,"gamepad-api-error");
  assert.equal(h.scheduler.pending,1);
});

test("start, stop, and destroy own their scheduler lifecycle",()=>{
  const h=harness([gamepad()]);
  assert.equal(h.controller.getState().running,false);
  assert.equal(h.controller.start(),true);
  assert.equal(h.controller.start(),true,"start is idempotent");
  assert.equal(h.scheduler.pending,1);
  assert.equal(h.controller.stop(),true);
  assert.equal(h.controller.stop(),false,"stop is idempotent");
  assert.equal(h.scheduler.pending,0);
  assert.equal(h.controller.getState().running,false);

  h.controller.start();
  assert.equal(h.scheduler.pending,1);
  h.controller.destroy();
  assert.equal(h.scheduler.pending,0);
  assert.equal(h.controller.getState().destroyed,true);
  assert.equal(h.controller.start(),false,"destroyed controllers cannot restart");
});

test("the adapter emits callbacks without browser navigation or zoom side effects",()=>{
  let browserSideEffects=0;
  const scheduler=fakeScheduler();
  let pads=[gamepad()];
  const document={
    hidden:false,
    hasFocus:()=>true,
    dispatchEvent(){browserSideEffects+=1;},
    body:{style:{set zoom(value){browserSideEffects+=Number(Boolean(value));}}},
  };
  const windowRef={
    document,
    navigator:{getGamepads:()=>pads},
    history:{back(){browserSideEffects+=1;}},
    dispatchEvent(){browserSideEffects+=1;},
    setTimeout,
    clearTimeout,
  };
  const actions=[];
  const controller=Gamepads.create({
    window:windowRef,
    document,
    navigator:windowRef.navigator,
    now:scheduler.now,
    requestAnimationFrame:callback=>scheduler.request(callback),
    cancelAnimationFrame:id=>scheduler.cancel(id),
    onAction:action=>actions.push(action),
  });
  controller.start();
  pads=[gamepad({buttons:{0:true,1:true,6:true,7:true,11:true,16:true},axes:[0.8,0,0,-0.8]})];
  scheduler.step(10);
  assert.deepEqual(actions,["select","back","navigateRight"]);
  assert.equal(browserSideEffects,0);
});
