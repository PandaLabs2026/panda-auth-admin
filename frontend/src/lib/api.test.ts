import { afterEach, describe, expect, it, vi } from "vitest"

import { apiGet, apiSend, ApiError } from "./api"

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

describe("serverError rendering", () => {
  it("renders the en translation for a known code and falls back to the raw message otherwise", async () => {
    const { ApiError, serverError } = await import("./api")

    // en 语言下:登记码 → server 词典翻译(语言源=localStorage,api 层不经 I18nProvider)
    localStorage.setItem("panda.admin.lang", "en")
    const coded = new ApiError("不能重置自己的密码", "user.self_password_reset_forbidden")
    expect(serverError(coded)).toBe(
      "An admin reset signs the target account out everywhere (including your current admin session). Use the self-service password flow to change your own password.",
    )

    // en 语言下:未知码 → 降级服务端原文
    const unknown = new ApiError("服务端原始中文细节", "user.brand_new_code")
    expect(serverError(unknown)).toBe("服务端原始中文细节")

    // zh 语言下:登记码也显示原文(zh 无 server 词典,动态信息零损失)
    localStorage.setItem("panda.admin.lang", "zh-CN")
    expect(serverError(coded)).toBe("不能重置自己的密码")

    // 非 Error 对象 → 默认文案
    expect(serverError(undefined)).toBe("加载失败")
  })

  it("carries extensions.code from a ProblemDetails response into ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "csrf-token" }))
      if (path === "/admin/api/users/u-1/status") {
        return Promise.resolve(json({
          status: 400, title: "不能重置自己的密码", detail: "管理端重置会强制下线目标账号的全部会话。",
          extensions: { code: "user.self_password_reset_forbidden" },
        }, { status: 400 }))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    let caught: unknown
    try {
      await apiSend("POST", "/admin/api/users/u-1/status", {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe("user.self_password_reset_forbidden")
    expect((caught as ApiError).message).toBe("管理端重置会强制下线目标账号的全部会话。")
  })
})
