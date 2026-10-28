import { expect,test,vi } from 'vitest';
import { createAuthLifecycle } from './lifecycle';
test('instances isolate protected contexts, paused request epochs, and cleaned listeners', () => {
 const one=createAuthLifecycle(),two=createAuthLifecycle(); const listener=vi.fn();const off=one.subscribeExpired(listener);
 const release=one.protect('未保存表单');one.unauthorized('/api/resource');expect(listener).toHaveBeenCalledOnce();
 expect(one.rejected('/api/resource')).toBe(true);expect(two.rejected('/api/resource')).toBe(false);
 const epoch=one.epoch();one.pause(true);expect(one.epoch()).toBe(epoch+1);one.pause(true);expect(one.epoch()).toBe(epoch+1);
 expect(one.reasons()).toEqual(['未保存表单']);expect(two.reasons()).toEqual([]);release();expect(one.reasons()).toEqual([]);
 off();one.unauthorized();expect(listener).toHaveBeenCalledOnce();
});
