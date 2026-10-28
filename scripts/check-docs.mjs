#!/usr/bin/env node
// Offline public-document checks. Authored destinations never enter diagnostics.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import {parseFragment} from 'parse5';
import {privatePath} from './check-publication.mjs';

const markdown=new MarkdownIt({html:true,linkify:false,typographer:false});
const isMarkdown=name=>/\.(?:md|markdown)$/i.test(name);
const publicDocument=name=>isMarkdown(name)&&!privatePath(name)&&!/(?:^|\/)test\/fixtures(?:\/|$)/i.test(name);

function git(root,args) {
  return execFileSync('git',['-c','core.fsmonitor=false',...args],{
    cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,
      GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  });
}

function* imageCandidates(value) {
  // Follow srcset token boundaries, preserving commas inside data URLs.
  let offset=0;
  while(offset<value.length) {
    while(offset<value.length&&/[\t\n\f\r ,]/.test(value[offset])) offset++;
    const start=offset;
    while(offset<value.length&&!/[\t\n\f\r ]/.test(value[offset])) offset++;
    const candidate=value.slice(start,offset);
    if(!candidate) return;
    if(candidate.endsWith(',')) {
      yield candidate.replace(/,+$/,'');
      continue;
    }
    yield candidate;
    let parentheses=0;
    while(offset<value.length) {
      const char=value[offset++];
      if(char==='(') parentheses++;
      else if(char===')') parentheses=Math.max(0,parentheses-1);
      else if(char===','&&!parentheses) break;
    }
  }
}

function inspectHtml(content,line,anchors,links) {
  // parse5 builds an inert tree: scripts, handlers and resources are never run.
  const tree=parseFragment(content,{sourceCodeLocationInfo:true});
  function visit(node) {
    for(const attr of node.attrs||[]) {
      if(attr.name==='id'||(node.tagName==='a'&&attr.name==='name')) anchors.add(attr.value);
      const candidates=attr.name==='srcset'&&(node.tagName==='img'||node.tagName==='source')
        ?imageCandidates(attr.value):attr.name==='href'||attr.name==='src'?[attr.value]:[];
      const location=node.sourceCodeLocation?.attrs?.[attr.name];
      for(const target of candidates) links.push({target,line:line+(location?.startLine||1)-1});
    }
    for(const child of node.childNodes||[]) visit(child);
    // Template contents are inert but still authored markup worth checking.
    if(node.content) visit(node.content);
  }
  visit(tree);
}

function headingText(tokens) {
  let text='';
  for(const token of tokens) {
    if(token.type==='text'||token.type==='code_inline') text+=token.content;
    else if(token.type==='softbreak'||token.type==='hardbreak') text+=' ';
    else if(token.type==='image') text+=headingText(token.children||[]);
  }
  return text;
}

function document(content) {
  const tokens=markdown.parse(content,{}),anchors=new Set(),links=[],slugger=new GithubSlugger();
  for(let index=0;index<tokens.length;index++) {
    const token=tokens[index],line=(token.map?.[0]||0)+1;
    if(token.type==='heading_open') anchors.add(slugger.slug(headingText(tokens[index+1]?.children||[])));
    if(token.type==='html_block') inspectHtml(token.content,line,anchors,links);
    if(token.type!=='inline') continue;
    let inlineLine=line;
    for(const child of token.children||[]) {
      if(child.type==='link_open') links.push({target:child.attrGet('href'),line:inlineLine});
      else if(child.type==='image') {
        links.push({target:child.attrGet('src'),line:inlineLine});
        // Image labels are text, even when they resemble HTML or links.
      } else if(child.type==='html_inline') inspectHtml(child.content,inlineLine,anchors,links);
      if(child.type==='softbreak'||child.type==='hardbreak') inlineLine++;
      else if(child.content&&child.type!=='image') inlineLine+=child.content.split('\n').length-1;
    }
  }
  return {anchors,links};
}

function within(root,file) {
  const relative=path.relative(root,file);
  return relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
}

// Passing files lets consumers check disposable trees without requiring Git.
// Findings contain only the source path, line and a fixed reason code.
export function checkDocs(root,{files}={}) {
  root=fs.realpathSync(root);
  const names=files??git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  const sources=[...new Set(names.map(name=>name.replaceAll('\\','/')))].filter(publicDocument).sort();
  const findings=[],documents=new Map();
  let checked=0;
  const add=(source,line,reason)=>findings.push({path:source,line,reason});
  function load(file) {
    if(!documents.has(file)) documents.set(file,document(fs.readFileSync(file,'utf8')));
    return documents.get(file);
  }
  function publicFile(file) {
    if(!within(root,file)) return 'outside-repository';
    if(privatePath(path.relative(root,file))) return 'private-target';
    return null;
  }
  for(const source of sources) {
    let file=path.resolve(root,source),parsed;
    try {
      const reason=publicFile(file);
      if(reason) {add(source,1,reason);continue;}
      file=fs.realpathSync(file);
      const resolvedReason=publicFile(file);
      if(resolvedReason) {add(source,1,resolvedReason);continue;}
      parsed=load(file);
      checked++;
    } catch {
      add(source,1,'unreadable-document');
      continue;
    }
    for(const link of parsed.links) {
      const target=link.target?.trim()||'';
      // All schemes and protocol-relative URLs stay offline, including mailto.
      if(/^[a-z][a-z\d+.-]*:/i.test(target)||target.startsWith('//')) continue;
      const hash=target.indexOf('#');
      const beforeHash=hash<0?target:target.slice(0,hash);
      const query=beforeHash.indexOf('?');
      let destination,fragment;
      try {
        destination=decodeURIComponent(query<0?beforeHash:beforeHash.slice(0,query));
        fragment=hash<0?'':decodeURIComponent(target.slice(hash+1));
      } catch {
        add(source,link.line,'invalid-target-encoding');
        continue;
      }
      let resolved=destination?(destination.startsWith('/')?path.resolve(root,'.'+destination):path.resolve(path.dirname(file),destination)):file;
      const reason=publicFile(resolved);
      if(reason) {add(source,link.line,reason);continue;}
      try {
        resolved=fs.realpathSync(resolved);
        const resolvedReason=publicFile(resolved);
        if(resolvedReason) {add(source,link.line,resolvedReason);continue;}
        if(fs.statSync(resolved).isDirectory()) {
          // GitHub directory links are valid by themselves. A fragment refers
          // to the directory's rendered README when one is present.
          if(!fragment) continue;
          const readme=fs.readdirSync(resolved).filter(name=>/^readme\.(?:md|markdown)$/i.test(name)).sort()[0];
          if(!readme) {add(source,link.line,'directory-without-markdown-readme');continue;}
          resolved=fs.realpathSync(path.join(resolved,readme));
          const readmeReason=publicFile(resolved);
          if(readmeReason) {add(source,link.line,readmeReason);continue;}
        }
        if(fragment&&isMarkdown(resolved)&&!load(resolved).anchors.has(fragment)) add(source,link.line,'missing-fragment');
      } catch(error) {
        add(source,link.line,error.code==='ENOENT'||error.code==='ENOTDIR'?'missing-target':'unreadable-target');
      }
    }
  }
  return {checked,findings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if(process.argv.length>2) throw new Error('No arguments supported');
    const root=git(process.cwd(),['rev-parse','--show-toplevel']).trim();
    const result=checkDocs(root);
    if(result.findings.length) {
      console.error('Documentation check failed: '+result.findings.length+' finding(s); destinations withheld.');
      for(const finding of result.findings) console.error(JSON.stringify(finding));
      process.exitCode=1;
    } else console.log('Documentation check PASS: '+result.checked+' Markdown files; local links and anchors resolve.');
  } catch {
    console.error('Documentation check stopped: local Git state or documents need review.');
    process.exitCode=1;
  }
}
