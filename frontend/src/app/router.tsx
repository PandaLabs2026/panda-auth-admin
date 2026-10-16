import { lazy, Suspense, useEffect } from "react"
import { createBrowserRouter, useNavigate } from "react-router"
import { KeyRoundIcon, LogOutIcon } from "lucide-react"
import AppLayout, { type NavItem } from "@/components/patterns/AppLayout"
import HeaderActions from "@/components/header-actions"
import RequireAuth from "@/components/patterns/RequireAuth"
import ForbiddenPage from "@/pages/ForbiddenPage"
import LoginPage from "@/pages/login"
import NotFoundPage from "@/pages/NotFoundPage"
import ServerErrorPage from "@/pages/ServerErrorPage"
import { sessionApi, registerSessionExpiredHandler } from "@/lib/auth"
import { NAV } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"

/**
 * 路由(模板 v0.5.0 形态):/login 独立无布局,其余挂在 AppLayout(侧栏+固定顶栏)
 * 与 RequireAuth 守卫之下;403/500/404 错误页入册。页面 lazy() 拆 chunk,
 * Suspense 骨架与正式布局同锚点顶对齐。basename 跟随 Vite base(/admin/)。
 */

const DashboardPage = lazy(() => import("@/pages/dashboard"))
const UsersPage = lazy(() => import("@/pages/users"))
const RolesPage = lazy(() => import("@/pages/roles"))
const ClientsPage = lazy(() => import("@/pages/clients"))
const AuditPage = lazy(() => import("@/pages/audit"))

function PageFallback() {
  return (
    <div className="flex flex-col gap-4 pt-2" role="status" aria-label="页面加载中">
      <div className="h-6 w-64 rounded bg-muted" />
      <div className="h-24 w-full rounded bg-muted" />
      <div className="h-24 w-full rounded bg-muted" />
    </div>
  )
}

const page = (node: React.ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>

/** 命令面板附加动作(导航自动来自 navItems)。i18n 文案在组件外取静态值——
 *  面板动作标签随语言切换的刷新由整页行为承载,可接受。 */
function useCommandActions() {
  const { t } = useI18n()
  return [
    {
      id: "change-password",
      label: t("修改密码"),
      icon: KeyRoundIcon,
      run: () => window.location.assign("/account/change-password?returnUrl=/admin"),
    },
    { id: "logout", label: t("退出登录"), icon: LogOutIcon, shortcut: "⌘⇧Q", run: () => void sessionApi.logout() },
  ]
}

/** 布局组装(模板 AppLayout 之上的应用层):品牌/导航/顶栏常驻件/命令面板动作。 */
export function AppShell() {
  const { t } = useI18n()
  const commandActions = useCommandActions()
  const navItems: NavItem[] = NAV.map(({ to, label, icon, ...rest }) => ({ to, label: t(label), icon, ...rest }))
  return (
    <AppLayout
      navItems={navItems}
      title={t("管理后台")}
      brand={
        <>
          <img src="/admin/pandaauth-admin-mark-64.png" alt="PandaAuth" className="size-8 rounded-lg object-contain" />
          <span className="grid flex-1 text-left leading-tight">
            <span className="font-semibold">PandaAuth</span>
            <span className="text-xs text-muted-foreground">{t("管理后台")}</span>
          </span>
        </>
      }
      headerActions={<HeaderActions />}
      commandActions={commandActions}
    />
  )
}

/** 401 → 会话过期处理(模板接线):SPA 跳登录页带来源回跳;数据层 401 走 api.ts 整页跳转,双轨见 lib/auth.ts。 */
function SessionExpiredBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    registerSessionExpiredHandler((from) =>
      navigate("/login", { replace: true, state: { from: from.startsWith("/") ? from : "/" } }),
    )
  }, [navigate])
  return null
}

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: (
        <>
          <SessionExpiredBridge />
          <LoginPage />
        </>
      ),
    },
    {
      path: "/",
      element: (
        <>
          <SessionExpiredBridge />
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        </>
      ),
      children: [
        { index: true, element: page(<DashboardPage />) },
        { path: "users", element: page(<UsersPage />) },
        { path: "roles", element: page(<RolesPage />) },
        { path: "clients", element: page(<ClientsPage />) },
        { path: "audit", element: page(<AuditPage />) },
        { path: "403", element: <ForbiddenPage /> },
        { path: "500", element: <ServerErrorPage /> },
      ],
    },
    { path: "*", element: <NotFoundPage /> },
  ],
  // 路由 basename 跟随 Vite base,但剥掉尾斜杠:vite base 为 /admin/ 而裸路径 /admin 入口
  // (无尾斜杠)在 RR8 下不匹配 basename 会渲染空树——规范化为 /admin 后两种入口都命中。
  { basename: import.meta.env.BASE_URL.replace(/\/+$/, "") || "/" },
)
