import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigationType, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "lucide-react"

import SemanticBadge from "@/components/semantic-badge"
import ContextPanel from "@/components/patterns/ContextPanel"
import { usePanelCloseGuard } from "@/components/patterns/context-panel-guard"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { serverError, apiGet, AUDIT_ACTION, type AdminAuditEntry, type LoginLogEntry, type PageResult } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

function useDebouncedFilter(value: string, key: string, update: (patch: Record<string, string | null>, options?: { replace?: boolean }) => void) {
  const [draft, setDraft] = useState(value)
  const location = useLocation()
  const navigation = useNavigationType()
  const previous = useRef({ value, locationKey: location.key })
  useEffect(() => {
    const changed = previous.current.value !== value
    const popped = previous.current.locationKey !== location.key && navigation === "POP"
    previous.current = { value, locationKey: location.key }
    if (changed || popped) {
      setDraft(value)
      return
    }
    if (draft === value) return
    const timer = setTimeout(() => update({ [key]: draft, page: null }, { replace: true }), 300)
    return () => clearTimeout(timer)
  }, [value, draft, key, update, location.key, navigation])
  return [draft, setDraft] as const
}

/**
 * 审计查询（0.3）：登录日志与管理操作日志双视图，只读 + 过滤 + 分页。
 * 视图/时间/维度过滤/页码全部进 URL(#27);维度过滤(#23)对齐 server 契约
 * (logins: userName/succeeded;admin: actor/action)。
 * 时间范围过滤是 datetime-local 输入,不在模板 FilterToolbar(搜索+下拉)覆盖内,保持自定义行。
 */
export default function AuditPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<{ kind: "login"; entry: LoginLogEntry } | { kind: "admin"; entry: AdminAuditEntry } | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const panelGuard = usePanelCloseGuard({ dirty: false, onClose: () => setSelected(null) })
  useEffect(() => { setSelected(null) }, [searchParams])

  const tab = searchParams.get("tab") === "admin" ? "admin" : "logins"
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""
  const userName = searchParams.get("userName") ?? ""
  const succeeded = searchParams.get("succeeded") ?? ""
  const actor = searchParams.get("actor") ?? ""
  const action = searchParams.get("action") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)

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

  const [userDraft, setUserDraft] = useDebouncedFilter(userName, "userName", updateParams)
  const [actorDraft, setActorDraft] = useDebouncedFilter(actor, "actor", updateParams)
  const [actionDraft, setActionDraft] = useDebouncedFilter(action, "action", updateParams)

  // 读侧经 useQuery(P3 迁移):query 键=URL 状态全集,URL 变即重取;Query 的键语义
  // 天然取代旧 loadSeq 乱序守卫(每次键变化都是新查询,慢的旧响应只写进旧键的缓存)。
  const pageSize = 20
  const listQuery = useQuery({
    queryKey: ["audit", tab, page, from, to, userName, succeeded, actor, action],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (from) params.set("from", new Date(from).toISOString())
      if (to) params.set("to", new Date(to).toISOString())
      if (tab === "logins") {
        if (userName.trim()) params.set("userName", userName.trim())
        if (succeeded) params.set("succeeded", succeeded)
        return apiGet<PageResult<LoginLogEntry>>(`/admin/api/audit/logins?${params}`) as Promise<PageResult<LoginLogEntry> | PageResult<AdminAuditEntry>>
      }
      if (actor.trim()) params.set("actor", actor.trim())
      if (action.trim()) params.set("action", action.trim())
      return apiGet<PageResult<AdminAuditEntry>>(`/admin/api/audit/admin?${params}`) as Promise<PageResult<LoginLogEntry> | PageResult<AdminAuditEntry>>
    },
    retry: false,
  })

  const logins = tab === "logins" ? (listQuery.data as PageResult<LoginLogEntry> | undefined) ?? null : null
  const admin = tab === "admin" ? (listQuery.data as PageResult<AdminAuditEntry> | undefined) ?? null : null
  const error = listQuery.error ? serverError(listQuery.error) : null

  const result = tab === "logins" ? logins : admin
  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {/* 视图切换(#29):radix Tabs 接管无障碍(role=tablist/aria-selected/键盘导航)。 */}
        <Tabs value={tab} onValueChange={(value) => updateParams({ tab: value, page: null })}>
          <TabsList>
            <TabsTrigger value="logins">{t("登录日志")}</TabsTrigger>
            <TabsTrigger value="admin">{t("管理日志")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-1.5">
          <Label htmlFor="from">{t("起（本地时区）")}</Label>
          <Input
            id="from"
            type="datetime-local"
            className="w-56"
            value={from}
            onChange={(event) => updateParams({ from: event.target.value, page: null }, { replace: true })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">{t("止（本地时区）")}</Label>
          <Input
            id="to"
            type="datetime-local"
            className="w-56"
            value={to}
            onChange={(event) => updateParams({ to: event.target.value, page: null }, { replace: true })}
          />
        </div>
        {tab === "logins" ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-user">{t("用户")}</Label>
              <Input
                id="audit-user"
                className="w-44"
                value={userDraft}
                onChange={(event) => setUserDraft(event.target.value)}
                placeholder={t("用户名")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-succeeded">{t("结果")}</Label>
              <Select
                value={succeeded || "all"}
                onValueChange={(value) => updateParams({ succeeded: value === "all" ? null : value, page: null })}
              >
                <SelectTrigger id="audit-succeeded" className="w-28">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("全部")}</SelectItem>
                  <SelectItem value="true">{t("成功")}</SelectItem>
                  <SelectItem value="false">{t("失败")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-actor">{t("操作者")}</Label>
              <Input
                id="audit-actor"
                className="w-44"
                value={actorDraft}
                onChange={(event) => setActorDraft(event.target.value)}
                placeholder={t("操作者用户名")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-action">{t("动作")}</Label>
              <Input
                id="audit-action"
                className="w-44"
                value={actionDraft}
                onChange={(event) => setActionDraft(event.target.value)}
                placeholder="user.freeze"
              />
            </div>
          </>
        )}
        {result && <span className="pb-2 text-sm text-muted-foreground">{t("共 {total} 条", { total: result.total })}</span>}
      </div>

      <Separator />

      {error && <p role="alert" className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {tab === "logins" ? (
            <Table className="min-w-[56rem] text-sm" aria-busy={!logins && !error}>
              <TableHeader>
                <TableRow className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <TableHead className="px-4 py-3 font-medium">{t("时间")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("用户")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("结果")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("失败原因")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logins?.items ?? []).map((log) => (
                  <TableRow key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                    <TableCell className="px-4 py-2.5 text-muted-foreground"><button type="button" className="text-left underline-offset-4 hover:underline focus-visible:outline-2" onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected({ kind: "login", entry: log }) }} aria-label={t("查看日志详情 {id}", { id: log.id })}>{new Date(log.createdAt).toLocaleString()}</button></TableCell>
                    <TableCell className="px-4 py-2.5">{log.userName}</TableCell>
                    <TableCell className="px-4 py-2.5">
                      {log.succeeded ? (
                        <SemanticBadge variant="success">{t("成功")}</SemanticBadge>
                      ) : (
                        <SemanticBadge variant="warning">{t("失败")}</SemanticBadge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-muted-foreground">{log.failureReason ?? "—"}</TableCell>
                    <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{log.ipAddress ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!logins && !error && (
                  <TableRow>
                    <TableCell colSpan={5} className="px-4 py-8">
                      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Skeleton className="h-4 w-36" />
                        <span>{t("正在加载…")}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {logins && logins.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {t("该时间范围内没有记录")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <Table className="min-w-[56rem] text-sm" aria-busy={!admin && !error}>
              <TableHeader>
                <TableRow className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <TableHead className="px-4 py-3 font-medium">{t("时间")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("操作者")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("动作")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">{t("目标")}</TableHead>
                  <TableHead className="px-4 py-3 font-medium">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(admin?.items ?? []).map((log) => (
                  <TableRow key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                    <TableCell className="px-4 py-2.5 text-muted-foreground"><button type="button" className="text-left underline-offset-4 hover:underline focus-visible:outline-2" onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected({ kind: "admin", entry: log }) }} aria-label={t("查看日志详情 {id}", { id: log.id })}>{new Date(log.createdAt).toLocaleString()}</button></TableCell>
                    <TableCell className="px-4 py-2.5">{log.actorUserName ?? log.actorUserId}</TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs">
                      <span>{t(AUDIT_ACTION[log.action] ?? log.action)}</span>
                      <span className="ml-1.5 font-mono text-muted-foreground">{log.action}</span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {log.targetType}:{log.targetId ?? ""}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{log.ipAddress ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!admin && !error && (
                  <TableRow>
                    <TableCell colSpan={5} className="px-4 py-8">
                      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Skeleton className="h-4 w-36" />
                        <span>{t("正在加载…")}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {admin && admin.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {t("该时间范围内没有记录")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ContextPanel open={selected !== null} guard={panelGuard} title={t("日志详情")} objectId={selected ? String(selected.entry.id) : undefined} returnFocusRef={returnFocusRef}
        className="[&_button[aria-label='关闭面板']]:hidden"
        headerActions={<Button variant="ghost" size="icon-sm" aria-label={t("关闭")} onClick={() => panelGuard.requestClose("close-button")}><XIcon aria-hidden="true" /></Button>}>
        {selected && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm break-words">
          <dt className="text-muted-foreground">{t("时间")}</dt><dd>{new Date(selected.entry.createdAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">{t(selected.kind === "login" ? "用户" : "操作者")}</dt><dd>{selected.kind === "login" ? selected.entry.userName : selected.entry.actorUserName ?? selected.entry.actorUserId}</dd>
          <dt className="text-muted-foreground">{t(selected.kind === "login" ? "结果" : "动作")}</dt><dd>{selected.kind === "login" ? t(selected.entry.succeeded ? "成功" : "失败") : t(AUDIT_ACTION[selected.entry.action] ?? selected.entry.action)}</dd>
          <dt className="text-muted-foreground">{t(selected.kind === "login" ? "失败原因" : "目标")}</dt><dd>{selected.kind === "login" ? selected.entry.failureReason ?? "—" : `${selected.entry.targetType ?? ""}:${selected.entry.targetId ?? ""}`}</dd>
          <dt className="text-muted-foreground">IP</dt><dd>{selected.entry.ipAddress ?? "—"}</dd>
        </dl>}
      </ContextPanel>

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
    </div>
  )
}
