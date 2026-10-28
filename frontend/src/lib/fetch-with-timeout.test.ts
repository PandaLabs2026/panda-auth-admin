import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("propagates caller cancellation and removes its listener after completion", async () => {
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, "removeEventListener")
    let requestSignal: AbortSignal | null | undefined
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal
      caller.abort()
      return new Response("ok")
    }))
    await expect(fetchWithTimeout("/api", { signal: caller.signal }, async () => undefined)).rejects.toMatchObject({ name: "AbortError" })
    expect(requestSignal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
  })

  it("does not issue a request when its caller has already cancelled", async () => {
    const caller = new AbortController()
    caller.abort()
    const fetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", fetch)
    await expect(fetchWithTimeout("/api", { signal: caller.signal }, async () => undefined)).rejects.toMatchObject({ name: "AbortError" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("aborts a request that exceeds its time budget", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = fetchWithTimeout("/api", {}, async () => undefined, 100)
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("keeps the deadline active while the response body is consumed", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")))
        },
      })
      return new Response(body, { headers: { "Content-Type": "application/json" } })
    })
    vi.stubGlobal("fetch", fetchMock)

    const pending = fetchWithTimeout("/api", {}, (response) => response.json(), 100)
    const outcome = pending.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
    await vi.advanceTimersByTimeAsync(100)
    const result = await outcome
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") expect(result.error).toMatchObject({ name: "AbortError" })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
