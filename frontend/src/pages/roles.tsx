import { useAuthLeaveGuard } from "@/components/patterns/auth/context"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import ConfirmAction from "@/components/patterns/ConfirmAction"
import FilterToolbar from "@/components/patterns/FilterToolbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { serverError, apiGet, apiSend, type ClaimRequest, type PageResult, type RoleClaim, type RoleSummary } from "@/lib/api"
import { clearDraft, consumeDraft, saveDraft } from "@/lib/drafts"
import { notify } from "@/lib/notify"
import { useI18n } from "@/lib/i18n"

const EMPTY_CLAIM: ClaimRequest = { claimType: "panda:", claimValue: "", scope: "api" }

function claimsPath(roleId: string): string {
  return `/admin/api/roles/${encodeURIComponent(roleId)}/claims`
}

/** 写操作失败的统一出口:服务端原文/en 词典译码后交给 notify 驻留展示。 */
function toUserMessage(cause: unknown): Error {
  return new Error(serverError(cause))
}

/**
 * 角色目录只读；此页只管理已存在角色的自定义 Claims。
 * 搜索/分页/选中角色进 URL(#27;搜索经模板 FilterToolbar 节流落 URL);
 * 选中角色由 role 参数驱动,参数清空即收起 Claims 面板。
 * Claim 草稿经 sessionStorage 暂存(#26):添加命中 MFA step-up 后回到同一角色自动恢复。
 * 删除确认走模板 ConfirmAction,结果反馈统一经 notify。
 */
export default function RolesPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [claimDraft, setClaimDraft] = useState<ClaimRequest>(EMPTY_CLAIM)
  const [claimsBusy, setClaimsBusy] = useState(false)
  useAuthLeaveGuard(JSON.stringify(claimDraft) !== JSON.stringify(EMPTY_CLAIM), "未保存的角色声明")
  useAuthLeaveGuard(claimsBusy, "进行中的角色操作")
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get("q") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const roleId = searchParams.get("role")

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

  const pageSize = 20

  // 读侧经 useQuery(P3 迁移):目录键=[page,q],Claims 键=[roleId];键语义取代乱序守卫。
  const listQuery = useQuery({
    queryKey: ["roles", page, query],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (query.trim()) params.set("query", query.trim())
      return apiGet<PageResult<RoleSummary>>(`/admin/api/roles?${params}`)
    },
    retry: false,
  })
  const result = listQuery.data ?? null
  const error = listQuery.error ? serverError(listQuery.error) : null

  // 选中角色的 Claims 由 URL 驱动(#27):role 参数变化即取,清空即无查询。
  const claimsQuery = useQuery({
    queryKey: ["roles-claims", roleId],
    queryFn: () => apiGet<RoleClaim[]>(claimsPath(roleId!)),
    enabled: roleId !== null,
    retry: false,
  })
  const claims = claimsQuery.data ?? []
  const claimsLoading = roleId !== null && claimsQuery.isPending
  const claimsError = claimsQuery.error ? serverError(claimsQuery.error) : null

  // MFA step-up 草稿恢复(#26):Claims 首次落到某角色时消费(consume 即弃,带 roleId 匹配)。
  useEffect(() => {
    if (!roleId || !claimsQuery.data) return
    const saved = consumeDraft<{ roleId: string; draft: ClaimRequest }>("roles.claim")
    if (saved && saved.roleId === roleId) setClaimDraft(saved.draft)
  }, [roleId, claimsQuery.data])

  // 选中的角色从目录里消失(搜索过滤/数据变更):清参数收起面板,旧 Claims 缓存随之作废。
  useEffect(() => {
    if (roleId && result && !result.items.some((role) => role.id === roleId)) {
      updateParams({ role: null }, { replace: true })
    }
  }, [roleId, result, updateParams])

  // 筛选变化回第一页(FilterToolbar 只管自己的键,翻页参数归页面管)。
  const pageRef = useRef(page)
  pageRef.current = page
  useEffect(() => {
    if (pageRef.current !== 1) updateParams({ page: null }, { replace: true })
  }, [query, updateParams])

  async function addClaim() {
    if (!roleId) return
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
    saveDraft("roles.claim", { roleId, draft: claimDraft })
    try {
      await apiSend<RoleClaim>("POST", claimsPath(roleId), request)
      clearDraft("roles.claim")
      setClaimDraft(EMPTY_CLAIM)
      await queryClient.invalidateQueries({ queryKey: ["roles-claims", roleId] })
      notify.success(t("Claim 已添加"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setClaimsBusy(false)
    }
  }

  async function removeClaim(claim: RoleClaim) {
    if (!roleId) return
    try {
      await apiSend("DELETE", `${claimsPath(roleId)}/${claim.id}`)
      await queryClient.invalidateQueries({ queryKey: ["roles-claims", roleId] })
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  return (
    <div className="space-y-6">
      <FilterToolbar
        searchPlaceholder={t("搜索角色")}
        right={result && <span className="text-sm text-muted-foreground">{t("共 {total} 个角色", { total: result.total })}</span>}
      />

      {error && <p role="alert" className="text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("角色目录")}</CardTitle>
          <CardDescription>{t("选择角色以查看和管理其自定义 Claims。")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(result?.items ?? []).map((role) => (
              <Button
                key={role.id}
                variant={roleId === role.id ? "default" : "outline"}
                disabled={claimsBusy}
                onClick={() => updateParams({ role: role.id })}
              >
                {role.name}
              </Button>
            ))}
            {/* 加载与空态区分(#31)。 */}
            {!result && !error && <p role="status" className="text-sm text-muted-foreground">{t("正在加载…")}</p>}
            {result && result.items.length === 0 && <p className="text-sm text-muted-foreground">{t("没有匹配的角色")}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("第 {page} / {totalPages} 页", { page, totalPages })}</span>
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

      {roleId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("自定义 Claims · {name}", { name: result?.items.find((role) => role.id === roleId)?.name ?? roleId })}</CardTitle>
            <CardDescription>{t("仅允许 panda: 命名空间；添加和删除需验证认证器验证码与当前密码。")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {claimsLoading ? (
              <p role="status" className="text-sm text-muted-foreground">{t("正在加载 Claims…")}</p>
            ) : claimsError ? (
              <p role="alert" className="text-destructive">{claimsError}</p>
            ) : claims.length > 0 ? (
              <div className="overflow-x-auto rounded border">
                <Table className="w-full text-left text-sm">
                  <TableHeader className="bg-muted/50 text-muted-foreground">
                    <TableRow><TableHead className="px-3 py-2">{t("类型")}</TableHead><TableHead className="px-3 py-2">{t("值")}</TableHead><TableHead className="px-3 py-2">Scope</TableHead><TableHead className="px-3 py-2" /></TableRow>
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
                            onConfirm={() => removeClaim(claim)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : <p className="text-sm text-muted-foreground">{t("暂无自定义 Claims。")}</p>}
            {!claimsLoading && !claimsError && (
              <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end">
                <div className="grid gap-1.5"><Label htmlFor="claim-type">{t("类型")}</Label><Input id="claim-type" value={claimDraft.claimType} onChange={(event) => setClaimDraft({ ...claimDraft, claimType: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="claim-value">{t("值")}</Label><Input id="claim-value" value={claimDraft.claimValue} onChange={(event) => setClaimDraft({ ...claimDraft, claimValue: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="claim-scope">Scope</Label><Input id="claim-scope" value={claimDraft.scope} onChange={(event) => setClaimDraft({ ...claimDraft, scope: event.target.value })} /></div>
                <Button disabled={claimsBusy} onClick={() => void addClaim()}>{t("添加")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
