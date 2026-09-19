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

/** 带 returnUrl 的登录跳转：重登后回到当前页面而非概览（BFF 端 LoginReturnUrl 白名单放行 /admin 前缀）。 */
function unauthorized(): never {
  const returnUrl = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.assign(`/admin/login?returnUrl=${returnUrl}`)
  throw new Error("unauthorized")
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { "X-Requested-With": "XMLHttpRequest" } })
  if (response.status === 401) unauthorized()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  // 会话 Cookie 过期时 BFF 返回 302 → fetch 跟随重定向最终拿到登录页 HTML（200）：
  // JSON 解析必然失败，统一折算为带 returnUrl 的登录跳转而不是莫名的解析报错。
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) unauthorized()
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
  // 与 apiGet 同款守卫：会话过期时防伪端点匿名可用（发令牌无需登录），随后的变更请求
  // 被 302 到登录页 HTML（状态 200）——没有这道检查会变成莫名的 JSON 解析错误。
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) unauthorized()
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

export type CreateUserRequest = {
  userName: string
  email?: string | null
  nickname?: string | null
  region?: string | null
  password?: string | null
  grantAdminRole: boolean
}

export type CreateUserResponse = { id: string; userName: string; email: string | null; password: string | null }

/** 角色全量替换：roles 即目标用户的完整角色集合。 */
export type UserRolesRequest = { roles: string[] }

/** 资料编辑 PUT 全量语义：每个字段携带最终值，null 即清空。 */
export type UserProfileRequest = { email?: string | null; nickname?: string | null; region?: string | null }

export type DeactivateRequest = { confirmUserName: string }

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

/** 注册渠道展示名（与 share 的 RegisterChannel 枚举对应）。 */
export const REGISTER_CHANNEL: Record<number, string> = { 0: "密码注册", 1: "短信注册", 2: "邮箱注册", 3: "管理员创建" }

/**
 * 管理审计动作中文展示（与 share 的 AdminAuditAction 常量一一对应；契约注释要求的同步映射）。
 * 未知动作回退原文，新增动作时在这里补一行。
 */
export const AUDIT_ACTION: Record<string, string> = {
  "user.create": "创建用户",
  "user.freeze": "冻结用户",
  "user.unfreeze": "解冻用户",
  "user.reset_password": "重置密码",
  "user.update_roles": "变更角色",
  "user.unlock": "解锁账号",
  "user.update_profile": "更新资料",
  "user.reset_2fa": "重置两步验证",
  "user.deactivate": "注销账号",
  "client.update_uris": "修改回调白名单",
  "client.update_permissions": "修改客户端权限",
  "client.rotate_secret": "轮换客户端密钥",
}
