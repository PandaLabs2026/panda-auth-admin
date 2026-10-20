import { BellIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useNotifications } from "@/hooks/use-notifications"
import { useI18n } from "@/lib/i18n"

/** Application-owned presentation for the server's recent notification window. */
export default function AppNotificationBell() {
  const { items, unread, loading, error, markError, marking, retry, markAllRead } = useNotifications()
  const { t, locale } = useI18n()
  const formatTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? t("时间未知") : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  }
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" className="relative" aria-label={t("通知（最近 50 条中 {unread} 条未读）", { unread })}>
        <BellIcon />
        {unread > 0 && <span data-testid="notification-badge" className="absolute -right-1 -top-1 rounded-full bg-destructive px-1 text-xs text-destructive-foreground">{unread}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">{t("最近 50 条通知")}</p>
        <Button variant="ghost" size="sm" onClick={markAllRead} disabled={loading || !!error || marking || unread === 0}>{t(marking ? "正在标记已读" : "全部已读")}</Button>
      </div>
      <div className="max-h-72 overflow-y-auto p-3">
        {loading && <p role="status">{t("正在加载通知")}</p>}
        {error && <div><p role="alert">{error}</p><Button variant="outline" size="sm" onClick={retry}>{t("重试")}</Button></div>}
        {markError && <p role="alert">{markError}</p>}
        {!loading && !error && items.length === 0 && <p className="text-sm text-muted-foreground">{t("暂无通知")}</p>}
        <ul className="divide-y">{items.map((item) => <li key={item.id} className={item.read ? "py-2 text-sm opacity-60" : "py-2 text-sm"}>
          <p className="font-medium">{!item.read && <span aria-hidden>● </span>}{item.title}</p>
          {item.body && <p className="break-words text-xs text-muted-foreground">{item.body}</p>}
          <time dateTime={item.at} className="text-xs text-muted-foreground">{formatTime(item.at)}</time>
        </li>)}</ul>
      </div>
    </PopoverContent>
  </Popover>
}
