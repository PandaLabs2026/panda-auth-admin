import { afterEach, describe, expect, it, vi } from "vitest"

import { apiGet, apiSend } from "./api"

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

/** apiSend 的两跳 fetch 桩：防伪令牌端点 + 目标端点。 */
function stubSend(targetResponse: Response) {
  vi.stubGlobal("fetch", vi.fn((path: string) => {
    if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "csrf-token" }))
    if (path === "/admin/api/users/u-1/status") return Promise.resolve(targetResponse)
    return Promise.reject(new Error(`unexpected request: ${path}`))
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("apiGet", () => {
  it("treats a read-only 403 as a permission error instead of starting Passkey step-up", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(null, { status: 403 })),
    ))

    await expect(apiGet("/admin/api/users?page=1")).rejects.toThrow("HTTP 403")
  })
})

describe("apiSend 403 semantics", () => {
  it("starts MFA step-up only when the BFF marks the 403 with X-Panda-Mfa-Required", async () => {
    stubSend(new Response(null, { status: 403, headers: { "X-Panda-Mfa-Required": "true" } }))

    // mfaRequired() 跳转后以 mfa_required 异常中断调用链（jsdom 的 location.assign 为空实现）。
    await expect(apiSend("POST", "/admin/api/users/u-1/status", { status: 1 })).rejects.toThrow("mfa_required")
  })

  it("treats an unmarked 403 as a plain permission error", async () => {
    stubSend(new Response(null, { status: 403 }))

    await expect(apiSend("POST", "/admin/api/users/u-1/status", { status: 1 })).rejects.toThrow("HTTP 403")
  })

  it("shows the upstream ProblemDetails detail for an unmarked 403 when present", async () => {
    stubSend(json({ title: "无权限", detail: "该操作需要更高权限。" }, { status: 403 }))

    await expect(apiSend("POST", "/admin/api/users/u-1/status", { status: 1 })).rejects.toThrow("该操作需要更高权限。")
  })
})
