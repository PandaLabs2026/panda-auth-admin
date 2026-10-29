import { useCallback,useEffect,useRef,useState,useSyncExternalStore,type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AuthContext } from './context';
import AuthStatusPage from './AuthStatusPage';
import type { AuthAdapter } from './types';
import type { AuthLifecycle } from './lifecycle';
import type { AuthNavigation } from './navigation';
type State<S>={kind:'checking'|'ready'|'anonymous'|'unavailable'|'forbidden'|'loop'|'signed-out'|'logout-error'|'logging-out';session?:S;status?:number;handoff?:string;incomplete?:boolean};
type Props<S>={adapter?:AuthAdapter<S>;lifecycle:AuthLifecycle;navigation:AuthNavigation;brand:ReactNode;target:string;terminal?:boolean;revalidateOnResume?:boolean;recoveryPresentation?:'restore'|'quiet';children:ReactNode};
export default function AuthBoundary<S>(props:Props<S>) {
 if(!props.adapter)return <AuthStatusPage brand={props.brand} title="登录配置未完成" description="此应用尚未配置真实认证适配器，请联系管理员。"/>;
 return <ConfiguredBoundary {...props} adapter={props.adapter}/>;
}
function ConfiguredBoundary<S>({adapter,lifecycle,navigation,brand,target,terminal=false,revalidateOnResume=false,recoveryPresentation,children}:Props<S>&{adapter:AuthAdapter<S>}) {
 const stopped=terminal||navigation.wasSignedOut()||navigation.logoutPending();
 const [state,setState]=useState<State<S>>(() => ({kind:!terminal&&navigation.logoutPending()?'logout-error':stopped?'signed-out':'checking',incomplete:stopped&&!terminal}));
 const [revision,setRevision]=useState(0),[businessGeneration,setBusinessGeneration]=useState(0);
 const mode=useRef<'forced'|'resume'>('forced'),request=useRef<AbortController|undefined>(undefined);
 const generation=useRef(0),verifying=useRef(false),entered=useRef(false),leaving=useRef(false),loggingOut=useRef(false),mounted=useRef(false);
 const protections=useSyncExternalStore(lifecycle.subscribe,() => lifecycle.reasons().join('、'));
 const paused=useSyncExternalStore(lifecycle.subscribe,lifecycle.paused);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 const recheck=useCallback(() => {
  if(loggingOut.current)return;
  if(verifying.current&&mode.current==='resume'){request.current?.abort();generation.current++;verifying.current=false;}
  if(!verifying.current){mode.current='forced';verifying.current=true;lifecycle.pause(true);setRevision(v=>v+1);}
 },[lifecycle]);
 useEffect(() => {
  mounted.current=true;lifecycle.resetRejections();const off=lifecycle.subscribeExpired(recheck);
  return () => {mounted.current=false;invalidate();off();lifecycle.pause(false);};
 },[lifecycle,recheck,invalidate]);
 useEffect(() => {
  if(stopped){request.current?.abort();lifecycle.pause(true);if(terminal)navigation.markSignedOut();return;}
  const current=++generation.current,controller=new AbortController();verifying.current=true;request.current=controller;
  const background=mode.current==='resume',previous=state.session;
  if(!background)lifecycle.pause(true);
  const epoch=lifecycle.epoch();
  void adapter.session(controller.signal).then(session=>{
   if(!mounted.current||controller.signal.aborted||current!==generation.current||epoch!==lifecycle.epoch())return;
   // Business effects can issue 401 synchronously on the first commit.
   // Finish this check before publishing readiness, never in a later finally.
   verifying.current=false;
   if(background&&session!==null&&previous!==undefined&&adapter.sameSession?.(previous,session))return;
   lifecycle.pause(true);
   if(background&&session!==null)setBusinessGeneration(v=>v+1);
   adapter.sessionChanged?.(session??undefined);
   if(session===null){setState({kind:'anonymous'});return;}
   navigation.confirmSession();entered.current=true;lifecycle.pause(false);setState({kind:'ready',session});
  }).catch(error=>{
   if(!mounted.current||controller.signal.aborted||current!==generation.current||epoch!==lifecycle.epoch())return;
   verifying.current=false;
   if(error instanceof DOMException&&error.name==='AbortError')return;
   lifecycle.pause(true);
   const status=adapter.status(error);adapter.sessionChanged?.(undefined);
   setState({kind:status===401?'anonymous':status===403||status===421?'forbidden':'unavailable',status});
  });
  return ()=>{controller.abort();invalidate();};
 // State is a snapshot at request start, not a request trigger.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[adapter,lifecycle,navigation,revision,stopped,terminal,invalidate]);
 useEffect(()=>{
  if(!revalidateOnResume||stopped||state.kind!=='ready'||paused)return;
  const resume=()=>{
   if(navigation.wasSignedOut()||navigation.logoutPending()){
    request.current?.abort();generation.current++;verifying.current=false;lifecycle.pause(true);
    adapter.sessionChanged?.(undefined);
    setState({kind:navigation.logoutPending()?'logout-error':'signed-out',incomplete:true});return;
   }
   if(verifying.current||loggingOut.current||lifecycle.paused())return;
   verifying.current=true;mode.current='resume';setRevision(v=>v+1);
  };
  const visible=()=>{if(document.visibilityState==='visible')resume();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)resume();};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',restored);
  return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',restored);};
 },[revalidateOnResume,stopped,state.kind,paused,navigation,lifecycle,adapter]);
 const recovering=Boolean(recoveryPresentation)&&(state.kind==='checking'||state.kind==='anonymous'&&!protections||state.kind==='ready'&&paused);
 useEffect(()=>{
  if(state.kind!=='anonymous'||protections||leaving.current)return;
  leaving.current=true;
  if(!navigation.start(target)){leaving.current=false;setState({kind:'loop'});}
 },[state.kind,protections,navigation,target]);
 function depart(event:React.MouseEvent<HTMLAnchorElement>){
  event.preventDefault();
  if(lifecycle.reasons().length&&!window.confirm('重新认证将离开当前页面，未保存内容将丢失。请先保留内容；如有待核实的操作，请记录操作编号，登录后核实结果。确认离开？'))return;
  leaving.current=true;navigation.start(target,true);
 }
 async function logout(){
  if(loggingOut.current)return;
  if(lifecycle.reasons().length&&!window.confirm('退出将丢失未保存内容或待核实的操作信息。确认退出？'))return;
  loggingOut.current=true;navigation.markLogoutPending();request.current?.abort();generation.current++;lifecycle.pause(true);setState({kind:'logging-out',session:state.session});
  try{
   const session=state.session??await adapter.session(new AbortController().signal);
   if(!mounted.current)return;
   if(session===null){navigation.markSignedOut();adapter.sessionChanged?.(undefined);setState({kind:'signed-out',incomplete:true});return;}
   const result=await adapter.logout(session);
   if(!mounted.current)return;
   if(result.kind==='navigation')return;
   navigation.markSignedOut();adapter.sessionChanged?.(undefined);
   setState({kind:'signed-out',incomplete:!result.confirmed,handoff:result.handoff});
  }catch{if(mounted.current)setState(previous=>({...previous,kind:'logout-error'}));}
  finally{loggingOut.current=false;}
 }
 async function checkLogout(){
  if(verifying.current||loggingOut.current)return;
  verifying.current=true;
  try{
   const session=await adapter.session(new AbortController().signal);
   if(!mounted.current)return;
   if(session===null){navigation.markSignedOut();adapter.sessionChanged?.(undefined);setState({kind:'signed-out',incomplete:true});}
   else setState({kind:'logout-error',session});
  }catch{/* retain an explicitly unconfirmed result */}
  finally{verifying.current=false;}
 }
 const retry=()=>{if(!verifying.current){mode.current='forced';setRevision(v=>v+1);}};
 const page=(title:string,description?:string,actions?:ReactNode,busy=false)=><AuthStatusPage brand={brand} title={title} description={description} busy={busy}>{actions}</AuthStatusPage>;
 const login=(label:string)=><Button asChild><a href={navigation.href(target)} onClick={depart}>{label}</a></Button>;
 let status:ReactNode;
 if(state.kind==='checking'||state.kind==='logging-out')status=page(state.kind==='checking'?'正在确认登录状态…':'正在退出登录…',undefined,undefined,true);
 else if(state.kind==='anonymous')status=page(protections?'登录已过期':'正在前往登录…',protections?`当前有${protections}。请先保留未保存的内容；如有待核实的操作，请记录操作编号，重新登录后核实结果。`:'正在前往 PandaAuth 完成认证；如浏览器未响应，请使用下方链接。',login(protections?'确认离开并重新登录':'继续登录'),!protections);
 else if(state.kind==='loop')status=page('登录未完成','未能确认有效会话，或浏览器限制了自动跳转。请手动重试。',login('重新登录'));
 else if(state.kind==='signed-out')status=page(state.incomplete?'当前应用已退出':'已退出登录',state.incomplete?'当前应用已退出，身份服务的退出尚未确认。':'点击重新登录后可再次进入应用。',<>{state.handoff&&<Button asChild><a href={state.handoff}>完成身份服务退出</a></Button>}<Button asChild variant="outline"><a href={navigation.href(navigation.home)} onClick={event=>{event.preventDefault();navigation.start(navigation.home,true);}}>重新登录</a></Button></>);
 else if(state.kind==='logout-error')status=page('退出结果未获确认','请求未得到完整确认，请重试完成退出；不要将此状态视为身份服务已退出。',<><Button onClick={()=>{void logout();}}>重试退出</Button><Button variant="outline" onClick={()=>{void checkLogout();}}>重新检查退出状态</Button></>);
 else if(state.kind==='forbidden')status=page(state.status===421?'访问地址未登记':'此账号没有访问权限','请使用登记的访问地址并联系管理员确认权限。',<Button variant="outline" onClick={retry}>重新检查</Button>);
 else if(state.kind==='unavailable')status=page('暂时无法确认登录状态','服务暂时不可用，请稍后重试。',<Button onClick={retry}>重试</Button>);
 if(recovering)status=<AuthStatusPage brand={brand} title="正在恢复访问…" description={state.kind==='anonymous'?'正在前往认证…':'正在检查登录状态…'} busy reserveActions presentation={recoveryPresentation==='quiet'?'quiet':undefined}>{state.kind==='anonymous'&&login('继续登录')}</AuthStatusPage>;
 const active=state.kind==='ready'&&!paused,retain=entered.current&&(state.kind==='ready'||Boolean(protections))&&!stopped;
 return <AuthContext.Provider value={{session:active?state.session:undefined,lifecycle,logout,loggingOut:state.kind==='logging-out'}}>
  {!active?(status??page('正在确认登录状态…',undefined,undefined,true)):null}
  {retain&&<div key={businessGeneration} hidden={!active} inert={!active} className="min-h-svh">{children}</div>}
 </AuthContext.Provider>;
}
