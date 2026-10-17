import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useNotifications } from './use-notifications'
import { I18nProvider } from '@/lib/i18n'
import { i18nConfig } from '@/i18n/config'

// 通知 store 契约（真实实现）:列表/游标双查询、未读=Id>游标计数、全部已读=游标推进
// (防伪两跳 POST + 游标失效重拉)、单条已读为 no-op(水位语义)。

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const entries = [
  { id: 3, actorUserId: 'a1', actorUserName: 'admin', action: 'user.freeze', targetType: 'user', targetId: 'u-3', detail: null, ipAddress: null, createdAt: '2026-10-17T01:00:00Z' },
  { id: 2, actorUserId: 'a1', actorUserName: 'admin', action: 'user.create', targetType: 'user', targetId: 'u-2', detail: null, ipAddress: null, createdAt: '2026-10-17T00:00:00Z' },
  { id: 1, actorUserId: 'a2', actorUserName: 'ops', action: 'client.rotate_secret', targetType: 'client', targetId: 'me-web', detail: null, ipAddress: null, createdAt: '2026-10-16T23:00:00Z' },
]

function stub(cursor: number) {
  return vi.fn((path: string) => {
    if (path.startsWith('/admin/api/notifications/cursor')) return Promise.resolve(json({ lastAuditId: cursor }))
    if (path.startsWith('/admin/api/notifications')) return Promise.resolve(json({ items: entries, total: 3, page: 1, pageSize: 50 }))
    if (path === '/admin/api/antiforgery') return Promise.resolve(json({ token: 'csrf-token' }))
    return Promise.reject(new Error(`unexpected request: ${path}`))
  })
}

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider config={i18nConfig}>{children}</I18nProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useNotifications', () => {
  test('拉取审计派生列表,未读 = Id 大于游标的条数,标题走动作映射', async () => {
    const fetchMock = stub(1)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNotifications(), { wrapper: wrap() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(3)
    expect(result.current.unread).toBe(2) // id 3、2 > 游标 1
    // 标题:动作 zh 映射(AUDIT_ACTION 单源);等级:冻结=warning、建号=success。
    expect(result.current.items[0].title).toBe('冻结用户')
    expect(result.current.items[0].level).toBe('warning')
    expect(result.current.items[1].level).toBe('success')
    expect(result.current.items.every((n) => (n.read ? Number(n.id) <= 1 : Number(n.id) > 1))).toBe(true)
  })

  test('全部已读:游标推进到最新 Id(防伪两跳)并失效重拉,未读归零', async () => {
    let cursor = 1
    const base = vi.fn((path: string) => {
      if (path.startsWith('/admin/api/notifications/cursor')) return Promise.resolve(json({ lastAuditId: cursor }))
      if (path.startsWith('/admin/api/notifications')) return Promise.resolve(json({ items: entries, total: 3, page: 1, pageSize: 50 }))
      if (path === '/admin/api/antiforgery') return Promise.resolve(json({ token: 'csrf-token' }))
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })
    // POST 成功后把桩内游标推到 3,模拟服务端单调不回退后失效重拉读到的状态。
    const wrapped = vi.fn((path: string, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === 'POST' && path.includes('cursor')) cursor = 3
      return base(path)
    })
    vi.stubGlobal('fetch', wrapped)

    const { result } = renderHook(() => useNotifications(), { wrapper: wrap() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.unread).toBe(2)

    act(() => result.current.markAllRead())
    await waitFor(() => expect(result.current.unread).toBe(0))
    // 游标写入打到 BFF 端点且带 method。
    expect(wrapped.mock.calls.some(([p, i]) => p === '/admin/api/notifications/cursor' && (i as RequestInit).method === 'POST')).toBe(true)
  })

  test('单条已读为 no-op(水位语义,不回写)', async () => {
    const fetchMock = stub(0)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNotifications(), { wrapper: wrap() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current.unread
    act(() => result.current.markRead('2'))
    expect(result.current.unread).toBe(before)
  })
})
