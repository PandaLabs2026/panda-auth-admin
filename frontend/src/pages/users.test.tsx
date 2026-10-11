import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
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
    render(<MemoryRouter><UsersPage /></MemoryRouter>)
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

    render(<MemoryRouter><UsersPage /></MemoryRouter>)
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

    render(<MemoryRouter><UsersPage /></MemoryRouter>)
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

    render(<MemoryRouter><UsersPage /></MemoryRouter>)
    await user.click(await screen.findByText("alice"))

    // #30 后半:详情卡下的只读会话面板,独立加载。
    expect(await screen.findByText("在线会话")).toBeInTheDocument()
    expect(await screen.findByText("admin-web")).toBeInTheDocument()
  })
})
