import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Providers } from "@/test/utils"
import { afterEach, expect, it, vi } from "vitest"
import LoginPage from "./login"
import { adminAuthNavigation } from "@/lib/auth-lifecycle"
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear() })
it("shares the automatic attempt guard and leaves manual retry available", async () => {
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(false)
  render(<Providers initialEntries={["/login?returnUrl=%2Fadmin%2Fusers%3Fpage%3D2"]}><LoginPage /></Providers>)
  await waitFor(() => expect(start).toHaveBeenCalledWith("/admin/users?page=2"))
  expect(await screen.findByText("登录未完成，请重试；若持续出现请联系管理员。")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "使用 PandaAuth 登录" }))
  expect(start).toHaveBeenLastCalledWith("/admin/users?page=2", true)
})
it("keeps an explicit error terminal until the operator requests retry", () => {
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(true)
  render(<Providers initialEntries={["/login?error=denied&returnUrl=%2Fadmin%2Froles"]}><LoginPage /></Providers>)
  expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "使用 PandaAuth 登录" }))
  expect(start).toHaveBeenCalledWith("/admin/roles", true)
})
