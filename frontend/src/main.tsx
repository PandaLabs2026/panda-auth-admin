import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { RouterProvider } from "react-router/dom"
// Tailwind v4 入口（含 shadcn 设计令牌 + typeset 排版层）。骨架时代起就漏了这行 import——
// 构建因此从不产出 CSS 文件，整个管理台一直以无样式形态运行（2026-09-19 才定位）。
import "./style.css"
import { i18nConfig } from "@/i18n/config"
import { I18nProvider } from "@/lib/i18n"
import ErrorBoundary from "@/components/patterns/ErrorBoundary"
import { router } from "@/app/router"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider config={i18nConfig}>
          <RouterProvider router={router} />
        </I18nProvider>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
