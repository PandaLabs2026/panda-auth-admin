import { afterEach, describe, expect, it, vi } from "vitest"

import { apiGet } from "./api"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("apiGet", () => {
  it("treats a read-only 403 as a permission error instead of starting Passkey step-up", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(null, { status: 403 })),
    ))

    await expect(apiGet("/admin/api/users?page=1")).rejects.toThrow("HTTP 403")
  })
})
