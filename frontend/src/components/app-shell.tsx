import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { KeyRound, LayoutDashboard, ScrollText, ShieldCheck, Users, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { type Session } from "@/lib/api"
import { NAV, NAV_TITLES } from "@/lib/nav"
import { getSession } from "@/lib/session"
import { changeLanguage } from "@/i18n"
import pkg from "../../package.json"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

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
const NAV_ICONS = [LayoutDashboard, Users, ShieldCheck, KeyRound, ScrollText]

function SidebarNavigation() {
  const { t } = useTranslation()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV.map((item, index) => {
            const Icon = NAV_ICONS[index]
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild tooltip={t(item.label)}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Icon />
                    <span>{t(item.label)}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function MobileSidebarCloseButton({ label }: { label: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="md:hidden"
      aria-label={label}
      onClick={() => setOpenMobile(false)}
    >
      <X />
    </Button>
  )
}

export default function AppShell() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const title = t(NAV_TITLES[pathname] ?? "管理后台")
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    // 静默获取当前用户（401 时 apiGet 自会跳登录）；仅用于顶栏展示。
    // 经模块级缓存(#31):与概览/用户页共享同一次请求,消除首屏双发。
    getSession().then(setSession).catch(() => setSession(null))
  }, [])

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5 px-2 py-2 text-base font-bold text-primary">
      <img src="/admin/pandaauth-admin-mark-64.png" alt="" className="h-9 w-9" />
      PandaAuth
    </div>
  )

  const portalLink = session?.portalHomeUrl && (
    <a href={session.portalHomeUrl} className="mb-1 block rounded-md px-1 py-1 text-muted-foreground hover:text-primary">
      {t("返回熊猫门户")}
    </a>
  )

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas" mobileTitle={t("导航菜单")}>
        <SidebarHeader>
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            {brand}
            <MobileSidebarCloseButton label={t("关闭导航")} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNavigation />
        </SidebarContent>
        <SidebarFooter>
          <Separator />
          {session && (
            <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                {(session.nickname ?? session.name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{session.nickname ?? session.name ?? session.email}</span>
              {session.roles.length > 0 && <Badge variant="secondary">{session.roles[0]}</Badge>}
            </div>
          )}
          {portalLink}
          <p className="px-2 text-xs text-muted-foreground">{t("v{{version}} · 管理后台", { version: pkg.version })}</p>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-svh min-w-0 bg-background">
        <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="md:hidden" aria-label={t("打开导航")} />
            <h1 className="truncate text-sm font-semibold">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* 全页跳转（非 SPA 路由）：改密页在 IDP（/account/*），凭据是 OIDC 登录时
                建立的 IDP 会话 Cookie；成功后令牌全吊销，管理台会话一并失效需重新登录。 */}
            {session && (
              <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {(session.nickname ?? session.name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                {session.nickname ?? session.name ?? session.email}
                {session.roles.length > 0 && (
                  <Badge variant="secondary">
                    {session.roles[0]}
                  </Badge>
                )}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => window.location.assign("/account/change-password?returnUrl=/admin")}>
              {t("修改密码")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={i18n.language === "en" ? "切换到中文" : "Switch to English"}
              onClick={() => changeLanguage(i18n.language === "en" ? "zh-CN" : "en")}
            >
              {i18n.language === "en" ? "中文" : "EN"}
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              {t("退出登录")}
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
