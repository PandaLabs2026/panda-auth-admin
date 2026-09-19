import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiGet, AUDIT_ACTION, type AdminAuditEntry, type LoginLogEntry, type PageResult } from "@/lib/api"

/**
 * 审计查询（0.3）：登录日志与管理操作日志双视图，只读 + 时间过滤 + 分页。
 */
export default function AuditPage() {
  const [tab, setTab] = useState<"logins" | "admin">("logins")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [logins, setLogins] = useState<PageResult<LoginLogEntry> | null>(null)
  const [admin, setAdmin] = useState<PageResult<AdminAuditEntry> | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 时间过滤输入即触发：用序号丢弃乱序返回的旧响应，避免表格闪回旧过滤条件的结果。
  const loadSeq = useRef(0)
  const pageSize = 20

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      setError(null)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (from) params.set("from", new Date(from).toISOString())
      if (to) params.set("to", new Date(to).toISOString())
      if (tab === "logins") {
        const data = await apiGet<PageResult<LoginLogEntry>>(`/admin/api/audit/logins?${params}`)
        if (seq === loadSeq.current) setLogins(data)
      } else {
        const data = await apiGet<PageResult<AdminAuditEntry>>(`/admin/api/audit/admin?${params}`)
        if (seq === loadSeq.current) setAdmin(data)
      }
    } catch (cause) {
      if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "加载失败")
    }
  }, [tab, page, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const result = tab === "logins" ? logins : admin
  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["logins", "登录日志"],
              ["admin", "管理日志"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`rounded px-3 py-1.5 ${tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => {
                setPage(1)
                setTab(key)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="from">起（本地时区）</Label>
          <Input
            id="from"
            type="datetime-local"
            className="w-56"
            value={from}
            onChange={(event) => {
              setPage(1)
              setFrom(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">止</Label>
          <Input
            id="to"
            type="datetime-local"
            className="w-56"
            value={to}
            onChange={(event) => {
              setPage(1)
              setTo(event.target.value)
            }}
          />
        </div>
        {result && <span className="pb-2 text-sm text-muted-foreground">共 {result.total} 条</span>}
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {tab === "logins" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">结果</th>
                  <th className="px-4 py-3 font-medium">失败原因</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {(logins?.items ?? []).map((log) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(log.createdAt).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-2.5">{log.userName}</td>
                    <td className="px-4 py-2.5">
                      {log.succeeded ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">成功</span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">失败</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{log.failureReason ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{log.ipAddress ?? "—"}</td>
                  </tr>
                ))}
                {logins && logins.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      该时间范围内没有记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">操作者</th>
                  <th className="px-4 py-3 font-medium">动作</th>
                  <th className="px-4 py-3 font-medium">目标</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {(admin?.items ?? []).map((log) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{new Date(log.createdAt).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-2.5">{log.actorUserName ?? log.actorUserId}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                      <span>{AUDIT_ACTION[log.action] ?? log.action}</span>
                      <span className="ml-1.5 font-mono text-muted-foreground">{log.action}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {log.targetType}:{log.targetId ?? ""}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{log.ipAddress ?? "—"}</td>
                  </tr>
                ))}
                {admin && admin.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      该时间范围内没有记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
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
    </div>
  )
}
