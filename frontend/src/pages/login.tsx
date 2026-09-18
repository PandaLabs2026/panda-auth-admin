import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * 管理后台登录页。
 *
 * 登录走 OIDC 客户端流（元仓 ADR 2026-09-18）：本页不做任何凭据输入与提交，
 * 点击按钮即全页导航到 BFF 的 `GET /admin/login`——那是认证挑战端点，302 到 IDP
 * 授权端点（授权码 + PKCE），凭据校验发生在 IDP 的登录页。回到本站的路径是
 * `/admin/callback/login/pandaauth`：具备 admin 角色则建立会话并落到 `/admin/`，
 * 否则 403（角色门禁在 BFF 回调处强制，见 Program.cs）。
 *
 * 刻意**不**用 XHR 发起：挑战是一次跨站重定向流（本站 → IDP → 本站），
 * fetch 不跟随跨站表单/重定向链，全页导航是唯一正确形态（me 仓同款）。
 */
export default function LoginPage() {
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
          <CardContent>
            <Button
              className="w-full"
              // 全页导航（非 SPA 路由）：目标在 React Router 的 basename 之外。
              onClick={() => window.location.assign("/admin/login")}
            >
              使用 PandaAuth 登录
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
