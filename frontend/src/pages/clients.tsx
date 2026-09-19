import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { apiGet, apiSend, type ClientDetail, type ClientOptions, type ClientSummary, type PageResult } from "@/lib/api"

/**
 * 客户端管理（0.3）：列表 / 详情 / 回调与登出白名单编辑 / 权限编辑（目录复选） / 密钥轮换。
 * 白名单与权限都是**整体替换**语义（与 server 的 upsert 口径一致）；保存前展示确认。
 */
export default function ClientsPage() {
  const [list, setList] = useState<PageResult<ClientSummary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ClientDetail | null>(null)
  const [options, setOptions] = useState<ClientOptions | null>(null)
  const [redirectUris, setRedirectUris] = useState("")
  const [postLogoutUris, setPostLogoutUris] = useState("")
  const [permissions, setPermissions] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<PageResult<ClientSummary>>("/admin/api/clients").then(setList).catch(() => setList(null))
    apiGet<ClientOptions>("/admin/api/clients/options")
      .then(setOptions)
      .catch(() => setOptions(null))
  }, [])

  const select = useCallback(async (clientId: string) => {
    try {
      setError(null)
      setNotice(null)
      const detail = await apiGet<ClientDetail>(`/admin/api/clients/${clientId}`)
      setSelected(detail)
      setRedirectUris(detail.redirectUris.join("\n"))
      setPostLogoutUris(detail.postLogoutRedirectUris.join("\n"))
      setPermissions(new Set(detail.permissions))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "详情加载失败")
    }
  }, [])

  function splitUris(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  async function saveUris() {
    if (!selected) return
    setBusy(true)
    try {
      const updated = await apiSend<ClientDetail>("PUT", `/admin/api/clients/${selected.clientId}/redirect-uris`, {
        redirectUris: splitUris(redirectUris),
        postLogoutRedirectUris: splitUris(postLogoutUris),
      })
      setSelected(updated)
      setNotice("白名单已更新。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function savePermissions() {
    if (!selected) return
    setBusy(true)
    try {
      const updated = await apiSend<ClientDetail>("PUT", `/admin/api/clients/${selected.clientId}/permissions`, {
        permissions: [...permissions],
      })
      setSelected(updated)
      setNotice("权限已更新。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function rotateSecret() {
    if (!selected) return
    if (
      !window.confirm(
        `轮换 ${selected.clientId} 的密钥？旧密钥立即作废。` +
          (selected.clientId === "admin-web" || selected.clientId === "me-web"
            ? "⚠️ 这是第一方客户端：须同步更新服务器 env 并重跑 --migrate，否则其登录会全部失败！"
            : ""),
      )
    ) {
      return
    }

    setBusy(true)
    try {
      const response = await apiSend<{ clientSecret: string }>("POST", `/admin/api/clients/${selected.clientId}/rotate-secret`)
      setNotice(`新密钥（仅显示一次）：${response.clientSecret}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "轮换失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-destructive">{error}</p>}
      {notice && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">客户端（{list?.total ?? "…"}）</CardTitle>
          <CardDescription>点击查看与编辑；机密客户端（confidential）持有密钥，公共客户端（public）依赖 PKCE。</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Client ID</th>
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">授权方式</th>
              </tr>
            </thead>
            <tbody>
              {(list?.items ?? []).map((client) => (
                <tr
                  key={client.clientId}
                  className={`cursor-pointer border-b last:border-0 hover:bg-muted/20 ${selected?.clientId === client.clientId ? "bg-primary/5" : ""}`}
                  onClick={() => void select(client.clientId)}
                >
                  <td className="px-4 py-3 font-mono text-xs">{client.clientId}</td>
                  <td className="px-4 py-3">{client.displayName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.clientType}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.consentType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">回调 / 登出白名单 · {selected.clientId}</CardTitle>
              <CardDescription>每行一个 URL；保存为整体替换。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="redirect">RedirectUris（至少一条）</Label>
                <textarea
                  id="redirect"
                  className="min-h-28 rounded-md border bg-background p-2 font-mono text-xs"
                  value={redirectUris}
                  onChange={(event) => setRedirectUris(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="postlogout">PostLogoutRedirectUris</Label>
                <textarea
                  id="postlogout"
                  className="min-h-28 rounded-md border bg-background p-2 font-mono text-xs"
                  value={postLogoutUris}
                  onChange={(event) => setPostLogoutUris(event.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Button size="sm" disabled={busy} onClick={() => void saveUris()}>
                  保存白名单
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">权限</CardTitle>
              <CardDescription>复选即启用；保存为整体替换，服务端校验未知形态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(options?.permissionGroups ?? []).map((group) => (
                <div key={group.group}>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{group.group}</p>
                  <div className="flex flex-wrap gap-3">
                    {group.options.map((permission) => (
                      <label key={permission} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={permissions.has(permission)}
                          onChange={(event) => {
                            const next = new Set(permissions)
                            if (event.target.checked) next.add(permission)
                            else next.delete(permission)
                            setPermissions(next)
                          }}
                        />
                        <code>{permission}</code>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {(selected.requirements ?? []).length > 0 && (
                <p className="text-xs text-muted-foreground">既有要求（只读）：{selected.requirements.join("、")}</p>
              )}
              <Button size="sm" disabled={busy} onClick={() => void savePermissions()}>
                保存权限
              </Button>
            </CardContent>
          </Card>

          {selected.clientType === "confidential" && (
            <Card className="border-amber-300 dark:border-amber-600">
              <CardHeader>
                <CardTitle className="text-base text-amber-800 dark:text-amber-300">密钥轮换</CardTitle>
                <CardDescription>
                  生成 32 字节随机密钥，明文只显示一次；旧密钥立即作废。第一方客户端（admin-web / me-web）轮换后须同步服务器 env 并重跑迁移对账。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void rotateSecret()}>
                  轮换密钥
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
