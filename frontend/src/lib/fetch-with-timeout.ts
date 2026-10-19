const DEFAULT_TIMEOUT_MS = 15_000

/** Bound the request and response processing so route guards and mutations cannot hang forever. */
export async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  consumeResponse: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    return await consumeResponse(response)
  } finally {
    window.clearTimeout(timeout)
  }
}
