import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const frontend=fileURLToPath(new URL('../',import.meta.url));
const root=path.dirname(frontend);
const meta=process.platform==='win32'?'D:\\dev\\pandalabs\\meta':path.join(os.homedir(),'dev/pandalabs/meta');
const result=spawnSync(process.platform==='win32'?'python':'python3',[
  '-I','-B',path.join(meta,'scripts/capacity_preflight.py'),'--default','--docker',
  '--path',root,'--path',path.join(root,'src/PandaAuth.Admin/wwwroot/admin'),'--path',path.join(frontend,'node_modules/.vite'),
],{cwd:frontend,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
