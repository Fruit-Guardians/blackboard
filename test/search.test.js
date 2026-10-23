import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph } from '../lib/model.js';
import { searchGraph } from '../lib/search.js';

function graph() {
  const g = emptyGraph();
  g.nodes = {
    hy1: { id: 'hy1', type: 'hypothesis', title: 'Session cookie', detail: 'Candidate only', tags: ['auth', 'web'], status: 'open', ts: 1 },
    o1: { id: 'o1', type: 'observation', title: 'Header result', detail: 'Cookie exists', loc: {path:'src/session.js',line:42}, tags: ['auth'], status: 'done', ts: 2 },
    x1: { id: 'x1', type: 'experiment', title: 'Cookie candidate', status: 'refuted', ts: 2 },
  };
  g.edges.e1 = {id:'e1',from:'o1',to:'hy1',kind:'supports'};
  return g;
}

test('search returns stable IDs, matching fields and pointers, without mutation', () => {
  const g = graph(); const before = JSON.stringify(g);
  const result = searchGraph(g, {query:'COOKIE'});
  assert.deepEqual(result.items.map((x) => x.id), ['o1','x1','hy1']);
  assert.equal(result.readOnly, true); assert.equal(result.prescriptive, false);
  assert.ok(result.items.find((x) => x.id === 'o1').matches.some((m) => m.field === 'detail'));
  assert.equal(result.items[0].node.loc.line,42);
  assert.equal(JSON.stringify(g),before);
});

test('search combines text, independent fields, tags and explicit graph filters', () => {
  const g=graph();
  assert.deepEqual(searchGraph(g,{query:'session cookie',tags:['auth','web'],type:'hypothesis',status:'open',relation:'supports',relatedTo:'o1'}).items.map((x)=>x.id),['hy1']);
  assert.equal(searchGraph(g,{query:'src/session.js'}).items[0].matches[0].field,'loc.path');
  assert.equal(searchGraph(g,{query:'Cookie',type:'experiment',status:'refuted'}).items[0].id,'x1');
  assert.equal(searchGraph(g,{tags:['absent']}).total,0);
});

test('search exposes truncation, rejects invalid limits and treats regex as literal', () => {
  assert.equal(searchGraph(graph(),{limit:1}).truncated,true);
  for(const limit of [0,-1,1.1,1001,'bad']) assert.throws(()=>searchGraph(graph(),{limit}));
  assert.equal(searchGraph(graph(),{query:'.*'}).total,0);
});
