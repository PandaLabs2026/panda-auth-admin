import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { USER_STATUS, apiGet, apiSend, type PageResult, type UserDetail, type UserSummary } from "@/lib/api"

/** 当前会话主体：用于在列表里隐藏「自己」的重置按钮（server 侧另有硬门禁）。 */
type Me = { subject: string }

/**
 * 用户管理（0.3）：列表/搜索/详情/冻结解冻/重置密码。
 * 冻结与重置都会使该用户的全部令牌立即失效（server 侧联动批量吊销）。
 */
export default function UsersPage() {
  const [result, setResult] = useState<PageResult<UserSummary> | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [newPassword, setNewPassword] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const pageSize = 20

  useEffect(() => {
    // 静默获取：401 时 apiGet 自会跳登录，这里不额外处理。
    apiGet<Me>("/admin/api/session").then(setMe).catch(() => setMe(null))
  }, [])

  const load = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (query.trim()) params.set("query", query.trim())
      if (status) params.set("status", status)
      setResult(await apiGet<PageResult<UserSummary>>(`/admin/api/users?${params}`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败")
    }
  }, [page, query, status])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(id: string) {
    try {
      setNewPassword(null)
      setDetail(await apiGet<UserDetail>(`/admin/api/users/${id}`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "详情加载失败")
    }
  }

  async function toggleFreeze(user: UserSummary) {
    const verb = user.status === 1 ? "解冻" : "冻结"
    if (!window.confirm(`确认${verb}用户 ${user.userName}？${verb === "冻结" ? "其全部登录令牌将立即失效。" : ""}`)) return
    setBusy(true)
    try {
      await apiSend("POST", `/admin/api/users/${user.id}/status`, { status: user.status === 1 ? 0 : 1 })
      await load()
      if (detail?.id === user.id) await openDetail(user.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${verb}失败`)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(user: UserSummary) {
    if (!window.confirm(`为用户 ${user.userName} 生成新密码？当前密码将失效，其所有会话将被强制下线。`)) return
    setBusy(true)
    try {
      const response = await apiSend<{ password: string }>("POST", `/admin/api/users/${user.id}/reset-password`, {})
      setNewPassword(response.password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重置失败")
    } finally {
      setBusy(false)
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="query">搜索（用户名 / 邮箱）</Label>
          <Input
            id="query"
            className="w-64"
            value={query}
            onChange={(event) => {
              setPage(1)
              setQuery(event.target.value)
            }}
            placeholder="输入即搜索"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">状态</Label>
          <select
            id="status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => {
              setPage(1)
              setStatus(event.target.value)
            }}
          >
            <option value="">全部</option>
            <option value="0">正常</option>
            <option value="1">已冻结</option>
            <option value="2">已注销</option>
          </select>
        </div>
        {result && <span className="pb-2 text-sm text-muted-foreground">共 {result.total} 个账号</span>}
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">用户名</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(result?.items ?? []).map((user) => (
                <tr key={user.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="cursor-pointer px-4 py-3 font-medium" onClick={() => void openDetail(user.id)}>
                    {user.userName}
                    {user.nickname ? <span className="ml-2 text-xs text-muted-foreground">{user.nickname}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        user.status === 0
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : user.status === 1
                            ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {USER_STATUS[user.status] ?? user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(user.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="space-x-2 px-4 py-3 text-right">
                    {/* 自己那一行不提供冻结/重置（server 侧另有硬门禁）：两个操作都会把当前管理会话锁在门外 */}
                    {me?.subject !== user.id && (
                      <>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggleFreeze(user)}>
                          {user.status === 1 ? "解冻" : "冻结"}
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void resetPassword(user)}>
                          重置密码
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {result && result.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    没有匹配的账号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          第 {page} / {totalPages} 页
        </span>
        <div className="space-x-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            上一页
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
            下一页
          </Button>
        </div>
      </div>

      {newPassword && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/50">
          <CardHeader>
            <CardTitle className="text-sm text-amber-800 dark:text-amber-300">新密码（仅显示这一次）</CardTitle>
            <CardDescription>请立即复制并安全送达用户；服务端只保留哈希，无法再次取出。</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="rounded bg-white px-3 py-2 font-mono text-base dark:bg-muted">{newPassword}</code>
          </CardContent>
        </Card>
      )}

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">账号详情 · {detail.userName}</CardTitle>
            <CardDescription>
              {detail.email ?? "未绑定邮箱"} · {detail.roles.length > 0 ? detail.roles.join("、") : "无角色"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <p>状态：{USER_STATUS[detail.status] ?? detail.status}</p>
            <p>注册渠道：{["密码", "短信", "邮箱"][detail.registerChannel] ?? detail.registerChannel}</p>
            <p>邮箱已验证：{detail.emailConfirmed ? "是" : "否"}</p>
            <p>两步验证：{detail.twoFactorEnabled ? "已启用" : "未启用"}</p>
            <p>锁定至：{detail.lockoutEnd ? new Date(detail.lockoutEnd).toLocaleString("zh-CN") : "—"}</p>
            <p>连续失败：{detail.accessFailedCount} 次</p>
            <p>创建：{new Date(detail.createdAt).toLocaleString("zh-CN")}</p>
            <p>更新：{new Date(detail.updatedAt).toLocaleString("zh-CN")}</p>
            <p className="sm:col-span-2">
              身份标识：<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detail.id}</code>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
