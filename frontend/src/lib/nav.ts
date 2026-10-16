import { GaugeIcon, KeyRoundIcon, ScrollTextIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"

/**
 * 侧边栏与概览「管理模块」卡的单一事实源(此前两处手抄已漂移:#24)。
 * 新增管理模块时只改这里;desc 供概览模块卡展示,label 为导航与标题文案,
 * icon 挂在条目上(模板 AppLayout NavItem 形态,废弃旧版按位置 zip 的 NAV_ICONS)。
 */
export const NAV = [
  { to: "/", label: "概览", desc: "会话身份与 IDP 状态", icon: GaugeIcon, end: true },
  { to: "/users", label: "用户管理", desc: "建号 / 角色 / 冻结 / 解锁 / 资料 / 2FA / 注销 / 重置密码", icon: UsersIcon },
  { to: "/roles", label: "角色管理", desc: "角色目录与自定义 Claims", icon: ShieldCheckIcon },
  { to: "/clients", label: "客户端管理", desc: "回调白名单 / scope / 密钥轮换", icon: KeyRoundIcon },
  { to: "/audit", label: "审计查询", desc: "登录日志与管理操作日志(只读)", icon: ScrollTextIcon },
] as const
