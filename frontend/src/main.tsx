import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import AuditPage from "@/pages/audit"
import ClientsPage from "@/pages/clients"
import DashboardPage from "@/pages/dashboard"
import LoginPage from "@/pages/login"
import UsersPage from "@/pages/users"

// 部署基路径 /admin/（Caddy 将 /admin/* 反代到本服务）。
// 认证由 BFF 兜底：各页在数据 401 时全页跳 /admin/login，未登录者直接访问
// 受保护路由只会看到一次跳转，而不是需要前端守卫的空白页。
const router = createBrowserRouter(
  [
    { path: "/", element: <DashboardPage /> },
    { path: "/login", element: <LoginPage /> },
    { path: "/users", element: <UsersPage /> },
    { path: "/clients", element: <ClientsPage /> },
    { path: "/audit", element: <AuditPage /> },
    { path: "*", element: <DashboardPage /> },
  ],
  { basename: "/admin" },
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
