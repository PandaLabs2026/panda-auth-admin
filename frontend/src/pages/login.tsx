import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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
      const response = await fetch("/admin/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ email, password }),
      })
      if (response.status === 501) {
        setError("登录能力将在 Phase 1 上线（管理 API 未实装）。")
      } else if (!response.ok) {
        setError("登录失败，请稍后再试。")
      }
    } catch {
      setError("网络异常，请稍后再试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="login-brand-panel relative hidden flex-1 items-end overflow-hidden p-10 text-white lg:flex">
        <div className="login-bamboo absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <p className="text-3xl font-bold tracking-wide">🐼 PandaAuth</p>
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
                  placeholder="admin@pandalabs.cn"
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
