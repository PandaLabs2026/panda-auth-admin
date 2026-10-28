import { createAuthLifecycle } from "@/components/patterns/auth/lifecycle"
import { createAuthNavigation } from "@/components/patterns/auth/navigation"
export const adminAuthLifecycle = createAuthLifecycle()
export const adminAuthNavigation = createAuthNavigation({ key: "panda.admin.auth", loginPath: "/admin/challenge", home: "/admin/" })

let uncertainOperation = false
/** Keep a presentation guard until explicit navigation; never infer a write outcome or replay it. */
export function markOperationUncertain() {
  if (uncertainOperation) return
  uncertainOperation = true
  adminAuthLifecycle.protect("结果待核实的管理操作")
}
