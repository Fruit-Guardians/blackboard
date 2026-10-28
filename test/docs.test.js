import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkDocs} from '../scripts/check-docs.mjs';

const checker=fileURLToPath(new URL('../scripts/check-docs.mjs',import.meta.url));
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'blackboard-docs-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function write(root,name,content='synthetic fixture') {
  const file=path.join(root,name);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,content);
}
function git(root,args) {
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8',
    env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_TERMINAL_PROMPT:'0'}});
  assert.equal(result.status,0,result.stderr);
  return result;
}

test('Unicode and duplicate headings resolve using GitHub anchor suffixes',(t)=>{
  const root=fixture(t);
  write(root,'chapters/guide.md',[
    '# 中文 标题', '# 中文 标题', '# 中文 标题-1', '# 中文 标题',
    '# Café & Tea!', '# **Strong** `code` [label](../README.md)',
  ].join('\n\n'));
  write(root,'README.md',[
    '[Unicode](chapters/guide.md#中文-标题)',
    '[Encoded](chapters/guide.md#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98-1)',
    '[Collision](chapters/guide.md#中文-标题-1-1)',
    '[Third](chapters/guide.md#中文-标题-2)',
    '[Accented](chapters/guide.md#café--tea)',
    '[Formatting](chapters/guide.md#strong-code-label)',
  ].join('\n'));
  assert.deepEqual(checkDocs(root,{files:['README.md','chapters/guide.md']}),{checked:2,findings:[]});
  write(root,'README.md','[Wrong duplicate](chapters/guide.md#中文-标题-3)');
  assert.deepEqual(checkDocs(root,{files:['README.md']}).findings,[{path:'README.md',line:1,reason:'missing-fragment'}]);
});

test('reference links, Markdown images and inert HTML anchors and attributes resolve',(t)=>{
  const root=fixture(t);
  write(root,'images/picture one.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(root,'guide.md',[
    '# Guide', '', '<a id="explicit-中文"></a>', '', '<a name="legacy-anchor"></a>', '',
    '<div id="escaped&amp;anchor">Synthetic anchor</div>',
  ].join('\n'));
  write(root,'README.md',[
    '[Guide][manual]', '[manual]: guide.md#explicit-中文', '',
    '[Legacy](guide.md#legacy-anchor)', '[Entity](guide.md#escaped%26anchor)',
    '![Image][picture]', '[picture]: images/picture%20one.svg', '',
    '<a href="guide.md#explicit-中文">HTML link</a>',
    '<img src="images/picture%20one.svg" alt="synthetic">',
    '<img src="images/picture one.svg" alt="synthetic">',
    '<a href="guide.md#escaped&amp;anchor">HTML entity</a>',
    '<picture><source srcset="images/picture%20one.svg 1x, images/picture%20one.svg 2x"></picture>',
    '<img srcset="data:image/png;base64,c3ludGhldGlj 1x, images/picture%20one.svg 2x">',
    '', '<section id="local-html">Inline <a href="#local-html">anchor</a></section>',
  ].join('\n'));
  assert.deepEqual(checkDocs(root,{files:['README.md','guide.md']}).findings,[]);
  write(root,'README.md',[
    '<div>', '  <img', '    src="images/missing.svg">', '</div>', '',
    'Inline <a href="guide.md#missing">broken fragment</a>.',
  ].join('\n'));
  assert.deepEqual(checkDocs(root,{files:['README.md']}).findings,[
    {path:'README.md',line:3,reason:'missing-target'},
    {path:'README.md',line:6,reason:'missing-fragment'},
  ]);
  write(root,'README.md','<img srcset="images/picture%20one.svg 1x, images/missing.svg 2x">');
  assert.deepEqual(checkDocs(root,{files:['README.md']}).findings,[{path:'README.md',line:1,reason:'missing-target'}]);
});

test('fenced and inline code stay examples and script text is never evaluated as markup',(t)=>{
  const root=fixture(t);
  write(root,'README.md',[
    '# Visible', '', '```markdown', '[missing](not-present.md)', '<img src="missing.png">',
    '<a id="fake-anchor"></a>', '```', '', '~~~html', '<img src="also-missing.png">', '~~~', '',
    '`[missing](not-present.md)` and `<img src="missing.png">`.', '',
    '<script>throw new Error("must stay inert"); "<img src=missing.png>";</script>', '',
    '[Valid](#visible)',
  ].join('\n'));
  assert.deepEqual(checkDocs(root,{files:['README.md']}).findings,[]);
  write(root,'links.md','[Code cannot define an anchor](README.md#fake-anchor)');
  assert.deepEqual(checkDocs(root,{files:['links.md']}).findings,[{path:'links.md',line:1,reason:'missing-fragment'}]);
});

test('relative and root paths, encoded filenames, query strings and directory READMEs resolve',(t)=>{
  const root=fixture(t);
  write(root,'docs/README.md','# Directory guide');
  write(root,'docs/guide #1.md','# Section');
  write(root,'plain-directory/item.txt');
  write(root,'asset.svg','<svg/>');
  write(root,'README.md',[
    '[Directory](docs/)', '[Directory fragment](docs/#directory-guide)',
    '[File](docs/guide%20%231.md?download=1#section)', '[Root](/docs/README.md#directory-guide)',
    '[Plain directory](plain-directory/)', '[Asset](asset.svg#unvalidated-svg-fragment)',
    '[Top](#)', '[Self query](?view=1)',
  ].join('\n'));
  assert.deepEqual(checkDocs(root,{files:['README.md','docs/README.md']}).findings,[]);
  write(root,'docs/child.md','[Parent](../README.md)');
  assert.deepEqual(checkDocs(root,{files:['docs/child.md']}).findings,[]);
  write(root,'README.md','[No README](plain-directory/#section)');
  assert.deepEqual(checkDocs(root,{files:['README.md']}).findings,[
    {path:'README.md',line:1,reason:'directory-without-markdown-readme'},
  ]);
});

test('broken destinations produce fixed reasons without authored targets or bodies',(t)=>{
  const root=fixture(t);
  const marker='synthetic-private-destination';
  write(root,'README.md',[
    `[${marker}](${marker}.md)`, `[Hidden](#${marker})`,
    `[Encoding](${marker}%FF.md)`, `[Outside](../${marker}.md)`,
    '[Private](trial/private.md)', '[Reference][missing-file]', '',
    `[missing-file]: ${marker}-reference.md`,
    `[External](https://example.invalid/${marker})`, '[Mail](mailto:fixture@example.invalid)',
    '[Protocol relative](//example.invalid/missing.md)',
  ].join('\n'));
  const result=checkDocs(root,{files:['README.md']});
  assert.deepEqual(result.findings,[
    {path:'README.md',line:1,reason:'missing-target'},
    {path:'README.md',line:2,reason:'missing-fragment'},
    {path:'README.md',line:3,reason:'invalid-target-encoding'},
    {path:'README.md',line:4,reason:'outside-repository'},
    {path:'README.md',line:5,reason:'private-target'},
    {path:'README.md',line:6,reason:'missing-target'},
  ]);
  assert.equal(JSON.stringify(result).includes(marker),false);
});

test('Git discovery includes tracked and unignored public Markdown while excluding private and fixture trees',(t)=>{
  const root=fixture(t);
  git(root,['init','--quiet']);
  write(root,'.gitignore','ignored/\n');
  write(root,'README.md','# Tracked');
  write(root,'docs/new.markdown','# Untracked');
  write(root,'ignored/example.md','[broken](missing.md)');
  write(root,'trial/private.md','[broken](missing.md)');
  write(root,'.agents/local.md','[broken](missing.md)');
  write(root,'test/fixtures/example.md','[broken](missing.md)');
  write(root,'plugins/example/test/fixtures/example.md','[broken](missing.md)');
  git(root,['add','README.md','trial/private.md']);
  assert.deepEqual(checkDocs(root),{checked:2,findings:[]});
});

test('CLI rejects broken links with redacted source diagnostics and succeeds without networking',(t)=>{
  const root=fixture(t);
  git(root,['init','--quiet']);
  const marker='synthetic-private-cli-target';
  write(root,'README.md',`[secret destination](${marker}.md)`);
  const run=()=>spawnSync(process.execPath,[checker],{cwd:root,encoding:'utf8'});
  const broken=run();
  assert.equal(broken.status,1);
  assert.match(broken.stderr,/"path":"README.md","line":1,"reason":"missing-target"/);
  assert.equal(broken.stderr.includes(marker),false);
  write(root,'README.md','[Remote](https://example.invalid/unreachable)\n# Valid\n[Local](#valid)');
  const valid=run();
  assert.equal(valid.status,0,valid.stderr);
  assert.match(valid.stdout,/Documentation check PASS: 1 Markdown files/);
});
