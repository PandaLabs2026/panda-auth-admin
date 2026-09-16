import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * 取令牌失败。单独立一个类型只为一件事：让 submit 的 catch 能区分
 * 「防伪链路断了」与「网络不通」。两者若共用一句「请稍后再试」，
 * 断链就会长期伪装成凭据/网络问题，见 fetchAntiforgeryToken 的注释。
 */
class AntiforgeryTokenError extends Error {}

/**
 * 取防伪令牌。
 *
 * 契约来自 BFF 的 `GET /admin/api/antiforgery`（Program.cs）：响应体是 JSON
 * `{ "token": "..." }`，令牌取自 `IAntiforgery.GetAndStoreTokens(context).RequestToken`；
 * 同一次调用还会下发防伪 Cookie（`.AspNetCore.Antiforgery.*`）——**两者必须成对**，
 * 服务端校验时用的正是「Cookie 里的令牌对 + 请求头里的令牌」，只取其一必然校验失败。
 * 请求头名由服务端 `AddAntiforgery(options => options.HeaderName = "X-XSRF-Token")` 指定。
 *
 * 注意取 Token 与用 Token 之间不能隔太久（令牌有有效期）；同一次提交里现取现用。
 */
async function fetchAntiforgeryToken(): Promise<string> {
  const response = await fetch("/admin/api/antiforgery", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!response.ok) throw new AntiforgeryTokenError(`HTTP ${response.status}`)
  const { token } = (await response.json()) as { token: string }
  return token
}

/**
 * 管理后台登录页。
 * Phase 0 为 UI 占位：POST /admin/api/auth/login 由 BFF 返回 501，
 * Phase 1 接入 PandaAuth Admin API（Argon2id 校验 + 会话 Cookie）。
 */
export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // 先取令牌再提交：Phase 1 服务端一旦启用校验，不带头即被拒；
      // 缺了这一步的失败形态是「登录永远失败」，但错误信息指向凭据，很难反查到防伪链路。
      const token = await fetchAntiforgeryToken()
      const response = await fetch("/admin/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-XSRF-Token": token,
        },
        body: JSON.stringify({ email, password }),
      })
      if (response.status === 501) {
        setError("登录能力将在 Phase 1 上线（管理 API 未实装）。")
      } else if (!response.ok) {
        setError("登录失败，请稍后再试。")
      }
    } catch (cause) {
      setError(
        cause instanceof AntiforgeryTokenError
          ? "安全令牌获取失败，请刷新页面后重试。"
          : "网络异常，请稍后再试。",
      )
    } finally {
      setSubmitting(false)
    }
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
            <CardDescription>仅限熊猫实验室管理员，Phase 1 实装认证。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@pandalabs.cc"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "登录中…" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
