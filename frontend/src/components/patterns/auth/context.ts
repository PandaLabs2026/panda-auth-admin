import { createContext, useContext, useEffect } from 'react';
import type { AuthLifecycle } from './lifecycle';
export const AuthContext = createContext<{session?:unknown;lifecycle?:AuthLifecycle;logout:()=>Promise<void>;loggingOut:boolean}>({logout:async()=>{},loggingOut:false});
export const useAuthState = () => useContext(AuthContext);
export function useAuthLeaveGuard(active:boolean,reason='未保存的表单') {
 const {lifecycle}=useAuthState();
 useEffect(() => active ? lifecycle?.protect(reason) : undefined,[active,reason,lifecycle]);
}
