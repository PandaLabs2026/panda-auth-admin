import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useSearchParams } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import AuditPage from "./audit"
import { Providers } from "@/test/utils"

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

function SearchParamsProbe() {
  const [params] = useSearchParams()
  return <output data-testid="search-params">{params.toString()}</output>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("AuditPage URL filters and states", () => {
  it("renders login audit filters from the URL", async () => {
    const fetchMock = vi.fn((_path: string) => Promise.resolve(json({ items: [], total: 0, page: 1, pageSize: 20 })))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <Providers initialEntries={["/audit?tab=logins&from=2026-10-01T09%3A30&to=2026-10-02T18%3A45&userName=alice&succeeded=true&page=3"]}>
        <AuditPage />
      </Providers>,
    )

    expect(screen.getByLabelText("起（本地时区）")).toHaveValue("2026-10-01T09:30")
    expect(screen.getByLabelText("止（本地时区）")).toHaveValue("2026-10-02T18:45")
    expect(screen.getByLabelText("用户")).toHaveValue("alice")
    expect(screen.getByRole("tab", { name: "登录日志" })).toHaveAttribute("aria-selected", "true")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/admin/api/audit/logins?"), expect.anything()))
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]), "https://test.example")
    expect(requestUrl.searchParams.get("page")).toBe("3")
    expect(requestUrl.searchParams.get("userName")).toBe("alice")
    expect(requestUrl.searchParams.get("succeeded")).toBe("true")
  })

  it("switches to admin audit filters without dropping date params", async () => {
    const fetchMock = vi.fn((_path: string) => Promise.resolve(json({ items: [], total: 0, page: 1, pageSize: 20 })))
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    render(
      <Providers initialEntries={["/audit?from=2026-10-01T09%3A30&to=2026-10-02T18%3A45&userName=alice&succeeded=false&page=4"]}>
        <AuditPage />
        <SearchParamsProbe />
      </Providers>,
    )

    await user.click(screen.getByRole("tab", { name: "管理日志" }))

    const params = new URLSearchParams(screen.getByTestId("search-params").textContent ?? "")
    expect(params.get("tab")).toBe("admin")
    expect(params.get("from")).toBe("2026-10-01T09:30")
    expect(params.get("to")).toBe("2026-10-02T18:45")
    expect(params.get("page")).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/admin/api/audit/admin?"), expect.anything()))
    const adminRequest = fetchMock.mock.calls.map(([path]) => String(path)).find((path) => path.includes("/audit/admin?"))
    expect(new URL(adminRequest ?? "", "https://test.example").searchParams.has("from")).toBe(true)
    expect(screen.getByLabelText("操作者")).toBeInTheDocument()
  })

  it("keeps the table anchor during loading and empty states", async () => {
    let resolveAudit: ((response: Response) => void) | undefined
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveAudit = resolve })))
    const { container } = render(<Providers><AuditPage /></Providers>)

    const tableContainer = container.querySelector('[data-slot="table-container"]')
    expect(tableContainer).toHaveClass("overflow-x-auto")
    expect(within(tableContainer as HTMLElement).getByRole("status")).toBeInTheDocument()
    expect(tableContainer?.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    resolveAudit?.(json({ items: [], total: 0, page: 1, pageSize: 20 }))
    expect(await screen.findByText("该时间范围内没有记录")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table-container"]')).toBe(tableContainer)
    expect(tableContainer?.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
})
