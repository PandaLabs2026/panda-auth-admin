import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/test/utils"
import RolesPage from "./roles"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("role claim submission", () => {
  for (const success of [true, false]) {
    it(`freezes the submitted fields and ${success ? "clears on success" : "retains on failure"}`, async () => {
      let finish!: (value: Response) => void
      const pending = new Promise<Response>((resolve) => { finish = resolve })
      let sent = ""
      vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
        if (path === "/admin/api/antiforgery") return Promise.resolve(json({ token: "test-csrf" }))
        if (path.startsWith("/admin/api/roles?")) return Promise.resolve(json({ items: [{ id: "r1", name: "admin" }], total: 1, page: 1, pageSize: 20 }))
        if (path === "/admin/api/roles/r1/claims" && options?.method === "POST") { sent = String(options.body); return pending }
        if (path === "/admin/api/roles/r1/claims") return Promise.resolve(json([]))
        throw new Error(`unexpected request ${path}`)
      }))
      const user = userEvent.setup()
      render(<Providers><RolesPage /></Providers>)
      await user.click(await screen.findByRole("button", { name: "admin" }))
      const type = await screen.findByLabelText("类型")
      const value = screen.getByLabelText("值")
      const scope = screen.getByLabelText("Scope")
      await user.clear(type); await user.type(type, "panda:test")
      await user.type(value, "original")
      await user.click(screen.getByRole("button", { name: "添加" }))
      await waitFor(() => expect(sent).toContain("original"))
      expect(type).toBeDisabled(); expect(value).toBeDisabled(); expect(scope).toBeDisabled()
      expect(screen.getByRole("button", { name: "admin" })).toBeDisabled()
      await user.type(value, "-late")
      expect(value).toHaveValue("original")
      await act(async () => { finish(success ? json({ id: 1 }) : json({ message: "failed" }, 500)); await pending })
      await waitFor(() => expect(value).toBeEnabled())
      expect(value).toHaveValue(success ? "" : "original")
      expect(type).toHaveValue(success ? "panda:" : "panda:test")
      expect(scope).toHaveValue("api")
      expect(JSON.parse(sent)).toEqual({ claimType: "panda:test", claimValue: "original", scope: "api" })
    })
  }
})
