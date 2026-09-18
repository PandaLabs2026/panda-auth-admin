import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import DashboardPage from "@/pages/dashboard"
import LoginPage from "@/pages/login"

// 部署基路径 /admin/（Caddy 将 /admin/* 反代到本服务）。
// 认证由 BFF 兜底：Dashboard 自己在会话查询 401 时全页跳 /admin/login，
// 未登录者直接访问受保护路由只会看到一次跳转，而不是需要前端守卫的空白页。
const router = createBrowserRouter(
  [
    { path: "/", element: <DashboardPage /> },
    { path: "/login", element: <LoginPage /> },
    { path: "*", element: <DashboardPage /> },
  ],
  { basename: "/admin" },
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
