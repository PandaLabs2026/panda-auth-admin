import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { Menu, X } from "lucide-react"
import { type Session } from "@/lib/api"
import { NAV, NAV_TITLES } from "@/lib/nav"
import { getSession } from "@/lib/session"

import { Button } from "@/components/ui/button"

/**
 * 登出：先取防伪令牌（`GET /admin/api/antiforgery` 会同时下发配套 Cookie，两者成对校验），
 * 再 `POST /admin/api/logout`。BFF 会先撤销 IDP 侧令牌（尽力而为）再清本地会话，并返回
 * 到 IDP end-session 的重定向——但 fetch 默认 `redirect: "follow"` 是在后台跟着这条链路走完的，
 * 浏览器顶层从不因此导航，所以最后必须显式 assign 才真正离开会话界面。
 * 任一步失败（防伪端点非 2xx、网络断开、end-session 跨域无 CORS 响应被 fetch 判错）都
 * 不再让登出按钮无声失效（此前直接 unhandled rejection，界面毫无反应）：统一兜底跳登录入口，
 * 让过期的会话壳在下一次进入时被重新认证接管。
 */
async function logout() {
  try {
    const response = await fetch("/admin/api/antiforgery", { headers: { "X-Requested-With": "XMLHttpRequest" } })
    if (!response.ok) throw new Error(`antiforgery ${response.status}`)
    const { token } = (await response.json()) as { token: string }
    await fetch("/admin/api/logout", {
      method: "POST",
      headers: { "X-XSRF-Token": token, "X-Requested-With": "XMLHttpRequest" },
    })
  } catch {
    // 撤销/清会话在 BFF 侧尽力而为；这里只保证用户一定能离开当前界面。
  } finally {
    window.location.assign("/admin/login")
  }
}

/**
 * 管理台应用外壳（侧边栏 + 顶栏），layout route 包裹全部页面——
 * 路由切换只替换 <Outlet/>，导航与登出常驻（此前外壳只存在于概览页，
 * 进入子模块后侧边栏整体消失，2026-09-19 生产走查发现）。
 */
export default function AppShell() {
  const { pathname } = useLocation()
  const title = NAV_TITLES[pathname] ?? "管理后台"
  const [session, setSession] = useState<Session | null>(null)
  // 移动端抽屉:<768px 侧边栏隐藏,此前无任何导航入口,用户被困在落地页(#22)。
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    // 静默获取当前用户（401 时 apiGet 自会跳登录）；仅用于顶栏展示。
    // 经模块级缓存(#31):与概览/用户页共享同一次请求,消除首屏双发。
    getSession().then(setSession).catch(() => setSession(null))
  }, [])

  useEffect(() => {
    if (!navOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [navOpen])

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-5 text-base font-bold text-primary">
      <img src="/admin/apple-touch-icon.png" alt="" className="h-8 w-8 rounded-lg" />
      PandaAuth
    </div>
  )

  const navLinks = (
    <nav className="flex-1 space-y-1 px-3 text-sm">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={() => setNavOpen(false)}
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 ${
              isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/50"
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  const portalLink = session?.portalHomeUrl && (
    <a href={session.portalHomeUrl} className="mb-1 block rounded-md px-1 py-1 text-muted-foreground hover:text-primary">
      返回熊猫门户
    </a>
  )

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
        {brand}
        {navLinks}
        <div className="border-t px-5 py-3 text-xs">
          {portalLink}
          <p className="text-muted-foreground">v0.3 · 管理后台</p>
        </div>
      </aside>

      {/* 移动端抽屉:点链接/Esc/遮罩关闭;打开期间锁页面滚动。 */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="导航菜单">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card shadow-xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button
                type="button"
                aria-label="关闭导航"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                onClick={() => setNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navLinks}
            <div className="border-t px-5 py-3 text-xs">
              {session && (
                <p className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {(session.nickname ?? session.name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{session.nickname ?? session.name ?? session.email}</span>
                </p>
              )}
              {portalLink}
              <p className="text-muted-foreground">v0.3 · 管理后台</p>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-6 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={navOpen}
              aria-label="打开导航"
              className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-sm font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 全页跳转（非 SPA 路由）：改密页在 IDP（/account/*），凭据是 OIDC 登录时
                建立的 IDP 会话 Cookie；成功后令牌全吊销，管理台会话一并失效需重新登录。 */}
            {session && (
              <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {(session.nickname ?? session.name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                {session.nickname ?? session.name ?? session.email}
                {session.roles.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {session.roles[0]}
                  </span>
                )}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => window.location.assign("/account/change-password?returnUrl=/admin")}>
              修改密码
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              退出登录
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
