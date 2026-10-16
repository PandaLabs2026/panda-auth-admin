import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 应用版本锚点(git describe):注入页脚供 drift 肉眼自查(模板 v0.2 起的约定)。
const appVersion = (() => {
  try {
    return execSync("git describe --tags --always --dirty", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return "unversioned"
  }
})()

// 对齐 panda-webapp 模式：构建产物直接落到 .NET BFF 的 wwwroot/admin。
export default defineConfig({
  base: "/admin/",
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(dirname, "./src") },
  },
  build: {
    outDir: "../src/PandaAuth.Admin/wwwroot/admin",
    emptyOutDir: true,
    // vendor 分包:框架/组件库/数据层各自成 chunk(模板 v0.2 起的约定,vite 8 要求函数形式)。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "react"
          if (id.includes("radix-ui") || id.includes("cmdk")) return "radix"
          if (id.includes("@tanstack")) return "tanstack"
          return undefined
        },
      },
    },
  },
  server: {
    port: 5171,
    // 只代理 BFF 服务端路由（与 me 仓同款约束）：代理整个 /admin 前缀会让 Vite
    // 把 SPA 静态资源也转给后端，dev server 的 HMR 与本地资源全部失效；
    // 新增 BFF 路由须同步补到这里（/admin/login 是 SPA 品牌登录页，由 Vite 自服务）。
    proxy: {
      "/admin/api": "http://localhost:9006",
      "/admin/challenge": "http://localhost:9006",
      "/admin/callback": "http://localhost:9006",
      "/admin/healthz": "http://localhost:9006",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
    // threads 池启动成本远低于默认 forks(模板/fleet-admin 先例)。
    pool: "threads",
  },
})
