import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import GrantDialogHost from "@/components/grant-dialog-host"
import RequireAuth from "@/components/patterns/RequireAuth"
import { useSession } from "@/lib/auth"
import { apiGet, type MfaCapability } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

/**
 * 会话门：会话异常 → 重试；未登录 → RequireAuth 走登录；
 * 已登录但操作者未绑定 TOTP → 绑定引导门（Passkey 退役后未绑定不得取得管理能力，
 * AUTH-DELIVERY-002——IDP admin-api 主策略会拒绝全部管理请求，这里给明确出口）。
 * 同时挂载操作授权对话框宿主：高风险操作 403 授权标记 → 页内 TOTP(+密码) 验证 → 带头重放。
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession()
  const { t } = useI18n()
  const capability = useQuery({
    queryKey: ["mfa-capability", session.data?.subject],
    enabled: session.isSuccess && Boolean(session.data),
    queryFn: () => apiGet<MfaCapability>("/admin/api/mfa/capability"),
    staleTime: 60_000,
    retry: false,
    // 能力探针失败不阻断界面：旧版 server 无此端点时按已绑定降级，管理请求失败由错误路径展示。
    throwOnError: false,
  })

  if (session.isError) {
    return (
      <div className="flex flex-col items-start gap-3 pt-2" role="alert">
        <p>{t("会话服务异常，请刷新重试。")}</p>
        <Button variant="outline" onClick={() => void session.refetch()}>{t("重试")}</Button>
      </div>
    )
  }

  if (session.isSuccess && capability.isSuccess && capability.data?.totpBound === false) {
    return (
      <div className="flex flex-col items-start gap-3 pt-2" role="alert">
        <p className="font-medium">{t("请先绑定 TOTP 验证器")}</p>
        <p className="text-sm text-muted-foreground">
          {t("管理员须以密码＋TOTP 使用管理台；绑定前管理操作不可用。完成绑定后返回本页继续。")}
        </p>
        <Button asChild>
          <a href="/account/mfa?returnUrl=/admin/">{t("前往绑定 TOTP")}</a>
        </Button>
      </div>
    )
  }

  return (
    <RequireAuth>
      {children}
      <GrantDialogHost />
    </RequireAuth>
  )
}
