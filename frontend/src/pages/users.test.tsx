import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Providers } from "@/test/utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import UsersPage from "./users"
import type { UserDetail, UserSummary } from "@/lib/api"

const summary = (id: string, userName: string): UserSummary => ({
  id,
  userName,
  email: `${userName}@example.com`,
  nickname: null,
  status: 0,
  createdAt: "2026-01-01T00:00:00Z",
})

const detail = (id: string, userName: string): UserDetail => ({
  ...summary(id, userName),
  emailConfirmed: true,
  roles: [],
  lockoutEnd: null,
  accessFailedCount: 0,
  twoFactorEnabled: false,
  registerChannel: 0,
  region: null,
  updatedAt: "2026-01-01T00:00:00Z",
})

const list = { items: [summary("u-1", "alice"), summary("u-2", "bob")], total: 2, page: 1, pageSize: 20 }

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("UsersPage detail ordering", () => {
  it("does not restore a stale detail when a superseding open finishes first", async () => {
    let resolveFirstDetail: ((response: Response) => void) | undefined
    let resolveFirstClaims: ((response: Response) => void) | undefined
    const firstDetail = new Promise<Response>((resolve) => { resolveFirstDetail = resolve })
    const firstClaims = new Promise<Response>((resolve) => { resolveFirstClaims = resolve })

    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") return Promise.resolve(json({ subject: "admin-1", name: null, email: null, nickname: null, roles: ["admin"] }))
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      // alice 的详情慢（先点开、后被 bob 抢占），claims 同挂起。
      if (path === "/admin/api/users/u-1") return firstDetail
      if (path === "/admin/api/users/u-1/claims") return firstClaims
      if (path === "/admin/api/users/u-2") return Promise.resolve(json(detail("u-2", "bob")))
      if (path === "/admin/api/users/u-2/claims") return Promise.resolve(json([]))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    // 选中详情由 URL 参数驱动(#27),需要 Router 上下文。
    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByText("alice"))
    await user.click(await screen.getByText("bob"))

    expect(await screen.findByText("账号详情 · bob")).toBeInTheDocument()

    // bob 之后 alice 的慢响应才回来：乱序守卫必须丢弃，不得把详情覆盖回 alice。
    resolveFirstDetail?.(json(detail("u-1", "alice")))
    resolveFirstClaims?.(json([]))
    // 真实定时器让步：被丢弃的续体若未被守卫拦截，会在此窗口内完成 setState 覆盖。
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText("账号详情 · alice")).not.toBeInTheDocument()
    expect(screen.getByText("账号详情 · bob")).toBeInTheDocument()
  })
})

describe("UsersPage revoke tokens", () => {
  it("confirms via AlertDialog then calls revoke-tokens", async () => {
    // 注意:getSession 的模块级缓存使本文件第二个测试复用第一个测试的会话响应。
    const fetchMock = vi.fn((path: string) => {
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      if (path === "/admin/api/users/u-1") return Promise.resolve(json(detail("u-1", "alice")))
      if (path === "/admin/api/users/u-1/claims") return Promise.resolve(json([]))
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "csrf-token" }))
      if (path === "/admin/api/users/u-1/revoke-tokens") return Promise.resolve(json(detail("u-1", "alice")))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByText("alice"))
    await user.click(await screen.findByRole("button", { name: "下线全部会话" }))

    // #30:先弹确认,不直接发请求。
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([p]) => p === "/admin/api/users/u-1/revoke-tokens")).toBe(false)

    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "下线全部会话" }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([p]) => p === "/admin/api/users/u-1/revoke-tokens")).toBe(true),
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })
})

describe("UsersPage sorting", () => {
  it("writes whitelist sort params into the list request", async () => {
    const fetchMock = vi.fn((path: string) => {
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByRole("button", { name: /用户名/ }))
    await screen.findByText("alice")

    // #31:排序进服务端参数(sort/dir 进 URL 由路由层保证)。
    const listPath = fetchMock.mock.calls.map(([p]) => String(p)).find((p) => p.includes("orderBy=userName"))
    expect(listPath).toContain("order=asc")
  })
})

describe("UsersPage sessions panel", () => {
  it("renders valid sessions from the read-only view", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      if (path === "/admin/api/users/u-1") return Promise.resolve(json(detail("u-1", "alice")))
      if (path === "/admin/api/users/u-1/claims") return Promise.resolve(json([]))
      if (path === "/admin/api/users/u-1/sessions") {
        return Promise.resolve(json([
          { id: "rt-1", clientId: "admin-web", type: "refresh_token", creationDate: "2026-10-01T00:00:00Z", expirationDate: "2026-10-15T00:00:00Z" },
        ]))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByText("alice"))

    // #30 后半:详情卡下的只读会话面板,独立加载。
    expect(await screen.findByText("在线会话")).toBeInTheDocument()
    expect(await screen.findByText("admin-web")).toBeInTheDocument()
  })
})

describe("UsersPage long identifiers", () => {
  it("users keep long IDs inside the table container", async () => {
    const longId = `user-${"x".repeat(96)}`
    const longList = { items: [summary(longId, longId)], total: 1, page: 1, pageSize: 20 }
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") return Promise.resolve(json({ subject: "admin-1", name: null, email: null, nickname: null, roles: ["admin"] }))
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(longList))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    const { container } = render(<Providers><UsersPage /></Providers>)

    expect(await screen.findByText(longId)).toBeInTheDocument()
    const tableContainer = container.querySelector('[data-slot="table-container"]')
    expect(tableContainer).toHaveClass("overflow-x-auto")
  })
})

describe("UsersPage claim delete busy guard", () => {
  const userClaims = [
    { id: 1, userId: "u-1", claimType: "panda:a", claimValue: "v1", scope: "api" },
    { id: 2, userId: "u-1", claimType: "panda:b", claimValue: "v2", scope: "api" },
  ]

  it("disables row delete triggers while an add-claim request is in flight", async () => {
    let finish!: (value: Response) => void
    const pendingPost = new Promise<Response>((resolve) => { finish = resolve })
    let claims = userClaims
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "csrf-token" }))
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      if (path === "/admin/api/users/u-1") return Promise.resolve(json(detail("u-1", "alice")))
      if (path === "/admin/api/users/u-1/sessions") return Promise.resolve(json([]))
      if (path === "/admin/api/users/u-1/claims" && options?.method === "POST") {
        claims = [...claims, { id: 3, userId: "u-1", claimType: "panda:c", claimValue: "v3", scope: "api" }]
        return pendingPost
      }
      if (path === "/admin/api/users/u-1/claims") return Promise.resolve(json(claims))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByText("alice"))

    const triggers = await screen.findAllByRole("button", { name: "删除" })
    expect(triggers).toHaveLength(2)

    await user.type(await screen.findByLabelText("值"), "v3")
    await user.click(screen.getByRole("button", { name: "添加" }))

    // 添加请求在途:行内删除确认入口一并冻结
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled()
    for (const trigger of screen.getAllByRole("button", { name: "删除" })) {
      expect(trigger).toBeDisabled()
    }

    await act(async () => { finish(json({ id: 3, userId: "u-1", claimType: "panda:c", claimValue: "v3", scope: "api" })); await pendingPost })
    await waitFor(() => expect(screen.getByRole("button", { name: "添加" })).toBeEnabled())
    await waitFor(() => expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(3))
  })

  it("freezes add entry and other delete triggers while a delete request is in flight", async () => {
    let finish!: (value: Response) => void
    const pendingDelete = new Promise<Response>((resolve) => { finish = resolve })
    let claims = userClaims
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "csrf-token" }))
      if (path.startsWith("/admin/api/users?")) return Promise.resolve(json(list))
      if (path === "/admin/api/users/u-1") return Promise.resolve(json(detail("u-1", "alice")))
      if (path === "/admin/api/users/u-1/sessions") return Promise.resolve(json([]))
      if (path === "/admin/api/users/u-1/claims/1" && options?.method === "DELETE") {
        claims = claims.filter((claim) => claim.id !== 1)
        return pendingDelete
      }
      if (path === "/admin/api/users/u-1/claims") return Promise.resolve(json(claims))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<Providers><UsersPage /></Providers>)
    await user.click(await screen.findByText("alice"))

    const triggers = await screen.findAllByRole("button", { name: "删除" })
    expect(triggers).toHaveLength(2)
    // 对话框为 Radix modal,打开后页面内容对 getByRole 不可见——先取引用再断言。
    const addButton = screen.getByRole("button", { name: "添加" })
    await user.click(triggers[0]!)
    await user.click(await screen.findByTestId("confirm-action-confirm"))

    // 删除请求在途:另一行删除入口与添加按钮均禁用(防重入)
    expect(screen.getByTestId("confirm-action-confirm")).toBeDisabled()
    expect(addButton).toBeDisabled()
    expect(triggers[1]).toBeDisabled()

    await act(async () => { finish(json(null)); await pendingDelete })
    await waitFor(() => expect(screen.getByRole("button", { name: "添加" })).toBeEnabled())
    expect(screen.queryByText("panda:a")).not.toBeInTheDocument()
    expect(screen.getByText("panda:b")).toBeInTheDocument()
  })
})
