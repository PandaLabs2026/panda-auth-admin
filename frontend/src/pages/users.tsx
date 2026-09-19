import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  REGISTER_CHANNEL,
  USER_STATUS,
  apiGet,
  apiSend,
  type CreateUserResponse,
  type PageResult,
  type UserDetail,
  type UserSummary,
} from "@/lib/api"

/** 当前会话主体：用于在列表和详情里隐藏「对自己」的危险操作（server 侧另有硬门禁）。 */
type Me = { subject: string }

/** 与 share 的 PandaAuthUser.AdminRole 对应；当前产品只有这一个角色，UI 做成开关语义。 */
const ADMIN_ROLE = "admin"

/** 建号表单草稿：初始密码留空 = 服务端生成（明文仅返回一次）。 */
type CreateDraft = {
  userName: string
  email: string
  nickname: string
  region: string
  password: string
  grantAdminRole: boolean
}

const EMPTY_CREATE: CreateDraft = { userName: "", email: "", nickname: "", region: "", password: "", grantAdminRole: false }

/** 详情是否处于需要解锁的状态（存在未过期的 LockoutEnd，或失败计数未清）。 */
function isLocked(detail: UserDetail): boolean {
  return (detail.lockoutEnd !== null && new Date(detail.lockoutEnd).getTime() > Date.now()) || detail.accessFailedCount > 0
}

/**
 * 用户管理（0.4）：列表/搜索/详情/建号/角色/冻结解冻/解锁/资料/2FA/注销/重置密码。
 * 冻结、重置、角色变更、注销、资料修改都会使该用户的全部令牌立即失效（server 侧联动批量吊销）。
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
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_CREATE)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDraft, setProfileDraft] = useState({ email: "", nickname: "", region: "" })
  // 搜索/翻页是输入即触发：用序号丢弃乱序返回的旧响应，避免列表闪回旧查询的结果。
  const loadSeq = useRef(0)
  const pageSize = 20

  useEffect(() => {
    // 静默获取：401 时 apiGet 自会跳登录，这里不额外处理。
    apiGet<Me>("/admin/api/session").then(setMe).catch(() => setMe(null))
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (query.trim()) params.set("query", query.trim())
      if (status) params.set("status", status)
      const data = await apiGet<PageResult<UserSummary>>(`/admin/api/users?${params}`)
      if (seq === loadSeq.current) setResult(data)
    } catch (cause) {
      if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "加载失败")
    }
  }, [page, query, status])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(id: string) {
    try {
      setNewPassword(null)
      setEditingProfile(false)
      setDetail(await apiGet<UserDetail>(`/admin/api/users/${id}`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "详情加载失败")
    }
  }

  async function submitCreate() {
    if (!draft.userName.trim()) {
      setError("用户名不能为空")
      return
    }
    setBusy(true)
    try {
      setError(null)
      const response = await apiSend<CreateUserResponse>("POST", "/admin/api/users", {
        userName: draft.userName.trim(),
        email: draft.email.trim() || null,
        nickname: draft.nickname.trim() || null,
        region: draft.region.trim() || null,
        password: draft.password || null,
        grantAdminRole: draft.grantAdminRole,
      })
      setCreating(false)
      setDraft(EMPTY_CREATE)
      if (response.password) setNewPassword(response.password)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "建号失败")
    } finally {
      setBusy(false)
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

  async function toggleAdminRole(user: UserDetail) {
    const granting = !user.roles.includes(ADMIN_ROLE)
    const verb = granting ? "授予" : "移除"
    if (!window.confirm(
      `确认${verb}用户 ${user.userName} 的管理员角色？变更将吊销其全部令牌（立即生效）。`,
    )) return
    setBusy(true)
    try {
      setError(null)
      const roles = granting ? [...user.roles, ADMIN_ROLE] : user.roles.filter((role) => role !== ADMIN_ROLE)
      setDetail(await apiSend<UserDetail>("PUT", `/admin/api/users/${user.id}/roles`, { roles }))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${verb}管理员角色失败`)
    } finally {
      setBusy(false)
    }
  }

  async function unlock(user: UserDetail) {
    if (!window.confirm(`确认解锁用户 ${user.userName}？将清除临时锁定与连续失败计数。`)) return
    setBusy(true)
    try {
      setError(null)
      setDetail(await apiSend<UserDetail>("POST", `/admin/api/users/${user.id}/unlock`, {}))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解锁失败")
    } finally {
      setBusy(false)
    }
  }

  async function resetTwoFactor(user: UserDetail) {
    if (!window.confirm(
      `确认重置用户 ${user.userName} 的两步验证？将关闭 2FA 并吊销其全部令牌（该账号会被强制下线${user.id === me?.subject ? "，包括你当前的管理台会话" : ""}）。`,
    )) return
    setBusy(true)
    try {
      setError(null)
      setDetail(await apiSend<UserDetail>("POST", `/admin/api/users/${user.id}/reset-2fa`, {}))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重置两步验证失败")
    } finally {
      setBusy(false)
    }
  }

  function openProfileEditor(user: UserDetail) {
    setProfileDraft({ email: user.email ?? "", nickname: user.nickname ?? "", region: user.region ?? "" })
    setEditingProfile(true)
  }

  async function submitProfile() {
    if (!detail) return
    setBusy(true)
    try {
      setError(null)
      setDetail(await apiSend<UserDetail>("PUT", `/admin/api/users/${detail.id}/profile`, {
        email: profileDraft.email.trim() || null,
        nickname: profileDraft.nickname.trim() || null,
        region: profileDraft.region.trim() || null,
      }))
      setEditingProfile(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(user: UserDetail) {
    const input = window.prompt(
      `注销为不可恢复操作：账号将无法登录、全部会话立即失效，管理台不提供恢复入口。\n如确认，请原样输入该用户的用户名：${user.userName}`,
    )
    if (input === null) return
    if (input !== user.userName) {
      setError("确认用户名不匹配，未执行注销。")
      return
    }
    setBusy(true)
    try {
      setError(null)
      await apiSend("POST", `/admin/api/users/${user.id}/deactivate`, { confirmUserName: user.userName })
      await load()
      await openDetail(user.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注销失败")
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
        <div className="ml-auto pb-2">
          <Button onClick={() => setCreating((value) => !value)} variant={creating ? "outline" : "default"}>
            {creating ? "收起建号表单" : "新建用户"}
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">新建用户</CardTitle>
            <CardDescription>
              初始密码留空则由服务端生成（仅显示一次）；邮箱变更无关——新建账号的邮箱一律视为未验证。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="create-userName">用户名 *</Label>
              <Input
                id="create-userName"
                value={draft.userName}
                onChange={(event) => setDraft({ ...draft, userName: event.target.value })}
                placeholder="登录名"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-email">邮箱</Label>
              <Input
                id="create-email"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                placeholder="user@example.com（可留空）"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-nickname">昵称</Label>
              <Input
                id="create-nickname"
                value={draft.nickname}
                onChange={(event) => setDraft({ ...draft, nickname: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-region">区域</Label>
              <Input
                id="create-region"
                value={draft.region}
                onChange={(event) => setDraft({ ...draft, region: event.target.value })}
                placeholder="如 cn-sh（可留空）"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-password">初始密码</Label>
              <Input
                id="create-password"
                type="text"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                placeholder="留空自动生成"
              />
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={draft.grantAdminRole}
                onChange={(event) => setDraft({ ...draft, grantAdminRole: event.target.checked })}
              />
              创建后授予管理员角色
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={busy || !draft.userName.trim()} onClick={() => void submitCreate()}>
                创建
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCreating(false)
                  setDraft(EMPTY_CREATE)
                }}
              >
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                    {/* 自己那一行不提供冻结/重置（server 侧另有硬门禁）：两个操作都会把当前管理会话锁在门外。
                        已注销（终态）的行同样不提供——状态端点只接受 Active/Frozen 互转。 */}
                    {me?.subject !== user.id && user.status !== 2 && (
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
            <CardDescription>{detail.email ?? "未绑定邮箱"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <p>状态：{USER_STATUS[detail.status] ?? detail.status}</p>
            <p>注册渠道：{REGISTER_CHANNEL[detail.registerChannel] ?? detail.registerChannel}</p>
            <p>邮箱已验证：{detail.emailConfirmed ? "是" : "否"}</p>
            <p>两步验证：{detail.twoFactorEnabled ? "已启用" : "未启用"}</p>
            <p>锁定至：{detail.lockoutEnd ? new Date(detail.lockoutEnd).toLocaleString("zh-CN") : "—"}</p>
            <p>连续失败：{detail.accessFailedCount} 次</p>
            <p>创建：{new Date(detail.createdAt).toLocaleString("zh-CN")}</p>
            <p>更新：{new Date(detail.updatedAt).toLocaleString("zh-CN")}</p>
            <p className="sm:col-span-2">
              身份标识：<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detail.id}</code>
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <span>角色：</span>
              {detail.roles.length > 0 ? (
                detail.roles.map((role) => (
                  <span key={role} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {role}
                  </span>
                ))
              ) : (
                <span>无角色</span>
              )}
              {/* 自降级被 server 硬门禁拒绝；已注销（终态）账号拒绝一切变更——两种情况都不展示按钮。 */}
              {detail.status !== 2 && !(detail.id === me?.subject && detail.roles.includes(ADMIN_ROLE)) && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggleAdminRole(detail)}>
                  {detail.roles.includes(ADMIN_ROLE) ? "移除管理员" : "设为管理员"}
                </Button>
              )}
            </div>
            {/* 已注销账号详情只读：server 侧对所有变更端点都有终态守卫，这里同样收起操作。 */}
            {detail.status !== 2 && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button variant="outline" size="sm" onClick={() => openProfileEditor(detail)}>
                  编辑资料
                </Button>
                {isLocked(detail) && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void unlock(detail)}>
                    解锁
                  </Button>
                )}
                {detail.twoFactorEnabled && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void resetTwoFactor(detail)}>
                    重置两步验证
                  </Button>
                )}
                {detail.id !== me?.subject && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => void deactivate(detail)}
                  >
                    注销账号
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {detail && editingProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">编辑资料 · {detail.userName}</CardTitle>
            <CardDescription>
              保存后该用户全部令牌立即失效。邮箱变更会重置「邮箱已验证」；留空即清空该字段。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-email">邮箱</Label>
              <Input
                id="profile-email"
                type="email"
                value={profileDraft.email}
                onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-nickname">昵称</Label>
              <Input
                id="profile-nickname"
                value={profileDraft.nickname}
                onChange={(event) => setProfileDraft({ ...profileDraft, nickname: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-region">区域</Label>
              <Input
                id="profile-region"
                value={profileDraft.region}
                onChange={(event) => setProfileDraft({ ...profileDraft, region: event.target.value })}
              />
            </div>
            <div className="flex gap-2 self-end">
              <Button disabled={busy} onClick={() => void submitProfile()}>
                保存
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setEditingProfile(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
