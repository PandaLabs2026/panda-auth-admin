import { cleanup, render, screen } from "@testing-library/react"
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
