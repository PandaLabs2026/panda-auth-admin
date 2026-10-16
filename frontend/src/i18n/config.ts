import type { I18nConfig } from "@/lib/i18n"

import en from "./en.json"
import enServer from "./en-server.json"

/**
 * 应用 i18n 配置（模板 v0.5.0 I18nProvider 的应用层资产）：
 * 沿用自然键方案——zh-CN 字符串即 key，zh 字典恒空（渲染键本身），en 字典渐进覆盖。
 * 服务端 ProblemDetails 文案不进该框架（模板约定：那是后端契约，见 lib/api.ts serverError）。
 */

export const LANG_STORAGE_KEY = "panda.admin.lang"
const SUPPORTED = ["zh-CN", "en"] as const

/** 服务端稳定错误码的英译（ADR 2026-10-11-admin-error-codes；zh 显示服务端原文）。 */
export const serverMessagesEn: Record<string, string> = enServer

/** 启动期语言种子：?lang=（单次覆盖验收口，写入持久化后剥掉参数）> localStorage > navigator。 */
function seedLocale(): void {
  if (typeof window === "undefined") return
  const fromUrl = new URLSearchParams(window.location.search).get("lang")
  if (fromUrl && (SUPPORTED as readonly string[]).includes(fromUrl)) {
    localStorage.setItem(LANG_STORAGE_KEY, fromUrl)
    const url = new URL(window.location.href)
    url.searchParams.delete("lang")
    window.history.replaceState(null, "", url)
    return
  }
  if (localStorage.getItem(LANG_STORAGE_KEY)) return
  const detected = navigator.language?.toLowerCase().startsWith("en") ? "en" : "zh-CN"
  localStorage.setItem(LANG_STORAGE_KEY, detected)
}

seedLocale()

/** 当前语言（api 层等服务端文案渲染处读取；UI 组件一律走 useI18n()）。 */
export function currentLocale(): string {
  if (typeof window === "undefined") return "zh-CN"
  return localStorage.getItem(LANG_STORAGE_KEY) ?? "zh-CN"
}

export const i18nConfig: I18nConfig = {
  defaultLocale: "zh-CN",
  locales: [...SUPPORTED],
  // 自然键方案:zh 键即文案,但模板 t() 对「字典缺失的键」原样返回、不走插值——
  // 带占位符的键(如「冻结用户 {name}？」)需要 zh 字典恒等映射(键=值)才能插值。
  // 以 en 字典键集生成,未登记的键仍回退键本身(渐进覆盖语义不变)。
  dictionaries: {
    "zh-CN": Object.fromEntries(Object.keys(en).map((key) => [key, key])),
    en,
  },
  storageKey: LANG_STORAGE_KEY,
}
