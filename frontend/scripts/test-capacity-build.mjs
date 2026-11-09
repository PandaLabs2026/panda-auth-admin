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
  assert.match(args,/--default\n--docker\n/);
  assert.ok(args.includes(f.dir+'\n'));
  assert.ok(args.includes(path.join(f.dir,'src/PandaAuth.Admin/wwwroot/admin')+'\n'));
  assert.ok(args.includes(path.join(f.fe,'node_modules/.vite')+'\n'));
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

function installFixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-admin-install-capacity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {dir,env:{...process.env,npm_config_cache:path.join(dir,'cache')}};
}
for(const command of ['ci','install'])test(`npm ${command} obeys capacity refusal`,{skip:process.platform==='win32'},t=>{
  const f=installFixture(t),bin=path.join(f.dir,'bin');fs.mkdirSync(bin);
  fs.mkdirSync(path.join(f.dir,'scripts'));
  fs.copyFileSync(path.join(frontend,'scripts/capacity-build.mjs'),path.join(f.dir,'scripts/capacity-build.mjs'));
  const manifest=JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8'));
  fs.writeFileSync(path.join(f.dir,'package.json'),JSON.stringify({name:'install-fixture',version:'1.0.0',scripts:{preinstall:manifest.scripts.preinstall}}));
  fs.writeFileSync(path.join(f.dir,'package-lock.json'),JSON.stringify({name:'install-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'install-fixture',version:'1.0.0'}}}));
  fs.writeFileSync(path.join(bin,'python3'),'#!/bin/sh\nprintf called > "$GATE_LOG"\nexit 17\n',{mode:0o755});
  const gate=path.join(f.dir,'gate');
  const result=spawnSync('npm',[command,'--offline','--no-audit','--no-fund'],{cwd:f.dir,encoding:'utf8',env:{...f.env,PATH:bin+path.delimiter+process.env.PATH,GATE_LOG:gate}});
  assert.equal(result.status,17,result.stdout+result.stderr);
  assert.equal(fs.readFileSync(gate,'utf8'),'called');
});
test('container manifest-only install preserves dependency lifecycle scripts',{skip:process.platform==='win32'},t=>{
  const f=installFixture(t),directory=path.join(f.dir,'container'),dependency=path.join(directory,'dependency');
  fs.mkdirSync(dependency,{recursive:true});
  fs.writeFileSync(path.join(dependency,'package.json'),JSON.stringify({name:'capacity-install-fixture',version:'1.0.0',
    scripts:{install:'node -e "require(\'fs\').writeFileSync(\'installed\',\'yes\')"'}}));
  const run=(command,args,cwd=directory)=>spawnSync(command,args,{cwd,env:f.env,encoding:'utf8'});
  let result=run('npm',['pack','--ignore-scripts','--offline','--pack-destination',directory],dependency);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(frontend,'package.json'),'utf8'));
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'container-fixture',version:'1.0.0',
    scripts:{preinstall:manifest.scripts.preinstall},allowScripts:{'file:capacity-install-fixture-1.0.0.tgz':true},
    dependencies:{'capacity-install-fixture':'file:capacity-install-fixture-1.0.0.tgz'}}));
  result=run('npm',['install','--package-lock-only','--ignore-scripts','--offline','--no-audit','--no-fund']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const install=docker.split('\n').find(line=>line.startsWith('RUN ')&&line.includes('npm ci'));
  assert.ok(install,'Dockerfile npm installation command');
  result=run('sh',['-c',install.slice(4)+' --offline']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.ok(fs.existsSync(path.join(directory,'node_modules/capacity-install-fixture/installed')),result.stdout+result.stderr);
  assert.equal(fs.readFileSync(path.join(directory,'node_modules/capacity-install-fixture/installed'),'utf8'),'yes');
});
