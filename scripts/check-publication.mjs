#!/usr/bin/env node
// Local-only publication hygiene. Findings report locations/rules, never values.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const LOCAL_DIRS=new Set(['.blackboard','.agents','.claude','.codex','.zcode','.dsh']);
const PRIVATE_ROOTS=new Set(['trial','recon','report','reports','evidence','backups','artifacts','dist','artifact','coverage']);
const PUBLIC_ENV=new Set(['.env.example','.env.template']);
const CREDENTIAL_FILES=new Set(['.npmrc','.netrc','.pypirc','credentials.json']);
const SYNTHETIC_TOKEN='ghp_'+'abcdefghijklmnopqrstuvwxyz0123456789';

function git(root,args) {
  return execFileSync('git',['-c','core.fsmonitor=false',...args],{
    cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,
      GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  });
}

export function privatePath(name) {
  const parts=name.replaceAll('\\','/').toLowerCase().split('/');
  const base=parts.at(-1);
  return parts.some(part=>LOCAL_DIRS.has(part)) || PRIVATE_ROOTS.has(parts[0]) || CREDENTIAL_FILES.has(base) ||
    (/^\.env(?:\.|$)/.test(base) && !PUBLIC_ENV.has(base)) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/.test(base) ||
    /\.(?:pem|key|ppk|p12|pfx|tgz)$/i.test(base);
}

export function inspectContent(name,content,terms=[]) {
  const findings=[];
  const add=(rule,line=0)=>findings.push({path:name,rule,line});
  if(privatePath(name)) add('local-or-private-path');
  const lowerName=name.toLowerCase();
  if(terms.some(term=>lowerName.includes(term.toLowerCase()))) add('private-project-name');
  const lines=content.split(/\r?\n/);
  for(const [index,line] of lines.entries()) {
    if(/(?:\/Users\/|\/home\/)[^/\s"'<>]+\//.test(line) || /[A-Z]:\\Users\\[^\\\s]+\\/i.test(line)) add('absolute-home-path',index+1);
    const tokens=line.match(/(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|npm_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16})/g)||[];
    if(tokens.some(token=>token!==SYNTHETIC_TOKEN)) add('credential-like-token',index+1);
    if(terms.some(term=>line.toLowerCase().includes(term.toLowerCase()))) add('private-project-content',index+1);
  }
  // The redaction tests contain a three-letter dummy block, not key material.
  const keyText=content.replace(/\\r\\n|\\n|\\r/g,'\n');
  if(/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END/.test(keyText)) add('private-key-material');
  return findings;
}

function privateTerms(root) {
  const relative=git(root,['rev-parse','--git-path','info/publication-deny.json']).trim();
  const file=path.resolve(root,relative);
  if(!fs.existsSync(file)) return [];
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(config.terms)||config.terms.some(term=>typeof term!=='string'||term.length<3)) throw new Error('Invalid local deny configuration');
  return config.terms;
}

function entries(root,ref) {
  const raw=ref?git(root,['ls-tree','-r','-z',ref]):git(root,['ls-files','--stage','-z']);
  return raw.split('\0').filter(Boolean).map(record=>{
    const tab=record.indexOf('\t');
    const [mode,second,third]=record.slice(0,tab).split(' ');
    if(!ref&&third!=='0') throw new Error('Unmerged index');
    return {name:record.slice(tab+1),mode,oid:ref?third:second};
  });
}

export function checkPublication(root,{mode='working',pushInput=''}={}) {
  const terms=privateTerms(root),findings=[],seen=new Set(),blobs=new Map();
  let checked=0;
  function inspect(name,content,commit) {
    checked++;
    for(const finding of inspectContent(name,content,terms)) {
      const key=JSON.stringify({...finding,commit});
      if(!seen.has(key)){seen.add(key);findings.push({...finding,...(commit?{commit}:{})});}
    }
  }
  function tree(ref) {
    for(const entry of entries(root,ref)) {
      if(entry.mode==='160000') continue;
      if(entry.mode==='120000') {
        findings.push({path:entry.name,rule:'symbolic-link-review',line:0,...(ref?{commit:ref}:{})});
        continue;
      }
      if(!blobs.has(entry.oid)) blobs.set(entry.oid,git(root,['cat-file','blob',entry.oid]));
      inspect(entry.name,blobs.get(entry.oid),ref);
    }
  }
  if(mode==='working') {
    const names=git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
    for(const name of new Set(names)) {
      const file=path.join(root,name);
      if(!fs.existsSync(file)) continue;
      if(fs.lstatSync(file).isSymbolicLink()) {
        findings.push({path:name,rule:'symbolic-link-review',line:0});
        continue;
      }
      if(fs.statSync(file).isFile()) inspect(name,fs.readFileSync(file,'utf8'));
    }
  } else if(mode==='staged') {
    tree(null);
  } else if(mode==='push') {
    const commits=new Set();
    for(const line of pushInput.split('\n').filter(Boolean)) {
      const fields=line.trim().split(/\s+/);
      if(fields.length!==4) throw new Error('Invalid pre-push input');
      const [,local,,remote]=fields;
      if(!/^[a-f0-9]{40,64}$/.test(local)||!/^[a-f0-9]{40,64}$/.test(remote)) throw new Error('Invalid push object');
      if(/^0+$/.test(local)) continue;
      // Always inspect the published tip. Also inspect intervening commits so
      // adding then deleting a secret does not hide it in the pushed history.
      commits.add(local);
      const args=/^0+$/.test(remote)?['rev-list',local,'--not','--remotes']:['rev-list',`${remote}..${local}`];
      for(const commit of git(root,args).trim().split('\n').filter(Boolean)) commits.add(commit);
    }
    for(const commit of commits) tree(commit);
  } else throw new Error('Unknown publication mode');
  return {checked,findings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const flag=process.argv[2]||'--working';
    if(!['--working','--staged','--push'].includes(flag)||process.argv.length>3) throw new Error('Invalid arguments');
    const root=git(process.cwd(),['rev-parse','--show-toplevel']).trim();
    const result=checkPublication(root,{mode:flag.slice(2),pushInput:flag==='--push'?fs.readFileSync(0,'utf8'):''});
    if(result.findings.length) {
      console.error('Publication check blocked: '+result.findings.length+' finding(s); values withheld.');
      for(const finding of result.findings) console.error(JSON.stringify(finding));
      process.exitCode=1;
    } else console.log('Publication check PASS: '+result.checked+' file checks; no findings.');
  } catch {
    console.error('Publication check stopped: local Git state or input needs review.');
    process.exitCode=1;
  }
}
