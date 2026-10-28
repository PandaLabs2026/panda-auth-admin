const DEFAULT_TIMEOUT_MS = 15_000

/** Bound the request and response processing so route guards and mutations cannot hang forever. */
export async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  consumeResponse: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  init.signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(init.signal?.reason)
  init.signal?.addEventListener("abort", cancel, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    controller.signal.throwIfAborted()
    const result = await consumeResponse(response)
    controller.signal.throwIfAborted()
    return result
  } finally {
    window.clearTimeout(timeout)
    init.signal?.removeEventListener("abort", cancel)
  }
}
