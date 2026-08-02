const assert=require("node:assert/strict");
const test=require("node:test");
const path=require("node:path");

global.window={};
const Spatial=require(path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "static",
  "input",
  "spatial-navigation.js"
));

const {
  adjustControl,
  create,
  findBestCandidate,
  normalizeRect,
  scoreCandidate,
}=Spatial;

const fakeChangeEvent=type=>({type,bubbles:true});

function fakeDocument(){return {activeElement:null};}

function fakeScope(name,items=[]){
  return {
    name,
    items,
    contains(element){return this.items.includes(element);},
  };
}

function fakeElement(doc,{id,key,left=0,top=0,width=80,height=40,...rest}={}){
  const attributes=new Map();
  if(id)attributes.set("id",id);
  if(key)attributes.set("data-spatial-key",key);
  for(const [name,value] of Object.entries(rest.attributes||{})){
    attributes.set(name,String(value));
  }
  return {
    id:id||"",
    hidden:false,
    inert:false,
    disabled:false,
    isConnected:true,
    focusCalls:[],
    scrollCalls:[],
    clickCalls:0,
    dispatchCalls:0,
    ...rest,
    getAttribute(name){return attributes.has(name)?attributes.get(name):null;},
    getBoundingClientRect(){
      return {left,top,right:left+width,bottom:top+height,width,height};
    },
    focus(options){this.focusCalls.push(options);doc.activeElement=this;},
    scrollIntoView(options){this.scrollCalls.push(options);},
    click(){this.clickCalls+=1;},
    dispatchEvent(){
      this.dispatchCalls+=1;
      throw new Error("synthetic activation events are forbidden");
    },
  };
}

test("publishes the same API to CommonJS and the browser global",()=>{
  assert.equal(window.CCSpatialNavigation,Spatial);
});

test("normalizes DOM-style and x/y rectangles",()=>{
  assert.deepEqual(normalizeRect({x:10,y:20,width:30,height:40}),{
    left:10,top:20,right:40,bottom:60,width:30,height:40,centerX:25,centerY:40,
  });
});

test("directional scoring rejects candidates behind the origin",()=>{
  const origin={left:100,top:100,width:50,height:50};
  assert.equal(scoreCandidate(origin,{left:20,top:100,width:50,height:50},"right"),Infinity);
  assert.equal(scoreCandidate(origin,{left:100,top:20,width:50,height:50},"down"),Infinity);
  assert.ok(Number.isFinite(
    scoreCandidate(origin,{left:180,top:100,width:50,height:50},"right")
  ));
  assert.ok(Number.isFinite(
    scoreCandidate(origin,{left:100,top:180,width:50,height:50},"down")
  ));
});

test("directional scoring prefers an aligned candidate over a nearby diagonal",()=>{
  const origin={left:0,top:0,width:100,height:50};
  const aligned={name:"aligned",rect:{left:140,top:5,width:60,height:40}};
  const diagonal={name:"diagonal",rect:{left:110,top:90,width:60,height:40}};
  const best=findBestCandidate(origin,[diagonal,aligned],"right",{
    getRect:item=>item.rect,
  });
  assert.equal(best,aligned);
});

test("best-candidate selection works in all four directions",()=>{
  const origin={left:100,top:100,width:40,height:40};
  const items=[
    {name:"up",rect:{left:100,top:20,width:40,height:40}},
    {name:"down",rect:{left:100,top:200,width:40,height:40}},
    {name:"left",rect:{left:20,top:100,width:40,height:40}},
    {name:"right",rect:{left:200,top:100,width:40,height:40}},
  ];
  const options={getRect:item=>item.rect};
  for(const direction of ["up","down","left","right"]){
    assert.equal(findBestCandidate(origin,items,direction,options).name,direction);
  }
});

test("active scope, visibility, uniqueness, and caller filtering are dynamic",()=>{
  const doc=fakeDocument();
  const allowed=fakeElement(doc,{key:"allowed"});
  const filtered=fakeElement(doc,{key:"filtered",left:100,allow:false});
  const hidden=fakeElement(doc,{key:"hidden",left:200,hidden:true});
  const zero=fakeElement(doc,{key:"zero",left:300,width:0});
  const disabled=fakeElement(doc,{key:"disabled",left:400,disabled:true});
  const ariaDisabled=fakeElement(doc,{
    key:"aria",
    left:500,
    attributes:{"aria-disabled":"true"},
  });
  const first=fakeScope("first",[
    allowed,allowed,filtered,hidden,zero,disabled,ariaDisabled,
  ]);
  const later=fakeElement(doc,{key:"later",left:600});
  const second=fakeScope("second",[later]);
  let scope=first;
  const nav=create({
    document:doc,
    getActiveScope:()=>scope,
    getCandidates:active=>active.items,
    candidateFilter:element=>element.allow!==false,
  });

  assert.deepEqual(nav.candidates(),[allowed]);
  first.items.push(later);
  assert.deepEqual(nav.candidates(),[allowed,later]);
  scope=second;
  assert.deepEqual(nav.candidates(),[later]);
});

test("focus uses preventScroll and nearest scrolling",()=>{
  const doc=fakeDocument();
  const item=fakeElement(doc,{key:"one"});
  const scope=fakeScope("scope",[item]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});

  assert.equal(nav.focus(item),true);
  assert.deepEqual(item.focusCalls,[{preventScroll:true}]);
  assert.deepEqual(item.scrollCalls,[{block:"nearest",inline:"nearest",behavior:"auto"}]);
});

test("restore finds a rerendered candidate by stable key",()=>{
  const doc=fakeDocument();
  const original=fakeElement(doc,{key:"card:7",left:20,top:30});
  const scope=fakeScope("scope",[original]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});
  nav.focus(original);

  const replacement=fakeElement(doc,{key:"card:7",left:400,top:300});
  original.isConnected=false;
  scope.items=[replacement];

  assert.equal(nav.restore(),replacement);
  assert.equal(doc.activeElement,replacement);
  assert.equal(replacement.focusCalls.length,1);
});

test("restore falls back to the candidate nearest the remembered rectangle",()=>{
  const doc=fakeDocument();
  const original=fakeElement(doc,{left:100,top:100});
  const scope=fakeScope("scope",[original]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});
  nav.focus(original);

  const nearest=fakeElement(doc,{left:115,top:120});
  const far=fakeElement(doc,{left:700,top:500});
  original.isConnected=false;
  scope.items=[far,nearest];

  assert.equal(nav.restore(),nearest);
  assert.equal(doc.activeElement,nearest);
});

test("movement uses a destroyed element's remembered rectangle",()=>{
  const doc=fakeDocument();
  const original=fakeElement(doc,{left:100,top:100});
  const scope=fakeScope("scope",[original]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});
  nav.focus(original);

  const right=fakeElement(doc,{left:220,top:100});
  const below=fakeElement(doc,{left:100,top:220});
  original.isConnected=false;
  scope.items=[below,right];

  assert.equal(nav.move("right"),right);
  assert.equal(doc.activeElement,right);
});

test("first movement falls back to the edge implied by the direction",()=>{
  const doc=fakeDocument();
  const left=fakeElement(doc,{left:10,top:30});
  const right=fakeElement(doc,{left:400,top:10});
  const scope=fakeScope("scope",[right,left]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});

  assert.equal(nav.move("right"),left);
  nav.forget();
  doc.activeElement=null;
  assert.equal(nav.move("left"),right);
});

test("activation clicks directly, including after a keyed rerender",()=>{
  const doc=fakeDocument();
  const original=fakeElement(doc,{key:"agent:9"});
  const scope=fakeScope("scope",[original]);
  const nav=create({document:doc,scope,getCandidates:active=>active.items});
  nav.focus(original);
  assert.equal(nav.activate(),true);
  assert.equal(original.clickCalls,1);
  assert.equal(original.dispatchCalls,0);

  const replacement=fakeElement(doc,{key:"agent:9",left:200});
  original.isConnected=false;
  scope.items=[replacement];
  assert.equal(nav.activate(),true);
  assert.equal(replacement.clickCalls,1);
  assert.equal(replacement.dispatchCalls,0);
  assert.equal(doc.activeElement,replacement);
});

test("controller adjustment changes selects and skips disabled choices",()=>{
  const events=[];
  const select={
    tagName:"SELECT",
    options:[{disabled:false},{disabled:true},{disabled:false}],
    selectedIndex:0,
    dispatchEvent:event=>events.push(event.type),
  };
  assert.equal(adjustControl(select,1,{createEvent:fakeChangeEvent}),true);
  assert.equal(select.selectedIndex,2);
  assert.deepEqual(events,["input","change"]);
  assert.equal(adjustControl(select,1,{createEvent:fakeChangeEvent}),false);
  assert.equal(select.selectedIndex,2,"adjustment stops at the last choice");
  assert.equal(adjustControl(select,1,{createEvent:fakeChangeEvent,wrap:true}),true);
  assert.equal(select.selectedIndex,0,"wrapped adjustment cycles to the first choice");
});

test("controller adjustment steps date inputs and emits native-style events",()=>{
  const events=[];
  const input={
    tagName:"INPUT",
    type:"date",
    value:"2026-08-02",
    stepUp(){this.value="2026-08-03";},
    stepDown(){this.value="2026-08-01";},
    dispatchEvent:event=>events.push(event.type),
  };
  assert.equal(adjustControl(input,-1,{createEvent:fakeChangeEvent}),true);
  assert.equal(input.value,"2026-08-01");
  assert.deepEqual(events,["input","change"]);
});

test("invalid movement directions fail fast",()=>{
  const nav=create({document:fakeDocument(),getCandidates:()=>[]});
  assert.throws(()=>nav.move("forward"),/Unknown spatial direction/);
});
