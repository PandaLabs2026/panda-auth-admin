import { act, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router"
import { StrictMode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import AdminAuthBoundary, { adminAuthNavigation } from "./AdminAuthBoundary"
import { sessionApi, type Session } from "@/lib/auth"
import { I18nProvider } from "@/lib/i18n"
import { i18nConfig } from "@/i18n/config"
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.setItem("panda.admin.lang", "zh-CN") })
const adminSession = (overrides: Partial<Session> = {}): Session =>
  ({ displayName: "管理员", subject: "admin-1", roles: ["panda-auth-admin"], ...overrides })
function view(client = new QueryClient()): QueryClient {
  render(<StrictMode><I18nProvider config={i18nConfig}><QueryClientProvider client={client}><MemoryRouter initialEntries={["/users"]}><AdminAuthBoundary><p>private</p></AdminAuthBoundary></MemoryRouter></QueryClientProvider></I18nProvider></StrictMode>)
  return client
}
it("checks before mounting business and preserves the Admin path and query for automatic login", async () => {
  vi.spyOn(sessionApi, "me").mockResolvedValue(null)
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(false)
  render(<I18nProvider config={i18nConfig}><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/users?page=2"]}><AdminAuthBoundary><p>private</p></AdminAuthBoundary></MemoryRouter></QueryClientProvider></I18nProvider>)
  expect(screen.queryByText("private")).not.toBeInTheDocument()
  await waitFor(() => expect(start).toHaveBeenCalledWith("/admin/users?page=2"))
  expect(await screen.findByText("登录未完成")).toBeInTheDocument()
})

it("preserves the real English preference on an unavailable session without mounting business or challenging", async () => {
  localStorage.setItem("panda.admin.lang", "en")
  vi.spyOn(sessionApi, "me").mockRejectedValue(new Error("synthetic offline"))
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(false)
  render(
    <I18nProvider config={i18nConfig}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/users?page=2"]}>
          <AdminAuthBoundary><p>private business</p></AdminAuthBoundary>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
  await waitFor(() => expect(document.documentElement.lang).toBe("en"))
  expect(await screen.findByRole("heading", { name: "Unable to confirm sign-in" })).toHaveFocus()
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  expect(screen.queryByText("private business")).not.toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
})

it("resume with unchanged identity keeps the workspace and skips the cache rewrite", async () => {
  const first = adminSession({ email: "a@pandalabs.cn", nickname: null })
  const me = vi.spyOn(sessionApi, "me").mockResolvedValue(first)
  const client = view()
  await screen.findByText("private")
  const baseline = me.mock.calls.length
  me.mockResolvedValue({ ...first })
  await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve() })
  await waitFor(() => expect(me).toHaveBeenCalledTimes(baseline + 1))
  // sameSession early-return keeps the first verified session object in the cache.
  expect(client.getQueryData<Session | null>(["session"])).toBe(first)
  expect(screen.getByText("private")).toBeInTheDocument()
  expect(screen.queryByText("正在前往认证…")).not.toBeInTheDocument()
})
it("resume with changed roles refreshes the session without navigation", async () => {
  const me = vi.spyOn(sessionApi, "me").mockResolvedValue(adminSession({ roles: ["panda-auth-admin"], nickname: null }))
  const client = view()
  await screen.findByText("private")
  me.mockResolvedValue(adminSession({ roles: [], nickname: null }))
  await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve() })
  await waitFor(() => expect(client.getQueryData<Session | null>(["session"])?.roles).toEqual([]))
  expect(screen.getByText("private")).toBeInTheDocument()
})
it("anonymous resume challenges exactly once and presents the quiet stage text", async () => {
  const me = vi.spyOn(sessionApi, "me").mockResolvedValue(adminSession({ nickname: null }))
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(true)
  view()
  await screen.findByText("private")
  const baseline = me.mock.calls.length
  me.mockResolvedValue(null)
  await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve() })
  await waitFor(() => expect(me).toHaveBeenCalledTimes(baseline + 1))
  await waitFor(() => expect(start).toHaveBeenCalledOnce())
  expect(screen.getByText("正在前往认证…")).toBeInTheDocument()
  expect(screen.queryByText("登录已过期")).not.toBeInTheDocument()
})
