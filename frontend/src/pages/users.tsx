import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import ConfirmAction from "@/components/patterns/ConfirmAction"
import FilterToolbar from "@/components/patterns/FilterToolbar"
import SemanticBadge from "@/components/semantic-badge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  serverError,
  REGISTER_CHANNEL,
  USER_STATUS,
  apiGet,
  apiSend,
  type AdminUserSession,
  type CreateUserResponse,
  type ClaimRequest,
  type PageResult,
  type UserClaim,
  type UserDetail,
  type UserSummary,
} from "@/lib/api"
import { useSession } from "@/lib/auth"
import { clearDraft, consumeDraft, saveDraft, saveDraftWithoutPassword, withoutPassword } from "@/lib/drafts"
import { notify } from "@/lib/notify"
import { useI18n } from "@/lib/i18n"
import { useOneTimeValue } from "@/hooks/use-one-time-value"

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
const EMPTY_CLAIM: ClaimRequest = { claimType: "panda:", claimValue: "", scope: "api" }

/** 详情是否处于需要解锁的状态（存在未过期的 LockoutEnd，或失败计数未清）。 */
function isLocked(detail: UserDetail): boolean {
  return (detail.lockoutEnd !== null && new Date(detail.lockoutEnd).getTime() > Date.now()) || detail.accessFailedCount > 0
}

/** 写操作失败的统一出口:服务端原文/en 词典译码后交给 notify 驻留展示。 */
function toUserMessage(cause: unknown): Error {
  return new Error(serverError(cause))
}

/**
 * 用户管理（0.4）：列表/搜索/详情/建号/角色/冻结解冻/解锁/资料/2FA/注销/重置密码。
 * 冻结、重置、角色变更、注销、资料修改都会使该用户的全部令牌立即失效（server 侧联动批量吊销）。
 * 筛选/分页/选中详情进 URL(#27),刷新与分享可恢复;搜索与状态筛选经模板 FilterToolbar
 * (节流落 URL,'all' 哨兵不落键)。危险变更统一走模板 ConfirmAction(确认→异步 loading→
 * 结果 notify);表单草稿经 sessionStorage 暂存(#26),MFA step-up 返回后自动恢复,不自动重放。
 */
export default function UsersPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- URL 状态(#27):q/status/page/user 是唯一事实源;sort/dir 服务端排序(#31) ----
  const query = searchParams.get("q") ?? ""
  const status = searchParams.get("status") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const detailUserId = searchParams.get("user")
  // 排序键与 server 白名单(userName/email/createdAt)一一对应,入口只有表头按钮。
  const sort = searchParams.get("sort") ?? ""
  const dir = searchParams.get("dir") === "desc" ? "desc" : "asc"

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

  const passwordNotice = useOneTimeValue(detailUserId)
  const newPassword = passwordNotice.value
  const passwordRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_CREATE)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDraft, setProfileDraft] = useState({ email: "", nickname: "", region: "" })
  const [claimState, setClaimState] = useState({ ownerId: detailUserId, draft: EMPTY_CLAIM })
  const claimDraft = claimState.ownerId === detailUserId ? claimState.draft : EMPTY_CLAIM
  const setClaimDraft = useCallback((draft: ClaimRequest) => setClaimState({ ownerId: detailUserId, draft }), [detailUserId])
  const [claimsBusy, setClaimsBusy] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<UserDetail | null>(null)
  const [deactivateInput, setDeactivateInput] = useState("")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
    if (newPassword) passwordRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [newPassword])
  useEffect(() => {
    const saved = consumeDraft<{ userId: string; draft: ClaimRequest }>("users.claim")
    setClaimState({ ownerId: detailUserId, draft: saved?.userId === detailUserId ? saved.draft : EMPTY_CLAIM })
  }, [detailUserId])
  const pageSize = 20

  const me = useSession().data
  const queryClient = useQueryClient()

  // 读侧经 useQuery(P3 迁移)。列表键=URL 状态全集(URL 变即重取);搜索节流由
  // FilterToolbar 承担(URL 已是 300ms 节流后的值)。键语义取代旧 loadSeq/detailSeq
  // 乱序守卫——慢的旧响应只写进旧键的缓存,不会覆盖新查询的结果。
  const listQuery = useQuery({
    queryKey: ["users", page, query, status, sort, dir],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (query.trim()) params.set("query", query.trim())
      if (status) params.set("status", status)
      // 服务端排序(#31):键来自表头按钮白名单,直接进参数。
      if (sort) params.set("orderBy", sort)
      if (sort) params.set("order", dir)
      return apiGet<PageResult<UserSummary>>(`/admin/api/users?${params}`)
    },
    retry: false,
  })
  const result = listQuery.data ?? null
  const error = listQuery.error ? serverError(listQuery.error) : null

  // 详情+Claims 一个查询(同源同失效);选中由 URL 驱动(#27),清参数即收起。
  const detailQuery = useQuery({
    queryKey: ["users-detail", detailUserId],
    queryFn: async () => {
      const [user, userClaims] = await Promise.all([
        apiGet<UserDetail>(`/admin/api/users/${detailUserId}`),
        apiGet<UserClaim[]>(`/admin/api/users/${detailUserId}/claims`),
      ])
      return { user, claims: userClaims }
    },
    enabled: detailUserId !== null,
    retry: false,
  })
  const detail = (detailUserId ? detailQuery.data?.user : undefined) ?? null
  const claims = (detailUserId ? detailQuery.data?.claims : undefined) ?? []
  const detailError = detailQuery.error ? serverError(detailQuery.error) : null
  const shownError = error ?? detailError

  // 在线会话面板(#30 后半):独立查询,失败不影响详情主体。
  const sessionsQuery = useQuery({
    queryKey: ["users-sessions", detailUserId],
    queryFn: () => apiGet<AdminUserSession[]>(`/admin/api/users/${detailUserId}/sessions`),
    enabled: detailUserId !== null,
    retry: false,
  })
  const sessions = (detailUserId ? sessionsQuery.data : undefined) ?? null
  const sessionsError = sessionsQuery.error ? serverError(sessionsQuery.error) : null

  // 详情落地(含变更后失效重取)时的伴随动作:MFA step-up 草稿恢复(#26,带 userId
  // 匹配,consume 即弃)——草稿只在详情数据首次/更新落地时消费一次。
  useEffect(() => {
    if (!detailQuery.data) return
    setEditingProfile(false)
    const user = detailQuery.data.user
    const savedProfile = consumeDraft<{ userId: string; draft: { email: string; nickname: string; region: string } }>("users.profile")
    if (savedProfile && savedProfile.userId === user.id) {
      setProfileDraft(savedProfile.draft)
      setEditingProfile(true)
    }
  }, [detailQuery.data])

  /** 变更后失效读侧:列表前缀失效(全页重取),详情与会话按键失效(打开时)。 */
  const refreshAfterMutation = useCallback(
    async (userId?: string) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] })
      if (userId) {
        await queryClient.invalidateQueries({ queryKey: ["users-detail", userId] })
        await queryClient.invalidateQueries({ queryKey: ["users-sessions", userId] })
      }
    },
    [queryClient],
  )

  // 排序表头(#31):同列切换方向,异列回 asc。
  const toggleSort = useCallback(
    (key: "userName" | "email" | "createdAt") => {
      if (sort === key) updateParams({ sort: key, dir: dir === "asc" ? "desc" : "asc" })
      else updateParams({ sort: key, dir: "asc" })
    },
    [sort, dir, updateParams],
  )

  // 筛选变化回第一页(FilterToolbar 只管自己的键,翻页参数归页面管)。
  const pageRef = useRef(page)
  pageRef.current = page
  useEffect(() => {
    if (pageRef.current !== 1) updateParams({ page: null }, { replace: true })
  }, [query, status, updateParams])

  // 建号表单草稿(#26):MFA step-up 返回后恢复(建号不绑定具体用户,挂载时消费即可)。
  useEffect(() => {
    const saved = consumeDraft<CreateDraft>("users.create")
    if (saved) {
      setCreating(true)
      setDraft(withoutPassword(saved))
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
      notify.error(t("Claim 类型、值和 scope 均不能为空"))
      return
    }
    setClaimsBusy(true)
    const ownerIsCurrent = passwordNotice.watchOwner()
    saveDraft("users.claim", { userId: detail.id, draft: claimDraft })
    try {
      await apiSend<UserClaim>("POST", `/admin/api/users/${detail.id}/claims`, request)
      clearDraft("users.claim")
      if (ownerIsCurrent()) setClaimDraft(EMPTY_CLAIM)
      await refreshAfterMutation(detail.id)
      notify.success(t("Claim 已添加"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setClaimsBusy(false)
    }
  }

  async function submitCreate() {
    if (!draft.userName.trim()) {
      notify.error(t("用户名不能为空"))
      return
    }
    const operation = passwordNotice.begin()
    setBusy(true)
    saveDraftWithoutPassword("users.create", draft)
    try {
      const response = await apiSend<CreateUserResponse>("POST", "/admin/api/users", {
        userName: draft.userName.trim(),
        email: draft.email.trim() || null,
        nickname: draft.nickname.trim() || null,
        region: draft.region.trim() || null,
        password: draft.password || null,
        grantAdminRole: draft.grantAdminRole,
      })
      clearDraft("users.create")
      if (operation.current()) {
        setCreating(false)
        setDraft(EMPTY_CREATE)
        if (response.password) operation.reveal(response.password, response.id)
        updateParams({ user: response.id })
      }
      await refreshAfterMutation()
      notify.success(t("账号已创建"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function submitProfile() {
    if (!detail) return
    setBusy(true)
    saveDraft("users.profile", { userId: detail.id, draft: profileDraft })
    try {
      await apiSend<UserDetail>("PUT", `/admin/api/users/${detail.id}/profile`, {
        email: profileDraft.email.trim() || null,
        nickname: profileDraft.nickname.trim() || null,
        region: profileDraft.region.trim() || null,
      })
      clearDraft("users.profile")
      setEditingProfile(false)
      await refreshAfterMutation(detail.id)
      notify.success(t("资料已保存"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(user: UserDetail) {
    setBusy(true)
    try {
      await apiSend("POST", `/admin/api/users/${user.id}/deactivate`, { confirmUserName: user.userName })
      setDeactivateTarget(null)
      setDeactivateInput("")
      await refreshAfterMutation(user.id)
      notify.success(t("账号已注销"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function copyNewPassword() {
    if (!newPassword) return
    const valueIsCurrent = passwordNotice.watchValue()
    try {
      await navigator.clipboard.writeText(newPassword)
      if (!valueIsCurrent()) return
      setCopied(true)
      setTimeout(() => { if (valueIsCurrent()) setCopied(false) }, 2000)
    } catch {
      // 剪贴板不可用（非安全上下文等）：静默，密码文本仍可手动选中复制。
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  // 冻结/解冻(ConfirmAction onConfirm):失败抛出经 notify 驻留,成功由组件 notify.success。
  async function confirmFreeze(user: UserSummary) {
    try {
      await apiSend("POST", `/admin/api/users/${user.id}/status`, { status: user.status === 1 ? 0 : 1 })
      await refreshAfterMutation(detail?.id === user.id ? user.id : undefined)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  async function confirmResetPassword(user: UserSummary) {
    const operation = passwordNotice.begin()
    try {
      const response = await apiSend<{ password: string }>("POST", `/admin/api/users/${encodeURIComponent(user.id)}/reset-password`, {})
      if (operation.reveal(response.password, user.id)) updateParams({ user: user.id })
      await refreshAfterMutation(user.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  async function confirmToggleAdminRole(user: UserDetail) {
    const granting = !user.roles.includes(ADMIN_ROLE)
    try {
      const roles = granting ? [...user.roles, ADMIN_ROLE] : user.roles.filter((role) => role !== ADMIN_ROLE)
      await apiSend<UserDetail>("PUT", `/admin/api/users/${user.id}/roles`, { roles })
      await refreshAfterMutation(user.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  async function confirmUnlock(user: UserDetail) {
    try {
      await apiSend<UserDetail>("POST", `/admin/api/users/${user.id}/unlock`, {})
      await refreshAfterMutation(user.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  async function confirmResetTwoFactor(user: UserDetail) {
    try {
      await apiSend<UserDetail>("POST", `/admin/api/users/${user.id}/reset-2fa`, {})
      await refreshAfterMutation(user.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  // 独立踢下线(#30):仅吊销令牌,账号状态/凭据不动;server 侧另有 MFA 门禁与自操作封禁。
  async function confirmRevokeTokens(user: UserDetail) {
    try {
      await apiSend<UserDetail>("POST", `/admin/api/users/${user.id}/revoke-tokens`, {})
      await refreshAfterMutation(user.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  async function confirmRemoveClaim(claim: UserClaim) {
    if (!detail) return
    try {
      await apiSend("DELETE", `/admin/api/users/${detail.id}/claims/${claim.id}`)
      await refreshAfterMutation(detail.id)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  function openProfileEditor(user: UserDetail) {
    setProfileDraft({ email: user.email ?? "", nickname: user.nickname ?? "", region: user.region ?? "" })
    setEditingProfile(true)
  }

  return (
    <div className="space-y-6">
      <FilterToolbar
        searchPlaceholder={t("搜索（用户名 / 邮箱）")}
        selects={[
          {
            key: "status",
            label: t("状态"),
            options: {
              "0": t("正常"),
              "1": t("已冻结"),
              "2": t("已注销"),
            },
          },
        ]}
        right={
          <div className="flex items-center gap-3">
            {result && <span className="text-sm text-muted-foreground">{t("共 {total} 个账号", { total: result.total })}</span>}
            <Button onClick={() => setCreating((value) => !value)} variant={creating ? "outline" : "default"}>
              {creating ? t("收起建号表单") : t("新建用户")}
            </Button>
          </div>
        }
      />

      {shownError && <p role="alert" className="text-destructive">{shownError}</p>}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("新建用户")}</CardTitle>
            <CardDescription>
              {t("初始密码留空则由服务端生成（仅显示一次）；邮箱变更无关——新建账号的邮箱一律视为未验证。")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="create-userName">{t("用户名 *")}</Label>
              <Input
                id="create-userName"
                value={draft.userName}
                onChange={(event) => setDraft({ ...draft, userName: event.target.value })}
                placeholder={t("登录名")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-email">{t("邮箱")}</Label>
              <Input
                id="create-email"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                placeholder={t("user@example.com（可留空）")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-nickname">{t("昵称")}</Label>
              <Input
                id="create-nickname"
                value={draft.nickname}
                onChange={(event) => setDraft({ ...draft, nickname: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-region">{t("区域")}</Label>
              <Input
                id="create-region"
                value={draft.region}
                onChange={(event) => setDraft({ ...draft, region: event.target.value })}
                placeholder={t("如 cn-sh（可留空）")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-password">{t("初始密码")}</Label>
              <Input
                id="create-password"
                type="text"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                placeholder={t("留空自动生成")}
              />
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <Checkbox
                checked={draft.grantAdminRole}
                onCheckedChange={(checked) => setDraft({ ...draft, grantAdminRole: checked === true })}
              />
              {t("创建后授予管理员角色")}
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={busy || !draft.userName.trim()} onClick={() => void submitCreate()}>
                {t("创建")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCreating(false)
                  setDraft(EMPTY_CREATE)
                }}
              >
                {t("取消")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[48rem] text-sm">
            <TableHeader>
              <TableRow className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <TableHead className="px-4 py-3 font-medium">
                  <Button type="button" variant="ghost" size="sm" className="h-auto justify-start px-0 font-medium" onClick={() => toggleSort("userName")}>
                    {t("用户名")}{sort === "userName" ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </Button>
                </TableHead>
                <TableHead className="px-4 py-3 font-medium">
                  <Button type="button" variant="ghost" size="sm" className="h-auto justify-start px-0 font-medium" onClick={() => toggleSort("email")}>
                    {t("邮箱")}{sort === "email" ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </Button>
                </TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("状态")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">
                  <Button type="button" variant="ghost" size="sm" className="h-auto justify-start px-0 font-medium" onClick={() => toggleSort("createdAt")}>
                    {t("注册时间")}{sort === "createdAt" ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </Button>
                </TableHead>
                <TableHead className="px-4 py-3 font-medium text-right">{t("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(result?.items ?? []).map((user) => (
                <TableRow key={user.id} className="border-b last:border-0 hover:bg-muted/20">
                  <TableCell
                    className="cursor-pointer px-4 py-3 font-medium"
                    onClick={() => updateParams({ user: user.id })}
                  >
                    {user.userName}
                    {user.nickname ? <span className="ml-2 text-xs text-muted-foreground">{user.nickname}</span> : null}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{user.email ?? "—"}</TableCell>
                  <TableCell className="px-4 py-3">
                    {user.status === 0 ? (
                      <SemanticBadge variant="success">{t(USER_STATUS[user.status] ?? String(user.status))}</SemanticBadge>
                    ) : user.status === 1 ? (
                      <SemanticBadge variant="warning">{t(USER_STATUS[user.status] ?? String(user.status))}</SemanticBadge>
                    ) : (
                      <Badge variant="secondary">{t(USER_STATUS[user.status] ?? String(user.status))}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{new Date(user.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="space-x-2 px-4 py-3 text-right">
                    {/* 自己那一行不提供冻结/重置（server 侧另有硬门禁）：两个操作都会把当前管理会话锁在门外。
                        已注销（终态）的行同样不提供——状态端点只接受 Active/Frozen 互转。 */}
                    {me?.subject !== user.id && user.status !== 2 && (
                      <>
                        <ConfirmAction
                          trigger={
                            <Button variant="outline" size="sm">
                              {user.status === 1 ? t("解冻") : t("冻结")}
                            </Button>
                          }
                          title={user.status === 1 ? t("解冻用户 {name}？", { name: user.userName }) : t("冻结用户 {name}？", { name: user.userName })}
                          description={user.status === 1 ? t("解冻后账号可正常登录。") : t("其全部登录令牌将立即失效。")}
                          confirmLabel={user.status === 1 ? t("解冻") : t("冻结")}
                          successMessage={user.status === 1 ? t("已解冻") : t("已冻结")}
                          onConfirm={() => confirmFreeze(user)}
                        />
                        <ConfirmAction
                          trigger={
                            <Button variant="outline" size="sm">
                              {t("重置密码")}
                            </Button>
                          }
                          title={t("为用户 {name} 生成新密码？", { name: user.userName })}
                          description={t("当前密码将失效，其所有会话将被强制下线。新密码仅显示一次。")}
                          confirmLabel={t("生成新密码")}
                          successMessage={t("新密码已生成")}
                          onConfirm={() => confirmResetPassword(user)}
                        />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {/* 加载与空态区分(#31):result 为 null 是加载中,空数组才是真的没有匹配。 */}
              {!result && !error && (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t("正在加载…")}
                  </TableCell>
                </TableRow>
              )}
              {result && result.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t("没有匹配的账号")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {t("第 {page} / {totalPages} 页", { page, totalPages })}
        </span>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => updateParams({ page: String(page - 1) })}
          >
            {t("上一页")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            {t("下一页")}
          </Button>
        </div>
      </div>

      {newPassword && (
        <div ref={passwordRef}>
          <Card className="border-warning/40 bg-warning/10">
            <CardHeader>
              <CardTitle className="text-sm text-warning">{t("新密码（仅显示这一次）")}</CardTitle>
              <CardDescription>{t("请立即复制并安全送达用户；服务端只保留哈希，无法再次取出。")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <code className="rounded bg-card px-3 py-2 font-mono text-base dark:bg-muted">{newPassword}</code>
              <Button variant="outline" size="sm" onClick={() => void copyNewPassword()}>
                {copied ? t("已复制") : t("复制")}
              </Button>
              <Button variant="ghost" size="sm" aria-label={t("关闭一次性密码")} onClick={passwordNotice.clear}>{t("关闭")}</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {detail && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{t("账号详情 · {name}", { name: detail.userName })}</CardTitle>
                <CardDescription>{detail.email ?? t("未绑定邮箱")}</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("关闭")}
                onClick={() => updateParams({ user: null })}
              >
                {t("关闭")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <p>{t("状态：{status}", { status: t(USER_STATUS[detail.status] ?? String(detail.status)) })}</p>
            <p>{t("注册渠道：{channel}", { channel: t(REGISTER_CHANNEL[detail.registerChannel] ?? String(detail.registerChannel)) })}</p>
            <p>{t("邮箱已验证：{v}", { v: t(detail.emailConfirmed ? "是" : "否") })}</p>
            <p>{t("两步验证：{v}", { v: t(detail.twoFactorEnabled ? "已启用" : "未启用") })}</p>
            <p>{t("锁定至：{v}", { v: detail.lockoutEnd ? new Date(detail.lockoutEnd).toLocaleString() : "—" })}</p>
            <p>{t("连续失败：{n} 次", { n: detail.accessFailedCount })}</p>
            <p>{t("创建：{v}", { v: new Date(detail.createdAt).toLocaleString() })}</p>
            <p>{t("更新：{v}", { v: new Date(detail.updatedAt).toLocaleString() })}</p>
            <p className="sm:col-span-2">
              {t("身份标识：")}<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detail.id}</code>
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <span>{t("角色：")}</span>
              {detail.roles.length > 0 ? (
                detail.roles.map((role) => (
                  <Badge key={role} variant="secondary">{role}</Badge>
                ))
              ) : (
                <span>{t("无角色")}</span>
              )}
              {/* 自降级被 server 硬门禁拒绝；已注销（终态）账号拒绝一切变更——两种情况都不展示按钮。 */}
              {detail.status !== 2 && !(detail.id === me?.subject && detail.roles.includes(ADMIN_ROLE)) && (
                <ConfirmAction
                  trigger={
                    <Button variant="outline" size="sm">
                      {detail.roles.includes(ADMIN_ROLE) ? t("移除管理员") : t("设为管理员")}
                    </Button>
                  }
                  title={detail.roles.includes(ADMIN_ROLE)
                    ? t("移除用户 {name} 的管理员角色？", { name: detail.userName })
                    : t("授予用户 {name} 的管理员角色？", { name: detail.userName })}
                  description={t("变更将吊销其全部令牌（立即生效）。")}
                  confirmLabel={detail.roles.includes(ADMIN_ROLE) ? t("移除管理员") : t("设为管理员")}
                  successMessage={t("角色已更新")}
                  onConfirm={() => confirmToggleAdminRole(detail)}
                />
              )}
            </div>
            {/* 已注销账号详情只读：server 侧对所有变更端点都有终态守卫，这里同样收起操作。 */}
            {detail.status !== 2 && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button variant="outline" size="sm" onClick={() => openProfileEditor(detail)}>
                  {t("编辑资料")}
                </Button>
                {isLocked(detail) && (
                  <ConfirmAction
                    trigger={
                      <Button variant="outline" size="sm">
                        {t("解锁")}
                      </Button>
                    }
                    title={t("解锁用户 {name}？", { name: detail.userName })}
                    description={t("将清除临时锁定与连续失败计数。")}
                    confirmLabel={t("解锁")}
                    successMessage={t("已解锁")}
                    onConfirm={() => confirmUnlock(detail)}
                  />
                )}
                {detail.twoFactorEnabled && (
                  <ConfirmAction
                    trigger={
                      <Button variant="outline" size="sm">
                        {t("重置两步验证")}
                      </Button>
                    }
                    title={t("重置用户 {name} 的两步验证？", { name: detail.userName })}
                    description={detail.id === me?.subject
                      ? t("将关闭 2FA 并吊销其全部令牌（该账号会被强制下线，包括你当前的管理台会话）。")
                      : t("将关闭 2FA 并吊销其全部令牌（该账号会被强制下线）。")}
                    confirmLabel={t("重置两步验证")}
                    successMessage={t("两步验证已重置")}
                    onConfirm={() => confirmResetTwoFactor(detail)}
                  />
                )}
                {/* 踢下线(#30):对自己隐藏(server 侧硬封禁;自助登出已覆盖)。 */}
                {detail.id !== me?.subject && (
                  <ConfirmAction
                    trigger={
                      <Button variant="outline" size="sm">
                        {t("下线全部会话")}
                      </Button>
                    }
                    title={t("将用户 {name} 的全部会话下线？", { name: detail.userName })}
                    description={t("仅吊销其全部令牌（立即生效），账号状态与凭据不变；该用户需重新登录才能再访问。")}
                    confirmLabel={t("下线全部会话")}
                    successMessage={t("已下线全部会话")}
                    onConfirm={() => confirmRevokeTokens(detail)}
                  />
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
                    {t("注销账号")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 在线会话(#30 后半):只读,Valid refresh_token;独立加载与刷新。 */}
      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("在线会话")}</CardTitle>
            <CardDescription>{t("该账号当前有效的登录会话(refresh token)；短时访问令牌不在此列。只读视图。")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessionsError ? (
              <p role="alert" className="text-sm text-destructive">{sessionsError}</p>
            ) : sessions === null ? (
              <p role="status" className="text-sm text-muted-foreground">{t("正在加载会话…")}</p>
            ) : sessions.length > 0 ? (
              <div className="overflow-x-auto rounded border">
                <Table className="w-full text-left text-sm">
                  <TableHeader className="bg-muted/50 text-muted-foreground">
                    <TableRow>
                      <TableHead className="px-3 py-2 font-medium">{t("客户端")}</TableHead>
                      <TableHead className="px-3 py-2 font-medium">{t("创建时间")}</TableHead>
                      <TableHead className="px-3 py-2 font-medium">{t("过期时间")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session) => (
                      <TableRow key={session.id} className="border-t">
                        <TableCell className="px-3 py-2 font-mono text-xs">{session.clientId ?? "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-muted-foreground">
                          {session.creationDate ? new Date(session.creationDate).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-muted-foreground">
                          {session.expirationDate ? new Date(session.expirationDate).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("暂无有效会话。")}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={sessions === null && sessionsError === null}
              onClick={() => { void queryClient.invalidateQueries({ queryKey: ["users-sessions", detail.id] }) }}
            >
              {t("刷新")}
            </Button>
          </CardContent>
        </Card>
      )}

      {detail && editingProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("编辑资料 · {name}", { name: detail.userName })}</CardTitle>
            <CardDescription>
              {t("保存后该用户全部令牌立即失效。邮箱变更会重置「邮箱已验证」；留空即清空该字段。")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-email">{t("邮箱")}</Label>
              <Input
                id="profile-email"
                type="email"
                value={profileDraft.email}
                onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-nickname">{t("昵称")}</Label>
              <Input
                id="profile-nickname"
                value={profileDraft.nickname}
                onChange={(event) => setProfileDraft({ ...profileDraft, nickname: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-region">{t("区域")}</Label>
              <Input
                id="profile-region"
                value={profileDraft.region}
                onChange={(event) => setProfileDraft({ ...profileDraft, region: event.target.value })}
              />
            </div>
            <div className="flex gap-2 self-end">
              <Button disabled={busy} onClick={() => void submitProfile()}>
                {t("保存")}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setEditingProfile(false)}>
                {t("取消")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("自定义 Claims")}</CardTitle>
            <CardDescription>
              {t("仅允许 panda: 命名空间；Claim 只有在客户端申请对应 scope 时才会进入 Token。添加和删除需要近期完成 WebAuthn。")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {claims.length > 0 ? (
              <div className="overflow-x-auto rounded border">
                <Table className="w-full text-left text-sm">
                  <TableHeader className="bg-muted/50 text-muted-foreground">
                    <TableRow>
                      <TableHead className="px-3 py-2 font-medium">{t("类型")}</TableHead>
                      <TableHead className="px-3 py-2 font-medium">{t("值")}</TableHead>
                      <TableHead className="px-3 py-2 font-medium">Scope</TableHead>
                      <TableHead className="px-3 py-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => (
                      <TableRow key={claim.id} className="border-t">
                        <TableCell className="px-3 py-2 font-mono text-xs">{claim.claimType}</TableCell>
                        <TableCell className="px-3 py-2">{claim.claimValue}</TableCell>
                        <TableCell className="px-3 py-2 font-mono text-xs">{claim.scope}</TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <ConfirmAction
                            trigger={
                              <Button variant="outline" size="sm">
                                {t("删除")}
                              </Button>
                            }
                            title={t("删除 Claim {type}？", { type: claim.claimType })}
                            description={t("删除后即刻生效；添加和删除 Claim 都会记录管理审计。")}
                            confirmLabel={t("删除")}
                            successMessage={t("Claim 已删除")}
                            onConfirm={() => confirmRemoveClaim(claim)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("暂无自定义 Claims。")}</p>
            )}
            {detail.status !== 2 && (
              <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-type">{t("类型")}</Label>
                  <Input id="claim-type" value={claimDraft.claimType} onChange={(event) => setClaimDraft({ ...claimDraft, claimType: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-value">{t("值")}</Label>
                  <Input id="claim-value" value={claimDraft.claimValue} onChange={(event) => setClaimDraft({ ...claimDraft, claimValue: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="claim-scope">Scope</Label>
                  <Input id="claim-scope" value={claimDraft.scope} onChange={(event) => setClaimDraft({ ...claimDraft, scope: event.target.value })} />
                </div>
                <Button disabled={claimsBusy || busy} onClick={() => void addClaim()}>{t("添加")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 注销(#28):保留「原样输入用户名」防误触语义,window.prompt 换 Dialog+Input;结果走 notify。 */}
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
            <DialogTitle>{t("注销账号 {name}？", { name: deactivateTarget?.userName ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("注销为不可恢复操作：账号将无法登录、全部会话立即失效，管理台不提供恢复入口。")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="deactivate-confirm">{t("如确认，请原样输入该用户的用户名")}</Label>
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
              {t("取消")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || deactivateTarget === null || deactivateInput !== deactivateTarget.userName}
              onClick={() => deactivateTarget && void deactivate(deactivateTarget)}
            >
              {t("注销账号")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
