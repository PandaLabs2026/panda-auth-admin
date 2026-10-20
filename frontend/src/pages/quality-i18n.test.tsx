import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/test/utils"
import { LANG_STORAGE_KEY } from "@/i18n/config"
import UsersPage from "./users"
import RolesPage from "./roles"
import AuditPage from "./audit"
import ServerErrorPage from "./ServerErrorPage"

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.setItem(LANG_STORAGE_KEY, "zh-CN") })

describe("app-owned translated UI", () => {
  for (const [name, Page] of [["users", UsersPage], ["roles", RolesPage], ["audit", AuditPage]] as const) {
    for (const locale of ["zh-CN", "en"]) {
      it(`${name} interpolates pagination in ${locale}`, async () => {
        localStorage.setItem(LANG_STORAGE_KEY, locale)
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }),
          { headers: { "content-type": "application/json" } }))))
        const { container } = render(<Providers><Page /></Providers>)
        expect(await screen.findByText(locale === "en" ? "Page 1 / 1" : "第 1 / 1 页")).toBeInTheDocument()
        expect(container.textContent).not.toContain("{}")
      })
    }
  }

  it("renders a real reload button and a valid home link on the 500 page", () => {
    render(<Providers><ServerErrorPage /></Providers>)
    expect(screen.getByRole("button", { name: "重新加载" }).tagName).toBe("BUTTON")
    const home = screen.getByRole("link", { name: "返回首页" })
    expect(home.closest("button")).toBeNull()
  })

  it("translates the app-owned 500 page", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "en")
    render(<Providers><ServerErrorPage /></Providers>)
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument()
  })
})
