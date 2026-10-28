import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import AdminAuthBoundary, { adminAuthNavigation } from "./AdminAuthBoundary"
import { sessionApi } from "@/lib/auth"
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })
it("checks before mounting business and preserves the Admin path and query for automatic login", async () => {
  vi.spyOn(sessionApi, "me").mockResolvedValue(null)
  const start = vi.spyOn(adminAuthNavigation, "start").mockReturnValue(false)
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/users?page=2"]}><AdminAuthBoundary><p>private</p></AdminAuthBoundary></MemoryRouter></QueryClientProvider>)
  expect(screen.queryByText("private")).not.toBeInTheDocument()
  await waitFor(() => expect(start).toHaveBeenCalledWith("/admin/users?page=2"))
  expect(await screen.findByText("登录未完成")).toBeInTheDocument()
})
