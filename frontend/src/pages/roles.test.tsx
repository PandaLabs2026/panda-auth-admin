import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import RolesPage from "./roles"

const roles = { items: [{ id: "role-1", name: "admin" }], total: 1, page: 1, pageSize: 20 }
const claims = [{ id: 1, roleId: "role-1", claimType: "panda:department", claimValue: "platform", scope: "api" }]

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("RolesPage", () => {
  it("loads selected role claims from the role directory", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json(roles))
      if (path === "/admin/api/roles/role-1/claims") return Promise.resolve(json(claims))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<RolesPage />)
    await user.click(await screen.findByRole("button", { name: "admin" }))

    expect(await screen.findByText("panda:department")).toBeInTheDocument()
    expect(screen.getByText("platform")).toBeInTheDocument()
    expect(screen.getByText("api")).toBeInTheDocument()
  })

  it("encodes the selected role ID in the Claims request", async () => {
    const encodedRole = { id: "role/one?scope=admin", name: "special" }
    const encodedPath = "/admin/api/roles/role%2Fone%3Fscope%3Dadmin/claims"
    const fetchMock = vi.fn((path: string) => {
      if (path.startsWith("/admin/api/roles?")) {
        return Promise.resolve(json({ items: [encodedRole], total: 1, page: 1, pageSize: 20 }))
      }
      if (path === encodedPath) return Promise.resolve(json(claims))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<RolesPage />)
    await user.click(await screen.findByRole("button", { name: "special" }))

    expect(await screen.findByText("panda:department")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(encodedPath, expect.anything())
  })

  it("shows Claims loading and disables Claim writes while a role request is pending", async () => {
    let resolveClaims: ((response: Response) => void) | undefined
    const pendingClaims = new Promise<Response>((resolve) => {
      resolveClaims = resolve
    })
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json(roles))
      if (path === "/admin/api/roles/role-1/claims") return pendingClaims
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<RolesPage />)
    await user.click(await screen.findByRole("button", { name: "admin" }))

    expect(await screen.findByText("正在加载 Claims…")).toBeInTheDocument()
    expect(screen.queryByText("暂无自定义 Claims。")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "添加" })).not.toBeInTheDocument()

    resolveClaims?.(json([]))
  })

  it("blocks an empty claim and does not send a write request", async () => {
    const fetchMock = vi.fn((path: string, _options?: RequestInit) => {
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json(roles))
      if (path === "/admin/api/roles/role-1/claims") return Promise.resolve(json([]))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<RolesPage />)
    await user.click(await screen.findByRole("button", { name: "admin" }))
    await screen.findByText("暂无自定义 Claims。")
    await user.click(screen.getByRole("button", { name: "添加" }))

    expect(screen.getByText("Claim 类型、值和 scope 均不能为空")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false)
  })

  it("confirms before deleting a role claim", async () => {
    const fetchMock = vi.fn((path: string, _options?: RequestInit) => {
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json(roles))
      if (path === "/admin/api/roles/role-1/claims") return Promise.resolve(json(claims))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("confirm", vi.fn(() => false))
    const user = userEvent.setup()

    render(<RolesPage />)
    await user.click(await screen.findByRole("button", { name: "admin" }))
    await user.click(await screen.findByRole("button", { name: "删除" }))

    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false)
  })
})
