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

  it("reports failed logout responses and does not navigate to the login page", async () => {
    const assign = vi.fn()
    const originalWindow = window
    vi.stubGlobal("window", {
      location: { assign },
      setTimeout: originalWindow.setTimeout.bind(originalWindow),
      clearTimeout: originalWindow.clearTimeout.bind(originalWindow),
    })
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "csrf" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 503, title: "Unavailable", detail: "会话撤销服务不可用",
      }), {
        status: 503,
        headers: { "content-type": "application/problem+json" },
      })))
    await expect(sessionApi.logout()).rejects.toThrow("会话撤销服务不可用")
    expect(assign).not.toHaveBeenCalled()
  })
})
