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
