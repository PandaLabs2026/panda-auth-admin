/**
 * BFF API 客户端：GET 直取；变更类先取防伪令牌（与 Cookie 成对校验）再发。
 * 401 统一折算为全页跳登录（会话过期/令牌被吊销/角色丢失），页面层无需各自处理。
 * 403 语义二分：只有 BFF 探测到上游 MFA 门禁标记（X-Panda-Mfa-Required）才跳 step-up，
 * 其余 403 是真正的权限拒绝，随一般错误路径展示，不再误导用户去 /account/mfa。
 */

import { currentLocale, serverMessagesEn } from "@/i18n/config"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"
import { beginGrantFlow } from "@/lib/grant-flow"

const MFA_REQUIRED_HEADER = "X-Panda-Mfa-Required"
const MFA_GRANT_REQUIRED_HEADER = "X-Panda-Mfa-Grant-Required"

/** 服务端 403 mfaGrantRequired 的结构化信号：携带授权签发所需的全部参数回显。 */
export class GrantRequiredSignal extends Error {
  constructor(
    readonly operation: string,
    readonly targetId: string,
    readonly parameters: Record<string, string | null> | null,
    readonly passwordRequired: boolean,
  ) {
    super("mfa_grant_required")
  }
}

/**
 * 带服务端稳定错误码的 API 错误(ADR 2026-10-11-admin-error-codes):
 * code 存在时渲染层经 serverError() 走 en 词典,其余(含 zh)显示服务端原文;
 * 未登记站点/未知码直接显示 message。服务端文案不进 I18nProvider(模板约定:
 * 那是后端契约,不是应用 UI 资产)。
 */
export class ApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

export async function problemDetailsError(response: Response): Promise<ApiError> {
  let detail = "请求失败(HTTP " + response.status + ")"
  let code: string | undefined
  try {
    const problem = (await response.json()) as {
      detail?: string
      title?: string
      extensions?: { code?: string }
    }
    detail = problem.detail ?? problem.title ?? detail
    code = typeof problem.extensions?.code === "string" ? problem.extensions.code : undefined
  } catch {
    // Keep the status fallback for empty or non-JSON failures.
  }
  return new ApiError(detail, code)
}

/** 错误渲染:en 下有码走 server 词典,无码/未知码/zh 显示服务端原文。 */
export function serverError(error: unknown): string {
  const message = error instanceof Error ? error.message : "加载失败"
  const code = error instanceof ApiError ? error.code : undefined
  if (!code || currentLocale() !== "en") return message
  return serverMessagesEn[`server.${code}`] ?? message
}

async function fetchAntiforgeryToken(): Promise<string> {
  return fetchWithTimeout(
    "/admin/api/antiforgery",
    { headers: { "X-Requested-With": "XMLHttpRequest" } },
    async (response) => {
      if (!response.ok) throw new Error("antiforgery " + response.status)
      const { token } = (await response.json()) as { token: string }
      return token
    },
  )
}

/** 带 returnUrl 的登录跳转：重登后回到当前页面而非概览（BFF 端 LoginReturnUrl 白名单放行 /admin 前缀）。 */
function unauthorized(): never {
  const returnUrl = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.assign(`/admin/login?returnUrl=${returnUrl}`)
  throw new Error("unauthorized")
}

/**
 * MFA step-up 的跳转地址：先回 BFF challenge，再回原页面。
 *
 * 为什么不能直接回原页：IDP 的 step-up 只重签自己的登录 Cookie（MarkMfaAsync），
 * BFF 会话里的 Access Token 仍是 step-up 之前那次授权码的产物；refresh token 的
 * principal 也在签发时冻结，刷新只会继承旧 MFA 声明。直接回原页重发请求仍会 403。
 * 先回 /admin/challenge 会重新走一次授权码，BFF 才能拿到带新 panda_mfa_at 的 AT。
 *
 * 两层编码：内层是 authorize 的 returnUrl，外层是 IDP MFA 页的 returnUrl。
 */
export function buildStepUpUrl(pathname: string, search: string): string {
  const original = `${pathname}${search}`
  const reauth = `/admin/challenge?returnUrl=${encodeURIComponent(original)}`
  return `/account/mfa?returnUrl=${encodeURIComponent(reauth)}`
}

/** 上游 MFA 门禁命中（403 + 标记头）才跳 step-up；完成验证后经 challenge 换新 AT 再回原操作。 */
function mfaRequired(): never {
  window.location.assign(buildStepUpUrl(window.location.pathname, window.location.search))
  throw new Error("mfa_required")
}

/** 会话契约（/admin/api/session）：顶栏与概览共用，勿在页面里另抄一份。 */
export type Session = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
  portalHomeUrl: string | null
}

export async function apiGet<T>(path: string): Promise<T> {
  return fetchWithTimeout(path, { headers: { "X-Requested-With": "XMLHttpRequest" } }, async (response) => {
    if (response.status === 401) unauthorized()
    if (!response.ok) throw await problemDetailsError(response)
    // 会话 Cookie 过期时 BFF 返回 302 → fetch 跟随重定向最终拿到登录页 HTML（200）：
    // JSON 解析必然失败，统一折算为带 returnUrl 的登录跳转而不是莫名的解析报错。
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) unauthorized()
    return (await response.json()) as T
  })
}

export async function apiSend<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const token = await fetchAntiforgeryToken()
  try {
    return await rawSend<T>(method, path, body, token)
  } catch (cause) {
    // 操作授权流（AUTH-DELIVERY-002）：403 授权标记 → 对话框签发 → 带授权头重放原请求。
    if (!(cause instanceof GrantRequiredSignal)) throw cause
    const grantId = await beginGrantFlow(cause)
    return await rawSend<T>(method, path, body, token, grantId)
  }
}

async function rawSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body: unknown | undefined,
  token: string,
  grantId?: string,
): Promise<T> {
  return fetchWithTimeout(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-XSRF-Token": token,
        "X-Requested-With": "XMLHttpRequest",
        ...(grantId ? { "X-Panda-Mfa-Grant": grantId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    async (response) => {
      if (response.status === 401) unauthorized()
      if (response.status === 403 && response.headers.get(MFA_GRANT_REQUIRED_HEADER) === "true") {
        // 服务端回显授权签发所需的全部参数（operation/targetId/parameters/passwordRequired），
        // 前端原样回传签发，两端口径不漂移。
        const body = (await response.json().catch(() => null)) as {
          operation?: string
          targetId?: string
          parameters?: Record<string, string | null> | null
          passwordRequired?: boolean
        } | null
        if (body?.operation) {
          throw new GrantRequiredSignal(
            body.operation,
            body.targetId ?? "",
            body.parameters ?? null,
            body.passwordRequired === true,
          )
        }
      }
      if (response.status === 403 && response.headers.get(MFA_REQUIRED_HEADER) === "true") mfaRequired()
      if (!response.ok) {
        // 非 ProblemDetails 的失败(裸 5xx、代理故障等)折算人话文案,不把原始状态码甩给用户。
        let detail = "请求失败(HTTP " + response.status + ")"
        let code: string | undefined
        try {
          const problem = (await response.json()) as {
            detail?: string
            title?: string
            extensions?: { code?: string }
          }
          detail = problem.detail ?? problem.title ?? detail
          // 服务端稳定错误码(ADR 2026-10-11-admin-error-codes):渲染层据此走 i18n,
          // 未知码降级显示 detail(现状行为)。
          code = typeof problem.extensions?.code === "string" ? problem.extensions.code : undefined
        } catch {
          /* 保留状态码文案 */
        }
        throw new ApiError(detail, code)
      }
      if (response.status === 204) return undefined as T
      // 与 apiGet 同款守卫：会话过期时防伪端点匿名可用（发令牌无需登录），随后的变更请求
      // 被 302 登录页 HTML——没有这道检查会变成莫名的解析错误。
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) unauthorized()
      return (await response.json()) as T
    },
  )
}

/** MFA 能力探针（BFF 转发 IDP 会话探针）：totpBound=false 时 SPA 全局绑定引导。 */
export type MfaCapability = { totpBound: boolean; mfaSatisfied: boolean }

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

export type UserClaim = { id: number; userId: string; claimType: string; claimValue: string; scope: string }

/** 在线会话条目(只读,与 share 的 AdminUserSession 对应;Payload/ReferenceId 不出服务端)。 */
export type AdminUserSession = {
  id: string
  clientId: string | null
  type: string
  creationDate: string | null
  expirationDate: string | null
}

export type RoleSummary = { id: string; name: string }

export type RoleClaim = { id: number; roleId: string; claimType: string; claimValue: string; scope: string }

export type ClaimRequest = { claimType: string; claimValue: string; scope: string }

export type ClientSummary = {
  clientId: string
  displayName: string | null
  clientType: string
  consentType: string
  /** 第一方/平台客户端由部署流程维护，管理台只读（server 端同时硬拒绝写）。 */
  isFirstParty: boolean
}

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
  "user.revoke_tokens": "吊销全部令牌",
  "user.update_profile": "更新资料",
  "user.reset_2fa": "重置两步验证",
  "user.deactivate": "注销账号",
  "client.update_uris": "修改回调白名单",
  "client.update_permissions": "修改客户端权限",
  "client.rotate_secret": "轮换客户端密钥",
}
