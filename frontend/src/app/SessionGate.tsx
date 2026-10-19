import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import RequireAuth from "@/components/patterns/RequireAuth"
import { useSession } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession()
  const { t } = useI18n()
  if (session.isError) {
    return (
      <div className="flex flex-col items-start gap-3 pt-2" role="alert">
        <p>{t("会话服务异常，请刷新重试。")}</p>
        <Button variant="outline" onClick={() => void session.refetch()}>{t("重试")}</Button>
      </div>
    )
  }

  return <RequireAuth>{children}</RequireAuth>
}
