import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { SessionGate } from "./SessionGate"

const i18n = { defaultLocale: "zh-CN", locales: ["zh-CN"], dictionaries: { "zh-CN": { "会话服务异常，请刷新重试。": "会话服务异常，请刷新重试。", "重试": "重试" } } }

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
