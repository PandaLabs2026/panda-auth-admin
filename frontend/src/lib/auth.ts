import { useAuthState } from "@/components/patterns/auth/context"
import { useMutation, useQuery } from "@tanstack/react-query"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"
import { problemDetailsError } from "@/lib/api"

/**
 * 认证会话（真实 BFF 版，对齐模板 v0.5.0 会话层契约）：
 * 会话来自 PandaAuth Admin BFF 的 GET /admin/api/session（OIDC admin-web 授权码 + PKCE，
 * 首次进入经 /admin/login → /admin/challenge 整页挑战）；登出是防伪令牌成对的
 * POST /admin/api/logout（本地会话 + IDP end-session）。
 * 组件层（useSession/useLogout/RequireAuth/AppLayout/NavUser）保持模板形态；
 * accountEntryUrl 遵循 IDP /me 契约——身份属性唯一正本在账户中心，应用只外链。
 * 会话内变更 401 仍由 lib/api.ts 全页跳转（OIDC 续期必须走挑战往返），双轨不冲突：
 * 守卫层用 me() 的 null（SPA 跳登录页），数据层用 unauthorized()（整页回跳带 returnUrl）。
 */

export interface Session {
  displayName: string
  /** userinfo email 声明；BFF 出 JSON null 时归一为 undefined（对齐模板组件层契约）。 */
  email?: string
  /** 会话角色；RequireRoles 预留，当前管理台全量授权后单租户运行。 */
  roles?: string[]
  /** 账号自助入口（IDP /me 契约）：身份属性修改在账户中心，应用只外链。 */
  accountEntryUrl?: string | null
  /** BFF 原始会话字段透传（应用扩展）：subject 供页面自检（防自我误操作），portalHomeUrl 供返回门户。 */
  subject?: string
  nickname?: string | null
  portalHomeUrl?: string | null
}

/** BFF 会话契约（lib/api.ts Session；camelCase，对应 PandaAuthAdminApi.cs）。 */
type BffSession = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
  portalHomeUrl: string | null
}

/** BFF 会话 → 模板组件层会话的映射（displayName 昵称优先对齐旧版概览行为；null 归一 undefined）。 */
function toSession(raw: BffSession): Session {
  return {
    displayName: raw.nickname ?? raw.name ?? raw.subject,
    email: raw.email ?? undefined,
    roles: raw.roles,
    accountEntryUrl: "/me",
    subject: raw.subject,
    nickname: raw.nickname,
    portalHomeUrl: raw.portalHomeUrl,
  }
}

let onSessionExpired: ((returnTo: string) => void) | null = null

/** 应用启动时注册会话过期跳转（模板组件层契约；管理台数据层走 api.ts 整页跳转，双轨见文件头）。 */
export function registerSessionExpiredHandler(handler: (returnTo: string) => void) {
  onSessionExpired = handler
}

/** 401 统一入口：模板 apiFetch 抛 401 前的钩子走这里。 */
export function handleUnauthorized() {
  onSessionExpired?.(window.location.pathname)
}

export const sessionApi = {
  /** 会话探测：未登录/会话失效（401 或 302→登录页 HTML）静默收敛为 null，守卫据此跳登录页。 */
  async me(signal?: AbortSignal): Promise<Session | null> {
    return fetchWithTimeout(
      "/admin/api/session",
      { headers: { "X-Requested-With": "XMLHttpRequest" }, signal },
      async (res) => {
        if (res.status === 401) return null
        if (!res.ok) throw await problemDetailsError(res)
        const contentType = res.headers.get("content-type") ?? ""
        if (!contentType.includes("application/json")) throw new Error("会话服务返回了无效响应。")
        const raw: unknown = await res.json()
        if (!raw || typeof raw !== "object") throw new Error("会话服务返回了无效响应。")
        const value = raw as Record<string, unknown>
        if (typeof value.subject !== "string" || !value.subject.trim() ||
            !Array.isArray(value.roles) || !value.roles.every(role => typeof role === "string") ||
            ["name", "email", "nickname", "portalHomeUrl"].some(key =>
              value[key] !== null && typeof value[key] !== "string"))
          throw new Error("会话服务返回了无效响应。")
        return toSession(value as BffSession)
      },
      10_000,
    )
  },

  /** Fetch only the antiforgery token; the native form owns the complete logout navigation. */
  async logout(): Promise<void> {
    const token = await fetchWithTimeout(
      "/admin/api/antiforgery",
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
      async (antiforgery) => {
        if (!antiforgery.ok) throw await problemDetailsError(antiforgery)
        return ((await antiforgery.json()) as { token: string }).token
      },
      10_000,
    )
    if (typeof token !== "string" || !token) throw new Error("退出请求缺少防伪凭据。")
    const form = document.createElement("form")
    form.method = "post"
    form.action = "/admin/api/logout"
    form.hidden = true
    const field = document.createElement("input")
    field.type = "hidden"
    field.name = "__RequestVerificationToken"
    field.value = token
    form.append(field)
    document.body.append(form)
    try { HTMLFormElement.prototype.submit.call(form) }
    finally { form.remove() }
  },
}

/** 会话查询：无会话=null（守卫据此跳登录），Query 缓存取代旧模块级 Promise 单飞。 */
export function useSession() {
  const auth = useAuthState()
  return useQuery({ enabled: !auth.lifecycle, queryKey: ["session"], queryFn: ({ signal }) => sessionApi.me(signal), staleTime: 60_000, retry: false })
}

export function useLogout() {
  const auth = useAuthState()
  return useMutation({ mutationFn: () => auth.lifecycle ? auth.logout() : sessionApi.logout() })
}
