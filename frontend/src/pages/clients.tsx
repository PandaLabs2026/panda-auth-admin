import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import ConfirmAction from "@/components/patterns/ConfirmAction"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { serverError, apiGet, apiSend, type ClientDetail, type ClientOptions, type ClientSummary, type PageResult } from "@/lib/api"
import { clearDraft, consumeDraft, saveDraft } from "@/lib/drafts"
import { notify } from "@/lib/notify"
import { useI18n } from "@/lib/i18n"

/** 白名单与权限勾选的草稿形态(#26):按 clientId 匹配恢复。 */
type ClientDraft = {
  redirectUris: string
  postLogoutUris: string
  permissions: string[]
}

/** 写操作失败的统一出口:服务端原文/en 词典译码后交给 notify 驻留展示。 */
function toUserMessage(cause: unknown): Error {
  return new Error(serverError(cause))
}

/**
 * 客户端管理（0.3）：列表 / 详情 / 回调与登出白名单编辑 / 权限编辑（目录复选） / 密钥轮换。
 * 白名单与权限都是**整体替换**语义（与 server 的 upsert 口径一致）。
 * 选中客户端进 URL(#27);白名单/权限草稿经 sessionStorage 暂存(#26),MFA step-up 返回后恢复。
 * 保存/轮换结果统一走 notify(模板反馈约定);轮换确认经 ConfirmAction(第一方连带后果完整展示)。
 */
export default function ClientsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const clientId = searchParams.get("client")

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

  const [redirectUris, setRedirectUris] = useState("")
  const [postLogoutUris, setPostLogoutUris] = useState("")
  const [permissions, setPermissions] = useState<Set<string>>(new Set())
  const [secretNotice, setSecretNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 读侧经 useQuery(P3 迁移):目录/选项常驻,详情键=[clientId](键语义取代乱序守卫——
  // 慢的旧详情只写进旧键缓存,不会覆盖新选中)。
  const listQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiGet<PageResult<ClientSummary>>("/admin/api/clients"),
    retry: false,
  })
  const optionsQuery = useQuery({
    queryKey: ["clients-options"],
    queryFn: () => apiGet<ClientOptions>("/admin/api/clients/options"),
    retry: false,
  })
  const detailQuery = useQuery({
    queryKey: ["clients-detail", clientId],
    queryFn: () => apiGet<ClientDetail>(`/admin/api/clients/${encodeURIComponent(clientId!)}`),
    enabled: clientId !== null,
    retry: false,
  })
  const list = listQuery.data ?? null
  const listError = listQuery.error ? serverError(listQuery.error) : null
  const options = optionsQuery.data ?? null
  const optionsError = optionsQuery.error ? serverError(optionsQuery.error) : null
  const selected = (clientId ? detailQuery.data : undefined) ?? null
  const detailError = detailQuery.error ? serverError(detailQuery.error) : null
  const shownError = detailError

  // 详情落地(含保存后失效重取)同步表单;MFA step-up 草稿恢复(#26)带 clientId 匹配(consume 即弃)。
  useEffect(() => {
    if (!detailQuery.data) return
    const saved = consumeDraft<{ clientId: string; draft: ClientDraft }>("clients.form")
    if (saved && saved.clientId === detailQuery.data.clientId) {
      setRedirectUris(saved.draft.redirectUris)
      setPostLogoutUris(saved.draft.postLogoutUris)
      setPermissions(new Set(saved.draft.permissions))
      return
    }
    setRedirectUris(detailQuery.data.redirectUris.join("\n"))
    setPostLogoutUris(detailQuery.data.postLogoutRedirectUris.join("\n"))
    setPermissions(new Set(detailQuery.data.permissions))
  }, [detailQuery.data])

  function splitUris(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  async function saveUris() {
    if (!selected) return
    setBusy(true)
    saveDraft("clients.form", { clientId: selected.clientId, draft: { redirectUris, postLogoutUris, permissions: [...permissions] } })
    try {
      const updated = await apiSend<ClientDetail>("PUT", `/admin/api/clients/${selected.clientId}/redirect-uris`, {
        redirectUris: splitUris(redirectUris),
        postLogoutRedirectUris: splitUris(postLogoutUris),
      })
      clearDraft("clients.form")
      queryClient.setQueryData(["clients-detail", clientId], updated)
      notify.success(t("白名单已更新。"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function savePermissions() {
    if (!selected) return
    setBusy(true)
    saveDraft("clients.form", { clientId: selected.clientId, draft: { redirectUris, postLogoutUris, permissions: [...permissions] } })
    try {
      const updated = await apiSend<ClientDetail>("PUT", `/admin/api/clients/${selected.clientId}/permissions`, {
        permissions: [...permissions],
      })
      clearDraft("clients.form")
      queryClient.setQueryData(["clients-detail", clientId], updated)
      notify.success(t("权限已更新。"))
    } catch (cause) {
      notify.failure(toUserMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function rotateSecret() {
    if (!selected) return
    try {
      const response = await apiSend<{ clientSecret: string }>("POST", `/admin/api/clients/${selected.clientId}/rotate-secret`)
      // 一次性密钥不走 toast(3s 自动消失):常驻卡片展示,显式关闭才消失。
      setSecretNotice(response.clientSecret)
    } catch (cause) {
      throw toUserMessage(cause)
    }
  }

  const isFirstParty = selected?.clientId === "admin-web" || selected?.clientId === "me-web"

  return (
    <div className="space-y-6">
      {listError && <p role="alert" className="text-destructive">{listError}</p>}
      {shownError && <p role="alert" className="text-destructive">{shownError}</p>}

      {secretNotice && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="text-warning">{t("新密钥（仅显示一次）：")}</span>
          <code className="rounded bg-card px-2 py-1 font-mono text-base dark:bg-muted">{secretNotice}</code>
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setSecretNotice(null)}>
            {t("关闭")}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("客户端（{total}）", { total: list?.total ?? (listError ? "—" : "…") })}</CardTitle>
          <CardDescription>{t("点击查看与编辑；机密客户端（confidential）持有密钥，公共客户端（public）依赖 PKCE。")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[48rem] text-sm">
            <TableHeader>
              <TableRow className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <TableHead className="px-4 py-3 font-medium">Client ID</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("名称")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("类型")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("授权方式")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list?.items ?? []).map((client) => (
                <TableRow
                  key={client.clientId}
                  className={`cursor-pointer border-b last:border-0 hover:bg-muted/20 ${clientId === client.clientId ? "bg-primary/5" : ""}`}
                  onClick={() => updateParams({ client: client.clientId })}
                >
                  <TableCell className="px-4 py-3 font-mono text-xs">{client.clientId}</TableCell>
                  <TableCell className="px-4 py-3">{client.displayName ?? "—"}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{client.clientType}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{client.consentType}</TableCell>
                </TableRow>
              ))}
              {/* 加载与空态区分(#31):此前 clients 表既无加载态也无空态。 */}
              {!list && !listError && (
                <TableRow>
                  <TableCell colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {t("正在加载…")}
                  </TableCell>
                </TableRow>
              )}
              {list && list.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {t("没有客户端")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("回调 / 登出白名单 · {id}", { id: selected.clientId })}</CardTitle>
              <CardDescription>{t("每行一个 URL；保存为整体替换。")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="redirect">{t("RedirectUris（至少一条）")}</Label>
                <div className="min-w-0 overflow-x-auto">
                  <Textarea
                    id="redirect"
                    className="min-h-28 min-w-0 font-mono text-xs"
                    value={redirectUris}
                    onChange={(event) => setRedirectUris(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="postlogout">PostLogoutRedirectUris</Label>
                <div className="min-w-0 overflow-x-auto">
                  <Textarea
                    id="postlogout"
                    className="min-h-28 min-w-0 font-mono text-xs"
                    value={postLogoutUris}
                    onChange={(event) => setPostLogoutUris(event.target.value)}
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <Button size="sm" disabled={busy} onClick={() => void saveUris()}>
                  {t("保存白名单")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("权限")}</CardTitle>
              <CardDescription>{t("复选即启用；保存为整体替换，服务端校验未知形态。")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {optionsError ? (
                <p role="alert" className="text-sm text-destructive">{optionsError}</p>
              ) : (
                (options?.permissionGroups ?? []).map((group) => (
                  <div key={group.group}>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">{group.group}</p>
                    <div className="flex flex-wrap gap-3">
                      {group.options.map((permission) => (
                        <label key={permission} className="flex items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={permissions.has(permission)}
                            onCheckedChange={(checked) => {
                              const next = new Set(permissions)
                              if (checked === true) next.add(permission)
                              else next.delete(permission)
                              setPermissions(next)
                            }}
                          />
                          <code>{permission}</code>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
              {(selected.requirements ?? []).length > 0 && (
                <p className="text-xs text-muted-foreground">{t("既有要求（只读）：{list}", { list: selected.requirements.join("、") })}</p>
              )}
              <Button size="sm" disabled={busy} onClick={() => void savePermissions()}>
                {t("保存权限")}
              </Button>
            </CardContent>
          </Card>

          {selected.clientType === "confidential" && (
            <Card className="border-warning/40">
              <CardHeader>
                <CardTitle className="text-base text-warning">{t("密钥轮换")}</CardTitle>
                <CardDescription>
                  {t("生成 32 字节随机密钥，明文只显示一次；旧密钥立即作废。第一方客户端（admin-web / me-web）轮换后须同步服务器 env 并重跑迁移对账。")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConfirmAction
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy}>
                      {t("轮换密钥")}
                    </Button>
                  }
                  title={t("轮换 {id} 的密钥？", { id: selected.clientId })}
                  description={
                    t("旧密钥立即作废，新密钥仅显示一次。") +
                    (isFirstParty
                      ? t("⚠️ 这是第一方客户端：须同步更新服务器 env 并重跑 --migrate，否则其登录会全部失败！")
                      : t("依赖旧密钥的集成需尽快更新。"))
                  }
                  confirmLabel={t("轮换密钥")}
                  successMessage={t("密钥已轮换")}
                  onConfirm={rotateSecret}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
