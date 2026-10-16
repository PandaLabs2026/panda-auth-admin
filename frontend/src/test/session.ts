import type { Session } from "@/lib/auth"

/** 测试共用的完整会话夹具（含模板 v0.5.0 的 roles/accountEntryUrl 与应用扩展字段）。 */
export const testSession: Session = {
  displayName: "测试用户",
  email: "tester@example.com",
  roles: ["admin"],
  accountEntryUrl: "/me",
  subject: "admin-1",
  portalHomeUrl: null,
}
