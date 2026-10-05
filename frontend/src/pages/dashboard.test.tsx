import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import DashboardPage from "./dashboard"

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("DashboardPage", () => {
  it("loads the identity card through the shared apiGet session layer", async () => {
    const fetchMock = vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({
          subject: "sub-1",
          name: "Alice Admin",
          email: "alice@example.com",
          nickname: "管理员甲",
          roles: ["admin"],
        }))
      }
      if (path === "/.well-known/openid-configuration") return Promise.resolve(json({ issuer: "https://auth.example.com" }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<DashboardPage />)

    // 身份卡来自统一 apiGet（会话经 /admin/api/session，401 语义由 api 层统一处理）。
    expect(await screen.findByText("管理员甲")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/admin/api/session", expect.anything())
  })
})
