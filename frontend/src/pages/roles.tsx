import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  apiGet,
  apiSend,
  type ClaimRequest,
  type PageResult,
  type RoleClaim,
  type RoleSummary,
} from "@/lib/api"

const EMPTY_CLAIM: ClaimRequest = { claimType: "panda:", claimValue: "", scope: "api" }

/** 角色目录只读；此页只管理已存在角色的自定义 Claims。 */
export default function RolesPage() {
  const [result, setResult] = useState<PageResult<RoleSummary> | null>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<RoleSummary | null>(null)
  const [claims, setClaims] = useState<RoleClaim[]>([])
  const [claimDraft, setClaimDraft] = useState<ClaimRequest>(EMPTY_CLAIM)
  const [error, setError] = useState<string | null>(null)
  const [claimsBusy, setClaimsBusy] = useState(false)
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
      setSelected((current) => {
        if (current && !data.items.some((role) => role.id === current.id)) {
          setClaims([])
          return null
        }
        return current
      })
    } catch (cause) {
      if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "加载失败")
    }
  }, [page, query])

  useEffect(() => {
    void load()
  }, [load])

  async function selectRole(role: RoleSummary) {
    const seq = ++claimsSeq.current
    setSelected(role)
    setClaims([])
    try {
      setError(null)
      const data = await apiGet<RoleClaim[]>(`/admin/api/roles/${role.id}/claims`)
      if (seq === claimsSeq.current) setClaims(data)
    } catch (cause) {
      if (seq === claimsSeq.current) setError(cause instanceof Error ? cause.message : "Claims 加载失败")
    }
  }

  async function addClaim() {
    if (!selected) return
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
    try {
      setError(null)
      const created = await apiSend<RoleClaim>("POST", `/admin/api/roles/${selected.id}/claims`, request)
      setClaims((items) => [...items, created])
      setClaimDraft(EMPTY_CLAIM)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加 Claim 失败")
    } finally {
      setClaimsBusy(false)
    }
  }

  async function removeClaim(claim: RoleClaim) {
    if (!selected || !window.confirm(`确认删除 Claim ${claim.claimType}？`)) return
    setClaimsBusy(true)
    try {
      setError(null)
      await apiSend("DELETE", `/admin/api/roles/${selected.id}/claims/${claim.id}`)
      setClaims((items) => items.filter((item) => item.id !== claim.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除 Claim 失败")
    } finally {
      setClaimsBusy(false)
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
            onChange={(event) => {
              setPage(1)
              setQuery(event.target.value)
            }}
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
                variant={selected?.id === role.id ? "default" : "outline"}
                disabled={claimsBusy}
                onClick={() => void selectRole(role)}
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</Button>
        </div>
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">自定义 Claims · {selected.name}</CardTitle>
            <CardDescription>仅允许 panda: 命名空间；添加和删除需要近期完成 WebAuthn。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {claims.length > 0 ? (
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
                        <td className="px-3 py-2 text-right"><Button variant="outline" size="sm" disabled={claimsBusy} onClick={() => void removeClaim(claim)}>删除</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">暂无自定义 Claims。</p>}
            <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end">
              <div className="grid gap-1.5"><Label htmlFor="claim-type">类型</Label><Input id="claim-type" value={claimDraft.claimType} onChange={(event) => setClaimDraft({ ...claimDraft, claimType: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="claim-value">值</Label><Input id="claim-value" value={claimDraft.claimValue} onChange={(event) => setClaimDraft({ ...claimDraft, claimValue: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="claim-scope">Scope</Label><Input id="claim-scope" value={claimDraft.scope} onChange={(event) => setClaimDraft({ ...claimDraft, scope: event.target.value })} /></div>
              <Button disabled={claimsBusy} onClick={() => void addClaim()}>添加</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
