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
