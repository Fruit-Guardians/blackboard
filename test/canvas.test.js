import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-canvas-tests-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', dir, path.join(root, 'web/src/graph.ts')], { cwd: dir });
// Keep the tests portable on Node 18+ without a TS execution loader.
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
 const p = path.join(dir, file);
 fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace(/from '(\.\/[^']+)'/g, (_all, name) => `from '${name}.js'`));
}
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({type:'module'}));
fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
const { detailLevel, groupFor, focusedIds, neighborInDirection } = await import(pathToFileURL(path.join(dir,'canvas-state.js')).href);
const { layoutOverview, project, layoutGraph, gridLayout, relationGroup, RELATION_GROUPS } = await import(pathToFileURL(path.join(dir,'graph.js')).href);
const { roundedPath, routeValid } = await import(pathToFileURL(path.join(dir,'edge-route.js')).href);
const { filterNodes, filterActive, EMPTY_FILTER } = await import(pathToFileURL(path.join(dir,'presentation.js')).href);
const items = [
 {id:'g',type:'goal',title:'Goal'}, {id:'f',type:'finding',title:'Finding'},
 {id:'o',type:'observation',title:'Evidence'}, {id:'n',type:'note',title:'Unconnected'},
];
const snapshot = { meta:{focus:'o'}, nodes:items, edges:[{id:'e',from:'o',to:'f',kind:'proves'}] };

test('semantic zoom has three stable, explicit thresholds',()=>{
 assert.equal(detailLevel(.2),'overview'); assert.equal(detailLevel(.65),'compact'); assert.equal(detailLevel(.9),'detail');
});
test('grouping classifies content without changing node type or data',()=>{
 const before=JSON.stringify(items); const connected=new Set(['f','o']);
 assert.deepEqual(items.map(n=>groupFor(n,connected)),['purpose','findings','reasoning','inbox']);
 assert.equal(JSON.stringify(items),before);
});
test('focus follows only explicit one-hop edges, in either direction',()=>{
 const edges=[{source:'a',target:'b'},{source:'b',target:'c'},{source:'d',target:'a'}];
 assert.deepEqual([...focusedIds('a',edges)].sort(),['a','b','d']);
 assert.equal(focusedIds(null,edges).size,0);
});
test('overview preserves every real node and edge exactly once',()=>{
 const p=project(snapshot,'all',''); const before=JSON.stringify(p);
 const layout=layoutOverview(p.nodes,p.edges);
 assert.equal(layout.nodes.filter(n=>!n.data.group).length,items.length);
 assert.equal(layout.nodes.filter(n=>n.data.group).length,4);
 assert.deepEqual(layout.edges,p.edges);assert.equal(JSON.stringify(p),before);
 assert.equal(new Set(layout.nodes.map(n=>n.id)).size,layout.nodes.length);
});
test('overview children follow their frames and remain inside them',()=>{
 const layout=layoutOverview(project(snapshot,'all','').nodes,[]);
 for(const node of layout.nodes.filter(n=>!n.data.group)){
  const parent=layout.nodes.find(n=>n.id===node.parentId);
  assert.ok(parent && parent.data.group);
  assert.ok(node.position.x>=0 && node.position.y>=0);
  assert.ok(node.position.x+240<=parent.style.width);
  assert.ok(node.position.y+112<=parent.style.height);
 }
});
test('large overview layout has no overlapping children within a group',()=>{
 const nodes=Array.from({length:150},(_,i)=>({id:`n${i}`,type:'note',title:`Record ${i}`}));
 const layout=layoutOverview(project({meta:{},nodes,edges:[]},'all','').nodes,[]);
 const cells=layout.nodes.filter(n=>!n.data.group);
 for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
  const a=cells[i],b=cells[j];
  assert.ok(Math.abs(a.position.x-b.position.x)>=240 || Math.abs(a.position.y-b.position.y)>=112);
 }
});
test('empty board adds no phantom display groups',()=>{
 assert.deepEqual(layoutOverview([],[]),{nodes:[],edges:[]});
});
test('regular layout keeps correct direction and no display-only parents',async()=>{
 const p=project(snapshot,'all','');const layout=await layoutGraph(p.nodes,p.edges,'DOWN');
 assert.equal(layout.nodes.length,4);
 assert.ok(layout.nodes.every(n=>n.data.direction==='DOWN' && !n.parentId));
});

test('narrow overview stacks frames vertically without overlaps',()=>{
 const p=project(snapshot,'all','');const layout=layoutOverview(p.nodes,p.edges,1);
 const frames=layout.nodes.filter(n=>n.data.group);
 assert.ok(frames.every(n=>n.position.x===0));
 for(let i=1;i<frames.length;i++) assert.ok(frames[i].position.y>=frames[i-1].position.y+frames[i-1].style.height);
});

test('arrow keys move only along explicit edges, toward the pressed side',()=>{
 const boxes=[{id:'a',x:0,y:0,w:100,h:50},{id:'r',x:300,y:0,w:100,h:50},{id:'r2',x:300,y:200,w:100,h:50},{id:'l',x:-300,y:0,w:100,h:50},{id:'far',x:600,y:0,w:100,h:50}];
 const edges=[{source:'a',target:'r'},{source:'a',target:'r2'},{source:'l',target:'a'}];
 assert.equal(neighborInDirection('a',boxes,edges,'ArrowRight'),'r');
 assert.equal(neighborInDirection('a',boxes,edges,'ArrowLeft'),'l');
 assert.equal(neighborInDirection('a',boxes,edges,'ArrowDown'),'r2');
 assert.equal(neighborInDirection('a',boxes,edges,'ArrowUp'),null);
 assert.equal(neighborInDirection(null,boxes,edges,'ArrowRight'),null);
 assert.equal(neighborInDirection('far',boxes,edges,'ArrowLeft'),null);
});
test('grid fallback layout never overlaps and keeps every node and edge',()=>{
 const nodes=Array.from({length:37},(_,i)=>({id:`n${i}`,type:'note',title:`N${i}`}));
 const p=project({meta:{},nodes,edges:[]},'all','');
 const out=gridLayout(p.nodes,p.edges,'DOWN');
 assert.equal(out.nodes.length,37);assert.ok(out.nodes.every(n=>n.data.direction==='DOWN'));
 const cells=new Set(out.nodes.map(n=>`${n.position.x},${n.position.y}`));assert.equal(cells.size,37);
});

test('sidebar filters: values within a facet are alternatives, facets narrow each other',()=>{
 const nodes=[
  {id:'a',type:'hypothesis',title:'A',status:'open'},
  {id:'b',type:'hypothesis',title:'B',status:'dead'},
  {id:'c',type:'finding',title:'C',status:'confirmed',severity:'high',confidence:'reproduced'},
  {id:'d',type:'vuln',title:'D',severity:'low',confidence:'static-confirmed'},
 ];
 const ids=(f)=>filterNodes(nodes,{...EMPTY_FILTER,...f}).map(n=>n.id);
 assert.equal(filterActive(EMPTY_FILTER),false);
 assert.deepEqual(ids({}),['a','b','c','d']);
 assert.deepEqual(ids({types:['hypothesis','finding']}),['a','b','c']);
 assert.deepEqual(ids({types:['hypothesis'],statuses:['open']}),['a']);
 assert.deepEqual(ids({riskOnly:true}),['c']);
 assert.deepEqual(ids({confidences:['static-confirmed']}),['d']);
 assert.deepEqual(ids({statuses:['']}),['d']);
 assert.equal(filterActive({...EMPTY_FILTER,riskOnly:true}),true);
});

test('every relation kind the model allows maps to a family; unknown kinds stay neutral',async()=>{
 const { EDGE_KINDS } = await import(pathToFileURL(path.join(root,'lib/model.js')).href);
 const ids=new Set(RELATION_GROUPS.map(g=>g.id));
 for (const kind of EDGE_KINDS) assert.ok(ids.has(relationGroup(kind)),kind);
 assert.equal(relationGroup('proves'),'support'); assert.equal(relationGroup('prove'),'support');
 assert.equal(relationGroup('contradicts'),'oppose'); assert.equal(relationGroup('intent-chain'),'derive');
 assert.equal(relationGroup('produce'),'produce'); assert.equal(relationGroup('supersedes'),'replace');
 assert.equal(relationGroup('something-new'),'link');
});

test('layout stores the ELK route of every edge and reuses it only while nodes stay put',async()=>{
 const nodes=['a','b','c','d'].map(id=>({id,type:'fact',title:id}));
 const edges=[['a','b'],['b','c'],['c','d'],['a','d']].map(([from,to],i)=>({id:`e${i}`,from,to,kind:'proves'}));
 const p=project({meta:{},nodes,edges},'all',''); const laid=await layoutGraph(p.nodes,p.edges,'RIGHT');
 for(const edge of laid.edges){
  const route=edge.data.route; assert.ok(route.points.length>=2,edge.id);
  const s=laid.nodes.find(n=>n.id===edge.source).position, t=laid.nodes.find(n=>n.id===edge.target).position;
  assert.ok(routeValid(route,s,t)); assert.ok(!routeValid(route,{x:s.x+10,y:s.y},t));
 }
});
test('rounded corners stay inside their segments',()=>{
 const pts=[{x:0,y:4},{x:50,y:4},{x:50,y:96},{x:100,y:96}];
 assert.match(roundedPath(pts,44),/^M0,4L.*Q50,4 .*L100,96$/);
 assert.equal(roundedPath([{x:0,y:0},{x:10,y:0},{x:10,y:6}],44).includes('Q10,0 10,3'),true);
});

// A hub with many relations plus long edges: the shape that used to merge unrelated lines.
const hubBoard=()=>{
 const nodes=[{id:'g',type:'goal',title:'goal',ts:1}];
 const edges=[];
 for(let i=0;i<6;i++){nodes.push({id:`q${i}`,type:'question',title:`q${i}`,ts:10+i});edges.push({id:`g-q${i}`,from:'g',to:`q${i}`,kind:'related-to'});}
 for(let i=0;i<4;i++){nodes.push({id:`f${i}`,type:'fact',title:`f${i}`,ts:20+i},{id:`v${i}`,type:'vuln',title:`v${i}`,ts:30+i});
  edges.push({id:`f${i}-v${i}`,from:`f${i}`,to:`v${i}`,kind:'supports'},{id:`g-v${i}`,from:'g',to:`v${i}`,kind:'related-to'});}
 nodes.push({id:'h',type:'hypothesis',title:'h',ts:40});
 edges.push({id:'f0-h',from:'f0',to:'h',kind:'supports'},{id:'h-v1',from:'h',to:'v1',kind:'produce'},{id:'q0-g',from:'q0',to:'g',kind:'derived-from'});
 return {meta:{},nodes,edges};
};
const segmentsOf=(laid)=>laid.edges.flatMap(e=>e.data.route.points.slice(1).map((b,i)=>({e,a:e.data.route.points[i],b})));

test('routes never pass through a card and unrelated relations never share a line',async()=>{
 const p=project(hubBoard(),'logic',''); const laid=await layoutGraph(p.nodes,p.edges,'RIGHT');
 const boxes=laid.nodes.map(n=>({id:n.id,x:n.position.x,y:n.position.y,w:n.style.width,h:n.style.height}));
 const segs=segmentsOf(laid);
 for(const {e,a,b} of segs) for(const r of boxes){
  if(r.id===e.source||r.id===e.target) continue;
  for(let k=0;k<=20;k++){const x=a.x+(b.x-a.x)*k/20,y=a.y+(b.y-a.y)*k/20;
   assert.ok(!(x>r.x+1&&x<r.x+r.w-1&&y>r.y+1&&y<r.y+r.h-1),`${e.id} crosses ${r.id}`);}
 }
 const span=(u0,u1,w0,w1)=>Math.min(Math.max(u0,u1),Math.max(w0,w1))-Math.max(Math.min(u0,u1),Math.min(w0,w1));
 for(let i=0;i<segs.length;i++) for(let j=i+1;j<segs.length;j++){
  const A=segs[i],C=segs[j]; if(A.e.id===C.e.id) continue;
  const flatA=Math.abs(A.a.y-A.b.y)<.5, flatC=Math.abs(C.a.y-C.b.y)<.5;
  if(flatA&&flatC&&Math.abs(A.a.y-C.a.y)<1) assert.ok(span(A.a.x,A.b.x,C.a.x,C.b.x)<=1,`${A.e.id} and ${C.e.id} drawn on one line`);
  const upA=Math.abs(A.a.x-A.b.x)<.5, upC=Math.abs(C.a.x-C.b.x)<.5;
  if(upA&&upC&&Math.abs(A.a.x-C.a.x)<1) assert.ok(span(A.a.y,A.b.y,C.a.y,C.b.y)<=1,`${A.e.id} and ${C.e.id} drawn on one line`);
 }
 // Each route starts on its source's right border and ends on its target's left border.
 const at=new Map(boxes.map(b=>[b.id,b]));
 for(const e of laid.edges){const s=at.get(e.source),t=at.get(e.target),pts=e.data.route.points;
  assert.equal(pts[0].x,s.x+s.w,e.id); assert.equal(pts.at(-1).x,t.x,e.id);}
});

test('passive relations are laid out premise first and keep their arrow on the premise',async()=>{
 const p=project(hubBoard(),'logic',''); const edge=p.edges.find(e=>e.id==='q0-g');
 assert.equal(edge.source,'g'); assert.equal(edge.target,'q0'); assert.ok(edge.markerStart); assert.equal(edge.markerEnd,undefined);
 const forward=p.edges.find(e=>e.id==='f0-v0'); assert.equal(forward.source,'f0'); assert.ok(forward.markerEnd);
 const laid=await layoutGraph(p.nodes,p.edges,'RIGHT'); const x=id=>laid.nodes.find(n=>n.id===id).position.x;
 assert.ok(x('g')<x('q0')); assert.ok(x('f0')<x('v0'));
});

test('a growing board stays put: existing cards keep their order when a node is added',async()=>{
 const before=hubBoard(); const p0=project(before,'logic',''); const first=await layoutGraph(p0.nodes,p0.edges,'RIGHT');
 const previous=new Map(first.nodes.map(n=>[n.id,n.position]));
 const after=hubBoard(); after.nodes.push({id:'f9',type:'fact',title:'new',ts:99}); after.edges.push({id:'f9-q3',from:'f9',to:'q3',kind:'supports'});
 const p1=project(after,'logic',''); const next=await layoutGraph(p1.nodes,p1.edges,'RIGHT',false,2,previous);
 const pos=new Map(next.nodes.map(n=>[n.id,n.position]));
 const columns=new Map();
 for(const [id,p] of previous){ if(!columns.has(p.x)) columns.set(p.x,[]); columns.get(p.x).push(id); }
 for(const ids of columns.values()){
  const was=[...ids].sort((a,b)=>previous.get(a).y-previous.get(b).y);
  const now=[...ids].filter(id=>pos.get(id).x===pos.get(was[0]).x).sort((a,b)=>pos.get(a).y-pos.get(b).y);
  assert.deepEqual(now,was.filter(id=>now.includes(id)),'column order changed');
 }
});
test('weak relations wait for a selection unless they are a card\'s only tie to the board',()=>{
 const board={nodes:[{id:'a',type:'fact',title:'A'},{id:'b',type:'fact',title:'B'},{id:'c',type:'fact',title:'C'},{id:'d',type:'note',title:'D'}],
  edges:[{id:'s',from:'a',to:'b',kind:'supports'},{id:'s2',from:'b',to:'c',kind:'supports'},{id:'w',from:'a',to:'c',kind:'related-to'},{id:'only',from:'d',to:'c',kind:'related-to'}]};
 const quiet=Object.fromEntries(project(board,'logic','').edges.map(e=>[e.id,Boolean(e.data.quiet)]));
 assert.deepEqual(quiet,{s:false,s2:false,w:true,only:false});
});
