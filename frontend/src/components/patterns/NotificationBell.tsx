import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/use-notifications';

/**
 * 通知铃铛（v0.5.0）：header 常驻入口。与通知中心页共用同一 store 约定
 * （useNotifications）；本组件自带实例,页面级中心用 hook 自取数据。
 */
export default function NotificationBell() {
  const { items, unread, markAllRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`通知（${unread} 条未读）`}>
          <BellIcon />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] leading-none"
              data-testid="notification-badge"
            >
              {unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">通知</p>
          <Button variant="ghost" size="sm" onClick={markAllRead} disabled={unread === 0}>
            <CheckCheckIcon /> 全部已读
          </Button>
        </div>
        <ScrollArea className="h-72">
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id} className={n.read ? 'px-3 py-2.5 text-sm opacity-60' : 'px-3 py-2.5 text-sm'}>
                <p className="flex items-center gap-2 font-medium">
                  {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                  {n.title}
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{n.at}</p>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
