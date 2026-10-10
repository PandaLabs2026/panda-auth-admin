import { apiGet, type Session } from "@/lib/api"

/**
 * 会话查询的模块级缓存(#31):AppShell/概览/用户页此前各自请求一次 /admin/api/session,
 * 首屏双发。SPA 一次加载内会话不变(登录/登出都是全页导航),模块级 Promise 缓存即安全。
 * 失败不缓存:允许下一个消费方重试(网络抖动不该钉死整页的会话态)。
 */
let sessionPromise: Promise<Session> | null = null

export function getSession(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = apiGet<Session>("/admin/api/session").catch((cause: unknown) => {
      sessionPromise = null
      throw cause
    })
  }
  return sessionPromise
}
