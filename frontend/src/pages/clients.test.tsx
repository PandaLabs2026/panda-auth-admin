import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ClientsPage from "./clients"
import { MemoryRouter } from "react-router-dom"
import type { ClientDetail, ClientSummary } from "@/lib/api"

const summary = (clientId: string, displayName: string): ClientSummary => ({
  clientId,
  displayName,
  clientType: "confidential",
  consentType: "implicit",
})

const detail = (clientId: string, displayName: string): ClientDetail => ({
  ...summary(clientId, displayName),
  redirectUris: [`https://example.com/${clientId}/callback`],
  postLogoutRedirectUris: [],
  permissions: ["scp:profile"],
  requirements: [],
})

const list = { items: [summary("admin-web", "管理台"), summary("me-web", "个人中心")], total: 2, page: 1, pageSize: 20 }

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ClientsPage select ordering", () => {
  it("does not restore a stale detail when a superseding select finishes first", async () => {
    let resolveFirstDetail: ((response: Response) => void) | undefined
    const firstDetail = new Promise<Response>((resolve) => { resolveFirstDetail = resolve })

    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients") return Promise.resolve(json(list))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      // admin-web 的详情慢（先点、后被 me-web 抢占）。
      if (path === "/admin/api/clients/admin-web") return firstDetail
      if (path === "/admin/api/clients/me-web") return Promise.resolve(json(detail("me-web", "个人中心")))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<MemoryRouter><ClientsPage /></MemoryRouter>)
    await user.click(await screen.findByText("admin-web"))
    await user.click(await screen.getByText("me-web"))

    expect(await screen.findByText("回调 / 登出白名单 · me-web")).toBeInTheDocument()

    // me-web 之后 admin-web 的慢响应才回来：乱序守卫必须丢弃，不得覆盖回 admin-web。
    resolveFirstDetail?.(json(detail("admin-web", "管理台")))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText("回调 / 登出白名单 · admin-web")).not.toBeInTheDocument()
    expect(screen.getByText("回调 / 登出白名单 · me-web")).toBeInTheDocument()
  })
})

describe("ClientsPage list errors", () => {
  it("shows a visible error banner instead of silently swallowing a failed list load", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients") return Promise.resolve(new Response(null, { status: 500 }))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    render(<MemoryRouter><ClientsPage /></MemoryRouter>)

    // 之前 catch(() => setList(null)) 把失败吞成空列表,标题恒显「…」且无任何提示(#21)。
    expect(await screen.findByText("请求失败(HTTP 500)")).toBeInTheDocument()
  })

  it("surfaces options load failures inside the permissions card once a client is selected", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients") return Promise.resolve(json(list))
      if (path === "/admin/api/clients/options") return Promise.reject(new Error("network down"))
      if (path === "/admin/api/clients/me-web") return Promise.resolve(json(detail("me-web", "个人中心")))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<MemoryRouter><ClientsPage /></MemoryRouter>)
    await user.click(await screen.findByText("me-web"))

    expect(await screen.findByText("network down")).toBeInTheDocument()
  })
})
