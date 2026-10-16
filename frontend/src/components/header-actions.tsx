import { KeyRoundIcon, LanguagesIcon, ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

/**
 * 顶栏右侧常驻件（AppLayout headerActions 插槽）：返回门户 / 修改密码 / 语言切换。
 * 修改密码与门户是 IDP/门户页面，保持整页跳转；语言切换为纯 SPA 状态。
 */
export default function HeaderActions() {
  const { t, locale, setLocale } = useI18n()
  const { data: session } = useSession()
  return (
    <>
      {session?.portalHomeUrl && (
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
          <a href={session.portalHomeUrl}>
            <ExternalLinkIcon />
            {t("返回熊猫门户")}
          </a>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
        <a href="/account/change-password?returnUrl=/admin">
          <KeyRoundIcon />
          {t("修改密码")}
        </a>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-label={t("切换语言")}
        onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
      >
        <LanguagesIcon />
        {locale === "zh-CN" ? "EN" : "中文"}
      </Button>
    </>
  )
}
