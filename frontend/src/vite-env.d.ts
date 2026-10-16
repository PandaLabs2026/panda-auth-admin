/// <reference types="vite/client" />

/** vite.config.ts 的 define 注入;取自 package.json version,单一事实源(#31)。 */

// vite.config.ts 的 define 注入(git describe);页脚版本锚点消费(模板 v0.2 约定)。
declare const __APP_VERSION__: string
