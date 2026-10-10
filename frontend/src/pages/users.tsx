import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  REGISTER_CHANNEL,
  USER_STATUS,
  apiGet,
  apiSend,
  type CreateUserResponse,
  type ClaimRequest,
  type PageResult,
  type UserClaim,
  type UserDetail,
  type UserSummary,
} from "@/lib/api"
import { clearDraft, consumeDraft, saveDraft } from "@/lib/drafts"
import { getSession } from "@/lib/session"

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
 * 确认对话框的待确认操作(#28):window.confirm 不可复制说明、无结构化后果展示,换 AlertDialog。
 * 一个状态机驱动单个对话框,action 里放真正的 handler。
 */
type PendingConfirm =
  | { kind: "freeze"; user: UserSummary }
  | { kind: "reset-password"; user: UserSummary }
  | { kind: "roles"; user: UserDetail }
  | { kind: "unlock"; user: UserDetail }
  | { kind: "reset-2fa"; user: UserDetail }
  | { kind: "remove-claim"; claim: UserClaim }

/**
 * 用户管理（0.4）：列表/搜索/详情/建号/角色/冻结解冻/解锁/资料/2FA/注销/重置密码。
 * 冻结、重置、角色变更、注销、资料修改都会使该用户的全部令牌立即失效（server 侧联动批量吊销）。
 * 筛选/分页/选中详情进 URL(#27),刷新与分享可恢复;表单草稿经 sessionStorage 暂存(#26),
 * MFA step-up 返回后自动恢复,不自动重放。
 */
export default function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- URL 状态(#27):q/status/page/user 是唯一事实源 ----
  const query = searchParams.get("q") ?? ""
  const status = searchParams.get("status") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const detailUserId = searchParams.get("user")

  const updateParams = useCallback(
    (patch: Record<string, string | null>, options?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: options?.replace ?? false },
      )
    },
    [setSearchParams],
  )

  const [result, setResult] = useState<PageResult<UserSummary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [newPassword, setNewPassword] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<Me | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_CREATE)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDraft, setProfileDraft] = useState({ email: "", nickname: "", region: "" })
  const [claims, setClaims] = useState<UserClaim[]>([])
  const [claimDraft, setClaimDraft] = useState<ClaimRequest>({ claimType: "panda:", claimValue: "", scope: "api" })
  const [claimsBusy, setClaimsBusy] = useState(false)
  const [confirming, setConfirming] = useState<PendingConfirm | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<UserDetail | null>(null)
  const [deactivateInput, setDeactivateInput] = useState("")
  const [copied, setCopied] = useState(false)
  // 搜索/翻页是输入即触发：用序号丢弃乱序返回的旧响应，避免列表闪回旧查询的结果。
  const loadSeq = useRef(0)
  const pageSize = 20

  useEffect(() => {
    // 静默获取：401 时 apiGet 自会跳登录，这里不额外处理。经模块级缓存(#31)共享请求。
    getSession().then(setMe).catch(() => setMe(null))
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

  // 详情与列表同款乱序守卫：连续点击两行时，慢的旧详情可能后到并覆盖新选中的详情。
  const detailSeq = useRef(0)

  const openDetail = useCallback(async (id: string) => {
    const seq = ++detailSeq.current
    try {
      setNewPassword(null)
      setEditingProfile(false)
      const [user, userClaims] = await Promise.all([
        apiGet<UserDetail>(`/admin/api/users/${id}`),
        apiGet<UserClaim[]>(`/admin/api/users/${id}/claims`),
      ])
      if (seq !== detailSeq.current) return
      setDetail(user)
      setClaims(userClaims)
      // MFA step-up 草稿恢复(#26):草稿带 userId,只有回到同一用户的详情才恢复;
      // consume 即弃,不匹配的旧草稿顺带清场。
      const savedClaim = consumeDraft<{ userId: string; draft: ClaimRequest }>("users.claim")
      if (savedClaim && savedClaim.userId === user.id) setClaimDraft(savedClaim.draft)
      const savedProfile = consumeDraft<{ userId: string; draft: { email: string; nickname: string; region: string } }>("users.profile")
      if (savedProfile && savedProfile.userId === user.id) {
        setProfileDraft(savedProfile.draft)
        setEditingProfile(true)
      }
    } catch (cause) {
      if (seq === detailSeq.current) setError(cause instanceof Error ? cause.message : "详情加载失败")
    }
  }, [])

  // 选中详情由 URL 驱动(#27):刷新/直链可恢复;参数清空即关闭详情。
  useEffect(() => {
    if (detailUserId) {
      void openDetail(detailUserId)
    } else {
      setDetail(null)
      setClaims([])
      setEditingProfile(false)
    }
  }, [detailUserId, openDetail])

  // 建号表单草稿(#26):MFA step-up 返回后恢复(建号不绑定具体用户,挂载时消费即可)。
  useEffect(() => {
    const saved = consumeDraft<CreateDraft>("users.create")
    if (saved) {
      setCreating(true)
      setDraft(saved)
    }
  }, [])

  async function addClaim() {
    if (!detail) return
    const request = {
      claimType: claimDraft.claimType.trim(),
      claimValue: claimDraft.claimValue.trim(),
      scope: claimDraft.scope.trim(),
    }
    if (!request.claimType || !request.claimValue || !request.scope) {
      setError("Claim 类型、值和 scope 均不能为空")
      return
    }
    setClaimsBusy(true)
    saveDraft("users.claim", { userId: detail.id, draft: claimDraft })
    try {
      setError(null)
      const created = await apiSend<UserClaim>("POST", `/admin/api/users/${detail.id}/claims`, request)
      clearDraft("users.claim")
      setClaims((items) => [...items, created])
      setClaimDraft({ claimType: "panda:", claimValue: "", scope: "api" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加 Claim 失败")
    } finally {
      setClaimsBusy(false)
    }
  }

  async function removeClaim(claim: UserClaim) {
    if (!detail) return
    setClaimsBusy(true)
    try {
      setError(null)
      await apiSend("DELETE", `/admin/api/users/${detail.id}/claims/${claim.id}`)
      setClaims((items) => items.filter((item) => item.id !== claim.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除 Claim 失败")
    } finally {
      setClaimsBusy(false)
    }
  }

  async function submitCreate() {
    if (!draft.userName.trim()) {
      setError("用户名不能为空")
      return
    }
    setBusy(true)
    saveDraft("users.create", draft)
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
      clearDraft("users.create")
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
    setBusy(true)
    try {
      await apiSend("POST", `/admin/api/users/${user.id}/status`, { status: user.status === 1 ? 0 : 1 })
      await load()
      if (detail?.id === user.id) await openDetail(user.id)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${verb}失败`)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(user: UserSummary) {
    setBusy(true)
    try {
      const response = await apiSend<{ password: string }>("POST", `/admin/api/users/${user.id}/reset-password`, {})
      setNewPassword(response.password)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重置失败")
    } finally {
      setBusy(false)
    }
  }

  async function toggleAdminRole(user: UserDetail) {
    const granting = !user.roles.includes(ADMIN_ROLE)
    const verb = granting ? "授予" : "移除"
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
    saveDraft("users.profile", { userId: detail.id, draft: profileDraft })
    try {
      setError(null)
      setDetail(await apiSend<UserDetail>("PUT", `/admin/api/users/${detail.id}/profile`, {
        email: profileDraft.email.trim() || null,
        nickname: profileDraft.nickname.trim() || null,
        region: profileDraft.region.trim() || null,
      }))
      clearDraft("users.profile")
      setEditingProfile(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(user: UserDetail) {
    setBusy(true)
    try {
      setError(null)
      await apiSend("POST", `/admin/api/users/${user.id}/deactivate`, { confirmUserName: user.userName })
      setDeactivateTarget(null)
      setDeactivateInput("")
      await load()
      await openDetail(user.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注销失败")
    } finally {
      setBusy(false)
    }
  }

  function runConfirm() {
    if (!confirming) return
    const pending = confirming
    setConfirming(null)
    if (pending.kind === "freeze") void toggleFreeze(pending.user)
    else if (pending.kind === "reset-password") void resetPassword(pending.user)
    else if (pending.kind === "roles") void toggleAdminRole(pending.user)
    else if (pending.kind === "unlock") void unlock(pending.user)
    else if (pending.kind === "reset-2fa") void resetTwoFactor(pending.user)
    else if (pending.kind === "remove-claim") void removeClaim(pending.claim)
  }

  async function copyNewPassword() {
    if (!newPassword) return
    try {
      await navigator.clipboard.writeText(newPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用（非安全上下文等）：静默，密码文本仍可手动选中复制。
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  // 确认对话框文案(单一来源,渲染见文件尾部的 AlertDialog)。
  const confirmCopy = confirming
    ? confirming.kind === "freeze"
      ? {
          title: `${confirming.user.status === 1 ? "解冻" : "冻结"}用户 ${confirming.user.userName}？`,
          description:
            confirming.user.status === 1
              ? "解冻后账号可正常登录。"
              : "其全部登录令牌将立即失效。",
          actionText: confirming.user.status === 1 ? "解冻" : "冻结",
        }
      : confirming.kind === "reset-password"
        ? {
            title: `为用户 ${confirming.user.userName} 生成新密码？`,
            description: "当前密码将失效，其所有会话将被强制下线。新密码仅显示一次。",
            actionText: "生成新密码",
          }
        : confirming.kind === "roles"
          ? {
              title: `${confirming.user.roles.includes(ADMIN_ROLE) ? "移除" : "授予"}用户 ${confirming.user.userName} 的管理员角色？`,
              description: "变更将吊销其全部令牌（立即生效）。",
              actionText: confirming.user.roles.includes(ADMIN_ROLE) ? "移除管理员" : "设为管理员",
            }
          : confirming.kind === "unlock"
            ? {
                title: `解锁用户 ${confirming.user.userName}？`,
                description: "将清除临时锁定与连续失败计数。",
                actionText: "解锁",
              }
            : confirming.kind === "reset-2fa"
              ? {
                  title: `重置用户 ${confirming.user.userName} 的两步验证？`,
                  description: `将关闭 2FA 并吊销其全部令牌（该账号会被强制下线${confirming.user.id === me?.subject ? "，包括你当前的管理台会话" : ""}）。`,
                  actionText: "重置两步验证",
                }
              : {
                  title: `删除 Claim ${confirming.claim.claimType}？`,
                  description: "删除后即刻生效；添加和删除 Claim 都会记录管理审计。",
                  actionText: "删除",
                }
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="query">搜索（用户名 / 邮箱）</Label>
          <Input
            id="query"
            className="w-64"
            value={query}
            onChange={(event) => updateParams({ q: event.target.value, page: null }, { replace: true })}
            placeholder="输入即搜索"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">状态</Label>
          <Select
            value={status}
            onValueChange={(value) => updateParams({ status: value === "all" ? null : value, page: null })}
          >
            <SelectTrigger id="status" className="w-32">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="0">正常</SelectItem>
              <SelectItem value="1">已冻结</SelectItem>
              <SelectItem value="2">已注销</SelectItem>
            </SelectContent>
          </Select>
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
              <Checkbox
                checked={draft.grantAdminRole}
                onCheckedChange={(checked) => setDraft({ ...draft, grantAdminRole: checked === true })}
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
                  <td
                    className="cursor-pointer px-4 py-3 font-medium"
                    onClick={() => updateParams({ user: user.id })}
                  >
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
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirming({ kind: "freeze", user })}
                        >
                          {user.status === 1 ? "解冻" : "冻结"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirming({ kind: "reset-password", user })}
                        >
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
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => updateParams({ page: String(page - 1) })}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            下一页
          </Button>
        </div>
      </div>

      {newPassword && (
        <div ref={(node) => {
          // 出现即滚动到视口中央(#25):一次性密码不可再取,不能让用户翻找。
          if (node && newPassword) node.scrollIntoView({ behavior: "smooth", block: "center" })
        }}>
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/50">
            <CardHeader>
              <CardTitle className="text-sm text-amber-800 dark:text-amber-300">新密码（仅显示这一次）</CardTitle>
              <CardDescription>请立即复制并安全送达用户；服务端只保留哈希，无法再次取出。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <code className="rounded bg-white px-3 py-2 font-mono text-base dark:bg-muted">{newPassword}</code>
              <Button variant="outline" size="sm" onClick={() => void copyNewPassword()}>
                {copied ? "已复制" : "复制"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {detail && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">账号详情 · {detail.userName}</CardTitle>
                <CardDescription>{detail.email ?? "未绑定邮箱"}</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="关闭详情"
                onClick={() => updateParams({ user: null })}
              >
                关闭
              </Button>
            </div>
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming({ kind: "roles", user: detail })}
                >
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming({ kind: "unlock", user: detail })}
                  >
                    解锁
                  </Button>
                )}
                {detail.twoFactorEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming({ kind: "reset-2fa", user: detail })}
                  >
                    重置两步验证
                  </Button>
                )}
                {detail.id !== me?.subject && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      setDeactivateInput("")
                      setDeactivateTarget(detail)
                    }}
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

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">自定义 Claims</CardTitle>
            <CardDescription>
              仅允许 panda: 命名空间；Claim 只有在客户端申请对应 scope 时才会进入 Token。添加和删除需要近期完成 WebAuthn。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {claims.length > 0 ? (
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">值</th>
                      <th className="px-3 py-2 font-medium">Scope</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => (
                      <tr key={claim.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{claim.claimType}</td>
                        <td className="px-3 py-2">{claim.claimValue}</td>
                        <td className="px-3 py-2 font-mono text-xs">{claim.scope}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={claimsBusy}
                            onClick={() => setConfirming({ kind: "remove-claim", claim })}
                          >
                            删除
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无自定义 Claims。</p>
            )}
            {detail.status !== 2 && (
              <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-type">类型</Label>
                  <Input id="claim-type" value={claimDraft.claimType} onChange={(event) => setClaimDraft({ ...claimDraft, claimType: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-value">值</Label>
                  <Input id="claim-value" value={claimDraft.claimValue} onChange={(event) => setClaimDraft({ ...claimDraft, claimValue: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-scope">Scope</Label>
                  <Input id="claim-scope" value={claimDraft.scope} onChange={(event) => setClaimDraft({ ...claimDraft, scope: event.target.value })} />
                </div>
                <Button disabled={claimsBusy || busy} onClick={() => void addClaim()}>添加</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 变更确认(#28):单一 AlertDialog 承载全部确认语义,文案见 confirmCopy。 */}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm}>{confirmCopy?.actionText}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 注销(#28):保留「原样输入用户名」防误触语义,window.prompt 换 Dialog+Input。 */}
      <Dialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivateTarget(null)
            setDeactivateInput("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注销账号 {deactivateTarget?.userName}？</DialogTitle>
            <DialogDescription>
              注销为不可恢复操作：账号将无法登录、全部会话立即失效，管理台不提供恢复入口。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="deactivate-confirm">如确认，请原样输入该用户的用户名</Label>
            <Input
              id="deactivate-confirm"
              value={deactivateInput}
              onChange={(event) => setDeactivateInput(event.target.value)}
              placeholder={deactivateTarget?.userName}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy || deactivateTarget === null || deactivateInput !== deactivateTarget.userName}
              onClick={() => deactivateTarget && void deactivate(deactivateTarget)}
            >
              注销账号
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
