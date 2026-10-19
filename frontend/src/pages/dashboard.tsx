import { useEffect, useState } from "react"
import { Link } from "react-router"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import SemanticBadge from "@/components/semantic-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useSession } from "@/lib/auth"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"
import { NAV } from "@/lib/nav"
import { useI18n } from "@/lib/i18n"

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

// 管理模块卡直接取 lib/nav.ts 单一事实源(此前与侧边栏两份手抄已漂移:#24),概览自身除外。
const MODULES = NAV.filter((item) => item.to !== "/")

/**
 * 管理后台概览：登录闭环 + 真实身份与 IDP 状态；外壳（侧栏/顶栏/命令面板）在模板 AppLayout。
 */
export default function DashboardPage() {
  const { t } = useI18n()
  const session = useSession()
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [discoveryFailed, setDiscoveryFailed] = useState(false)

  // IDP 状态：discovery 是公网同源端点，CSP（connect-src 'self'）放行，无需 BFF 代理，
  // 也没有会话语义——保持直取，不经 apiGet。
  useEffect(() => {
    fetchWithTimeout(
      "/.well-known/openid-configuration",
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
      async (response) => (response.ok ? ((await response.json()) as Discovery) : null),
    )
      .then((data) => {
        setDiscovery(data)
        setDiscoveryFailed(data === null)
      })
      .catch(() => setDiscoveryFailed(true))
  }, [])

  // 会话校验期间不渲染完整内容：未登录者会被守卫跳转到 /admin/login（BFF 挑战）。
  // 加载态必须与正式内容同锚点（顶部）：会话校验每次刷新都会跑，
  // 若垂直居中，内容出现时整块上跳约半屏，被当成布局故障上报（2026-10-01）。
  if (session.isPending) {
    return (
      <div role="status" aria-label={t("正在验证登录状态…")} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((card) => (
            <Card key={card}>
              <CardHeader className="space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-64" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((module) => <Skeleton key={module.to} className="h-20 w-full" />)}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (session.error || !session.data) {
    return <p role="alert" className="text-destructive">{t("会话服务异常，请刷新重试。")}</p>
  }

  const s = session.data
  const initial = s.displayName.slice(0, 1).toUpperCase()

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 身份卡：当前管理员会话（数据来自 BFF /admin/api/session） */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-base">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
                {initial}
              </span>
              {s.displayName}
            </CardTitle>
            <CardDescription>{s.email ?? t("未绑定邮箱")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {(s.roles && s.roles.length > 0 ? s.roles : [t("无角色")]).map((role) => (
                <Badge key={role} variant="secondary">{role}</Badge>
              ))}
            </div>
            <p className="text-muted-foreground">
              {t("身份标识：")}<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.subject}</code>
            </p>
            <p className="text-xs text-muted-foreground">{t("会话由 OIDC（admin-web · 授权码 + PKCE）签发，闲置 2 小时过期")}</p>
          </CardContent>
        </Card>

        {/* IDP 状态卡：discovery 实时数据（拉取失败时如实降级显示） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("IDP 状态")}</CardTitle>
            <CardDescription>
              {discovery ? (
                <span className="flex items-center gap-1.5">
                  <SemanticBadge variant="success">{t("在线 · {issuer}", { issuer: discovery.issuer })}</SemanticBadge>
                </span>
              ) : (
                <SemanticBadge variant="warning">{t("discovery 不可达")}</SemanticBadge>
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
              discoveryFailed && <p className="text-xs text-muted-foreground">{t("无法读取 /.well-known/openid-configuration。")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 管理模块卡:与侧边栏同源(lib/nav.ts),可点击直达。 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("管理模块")}</CardTitle>
          <CardDescription>{t("点击卡片进入对应模块；全部变更操作均记录管理审计")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module) => (
            <Card key={module.to} className="p-0 transition-colors hover:border-primary/40 hover:bg-muted/20">
              <Link to={module.to} className="block h-full rounded-lg p-4">
                <p className="text-sm font-medium">{t(module.label)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t(module.desc)}</p>
              </Link>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
