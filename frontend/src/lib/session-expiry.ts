/** A notification requests a BFF recheck; it never asserts an authentication result. */
const listeners = new Set<() => void>()
export function subscribeSessionExpiry(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function notifySessionExpiry() {
  for (const listener of [...listeners]) listener()
}
