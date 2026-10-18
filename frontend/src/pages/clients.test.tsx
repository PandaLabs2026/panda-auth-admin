import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import ClientsPage from "./clients"
import { Providers } from "@/test/utils"
import type { ClientDetail, ClientSummary } from "@/lib/api"

const summary = (clientId: string, displayName: string): ClientSummary => ({
  clientId,
  displayName,
  clientType: "confidential",
  consentType: "implicit",
  isFirstParty: clientId === "admin-web" || clientId === "me-web",
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

    render(<Providers><ClientsPage /></Providers>)
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

    render(<Providers><ClientsPage /></Providers>)

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

    render(<Providers><ClientsPage /></Providers>)
    await user.click(await screen.findByText("me-web"))

    expect(await screen.findByText("network down")).toBeInTheDocument()
  })
})

describe("ClientsPage first-party clients", () => {
  it("marks platform clients read-only and disables every write action", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients") return Promise.resolve(json(list))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      if (path === "/admin/api/clients/admin-web") return Promise.resolve(json(detail("admin-web", "管理台")))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    render(<Providers initialEntries={["/?client=admin-web"]}><ClientsPage /></Providers>)

    expect(await screen.findByText("第一方/平台客户端由部署流程维护，管理台只读。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存白名单" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "保存权限" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "轮换密钥" })).toBeDisabled()
  })
})

describe("ClientsPage long callback URIs", () => {
  it("bounds long redirect URI editors and the client list table", async () => {
    const longUri = `https://client.example.com/${"callback-segment/".repeat(24)}return`
    const longDetail = { ...detail("admin-web", "管理台"), redirectUris: [longUri] }
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients") return Promise.resolve(json(list))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      if (path === "/admin/api/clients/admin-web") return Promise.resolve(json(longDetail))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    const { container } = render(
      <Providers initialEntries={["/?client=admin-web"]}><ClientsPage /></Providers>,
    )

    const redirectField = await screen.findByLabelText("RedirectUris（至少一条）")
    expect(redirectField).toHaveValue(longUri)
    expect(redirectField.parentElement).toHaveClass("overflow-x-auto")
    expect(container.querySelector('[data-slot="table-container"]')).toHaveClass("overflow-x-auto")
  })
})
