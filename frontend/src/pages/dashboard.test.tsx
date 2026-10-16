import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import DashboardPage from "./dashboard"
import { Providers } from "@/test/utils"

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("DashboardPage", () => {
  it("loads the identity card through the useSession query layer", async () => {
    const fetchMock = vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({
          subject: "sub-1",
          name: "Alice Admin",
          email: "alice@example.com",
          nickname: "管理员甲",
          roles: ["admin"],
          portalHomeUrl: null,
        }))
      }
      if (path === "/.well-known/openid-configuration") return Promise.resolve(json({ issuer: "https://auth.example.com" }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    // 会话不预填:由 fetch 桩应答 /admin/api/session,驱动真实 useSession 生命周期。
    render(<Providers session="fetch"><DashboardPage /></Providers>)

    // 身份卡来自统一会话查询(displayName 三级回退 name → nickname → subject)。
    expect(await screen.findByText("管理员甲")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/admin/api/session", expect.anything())
  })

  it("keeps a shadcn skeleton at the dashboard content anchor while loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))

    const { container } = render(<Providers session="fetch"><DashboardPage /></Providers>)

    expect(screen.getByRole("status")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it("renders the IDP status card from the discovery endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "sub-1", name: "甲", email: null, nickname: null, roles: [], portalHomeUrl: null }))
      }
      if (path === "/.well-known/openid-configuration") return Promise.resolve(json({ issuer: "https://auth.example.com" }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    render(<Providers session="fetch"><DashboardPage /></Providers>)

    // discovery 在线 → issuer 徽章;端点清单如实展示。
    expect(await screen.findByText(/auth\.example\.com/)).toBeInTheDocument()
    expect(screen.getByText("IDP 状态")).toBeInTheDocument()
  })
})
