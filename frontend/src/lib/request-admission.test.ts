import { afterEach, expect, it, vi } from "vitest"
import { apiGet, apiSend } from "./api"
import { adminAuthLifecycle } from "./auth-lifecycle"
afterEach(() => { adminAuthLifecycle.pause(false); vi.unstubAllGlobals() })
it("does not issue new reads or mutations while authentication is paused", async () => {
  const fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetch)
  adminAuthLifecycle.pause(true)
  await expect(apiGet("/admin/api/users")).rejects.toThrow()
  await expect(apiSend("POST", "/admin/api/users", {})).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it("rejects a response from the previous authentication epoch", async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r })))
  const pending = apiGet("/admin/api/users")
  adminAuthLifecycle.pause(true)
  adminAuthLifecycle.pause(false)
  resolve(new Response("{}", { headers: { "content-type": "application/json" } }))
  await expect(pending).rejects.toThrow()
})
