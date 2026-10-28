import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
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

function HistoryProbe({ capture }: { capture?: (client: QueryClient) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  useEffect(() => { capture?.(client) }, [capture, client])
  return <><output data-testid="location">{location.search}</output><button onClick={() => navigate(-1)}>history-back</button></>
}

const manyClients = Array.from({ length: 41 }, (_, index) => summary(`client-${index + 1}`, `Client ${index + 1}`))
function pageResponse(path: string) {
  const params = new URL(path, "https://fixture.test").searchParams
  const page = Number(params.get("page") ?? 1)
  const pageSize = Number(params.get("pageSize") ?? 20)
  return { items: manyClients.slice((page - 1) * pageSize, page * pageSize), total: 41, page, pageSize }
}
function pagedFetch() {
  return vi.fn((path: string) => {
    if (path === "/admin/api/clients" || path.startsWith("/admin/api/clients?")) return Promise.resolve(json(pageResponse(path)))
    if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
    if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "fixture-csrf" }))
    const match = path.match(/^\/admin\/api\/clients\/(client-\d+)(?:\/redirect-uris)?$/)
    if (match) return Promise.resolve(json(detail(match[1], match[1])))
    return Promise.reject(new Error(`unexpected request: ${path}`))
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ClientsPage pagination", () => {
  it("reaches clients beyond forty and restores the previous URL page", async () => {
    const fetch = pagedFetch(); vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    render(<Providers><ClientsPage /><HistoryProbe /></Providers>)
    await screen.findByText("client-1")
    await user.click(screen.getByRole("button", { name: "下一页" }))
    await screen.findByText("client-21")
    await user.click(screen.getByRole("button", { name: "下一页" }))
    await screen.findByText("client-41")
    expect(screen.getByText("第 3 / 3 页")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "history-back" }))
    await screen.findByText("client-21")
    expect(new URLSearchParams(screen.getByTestId("location").textContent!).get("page")).toBe("2")
    expect(fetch.mock.calls.some(([path]) => path === "/admin/api/clients?page=3&pageSize=20")).toBe(true)
  })

  it("loads an off-page deep-linked detail and keeps it selected across pages", async () => {
    vi.stubGlobal("fetch", pagedFetch())
    const user = userEvent.setup()
    render(<Providers initialEntries={["/?client=client-41"]}><ClientsPage /><HistoryProbe /></Providers>)
    await screen.findByText("回调 / 登出白名单 · client-41")
    await screen.findByText("client-1")
    await user.click(screen.getByRole("button", { name: "下一页" }))
    await screen.findByText("client-21")
    expect(screen.getByText("回调 / 登出白名单 · client-41")).toBeInTheDocument()
    expect(new URLSearchParams(screen.getByTestId("location").textContent!).get("client")).toBe("client-41")
  })

  it("corrects an out-of-range page without dropping selection and respects URL page size", async () => {
    const fetch = pagedFetch(); vi.stubGlobal("fetch", fetch)
    render(<Providers initialEntries={["/?page=999&pageSize=10&client=client-41"]}><ClientsPage /><HistoryProbe /></Providers>)
    await screen.findByText("第 5 / 5 页")
    expect(screen.getByText("回调 / 登出白名单 · client-41")).toBeInTheDocument()
    const params = new URLSearchParams(screen.getByTestId("location").textContent!)
    expect(params.get("page")).toBe("5")
    expect(params.get("pageSize")).toBe("10")
    expect(fetch.mock.calls.some(([path]) => path === "/admin/api/clients?page=5&pageSize=10")).toBe(true)
  })

  it("does not overwrite a returned page with a late list response", async () => {
    let finish: ((response: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    const normal = pagedFetch()
    vi.stubGlobal("fetch", vi.fn((path: string) => path === "/admin/api/clients?page=2&pageSize=20" ? pending : normal(path)))
    const user = userEvent.setup()
    render(<Providers><ClientsPage /><HistoryProbe /></Providers>)
    await screen.findByText("client-1")
    await user.click(screen.getByRole("button", { name: "下一页" }))
    await user.click(screen.getByRole("button", { name: "上一页" }))
    await screen.findByText("client-1")
    await act(async () => { finish?.(json(pageResponse("/admin/api/clients?page=2&pageSize=20"))) })
    expect(screen.queryByText("client-21")).not.toBeInTheDocument()
    expect(screen.getByText("第 1 / 3 页")).toBeInTheDocument()
  })

  it("invalidates all cached list pages after a mutation", async () => {
    vi.stubGlobal("fetch", pagedFetch())
    let client: QueryClient | undefined
    const user = userEvent.setup()
    render(<Providers><ClientsPage /><HistoryProbe capture={(value) => { client = value }} /></Providers>)
    await screen.findByText("client-1")
    await user.click(screen.getByRole("button", { name: "下一页" }))
    await user.click(await screen.findByText("client-21"))
    await user.click(await screen.findByRole("button", { name: "保存白名单" }))
    await waitFor(() => expect(client?.getQueryState(["clients", 1, 20])?.isInvalidated).toBe(true))
  })
})

describe("ClientsPage select ordering", () => {
  it("does not restore a stale detail when a superseding select finishes first", async () => {
    let resolveFirstDetail: ((response: Response) => void) | undefined
    const firstDetail = new Promise<Response>((resolve) => { resolveFirstDetail = resolve })

    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients?page=1&pageSize=20") return Promise.resolve(json(list))
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
      if (path === "/admin/api/clients?page=1&pageSize=20") return Promise.resolve(new Response(null, { status: 500 }))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    render(<Providers><ClientsPage /></Providers>)

    // 之前 catch(() => setList(null)) 把失败吞成空列表,标题恒显「…」且无任何提示(#21)。
    expect(await screen.findByText("请求失败(HTTP 500)")).toBeInTheDocument()
  })

  it("surfaces options load failures inside the permissions card once a client is selected", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/clients?page=1&pageSize=20") return Promise.resolve(json(list))
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
      if (path === "/admin/api/clients?page=1&pageSize=20") return Promise.resolve(json(list))
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
      if (path === "/admin/api/clients?page=1&pageSize=20") return Promise.resolve(json(list))
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

it("preserves an unfinished client form when detail is refreshed", async () => {
  vi.stubGlobal("fetch", pagedFetch())
  const user = userEvent.setup()
  let client!: QueryClient
  render(<Providers initialEntries={["/?client=client-1"]}><ClientsPage /><HistoryProbe capture={value => { client = value }} /></Providers>)
  const field = await screen.findByLabelText("RedirectUris（至少一条）")
  await user.clear(field)
  await user.type(field, "https://edited.example/callback")
  await act(async () => { client.setQueryData(["clients-detail", "client-1"], { ...detail("client-1", "Client 1"), redirectUris: ["https://server.example/callback"] }); await new Promise(resolve => setTimeout(resolve, 20)) })
  await waitFor(() => expect(field).toHaveValue("https://edited.example/callback"))
})
