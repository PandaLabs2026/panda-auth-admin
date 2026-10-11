import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * 管理后台品牌登录页(由 BFF 的 SPA 回退承载,挑战端点在 /admin/challenge)。
 *
 * 登录走 OIDC 客户端流:本页不做任何凭据输入与提交,导航到 BFF 的挑战端点——
 * 302 到 IDP 授权端点(授权码 + PKCE),凭据校验发生在 IDP 的登录页。回到本站的路径是
 * `/admin/callback/login/pandaauth`:具备 admin 角色则建立会话并落到 returnUrl 或 `/admin/`,
 * 否则 403(角色门禁在 BFF 回调处强制,见 Program.cs)。
 *
 * 带 returnUrl 到达(api 层 401 重登的最常见形态)时自动发起挑战,免一次点击、
 * 保持「会话过期 → 重登 → 回原页」的无缝体验;直接访问或带 error 到达(异常路径)时
 * 停在品牌页由用户显式点击,避免系统性故障下对 IDP 的自动重试。
 *
 * 刻意**不**用 XHR 发起:挑战是一次跨站重定向流(本站 → IDP → 本站),
 * fetch 不跟随跨站表单/重定向链,全页导航是唯一正确形态(me 仓同款)。
 */
export default function LoginPage() {
  const [searchParams] = useSearchParams()
  // returnUrl 原样透传:消费点是 BFF 挑战端点的 LoginReturnUrl 白名单,
  // 前端不做二次校验(校验语义只有一处,服务端兜住全部入口)。
  const returnUrl = searchParams.get("returnUrl") ?? ""
  const hasError = searchParams.has("error")
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (returnUrl && !hasError) {
      setLeaving(true)
      window.location.assign(`/admin/challenge?returnUrl=${encodeURIComponent(returnUrl)}`)
    }
  }, [returnUrl, hasError])

  const startLogin = () => {
    setLeaving(true)
    window.location.assign(
      returnUrl
        ? `/admin/challenge?returnUrl=${encodeURIComponent(returnUrl)}`
        : "/admin/challenge",
    )
  }

  return (
    <div className="flex min-h-screen">
      <aside className="login-brand-panel relative hidden flex-1 items-end overflow-hidden p-10 text-white lg:flex">
        <div className="login-bamboo absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <p className="flex items-center gap-3 text-3xl font-bold tracking-wide">
            <img src="/admin/apple-touch-icon.png" alt="" className="h-10 w-10 rounded-lg" />
            PandaAuth
          </p>
          <p className="mt-3 max-w-md text-sm opacity-90">
            熊猫实验室统一身份认证中台。一次登录，全生态通行。
          </p>
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-lg text-primary">管理后台登录</CardTitle>
            <CardDescription>仅限熊猫实验室管理员，使用 PandaAuth 账号登录。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {hasError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                登录未完成，请重试；若持续出现请联系管理员。
              </p>
            )}
            <Button className="w-full" disabled={leaving} onClick={startLogin}>
              {leaving ? "正在前往登录…" : "使用 PandaAuth 登录"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
