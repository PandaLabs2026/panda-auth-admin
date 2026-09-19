/**
 * BFF API 客户端：GET 直取；变更类先取防伪令牌（与 Cookie 成对校验）再发。
 * 401 统一折算为全页跳登录（会话过期/令牌被吊销/角色丢失），页面层无需各自处理。
 */

async function fetchAntiforgeryToken(): Promise<string> {
  const response = await fetch("/admin/api/antiforgery", { headers: { "X-Requested-With": "XMLHttpRequest" } })
  if (!response.ok) throw new Error(`antiforgery ${response.status}`)
  const { token } = (await response.json()) as { token: string }
  return token
}

function unauthorized(): never {
  window.location.assign("/admin/login")
  throw new Error("unauthorized")
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { "X-Requested-With": "XMLHttpRequest" } })
  if (response.status === 401) unauthorized()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function apiSend<T>(method: "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const token = await fetchAntiforgeryToken()
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-XSRF-Token": token,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 401) unauthorized()
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const problem = (await response.json()) as { detail?: string; title?: string }
      detail = problem.detail ?? problem.title ?? detail
    } catch {
      /* 保留状态码文案 */
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

/** 契约类型（与 panda-auth-share 的 PandaAuthAdminApi.cs 对应，camelCase JSON）。 */
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number }

export type UserSummary = {
  id: string
  userName: string
  email: string | null
  nickname: string | null
  status: number
  createdAt: string
}

export type UserDetail = UserSummary & {
  emailConfirmed: boolean
  roles: string[]
  lockoutEnd: string | null
  accessFailedCount: number
  twoFactorEnabled: boolean
  registerChannel: number
  region: string | null
  updatedAt: string
}

export type ClientSummary = { clientId: string; displayName: string | null; clientType: string; consentType: string }

export type ClientDetail = ClientSummary & {
  redirectUris: string[]
  postLogoutRedirectUris: string[]
  permissions: string[]
  requirements: string[]
}

export type ClientOptions = { permissionGroups: { group: string; options: string[] }[] }

export type LoginLogEntry = {
  id: number
  userId: string | null
  userName: string
  clientId: string | null
  ipAddress: string | null
  userAgent: string | null
  succeeded: boolean
  failureReason: string | null
  createdAt: string
}

export type AdminAuditEntry = {
  id: number
  actorUserId: string
  actorUserName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: string | null
  ipAddress: string | null
  createdAt: string
}

export const USER_STATUS: Record<number, string> = { 0: "正常", 1: "已冻结", 2: "已注销" }
