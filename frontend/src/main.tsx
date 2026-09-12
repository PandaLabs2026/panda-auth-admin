import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import LoginPage from "@/pages/login"

// 部署基路径 /admin/（Caddy 将 /admin/* 反代到本服务）。
const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    { path: "*", element: <LoginPage /> },
  ],
  { basename: "/admin" },
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
