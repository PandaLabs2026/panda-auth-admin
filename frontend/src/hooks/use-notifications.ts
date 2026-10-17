import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend, AUDIT_ACTION } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * 通知中心 store（真实实现，模板 v0.5.0 契约的消费仓替换——模板自文档注明的接法：
 * 「把 fetch 换成 BFF 端点，UI 侧不变」）。数据源=server 通知中心（管理审计流派生，
 * server#49）：GET /admin/api/notifications（Id 倒序）+ 每管理员已读游标
 * GET/POST /admin/api/notifications/cursor。
 *
 * 已读语义=**水位线**（Id ≤ cursor 视为已读），因此 markAllRead=把游标推进到本页
 * 最新一条；markRead 保持模板 API 形态但仅本地乐观标记（单条回写会越过后面的未读，
 * 与水位语义冲突——面板 UI 也只提供「全部已读」）。
 * 通知属应用层数据：身份类消息（密码修改提醒等）归 IDP，勿塞这里。
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

/** server 契约（share AdminNotificationEntry；camelCase）。 */
type NotificationEntry = {
  id: number
  actorUserId: string
  actorUserName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: string | null
  ipAddress: string | null
  createdAt: string
}

type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number }

/** 危险/不可逆类动作给警示档；创建/恢复类给成功档；其余 info。 */
const WARNING_ACTIONS = new Set([
  'user.freeze', 'user.deactivate', 'user.revoke_tokens', 'user.reset_2fa', 'client.rotate_secret',
])
const SUCCESS_ACTIONS = new Set(['user.create', 'user.unfreeze', 'user.unlock'])

export interface NotificationsApi {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  markRead(id: string): void;
  markAllRead(): void;
}

export function useNotifications(): NotificationsApi {
  const { t } = useI18n();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<PageResult<NotificationEntry>>('/admin/api/notifications?pageSize=50'),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  })
  const cursor = useQuery({
    queryKey: ['notifications-cursor'],
    queryFn: () => apiGet<{ lastAuditId: number }>('/admin/api/notifications/cursor'),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  })

  const cursorId = cursor.data?.lastAuditId ?? 0

  const items = useMemo<AppNotification[]>(() => {
    if (!list.data) return []
    return list.data.items.map((entry) => ({
      id: String(entry.id),
      // 动作标题：zh 展示映射（lib/api AUDIT_ACTION 单源）经 t() 过 en 自然键；未知动作回退原文。
      title: t(AUDIT_ACTION[entry.action] ?? entry.action),
      // 主体=操作者与目标标识（标识符非文案，不进词典）。
      body: `${entry.actorUserName ?? entry.actorUserId} · ${entry.targetType ?? ''}:${entry.targetId ?? ''}`,
      at: entry.createdAt,
      level: WARNING_ACTIONS.has(entry.action) ? 'warning' : SUCCESS_ACTIONS.has(entry.action) ? 'success' : 'info',
      read: entry.id <= cursorId,
    }))
  }, [list.data, cursorId, t])

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items])

  const markRead = useCallback((id: string) => {
    // 水位语义下无单条回写：Bell UI 仅提供「全部已读」,本方法保留模板 API 形态为 no-op。
    void id
  }, [])

  const markAllRead = useCallback(() => {
    const maxId = items.reduce((max, n) => Math.max(max, Number(n.id)), 0)
    if (maxId <= cursorId) return
    // 游标写入单调不回退（server 校验）；成功后失效读侧,未读数即时归零。
    void apiSend<{ lastAuditId: number }>('POST', '/admin/api/notifications/cursor', { lastAuditId: maxId })
      .then(() => qc.invalidateQueries({ queryKey: ['notifications-cursor'] }))
      .catch(() => {
        // 失败静默：30s 轮询兜底重拉;错误不弹 toast(通知是辅助面,不抢操作反馈的注意力)。
      })
  }, [items, cursorId, qc])

  return { items, unread, loading: list.isPending || cursor.isPending, markRead, markAllRead }
}
