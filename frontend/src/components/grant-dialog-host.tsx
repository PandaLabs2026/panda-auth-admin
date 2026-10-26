import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiSend } from "@/lib/api"
import { currentGrant, rejectGrant, resolveGrant, subscribeGrantDialog, type GrantInfo } from "@/lib/grant-flow"
import { useI18n } from "@/lib/i18n"

/**
 * 操作授权对话框宿主（AUTH-DELIVERY-002）：单实例挂在 SessionGate 内。
 * apiSend 命中 403 授权标记时挂起原请求并打开本对话框；验证 TOTP(+密码)
 * → POST /admin/api/mfa-grants 签发 → resolveGrant(grantId) → 原请求带授权头重放。
 * 页面层无需感知：它们看到的仍是同一次调用的最终结果。
 */
export default function GrantDialogHost() {
  const [grant, setGrant] = useState<GrantInfo | null>(currentGrant)
  useEffect(() => subscribeGrantDialog(setGrant), [])
  const { t } = useI18n()
  const [totpCode, setTotpCode] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close() {
    setTotpCode("")
    setPassword("")
    setError(null)
    rejectGrant(new Error(t("操作已取消：该操作需要先完成验证。")))
  }

  async function confirm() {
    if (!grant) return
    setBusy(true)
    setError(null)
    try {
      const issued = await apiSend<{ grantId: string }>("POST", "/admin/api/mfa-grants", {
        operation: grant.operation,
        targetId: grant.targetId,
        parameters: grant.parameters,
        totpCode,
        currentPassword: grant.passwordRequired ? password : undefined,
      })
      setTotpCode("")
      setPassword("")
      resolveGrant(issued.grantId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={grant !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("操作验证")}</DialogTitle>
          <DialogDescription>
            {grant?.passwordRequired
              ? t("该操作需要验证当前认证器验证码与登录密码，授权仅本次有效。")
              : t("该操作需要验证当前认证器验证码，授权仅本次有效。")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="grant-totp-code">{t("输入认证器 6 位验证码")}</Label>
            <Input
              id="grant-totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
            />
          </div>
          {grant?.passwordRequired && (
            <div className="space-y-1">
              <Label htmlFor="grant-password">{t("当前密码")}</Label>
              <Input
                id="grant-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            {t("取消")}
          </Button>
          <Button
            size="sm"
            disabled={busy || totpCode.length !== 6 || (grant?.passwordRequired === true && password.length === 0)}
            onClick={() => void confirm()}
          >
            {busy ? t("验证中…") : t("验证并继续")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
