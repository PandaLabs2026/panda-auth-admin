import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./en.json"

/**
 * i18n(#31):自然键方案——zh-CN 字符串即 key,缺省语言渲染键本身
 * (zh 永远完整),en 资源提供英文翻译,未收录的键降级为中文(渐进覆盖不阻塞)。
 *
 * 语言解析优先级:URL ?lang=(单次覆盖,验收口)> localStorage 持久选择(切换 UI 写入)>
 * navigator 以 en 开头 → en,其余 zh-CN(管理台主用户为中文管理员)。
 * server 侧 ProblemDetails 双语属跨仓立项(#31 步骤二后半),与本文件无关。
 * 测试经 test/setup.ts 钉死 zh-CN 保证断言确定性。
 */
const SUPPORTED = ["en", "zh-CN"] as const
const STORE_KEY = "panda.admin.lang"

const fromUrl = new URLSearchParams(window.location.search).get("lang")
const fromStore = localStorage.getItem(STORE_KEY)
const detected = fromUrl && (SUPPORTED as readonly string[]).includes(fromUrl)
  ? fromUrl
  : fromStore && (SUPPORTED as readonly string[]).includes(fromStore)
    ? fromStore
    : navigator.language?.toLowerCase().startsWith("en")
      ? "en"
      : "zh-CN"

void i18n.use(initReactI18next).init({
  lng: detected,
  fallbackLng: "zh-CN",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  returnEmptyString: false,
})

/** 切换语言并持久化(切换 UI 调用);同步 <html lang> 供无障碍与字体回退。 */
export function changeLanguage(lng: (typeof SUPPORTED)[number]) {
  void i18n.changeLanguage(lng)
  localStorage.setItem(STORE_KEY, lng)
}

document.documentElement.lang = detected
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng
})

export default i18n
