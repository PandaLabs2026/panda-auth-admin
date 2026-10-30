import { useEffect, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router"

import AuthStatusPage from "@/components/patterns/auth/AuthStatusPage"
import { buttonVariants } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { adminAuthNavigation } from "@/lib/auth-lifecycle"

/**
 * 管理后台品牌登录页(由 BFF 的 SPA 回退承载,挑战端点在 /admin/challenge)。
 *
 * 登录走 OIDC 客户端流:本页不做任何凭据输入与提交,导航到 BFF 的挑战端点——
 * 302 到 IDP 授权端点(授权码 + PKCE),凭据校验发生在 IDP 的登录页。回到本站的路径是
 * `/admin/callback/login/pandaauth`:具备 admin 角色则建立会话并落到 returnUrl 或 `/admin/`,
 * 否则 403(角色门禁在 BFF 回调处强制,见 Program.cs)。
 *
 * 兼容旧登录链接中的 returnUrl 与 RequireAuth 回跳；后者经
 * location.state.from 传递。自动挑战复用共同导航防循环标记，
 * 保留回跳路径；直接访问、自动尝试受阻或带 error 到达时
 * 停在品牌页由用户显式点击,避免系统性故障下对 IDP 的自动重试。
 *
 * 刻意**不**用 XHR 发起:挑战是一次跨站重定向流(本站 → IDP → 本站),
 * fetch 不跟随跨站表单/重定向链,全页导航是唯一正确形态(me 仓同款)。
 */
export default function LoginPage() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const stateFrom: unknown = (location.state as { from?: unknown } | null)?.from
  const duplicateReturnUrl = searchParams.getAll("returnUrl").length > 1
  // The BFF owns destination validation. Ambiguous duplicate parameters use home.
  const returnUrl = duplicateReturnUrl ? "" : searchParams.get("returnUrl") ??
    (typeof stateFrom === "string" && stateFrom.startsWith("/") ? stateFrom : "")
  const target = returnUrl || adminAuthNavigation.home
  const failed = searchParams.has("error") || duplicateReturnUrl
  const attempted = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!returnUrl || failed || attempted.current) return
    attempted.current = true
    const started = adminAuthNavigation.start(returnUrl)
    setLeaving(started)
    setBlocked(!started)
  }, [returnUrl, failed])

  const title = leaving ? "正在前往登录…" : failed || blocked ? "登录未完成" : "管理后台登录"
  const description = leaving ? "正在前往统一身份认证，如未跳转请使用下方链接。" :
    failed || blocked ? "本次登录未完成，请明确选择后续操作。" : "仅限熊猫实验室管理员，使用 PandaAuth 账号登录。"

  return (
    <AuthStatusPage
      title={t(title)}
      description={t(description)}
      busy={leaving}
      brand={<img src="/admin/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain object-left" />}
    >
      <a href={adminAuthNavigation.href(target)} className={buttonVariants()} onClick={(event) => {
        event.preventDefault()
        const started = adminAuthNavigation.start(target, true)
        setLeaving(started)
        setBlocked(!started)
      }}>{t("继续登录")}</a>
    </AuthStatusPage>
  )
}
