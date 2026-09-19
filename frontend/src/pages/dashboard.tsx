import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Session = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
}

/**
 * 登出：先取防伪令牌（`GET /admin/api/antiforgery` 会同时下发配套 Cookie，两者成对校验），
 * 再 `POST /admin/api/logout`。BFF 会先撤销 IDP 侧令牌（尽力而为）再清本地会话，
 * 最后把浏览器带到 IDP 的 end-session 端点完成单点登出——该 POST 本身就是一次重定向流，
 * 因此这里不等响应体，直接把窗口交给后端接管。
 */
async function logout() {
  const response = await fetch("/admin/api/antiforgery", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  const { token } = (await response.json()) as { token: string }
  await fetch("/admin/api/logout", {
    method: "POST",
    headers: { "X-XSRF-Token": token, "X-Requested-With": "XMLHttpRequest" },
  })
  window.location.assign("/admin/login")
}

/**
 * 管理后台主页（0.2 登录闭环的最小形态）：展示当前管理员身份。
 * 用户管理 / 客户端管理 / 审计查询在 0.3 实装（对应 share 契约先行）。
 */
export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/admin/api/session", { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(async (response) => {
        // 未登录 → 全页跳登录挑战端点（SPA 路由之外，见 login.tsx 注释）。
        if (response.status === 401) {
          window.location.assign("/admin/login")
          return null
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as Session
      })
      .then((data) => data && setSession(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  // 会话校验期间不渲染完整外壳：未登录者会被立刻全页跳转到 /admin/login（BFF 挑战），
  // 完整骨架闪现即走曾是首屏观感差的主因（2026-09-19 用户反馈）——加载态只给一枚居中品牌标。
  if (loading && !session && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <img src="/admin/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-xl animate-pulse" />
          <span className="text-sm text-muted-foreground">正在验证登录状态…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 font-bold text-primary">
            <img src="/admin/apple-touch-icon.png" alt="" className="h-6 w-6 rounded-md" />
            PandaAuth 管理后台
          </span>
          {session && (
            <Button variant="outline" size="sm" onClick={logout}>
              退出登录
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {error && <p className="text-destructive">会话服务异常，请刷新重试。</p>}
        {session && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{session.nickname ?? session.name ?? session.subject}</CardTitle>
                <CardDescription>
                  {session.email ?? "未绑定邮箱"} · {session.roles.length > 0 ? session.roles.join("、") : "无角色"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                身份标识：<code>{session.subject}</code>
              </CardContent>
            </Card>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {["用户管理", "客户端管理", "审计查询"].map((title) => (
                <Card key={title}>
                  <CardHeader>
                    <CardTitle className="text-sm">{title}</CardTitle>
                    <CardDescription>0.3 实装</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
