/**
 * 侧边栏与概览「管理模块」卡的单一事实源(此前两处手抄已漂移:#24)。
 * 新增管理模块时只改这里;desc 供概览模块卡展示,label 为导航与标题文案。
 */
export const NAV = [
  { to: "/", label: "概览", desc: "会话身份与 IDP 状态" },
  { to: "/users", label: "用户管理", desc: "建号 / 角色 / 冻结 / 解锁 / 资料 / 2FA / 注销 / 重置密码" },
  { to: "/roles", label: "角色管理", desc: "角色目录与自定义 Claims" },
  { to: "/clients", label: "客户端管理", desc: "回调白名单 / scope / 密钥轮换" },
  { to: "/audit", label: "审计查询", desc: "登录日志与管理操作日志(只读)" },
] as const

/** 路由 → 顶栏标题(由 NAV 派生,勿手抄)。 */
export const NAV_TITLES: Record<string, string> = Object.fromEntries(NAV.map((item) => [item.to, item.label]))
