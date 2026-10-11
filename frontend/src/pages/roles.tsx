import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { apiGet, apiSend, type ClaimRequest, type PageResult, type RoleClaim, type RoleSummary } from "@/lib/api"
import { clearDraft, consumeDraft, saveDraft } from "@/lib/drafts"

const EMPTY_CLAIM: ClaimRequest = { claimType: "panda:", claimValue: "", scope: "api" }

function claimsPath(roleId: string): string {
  return `/admin/api/roles/${encodeURIComponent(roleId)}/claims`
}

/**
 * 角色目录只读；此页只管理已存在角色的自定义 Claims。
 * 搜索/分页/选中角色进 URL(#27);选中角色由 role 参数驱动,参数清空即收起 Claims 面板。
 * Claim 草稿经 sessionStorage 暂存(#26):添加命中 MFA step-up 后回到同一角色自动恢复。
 */
export default function RolesPage() {
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

  const [result, setResult] = useState<PageResult<RoleSummary> | null>(null)
  const [claims, setClaims] = useState<RoleClaim[]>([])
  const [claimDraft, setClaimDraft] = useState<ClaimRequest>(EMPTY_CLAIM)
  const [error, setError] = useState<string | null>(null)
  const [claimsBusy, setClaimsBusy] = useState(false)
  const [claimsLoading, setClaimsLoading] = useState(false)
  const [claimsError, setClaimsError] = useState<string | null>(null)
  const [claimPendingDelete, setClaimPendingDelete] = useState<RoleClaim | null>(null)
  const loadSeq = useRef(0)
  const claimsSeq = useRef(0)
  const pageSize = 20

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (query.trim()) params.set("query", query.trim())
      const data = await apiGet<PageResult<RoleSummary>>(`/admin/api/roles?${params}`)
      if (seq !== loadSeq.current) return
      setResult(data)
      // 选中的角色从目录里消失(搜索过滤/数据变更):清参数收起面板,旧 Claims 响应作废。
      if (roleId && !data.items.some((role) => role.id === roleId)) {
        claimsSeq.current++
        updateParams({ role: null }, { replace: true })
        setClaims([])
        setClaimsLoading(false)
        setClaimsError(null)
      }
    } catch (cause) {
      if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "加载失败")
    }
  }, [page, query, roleId, updateParams])

  useEffect(() => {
    void load()
  }, [load])

  // 选中角色的 Claims 由 URL 驱动(#27):role 参数变化即加载,清空即收起。
  useEffect(() => {
    if (!roleId) {
      claimsSeq.current++
      setClaims([])
      setClaimsLoading(false)
      setClaimsError(null)
      return
    }
    const seq = ++claimsSeq.current
    setClaims([])
    setClaimsLoading(true)
    setClaimsError(null)
    void (async () => {
      try {
        const data = await apiGet<RoleClaim[]>(claimsPath(roleId))
        if (seq !== claimsSeq.current) return
        setClaims(data)
        // MFA step-up 草稿恢复(#26):草稿带 roleId,只有回到同一角色才恢复(consume 即弃)。
        const saved = consumeDraft<{ roleId: string; draft: ClaimRequest }>("roles.claim")
        if (saved && saved.roleId === roleId) setClaimDraft(saved.draft)
      } catch (cause) {
        if (seq === claimsSeq.current) setClaimsError(cause instanceof Error ? cause.message : "Claims 加载失败")
      } finally {
        if (seq === claimsSeq.current) setClaimsLoading(false)
      }
    })()
  }, [roleId])

  async function addClaim() {
    if (!roleId) return
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
    saveDraft("roles.claim", { roleId, draft: claimDraft })
    try {
      setError(null)
      const created = await apiSend<RoleClaim>("POST", claimsPath(roleId), request)
      clearDraft("roles.claim")
      setClaims((items) => [...items, created])
      setClaimDraft(EMPTY_CLAIM)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加 Claim 失败")
    } finally {
      setClaimsBusy(false)
    }
  }

  async function removeClaim(claim: RoleClaim) {
    if (!roleId) return
    setClaimsBusy(true)
    try {
      setError(null)
      await apiSend("DELETE", `${claimsPath(roleId)}/${claim.id}`)
      setClaims((items) => items.filter((item) => item.id !== claim.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除 Claim 失败")
    } finally {
      setClaimsBusy(false)
      setClaimPendingDelete(null)
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="query">搜索角色</Label>
          <Input
            id="query"
            className="w-64"
            value={query}
            onChange={(event) => updateParams({ q: event.target.value, page: null }, { replace: true })}
            placeholder="输入即搜索"
          />
        </div>
        {result && <span className="pb-2 text-sm text-muted-foreground">共 {result.total} 个角色</span>}
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">角色目录</CardTitle>
          <CardDescription>选择角色以查看和管理其自定义 Claims。</CardDescription>
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
            {result && result.items.length === 0 && <p className="text-sm text-muted-foreground">没有匹配的角色</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">第 {page} / {totalPages} 页</span>
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

      {roleId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">自定义 Claims · {result?.items.find((role) => role.id === roleId)?.name ?? roleId}</CardTitle>
            <CardDescription>仅允许 panda: 命名空间；添加和删除需要近期完成 WebAuthn。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {claimsLoading ? (
              <p className="text-sm text-muted-foreground">正在加载 Claims…</p>
            ) : claimsError ? (
              <p className="text-destructive">{claimsError}</p>
            ) : claims.length > 0 ? (
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr><th className="px-3 py-2">类型</th><th className="px-3 py-2">值</th><th className="px-3 py-2">Scope</th><th className="px-3 py-2" /></tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => (
                      <tr key={claim.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{claim.claimType}</td>
                        <td className="px-3 py-2">{claim.claimValue}</td>
                        <td className="px-3 py-2 font-mono text-xs">{claim.scope}</td>
                        <td className="px-3 py-2 text-right"><Button variant="outline" size="sm" disabled={claimsBusy} onClick={() => setClaimPendingDelete(claim)}>删除</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">暂无自定义 Claims。</p>}
            {!claimsLoading && !claimsError && (
              <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end">
                <div className="grid gap-1.5"><Label htmlFor="claim-type">类型</Label><Input id="claim-type" value={claimDraft.claimType} onChange={(event) => setClaimDraft({ ...claimDraft, claimType: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="claim-value">值</Label><Input id="claim-value" value={claimDraft.claimValue} onChange={(event) => setClaimDraft({ ...claimDraft, claimValue: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="claim-scope">Scope</Label><Input id="claim-scope" value={claimDraft.scope} onChange={(event) => setClaimDraft({ ...claimDraft, scope: event.target.value })} /></div>
                <Button disabled={claimsBusy} onClick={() => void addClaim()}>添加</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 删除确认(#28):window.confirm 换 AlertDialog。 */}
      <AlertDialog open={claimPendingDelete !== null} onOpenChange={(open) => !open && setClaimPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Claim {claimPendingDelete?.claimType}？</AlertDialogTitle>
            <AlertDialogDescription>删除后即刻生效；添加和删除 Claim 都会记录管理审计。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => claimPendingDelete && void removeClaim(claimPendingDelete)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
