import { StrictMode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { Providers } from "@/test/utils"
import { I18nProvider } from "@/lib/i18n"
import { i18nConfig } from "@/i18n/config"
import { afterEach, expect, it, vi } from "vitest"
import LoginPage from "./login"
import { adminAuthNavigation } from "@/lib/auth-lifecycle"
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); localStorage.setItem("panda.admin.lang", "zh-CN") })
it("shares the automatic attempt guard and leaves manual retry available", async () => {
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(false)
  render(<Providers initialEntries={["/login?returnUrl=%2Fadmin%2Fusers%3Fpage%3D2"]}><LoginPage /></Providers>)
  await waitFor(() => expect(start).toHaveBeenCalledWith("/admin/users?page=2"))
  expect(await screen.findByRole("heading", {name:"登录未完成"})).toHaveFocus()
  const link=screen.getByRole("link", {name:"继续登录"})
  expect(link).toHaveAttribute("href", "/admin/challenge?returnUrl=%2Fadmin%2Fusers%3Fpage%3D2")
  fireEvent.click(link);expect(start).toHaveBeenLastCalledWith("/admin/users?page=2",true)
})
it("keeps an explicit error on the shared single-card terminal until manual retry", () => {
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(true)
  const view=render(<Providers initialEntries={["/login?error=denied&returnUrl=%2Fadmin%2Froles"]}><LoginPage /></Providers>)
  expect(screen.getByRole("heading", {name:"登录未完成"})).toHaveFocus()
  expect(view.container.querySelectorAll("main section")).toHaveLength(1)
  expect(view.container.querySelector("aside")).toBeNull()
  expect(screen.queryByText("熊猫实验室统一身份认证中台。一次登录，全生态通行。")).toBeNull()
  expect(screen.getByRole("img")).toHaveAttribute("src","/admin/pandaauth-logo-horizontal.png")
  expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("link",{name:"继续登录"}));expect(start).toHaveBeenCalledWith("/admin/roles",true)
})
it("StrictMode starts one automatic attempt and never disables the manual fallback while leaving", async()=>{
  const start=vi.spyOn(adminAuthNavigation,"start").mockReturnValue(true)
  render(<StrictMode><Providers initialEntries={["/login?returnUrl=%2Fadmin%2Fusers%3Fpage%3D2"]}><LoginPage/></Providers></StrictMode>)
  await waitFor(()=>expect(start).toHaveBeenCalledOnce())
  expect(screen.getByRole("heading",{name:"正在前往登录…"})).toBeInTheDocument()
  const link=screen.getByRole("link",{name:"继续登录"});expect(link).not.toHaveAttribute("aria-disabled","true")
  fireEvent.click(link);expect(start).toHaveBeenCalledTimes(2);expect(start).toHaveBeenLastCalledWith("/admin/users?page=2",true)
})
it("duplicate return URLs stop automatic navigation and manual continuation uses the safe home",()=>{
  const start=vi.spyOn(adminAuthNavigation,"start").mockReturnValue(false)
  render(<Providers initialEntries={["/login?returnUrl=%2Fadmin%2Fusers&returnUrl=%2Fadmin%2Froles"]}><LoginPage/></Providers>)
  expect(start).not.toHaveBeenCalled();expect(screen.getByRole("heading",{name:"登录未完成"})).toBeInTheDocument()
  const link=screen.getByRole("link",{name:"继续登录"});expect(link).toHaveAttribute("href","/admin/challenge?returnUrl=%2Fadmin%2F")
  fireEvent.click(link);expect(start).toHaveBeenCalledWith("/admin/",true)
})
it("preserves the real English preference on the explicit error bridge",()=>{
  localStorage.setItem("panda.admin.lang","en");const start=vi.spyOn(adminAuthNavigation,"start").mockReturnValue(false)
  render(<Providers initialEntries={["/login?error=cancelled&returnUrl=%2Fadmin%2Froles"]}><LoginPage/></Providers>)
  expect(document.documentElement.lang).toBe("en")
  expect(screen.getByRole("heading",{name:"Sign-in not completed"})).toHaveFocus()
  expect(screen.getByRole("link",{name:"Continue to sign in"})).toHaveAttribute("href","/admin/challenge?returnUrl=%2Fadmin%2Froles")
  expect(start).not.toHaveBeenCalled()
})
it("ignores malformed router state without a crash or an automatic challenge",()=>{
  const start=vi.spyOn(adminAuthNavigation,"start").mockReturnValue(false)
  render(<I18nProvider config={i18nConfig}><MemoryRouter initialEntries={[{pathname:"/login",state:{from:42}}]}><LoginPage/></MemoryRouter></I18nProvider>)
  expect(screen.getByRole("heading",{name:"管理后台登录"})).toBeInTheDocument();expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("link",{name:"继续登录"}));expect(start).toHaveBeenCalledWith("/admin/",true)
})
