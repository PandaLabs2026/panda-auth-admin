/** One instance per application. These signals pause UI work, never grant access. */
export function createAuthLifecycle() {
  const expired = new Set<() => void>(), listeners = new Set<() => void>();
  const rejected = new Set<string>(), protections = new Map<symbol, string>();
  let paused = false, epoch = 0;
  const changed = () => { for (const listener of listeners) listener(); };
  const subscribe = (set: Set<() => void>, listener: () => void) => { set.add(listener); return () => { set.delete(listener); }; };
  return {
    subscribeExpired: (listener: () => void) => subscribe(expired, listener),
    subscribe: (listener: () => void) => subscribe(listeners, listener),
    unauthorized(path = '') { rejected.add(path); for (const listener of expired) listener(); },
    rejected: (path: string) => rejected.has(path), clearRejection: (path: string) => { rejected.delete(path); },
    resetRejections: () => { rejected.clear(); },
    paused: () => paused, epoch: () => epoch,
    pause(value: boolean) { if (paused !== value) { paused = value; epoch++; changed(); } },
    protect(reason: string) { const key = Symbol(reason); protections.set(key, reason); changed(); return () => { protections.delete(key); changed(); }; },
    reasons: () => [...new Set(protections.values())],
  };
}
export type AuthLifecycle = ReturnType<typeof createAuthLifecycle>;
