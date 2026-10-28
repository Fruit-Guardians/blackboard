import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyGraph, applyAll } from '../lib/model.js';
import { ensure, addNode, paths } from '../lib/store.js';
import { buildAgentContext, renderAgentContext, estimateTokensText } from '../lib/context.js';
import { startServer } from '../lib/server.js';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
const POLICY = { readOnly: true, prescriptive: false, nextStepSelection: 'agent-controlled' };
const LIMITATION = '\n\n  条件：仅观察到配置，实际服务状态尚未验证；这不是端到端复现。\n';
const detail = '已保存的原始观察。\t'.repeat(85) + LIMITATION;
const bodyNodes = packet => [packet.currentFocus,
  ...['objectives', 'openThreads', 'findings', 'confirmedFacts', 'retiredNodes', 'notes', 'otherNodes', 'recentChanges']
    .flatMap(key => packet[key]), ...packet.neighborhood.map(item => item.node)].filter(Boolean);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('context retains authored node text, formatting, tags and independent fields without field clipping', () => {
  const graph = emptyGraph();
  const node = { id: 'v1', type: 'vuln', title: '有条件的判断'.repeat(55), detail,
    status: 'active', severity: 'high', confidence: 'static-confirmed',
    tags: Array.from({ length: 18 }, (_, i) => `source-${i}`),
    loc: { path: 'sample.txt', line: 7 }, author: 'agent:a', updatedBy: 'agent:b', ts: 1 };
  graph.nodes.v1 = node;
  const before = JSON.stringify(graph);
  const packet = buildAgentContext(graph, { focus: 'v1', budgetTokens: 64000 });
  assert.equal(packet.schema, 'blackboard.context.v2');
  assert.deepEqual(packet.policy, POLICY);
  assert.equal(packet.truncated, false);
  for (const projected of bodyNodes(packet)) {
    for (const key of ['title', 'detail', 'status', 'severity', 'confidence', 'author', 'updatedBy', 'tags']) {
      assert.deepEqual(projected[key], node[key], key);
    }
    assert.deepEqual(projected.location, node.loc);
  }
  assert.ok(renderAgentContext(packet).includes(detail));
  assert.equal(JSON.stringify(graph), before);
});

test('complete-or-omitted node text applies to every semantic collection, neighborhood and incremental changes', () => {
  const events = [{ op: 'checkpoint', checkpoint: { id: 'cp1', agentId: 'agent:primary', at: 1, summary: 'Before' } }];
  const samples = [['g1','goal',{}], ['hy1','hypothesis',{status:'active'}],
    ['v1','vuln',{confidence:'suspected'}], ['f1','fact',{status:'confirmed'}],
    ['f2','fact',{status:'refuted'}], ['n1','note',{}], ['x1','custom-experiment',{}]];
  for (const [id,type,extra] of samples) events.push({op:'node',node:{id,type,title:id,detail,ts:2,...extra}});
  events.push({op:'edge',edge:{id:'e1',from:'f1',to:'hy1',kind:'supports',ts:2}});
  const graph = applyAll(emptyGraph(), structuredClone(events));
  const packet = buildAgentContext(graph,{focus:'hy1',since:'cp1',events,budgetTokens:64000,maxItems:200});
  for (const key of ['objectives','openThreads','findings','confirmedFacts','retiredNodes','notes','otherNodes','recentChanges']) {
    assert.ok(packet[key].length > 0,key);
    for (const node of packet[key]) assert.equal(node.detail,detail,key);
  }
  assert.equal(packet.neighborhood[0].node.detail,detail);
  assert.equal(packet.truncated,false);
});

test('checkpoint, activity, relationship and delta text also remain complete when the budget fits', () => {
  const summary = '  original handoff\n'.repeat(55) + 'Only observed; outcome unverified.\n';
  const label = 'An explicitly conditional relation; '.repeat(25) + 'not a proof.';
  const linkedNodeIds = Array.from({length:18},(_,i)=>`n${i}`);
  const events = [
    {op:'node',node:{id:'f1',type:'fact',title:'Observed',ts:1,status:'confirmed'}},
    {op:'node',node:{id:'hy1',type:'hypothesis',title:'Conditional claim',ts:1}},
    {op:'checkpoint',checkpoint:{id:'cp1',at:1,agentId:'agent:primary',summary}},
    {op:'activity',activity:{id:'act1',at:2,agentId:'agent:primary',summary,linkedNodeIds}},
    {op:'edge',edge:{id:'e1',from:'f1',to:'hy1',kind:'supports',label,ts:2}},
  ];
  const graph = applyAll(emptyGraph(),structuredClone(events));
  const packet = buildAgentContext(graph,{since:'cp1',events,budgetTokens:64000});
  assert.equal(packet.checkpoints[0].summary,summary);
  assert.equal(packet.recentActivity[0].summary,summary);
  assert.deepEqual(packet.recentActivity[0].linkedNodeIds,linkedNodeIds);
  assert.equal(packet.relations[0].label,label);
  assert.equal(packet.changes[0].label,label);
  const markdown = renderAgentContext(packet);
  assert.ok(markdown.includes(summary));
  assert.ok(markdown.includes(label));
});

test('an oversized node is omitted as a whole rather than returned with its limitation removed', () => {
  const graph = emptyGraph();
  graph.nodes.v1 = {id:'v1',type:'vuln',title:'Conditional claim',detail:'观察'.repeat(900)+LIMITATION,
    confidence:'static-confirmed',ts:1};
  const packet = buildAgentContext(graph,{budgetTokens:1000});
  assert.deepEqual(packet.findings,[]);
  assert.equal(packet.omitted.findings,1);
  assert.equal(packet.truncated,true);
  assert.ok(packet.estimatedTokens<=1000);
  assert.equal(JSON.stringify(packet).includes('观察'),false);
});

test('an oversized focus remains an explicit ID reference, not a partial assertion or budget escape', () => {
  const graph = emptyGraph();
  graph.nodes.v1 = {id:'v1',type:'vuln',title:'Conditional claim',detail:'观察'.repeat(2000)+LIMITATION,
    confidence:'suspected',status:'blocked',severity:'low',ts:1};
  const before = JSON.stringify(graph);
  const packet = buildAgentContext(graph,{focus:'v1',budgetTokens:700});
  assert.equal(packet.currentFocus,null);
  assert.equal(packet.request.focus,'v1');
  assert.equal(packet.omitted.currentFocus,1);
  assert.equal(packet.omitted.findings,1);
  assert.equal(packet.truncated,true);
  assert.ok(packet.estimatedTokens<=700);
  const markdown = renderAgentContext(packet);
  assert.match(markdown, /Focus: v1/);
  assert.match(markdown, /Focus body omitted/);
  assert.match(markdown, /blackboard show v1 --json/);
  assert.equal(markdown.includes('Conditional claim'),false);
  assert.deepEqual(packet.policy,POLICY);
  assert.equal(JSON.stringify(graph),before);
});

test('oversized checkpoints, activities and relation labels are omitted whole and counted', () => {
  const long = '有条件的观察。'.repeat(1000)+LIMITATION;
  const events = [
    {op:'node',node:{id:'f1',type:'fact',title:'Evidence',ts:1,status:'confirmed'}},
    {op:'node',node:{id:'hy1',type:'hypothesis',title:'Question',ts:1}},
    {op:'checkpoint',checkpoint:{id:'cp1',at:1,agentId:'agent:primary',summary:long}},
    {op:'activity',activity:{id:'act1',at:2,agentId:'agent:primary',summary:long}},
    {op:'edge',edge:{id:'e1',from:'f1',to:'hy1',kind:'supports',label:long,ts:2}},
  ];
  const graph = applyAll(emptyGraph(),structuredClone(events));
  const packet = buildAgentContext(graph,{since:'cp1',events,budgetTokens:1200});
  for (const key of ['checkpoints','recentActivity','relations','changes']) {
    assert.deepEqual(packet[key],[],key);
    assert.equal(packet.omitted[key],1,key);
  }
  assert.ok(bodyNodes(packet).length>0);
  assert.equal(packet.truncated,true);
  assert.ok(packet.estimatedTokens<=1200);
});

test('whole-record budgeting includes omission metadata and a self-consistent final token estimate', () => {
  const graph = emptyGraph();
  for(let i=0;i<18;i++) graph.nodes[`f${i}`]={id:`f${i}`,type:'fact',status:'confirmed',title:`Observation ${i}`,
    detail:'条件\n'.repeat(i*10)+`Unverified scope ${i}.`,ts:i};
  for(const budgetTokens of [400,512,650,800,1000,1200,4000]) {
    const options = {budgetTokens,maxItems:18};
    const packet = buildAgentContext(graph,options);
    assert.ok(packet.estimatedTokens<=budgetTokens,`${packet.estimatedTokens}/${budgetTokens}`);
    assert.equal(packet.estimatedTokens,Math.ceil(estimateTokensText(JSON.stringify(packet))));
    for(const node of bodyNodes(packet)) assert.equal(node.detail,graph.nodes[node.id].detail);
    assert.deepEqual(packet,buildAgentContext(graph,options),'deterministic projection');
    assert.equal(packet.truncated,Object.keys(packet.omitted).length>0);
  }
});

test('removing an oversized record does not fabricate a relation, status or confidence', () => {
  const graph = emptyGraph();
  graph.nodes.hy1={id:'hy1',type:'hypothesis',title:'Conditional',detail:'限定'.repeat(2000),ts:1};
  graph.nodes.f1={id:'f1',type:'fact',title:'Unclassified observation',ts:1};
  graph.edges.e1={id:'e1',from:'f1',to:'hy1',kind:'supports',ts:1};
  const before=JSON.stringify(graph);
  const packet=buildAgentContext(graph,{budgetTokens:800,focus:'hy1',depth:0});
  assert.equal(packet.currentFocus,null);
  assert.equal(bodyNodes(packet).some(n=>n.id==='hy1'),false);
  assert.deepEqual(packet.relations,[]);
  assert.equal(packet.omitted.relations,1);
  assert.equal(packet.confirmedFacts.length,0);
  assert.equal(Object.hasOwn(packet,'suggestedNext'),false);
  assert.deepEqual(packet.policy,POLICY);
  assert.equal(JSON.stringify(graph),before);
});

test('CLI JSON/Markdown and HTTP context preserve full limitations without changing the event source', async (t) => {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'blackboard-whole-records-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  ensure(cwd);
  const node=addNode({type:'vuln',title:'Conditional claim',detail,confidence:'static-confirmed',enter:true},cwd).node;
  const before=hash(paths(cwd).events);
  const env={...process.env};
  for(const key of Object.keys(env)) if(key.startsWith('BLACKBOARD_')) delete env[key];
  for(const format of ['--json','--markdown']) {
    const result=spawnSync(process.execPath,[CLI,'context','--cwd',cwd,'--budget','64000',format],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    if(format==='--json') assert.equal(JSON.parse(result.stdout).currentFocus.detail,node.detail);
    else assert.ok(result.stdout.includes(node.detail));
  }
  const server=await startServer({cwd,port:0,readOnly:true});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${base}/api/context?budget=64000`);
  assert.equal(response.status,200);
  const packet=await response.json();
  assert.equal(packet.currentFocus.detail,node.detail);
  assert.deepEqual(packet.policy,POLICY);
  assert.equal(hash(paths(cwd).events),before);
});
