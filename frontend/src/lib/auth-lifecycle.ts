import { createAuthLifecycle } from "@/components/patterns/auth/lifecycle"
import { createAuthNavigation } from "@/components/patterns/auth/navigation"
export const adminAuthLifecycle = createAuthLifecycle()
export const adminAuthNavigation = createAuthNavigation({ key: "panda.admin.auth", loginPath: "/admin/challenge", home: "/admin/" })
