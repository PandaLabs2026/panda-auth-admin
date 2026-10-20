import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect } from "react"
import { useNavigate, type NavigateFunction } from "react-router"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/test/utils"
import { saveDraft } from "@/lib/drafts"
import UsersPage from "./users"
import ClientsPage from "./clients"

const secret = "fixture-one-time-value"
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
type Controls = { navigate?: NavigateFunction; client?: QueryClient }
function Control({ into }: { into: Controls }) {
  const navigate = useNavigate(), client = useQueryClient()
  useEffect(() => { Object.assign(into, { navigate, client }) }, [into, navigate, client])
  return null
}
function userInfo(id: string, version = 1) {
  return { id, userName: id === "u-1" ? "alice" : "bob", email: "fixture@example.test", nickname: null, status: 0,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-01-01T00:00:0${version}Z`, emailConfirmed: true,
    roles: [], lockoutEnd: null, accessFailedCount: 0, twoFactorEnabled: false, registerChannel: 0, region: null }
}
function usersFetch(reset?: Promise<Response>) {
  let version = 0
  return vi.fn((path: string) => {
    if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "fixture-csrf" }))
    if (path.startsWith("/admin/api/users?")) return Promise.resolve(json({ items: [userInfo("u-1"), userInfo("u-2")], total: 2, page: 1, pageSize: 20 }))
    if (path.endsWith("/claims") || path.endsWith("/sessions")) return Promise.resolve(json([]))
    if (path.endsWith("/reset-password")) return reset ?? Promise.resolve(json({ password: secret }))
    if (path === "/admin/api/users/u-1" || path === "/admin/api/users/u-2") return Promise.resolve(json(userInfo(path.split("/").at(-1)!, ++version)))
    return Promise.reject(new Error(`unexpected request: ${path}`))
  })
}
async function resetAlice() {
  const user = userEvent.setup()
  const row = (await screen.findByText("alice")).closest("tr")!
  await user.click(within(row).getByRole("button", { name: "重置密码" }))
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "生成新密码" }))
}

beforeEach(() => { Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear() })

describe("credential and draft ownership", () => {
  it("keeps a reset password on same-user refresh, keeps it out of caches/storage, and closes it explicitly", async () => {
    vi.stubGlobal("fetch", usersFetch())
    const control: Controls = {}
    render(<Providers initialEntries={["/?user=u-1"]}><UsersPage /><Control into={control} /></Providers>)
    await screen.findByText("账号详情 · alice")
    await resetAlice()
    await screen.findByText(secret)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    await act(async () => { await control.client!.invalidateQueries({ queryKey: ["users-detail", "u-1"] }) })
    expect(screen.getByText(secret)).toBeInTheDocument()
    expect(JSON.stringify(control.client!.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(secret)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(secret)
    await userEvent.setup().click(screen.getByRole("button", { name: "关闭一次性密码" }))
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })

  it("drops a late reset result after the selected user changes", async () => {
    let finish: ((response: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.stubGlobal("fetch", usersFetch(pending))
    const control: Controls = {}
    render(<Providers initialEntries={["/?user=u-1"]}><UsersPage /><Control into={control} /></Providers>)
    await screen.findByText("账号详情 · alice")
    await resetAlice()
    act(() => { control.navigate!("/?user=u-2") })
    await screen.findByText("账号详情 · bob")
    await act(async () => { finish?.(json({ password: secret })) })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })

  it("clears a claim draft when changing users", async () => {
    vi.stubGlobal("fetch", usersFetch())
    const control: Controls = {}
    render(<Providers initialEntries={["/?user=u-1"]}><UsersPage /><Control into={control} /></Providers>)
    await screen.findByText("账号详情 · alice")
    await userEvent.setup().type(screen.getByLabelText("值"), "alice-draft")
    act(() => { control.navigate!("/?user=u-2") })
    await screen.findByText("账号详情 · bob")
    expect(screen.getByLabelText("值")).toHaveValue("")
  })

  it("binds a newly generated password to the created user", async () => {
    const fallback = usersFetch()
    vi.stubGlobal("fetch", vi.fn((path: string) => path === "/admin/api/users" ? Promise.resolve(json({ id: "u-2", userName: "bob", email: null, password: secret })) : fallback(path)))
    const user = userEvent.setup()
    render(<Providers><UsersPage /></Providers>)
    await user.click(screen.getByRole("button", { name: "新建用户" }))
    await user.type(screen.getByLabelText("用户名 *"), "bob")
    await user.click(screen.getByRole("button", { name: "创建" }))
    await screen.findByText("账号详情 · bob")
    expect(await screen.findByText(secret)).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret)
  })

  it.each(["u-1", "u-2"])("restores a step-up claim draft only for its owner (%s)", async (ownerId) => {
    saveDraft("users.claim", { userId: ownerId, draft: { claimType: "panda:test", claimValue: "saved-value", scope: "api" } })
    vi.stubGlobal("fetch", usersFetch())
    render(<Providers initialEntries={["/?user=u-1"]}><UsersPage /></Providers>)
    await screen.findByText("账号详情 · alice")
    expect(screen.getByLabelText("值")).toHaveValue(ownerId === "u-1" ? "saved-value" : "")
    expect(sessionStorage.getItem("panda.admin.draft.users.claim")).toBeNull()
  })

  it("clears a client secret on selection change and encodes mutation target IDs", async () => {
    const first = "client?part=/"
    const info = (id: string) => ({ clientId: id, displayName: id, clientType: "confidential", consentType: "implicit", isFirstParty: false,
      redirectUris: ["https://fixture.test/callback"], postLogoutRedirectUris: [], permissions: [], requirements: [] })
    const fetch = vi.fn((path: string) => {
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "fixture-csrf" }))
      if (path.startsWith("/admin/api/clients?")) return Promise.resolve(json({ items: [info(first), info("other")], total: 2, page: 1, pageSize: 20 }))
      if (path === "/admin/api/clients/options") return Promise.resolve(json({ permissionGroups: [] }))
      if (path.endsWith("/rotate-secret")) return Promise.resolve(json({ clientSecret: secret }))
      if (path === `/admin/api/clients/${encodeURIComponent(first)}`) return Promise.resolve(json(info(first)))
      if (path === "/admin/api/clients/other") return Promise.resolve(json(info("other")))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetch)
    const control: Controls = {}, user = userEvent.setup()
    render(<Providers initialEntries={[`/?client=${encodeURIComponent(first)}`]}><ClientsPage /><Control into={control} /></Providers>)
    await screen.findByText(`回调 / 登出白名单 · ${first}`)
    await user.click(screen.getByRole("button", { name: "轮换密钥" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "轮换密钥" }))
    await screen.findByText(secret)
    expect(fetch.mock.calls.some(([path]) => path === `/admin/api/clients/${encodeURIComponent(first)}/rotate-secret`)).toBe(true)
    act(() => { control.navigate!("/?client=other") })
    await screen.findByText("回调 / 登出白名单 · other")
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })
})
