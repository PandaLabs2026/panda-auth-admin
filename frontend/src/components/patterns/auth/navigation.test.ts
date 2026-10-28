import { beforeEach, expect, test, vi } from 'vitest';
import { createAuthNavigation } from './navigation';
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
test('preserves encoded pathname and search, allows one automatic challenge per roundtrip', () => {
 const replace=vi.fn(); const nav=createAuthNavigation({key:'test',loginPath:'/login',home:'/',replace});
 expect(nav.start('/notify?q=%E4%B8%AD&offset=2')).toBe(true);
 expect(replace).toHaveBeenCalledWith('/login?returnUrl=%2Fnotify%3Fq%3D%25E4%25B8%25AD%26offset%3D2');
 expect(nav.start('/notify')).toBe(false);
 nav.confirmSession(); expect(nav.start('/status')).toBe(true);
});
test('signed-out marker blocks automatic login, manual continuation explicitly resumes', () => {
 const replace=vi.fn(); const nav=createAuthNavigation({key:'test',loginPath:'/login',home:'/',replace});
 nav.markSignedOut(); expect(nav.wasSignedOut()).toBe(true); expect(nav.start('/')).toBe(false);
 expect(nav.start('/',true)).toBe(true); expect(nav.wasSignedOut()).toBe(false);
});
test('storage denial degrades automatic login to a working manual link', () => {
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw Error('denied');});
 const replace=vi.fn();const nav=createAuthNavigation({key:'test',loginPath:'/login',home:'/',replace});
 expect(nav.start('/')).toBe(false);expect(nav.start('/',true)).toBe(true);expect(replace).toHaveBeenCalledOnce();
});
test('pending top-level logout is distinct from confirmed local logout',()=>{
 const nav=createAuthNavigation({key:'test',loginPath:'/login',home:'/',replace:vi.fn()});
 nav.markLogoutPending();expect(nav.logoutPending()).toBe(true);expect(nav.wasSignedOut()).toBe(false);expect(nav.start('/')).toBe(false);
 nav.markSignedOut();expect(nav.logoutPending()).toBe(false);expect(nav.wasSignedOut()).toBe(true);
});
