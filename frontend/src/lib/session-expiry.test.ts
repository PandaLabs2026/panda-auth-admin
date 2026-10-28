import { afterEach, describe, expect, it, vi } from "vitest"
import { apiGet } from "./api"
import { subscribeSessionExpiry } from "./session-expiry"
afterEach(() => vi.unstubAllGlobals())
describe("business authentication failures", () => {
  it("notifies a session check without navigating or replaying the request", async () => {
    const assign = vi.fn(), listener = vi.fn()
    const unsubscribe = subscribeSessionExpiry(listener)
    const original = window
    vi.stubGlobal("window", { location: { assign }, setTimeout: original.setTimeout.bind(original), clearTimeout: original.clearTimeout.bind(original) })
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    vi.stubGlobal("fetch", fetch)
    try {
      await expect(apiGet("/admin/api/users")).rejects.toThrow("unauthorized")
      expect(listener).toHaveBeenCalledOnce()
      expect(assign).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledOnce()
      unsubscribe()
      await expect(apiGet("/admin/api/users")).rejects.toThrow("unauthorized")
      expect(listener).toHaveBeenCalledOnce()
    } finally { unsubscribe() }
  })
})
