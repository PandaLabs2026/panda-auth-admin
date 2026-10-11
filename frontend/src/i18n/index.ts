import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./en.json"

/**
 * i18n 首期(#31 步骤一):自然键方案——zh-CN 字符串即 key,缺省语言渲染键本身
 * (zh 永远完整),en 资源提供英文翻译,未收录的键降级为中文(渐进覆盖不阻塞)。
 * 语言解析:URL ?lang= 优先(验收与用户级覆盖口),否则 navigator 以 en 开头 → en,
 * 其余 zh-CN(管理台主用户为中文管理员)。显式切换 UI 留待步骤二;
 * 测试经 test/setup.ts 钉死 zh-CN 保证断言确定性。
 */
const urlLang = new URLSearchParams(window.location.search).get("lang")
const detected = urlLang === "en" || urlLang === "zh-CN"
  ? urlLang
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

export default i18n
