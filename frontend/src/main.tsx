import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import AppShell from "@/components/app-shell"
import AuditPage from "@/pages/audit"
import ClientsPage from "@/pages/clients"
import DashboardPage from "@/pages/dashboard"
import LoginPage from "@/pages/login"
import UsersPage from "@/pages/users"
// Tailwind v4 入口（含 shadcn 设计令牌）。骨架时代起就漏了这行 import——
// 构建因此从不产出 CSS 文件，整个管理台一直以无样式形态运行（2026-09-19 才定位）。
import "./index.css"

// 部署基路径 /admin/（Caddy 将 /admin/* 反代到本服务）。
// 认证由 BFF 兜底：各页在数据 401 时全页跳 /admin/login，未登录者直接访问
// 受保护路由只会看到一次跳转，而不是需要前端守卫的空白页。
// AppShell 为 layout route：侧边栏/顶栏/登出常驻，路由切换只替换内容区。
const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { path: "/", element: <DashboardPage /> },
        { path: "/users", element: <UsersPage /> },
        { path: "/clients", element: <ClientsPage /> },
        { path: "/audit", element: <AuditPage /> },
        { path: "*", element: <DashboardPage /> },
      ],
    },
    { path: "/login", element: <LoginPage /> },
  ],
  { basename: "/admin" },
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
