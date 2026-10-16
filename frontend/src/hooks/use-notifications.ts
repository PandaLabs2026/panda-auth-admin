import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 通知中心（v0.5.0）：内存 store + 轮询拉取的最小正典。真实接法=把 fetch 换成
 * BFF 的 /api/notifications（Envelope 契约），已读回写同理；UI 侧（铃铛/面板/页面）
 * 不变。通知属应用层数据：身份类消息（密码改登提醒等）归 IDP，勿塞这里。
 */
export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  /** ISO 时间。 */
  at: string;
  level: 'info' | 'success' | 'warning';
  read: boolean;
}

/** 演示数据源：真实应用替换为 useApiQuery('/api/notifications', { refetchInterval })。 */
const seed: AppNotification[] = [
  { id: 'n1', title: '系统维护通知', body: '本周六 02:00–03:00 例行维护，期间服务短暂不可用。', at: '2026-10-15T09:00:00Z', level: 'warning', read: false },
  { id: 'n2', title: '备份完成', body: '每日数据库备份已完成并通过结构校验。', at: '2026-10-15T03:12:00Z', level: 'success', read: false },
  { id: 'n3', title: '新成员加入', body: '一位新成员接受了邀请加入工作区。', at: '2026-10-14T11:30:00Z', level: 'info', read: true },
];

export interface NotificationsApi {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  markRead(id: string): void;
  markAllRead(): void;
}

export function useNotifications(): NotificationsApi {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // 首拉 + 30s 轮询(演示:数据静态;真实换成 useApiQuery 的 refetchInterval)
  const load = useCallback(() => {
    setItems(seed.map((n) => ({ ...n })));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  return { items, unread, loading, markRead, markAllRead };
}
