import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("aborts a request that exceeds its time budget", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = fetchWithTimeout("/api", {}, 100)
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
