import { useEffect, useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Session = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
}

/** OIDC discovery 的常用子集（公网同源端点 /.well-known/openid-configuration，无凭据）。 */
type Discovery = {
  issuer: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  introspection_endpoint?: string
  revocation_endpoint?: string
  jwks_uri?: string
  scopes_supported?: string[]
  grant_types_supported?: string[]
  code_challenge_methods_supported?: string[]
}

/** 管理模块能力说明（首页预告卡）。 */
const MODULES = [
  { id: "users", label: "用户管理", desc: "建号 / 角色 / 冻结 / 解锁 / 资料 / 2FA / 注销 / 重置密码" },
  { id: "clients", label: "客户端管理", desc: "回调白名单 / scope / 密钥轮换" },
  { id: "audit", label: "审计查询", desc: "登录日志与管理操作日志（只读）" },
] as const

/**
 * 管理后台概览：登录闭环 + 真实身份与 IDP 状态；外壳（侧边栏/顶栏/登出）在 AppShell。
 */
export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
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

    // IDP 状态：discovery 是公网同源端点，CSP（connect-src 'self'）放行，无需 BFF 代理。
    fetch("/.well-known/openid-configuration", { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(async (response) => (response.ok ? ((await response.json()) as Discovery) : null))
      .then((data) => setDiscovery(data))
      .catch(() => setDiscovery(null))
  }, [])

  // 会话校验期间不渲染完整内容：未登录者会被立刻全页跳转到 /admin/login（BFF 挑战）。
  if (loading && !session && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/admin/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-xl animate-pulse" />
          <span className="text-sm text-muted-foreground">正在验证登录状态…</span>
        </div>
      </div>
    )
  }

  const displayName = session?.nickname ?? session?.name ?? session?.subject ?? "管理员"
  const initial = displayName.slice(0, 1).toUpperCase()

  return (
    <div className="space-y-6">
      {error && <p className="text-destructive">会话服务异常，请刷新重试。</p>}
      {session && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* 身份卡：当前管理员会话（数据来自 BFF /admin/api/session） */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
                  {initial}
                </span>
                {displayName}
              </CardTitle>
              <CardDescription>{session.email ?? "未绑定邮箱"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {(session.roles.length > 0 ? session.roles : ["无角色"]).map((role) => (
                  <span key={role} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {role}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground">
                身份标识：<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{session.subject}</code>
              </p>
              <p className="text-xs text-muted-foreground">会话由 OIDC（admin-web · 授权码 + PKCE）签发，闲置 2 小时过期</p>
            </CardContent>
          </Card>

          {/* IDP 状态卡：discovery 实时数据（拉取失败时如实降级显示） */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">IDP 状态</CardTitle>
              <CardDescription>
                {discovery ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    在线 · {discovery.issuer}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                    discovery 不可达
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {discovery ? (
                <dl className="space-y-2 text-xs">
                  {(
                    [
                      ["authorize", discovery.authorization_endpoint],
                      ["token", discovery.token_endpoint],
                      ["userinfo", discovery.userinfo_endpoint],
                      ["end_session", discovery.end_session_endpoint],
                      ["revocation", discovery.revocation_endpoint],
                    ] as const
                  )
                    .filter(([, path]) => Boolean(path))
                    .map(([label, path]) => (
                      <div key={label} className="flex items-baseline gap-2">
                        <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 truncate font-mono" title={path}>
                          {path}
                        </dd>
                      </div>
                    ))}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(discovery.scopes_supported ?? []).map((scope) => (
                      <span key={scope} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                        {scope}
                      </span>
                    ))}
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">无法读取 /.well-known/openid-configuration。</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 管理模块预告：与侧边栏同源定义 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">管理模块</CardTitle>
          <CardDescription>点击侧边栏进入对应模块；全部变更操作均记录管理审计</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {MODULES.map((module) => (
            <div key={module.id} className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">{module.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{module.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
