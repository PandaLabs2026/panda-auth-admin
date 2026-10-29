import { StrictMode,useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import AuthBoundary from './AuthBoundary';
import { createAuthLifecycle } from './lifecycle';
import { createAuthNavigation } from './navigation';
import { useAuthState } from './context';
beforeEach(() => {sessionStorage.clear();});afterEach(cleanup);
function fixture(session=vi.fn<(_signal: AbortSignal) => Promise<{subject:string}|null>>().mockResolvedValue(null)) {
 const lifecycle=createAuthLifecycle(),replace=vi.fn(),navigation=createAuthNavigation({key:'test',loginPath:'/login',home:'/',replace});
 const logout=vi.fn().mockResolvedValue({kind:'local',confirmed:false});
 const adapter={session,logout,status:(error:unknown) => (error as {status?:number})?.status ?? 0};
 const element=(terminal=false) => <AuthBoundary adapter={adapter} lifecycle={lifecycle} navigation={navigation} brand={<span>Product</span>} target="/notify?q=%E4%B8%AD" terminal={terminal}><button>business</button></AuthBoundary>;
 return {lifecycle,replace,navigation,session,adapter,element,logout};
}
test('anonymous never mounts business; StrictMode produces one challenge with manual fallback',async () => {
 const f=fixture();render(<StrictMode>{f.element()}</StrictMode>);
 expect(screen.queryByText('business')).toBeNull();await waitFor(() => expect(f.replace).toHaveBeenCalledOnce());
 expect(screen.getByRole('link',{name:'继续登录'}).getAttribute('href')).toContain('returnUrl=');
});
test('unavailable and forbidden are distinct terminal states with no automatic challenge',async () => {
 for (const [status,title] of [[503,'暂时无法确认登录状态'],[403,'此账号没有访问权限']] as const) {
  const f=fixture(vi.fn().mockRejectedValue({status}));render(f.element());await screen.findByText(title);expect(f.replace).not.toHaveBeenCalled();cleanup();
 }
});
test('pending attempt stops a second anonymous roundtrip',async () => {
 const f=fixture();f.navigation.start('/');f.replace.mockClear();render(f.element());await screen.findByText('登录未完成');expect(f.replace).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('link',{name:'重新登录'}));expect(f.replace).toHaveBeenCalledOnce();
});
test('concurrent business401 coalesce a session recheck and valid session does not navigate',async () => {
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));render(f.element());await screen.findByText('business');
 act(() => {f.lifecycle.unauthorized('/a');f.lifecycle.unauthorized('/b');});await waitFor(() => expect(f.session).toHaveBeenCalledTimes(2));await screen.findByText('business');expect(f.replace).not.toHaveBeenCalled();
});
test('draft expiry retains hidden inert content and requires explicit departure',async () => {
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockResolvedValue(null));render(f.element());await screen.findByText('business');
 act(() => {f.lifecycle.protect('未保存表单');f.lifecycle.unauthorized('/write');});await screen.findByText('登录已过期');
 expect(screen.getByText('business').closest('[hidden]')).not.toBeNull();expect(screen.getByText('business').closest('[inert]')).not.toBeNull();expect(f.replace).not.toHaveBeenCalled();
 vi.spyOn(window,'confirm').mockReturnValue(true);fireEvent.click(screen.getByRole('link',{name:'确认离开并重新登录'}));expect(f.replace).toHaveBeenCalledOnce();vi.restoreAllMocks();
});
test('signed-out terminal does not probe or automatically log back in',async () => {
 const f=fixture();render(f.element(true));await screen.findByText('已退出登录');expect(f.session).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('link',{name:'重新登录'}));expect(f.replace).toHaveBeenCalledOnce();
});
test('partial logout remains accurate without an automatic challenge',async () => {
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));
 function Child(){return <button onClick={() => {void control.logout();}}>退出</button>;}
 let control:ReturnType<typeof useAuthState>;
 function Controls(){control=useAuthState();return <Child/>;}
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand={<span>Product</span>} target="/"><Controls/></AuthBoundary>);
 fireEvent.click(await screen.findByText('退出'));await screen.findByText('当前应用已退出');expect(f.replace).not.toHaveBeenCalled();expect(f.lifecycle.paused()).toBe(true);
});
test('logout failure can be retried with the same authenticated session',async () => {
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));f.logout.mockRejectedValueOnce(Error('offline')).mockResolvedValue({kind:'local',confirmed:false});
 function Control(){const auth=useAuthState();return <button onClick={()=>{void auth.logout();}}>退出</button>;}
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand={<span>Product</span>} target="/"><Control/></AuthBoundary>);
 fireEvent.click(await screen.findByText('退出'));await screen.findByText('退出结果未获确认');fireEvent.click(screen.getByRole('button',{name:'重试退出'}));
 await screen.findByText('当前应用已退出');expect(f.logout).toHaveBeenCalledTimes(2);
});
test('missing real adapter fails closed without mock fallback',()=>{
 const f=fixture();render(<AuthBoundary lifecycle={f.lifecycle} navigation={f.navigation} brand={<span>Product</span>} target="/"><button>business</button></AuthBoundary>);
 expect(screen.getByText('登录配置未完成')).toBeInTheDocument();expect(screen.queryByText('business')).toBeNull();expect(f.replace).not.toHaveBeenCalled();
});
test('an old session response after logout cannot restore business content',async()=>{
 let resolve:((value:{subject:string})=>void)|undefined;
 const pending=new Promise<{subject:string}>(r=>{resolve=r;});
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockReturnValueOnce(pending));
 let logout:(()=>Promise<void>)|undefined;
 function Control(){const auth=useAuthState();logout=auth.logout;return <button>business</button>;}
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand={<span>Product</span>} target="/"><Control/></AuthBoundary>);
 await screen.findByText('business');act(()=>f.lifecycle.unauthorized());await waitFor(()=>expect(f.session).toHaveBeenCalledTimes(2));
 await act(async()=>{await logout?.();});await screen.findByText('当前应用已退出');
 await act(async()=>{resolve?.({subject:'old'});await pending;});expect(screen.queryByText('business')).toBeNull();expect(f.replace).not.toHaveBeenCalled();
});
test('back navigation during unconfirmed form logout never claims completion or auto logs in',async()=>{
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));f.navigation.markLogoutPending();render(f.element());
 await screen.findByText('退出结果未获确认');expect(screen.queryByText('已退出登录')).toBeNull();expect(f.session).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'重新检查退出状态'}));await waitFor(()=>expect(f.session).toHaveBeenCalledOnce());expect(screen.queryByText('business')).toBeNull();
});
test('late logout-session inspection after unmount cannot mark a new document signed out',async()=>{
 let resolve:((value:{subject:string}|null)=>void)|undefined;const pending=new Promise<{subject:string}|null>(r=>{resolve=r;});
 const f=fixture(vi.fn().mockReturnValue(pending));f.navigation.markLogoutPending();const view=render(f.element());
 fireEvent.click(screen.getByRole('button',{name:'重试退出'}));view.unmount();await act(async()=>{resolve?.(null);await pending;});
 expect(f.navigation.wasSignedOut()).toBe(false);expect(f.navigation.logoutPending()).toBe(true);
});

test('a resource401 on the first business commit is not lost behind the initial session check',async()=>{
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));
 function Immediate(){useLayoutEffect(()=>f.lifecycle.unauthorized('/first-resource'),[]);return <button>business</button>;}
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand={<span>Product</span>} target="/"><Immediate/></AuthBoundary>);
 await waitFor(()=>expect(f.session).toHaveBeenCalledTimes(2));expect(f.replace).not.toHaveBeenCalled();
});

test('resume expiry checks session once and coalesces focus events',async()=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockResolvedValue(null));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 await screen.findByText('business');
 act(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});
 await waitFor(()=>expect(f.replace).toHaveBeenCalledOnce());expect(f.session).toHaveBeenCalledTimes(2);
});

test.each([503,403,421])('resume %s is terminal without implicit second check',async(status)=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockRejectedValue({status}));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 await screen.findByText('business');act(()=>window.dispatchEvent(new Event('focus')));
 await screen.findByRole('heading',{name:status===503?'暂时无法确认登录状态':status===421?'访问地址未登记':'此账号没有访问权限'});
 expect(f.session).toHaveBeenCalledTimes(2);expect(f.replace).not.toHaveBeenCalled();
 act(()=>window.dispatchEvent(new Event('focus')));expect(f.session).toHaveBeenCalledTimes(2);
});

test('unchanged resume preserves the business tree and does not publish another session',async()=>{
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));const changed=vi.fn();
 const adapter={...f.adapter,sameSession:(a:{subject:string},b:{subject:string})=>a.subject===b.subject,sessionChanged:changed};
 render(<AuthBoundary adapter={adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 const business=await screen.findByText('business');act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(f.session).toHaveBeenCalledTimes(2));expect(changed).toHaveBeenCalledOnce();expect(screen.getByText('business')).toBe(business);
});

test('business401 supersedes an earlier resume and ignores its late success',async()=>{
 let resolve!:(value:{subject:string})=>void;let signal!:AbortSignal;
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockImplementationOnce((s:AbortSignal)=>{signal=s;return new Promise(r=>{resolve=r;});}).mockResolvedValue(null));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 await screen.findByText('business');act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(f.session).toHaveBeenCalledTimes(2));act(()=>f.lifecycle.unauthorized('/resource'));
 await waitFor(()=>expect(f.replace).toHaveBeenCalledOnce());expect(signal.aborted).toBe(true);
 await act(async()=>resolve({subject:'old'}));expect(screen.queryByText('business')).toBeNull();expect(f.session).toHaveBeenCalledTimes(3);
});

test('changed resume remounts business and cancels the old lifecycle epoch',async()=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockResolvedValue({subject:'u2'}));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 const before=await screen.findByText('business'),epoch=f.lifecycle.epoch();act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(screen.getByText('business')).not.toBe(before));expect(f.lifecycle.epoch()).toBeGreaterThan(epoch);expect(f.replace).not.toHaveBeenCalled();
});

test('restoration is visible immediately and updates stages without replacing the panel or focus',async()=>{
  let resolve!:(value:null)=>void;const f=fixture(vi.fn().mockImplementation(()=>new Promise<null>(r=>{resolve=r;})));
  const view=render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" recoveryPresentation="restore"><button>business</button></AuthBoundary>);
  const heading=screen.getByRole('heading',{name:'正在恢复访问…'}),panel=heading.closest('section');expect(heading).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('正在检查登录状态…');
  const focus=vi.spyOn(heading,'focus');
  await act(async()=>resolve(null));expect(f.replace).toHaveBeenCalledOnce();expect(screen.getByRole('heading')).toBe(heading);expect(screen.getByRole('link',{name:'继续登录'})).toBeInTheDocument();
  expect(heading.closest('section')).toBe(panel);expect(screen.getByRole('status')).toHaveTextContent('正在前往认证…');expect(focus).not.toHaveBeenCalled();
  view.unmount();
});

test('resume network failure stops until explicit retry and remains non-challenging',async()=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({subject:'u1'}));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 await screen.findByText('business');act(()=>window.dispatchEvent(new Event('focus')));await screen.findByText('暂时无法确认登录状态');
 expect(f.session).toHaveBeenCalledTimes(2);expect(f.replace).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('business');expect(f.session).toHaveBeenCalledTimes(3);
});

test('restored document observes logout marker without probing or reentering',async()=>{
 const f=fixture(vi.fn().mockResolvedValue({subject:'u1'}));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume><button>business</button></AuthBoundary>);
 await screen.findByText('business');f.navigation.markSignedOut();act(()=>window.dispatchEvent(new Event('focus')));
 await screen.findByText('当前应用已退出');expect(screen.queryByText('business')).toBeNull();expect(f.session).toHaveBeenCalledOnce();expect(f.replace).not.toHaveBeenCalled();
});

test('quiet recovery never renders a card while checking or leaving, and hides expired business',async()=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockResolvedValue(null));
 const view=render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" revalidateOnResume recoveryPresentation="quiet"><button>business</button></AuthBoundary>);
 expect(view.container.querySelector('section')).toBeNull();
 await screen.findByText('business');act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(f.replace).toHaveBeenCalledOnce());
 expect(screen.queryByText('business')).toBeNull();expect(view.container.querySelector('section')).toBeNull();
 expect(screen.getByRole('status')).toHaveTextContent('正在前往认证…');
});

test.each([503,403,421])('quiet recovery preserves immediate terminal status %s',async(status)=>{
 const f=fixture(vi.fn().mockRejectedValue({status}));
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" recoveryPresentation="quiet"><button>business</button></AuthBoundary>);
 const title=status===503?'暂时无法确认登录状态':status===421?'访问地址未登记':'此账号没有访问权限';
 expect(await screen.findByRole('heading',{name:title})).toBeVisible();
 expect(screen.getByRole('button')).toBeVisible();expect(f.replace).not.toHaveBeenCalled();
});

test('quiet recovery keeps dirty-state protection and navigation loop failures visible',async()=>{
 const f=fixture();const release=f.lifecycle.protect('未保存内容');
 const view=render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" recoveryPresentation="quiet"><button>business</button></AuthBoundary>);
 expect(await screen.findByRole('heading',{name:'登录已过期'})).toBeVisible();
 expect(f.replace).not.toHaveBeenCalled();view.unmount();release();
 f.navigation.start('/');f.replace.mockClear();
 render(<AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" recoveryPresentation="quiet"><button>business</button></AuthBoundary>);
 expect(await screen.findByRole('heading',{name:'登录未完成'})).toBeVisible();
 expect(screen.getByRole('link',{name:'重新登录'})).toBeVisible();expect(f.replace).not.toHaveBeenCalled();
});

const english:Record<string,string>={
 '正在确认登录状态…':'Checking sign-in…','暂时无法确认登录状态':'Unable to confirm sign-in',
 '服务暂时不可用，请稍后重试。':'The service is unavailable. Please try again later.','重试':'Retry',
 '登录已过期':'Sign-in expired','未保存表单':'unsaved form','当前有':'You have ',
 '。请先保留未保存的内容；如有待核实的操作，请记录操作编号，重新登录后核实结果。':'. Save your work and record pending operation IDs before signing in again.',
 '确认离开并重新登录':'Leave and sign in again',
 '重新认证将离开当前页面，未保存内容将丢失。请先保留内容；如有待核实的操作，请记录操作编号，登录后核实结果。确认离开？':'Leave this page and sign in again? Save your work and record pending operation IDs first.',
 '登录配置未完成':'Sign-in is not configured',
};
const translateEnglish=(message:string)=>english[message]??message;
function localized(f:ReturnType<typeof fixture>,translate:(message:string)=>string){
 return <AuthBoundary adapter={f.adapter} lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/notify?q=%E4%B8%AD" translate={translate}><button>business</button></AuthBoundary>;
}
test('consumer translation covers loading, service failure and explicit retry without challenge',async()=>{
 const f=fixture(vi.fn().mockRejectedValue({status:503}));render(localized(f,translateEnglish));
 expect(screen.getByRole('heading',{name:'Checking sign-in…'})).toBeVisible();
 await screen.findByRole('heading',{name:'Unable to confirm sign-in'});
 expect(screen.getByText('The service is unavailable. Please try again later.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await waitFor(()=>expect(f.session).toHaveBeenCalledTimes(2));
 expect(f.replace).not.toHaveBeenCalled();expect(f.logout).not.toHaveBeenCalled();
});
test('changing presentation language preserves an in-flight session request',async()=>{
 let resolve!:(value:null)=>void;const f=fixture(vi.fn().mockImplementation(()=>new Promise<null>(r=>{resolve=r;})));
 const view=render(localized(f,translateEnglish));expect(screen.getByRole('heading',{name:'Checking sign-in…'})).toBeVisible();
 view.rerender(localized(f,message=>message));expect(screen.getByRole('heading',{name:'正在确认登录状态…'})).toBeVisible();
 expect(f.session).toHaveBeenCalledOnce();expect(f.session.mock.calls[0][0].aborted).toBe(false);
 await act(async()=>resolve(null));expect(f.replace).toHaveBeenCalledOnce();expect(f.logout).not.toHaveBeenCalled();
});
test('translated protected expiry keeps draft hidden and requires translated departure confirmation',async()=>{
 const f=fixture(vi.fn().mockResolvedValueOnce({subject:'u1'}).mockResolvedValue(null));render(localized(f,translateEnglish));
 await screen.findByText('business');act(()=>{f.lifecycle.protect('未保存表单');f.lifecycle.unauthorized('/write');});
 await screen.findByRole('heading',{name:'Sign-in expired'});
 expect(screen.getByText('You have unsaved form. Save your work and record pending operation IDs before signing in again.')).toBeVisible();
 expect(screen.getByText('business').closest('[hidden][inert]')).not.toBeNull();expect(f.replace).not.toHaveBeenCalled();
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 try{
  const link=screen.getByRole('link',{name:'Leave and sign in again'});expect(link.getAttribute('href')).toContain('returnUrl=');
  fireEvent.click(link);expect(confirm).toHaveBeenCalledWith('Leave this page and sign in again? Save your work and record pending operation IDs first.');expect(f.replace).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);fireEvent.click(link);expect(f.replace).toHaveBeenCalledOnce();expect(f.logout).not.toHaveBeenCalled();
 }finally{confirm.mockRestore();}
});
test('empty translations retain original copy and never remove dirty-state protection',async()=>{
 const f=fixture();f.lifecycle.protect('未保存表单');render(localized(f,()=>''));
 await screen.findByRole('heading',{name:'登录已过期'});expect(screen.getByText(/当前有未保存表单/)).toBeVisible();
 expect(screen.getByRole('link',{name:'确认离开并重新登录'})).toBeVisible();expect(f.replace).not.toHaveBeenCalled();expect(f.session).toHaveBeenCalledOnce();
});
test('missing adapter configuration can be translated without mounting business',()=>{
 const f=fixture();render(<AuthBoundary lifecycle={f.lifecycle} navigation={f.navigation} brand="Product" target="/" translate={translateEnglish}><button>business</button></AuthBoundary>);
 expect(screen.getByRole('heading',{name:'Sign-in is not configured'})).toBeVisible();expect(screen.queryByText('business')).toBeNull();expect(f.replace).not.toHaveBeenCalled();
});
