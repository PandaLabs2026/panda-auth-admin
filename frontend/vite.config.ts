import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 对齐 panda-webapp 模式：构建产物直接落到 .NET BFF 的 wwwroot/admin。
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(dirname, "./src") },
  },
  build: {
    outDir: "../src/PandaAuth.Admin/wwwroot/admin",
    emptyOutDir: true,
  },
  server: {
    port: 5171,
    // 只代理 BFF 服务端路由（与 me 仓同款约束）：代理整个 /admin 前缀会让 Vite
    // 把 SPA 静态资源也转给后端，dev server 的 HMR 与本地资源全部失效；
    // 新增 BFF 路由（如 /admin/logout 页面）须同步补到这里。
    proxy: {
      "/admin/api": "http://localhost:9006",
      "/admin/login": "http://localhost:9006",
      "/admin/callback": "http://localhost:9006",
      "/admin/healthz": "http://localhost:9006",
    },
  },
})
