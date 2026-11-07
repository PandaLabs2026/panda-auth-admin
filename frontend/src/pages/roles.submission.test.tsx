import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/test/utils"
import RolesPage from "./roles"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("role page busy freeze (FilterToolbar)", () => {
  it("keeps the claims panel mounted when a pre-busy search would filter the role out", async () => {
    vi.useFakeTimers()
    try {
      let finish!: (value: Response) => void
      const pendingPost = new Promise<Response>((resolve) => { finish = resolve })
      const fetchMock = vi.fn((path: string, options?: RequestInit) => {
        if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "test-csrf" }))
        if (path.startsWith("/admin/api/roles?")) {
          if (path.includes("query=")) return Promise.resolve(json({ items: [], total: 0, page: 1, pageSize: 20 }))
          return Promise.resolve(json({ items: [{ id: "r1", name: "admin" }], total: 1, page: 1, pageSize: 20 }))
        }
        if (path === "/admin/api/roles/r1/claims" && options?.method === "POST") return pendingPost
        if (path === "/admin/api/roles/r1/claims") return Promise.resolve(json([]))
        throw new Error(`unexpected request ${path}`)
      })
      vi.stubGlobal("fetch", fetchMock)
      render(<Providers><RolesPage /></Providers>)
      const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(10) }) }
      await flush(); await flush(); await flush()

      fireEvent.click(screen.getByRole("button", { name: "admin" }))
      await flush(); await flush()
      expect(screen.getByLabelText("类型")).toBeInTheDocument()

      // busy 前输入搜索(节流 300ms 未落盘)并填好 Claim,随后点添加进入 busy。
      fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "zzz" } })
      fireEvent.change(screen.getByLabelText("值"), { target: { value: "v" } })
      fireEvent.click(screen.getByRole("button", { name: "添加" }))
      await flush()

      // busy 期:节流落盘被门控,URL 不写、列表不重取、面板不收起;搜索输入冻结。
      act(() => { vi.advanceTimersByTime(400) })
      await flush(); await flush()
      expect(screen.getByLabelText("类型")).toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([path]) => String(path).includes("query=zzz"))).toBe(false)
      expect(screen.getByTestId("filter-search")).toBeDisabled()

      // 完成添加:busy 结束后搜索解冻,冻结前输入的值统一落盘(面板此后按既有语义响应)。
      await act(async () => { finish(json({ id: 1 })); await pendingPost })
      await flush(); await flush()
      expect(screen.getByTestId("filter-search")).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("role claim delete busy guard", () => {
  it("disables row delete triggers while an add-claim request is in flight", async () => {
    let finish!: (value: Response) => void
    const pendingPost = new Promise<Response>((resolve) => { finish = resolve })
    const claims = [{ id: 1, roleId: "r1", claimType: "panda:old", claimValue: "v1", scope: "api" }]
    vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "test-csrf" }))
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json({ items: [{ id: "r1", name: "admin" }], total: 1, page: 1, pageSize: 20 }))
      if (path === "/admin/api/roles/r1/claims" && options?.method === "POST") return pendingPost
      if (path === "/admin/api/roles/r1/claims") return Promise.resolve(json(claims))
      throw new Error(`unexpected request ${path}`)
    }))
    const user = userEvent.setup()
    render(<Providers><RolesPage /></Providers>)
    await user.click(await screen.findByRole("button", { name: "admin" }))

    const triggers = await screen.findAllByRole("button", { name: "删除" })
    expect(triggers).toHaveLength(1)

    await user.type(await screen.findByLabelText("值"), "v2")
    await user.click(screen.getByRole("button", { name: "添加" }))

    // 添加请求在途:行内删除确认入口与角色按钮一并冻结
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "admin" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled()

    await act(async () => { finish(json({ id: 2 })); await pendingPost })
    await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toBeEnabled())
  })

  it("freezes add entry and other delete triggers while a delete request is in flight", async () => {
    let finish!: (value: Response) => void
    const pendingDelete = new Promise<Response>((resolve) => { finish = resolve })
    let claims = [
      { id: 1, roleId: "r1", claimType: "panda:a", claimValue: "v1", scope: "api" },
      { id: 2, roleId: "r1", claimType: "panda:b", claimValue: "v2", scope: "api" },
    ]
    vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "test-csrf" }))
      if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json({ items: [{ id: "r1", name: "admin" }], total: 1, page: 1, pageSize: 20 }))
      if (path === "/admin/api/roles/r1/claims/1" && options?.method === "DELETE") {
        claims = claims.filter((claim) => claim.id !== 1)
        return pendingDelete
      }
      if (path === "/admin/api/roles/r1/claims") return Promise.resolve(json(claims))
      throw new Error(`unexpected request ${path}`)
    }))
    const user = userEvent.setup()
    render(<Providers><RolesPage /></Providers>)
    await user.click(await screen.findByRole("button", { name: "admin" }))

    const triggers = await screen.findAllByRole("button", { name: "删除" })
    expect(triggers).toHaveLength(2)
    // 对话框为 Radix modal,打开后页面内容对 getByRole 不可见——先取引用再断言。
    const addButton = screen.getByRole("button", { name: "添加" })
    const roleButton = screen.getByRole("button", { name: "admin" })
    await user.click(triggers[0]!)
    await user.click(await screen.findByTestId("confirm-action-confirm"))

    // 删除请求在途:另一行删除入口、添加与角色按钮均禁用(防重入)
    expect(screen.getByTestId("confirm-action-confirm")).toBeDisabled()
    expect(addButton).toBeDisabled()
    expect(roleButton).toBeDisabled()
    expect(triggers[1]).toBeDisabled()

    await act(async () => { finish(json(null)); await pendingDelete })
    await waitFor(() => expect(screen.getByRole("button", { name: "添加" })).toBeEnabled())
    expect(screen.queryByText("panda:a")).not.toBeInTheDocument()
    expect(screen.getByText("panda:b")).toBeInTheDocument()
  })
})

describe("role claim submission", () => {
  for (const success of [true, false]) {
    it(`freezes the submitted fields and ${success ? "clears on success" : "retains on failure"}`, async () => {
      let finish!: (value: Response) => void
      const pending = new Promise<Response>((resolve) => { finish = resolve })
      let sent = ""
      vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
        if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "test-csrf" }))
        if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json({ items: [{ id: "r1", name: "admin" }], total: 1, page: 1, pageSize: 20 }))
        if (path === "/admin/api/roles/r1/claims" && options?.method === "POST") { sent = String(options.body); return pending }
        if (path === "/admin/api/roles/r1/claims") return Promise.resolve(json([]))
        throw new Error(`unexpected request ${path}`)
      }))
      const user = userEvent.setup()
      render(<Providers><RolesPage /></Providers>)
      await user.click(await screen.findByRole("button", { name: "admin" }))
      const type = await screen.findByLabelText("类型")
      const value = screen.getByLabelText("值")
      const scope = screen.getByLabelText("Scope")
      await user.clear(type); await user.type(type, "panda:test")
      await user.type(value, "original")
      await user.click(screen.getByRole("button", { name: "添加" }))
      await waitFor(() => expect(sent).toContain("original"))
      expect(type).toBeDisabled(); expect(value).toBeDisabled(); expect(scope).toBeDisabled()
      expect(screen.getByRole("button", { name: "admin" })).toBeDisabled()
      await user.type(value, "-late")
      expect(value).toHaveValue("original")
      await act(async () => { finish(success ? json({ id: 1 }) : json({ message: "failed" }, 500)); await pending })
      await waitFor(() => expect(value).toBeEnabled())
      expect(value).toHaveValue(success ? "" : "original")
      expect(type).toHaveValue(success ? "panda:" : "panda:test")
      expect(scope).toHaveValue("api")
      expect(JSON.parse(sent)).toEqual({ claimType: "panda:test", claimValue: "original", scope: "api" })
    })
  }
})
