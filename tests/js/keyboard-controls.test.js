const assert=require("node:assert/strict");
const test=require("node:test");
const path=require("node:path");

global.window={};
const Keyboard=require(path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "static",
  "input",
  "keyboard-controls.js"
));

const {actionForEvent}=Keyboard;

const expectedMappings=[
  ["ArrowUp","navigateUp"],
  ["KeyW","navigateUp"],
  ["ArrowDown","navigateDown"],
  ["KeyS","navigateDown"],
  ["ArrowLeft","navigateLeft"],
  ["KeyA","navigateLeft"],
  ["ArrowRight","navigateRight"],
  ["KeyD","navigateRight"],
  ["Enter","select"],
  ["NumpadEnter","select"],
  ["Space","select"],
  ["Escape","back"],
  ["KeyX","secondaryAction"],
  ["KeyY","menu"],
  ["ContextMenu","menu"],
  ["KeyQ","previousSection"],
  ["KeyE","nextSection"],
  ["Home","home"],
  ["F1","help"],
];

test("publishes the same frozen API to CommonJS and the browser global",()=>{
  assert.equal(window.CCKeyboardControls,Keyboard);
  assert.ok(Object.isFrozen(Keyboard.ACTIONS));
});

test("maps navigation and generic application keys to semantic actions",()=>{
  expectedMappings.forEach(([code,action])=>{
    assert.equal(actionForEvent({code}),action,code);
  });
});

test("maps shifted slash to help but leaves ordinary slash unmapped",()=>{
  assert.equal(actionForEvent({code:"Slash",shiftKey:true}),"help");
  assert.equal(actionForEvent({code:"Slash",shiftKey:false}),null);
});

test("maps Ctrl and Meta arrows to section changes",()=>{
  assert.equal(actionForEvent({code:"ArrowLeft",ctrlKey:true}),"previousSection");
  assert.equal(actionForEvent({code:"ArrowRight",ctrlKey:true}),"nextSection");
  assert.equal(actionForEvent({code:"ArrowLeft",metaKey:true}),"previousSection");
  assert.equal(actionForEvent({code:"ArrowRight",metaKey:true}),"nextSection");
  assert.equal(
    actionForEvent({code:"ArrowLeft",ctrlKey:true,metaKey:true,shiftKey:true}),
    "previousSection"
  );
});

test("ignores ordinary shortcuts when Ctrl or Meta is held",()=>{
  ["KeyW","Space","KeyX","KeyQ","Home","F1","Slash"].forEach(code=>{
    assert.equal(actionForEvent({code,ctrlKey:true,shiftKey:true}),null,`Ctrl+${code}`);
    assert.equal(actionForEvent({code,metaKey:true,shiftKey:true}),null,`Meta+${code}`);
  });
});

test("ignores all Alt-modified input, including modifier arrows",()=>{
  assert.equal(actionForEvent({code:"KeyW",altKey:true}),null);
  assert.equal(actionForEvent({code:"ArrowLeft",altKey:true,ctrlKey:true}),null);
  assert.equal(actionForEvent({code:"ArrowRight",altKey:true,metaKey:true}),null);
});

test("preserves native behavior for inputs, selects, ranges, and editables",()=>{
  const nativeTargets=[
    {tagName:"INPUT",type:"range"},
    {tagName:"SELECT"},
    {tagName:"TEXTAREA"},
    {tagName:"DIV",isContentEditable:true},
    {tagName:"DIV",getAttribute:name=>name==="role"?"slider":null},
  ];
  nativeTargets.forEach(target=>{
    assert.equal(actionForEvent({code:"ArrowRight",target}),null);
    assert.equal(actionForEvent({code:"PageUp",target}),null);
    assert.equal(actionForEvent({code:"Home",target}),null);
    assert.equal(actionForEvent({code:"Space",target}),null);
    assert.equal(actionForEvent({code:"Escape",target}),"back");
  });

  const child={tagName:"SPAN",parentElement:{tagName:"DIV",isContentEditable:true}};
  assert.equal(actionForEvent({code:"ArrowDown",target:child}),null);
  assert.equal(
    actionForEvent({code:"ArrowDown",target:child},{allowNativeTarget:true}),
    "navigateDown"
  );
});

test("does not turn media controls into Command Center actions",()=>{
  ["MediaPlayPause","MediaTrackPrevious","MediaTrackNext","AudioVolumeMute"].forEach(code=>{
    assert.equal(actionForEvent({code}),null,code);
  });
});

test("returns null for unknown or missing input",()=>{
  assert.equal(actionForEvent({code:"KeyZ"}),null);
  assert.equal(actionForEvent({}),null);
  assert.equal(actionForEvent(null),null);
});

test("falls back to event.key when code is unavailable",()=>{
  assert.equal(actionForEvent({key:"F1"}),"help");
  assert.equal(actionForEvent({code:"",key:"Home"}),"home");
  assert.equal(actionForEvent({key:"ArrowLeft",ctrlKey:true}),"previousSection");
});

test("does not consume or mutate the keyboard event",()=>{
  let prevented=false;
  let stopped=false;
  const event={
    code:"Space",
    preventDefault:()=>{prevented=true;},
    stopPropagation:()=>{stopped=true;},
  };

  assert.equal(actionForEvent(event),"select");
  assert.equal(prevented,false);
  assert.equal(stopped,false);
  assert.deepEqual(Object.keys(event),["code","preventDefault","stopPropagation"]);
});
