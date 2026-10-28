import { afterEach, describe, expect, it, vi } from "vitest"
import { sessionApi } from "./auth"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sessionApi", () => {
  it("treats only an unauthenticated response as an absent session", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))))
    await expect(sessionApi.me()).resolves.toBeNull()
  })

  it("surfaces session endpoint failures instead of redirecting as if the user were signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ status: 503, title: "Unavailable", detail: "会话检查暂不可用。" }),
      { status: 503, headers: { "content-type": "application/problem+json" } },
    ))))
    await expect(sessionApi.me()).rejects.toThrow("会话检查暂不可用。")
  })

  it("keeps the page when the antiforgery request fails", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: "退出暂不可用" }), { status: 503, headers: { "content-type": "application/problem+json" } }))))
    await expect(sessionApi.logout()).rejects.toThrow("退出暂不可用")
    expect(submit).not.toHaveBeenCalled()
  })

  it("submits logout as a native antiforgery form without following redirects in fetch", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {})
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ token: "fixture-csrf" }), { headers: { "content-type": "application/json" } })))
    vi.stubGlobal("fetch", fetch)
    await sessionApi.logout()
    expect(fetch).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledOnce()
    const submitted = submit.mock.contexts[0] as HTMLFormElement
    expect(submitted?.getAttribute("action")).toBe("/admin/api/logout")
    expect(submitted?.method).toBe("post")
    expect(submitted?.querySelector<HTMLInputElement>('input[name="__RequestVerificationToken"]')?.value).toBe("fixture-csrf")
  })

})


describe("session response validation", () => {
  it.each([
    ["text/html", "<html>upstream error</html>"],
    ["application/json", JSON.stringify({ subject: "", roles: [] })],
    ["application/json", JSON.stringify({ subject: "user", roles: "admin" })],
  ])("rejects malformed successful responses (%s)", async (contentType, body) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body, { headers: { "content-type": contentType } }))))
    await expect(sessionApi.me()).rejects.toThrow()
  })
})
