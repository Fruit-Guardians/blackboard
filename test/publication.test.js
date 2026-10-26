import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privatePath,inspectContent,checkPublication} from '../scripts/check-publication.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const ZERO='0'.repeat(40);
const fakeToken='ghp_'+'Z'.repeat(36);
function git(cwd,args,expected=0) {
  const result=spawnSync('git',args,{cwd,encoding:'utf8',
    env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_TERMINAL_PROMPT:'0'}});
  assert.equal(result.status,expected,result.stderr);
  return result;
}
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'blackboard-publication-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  git(root,['init','--quiet']);
  git(root,['config','user.name','Publication Fixture']);
  git(root,['config','user.email','fixture@example.invalid']);
  git(root,['config','core.hooksPath',path.join(root,'.git','no-hooks')]);
  fs.copyFileSync(path.join(ROOT,'.gitignore'),path.join(root,'.gitignore'));
  return root;
}
function write(root,name,content='synthetic fixture') {
  const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
}

test('publication paths exclude real-run data, installed adapters and key files, not source or synthetic tests',()=>{
  for(const name of ['trial/run/corpus.jsonl','.claude/settings.json','.agents/skills/x/SKILL.md',
    '.blackboard/events.jsonl','.zcode/workflow.json','recon/response.txt','report/client.md',
    '.env','.env.production','.npmrc','credentials.json','TRIAL/result.json','private.key','identity.pem','dist/candidate.tgz']) assert.equal(privatePath(name),true,name);
  for(const name of ['lib/context.js','test/recovery.test.js','skills/blackboard/SKILL.md',
    'docs/RECOVERY_EXPERIMENT.md','.env.example','.env.template','public/index.html']) assert.equal(privatePath(name),false,name);
});

test('content findings contain rules and positions, never credential values or matched private terms',()=>{
  const customer='fixture-private-customer';
  const home=['','Users','fixture-user','private'].join('/');
  const findings=inspectContent('sample.txt',[fakeToken,home,customer].join('\n'),[customer]);
  assert.deepEqual(new Set(findings.map(f=>f.rule)),new Set(['credential-like-token','absolute-home-path','private-project-content']));
  const output=JSON.stringify(findings);
  assert.equal(output.includes(fakeToken),false);
  assert.equal(output.includes(home),false);
  assert.equal(output.includes(customer),false);
});

test('known dummy redaction inputs are distinguished from private key material',()=>{
  const dummy='ghp_'+'abcdefghijklmnopqrstuvwxyz0123456789';
  const begin='-----BEGIN '+'OPENSSH PRIVATE KEY-----';
  const end='-----END '+'OPENSSH PRIVATE KEY-----';
  assert.deepEqual(inspectContent('test/redaction.js',dummy+'\n'+begin+'\nabc\n'+end),[]);
  assert.ok(inspectContent('sample.txt',begin+'\n'+'A'.repeat(96)+'\n'+end).some(f=>f.rule==='private-key-material'));
  assert.ok(inspectContent('sample.json',JSON.stringify({private_key:begin+'\n'+'A'.repeat(96)+'\n'+end})).some(f=>f.rule==='private-key-material'));
});

test('ordinary git add leaves private working files local; forced staging is still caught',(t)=>{
  const root=fixture(t);
  for(const name of ['trial/result.json','.agents/skills/local/SKILL.md','.claude/settings.json','recon/body.txt','.env'])write(root,name);
  write(root,'sample.js','export const sample = true;');
  git(root,['add','-A']);
  const tracked=git(root,['ls-files']).stdout;
  assert.equal(tracked.includes('trial/'),false);
  assert.equal(tracked.includes('.claude/'),false);
  assert.equal(tracked.includes('.agents/'),false);
  assert.equal(tracked.includes('.env'),false);
  assert.deepEqual(checkPublication(root,{mode:'staged'}).findings,[]);
  git(root,['add','-f','trial/result.json']);
  assert.ok(checkPublication(root,{mode:'staged'}).findings.some(f=>f.path==='trial/result.json'&&f.rule==='local-or-private-path'));
});

test('staged scan reads the index, not a cleaned working-file replacement',(t)=>{
  const root=fixture(t);
  write(root,'sample.txt',fakeToken);git(root,['add','sample.txt']);
  write(root,'sample.txt','clean replacement');
  assert.deepEqual(checkPublication(root,{mode:'working'}).findings,[]);
  assert.ok(checkPublication(root,{mode:'staged'}).findings.some(f=>f.rule==='credential-like-token'));
});

test('push scan finds a private intermediate commit even when the final tree deletes it',(t)=>{
  const root=fixture(t);
  write(root,'sample.txt','initial');git(root,['add','-A']);git(root,['commit','--quiet','-m','initial']);
  const base=git(root,['rev-parse','HEAD']).stdout.trim();
  write(root,'trial/private.json','synthetic private fixture');git(root,['add','-f','trial/private.json']);git(root,['commit','--quiet','-m','fixture intermediate']);
  const intermediate=git(root,['rev-parse','HEAD']).stdout.trim();
  git(root,['rm','--quiet','trial/private.json']);git(root,['commit','--quiet','-m','fixture cleanup']);
  const tip=git(root,['rev-parse','HEAD']).stdout.trim();
  const pushInput=`refs/heads/main ${tip} refs/heads/main ${base}\n`;
  assert.ok(checkPublication(root,{mode:'push',pushInput}).findings.some(f=>f.path==='trial/private.json'&&f.commit===intermediate));
  assert.deepEqual(checkPublication(root,{mode:'push',pushInput:`refs/heads/main ${ZERO} refs/heads/main ${tip}\n`}).findings,[]);
});

test('private project identifiers live in local git info, not a public scanner source file',(t)=>{
  const root=fixture(t);
  write(root,'sample.txt','fixture-client-marker');git(root,['add','sample.txt']);
  assert.deepEqual(checkPublication(root,{mode:'staged'}).findings,[]);
  write(root,'.git/info/publication-deny.json',JSON.stringify({terms:['fixture-client-marker']}));
  assert.ok(checkPublication(root,{mode:'staged'}).findings.some(f=>f.rule==='private-project-content'));
  assert.equal(git(root,['ls-files']).stdout.includes('publication-deny'),false);
});

test('the real pre-commit hook blocks a staged synthetic credential without echoing it',(t)=>{
  const root=fixture(t);
  fs.mkdirSync(path.join(root,'scripts'));
  fs.copyFileSync(path.join(ROOT,'scripts/check-publication.mjs'),path.join(root,'scripts/check-publication.mjs'));
  fs.mkdirSync(path.join(root,'.githooks'));
  fs.copyFileSync(path.join(ROOT,'.githooks/pre-commit'),path.join(root,'.githooks/pre-commit'));
  fs.chmodSync(path.join(root,'.githooks/pre-commit'),0o755);
  git(root,['config','core.hooksPath','.githooks']);
  write(root,'sample.txt',fakeToken);git(root,['add','sample.txt']);
  const result=git(root,['commit','--quiet','-m','fixture'],1);
  assert.match(result.stderr,/Publication check blocked/);
  assert.equal(result.stderr.includes(fakeToken),false);
});

test('root ignore rules protect private paths while keeping regression code publishable',()=>{
  for(const name of ['trial/REPORT.md','.agents/skills/blackboard/SKILL.md','.claude/settings.json',
    '.zcode/workflow.json','recon/response.txt','report/client.md','.env','.npmrc','identity.pem']) {
    git(ROOT,['check-ignore','--no-index','--quiet',name]);
  }
  for(const name of ['test/context-whole-records.test.js','scripts/check-publication.mjs','.githooks/pre-push']) {
    git(ROOT,['check-ignore','--no-index','--quiet',name],1);
  }
});
