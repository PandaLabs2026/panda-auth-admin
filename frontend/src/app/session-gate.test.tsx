import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { SessionGate } from "./SessionGate"

const i18n = { defaultLocale: "zh-CN", locales: ["zh-CN"], dictionaries: { "zh-CN": {
  "会话服务异常，请刷新重试。": "会话服务异常，请刷新重试。",
  "重试": "重试",
  "无权访问管理后台": "无权访问管理后台",
  "正在确认管理权限…": "正在确认管理权限…",
  "请先绑定 TOTP 验证器": "请先绑定 TOTP 验证器",
  "管理员须以密码＋TOTP 使用管理台；绑定前管理操作不可用。完成绑定后返回本页继续。": "管理员须以密码＋TOTP 使用管理台；绑定前管理操作不可用。完成绑定后返回本页继续。",
  "前往绑定 TOTP": "前往绑定 TOTP",
} } }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("SessionGate", () => {
  it("keeps the protected route in an error state when session lookup returns 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <I18nProvider config={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route path="/protected" element={<SessionGate><p>受保护页面</p></SessionGate>} />
              <Route path="/login" element={<p>登录页</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByRole("alert")).toHaveTextContent("会话服务异常")

    expect(screen.queryByText("登录页")).not.toBeInTheDocument()
    expect(screen.queryByText("受保护页面")).not.toBeInTheDocument()
  })
})

describe("SessionGate TOTP 绑定引导（AUTH-DELIVERY-002）", () => {
  it("gates the console behind a TOTP binding prompt when the operator has not bound one", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session")
        return Promise.resolve(new Response(JSON.stringify({ subject: "s-1", name: "admin", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }), { headers: { "content-type": "application/json" } }))
      if (path === "/admin/api/mfa/capability")
        return Promise.resolve(new Response(JSON.stringify({ totpBound: false, mfaSatisfied: false }), { headers: { "content-type": "application/json" } }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <I18nProvider config={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route path="/protected" element={<SessionGate><p>受保护页面</p></SessionGate>} />
              <Route path="/login" element={<p>登录页</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByText("请先绑定 TOTP 验证器")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "前往绑定 TOTP" })).toHaveAttribute("href", "/account/mfa?returnUrl=/admin/")
    expect(screen.queryByText("受保护页面")).not.toBeInTheDocument()
  })
})


describe("SessionGate request isolation", () => {
  it("does not request MFA capability while the session is unresolved", async () => {
    const fetch = vi.fn((path: string) => { void path; return new Promise<Response>(() => {}) })
    vi.stubGlobal("fetch", fetch)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<I18nProvider config={i18n}><QueryClientProvider client={client}><MemoryRouter><SessionGate><p>private</p></SessionGate></MemoryRouter></QueryClientProvider></I18nProvider>)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["/admin/api/session"])
    expect(screen.queryByText("private")).not.toBeInTheDocument()
  })
})

describe("SessionGate admission states", () => {
  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<I18nProvider config={i18n}><QueryClientProvider client={client}><MemoryRouter><SessionGate><p>private</p></SessionGate></MemoryRouter></QueryClientProvider></I18nProvider>)
  }
  it("does not mount business content while MFA capability is pending", async () => {
    const fetch = vi.fn((path: string) => path === "/admin/api/session"
      ? Promise.resolve(new Response(JSON.stringify({ subject: "user", roles: ["admin"], name: null, email: null, nickname: null, portalHomeUrl: null }), { headers: { "content-type": "application/json" } }))
      : new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetch)
    mount()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("private")).not.toBeInTheDocument()
  })
  it("presents permission refusal instead of a session service failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })))
    mount()
    expect(await screen.findByRole("alert")).toHaveTextContent("无权访问管理后台")
    expect(screen.queryByText("private")).not.toBeInTheDocument()
  })
})
