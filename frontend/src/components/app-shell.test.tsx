import { cleanup, render, screen } from "@testing-library/react"
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
  vi.restoreAllMocks()
  localStorage.removeItem("panda.admin.lang")
  void i18n.changeLanguage("zh-CN")
})

describe("AppShell language switcher", () => {
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
