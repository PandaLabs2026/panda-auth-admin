import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { apiGet } from "@/lib/api"

import { Button } from "@/components/ui/button"

/** 侧边栏导航：概览与三个管理模块（0.3 实装），当前路由高亮。 */
const NAV = [
  { to: "/", label: "概览" },
  { to: "/users", label: "用户管理" },
  { to: "/clients", label: "客户端管理" },
  { to: "/audit", label: "审计查询" },
] as const

const TITLES: Record<string, string> = {
  "/": "概览",
  "/users": "用户管理",
  "/clients": "客户端管理",
  "/audit": "审计查询",
}

/**
 * 登出：先取防伪令牌（`GET /admin/api/antiforgery` 会同时下发配套 Cookie，两者成对校验），
 * 再 `POST /admin/api/logout`。BFF 会先撤销 IDP 侧令牌（尽力而为）再清本地会话，
 * 最后把浏览器带到 IDP 的 end-session 端点完成单点登出——该 POST 本身就是一次重定向流，
 * 因此这里不等响应体，直接把窗口交给后端接管。
 */
async function logout() {
  const response = await fetch("/admin/api/antiforgery", { headers: { "X-Requested-With": "XMLHttpRequest" } })
  const { token } = (await response.json()) as { token: string }
  await fetch("/admin/api/logout", {
    method: "POST",
    headers: { "X-XSRF-Token": token, "X-Requested-With": "XMLHttpRequest" },
  })
  window.location.assign("/admin/login")
}

/**
 * 管理台应用外壳（侧边栏 + 顶栏），layout route 包裹全部页面——
 * 路由切换只替换 <Outlet/>，导航与登出常驻（此前外壳只存在于概览页，
 * 进入子模块后侧边栏整体消失，2026-09-19 生产走查发现）。
 */
type Session = { subject: string; name: string | null; email: string | null; nickname: string | null; roles: string[] }

export default function AppShell() {
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? "管理后台"
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    // 静默获取当前用户（401 时 apiGet 自会跳登录）；仅用于顶栏展示。
    apiGet<Session>("/admin/api/session").then(setSession).catch(() => setSession(null))
  }, [])

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5 text-base font-bold text-primary">
          <img src="/admin/apple-touch-icon.png" alt="" className="h-8 w-8 rounded-lg" />
          PandaAuth
        </div>
        <nav className="flex-1 space-y-1 px-3 text-sm">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
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
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">v0.3 · 管理后台</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card px-6 py-3">
          <h1 className="text-sm font-semibold">{title}</h1>
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
