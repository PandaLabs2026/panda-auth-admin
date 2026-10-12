import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import i18n, { changeLanguage } from "@/i18n"
import AppShell from "./app-shell"

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 })
  localStorage.removeItem("panda.admin.lang")
  void i18n.changeLanguage("zh-CN")
})

describe("AppShell language switcher", () => {
  it("uses the dedicated transparent admin mark at 36px", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "admin-1", name: "Alice", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>)
    const mark = container.querySelector("img")

    expect(mark).not.toBeNull()
    expect(mark).toHaveAttribute("src", "/admin/pandaauth-admin-mark-64.png")
    expect(mark).toHaveClass("h-9", "w-9")
    expect(mark).not.toHaveClass("rounded-lg")
  })

  it("renders route navigation inside the shadcn sidebar", () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "admin-1", name: "Alice", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))

    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>)

    expect(container.querySelector('[data-slot="sidebar"]')).not.toBeNull()
    expect(screen.getByRole("link", { name: "概览" })).toBeInTheDocument()
  })

  it("closes the mobile navigation on Escape and after route selection", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 })
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "admin-1", name: "Alice", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    render(<MemoryRouter><AppShell /></MemoryRouter>)

    const openButton = screen.getByRole("button", { name: "打开导航" })
    await user.click(openButton)
    expect(openButton).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("dialog", { name: "导航菜单" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(openButton).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "打开导航" }))
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "用户管理" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the anti-forgery logout request and redirects to the login page", async () => {
    const fetchMock = vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "admin-1", name: "Alice", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }))
      }
      if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "xsrf-token" }))
      if (path === "/admin/api/logout") return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(<MemoryRouter><AppShell /></MemoryRouter>)
    await user.click(screen.getByRole("button", { name: "退出登录" }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/admin/api/logout", expect.anything()))
    expect(fetchMock).toHaveBeenCalledWith("/admin/api/logout", {
      method: "POST",
      headers: { "X-XSRF-Token": "xsrf-token", "X-Requested-With": "XMLHttpRequest" },
    })
  })

  it("toggles between zh-CN and en, persists the choice, and re-renders labels", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/admin/api/session") {
        return Promise.resolve(json({ subject: "admin-1", name: "Alice", email: null, nickname: null, roles: ["admin"], portalHomeUrl: null }))
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    }))
    const user = userEvent.setup()

    changeLanguage("zh-CN")
    render(<MemoryRouter><AppShell /></MemoryRouter>)

    // zh 默认:导航与按钮为中文
    expect(screen.getByRole("link", { name: "概览" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument()

    // 切到 en:导航与按钮翻成英文,选择持久化
    await user.click(screen.getByRole("button", { name: "Switch to English" }))
    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument()
    expect(localStorage.getItem("panda.admin.lang")).toBe("en")
    expect(document.documentElement.lang).toBe("en")

    // 切回 zh-CN
    await user.click(screen.getByRole("button", { name: "切换到中文" }))
    expect(await screen.findByRole("link", { name: "概览" })).toBeInTheDocument()
    expect(localStorage.getItem("panda.admin.lang")).toBe("zh-CN")
    expect(document.documentElement.lang).toBe("zh-CN")
  })
})
