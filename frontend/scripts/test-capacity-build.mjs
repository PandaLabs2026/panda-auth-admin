import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.dirname(frontend);
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-admin-capacity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const fe=path.join(dir,'frontend'),scripts=path.join(fe,'scripts'),bin=path.join(dir,'bin'),tools=path.join(fe,'node_modules/.bin');
  fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(bin);fs.mkdirSync(tools,{recursive:true});
  fs.copyFileSync(path.join(frontend,'package.json'),path.join(fe,'package.json'));
  const guard=path.join(frontend,'scripts/capacity-build.mjs');
  if(fs.existsSync(guard))fs.copyFileSync(guard,path.join(scripts,'capacity-build.mjs'));
  fs.writeFileSync(path.join(bin,'python3'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$GATE_LOG"\nexit "${GATE_EXIT:-0}"\n',{mode:0o755});
  for(const name of ['tsc','vite'])fs.writeFileSync(path.join(tools,name),`#!/bin/sh\nprintf '%s\\n' '${name}' "$@" >> "$BUILD_LOG"\n`,{mode:0o755});
  const gate=path.join(dir,'gate.log'),built=path.join(dir,'build.log');
  return {dir,fe,gate,built,env:{...process.env,HOME:dir,PATH:bin+path.delimiter+process.env.PATH,GATE_LOG:gate,BUILD_LOG:built}};
}
function build(f,extra={}){return spawnSync('npm',['run','build'],{cwd:f.fe,env:{...f.env,...extra},encoding:'utf8'});}

test('capacity rejection blocks TypeScript and Vite',{skip:process.platform==='win32'?'POSIX executable fixture':false},t=>{
  const f=fixture(t),result=build(f,{GATE_EXIT:'17'});
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.existsSync(f.built),false);
  const args=fs.readFileSync(f.gate,'utf8');
  assert.match(args,/--default\n/);
  assert.doesNotMatch(args,/--docker|--outer-capacity-admitted/);
  assert.ok(args.includes(f.dir+'\n'));
  assert.ok(args.includes(path.join(f.dir,'src/PandaAuth.Admin/wwwroot/admin')+'\n'));
  assert.ok(args.includes(path.join(f.fe,'node_modules/.vite')+'\n'));
});

test('native frontend admission needs no Docker but still gates the build',{skip:process.platform==='win32'?'POSIX executable fixture':false},t=>{
  const f=fixture(t);
  const interpreter=path.join(f.dir,'bin/python3');
  fs.writeFileSync(interpreter,'#!/bin/sh\nprintf "%s\\n" "$@" > "$GATE_LOG"\nfor argument in "$@"; do [ "$argument" != "--docker" ] || exit 23; done\nexit 0\n',{mode:0o755});
  const result=build(f);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.readFileSync(f.built,'utf8'),'tsc\n--noEmit\nvite\nbuild\n');
  assert.match(fs.readFileSync(f.gate,'utf8'),/--default\n/);
});

test('admitted host build retains TypeScript then Vite',{skip:process.platform==='win32'?'POSIX executable fixture':false},t=>{
  const f=fixture(t),result=build(f);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.readFileSync(f.built,'utf8'),'tsc\n--noEmit\nvite\nbuild\n');
});

test('Docker frontend runs the same build tools without host-only meta',()=>{
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  assert.match(docker,/^RUN \.\/node_modules\/\.bin\/tsc --noEmit && \.\/node_modules\/\.bin\/vite build$/m);
  assert.doesNotMatch(docker,/^RUN npm run build$/m);
});

test('container install pins pnpm and keeps only its lock file',()=>{
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8'));
  assert.match(manifest.packageManager,/^pnpm@\d+\.\d+\.\d+$/);
  assert.ok(fs.existsSync(path.join(frontend,'pnpm-lock.yaml')));
  assert.equal(fs.existsSync(path.join(frontend,'package-lock.json')),false);
  assert.match(docker,/^COPY panda-auth-admin\/frontend\/package.json panda-auth-admin\/frontend\/pnpm-lock.yaml \.\/$/m);
  assert.ok(docker.includes(`--package=${manifest.packageManager} -- pnpm install --frozen-lockfile`));
  assert.doesNotMatch(docker,/^RUN npm ci$/m);
});

test('container manifest-only install runs approved dependency lifecycle scripts',{skip:process.platform==='win32'},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-admin-install-capacity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const directory=path.join(dir,'container'),dependency=path.join(directory,'dependency');
  fs.mkdirSync(dependency,{recursive:true});
  fs.writeFileSync(path.join(dependency,'package.json'),JSON.stringify({name:'capacity-install-fixture',version:'1.0.0',
    scripts:{install:`node -e "require('fs').writeFileSync('installed','yes')"`}}));
  const env={...process.env,npm_config_offline:'true',
    PNPM_CONFIG_STORE_DIR:path.join(dir,'store'),PNPM_CONFIG_CACHE_DIR:path.join(dir,'metadata')};
  const run=(command,args,cwd=directory)=>spawnSync(command,args,{cwd,env,encoding:'utf8'});
  let result=run('npm',['pack','--ignore-scripts','--offline','--pack-destination',directory],dependency);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8'));
  assert.match(manifest.packageManager,/^pnpm@/);
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'container-fixture',version:'1.0.0',
    dependencies:{'capacity-install-fixture':'file:capacity-install-fixture-1.0.0.tgz'}}));
  fs.writeFileSync(path.join(directory,'pnpm-workspace.yaml'),'allowBuilds:\n  "capacity-install-fixture@file:capacity-install-fixture-1.0.0.tgz": true\n');
  result=run('npm',['exec','--offline','--yes',`--package=${manifest.packageManager}`,'--','pnpm',
    'install','--lockfile-only','--ignore-scripts','--offline']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const install=docker.split('\n').map(line=>line.trim()).find(line=>line.startsWith('npm exec ')&&line.includes('pnpm install --frozen-lockfile'));
  assert.ok(install,'Dockerfile frozen pnpm installation command');
  result=run('sh',['-c',install+' --offline']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const marker=path.join(directory,'node_modules/capacity-install-fixture/installed');
  assert.ok(fs.existsSync(marker),result.stdout+result.stderr);
  assert.equal(fs.readFileSync(marker,'utf8'),'yes');
});

for(const command of ['ci','install'])test(`dependency entry deps:${command} rejects before resolution`,t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dependency-entry-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const packageDir=path.join(directory,'frontend'),helper=path.join(directory,'frontend/scripts/capacity-build.mjs');
  fs.mkdirSync(packageDir,{recursive:true});fs.mkdirSync(path.dirname(helper),{recursive:true});
  fs.copyFileSync(path.join(root,'frontend/scripts/capacity-build.mjs'),helper);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'frontend','package.json'),'utf8'));
  const script=`deps:${command}`;
  fs.writeFileSync(path.join(packageDir,'package.json'),JSON.stringify({...manifest,scripts:{[script]:manifest.scripts[script]}}));
  fs.copyFileSync(path.join(root,'frontend','pnpm-lock.yaml'),path.join(packageDir,'pnpm-lock.yaml'));
  const npm=process.env.npm_execpath||(process.platform==='win32'
    ?path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'):'/usr/bin/npm');
  const result=spawnSync(process.execPath,[npm,'run',script,'--','--offline'],{
    cwd:packageDir,encoding:'utf8',env:{...process.env,TMPDIR:'',TMP:'',TEMP:'',
      PANDALABS_TEMP_ROOT:'',PANDALABS_BUILD_TEMP_ROOT:'',npm_config_cache:path.join(directory,'cache')},
  });
  const output=(result.stdout||'')+(result.stderr||'');
  assert.notEqual(result.status,null,output);assert.notEqual(result.status,0,output);
  assert.match(output,/task temporary variables.*required/);
  assert.equal(fs.existsSync(path.join(packageDir,'node_modules')),false);
});
