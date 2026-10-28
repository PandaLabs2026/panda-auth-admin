import { useEffect, useMemo, type ReactNode } from "react"
import { useLocation } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import AuthBoundary from "@/components/patterns/auth/AuthBoundary"
import type { AuthAdapter } from "@/components/patterns/auth/types"
import { sessionApi, type Session } from "@/lib/auth"
import { ApiError } from "@/lib/api"
import { subscribeSessionExpiry } from "@/lib/session-expiry"
import { adminAuthLifecycle, adminAuthNavigation } from "@/lib/auth-lifecycle"
export { adminAuthLifecycle, adminAuthNavigation } from "@/lib/auth-lifecycle"
export default function AdminAuthBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient(), location = useLocation()
  const adapter = useMemo<AuthAdapter<Session>>(() => ({
    session: signal => sessionApi.me(signal),
    status: error => error instanceof ApiError ? error.status ?? 0 : 0,
    async logout() { await sessionApi.logout(); return { kind: "navigation" } },
    sessionChanged(session) {
      const previous = client.getQueryData<Session | null>(["session"])
      if (previous?.subject !== session?.subject) {
        void client.cancelQueries({ predicate: query => query.queryKey[0] !== "session" })
        client.removeQueries({ predicate: query => query.queryKey[0] !== "session" })
      }
      client.setQueryData(["session"], session ?? null)
    },
  }), [client])
  useEffect(() => subscribeSessionExpiry(() => adminAuthLifecycle.unauthorized()), [])
  useEffect(() => {
    const check = () => { if (document.visibilityState === "visible") adminAuthLifecycle.unauthorized() }
    window.addEventListener("focus", check)
    window.addEventListener("pageshow", check)
    document.addEventListener("visibilitychange", check)
    return () => {
      window.removeEventListener("focus", check)
      window.removeEventListener("pageshow", check)
      document.removeEventListener("visibilitychange", check)
    }
  }, [])
  return <AuthBoundary adapter={adapter} lifecycle={adminAuthLifecycle} navigation={adminAuthNavigation}
    target={"/admin" + (location.pathname === "/" ? "/" : location.pathname) + location.search}
    brand={<img src="/admin/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain"/>}>
    {children}
  </AuthBoundary>
}
