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
it("does not mark a write uncertain when antiforgery acquisition fails before sending", async () => {
  const fetch = vi.fn(() => Promise.reject(new TypeError("connection lost")))
  vi.stubGlobal("fetch", fetch)
  await expect(apiSend("POST", "/admin/api/users", {})).rejects.toThrow()
  expect(adminAuthLifecycle.reasons()).not.toContain("结果待核实的管理操作")
  expect(fetch).toHaveBeenCalledOnce()
})
it("retains an uncertainty guard after a mutation loses its response without replay", async () => {
  const fetch = vi.fn((path: string) => path === "/admin/api/antiforgery"
    ? Promise.resolve(new Response('{"token":"fixture"}', { headers: { "content-type": "application/json" } }))
    : Promise.reject(new TypeError("connection lost")))
  vi.stubGlobal("fetch", fetch)
  await expect(apiSend("POST", "/admin/api/users", {})).rejects.toThrow()
  expect(adminAuthLifecycle.reasons()).toContain("结果待核实的管理操作")
  expect(fetch).toHaveBeenCalledTimes(2)
})
