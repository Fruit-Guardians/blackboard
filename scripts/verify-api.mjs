#!/usr/bin/env node
// Optional Postman CLI check against a real loopback server and disposable board.
// Nothing is published to a workspace: --no-report-events keeps requests local.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ensure, addNode, addCheckpoint, patchNode, paths } from '../lib/store.js';
import { startServer } from '../lib/server.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackboard-postman-'));
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(paths(dir).events)).digest('hex');
let server;
function run(args) {
  return new Promise((resolve, reject) => {
    // A hard deadline also bounds tools that ignore SIGTERM.
    const child = spawn(process.env.POSTMAN_BINARY || 'postman', [
      'request', ...args, '--no-report-events', '--timeout', '10000',
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, killSignal: 'SIGKILL' });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.once('error', reject);
    // close follows stream completion; exit alone can lose the last assertions.
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `Postman terminated (${signal})` : `Postman exited ${code}`));
    });
  });
}
try {
  ensure(dir);
  const n=addNode({type:'hypothesis',title:'Synthetic handoff candidate'},dir).node;
  const cp=addCheckpoint({summary:'Postman contract handoff'},dir);
  patchNode(n.id,{status:'refuted'},dir,{by:'fixture:reviewer'});
  server=await startServer({cwd:dir,port:0});
  const base=`http://127.0.0.1:${server.address().port}`;
  const check=(body)=>`pm.test('HTTP contract',()=>pm.response.to.have.status(200)); pm.test('read only',()=>pm.expect(pm.response.json().readOnly).to.eql(true)); pm.test('payload contract',()=>{${body}});`;
  const before=sha();
  await run([`${base}/api/history?node=${n.id}`,'--script-post-request',check("pm.expect(pm.response.json().entries.some(e=>e.changes.status && e.changes.status.after==='refuted')).to.eql(true);")]);
  await run([`${base}/api/changes?since=${cp.id}`,'--script-post-request',check(`pm.expect(pm.response.json().nodes.updated.some(n=>n.id==='${n.id}' && n.fields.includes('status'))).to.eql(true);`)]);
  assert.equal(sha(),before);
  // Preserve the colon-containing Origin URL via pm: some installed CLI versions
  // truncate -H values at the second colon. This also exercises the real guard.
  const write=['POST',`${base}/api/nodes`,'--script-pre-request',`pm.request.headers.add({key:'Origin',value:${JSON.stringify(base)}});`,'-H','Content-Type:application/json','-H','Idempotency-Key:postman-observation-1','--body',JSON.stringify({title:'Postman fixture observation'}),'--script-post-request',"pm.test('created',()=>pm.response.to.have.status(201));pm.test('stable id',()=>pm.expect(pm.response.json().node.id).to.eql('n1'));pm.test('unchanged title',()=>pm.expect(pm.response.json().node.title).to.eql('Postman fixture observation'));" ];
  await run(write);const committed=sha();await run(write);assert.equal(sha(),committed);
  await run([`${base}/api/receipt?requestId=postman-observation-1`,'--script-post-request',check("pm.expect(pm.response.json().receipt.status).to.eql('committed');")]);
  assert.equal(sha(),committed);
  console.log('POSTMAN PASS requests=5 assertions=15 readOnlyUnchanged=true duplicateLogUnchanged=true');
} finally {
  if(server)await new Promise((resolve)=>{server.closeAllConnections?.();server.close(resolve);});
  fs.rmSync(dir,{recursive:true,force:true});
}
